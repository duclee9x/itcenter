#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
container_cli=${CONTAINER_CLI:-podman}
case "$container_cli" in
  podman|docker) ;;
  *) printf 'CONTAINER_CLI must be podman or docker.\n' >&2; exit 1 ;;
esac
command -v "$container_cli" >/dev/null 2>&1 || {
  printf '%s is required for manifest validation.\n' "$container_cli" >&2
  exit 1
}
"$container_cli" --version >/dev/null
"$container_cli" compose version >/dev/null || {
  printf '%s compose provider is unavailable.\n' "$container_cli" >&2
  exit 1
}

temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
for environment in staging production; do
  project=itsm-staging
  [[ "$environment" == production ]] && project=itsm-production
  mkdir -p "$temp/$environment"
  sed "s#/home/itcenter/.config/itcenter/$environment#$temp/$environment#g" \
    "$root/deploy/env/$environment.example" >"$temp/$environment.env"
  sed "s#/home/itcenter/.config/itcenter/$environment#$temp/$environment#g" \
    "$root/deploy/env/runtime-$environment.example" >"$temp/$environment/runtime.env"
  chmod 600 "$temp/$environment.env" "$temp/$environment/runtime.env"
  while IFS='=' read -r name file; do
    [[ "$name" == *_FILE && "$name" != RUNTIME_ENV_FILE && -n "$file" ]] || continue
    mkdir -p "$(dirname "$file")"
    if [[ "$name" == AGENT_CA_SIGNING_PASSPHRASE_FILE ]]; then
      : >"$file"
    else
      printf 'non-production-test-fixture\n' >"$file"
    fi
    chmod 600 "$file"
  done < <(grep -E '^[A-Z0-9_]+_FILE=' "$temp/$environment.env")

  "$container_cli" compose --project-name "$project" \
    --env-file "$temp/$environment.env" \
    -f "$root/deploy/compose.yaml" \
    -f "$root/deploy/compose.$environment.yaml" config --quiet
done

# The optional private-CA path is selected by the canonical deployment context,
# not by an arbitrary caller-supplied Compose override.
ca_file="$temp/staging/oidc-ca-cert.pem"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=deployment-test-oidc-ca' \
  -keyout "$temp/staging/oidc-ca-key.pem" -out "$ca_file" >/dev/null 2>&1
chmod 600 "$ca_file"
printf 'OIDC_CA_CERT_FILE=%s\n' "$ca_file" >>"$temp/staging.env"
ca_config="$temp/staging/oidc-ca-config.yaml"
(
  export CONTAINER_CLI="$container_cli"
  # shellcheck source=../../deploy/scripts/common.sh
  source "$root/deploy/scripts/common.sh"
  make_compose_context staging "$temp/staging.env" \
    'registry.example.invalid/itcenter/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  compose config
) >"$ca_config"
grep -q 'NODE_EXTRA_CA_CERTS: /run/secrets/oidc_ca_certificate' "$ca_config"
ca_reference_count=$(grep -c 'oidc_ca_certificate' "$ca_config")
(( ca_reference_count == 2 )) || {
  printf 'Unexpected OIDC CA trust reference count: %s.\n' "$ca_reference_count" >&2
  exit 1
}

# Exercise the verifier's valid, missing, malformed, and private-key cases.
staging_verify_env="$temp/staging-verify.env"
sed 's/example\.invalid/staging.test/g' "$temp/staging.env" >"$staging_verify_env"
sed "s#OIDC_CA_CERT_FILE=.*#OIDC_CA_CERT_FILE=$ca_file#" "$staging_verify_env" \
  >"$staging_verify_env.tmp" && mv "$staging_verify_env.tmp" "$staging_verify_env"
sed 's#example\.invalid#staging.test#g' "$temp/staging/runtime.env" \
  >"$temp/staging/runtime.env.tmp" && mv "$temp/staging/runtime.env.tmp" "$temp/staging/runtime.env"
chmod 600 "$temp/staging/runtime.env"
bash "$root/deploy/scripts/verify-config.sh" staging "$staging_verify_env" >/dev/null

missing_env="$temp/staging-missing-ca.env"
sed "s#OIDC_CA_CERT_FILE=.*#OIDC_CA_CERT_FILE=$temp/staging/missing-ca.pem#" \
  "$staging_verify_env" >"$missing_env"
if bash "$root/deploy/scripts/verify-config.sh" staging "$missing_env" >/dev/null 2>&1; then
  printf 'Missing OIDC CA unexpectedly passed validation.\n' >&2
  exit 1
fi

malformed_env="$temp/staging-malformed-ca.env"
printf '%s\n' 'not-a-pem-certificate' >"$temp/staging/malformed-ca.pem"
chmod 600 "$temp/staging/malformed-ca.pem"
sed "s#OIDC_CA_CERT_FILE=.*#OIDC_CA_CERT_FILE=$temp/staging/malformed-ca.pem#" \
  "$staging_verify_env" >"$malformed_env"
if bash "$root/deploy/scripts/verify-config.sh" staging "$malformed_env" >/dev/null 2>&1; then
  printf 'Malformed OIDC CA unexpectedly passed validation.\n' >&2
  exit 1
fi

private_env="$temp/staging-private-ca.env"
printf '%s\n' '-----BEGIN PRIVATE KEY-----' 'not-a-key' \
  '-----END PRIVATE KEY-----' \
  >"$temp/staging/private-ca.pem"
sed "s#OIDC_CA_CERT_FILE=.*#OIDC_CA_CERT_FILE=$temp/staging/private-ca.pem#" \
  "$staging_verify_env" >"$private_env"
if bash "$root/deploy/scripts/verify-config.sh" staging "$private_env" >/dev/null 2>&1; then
  printf 'Private-key OIDC CA unexpectedly passed validation.\n' >&2
  exit 1
fi

printf 'COMPOSE_CONFIG_VALID\n'
