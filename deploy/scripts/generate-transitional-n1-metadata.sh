#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

usage() {
  cat >&2 <<'EOF'
USAGE: generate-transitional-n1-metadata.sh --source-commit <40-hex> \
  --image <image@sha256:digest> --schema <64-hex> --output <file>
EOF
  exit 2
}

source_commit= image= schema= output=
while (($#)); do
  case "$1" in
    --source-commit) source_commit=${2:-}; shift 2;;
    --image) image=${2:-}; shift 2;;
    --schema) schema=${2:-}; shift 2;;
    --output) output=${2:-}; shift 2;;
    -h|--help) usage;;
    *) die ARGUMENT_INVALID;;
  esac
done
[[ "$source_commit" =~ ^[a-fA-F0-9]{40}$ ]] || die SOURCE_COMMIT_INVALID
[[ "$schema" =~ ^[a-fA-F0-9]{64}$ ]] || die SCHEMA_REVISION_INVALID
[[ "$image" =~ @sha256:[a-fA-F0-9]{64}$ ]] || die IMMUTABLE_IMAGE_DIGEST_REQUIRED
[[ -n "$output" ]] || die OUTPUT_REQUIRED
git cat-file -e "$source_commit^{commit}" || die SOURCE_COMMIT_UNAVAILABLE

steps=$(git archive --format=tar "$source_commit" -- database/migrations | tar -tf - | awk '/\.sql$/ {count++} END {print count+0}')
[[ "$steps" =~ ^[1-9][0-9]*$ ]] || die SOURCE_MIGRATION_STEPS_UNAVAILABLE
mkdir -p "$(dirname "$output")"
jq -n --arg source_commit "$source_commit" --arg image "$image" \
  --arg schema_revision "$schema" --argjson migration_steps "$steps" \
  '{release_id:("TRANSITIONAL-N1-" + ($source_commit[0:7]|ascii_upcase)),
    reference_type:"TRANSITIONAL_N_MINUS_1_REFERENCE",source_commit:$source_commit,
    schema_revision:$schema_revision,migration_steps:$migration_steps,image:$image,
    artifact_provenance:"clean-git-archive-source-counted-from-committed-migration-manifest",
    production_artifact:false,verification_status:"NOT_VERIFIED"}' >"$output.tmp"
chmod 600 "$output.tmp"
mv -f "$output.tmp" "$output"
printf 'TRANSITIONAL_N1_METADATA_WRITTEN %s %s\n' "$steps" "$output"
