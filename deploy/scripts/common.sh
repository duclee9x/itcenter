#!/usr/bin/env bash

die() {
  printf 'ERROR %s\n' "$1" >&2
  exit 1
}

read_env_value() {
  local file=$1 key=$2
  awk -v key="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line=$0
      sub(/\r$/, "", line)
      if (line ~ "^[[:space:]]*export[[:space:]]+") sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, pair, "=")
      if (pair[1] == key) {
        sub(/^[^=]*=/, "", line)
        if (line ~ /^".*"$/) line=substr(line,2,length(line)-2)
        print line
        exit
      }
    }
  ' "$file"
}

make_compose_context() {
  local environment=$1 config_file=$2 image=$3
  DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  case "$environment" in
    staging)
      COMPOSE_PROJECT_NAME=itsm-staging
      COMPOSE_OVERRIDE="$DEPLOY_ROOT/compose.staging.yaml"
      ;;
    production)
      COMPOSE_PROJECT_NAME=itsm-production
      COMPOSE_OVERRIDE="$DEPLOY_ROOT/compose.production.yaml"
      ;;
    *) die INVALID_ENVIRONMENT ;;
  esac
  COMPOSE_BASE="$DEPLOY_ROOT/compose.yaml"
  COMPOSE_ENV_FILE="$(cd "$(dirname "$config_file")" && pwd)/$(basename "$config_file")"
  APP_IMAGE=$image
  IMAGE_DIGEST=${image##*@}
  export COMPOSE_PROJECT_NAME APP_IMAGE IMAGE_DIGEST
  COMPOSE_ARGS=(
    --project-name "$COMPOSE_PROJECT_NAME"
    --env-file "$COMPOSE_ENV_FILE"
    -f "$COMPOSE_BASE"
    -f "$COMPOSE_OVERRIDE"
  )
  if [[ -n "$(read_env_value "$config_file" OIDC_CA_CERT_FILE)" ]]; then
    COMPOSE_ARGS+=( -f "$DEPLOY_ROOT/compose.oidc-ca.yaml" )
  fi
}

compose() {
  "${CONTAINER_CLI:-podman}" compose "${COMPOSE_ARGS[@]}" "$@"
}

validate_caddy_config() {
  compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
}

version_at_least() {
  local version=$1 min_major=$2 min_minor=$3 min_patch=$4
  local pattern='([0-9]+)\.([0-9]+)\.([0-9]+)'
  [[ "$version" =~ $pattern ]] || return 1
  local major=$((10#${BASH_REMATCH[1]}))
  local minor=$((10#${BASH_REMATCH[2]}))
  local patch=$((10#${BASH_REMATCH[3]}))
  (( major > min_major ||
     (major == min_major && minor > min_minor) ||
     (major == min_major && minor == min_minor && patch >= min_patch) ))
}

ensure_container_runtime() {
  CONTAINER_CLI=${CONTAINER_CLI:-podman}
  case "$CONTAINER_CLI" in
    podman|docker) ;;
    *) die CONTAINER_CLI_UNSUPPORTED ;;
  esac
  command -v "$CONTAINER_CLI" >/dev/null 2>&1 || die CONTAINER_CLI_UNAVAILABLE
  local runtime_version compose_version min_runtime_major min_runtime_minor min_runtime_patch
  local min_compose_major min_compose_minor min_compose_patch
  runtime_version=$("$CONTAINER_CLI" --version 2>&1) || die CONTAINER_RUNTIME_UNAVAILABLE
  compose_version=$("$CONTAINER_CLI" compose version 2>&1) || die COMPOSE_PROVIDER_UNAVAILABLE
  if [[ "$CONTAINER_CLI" == podman ]]; then
    min_runtime_major=5 min_runtime_minor=8 min_runtime_patch=4
    min_compose_major=1 min_compose_minor=6 min_compose_patch=0
  else
    min_runtime_major=20 min_runtime_minor=10 min_runtime_patch=0
    min_compose_major=2 min_compose_minor=20 min_compose_patch=0
  fi
  version_at_least "$runtime_version" "$min_runtime_major" \
    "$min_runtime_minor" "$min_runtime_patch" || die CONTAINER_RUNTIME_VERSION_UNSUPPORTED
  version_at_least "$compose_version" "$min_compose_major" \
    "$min_compose_minor" "$min_compose_patch" || die COMPOSE_PROVIDER_VERSION_UNSUPPORTED
  export CONTAINER_CLI
}

release_state_root() {
  printf '%s\n' "${DEPLOY_STATE_ROOT:-${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}/itcenter/release-state}"
}

deployment_lock_root() {
  printf '%s\n' "${DEPLOY_LOCK_ROOT:-${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}/itcenter/locks}"
}

acquire_deployment_lock() {
  local environment=$1
  local lock_root
  lock_root=$(deployment_lock_root)
  mkdir -p "$lock_root"
  exec 9>"$lock_root/itcenter-${environment}.deploy.lock"
  flock -n 9 || die DEPLOYMENT_ALREADY_IN_PROGRESS
}

write_json_atomic() {
  local target=$1
  shift
  local temp="${target}.tmp.$$"
  mkdir -p "$(dirname "$target")"
  jq -n "$@" >"$temp" || die METADATA_WRITE_FAILED
  chmod 600 "$temp"
  mv -f "$temp" "$target"
}

write_event() {
  local environment=$1 release_id=$2 status=$3 reason=$4 image=$5 commit=$6 schema=$7 config_revision=$8
  local state_root
  state_root=$(release_state_root)
  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%S)-$$"
  write_json_atomic \
    "$state_root/$environment/events/${timestamp}-${release_id}-${status}.json" \
    --arg environment "$environment" \
    --arg release_id "$release_id" \
    --arg status "$status" \
    --arg reason_code "$reason" \
    --arg image "$image" \
    --arg source_commit "$commit" \
    --arg schema_revision "$schema" \
    --arg config_revision "$config_revision" \
    --arg actor "${SUDO_USER:-$(id -un)}" \
    --arg occurred_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{environment:$environment,release_id:$release_id,status:$status,
      reason_code:$reason_code,image:$image,source_commit:$source_commit,
      schema_revision:$schema_revision,config_revision:$config_revision,
      actor:$actor,occurred_at:$occurred_at}'
}

verify_image_digest() {
  [[ "$1" =~ ^[^[:space:]@]+@sha256:[a-f0-9]{64}$ ]] || die IMMUTABLE_IMAGE_DIGEST_REQUIRED
}

verify_rc_metadata() {
  local rc_file=$1 release_id=$2 image=$3
  [[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] || die RELEASE_ID_INVALID
  jq -e \
    --arg release_id "$release_id" \
    --arg repository "${image%@*}" \
    --arg digest "${image##*@}" \
    '(.release_id == $release_id) and
     (.image_repository == $repository) and
     (.image_digest == $digest) and
     (.source_commit | test("^[a-fA-F0-9]{40}$")) and
     (.schema_revision | test("^[a-fA-F0-9]{64}$"))' \
    "$rc_file" >/dev/null || die RELEASE_METADATA_MISMATCH
}

config_revision() {
  local config_file=${1:-}
  local oidc_ca_file=""
  if [[ -n "$config_file" && -f "$config_file" ]]; then
    oidc_ca_file=$(read_env_value "$config_file" OIDC_CA_CERT_FILE)
  fi
  {
    sha256sum "$@"
    if [[ -n "$oidc_ca_file" ]]; then
      sha256sum "$oidc_ca_file"
    fi
  } | sha256sum | awk '{print $1}'
}

migration_timeout_seconds() {
  local value=${MIGRATION_TIMEOUT_SECONDS:-1800}
  [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1 && value <= 1800 )) || die MIGRATION_TIMEOUT_INVALID
  printf '%s\n' "$value"
}

run_migration_with_budget() {
  command -v timeout >/dev/null 2>&1 || die MIGRATION_TIMEOUT_TOOL_UNAVAILABLE
  local seconds
  seconds=$(migration_timeout_seconds)
  timeout --signal=TERM "$seconds" "$@"
}
