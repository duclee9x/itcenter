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
printf 'COMPOSE_CONFIG_VALID\n'
