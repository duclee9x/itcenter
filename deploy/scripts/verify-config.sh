#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

[[ $# -eq 2 ]] || die "USAGE: verify-config.sh <staging|production> <env-file>"
environment=$1
config_file=$2
[[ -r "$config_file" ]] || die CONFIG_FILE_UNAVAILABLE

expected_project=itsm-staging
[[ "$environment" == production ]] && expected_project=itsm-production
[[ "$environment" == staging || "$environment" == production ]] || die INVALID_ENVIRONMENT

value() { read_env_value "$config_file" "$1"; }
require_value() { [[ -n "$(value "$1")" ]] || die "CONFIG_MISSING_$1"; }
secure_file() {
  local file=$1 allow_empty=${2:-false} mode
  [[ -f "$file" && -r "$file" && ! -L "$file" ]] || die SECRET_FILE_UNAVAILABLE
  if mode=$(stat -c '%a' "$file" 2>/dev/null); then :; else mode=$(stat -f '%Lp' "$file" 2>/dev/null) || die SECRET_FILE_UNAVAILABLE; fi
  (( (8#$mode & 077) == 0 )) || die SECRET_FILE_PERMISSIONS
  [[ "$allow_empty" == true || -s "$file" ]] || die SECRET_FILE_EMPTY
}

[[ "$(value COMPOSE_PROJECT_NAME)" == "$expected_project" ]] || die COMPOSE_PROJECT_MISMATCH
[[ "$(value APP_ENV)" == "$environment" ]] || die APP_ENV_MISMATCH
[[ "$(value AUTH_MODE)" == oidc ]] || die OIDC_AUTH_REQUIRED
[[ "$(value AGENT_AUTH_MODE)" == mtls ]] || die AGENT_MTLS_REQUIRED
[[ "$(value DB_MODE)" == external || "$(value DB_MODE)" == compose ]] || die DB_MODE_INVALID

for key in APP_IMAGE POSTGRES_IMAGE CADDY_IMAGE APP_VERSION GIT_COMMIT BUILD_TIME RUNTIME_ENV_FILE DATABASE_URL_FILE \
  POSTGRES_PASSWORD_FILE AGENT_TLS_CERT_FILE AGENT_TLS_KEY_FILE AGENT_CA_CERT_FILE \
  AGENT_GATEWAY_HEALTH_CA_FILE AGENT_CA_SIGNING_KEY_FILE AGENT_CA_SIGNING_PASSPHRASE_FILE API_TLS_CERT_FILE \
  API_TLS_KEY_FILE OIDC_ISSUER OIDC_AUDIENCE AGENT_HOST_PORT API_HOSTNAME \
  API_HEALTH_URL API_HEALTH_RESOLVE AGENT_GATEWAY_HOSTNAME \
  AGENT_GATEWAY_HEALTH_URL AGENT_GATEWAY_HEALTH_RESOLVE; do
  require_value "$key"
done
[[ "$(value OIDC_ISSUER)" == https://* && -n "$(value OIDC_AUDIENCE)" ]] || die OIDC_CONFIG_INVALID
for key in OIDC_ISSUER API_HOSTNAME AGENT_GATEWAY_HOSTNAME API_HEALTH_URL \
  API_HEALTH_RESOLVE AGENT_GATEWAY_HEALTH_URL AGENT_GATEWAY_HEALTH_RESOLVE; do
  [[ "$(value "$key")" != *example.invalid* && "$(value "$key")" != *REPLACE_* ]] || die CONFIG_TEMPLATE_VALUE
done
[[ "$(value APP_IMAGE)" =~ @sha256:[a-f0-9]{64}$ ]] || die IMMUTABLE_IMAGE_DIGEST_REQUIRED
[[ "$(value POSTGRES_IMAGE)" =~ @sha256:[a-f0-9]{64}$ && "$(value CADDY_IMAGE)" =~ @sha256:[a-f0-9]{64}$ ]] || die IMMUTABLE_INFRA_IMAGE_REQUIRED
timeout_seconds=$(value SMOKE_TIMEOUT_SECONDS)
[[ "$timeout_seconds" =~ ^[0-9]+$ ]] && (( timeout_seconds >= 1 && timeout_seconds <= 900 )) || die READINESS_TIMEOUT_CONFIG_INVALID
api_origin="https://$(value API_HOSTNAME)"
gateway_origin="https://$(value AGENT_GATEWAY_HOSTNAME)"
api_health_url=$(value API_HEALTH_URL)
gateway_health_url=$(value AGENT_GATEWAY_HEALTH_URL)
[[ ( "$api_health_url" == "$api_origin:"* || "$api_health_url" == "$api_origin/"* ) &&
   "$(value API_HEALTH_RESOLVE)" == "$(value API_HOSTNAME):"* &&
   ( "$gateway_health_url" == "$gateway_origin:"* || "$gateway_health_url" == "$gateway_origin/"* ) &&
   "$(value AGENT_GATEWAY_HEALTH_RESOLVE)" == "$(value AGENT_GATEWAY_HOSTNAME):"* ]] || die HEALTH_CONFIG_INVALID

runtime_file=$(value RUNTIME_ENV_FILE)
secure_file "$runtime_file"
for expected in "APP_ENV=$environment" "AUTH_MODE=oidc" "AGENT_AUTH_MODE=mtls" \
  "DATABASE_SECRET_REF=file:/run/secrets/database_url" \
  "AGENT_TLS_CERT_REF=file:/run/secrets/agent_tls_cert" \
  "AGENT_TLS_KEY_REF=file:/run/secrets/agent_tls_key" \
  "AGENT_CA_CERT_REF=file:/run/secrets/agent_ca_certificate" \
  "AGENT_CA_SIGNING_KEY_REF=file:/run/secrets/agent_ca_signing_key"; do
  grep -Fqx "$expected" "$runtime_file" || die RUNTIME_SECURITY_CONFIG_INVALID
done
grep -Fq "OIDC_ISSUER=https://" "$runtime_file" || die OIDC_CONFIG_INVALID
grep -Eq '^OIDC_AUDIENCE=.+$' "$runtime_file" || die OIDC_CONFIG_INVALID
grep -Fqx "OIDC_ISSUER=$(value OIDC_ISSUER)" "$runtime_file" || die OIDC_CONFIG_MISMATCH
grep -Fqx "OIDC_AUDIENCE=$(value OIDC_AUDIENCE)" "$runtime_file" || die OIDC_CONFIG_MISMATCH

for key in DATABASE_URL_FILE AGENT_TLS_CERT_FILE AGENT_TLS_KEY_FILE AGENT_CA_CERT_FILE \
  AGENT_GATEWAY_HEALTH_CA_FILE AGENT_CA_SIGNING_KEY_FILE API_TLS_CERT_FILE API_TLS_KEY_FILE; do
  secure_file "$(value "$key")"
done
if [[ "$(value DB_MODE)" == compose ]]; then
  secure_file "$(value POSTGRES_PASSWORD_FILE)"
else
  # Compose resolves the optional postgres secret even when its profile is off.
  # An empty, protected placeholder is sufficient when using external PostgreSQL.
  secure_file "$(value POSTGRES_PASSWORD_FILE)" true
fi
secure_file "$(value AGENT_CA_SIGNING_PASSPHRASE_FILE)" true
agent_smoke_cert=$(value AGENT_MTLS_SMOKE_CERT_FILE)
agent_smoke_key=$(value AGENT_MTLS_SMOKE_KEY_FILE)
[[ -z "$agent_smoke_cert" && -z "$agent_smoke_key" ]] || {
  [[ -n "$agent_smoke_cert" && -n "$agent_smoke_key" ]] || die AGENT_MTLS_SMOKE_CONFIG_INVALID
  agent_smoke_url=$(value AGENT_MTLS_SMOKE_URL)
  [[ "$agent_smoke_url" == https://*"/api/v1/agent/"* ]] || die AGENT_MTLS_SMOKE_CONFIG_INVALID
  secure_file "$agent_smoke_cert"
  secure_file "$agent_smoke_key"
}
smoke_token=$(value SMOKE_BEARER_TOKEN_FILE)
smoke_tenant=$(value SMOKE_TENANT_ID)
smoke_url=$(value SMOKE_PROTECTED_URL)
[[ -z "$smoke_token" && -z "$smoke_tenant" && -z "$smoke_url" ]] || {
  [[ -n "$smoke_token" && -n "$smoke_tenant" && -n "$smoke_url" ]] || die PROTECTED_SMOKE_CONFIG_INVALID
  [[ "$smoke_tenant" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || die PROTECTED_SMOKE_CONFIG_INVALID
  secure_file "$smoke_token"
}

if [[ "$environment" == production ]]; then
  require_value PRODUCTION_APPROVAL_REF
  [[ "$(value PRODUCTION_APPROVAL_REF)" != REPLACE_* ]] || die PRODUCTION_APPROVAL_REQUIRED
  require_value PRE_MIGRATION_BACKUP_REF
  [[ "$(value PRE_MIGRATION_BACKUP_REF)" != REPLACE_* ]] || die PRE_MIGRATION_BACKUP_REQUIRED
fi
printf 'CONFIG_VALID %s\n' "$environment"
