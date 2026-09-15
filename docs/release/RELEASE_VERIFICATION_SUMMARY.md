# Release Verification Summary

**Assessment date:** 2026-09-15

**Decision:** `BLOCKED_FOR_RC`

This document records verification evidence for RELEASE-001 through
RELEASE-007. It is a closure record, not a new release item. The repository
HEAD contains `7ea3001` (`Implement RELEASE-007 production edge controls`).
`AGENTS.md` remains an unrelated uncommitted change and is intentionally not
part of this record.

## Evidence baseline

The implementation baseline has passed repository checks and RELEASE-007
static/runtime configuration checks: `npm test`, typecheck, lint, format,
migration tests, diff check, Podman Compose rendering, and Caddy staging/
production validation. Those results establish `CODE_COMPLETE`; they do not
establish staging verification.

The canonical Lima guest was inspected directly. It reports Podman 5.8.4 and
podman-compose 1.6.0, but `age --version` returns `command not found`. The
configured staging path `/mnt/host-backups/itcenter-staging` is absent and not
writable. The guest mount table shows the repository mount `/Users/duclee` as
read-only virtiofs, which does not satisfy HOST_PROTECTED. No temporary marker
was created because the required destination does not exist.

The repository contains only example environment files and
`release/rc/README.md`; there is no immutable RC JSON record or candidate
digest. The staging configuration still contains `example.invalid` hosts and
placeholder image, OIDC, backup and certificate values. No staging OIDC
identity/membership, Agent CA/client certificate, protected escrow references,
or usable immutable N-1 artifact was available. The Lima guest only has a
local smoke image plus base PostgreSQL/Caddy images; those are not an RC
candidate.

## Verification result

| Item        | Result                         | Evidence / remaining blocker                                                                                                                                                                                                                  |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RELEASE-001 | `CODE_COMPLETE / NOT VERIFIED` | No real staging OIDC issuer, RFC9068 test token, IdentityLink and TenantMembership set, or RBAC acceptance evidence. Provision staging IdP/test identities, then run the R1/R2 positive and negative matrix.                                  |
| RELEASE-002 | `CODE_COMPLETE / NOT VERIFIED` | No staging Agent CA, client certificate, registration/credential or direct forwarded TCP acceptance evidence. Provision staging PKI and execute mTLS, binding, replay, enrollment, rotation and revocation checks.                            |
| RELEASE-003 | `CODE_COMPLETE / NOT VERIFIED` | No candidate has been deployed through the Lima Podman lifecycle. Deploy the immutable RC and exercise API/Gateway/Worker readiness, dependency failures, worker criticality and drain.                                                       |
| RELEASE-004 | `CODE_COMPLETE / NOT VERIFIED` | No CI-published immutable candidate digest or real staging deployment/attestation. Publish a protected RC and deploy the exact digest through `deploy/scripts/deploy.sh`.                                                                     |
| RELEASE-005 | `CODE_COMPLETE / NOT VERIFIED` | `age` is absent; HOST_PROTECTED is absent/not writable; no protected backup, restore, escrow, RPO or RTO evidence exists. Install age, configure a writable macOS-backed Lima mount, provision escrow, then run backup and restore rehearsal. |
| RELEASE-006 | `CODE_COMPLETE / NOT VERIFIED` | No usable immutable N-1 artifact/reference and no qualifying candidate migration rehearsal. Supply N/N-1 release metadata, run the backup-gated controlled-maintenance rehearsal and persist its matrix/evidence.                             |
| RELEASE-007 | `CODE_COMPLETE / NOT VERIFIED` | No real staging DNS/certificate, Lima port forwarding, public HTTPS smoke, forwarded-header, body/rate-limit or direct Agent mTLS edge evidence. Configure staging edge and run checks through Caddy and the direct Gateway port.             |

**RPO:** `UNVERIFIED` — no successful HOST_PROTECTED backup timestamp.

**RTO:** `UNVERIFIED` — no actual encrypted restore rehearsal with application
validation.

## Required operator actions

1. Publish an immutable RC OCI image and RC metadata containing release id,
   source commit, schema revision and digest. Make the same digest available to
   the Lima guest.
2. Configure non-placeholder staging OIDC, test identities, tenant membership
   and local permissions. Provision staging Agent CA, server/client
   certificates, registration and credentials without committing secrets.
3. Install `age` in the Lima guest and configure a writable explicit Lima host
   mount. Validate with `age --version`, `findmnt -T "$GUEST_BACKUP_MOUNT"`, a
   temporary write/remove probe, and the configured `BACKUP_MOUNT_FSTYPES`.
4. Configure age identity and Agent CA escrow references outside Lima.
5. Configure staging DNS or a deliberately trusted staging hostname, Caddy
   certificate mode, and Lima forwarding for HTTP/HTTPS and the Agent mTLS
   port. Validate with the Podman Compose deployment path, not direct API
   container access.
6. Run RELEASE-004 deployment, RELEASE-001/002/003 acceptance, the protected
   RELEASE-005 backup/restore rehearsal with measured RPO/RTO, and the
   RELEASE-006 N-1 migration rehearsal. Attach non-secret evidence to the
   corresponding release records.

Until every item above has qualifying evidence and RPO/RTO are measured, do
not mark any item `VERIFIED`, advance `CURRENT_RELEASE_ITEM` to
RELEASE-GATE-001, or execute the gate.
