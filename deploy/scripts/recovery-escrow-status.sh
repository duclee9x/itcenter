#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
[[ $# -eq 2 ]] || die 'USAGE: recovery-escrow-status.sh <staging|production> <env-file>'
environment=$1; config_file=$2
missing=()
for key in BACKUP_ESCROW_AGE_IDENTITY_REF BACKUP_ESCROW_AGENT_CA_REF; do
  value=$(read_env_value "$config_file" "$key")
  [[ -n "$value" && "$value" != REPLACE_* ]] || missing+=("$key")
done
if (( ${#missing[@]} > 0 )); then
  jq -n --arg environment "$environment" --argjson missing "$(printf '%s\n' "${missing[@]}" | jq -R . | jq -s .)" '{environment:$environment,status:"RECOVERY_GAP",missing_references:$missing}'
  exit 1
fi
jq -n --arg environment "$environment" '{environment:$environment,status:"REFERENCES_PRESENT",values_not_read:true}'
