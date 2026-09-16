#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

backup_id=''; target='rehearsal'; config_file=''; identity=''; confirm=0; application_validation_script=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) backup_id=${2:?}; shift 2;;
    --target) target=${2:?}; shift 2;;
    --config) config_file=${2:?}; shift 2;;
    --age-identity) identity=${2:?}; shift 2;;
    --application-validation-script) application_validation_script=${2:?}; shift 2;;
    --confirm-production-restore) confirm=1; shift;;
    *) die "UNKNOWN_ARGUMENT_$1";;
  esac
done
[[ -n "$backup_id" && "$backup_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || die BACKUP_ID_REQUIRED
[[ "$target" == rehearsal || "$target" == production ]] || die RESTORE_TARGET_INVALID
[[ "$target" != production || ( $confirm -eq 1 && -n "$config_file" ) ]] || die PRODUCTION_RESTORE_CONFIRMATION_REQUIRED
[[ -r "$config_file" ]] || { [[ "$target" == rehearsal ]] || die CONFIG_FILE_UNAVAILABLE; }
command -v age >/dev/null 2>&1 || die AGE_UNAVAILABLE
command -v sha256sum >/dev/null 2>&1 || die SHA256SUM_UNAVAILABLE
[[ -n "$identity" && -r "$identity" && ! -L "$identity" ]] || die AGE_IDENTITY_REQUIRED
if [[ -n "$application_validation_script" ]]; then
  [[ "$target" == rehearsal && -x "$application_validation_script" && ! -L "$application_validation_script" ]] || die RESTORE_APPLICATION_VALIDATION_SCRIPT_INVALID
fi
identity_mode=$(stat -c '%a' "$identity" 2>/dev/null || stat -f '%Lp' "$identity")
(( (8#$identity_mode & 077) == 0 )) || die AGE_IDENTITY_PERMISSIONS

mount_root=$(read_env_value "$config_file" GUEST_BACKUP_MOUNT)
backup_dir="$mount_root/$(read_env_value "$config_file" APP_ENV)/$backup_id"
[[ -r "$backup_dir/$backup_id.dump.age" && -r "$backup_dir/$backup_id.json" && -r "$backup_dir/$backup_id.sha256" ]] || die BACKUP_NOT_FOUND
(cd "$backup_dir" && sha256sum -c "$backup_id.sha256" >/dev/null 2>&1) || die BACKUP_CHECKSUM_MISMATCH
metadata="$backup_dir/$backup_id.json"
[[ "$(jq -r '.status' "$metadata")" == SUCCESS && "$(jq -r '.protection_state' "$metadata")" == HOST_PROTECTED ]] || die BACKUP_NOT_PROTECTED

make_compose_context "$(read_env_value "$config_file" APP_ENV)" "$config_file" "$(read_env_value "$config_file" APP_IMAGE)"
ensure_container_runtime
state_root=$(release_state_root)
work_root=$(read_env_value "$config_file" LIMA_WORK_DIR)
run_id="restore-$(date -u +%Y%m%dT%H%M%SZ)-$$"
work_dir="$work_root/$run_id"; mkdir -m 700 -p "$work_dir"
plain="$work_dir/$backup_id.dump"
start_ns=$(date +%s%N)
age -d -i "$identity" -o "$plain" "$backup_dir/$backup_id.dump.age" >/dev/null 2>&1 || die BACKUP_DECRYPTION_FAILED
decrypt_ns=$(date +%s%N)
project="itsm-$run_id"
cleanup() {
  status=$?
  if [[ "$target" == rehearsal ]]; then
    "$CONTAINER_CLI" compose --project-name "$project" --env-file "$work_dir/compose.env" \
      -f "$(cd "$(dirname "$0")/.." && pwd)/compose.restore.yaml" down --volumes >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
  exit "$status"
}
trap cleanup EXIT

db_name=itcenter_restore; db_user=itcenter_restore; db_password=$(openssl rand -hex 24)
cat >"$work_dir/compose.env" <<EOF
POSTGRES_IMAGE=$(read_env_value "$config_file" POSTGRES_IMAGE)
RESTORE_POSTGRES_DB=$db_name
RESTORE_POSTGRES_USER=$db_user
RESTORE_POSTGRES_PASSWORD=$db_password
EOF
chmod 600 "$work_dir/compose.env"
restore_compose=("$CONTAINER_CLI" compose --project-name "$project" --env-file "$work_dir/compose.env" -f "$(cd "$(dirname "$0")/.." && pwd)/compose.restore.yaml")
if [[ "$target" == rehearsal ]]; then
  "${restore_compose[@]}" up -d --wait postgres >/dev/null || die RESTORE_DATABASE_START_FAILED
  pg_restore_ns_start=$(date +%s%N)
  "${restore_compose[@]}" exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <"$plain" >/dev/null || die PG_RESTORE_FAILED
  pg_restore_ns_end=$(date +%s%N)
  app_image=$(jq -r '.application_image_digest // empty' "$metadata")
  [[ "$app_image" =~ @sha256:[a-f0-9]{64}$ ]] || app_image=$(read_env_value "$config_file" APP_IMAGE)
  schema=$("$CONTAINER_CLI" run --rm --network "${project}_restore" \
    -e APP_ENV=staging -e AUTH_MODE=unavailable \
    -e DATABASE_SECRET_REF=env:DATABASE_URL \
    -e DATABASE_URL="postgresql://$db_user:$db_password@postgres:5432/$db_name" \
    "$app_image" node dist/database/scripts/current-schema-revision.js 2>/dev/null) || die RESTORED_SCHEMA_VALIDATION_FAILED
  [[ "$schema" == "$(jq -r '.schema_revision' "$metadata")" ]] || die RESTORED_SCHEMA_MISMATCH
  application_validation=NOT_RUN
  if [[ -n "$application_validation_script" ]]; then
    RESTORE_COMPOSE_PROJECT="$project" RESTORE_APP_IMAGE="$app_image" \
      RESTORE_SCHEMA_REVISION="$(jq -r '.schema_revision' "$metadata")" \
      RESTORE_BACKUP_ID="$backup_id" \
      "$application_validation_script" || die RESTORE_APPLICATION_VALIDATION_FAILED
    application_validation=PASS
  fi
  result=MET; total_ns=$(( $(date +%s%N) - start_ns ))
  result_status=UNVERIFIED
  [[ "$application_validation" == PASS && $total_ns -le 7200000000000 ]] && result_status=MET || result_status=UNVERIFIED
  evidence="$state_root/$(read_env_value "$config_file" APP_ENV)/rehearsals"
  mkdir -p "$evidence"
  jq -n --arg rehearsal_id "$run_id" --arg backup_id "$backup_id" \
    --arg started_at "$(date -u -d "@$((start_ns/1000000000))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg schema_revision "$(jq -r '.schema_revision' "$metadata")" \
    --arg result "$result" --arg rto_status "$result_status" --argjson total_ns "$total_ns" \
    --arg application_validation "$application_validation" \
    '{rehearsal_id:$rehearsal_id,backup_id:$backup_id,started_at:$started_at,completed_at:$completed_at,schema_revision:$schema_revision,result:$result,rto_status:$rto_status,application_validation:$application_validation,total_duration_ns:$total_ns}' >"$evidence/$run_id.json"
  cp "$evidence/$run_id.json" "$evidence/LATEST.json"
  printf 'RESTORE_REHEARSAL_SUCCEEDED %s %s %s\n' "$run_id" "$result_status" "$evidence/$run_id.json"
else
  db_url_file=$(read_env_value "$config_file" DATABASE_URL_FILE)
  [[ -r "$db_url_file" && ! -L "$db_url_file" ]] || die DATABASE_SECRET_UNAVAILABLE
  db_url=$(cat "$db_url_file")
  if [[ "$(read_env_value "$config_file" DB_MODE)" == compose ]]; then
    compose --profile compose-postgres exec -T postgres sh -c 'pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <"$plain" >/dev/null || die PRODUCTION_PG_RESTORE_FAILED
  else
    "$CONTAINER_CLI" run --rm --network host --entrypoint sh \
      -e DATABASE_URL="$db_url" "$(read_env_value "$config_file" POSTGRES_IMAGE)" \
      -c 'pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL"' <"$plain" >/dev/null || die PRODUCTION_PG_RESTORE_FAILED
  fi
  printf 'PRODUCTION_RESTORE_SUCCEEDED %s\n' "$backup_id"
fi
