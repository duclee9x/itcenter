#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

usage() {
  cat >&2 <<'EOF'
USAGE: rehearse-migration.sh --from <N-1-release.json> --to <N-release.json> \
  --config <staging-compose.env> [--evidence-dir <dir>] [--test-mode] [--keep]

The command is isolated by default. It requires an N-1 reference and an N
release metadata file; production targets are rejected.
EOF
  exit 2
}

from_file=to_file=config_file=evidence_dir=
test_mode=false
keep=false
while (($#)); do
  case "$1" in
    --from) from_file=${2:-}; shift 2 ;;
    --to) to_file=${2:-}; shift 2 ;;
    --config) config_file=${2:-}; shift 2 ;;
    --evidence-dir) evidence_dir=${2:-}; shift 2 ;;
    --test-mode) test_mode=true; shift ;;
    --keep) keep=true; shift ;;
    -h|--help) usage ;;
    *) die ARGUMENT_INVALID ;;
  esac
done
[[ -r "$from_file" && -r "$to_file" && -r "$config_file" ]] || die REHEARSAL_INPUT_UNAVAILABLE
[[ "$(read_env_value "$config_file" APP_ENV)" == staging ]] || die ISOLATED_STAGING_REQUIRED
[[ "$(read_env_value "$config_file" DB_MODE)" == compose ]] || die ISOLATED_COMPOSE_DATABASE_REQUIRED

command -v jq >/dev/null 2>&1 || die JQ_UNAVAILABLE
command -v flock >/dev/null 2>&1 || die FLOCK_UNAVAILABLE
ensure_container_runtime

target_release=$(jq -er '.release_id | strings' "$to_file") || die TARGET_RELEASE_METADATA_INVALID
target_image=$(jq -er 'if .image then .image elif (.image_repository and .image_digest) then (.image_repository + "@" + .image_digest) else empty end' "$to_file") || die TARGET_IMAGE_METADATA_INVALID
target_schema=$(jq -er '.schema_revision | strings' "$to_file") || die TARGET_SCHEMA_METADATA_INVALID
verify_image_digest "$target_image"
[[ "$target_schema" =~ ^[a-fA-F0-9]{64}$ ]] || die TARGET_SCHEMA_METADATA_INVALID

source_release=$(jq -er '.release_id | strings' "$from_file") || die SOURCE_RELEASE_METADATA_INVALID
source_schema=$(jq -er '.schema_revision | strings' "$from_file") || die SOURCE_SCHEMA_METADATA_INVALID
source_commit=$(jq -r '.source_commit // "unknown"' "$from_file")
target_commit=$(jq -r '.source_commit // "unknown"' "$to_file")
source_steps=$(jq -er '.migration_steps // empty' "$from_file" 2>/dev/null || true)
source_image=$(jq -er 'if .image then .image elif (.image_repository and .image_digest) then (.image_repository + "@" + .image_digest) else empty end' "$from_file" 2>/dev/null || true)
reference_type=$(jq -r '.reference_type // "IMMUTABLE_RELEASE"' "$from_file")
[[ "$source_schema" =~ ^[a-fA-F0-9]{64}$ ]] || die SOURCE_SCHEMA_METADATA_INVALID
[[ "$source_steps" =~ ^[1-9][0-9]*$ ]] || die SOURCE_MIGRATION_STEPS_REQUIRED
if [[ -n "$source_image" ]]; then verify_image_digest "$source_image"; fi
[[ -n "$source_image" ]] || die SOURCE_IMAGE_REQUIRED
if [[ "$reference_type" == TRANSITIONAL_N_MINUS_1_REFERENCE ]]; then
  jq -e '.source_commit | strings | test("^[a-fA-F0-9]{40}$")' "$from_file" >/dev/null || die TRANSITIONAL_SOURCE_COMMIT_REQUIRED
  jq -e '.artifact_provenance | strings | length > 0' "$from_file" >/dev/null || die TRANSITIONAL_PROVENANCE_REQUIRED
fi
export APP_IMAGE="$target_image"

state_root=$(release_state_root)
evidence_dir=${evidence_dir:-$state_root/staging/migration-rehearsals}
mkdir -p "$evidence_dir"
run_id="migration-$(date -u +%Y%m%dT%H%M%SZ)-$$"
project="itsm-migration-rehearsal-$run_id"
work_root=${LIMA_WORK_DIR:-${TMPDIR:-/tmp}/itcenter-migration-rehearsal}
work_dir="$work_root/$run_id"
mkdir -m 700 -p "$work_dir"
evidence_file="$evidence_dir/$run_id.json"
rehearsal_env="$config_file"
lock_root=${MIGRATION_REHEARSAL_LOCK_ROOT:-${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}/itcenter/locks}
mkdir -p "$lock_root"
exec 7>"$lock_root/itcenter-migration-rehearsal.lock"
flock -n 7 || die MIGRATION_REHEARSAL_ALREADY_IN_PROGRESS

started_epoch=$(date +%s)
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
status=FAIL
failure_reason=REHEARSAL_NOT_COMPLETED
backup_id=
target_duration=0
source_duration=0
maintenance_duration=0
lock_result=NOT_OBSERVED
timeout_result=NONE
configured_lock_timeout=${MIGRATION_LOCK_TIMEOUT:-10s}
configured_statement_timeout=${MIGRATION_STATEMENT_TIMEOUT:-10min}
configured_overall_timeout_seconds=${MIGRATION_TIMEOUT_SECONDS:-1800}
data_validation=NOT_RUN
worker_validation=NOT_RUN
gateway_validation=NOT_RUN
application_validation=NOT_RUN
fixture_set_id=
fixture_pre_hash=
fixture_post_hash=
fixture_pre_state=
fixture_post_state=
matrix_n1_n1=NOT_EXECUTED
matrix_n_n1=NOT_EXECUTED
matrix_n1_n=NOT_EXECUTED
matrix_n_n=NOT_EXECUTED
rollback_result=NOT_DETERMINED
cleanup() {
  local result=$?
  if [[ "$keep" != true ]]; then
    "$CONTAINER_CLI" compose --project-name "$project" --env-file "$rehearsal_env" \
      -f "$(cd "$(dirname "$0")/.." && pwd)/compose.yaml" \
      -f "$(cd "$(dirname "$0")/.." && pwd)/compose.rehearsal.yaml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
  write_evidence "$result" || true
  exit "$result"
}
write_evidence() {
  local exit_code=${1:-0} completed_at
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq -n \
    --arg rehearsal_id "$run_id" --arg source_release "$source_release" \
    --arg target_release "$target_release" --arg source_schema "$source_schema" \
    --arg target_schema "$target_schema" --arg target_image "$target_image" \
    --arg source_image "$source_image" --arg reference_type "$reference_type" \
    --arg source_commit "$source_commit" --arg target_commit "$target_commit" \
    --arg postgres_major_version "$(read_env_value "$config_file" POSTGRES_MAJOR_VERSION)" \
    --arg backup_id "$backup_id" --arg started_at "$started_at" \
    --arg completed_at "$completed_at" --arg status "$status" \
    --arg failure_reason "$failure_reason" --arg lock_result "$lock_result" \
    --arg timeout_result "$timeout_result" --arg matrix_n1_n1 "$matrix_n1_n1" \
    --arg matrix_n_n1 "$matrix_n_n1" --arg matrix_n1_n "$matrix_n1_n" \
    --arg matrix_n_n "$matrix_n_n" --arg rollback_result "$rollback_result" \
    --arg test_mode "$test_mode" \
    --argjson source_duration "$source_duration" --argjson target_duration "$target_duration" \
    --argjson maintenance_duration "$maintenance_duration" \
    --arg data_validation "$data_validation" --arg worker_validation "$worker_validation" \
    --arg gateway_validation "$gateway_validation" --arg application_validation "$application_validation" \
    --arg fixture_set_id "$fixture_set_id" --arg fixture_pre_hash "$fixture_pre_hash" \
    --arg fixture_post_hash "$fixture_post_hash" --arg fixture_pre_state "$fixture_pre_state" \
    --arg fixture_post_state "$fixture_post_state" \
    --arg configured_lock_timeout "$configured_lock_timeout" \
    --arg configured_statement_timeout "$configured_statement_timeout" \
    --arg configured_overall_timeout_seconds "$configured_overall_timeout_seconds" \
    '{rehearsal_id:$rehearsal_id,source_release:$source_release,target_release:$target_release,
      source_schema:$source_schema,target_schema:$target_schema,postgres_major_version:$postgres_major_version,
      candidate_oci_digest:$target_image,n_minus_1_reference:$source_image,reference_type:$reference_type,
      source_commit:$source_commit,target_commit:$target_commit,
      pre_migration_backup_id:(if ($backup_id|length)>0 then $backup_id else null end),started_at:$started_at,completed_at:$completed_at,
      migration_duration_seconds:$target_duration,baseline_duration_seconds:$source_duration,
      maintenance_duration_seconds:$maintenance_duration,lock_result:$lock_result,timeout_result:$timeout_result,
      migration_controls:{lock_timeout:$configured_lock_timeout,statement_timeout:$configured_statement_timeout,
        overall_timeout_seconds:($configured_overall_timeout_seconds|tonumber),timeout_occurred:($timeout_result != "NONE")},
      compatibility_matrix:{"App N-1 + Schema N-1":$matrix_n1_n1,"App N + Schema N-1":$matrix_n_n1,
        "App N-1 + Schema N":$matrix_n1_n,"App N + Schema N":$matrix_n_n},
      transaction_policy:"TRANSACTIONAL_PER_MIGRATION",
      data_validation:$data_validation,worker_validation:$worker_validation,
      gateway_validation:$gateway_validation,application_validation:$application_validation,
      fixture:{set_id:$fixture_set_id,pre_migration_hash:$fixture_pre_hash,post_migration_hash:$fixture_post_hash,
        pre_migration_state:$fixture_pre_state,post_migration_state:$fixture_post_state},
      rollback_result:$rollback_result,status:$status,failure_reason:(if ($failure_reason|length)>0 then $failure_reason else null end),
      evidence_class:(if $test_mode == "true" then "ISOLATED_TEST" else "PRODUCTION_LIKE" end)}' \
    >"$evidence_file.tmp.$$"
  chmod 600 "$evidence_file.tmp.$$"
  mv -f "$evidence_file.tmp.$$" "$evidence_file"
}
trap cleanup EXIT

rehearsal_env="$config_file"

compose_args=(--project-name "$project" --env-file "$rehearsal_env" \
  -f "$(cd "$(dirname "$0")/.." && pwd)/compose.yaml" \
  -f "$(cd "$(dirname "$0")/.." && pwd)/compose.rehearsal.yaml")
if [[ -n "$(read_env_value "$config_file" OIDC_CA_CERT_FILE)" ]]; then
  compose_args+=( -f "$(cd "$(dirname "$0")/.." && pwd)/compose.oidc-ca.yaml" )
fi
compose_rehearsal() { "$CONTAINER_CLI" compose "${compose_args[@]}" "$@"; }

compose_rehearsal config --quiet || { failure_reason=COMPOSE_CONFIG_INVALID; die "$failure_reason"; }
if [[ "$test_mode" != true ]]; then
  backup_command=${REHEARSAL_BACKUP_GATE_COMMAND:-}
  [[ -n "$backup_command" ]] || { failure_reason=BACKUP_GATE_COMMAND_REQUIRED; die "$failure_reason"; }
  backup_output="$work_dir/backup-gate.out"
  if ! bash -c "$backup_command" >"$backup_output" 2>&1; then
    failure_reason=PRE_MIGRATION_BACKUP_FAILED
    die "$failure_reason"
  fi
  backup_id=$(awk '$1=="BACKUP_SUCCEEDED" {print $3}' "$backup_output" | tail -1)
  [[ -n "$backup_id" ]] || { failure_reason=PRE_MIGRATION_BACKUP_REFERENCE_MISSING; die "$failure_reason"; }
else
  backup_id="isolated-test-$run_id"
fi

compose_rehearsal --profile compose-postgres up -d --wait postgres || {
  failure_reason=REHEARSAL_DATABASE_START_FAILED; die "$failure_reason";
}
if [[ -n "${REHEARSAL_OIDC_CONTAINER:-}" ]]; then
  compose_network="${project}_private"
  "$CONTAINER_CLI" network connect --alias keycloak "$compose_network" "$REHEARSAL_OIDC_CONTAINER" || {
    failure_reason=REHEARSAL_OIDC_NETWORK_CONNECT_FAILED; die "$failure_reason";
  }
fi

run_migration() {
  local max_steps=${1:-}
  local -a env_args=(-e "MIGRATION_LOCK_TIMEOUT=$configured_lock_timeout" \
    -e "MIGRATION_STATEMENT_TIMEOUT=$configured_statement_timeout")
  [[ -n "$max_steps" ]] && env_args+=(-e "MIGRATION_MAX_STEPS=$max_steps")
  local seconds
  seconds=$(migration_timeout_seconds)
  timeout --signal=TERM "$seconds" "$CONTAINER_CLI" compose "${compose_args[@]}" \
    --profile migration run --rm "${env_args[@]}" migrate
}
fixture_sql() {
  local phase=$1 tenant_id="release006-${run_id}" psql_user psql_db
  psql_user=$(read_env_value "$config_file" POSTGRES_USER)
  psql_db=$(read_env_value "$config_file" POSTGRES_DB)
  compose_rehearsal --profile compose-postgres exec -T postgres psql -v ON_ERROR_STOP=1 -U "$psql_user" -d "$psql_db" -Atqc \
    "SELECT tenant_id || '|' || id::text || '|' || incident_code || '|' || title || '|' || state || '|' || version::text FROM incident.incidents WHERE tenant_id='$tenant_id' AND id='$fixture_incident_id' UNION ALL SELECT tenant_id || '|' || id::text || '|' || source_type || '|' || title || '|' || state || '|' || version::text FROM operations.work_items WHERE tenant_id='$tenant_id' AND id='$fixture_work_item_id' ORDER BY 1"
}
seed_fixture() {
  local tenant_id="release006-${run_id}" psql_user psql_db
  psql_user=$(read_env_value "$config_file" POSTGRES_USER)
  psql_db=$(read_env_value "$config_file" POSTGRES_DB)
  compose_rehearsal --profile compose-postgres exec -T postgres psql -v ON_ERROR_STOP=1 -U "$psql_user" -d "$psql_db" -c \
    "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES('$fixture_user_id','$tenant_id','R6-FIXTURE-USER','release006.fixture','Release 006 Fixture','ACTIVE');
     INSERT INTO incident.incidents(id,tenant_id,incident_code,title,source,priority,state,version,created_at,updated_at) VALUES('$fixture_incident_id','$tenant_id','R6-FIXTURE-INCIDENT','Release 006 representative incident','RELEASE006','P2','DETECTED',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
     INSERT INTO operations.work_items(id,tenant_id,source_type,source_id,title,priority,owner_team_id,state,version,created_at,last_action_at) VALUES('$fixture_work_item_id','$tenant_id','INCIDENT','$fixture_incident_id','Release 006 representative work item','HIGH','RELEASE006','NEW',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');" >/dev/null
}
validate_fixture() {
  local phase=$1 rows hash
  rows=$(fixture_sql "$phase") || return 1
  [[ "$(wc -l <<<"$rows" | tr -d ' ')" == 2 ]] || return 1
  hash=$(printf '%s\n' "$rows" | sha256sum | awk '{print $1}')
  if [[ "$phase" == pre ]]; then fixture_pre_hash=$hash; fixture_pre_state=$rows; fi
  if [[ "$phase" == post ]]; then fixture_post_hash=$hash; fixture_post_state=$rows; fi
}
schema_state() {
  compose_rehearsal --profile migration run --rm --no-deps migrate \
    node dist/database/scripts/applied-schema-revision.js 2>/dev/null
}
full_schema() {
  compose_rehearsal --profile migration run --rm --no-deps migrate \
    node dist/database/scripts/current-schema-revision.js 2>/dev/null \
    | awk '{ sub(/\r$/, "") } /^[[:xdigit:]]{64}$/ { value=$0 } END { if (value != "") print value; else exit 1 }'
}
application_services=(api agent-gateway worker)
start_application_services() {
  application_validation=NOT_RUN
  worker_validation=NOT_RUN
  gateway_validation=NOT_RUN
  compose_rehearsal --profile compose-postgres up -d --wait "${application_services[@]}" || return 1
  compose_rehearsal exec -T api node -e \
    'fetch("http://127.0.0.1:3000/api/v1/health/ready").then(async r=>{const b=await r.text();if(!r.ok||!JSON.parse(b).data||JSON.parse(b).data.status!=="READY")process.exit(1)}).catch(()=>process.exit(1))' || return 1
  application_validation=PASS
  compose_rehearsal exec -T agent-gateway node -e \
    'require("node:https").get({hostname:"127.0.0.1",port:3001,path:"/api/v1/health/ready",rejectUnauthorized:false},r=>process.exit(r.statusCode===200?0:1)).on("error",()=>process.exit(1))' || return 1
  gateway_validation=PASS
  compose_rehearsal exec -T worker node -e \
    'fetch("http://127.0.0.1:3002/api/v1/health/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' || return 1
  worker_validation=PASS
}
stop_application_services() {
  compose_rehearsal stop "${application_services[@]}" >/dev/null || true
}

# Establish and validate the N-1 baseline using a deterministic manifest prefix.
compose_rehearsal down --volumes --remove-orphans >/dev/null
compose_rehearsal --profile compose-postgres up -d --wait postgres || {
  failure_reason=BASELINE_DATABASE_START_FAILED; die "$failure_reason";
}
baseline_start=$(date +%s)
run_migration "$source_steps" || { failure_reason=BASELINE_MIGRATION_FAILED; die "$failure_reason"; }
baseline_state=$(schema_state) || { failure_reason=BASELINE_SCHEMA_STATE_INVALID; die "$failure_reason"; }
[[ "$(jq -r '.schema_revision' <<<"$baseline_state")" == "$source_schema" ]] || {
  failure_reason=INVALID_BASELINE_SCHEMA; die "$failure_reason";
}
source_duration=$(( $(date +%s) - baseline_start ))
matrix_n1_n1=SUPPORTED
lock_result=CONFIGURED
fixture_set_id="release006-representative-${run_id}"
fixture_uuid() {
  local h
  h=$(printf '%s' "$1" | sha256sum | cut -c1-32)
  printf '%s-%s-4%s-8%s-%s' "${h:0:8}" "${h:8:4}" "${h:13:3}" "${h:17:3}" "${h:20:12}"
}
fixture_user_id=$(fixture_uuid "${run_id}-user")
fixture_incident_id=$(fixture_uuid "${run_id}-incident")
fixture_work_item_id=$(fixture_uuid "${run_id}-work")
seed_fixture || { failure_reason=REPRESENTATIVE_FIXTURE_SEED_FAILED; die "$failure_reason"; }
validate_fixture pre || { failure_reason=PRE_MIGRATION_DATA_VALIDATION_FAILED; die "$failure_reason"; }
data_validation=PASS

# Validate the exact N-1 artifact/reference against its own baseline before
# allowing the candidate transition. Rehearsal has no host-published ports;
# probe each service from inside its own isolated project instead.
export APP_IMAGE="$source_image"
start_application_services || {
  failure_reason=INVALID_BASELINE_APPLICATION; die "$failure_reason";
}
stop_application_services

# Evaluate the candidate application against the proven N-1 schema before
# changing the database. This is a real compatibility cell, not an inferred
# result from the migration manifest.
export APP_IMAGE="$target_image"
start_application_services || matrix_n_n1=UNSUPPORTED
if [[ "$matrix_n_n1" != UNSUPPORTED ]]; then matrix_n_n1=SUPPORTED; fi
stop_application_services

# Apply N from the same isolated database and validate the resulting manifest.
export APP_IMAGE="$target_image"
target_start=$(date +%s)
run_migration || { failure_reason=MIGRATION_FAILED; die "$failure_reason"; }
actual_schema=$(full_schema) || { failure_reason=TARGET_SCHEMA_VALIDATION_FAILED; die "$failure_reason"; }
[[ "$actual_schema" == "$target_schema" ]] || { failure_reason=TARGET_SCHEMA_MISMATCH; die "$failure_reason"; }
target_duration=$(( $(date +%s) - target_start ))
validate_fixture post || { failure_reason=POST_MIGRATION_DATA_VALIDATION_FAILED; die "$failure_reason"; }
[[ "$fixture_pre_hash" == "$fixture_post_hash" ]] || { failure_reason=DATA_INTEGRITY_VALIDATION_FAILED; die "$failure_reason"; }

# Evaluate the old application against the migrated schema before starting
# the target application. The result determines rollback mode.
export APP_IMAGE="$source_image"
start_application_services || matrix_n1_n=UNSUPPORTED
if [[ "$matrix_n1_n" != UNSUPPORTED ]]; then matrix_n1_n=SUPPORTED; fi
stop_application_services

export APP_IMAGE="$target_image"
start_application_services || { failure_reason=TARGET_APPLICATION_START_FAILED; die "$failure_reason"; }
matrix_n_n=SUPPORTED
if [[ "$matrix_n1_n" == SUPPORTED ]]; then
  rollback_result=APPLICATION_ROLLBACK_SUPPORTED
elif [[ "$matrix_n1_n" == UNSUPPORTED ]]; then
  rollback_result=FORWARD_FIX_REQUIRED
else
  rollback_result=NOT_DETERMINED
fi
timeout_result=NONE

status=PASS
failure_reason=
maintenance_duration=$(( $(date +%s) - started_epoch ))
trap - EXIT
cleanup 0
