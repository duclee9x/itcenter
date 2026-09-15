#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
app_image=${1:?usage: podman-compose-runtime.sh <test-image-reference>}
podman --version >/dev/null
podman compose version >/dev/null
[[ "$(podman info --format '{{.Host.Security.Rootless}}')" == true ]] || {
  printf 'ROOTLESS_PODMAN_REQUIRED\n' >&2
  exit 1
}

temp=$(mktemp -d "${TMPDIR:-/tmp}/itcenter-podman-r2.XXXXXX")
project="itcenter-r2-smoke-${BASHPID}"
isolation_project="${project}-isolation"
cleanup() {
  status=$?
  if [[ "$status" -ne 0 && "${KEEP_PODMAN_SMOKE:-0}" == 1 ]]; then
    printf 'PODMAN_SMOKE_ARTIFACTS_RETAINED project=%s temp=%s\n' "$project" "$temp" >&2
    return
  fi
  podman compose --project-name "$isolation_project" --env-file "$temp/compose.env" \
    -f "$root/deploy/compose.yaml" -f "$root/deploy/compose.staging.yaml" \
    down --timeout 10 --volumes >/dev/null 2>&1 || true
  podman pod rm --force "pod_${isolation_project}" >/dev/null 2>&1 || true
  podman volume rm --force "${isolation_project}_postgres_data" \
    "${isolation_project}_caddy_data" "${isolation_project}_caddy_config" >/dev/null 2>&1 || true
  podman network rm "${isolation_project}_private" >/dev/null 2>&1 || true
  podman compose --project-name "$project" --env-file "$temp/compose.env" \
    -f "$root/deploy/compose.yaml" -f "$root/deploy/compose.staging.yaml" \
    down --timeout 10 --volumes >/dev/null 2>&1 || true
  podman pod rm --force "pod_${project}" >/dev/null 2>&1 || true
  podman volume rm --force "${project}_postgres_data" \
    "${project}_caddy_data" "${project}_caddy_config" >/dev/null 2>&1 || true
  podman network rm "${project}_private" >/dev/null 2>&1 || true
  rm -rf "$temp"
}
trap cleanup EXIT
mkdir -m 0700 "$temp/secrets"
chmod 0700 "$temp"
smoke_password=$(openssl rand -hex 24)
printf '%s\n' "$smoke_password" >"$temp/secrets/postgres-password"
printf 'postgresql://itcenter_r2:%s@postgres:5432/itcenter_r2\n' \
  "$smoke_password" >"$temp/secrets/database-url"
chmod 0600 "$temp/secrets/"*

openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj /CN=itcenter-r2-agent-ca \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$temp/secrets/agent-ca-key.pem" \
  -out "$temp/secrets/agent-ca-cert.pem" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj /CN=agent-r2-smoke.test \
  -keyout "$temp/secrets/agent-server-key.pem" \
  -out "$temp/agent-server.csr" >/dev/null 2>&1
openssl x509 -req -in "$temp/agent-server.csr" \
  -CA "$temp/secrets/agent-ca-cert.pem" \
  -CAkey "$temp/secrets/agent-ca-key.pem" -CAcreateserial -days 2 \
  -extfile <(printf 'subjectAltName=DNS:agent-r2-smoke.test\nextendedKeyUsage=serverAuth\n') \
  -out "$temp/secrets/agent-server-cert.pem" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj /CN=api-r2-smoke.test \
  -addext 'subjectAltName=DNS:api-r2-smoke.test' \
  -keyout "$temp/secrets/api-key.pem" \
  -out "$temp/secrets/api-cert.pem" >/dev/null 2>&1
: >"$temp/secrets/agent-ca-passphrase"
chmod 0600 "$temp/secrets/"*

cat >"$temp/runtime.env" <<EOF
APP_ENV=staging
AUTH_MODE=oidc
OIDC_ISSUER=https://accounts.google.com
OIDC_AUDIENCE=itcenter-podman-runtime-smoke
DATABASE_SECRET_REF=file:/run/secrets/database_url
AGENT_AUTH_MODE=mtls
AGENT_TLS_CERT_REF=file:/run/secrets/agent_tls_cert
AGENT_TLS_KEY_REF=file:/run/secrets/agent_tls_key
AGENT_CA_CERT_REF=file:/run/secrets/agent_ca_certificate
AGENT_CA_SIGNING_KEY_REF=file:/run/secrets/agent_ca_signing_key
EOF
chmod 0600 "$temp/runtime.env"

cat >"$temp/compose.env" <<EOF
COMPOSE_PROJECT_NAME=$project
APP_ENV=staging
APP_IMAGE=$app_image
APP_VERSION=0.0.0-r2-smoke
GIT_COMMIT=0000000000000000000000000000000000000000
BUILD_TIME=2026-09-15T00:00:00Z
IMAGE_DIGEST=local-smoke-only
RUNTIME_ENV_FILE=$temp/runtime.env
DB_MODE=compose
POSTGRES_IMAGE=docker.io/library/postgres:18-alpine
CADDY_IMAGE=docker.io/library/caddy:2-alpine
POSTGRES_DB=itcenter_r2
POSTGRES_USER=itcenter_r2
DATABASE_URL_FILE=$temp/secrets/database-url
POSTGRES_PASSWORD_FILE=$temp/secrets/postgres-password
AGENT_TLS_CERT_FILE=$temp/secrets/agent-server-cert.pem
AGENT_TLS_KEY_FILE=$temp/secrets/agent-server-key.pem
AGENT_CA_CERT_FILE=$temp/secrets/agent-ca-cert.pem
AGENT_GATEWAY_HEALTH_CA_FILE=$temp/secrets/agent-ca-cert.pem
AGENT_CA_SIGNING_KEY_FILE=$temp/secrets/agent-ca-key.pem
AGENT_CA_SIGNING_PASSPHRASE_FILE=$temp/secrets/agent-ca-passphrase
API_TLS_CERT_FILE=$temp/secrets/api-cert.pem
API_TLS_KEY_FILE=$temp/secrets/api-key.pem
AUTH_MODE=oidc
OIDC_ISSUER=https://accounts.google.com
OIDC_AUDIENCE=itcenter-podman-runtime-smoke
AGENT_AUTH_MODE=mtls
API_HOSTNAME=api-r2-smoke.test
STAGING_API_BIND_ADDRESS=127.0.0.1
STAGING_HTTP_PORT=28180
STAGING_HTTPS_PORT=28443
AGENT_BIND_ADDRESS=127.0.0.1
AGENT_HOST_PORT=23001
API_HEALTH_URL=https://api-r2-smoke.test:28443/api/v1/health/ready
API_HEALTH_RESOLVE=api-r2-smoke.test:28443:127.0.0.1
AGENT_GATEWAY_HOSTNAME=agent-r2-smoke.test
AGENT_GATEWAY_HEALTH_URL=https://agent-r2-smoke.test:23001/api/v1/health/ready
AGENT_GATEWAY_HEALTH_RESOLVE=agent-r2-smoke.test:23001:127.0.0.1
SMOKE_TIMEOUT_SECONDS=120
PRODUCTION_APPROVAL_REF=NOT_APPLICABLE_TEST
PRE_MIGRATION_BACKUP_REF=NOT_APPLICABLE_TEST
EOF
chmod 0600 "$temp/compose.env"

compose=(podman compose --project-name "$project" --env-file "$temp/compose.env"
  -f "$root/deploy/compose.yaml" -f "$root/deploy/compose.staging.yaml")
"${compose[@]}" config --quiet
"${compose[@]}" --profile compose-postgres up -d --wait --wait-timeout 90 postgres
"${compose[@]}" --profile migration run --rm migrate
"${compose[@]}" up -d --wait --wait-timeout 120 --remove-orphans \
  api agent-gateway worker caddy

curl --fail --silent --show-error --max-time 10 \
  --cacert "$temp/secrets/api-cert.pem" \
  --resolve api-r2-smoke.test:28443:127.0.0.1 \
  https://api-r2-smoke.test:28443/api/v1/health/ready |
  jq -e '.data.profile == "API" and .data.status == "READY"' >/dev/null
curl --fail --silent --show-error --max-time 10 \
  --cacert "$temp/secrets/agent-ca-cert.pem" \
  --resolve agent-r2-smoke.test:23001:127.0.0.1 \
  https://agent-r2-smoke.test:23001/api/v1/health/ready |
  jq -e '.data.profile == "AGENT_GATEWAY" and
    (.data.status == "READY" or .data.status == "DEGRADED") and
    ([.data.components[] | select(.id == "agent-authentication" and .state == "READY")] | length == 1)' >/dev/null
"${compose[@]}" exec -T worker node -e \
  'fetch("http://127.0.0.1:3002/api/v1/health/ready").then(async r=>{const x=await r.json();process.exit(r.ok&&x.data.profile==="WORKER"&&x.data.status==="READY"?0:1)}).catch(()=>process.exit(1))'

isolation_compose=(podman compose --project-name "$isolation_project" \
  --env-file "$temp/compose.env" -f "$root/deploy/compose.yaml" \
  -f "$root/deploy/compose.staging.yaml")
"${isolation_compose[@]}" --profile compose-postgres up -d --wait \
  --wait-timeout 90 postgres
podman container exists "${project}_postgres_1"
podman container exists "${isolation_project}_postgres_1"
[[ "$(podman inspect --format '{{.Id}}' "${project}_postgres_1")" != \
   "$(podman inspect --format '{{.Id}}' "${isolation_project}_postgres_1")" ]]
podman volume exists "${project}_postgres_data"
podman volume exists "${isolation_project}_postgres_data"
podman network exists "${project}_private"
podman network exists "${isolation_project}_private"

printf 'PODMAN_COMPOSE_RUNTIME_SMOKE_PASSED project=%s\n' "$project"
