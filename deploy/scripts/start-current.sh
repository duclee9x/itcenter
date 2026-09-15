#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
[[ $# -eq 2 && "$1" == production ]] || die "USAGE: start-current.sh production <env-file>"
environment=$1
config_file=$2
state_root=$(release_state_root)
current="$state_root/production/CURRENT.json"
[[ -r "$current" ]] || die CURRENT_RELEASE_UNAVAILABLE
image=$(jq -er '.image | strings' "$current") || die CURRENT_RELEASE_INVALID
source_commit=$(jq -er '.source_commit | strings' "$current") || die CURRENT_RELEASE_INVALID
app_version=$(jq -er '.application_version | strings' "$current") || die CURRENT_RELEASE_INVALID
build_time=$(jq -er '.build_time | strings' "$current") || die CURRENT_RELEASE_INVALID
verify_image_digest "$image"
[[ "$source_commit" =~ ^[a-fA-F0-9]{40}$ ]] || die CURRENT_RELEASE_INVALID
"$(dirname "$0")/verify-config.sh" production "$config_file" >/dev/null
make_compose_context "$environment" "$config_file" "$image"
export GIT_COMMIT=$source_commit APP_VERSION=$app_version BUILD_TIME=$build_time
acquire_deployment_lock production
ensure_container_runtime
compose config --quiet || die COMPOSE_CONFIG_INVALID
compose pull api agent-gateway worker caddy || die IMAGE_PULL_FAILED
if [[ "$(read_env_value "$config_file" DB_MODE)" == compose ]]; then
  compose --profile compose-postgres pull postgres || die DATABASE_IMAGE_PULL_FAILED
  compose --profile compose-postgres up -d --wait postgres || die DATABASE_START_FAILED
fi
compose up -d --wait --remove-orphans api agent-gateway worker caddy || die SERVICE_START_FAILED
"$(dirname "$0")/smoke.sh" production "$config_file" "$image" "$source_commit"
