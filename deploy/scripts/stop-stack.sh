#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
[[ $# -eq 2 && "$1" == production ]] || die "USAGE: stop-stack.sh production <env-file>"
current="${DEPLOY_STATE_ROOT:-/var/lib/itcenter/release-state}/production/CURRENT.json"
[[ -r "$current" ]] || die CURRENT_RELEASE_UNAVAILABLE
image=$(jq -er '.image | strings' "$current") || die CURRENT_RELEASE_INVALID
source_commit=$(jq -er '.source_commit | strings' "$current") || die CURRENT_RELEASE_INVALID
app_version=$(jq -er '.application_version | strings' "$current") || die CURRENT_RELEASE_INVALID
build_time=$(jq -er '.build_time | strings' "$current") || die CURRENT_RELEASE_INVALID
verify_image_digest "$image"
make_compose_context production "$2" "$image"
export GIT_COMMIT=$source_commit APP_VERSION=$app_version BUILD_TIME=$build_time
acquire_deployment_lock production
compose --profile compose-postgres down --timeout 10
