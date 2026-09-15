#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
[[ $# -eq 4 ]] || die 'USAGE: hold-backup.sh <staging|production> <env-file> <backup-id> <hold|release>'
environment=$1; config_file=$2; backup_id=$3; action=$4
[[ "$action" == hold || "$action" == release ]] || die HOLD_ACTION_INVALID
mount_root=$(read_env_value "$config_file" GUEST_BACKUP_MOUNT)
dir="$mount_root/$environment/$backup_id"
[[ -d "$dir" && -f "$dir/$backup_id.json" ]] || die BACKUP_NOT_FOUND
if [[ "$action" == hold ]]; then printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$dir/.operator_hold"; else rm -f "$dir/.operator_hold"; fi
printf 'BACKUP_HOLD_%s %s\n' "${action^^}" "$backup_id"
