#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

[[ $# -eq 3 ]] || die "USAGE: verify-staging.sh <rc-json> <staging-env-file> <acceptance-evidence-json>"
rc_file=$1
config_file=$2
evidence_file=$3
[[ -r "$rc_file" && -r "$evidence_file" ]] || die STAGING_EVIDENCE_UNAVAILABLE
release_id=$(jq -er '.release_id | strings' "$rc_file") || die RELEASE_METADATA_INVALID
image="$(jq -er '.image_repository | strings' "$rc_file")@$(jq -er '.image_digest | strings' "$rc_file")" || die RELEASE_METADATA_INVALID
verify_image_digest "$image"
verify_rc_metadata "$rc_file" "$release_id" "$image"
"$(dirname "$0")/verify-config.sh" staging "$config_file" >/dev/null
acquire_deployment_lock staging

state_root=${DEPLOY_STATE_ROOT:-/var/lib/itcenter/release-state}
deployment="$state_root/staging/$release_id.json"
[[ -r "$deployment" ]] || die STAGING_DEPLOYMENT_REQUIRED
[[ -r "$state_root/staging/CURRENT.json" ]] || die STAGING_DEPLOYMENT_REQUIRED
source_commit=$(jq -r '.source_commit' "$rc_file")
schema_revision=$(jq -r '.schema_revision' "$rc_file")
jq -e --arg id "$release_id" --arg image "$image" \
  '.release_id==$id and .image==$image' \
  "$state_root/staging/CURRENT.json" >/dev/null || die STAGING_DEPLOYMENT_MISMATCH
jq -e --arg id "$release_id" --arg image "$image" \
  --arg commit "$source_commit" --arg schema "$schema_revision" \
  '.release_id==$id and .image==$image and .source_commit==$commit and
   .schema_revision==$schema and .status=="SMOKE_PASSED"' \
  "$deployment" >/dev/null || die STAGING_DEPLOYMENT_MISMATCH

jq -e --arg id "$release_id" --arg image "$image" \
  --arg commit "$source_commit" --arg schema "$schema_revision" \
  '.release_id==$id and .image==$image and .source_commit==$commit and
   .schema_revision==$schema and .overall_status=="ACCEPTED" and
   .accepted_by != null and (.accepted_by|type)=="string" and
   (.accepted_by|length)>0 and (.accepted_at|type)=="string" and
   (.accepted_at|test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z$")) and
   .releases["RELEASE-001"]=="VERIFIED" and
   .releases["RELEASE-002"]=="VERIFIED" and
   .releases["RELEASE-003"]=="VERIFIED" and
   (.evidence_refs["RELEASE-001"]|type)=="string" and
   (.evidence_refs["RELEASE-001"]|length)>0 and
   (.evidence_refs["RELEASE-002"]|type)=="string" and
   (.evidence_refs["RELEASE-002"]|length)>0 and
   (.evidence_refs["RELEASE-003"]|type)=="string" and
   (.evidence_refs["RELEASE-003"]|length)>0' \
  "$evidence_file" >/dev/null || die STAGING_ACCEPTANCE_EVIDENCE_INVALID

write_json_atomic "$state_root/staging/attestations/$release_id.json" \
  --arg release_id "$release_id" --arg image "$image" \
  --arg source_commit "$source_commit" --arg schema_revision "$schema_revision" \
  --arg config_revision "$(jq -r '.config_revision' "$deployment")" \
  --arg accepted_by "$(jq -r '.accepted_by' "$evidence_file")" \
  --arg accepted_at "$(jq -r '.accepted_at' "$evidence_file")" \
  --arg evidence_sha256 "$(sha256sum "$evidence_file" | awk '{print $1}')" \
  --argjson evidence_refs "$(jq '.evidence_refs' "$evidence_file")" \
  '{release_id:$release_id,image:$image,source_commit:$source_commit,
    schema_revision:$schema_revision,config_revision:$config_revision,
    status:"VERIFIED",accepted_by:$accepted_by,accepted_at:$accepted_at,
    evidence_sha256:$evidence_sha256,
    evidence_refs:$evidence_refs}'
printf 'STAGING_ACCEPTED %s\n' "$release_id"
