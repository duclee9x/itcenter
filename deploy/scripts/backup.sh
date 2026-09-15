#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

usage() {
  printf 'USAGE: backup.sh <staging|production> <env-file> [--reason scheduled|pre-migration|manual]\n' >&2
  exit 2
}

[[ $# -ge 2 && $# -le 4 ]] || usage
environment=$1
config_file=$2
reason=manual
if [[ ${3:-} == --reason && -n ${4:-} ]]; then reason=$4; fi
[[ "$reason" == scheduled || "$reason" == pre-migration || "$reason" == manual ]] || die BACKUP_REASON_INVALID
[[ -r "$config_file" ]] || die CONFIG_FILE_UNAVAILABLE

value() { read_env_value "$config_file" "$1"; }
require_value() { [[ -n "$(value "$1")" ]] || die "CONFIG_MISSING_$1"; }
for key in GUEST_BACKUP_MOUNT LIMA_WORK_DIR BACKUP_AGE_RECIPIENT POSTGRES_IMAGE \
  DATABASE_URL_FILE POSTGRES_MAJOR_VERSION BACKUP_MOUNT_FSTYPES APP_IMAGE; do require_value "$key"; done
verify_image_digest "$(value APP_IMAGE)"
[[ "$environment" == staging || "$environment" == production ]] || die INVALID_ENVIRONMENT
[[ "$reason" != pre-migration || "$environment" == production ]] || die PRE_MIGRATION_PRODUCTION_ONLY
[[ "$(value POSTGRES_IMAGE)" =~ @sha256:[a-f0-9]{64}$ ]] || die IMMUTABLE_INFRA_IMAGE_REQUIRED
[[ "$(value BACKUP_AGE_RECIPIENT)" != REPLACE_* ]] || die BACKUP_AGE_RECIPIENT_REQUIRED

command -v age >/dev/null 2>&1 || die AGE_UNAVAILABLE
command -v sha256sum >/dev/null 2>&1 || die SHA256SUM_UNAVAILABLE
command -v findmnt >/dev/null 2>&1 || die FINDMNT_UNAVAILABLE
command -v flock >/dev/null 2>&1 || die FLOCK_UNAVAILABLE

make_compose_context "$environment" "$config_file" "$(value APP_IMAGE)"
ensure_container_runtime

mount_root=$(value GUEST_BACKUP_MOUNT)
work_root=$(value LIMA_WORK_DIR)
[[ "$mount_root" = /* && "$work_root" = /* ]] || die BACKUP_PATH_INVALID
mkdir -p "$work_root"
chmod 700 "$work_root"
[[ -d "$mount_root" ]] || die HOST_PROTECTED_MOUNT_UNAVAILABLE
mount_info=$(findmnt -T "$mount_root" -n -o TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null || true)
[[ -n "$mount_info" ]] || die HOST_PROTECTED_MOUNT_UNAVAILABLE
mount_target=$(awk '{print $1}' <<<"$mount_info")
mount_source=$(awk '{print $2}' <<<"$mount_info")
mount_fstype=$(awk '{print $3}' <<<"$mount_info")
[[ "$mount_target" != / && "$mount_source" != overlay && "$mount_fstype" != overlay ]] || die HOST_PROTECTED_MOUNT_UNAVAILABLE
case ",$(value BACKUP_MOUNT_FSTYPES)," in *",$mount_fstype,"*) ;; *) die HOST_PROTECTED_MOUNT_UNAVAILABLE ;; esac
write_probe="$mount_root/.itcenter-backup-write-test.$$"
if ! (umask 077; : >"$write_probe") 2>/dev/null; then die HOST_PROTECTED_MOUNT_UNAVAILABLE; fi
rm -f "$write_probe"

state_root=$(release_state_root)
backup_root="$mount_root/$environment"
mkdir -p "$backup_root"
lock_root="${BACKUP_LOCK_ROOT:-${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}/itcenter/locks}"
mkdir -p "$lock_root"
exec 8>"$lock_root/itcenter-${environment}.backup.lock"
flock -n 8 || die BACKUP_ALREADY_IN_PROGRESS

backup_id="${environment}-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM-$$"
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
work_dir="$work_root/$backup_id"
mkdir -m 700 "$work_dir"
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

db_url_file=$(value DATABASE_URL_FILE)
[[ -r "$db_url_file" && ! -L "$db_url_file" ]] || die DATABASE_SECRET_UNAVAILABLE
db_url=$(cat "$db_url_file")
[[ "$db_url" == postgres://* || "$db_url" == postgresql://* ]] || die DATABASE_URL_INVALID

schema_revision=${BACKUP_SCHEMA_REVISION:-}
if [[ -z "$schema_revision" ]]; then
  schema_revision=$(compose --profile migration run --rm --no-deps migrate \
    node dist/database/scripts/current-schema-revision.js 2>/dev/null) || die SCHEMA_REVISION_UNAVAILABLE
  schema_revision=$(tr -d '[:space:]' <<<"$schema_revision")
fi
[[ "$schema_revision" =~ ^[a-fA-F0-9]{64}$ ]] || die SCHEMA_REVISION_INVALID

release_id=${BACKUP_RELEASE_ID:-unknown}
source_commit=${BACKUP_SOURCE_COMMIT:-unknown}
image_digest=${BACKUP_IMAGE_DIGEST:-$(value APP_IMAGE)}
release_state_file="$state_root/$environment/CURRENT.json"
if [[ "$release_id" == unknown && -r "$release_state_file" ]]; then release_id=$(jq -r '.release_id // "unknown"' "$release_state_file"); fi
if [[ "$source_commit" == unknown && -r "$release_state_file" ]]; then source_commit=$(jq -r '.source_commit // "unknown"' "$release_state_file"); fi
if [[ "$image_digest" == "$(value APP_IMAGE)" && -r "$release_state_file" ]]; then image_digest=$(jq -r '.image // empty' "$release_state_file" || true); fi

plain="$work_dir/$backup_id.dump"
encrypted="$work_dir/$backup_id.dump.age"
dump_log="$work_dir/pg_dump.stderr"
if [[ "$(value DB_MODE)" == compose ]]; then
  compose --profile compose-postgres run --rm --no-deps -e DATABASE_URL="$db_url" \
    --entrypoint sh postgres -c 'pg_dump -Fc "$DATABASE_URL"' >"$plain" 2>"$dump_log" || die PG_DUMP_FAILED
else
  "$CONTAINER_CLI" run --rm --network host --entrypoint sh \
    -e DATABASE_URL="$db_url" "$(value POSTGRES_IMAGE)" \
    -c 'pg_dump -Fc "$DATABASE_URL"' >"$plain" 2>"$dump_log" || die PG_DUMP_FAILED
fi
[[ -s "$plain" ]] || die PG_DUMP_EMPTY
original_size=$(stat -c '%s' "$plain" 2>/dev/null || stat -f '%z' "$plain")

age -r "$(value BACKUP_AGE_RECIPIENT)" -o "$encrypted" "$plain" >/dev/null 2>"$work_dir/age.stderr" || die BACKUP_ENCRYPTION_FAILED
[[ -s "$encrypted" ]] || die BACKUP_ENCRYPTED_EMPTY
rm -f "$plain"

checksum=$(sha256sum "$encrypted" | awk '{print $1}')
[[ "$checksum" =~ ^[a-fA-F0-9]{64}$ ]] || die BACKUP_CHECKSUM_FAILED
printf '%s  %s\n' "$checksum" "$backup_id.dump.age" >"$work_dir/$backup_id.sha256"
encrypted_size=$(stat -c '%s' "$encrypted" 2>/dev/null || stat -f '%z' "$encrypted")
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
metadata="$work_dir/$backup_id.json"
jq -n \
  --arg backup_id "$backup_id" --arg environment "$environment" --arg backup_type "$reason" \
  --arg postgres_major_version "$(value POSTGRES_MAJOR_VERSION)" --arg schema_revision "$schema_revision" \
  --arg release_id "$release_id" --arg source_commit "$source_commit" --arg application_image_digest "$image_digest" \
  --arg started_at "$started_at" --arg completed_at "$completed_at" --arg original_size "$original_size" \
  --arg encrypted_size "$encrypted_size" --arg checksum_algorithm SHA-256 --arg checksum "$checksum" \
  --arg lima_local "$work_dir/$backup_id.dump.age" --arg host_protected "$backup_root/$backup_id/$backup_id.dump.age" \
  '{backup_id:$backup_id,environment:$environment,backup_type:$backup_type,postgres_major_version:$postgres_major_version,
    schema_revision:$schema_revision,release_id:$release_id,source_commit:$source_commit,
    application_image_digest:$application_image_digest,started_at:$started_at,completed_at:$completed_at,
    original_size:($original_size|tonumber),encrypted_size:($encrypted_size|tonumber),checksum_algorithm:$checksum_algorithm,
    checksum:$checksum,storage_locations:{LIMA_LOCAL:$lima_local,HOST_PROTECTED:$host_protected},
    protection_state:"LIMA_LOCAL",verification_state:"UNVERIFIED",status:"CREATING"}' >"$metadata"

destination="$backup_root/$backup_id"
destination_tmp="$backup_root/.incomplete-$backup_id-$$"
rm -rf "$destination_tmp"
mkdir -m 700 "$destination_tmp"
cp "$encrypted" "$destination_tmp/$backup_id.dump.age"
cp "$work_dir/$backup_id.sha256" "$destination_tmp/$backup_id.sha256"
(cd "$destination_tmp" && sha256sum -c "$backup_id.sha256" >/dev/null 2>&1) || die HOST_COPY_CHECKSUM_MISMATCH
jq --arg state HOST_PROTECTED --arg verification VERIFIED_COPY \
  '.protection_state=$state | .verification_state=$verification | .status="SUCCESS"' "$metadata" >"$destination_tmp/$backup_id.json.tmp"
mv "$destination_tmp/$backup_id.json.tmp" "$destination_tmp/$backup_id.json"
mv "$destination_tmp" "$destination"

mkdir -p "$state_root/$environment/backups"
jq --arg id "$backup_id" --arg completed_at "$completed_at" --arg checksum "$checksum" \
  --arg schema_revision "$schema_revision" --arg path "$destination/$backup_id.json" \
  '{backup_id:$id,completed_at:$completed_at,checksum:$checksum,schema_revision:$schema_revision,metadata:$path}' \
  >"$state_root/$environment/backups/LATEST_PROTECTED.json.tmp"
chmod 600 "$state_root/$environment/backups/LATEST_PROTECTED.json.tmp"
mv -f "$state_root/$environment/backups/LATEST_PROTECTED.json.tmp" "$state_root/$environment/backups/LATEST_PROTECTED.json"

if ! "$(dirname "$0")/retention.sh" "$environment" "$config_file"; then
  printf 'RETENTION_FAILED %s\n' "$backup_id" >&2
fi

printf 'BACKUP_SUCCEEDED %s %s %s\n' "$environment" "$backup_id" "$destination"
