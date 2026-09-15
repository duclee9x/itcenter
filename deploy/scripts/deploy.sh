#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

[[ $# -eq 4 || $# -eq 5 ]] || die "USAGE: deploy.sh <staging|production> <image@sha256:digest> <env-file> <rc-json> [staging-attestation]"
environment=$1
image=$2
config_file=$3
rc_file=$4
staging_attestation=${5:-}
verify_image_digest "$image"
[[ -r "$rc_file" ]] || die RELEASE_METADATA_UNAVAILABLE
release_id=$(jq -er '.release_id | strings' "$rc_file") || die RELEASE_METADATA_INVALID
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || die RELEASE_ID_INVALID
verify_rc_metadata "$rc_file" "$release_id" "$image"
"$(dirname "$0")/verify-config.sh" "$environment" "$config_file" >/dev/null

source_commit=$(jq -r '.source_commit' "$rc_file")
schema_revision=$(jq -r '.schema_revision' "$rc_file")
app_version=$(jq -r '.application_version' "$rc_file")
build_time=$(jq -r '.build_time' "$rc_file")
config_rev=$(config_revision "$config_file")
make_compose_context "$environment" "$config_file" "$image"
export GIT_COMMIT=$source_commit APP_VERSION=$app_version BUILD_TIME=$build_time
acquire_deployment_lock "$environment"
ensure_container_runtime

state_root=$(release_state_root)
failure_reason=DEPLOYMENT_FAILED
on_exit() {
  local result=$?
  if (( result != 0 )); then
    write_event "$environment" "$release_id" FAILED "$failure_reason" "$image" \
      "$source_commit" "$schema_revision" "$config_rev" || true
  fi
}
trap on_exit EXIT

if [[ "$environment" == production ]]; then
  [[ -n "$staging_attestation" ]] || staging_attestation="$state_root/staging/attestations/$release_id.json"
  [[ -r "$staging_attestation" ]] || die STAGING_VERIFICATION_REQUIRED
  jq -e --arg id "$release_id" --arg image "$image" \
    --arg commit "$source_commit" --arg schema "$schema_revision" \
    '.release_id==$id and .image==$image and .source_commit==$commit and
     .schema_revision==$schema and .status=="VERIFIED" and
     (.evidence_sha256|test("^[a-fA-F0-9]{64}$")) and
     (.evidence_refs["RELEASE-001"]|type)=="string" and
     (.evidence_refs["RELEASE-002"]|type)=="string" and
     (.evidence_refs["RELEASE-003"]|type)=="string"' \
    "$staging_attestation" >/dev/null || die STAGING_VERIFICATION_MISMATCH
  approval_ref=$(read_env_value "$config_file" PRODUCTION_APPROVAL_REF)
else
  backup_ref=""
  approval_ref=""
fi

compose config --quiet || { failure_reason=COMPOSE_CONFIG_INVALID; die "$failure_reason"; }
compose pull || { failure_reason=IMAGE_PULL_FAILED; die "$failure_reason"; }
write_event "$environment" "$release_id" PENDING DEPLOYMENT_STARTED "$image" \
  "$source_commit" "$schema_revision" "$config_rev"

if [[ "$(read_env_value "$config_file" DB_MODE)" == compose ]]; then
  compose --profile compose-postgres up -d --wait postgres || {
    failure_reason=DATABASE_START_FAILED
    die "$failure_reason"
  }
fi

if [[ "$environment" == production ]]; then
  export BACKUP_RELEASE_ID="$release_id" BACKUP_SOURCE_COMMIT="$source_commit" \
    BACKUP_IMAGE_DIGEST="$image"
  backup_output=$(mktemp)
  if ! "$DEPLOY_ROOT/scripts/backup.sh" production "$config_file" --reason pre-migration >"$backup_output" 2>&1; then
    rm -f "$backup_output"
    failure_reason=PRE_MIGRATION_BACKUP_FAILED
    die "$failure_reason"
  fi
  backup_ref=$(awk '$1=="BACKUP_SUCCEEDED" {print $3}' "$backup_output")
  rm -f "$backup_output"
  [[ -n "$backup_ref" ]] || { failure_reason=PRE_MIGRATION_BACKUP_FAILED; die "$failure_reason"; }
fi

compose --profile migration run --rm migrate || {
  failure_reason=MIGRATION_FAILED
  die "$failure_reason"
}
compose up -d --wait --remove-orphans api agent-gateway worker caddy || {
  failure_reason=SERVICE_START_FAILED
  die "$failure_reason"
}

timeout_seconds=$(read_env_value "$config_file" SMOKE_TIMEOUT_SECONDS)
[[ "$timeout_seconds" =~ ^[0-9]+$ ]] && (( timeout_seconds >= 1 && timeout_seconds <= 900 )) || {
  failure_reason=READINESS_TIMEOUT_CONFIG_INVALID
  die "$failure_reason"
}
deadline=$((SECONDS + timeout_seconds))
smoke_output=$(mktemp)
while ! "$DEPLOY_ROOT/scripts/smoke.sh" "$environment" "$config_file" "$image" "$source_commit" >"$smoke_output" 2>&1; do
  if (( SECONDS >= deadline )); then
    rm -f "$smoke_output"
    failure_reason=READINESS_OR_SMOKE_TIMEOUT
    die "$failure_reason"
  fi
  sleep 5
done
rm -f "$smoke_output"

write_json_atomic "$state_root/$environment/$release_id.json" \
  --arg environment "$environment" --arg release_id "$release_id" \
  --arg image "$image" --arg source_commit "$source_commit" \
  --arg application_version "$app_version" --arg build_time "$build_time" \
  --arg schema_revision "$schema_revision" --arg config_revision "$config_rev" \
  --arg config_file "$COMPOSE_ENV_FILE" --arg actor "${SUDO_USER:-$(id -un)}" \
  --arg approval_ref "$approval_ref" --arg backup_ref "$backup_ref" \
  --arg deployed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{environment:$environment,release_id:$release_id,status:"DEPLOYED",
    image:$image,source_commit:$source_commit,application_version:$application_version,
    build_time:$build_time,schema_revision:$schema_revision,
    config_revision:$config_revision,config_file:$config_file,actor:$actor,
    approval_ref:$approval_ref,pre_migration_backup_ref:$backup_ref,
    deployed_at:$deployed_at}'
write_json_atomic "$state_root/$environment/CURRENT.json" \
  --arg release_id "$release_id" --arg image "$image" \
  --arg source_commit "$source_commit" --arg application_version "$app_version" \
  --arg build_time "$build_time" --arg schema_revision "$schema_revision" \
  --arg config_revision "$config_rev" --arg config_file "$COMPOSE_ENV_FILE" \
  --arg deployed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{release_id:$release_id,image:$image,source_commit:$source_commit,
    application_version:$application_version,build_time:$build_time,
    schema_revision:$schema_revision,config_revision:$config_revision,
    config_file:$config_file,deployed_at:$deployed_at}'
write_event "$environment" "$release_id" SUCCEEDED DEPLOYMENT_VERIFIED "$image" \
  "$source_commit" "$schema_revision" "$config_rev"

if [[ "$environment" == staging ]]; then
  write_json_atomic "$state_root/staging/$release_id.json" \
    --arg release_id "$release_id" --arg image "$image" \
    --arg source_commit "$source_commit" --arg schema_revision "$schema_revision" \
    --arg config_revision "$config_rev" --arg verified_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg actor "${SUDO_USER:-$(id -un)}" \
    '{release_id:$release_id,image:$image,source_commit:$source_commit,
      schema_revision:$schema_revision,config_revision:$config_revision,
      status:"SMOKE_PASSED",actor:$actor,smoke_completed_at:$verified_at}'
else
  cp "$state_root/production/CURRENT.json" "$state_root/production/LAST_KNOWN_GOOD.json.tmp.$$"
  chmod 600 "$state_root/production/LAST_KNOWN_GOOD.json.tmp.$$"
  mv -f "$state_root/production/LAST_KNOWN_GOOD.json.tmp.$$" "$state_root/production/LAST_KNOWN_GOOD.json"
fi
trap - EXIT
printf 'DEPLOYMENT_SUCCEEDED %s %s\n' "$environment" "$release_id"
