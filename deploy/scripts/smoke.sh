#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

[[ $# -eq 3 || $# -eq 4 ]] || die "USAGE: smoke.sh <staging|production> <env-file> <image@sha256:digest> [expected-commit]"
environment=$1
config_file=$2
image=$3
expected_commit=${4:-$(read_env_value "$config_file" GIT_COMMIT)}
verify_image_digest "$image"
make_compose_context "$environment" "$config_file" "$image"

api_url=$(read_env_value "$config_file" API_HEALTH_URL)
api_resolve=$(read_env_value "$config_file" API_HEALTH_RESOLVE)
gateway_url=$(read_env_value "$config_file" AGENT_GATEWAY_HEALTH_URL)
gateway_resolve=$(read_env_value "$config_file" AGENT_GATEWAY_HEALTH_RESOLVE)
gateway_ca=$(read_env_value "$config_file" AGENT_GATEWAY_HEALTH_CA_FILE)
[[ -n "$api_url" && -n "$api_resolve" && -n "$gateway_url" && -n "$gateway_resolve" && -r "$gateway_ca" ]] || die HEALTH_CONFIG_INVALID

api_body=$(curl --fail --silent --show-error --max-time 5 --resolve "$api_resolve" "$api_url") || die API_READINESS_FAILED
printf '%s' "$api_body" | jq -e '.data.status == "READY" and .data.profile == "API"' >/dev/null || die API_NOT_READY

gateway_body=$(curl --fail --silent --show-error --max-time 5 --cacert "$gateway_ca" --resolve "$gateway_resolve" "$gateway_url") || die AGENT_GATEWAY_READINESS_FAILED
printf '%s' "$gateway_body" | jq -e '.data.status == "READY" and .data.profile == "AGENT_GATEWAY"' >/dev/null || die AGENT_GATEWAY_NOT_READY

worker_body=$(compose exec -T worker node -e \
  'fetch("http://127.0.0.1:3002/api/v1/health/ready").then(async r=>{process.stdout.write(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))') || die WORKER_READINESS_FAILED
printf '%s' "$worker_body" | jq -e '.data.status == "READY" and .data.profile == "WORKER"' >/dev/null || die WORKER_NOT_READY

token_file=$(read_env_value "$config_file" SMOKE_BEARER_TOKEN_FILE)
if [[ -n "$token_file" ]]; then
  tenant=$(read_env_value "$config_file" SMOKE_TENANT_ID)
  protected_url=$(read_env_value "$config_file" SMOKE_PROTECTED_URL)
  [[ -r "$token_file" && -n "$tenant" && -n "$protected_url" ]] || die PROTECTED_SMOKE_CONFIG_INVALID
  [[ "$tenant" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || die PROTECTED_SMOKE_CONFIG_INVALID
  api_origin=$(printf '%s' "$api_url" | sed -E 's#^(https?://[^/]+).*$#\1#')
  [[ "$protected_url" == "$api_origin/api/v1/"* ]] || die PROTECTED_SMOKE_ORIGIN_MISMATCH
  temp_config=$(mktemp)
  chmod 600 "$temp_config"
  trap 'rm -f "$temp_config"' EXIT
  jq -nr --rawfile token "$token_file" \
    '"header = " + (("Authorization: Bearer " + ($token | rtrimstr("\n"))) | @json)' >"$temp_config"
  protected_body=$(curl --fail --silent --show-error --max-time 10 \
    --config "$temp_config" -H "X-Tenant-ID: $tenant" "$protected_url") || die PROTECTED_API_SMOKE_FAILED
  printf '%s' "$protected_body" | jq -e \
    --arg commit "$expected_commit" \
    --arg digest "${image##*@}" \
    '.data.build.source_commit == $commit and .data.build.image_digest == $digest' >/dev/null || die BUILD_IDENTITY_MISMATCH
  rm -f "$temp_config"
  trap - EXIT
fi

agent_smoke_cert=$(read_env_value "$config_file" AGENT_MTLS_SMOKE_CERT_FILE)
agent_smoke_key=$(read_env_value "$config_file" AGENT_MTLS_SMOKE_KEY_FILE)
if [[ -n "$agent_smoke_cert" || -n "$agent_smoke_key" ]]; then
  [[ -r "$agent_smoke_cert" && -r "$agent_smoke_key" ]] || die AGENT_MTLS_SMOKE_CONFIG_INVALID
  agent_probe_url=${AGENT_MTLS_SMOKE_URL:-$(read_env_value "$config_file" AGENT_MTLS_SMOKE_URL)}
  [[ -n "$agent_probe_url" && "$agent_probe_url" == https://*"/api/v1/agent/"* ]] || die AGENT_MTLS_SMOKE_CONFIG_INVALID
  agent_status=$(curl --silent --show-error --max-time 10 \
    --cacert "$gateway_ca" --cert "$agent_smoke_cert" --key "$agent_smoke_key" \
    --resolve "$gateway_resolve" --output /dev/null --write-out '%{http_code}' \
    "$agent_probe_url") || die AGENT_MTLS_AUTHENTICATION_FAILED
  [[ "$agent_status" == 404 ]] || die AGENT_MTLS_AUTHENTICATION_FAILED
fi
printf 'SMOKE_READY %s\n' "$environment"
