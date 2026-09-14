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
}

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

acquire_deployment_lock() {
  local environment=$1
  local lock_root=${DEPLOY_LOCK_ROOT:-/var/lock}
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
  local state_root=${DEPLOY_STATE_ROOT:-/var/lib/itcenter/release-state}
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
  sha256sum "$@" | sha256sum | awk '{print $1}'
}
