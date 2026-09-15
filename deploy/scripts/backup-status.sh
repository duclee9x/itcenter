#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
[[ $# -eq 2 ]] || die 'USAGE: backup-status.sh <staging|production> <env-file>'
environment=$1; config_file=$2
mount_root=$(read_env_value "$config_file" GUEST_BACKUP_MOUNT)
state_root=$(release_state_root)
latest="$state_root/$environment/backups/LATEST_PROTECTED.json"
now=$(date +%s)
status=UNVERIFIED age_seconds=null backup_id=null completed_at=null
if [[ -r "$latest" ]]; then
  backup_id=$(jq -r '.backup_id' "$latest")
  completed_at=$(jq -r '.completed_at' "$latest")
  if epoch=$(date -d "$completed_at" +%s 2>/dev/null); then
    age_seconds=$((now - epoch))
    (( age_seconds <= 21600 )) && status=MET || status=NOT_MET
  else status=UNVERIFIED; fi
fi
last_rehearsal="$state_root/$environment/rehearsals/LATEST.json"
if [[ -r "$last_rehearsal" ]]; then rehearsal=$(cat "$last_rehearsal"); else rehearsal='null'; fi
jq -n --arg environment "$environment" --arg status "$status" --arg mount "$mount_root" \
  --arg backup_id "${backup_id:-}" --arg completed_at "${completed_at:-}" \
  --argjson age_seconds "$age_seconds" --argjson rehearsal "$rehearsal" \
  '{environment:$environment,rpo:{status:$status,max_age_seconds:21600,latest_backup_id:(if $backup_id=="" then null else $backup_id end),completed_at:(if $completed_at=="" then null else $completed_at end),age_seconds:$age_seconds},rto:(if $rehearsal==null then {status:"UNVERIFIED"} else $rehearsal end),host_protected_mount:$mount}'
