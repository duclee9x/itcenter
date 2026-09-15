#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
[[ $# -eq 2 ]] || die 'USAGE: retention.sh <staging|production> <env-file>'
environment=$1; config_file=$2
root="$(read_env_value "$config_file" GUEST_BACKUP_MOUNT)/$environment"
[[ -d "$root" ]] || exit 0
keep_file=$(mktemp); weeks_file=$(mktemp); cleanup_files() { rm -f "$keep_file" "$weeks_file"; }; trap cleanup_files EXIT
records=$(find "$root" -mindepth 2 -maxdepth 2 -type f -name '*.json' -print0 |
  xargs -0 -r -n1 sh -c 'jq -r "select(.status==\"SUCCESS\" and .backup_type==\"scheduled\") | [.completed_at,.backup_id] | @tsv" "$1"' sh |
  sort -r)
index=0
while IFS=$'\t' read -r completed id; do
  [[ -n "$id" ]] || continue
  if (( index < 28 )); then printf '%s\n' "$id" >>"$keep_file"; fi
  week=$(date -u -d "$completed" +%G-W%V 2>/dev/null || printf '%s' "${completed:0:10}")
  week_count=$(wc -l <"$weeks_file")
  if ! grep -Fqx "$week" "$weeks_file" && (( week_count < 4 )); then
    printf '%s\n' "$week" >>"$weeks_file"; printf '%s\n' "$id" >>"$keep_file"
  fi
  index=$((index + 1))
done <<<"$records"
latest=$(jq -r '.backup_id // empty' "$(release_state_root)/$environment/backups/LATEST_PROTECTED.json" 2>/dev/null || true)
for metadata in "$root"/*/*.json; do
  [[ -f "$metadata" ]] || continue
  id=$(jq -r '.backup_id // empty' "$metadata" 2>/dev/null || true)
  [[ -n "$id" ]] || continue
  grep -Fqx "$id" "$keep_file" && continue
  [[ "$id" == "$latest" ]] && continue
  [[ -f "$(dirname "$metadata")/.operator_hold" || -f "$(dirname "$metadata")/.active_rehearsal" ]] && continue
  [[ "$(jq -r '.backup_type // empty' "$metadata")" == scheduled ]] || continue
  rm -rf "$(dirname "$metadata")"
done
