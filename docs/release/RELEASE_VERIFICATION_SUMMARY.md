# Release Verification Summary

**Assessment date:** 2026-09-16

**Decision:** `BLOCKED_FOR_RC`

This document records verification evidence for RELEASE-001 through
RELEASE-007. It is a closure record, not a new release item. The repository
HEAD contains verification commits after `7ea3001`; focused backup capture
remediation is `45d4154`.
`AGENTS.md` remains an unrelated uncommitted change and is intentionally not
part of this record.

## Evidence baseline

The implementation baseline has passed repository checks and RELEASE-007
static/runtime configuration checks: `npm test`, typecheck, lint, format,
migration tests, diff check, Podman Compose rendering, and Caddy staging/
production validation. Those results establish `CODE_COMPLETE`; they do not
establish staging verification.

The bootstrap prepared a local verification candidate from committed source
`7ea3001eccad81dc30c33702179b35aec6d13428`. Its local OCI digest is
`sha256:83942d94521fe2236c8a28277fae5fd689754163ef6d30503cb404f872b4d49d`,
with schema revision
`95886cdc18d735163a76863d050e37b7629c3015bbe37b756b9764a260636fdb`.
This is a `LOCAL_OPERATOR_BUILD`, not a registry-backed RC and remains
`NOT_VERIFIED`. Non-secret local metadata is stored outside the repository at
the host-backed staging verification path.

The Lima guest now has Podman 5.8.4, podman-compose 1.6.0 and `age 1.3.1`.
`/mnt/host-backups/itcenter-staging` is a writable `virtiofs` mount; a
temporary marker write/read/remove test passed. A staging-only age identity
and Agent CA/server/client PKI were generated outside the repository with
restricted permissions. These staging materials do not constitute production
escrow or RELEASE-005 verification. Loopback Lima forwards for staging HTTP,
HTTPS and Agent mTLS ports are configured, but no deployed listener/public
network path has yet been verified.

The authorized transitional N-1 reference is now prepared from
`7c403ab53f849abe189bf28ec0d669767427f105`, with local digest
`sha256:18f46a1f8b61cc47b551557d90c23dfcaf91b0ab9c3b9e446866fe710205a0d2`.
It is explicitly not a historical production artifact.

A staging PostgreSQL migration and backup path was exercised. Backup
`staging-20260915T165653Z-11878-7900` completed with `HOST_PROTECTED`,
`VERIFIED_COPY`, and SHA-256 verification. Restore rehearsal
`restore-20260915T165710Z-8570` decrypted the artifact into a fresh isolated
PostgreSQL project, restored it, and validated the schema in under two hours.
Application usability was not validated in that rehearsal, so this is partial
RELEASE-005 evidence only. An earlier backup attempt was invalid because the
pre-fix script allocated a pseudo-TTY; that artifact was removed and the
focused fix was committed separately.

The actual staging stack attempt reached PostgreSQL and Gateway startup, but
`verify-config.sh` rejected template values and the API failed closed during
OIDC trust initialization. No public listeners or direct mTLS acceptance
claim is made. No registry-backed immutable RC metadata, staging OIDC
provider, Agent registration/credential, public staging DNS/ACME evidence, or
production escrow governance evidence is available. No release is therefore
VERIFIED.

## Verification result

| Item        | Result                         | Evidence / remaining blocker                                                                                                                                                                   |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RELEASE-001 | `CODE_COMPLETE / NOT VERIFIED` | Staging OIDC issuer, RFC9068 test identity/token, IdentityLink, TenantMembership and RBAC evidence are still required.                                                                         |
| RELEASE-002 | `CODE_COMPLETE / NOT VERIFIED` | CA chain and client key/certificate precheck pass; registration/credential setup and direct mTLS acceptance, binding, replay, enrollment, rotation and revocation evidence are still required. |
| RELEASE-003 | `CODE_COMPLETE / NOT VERIFIED` | Candidate deployment has not run through the Lima Podman lifecycle; readiness, dependency failure, worker criticality and drain evidence are still required.                                   |
| RELEASE-004 | `CODE_COMPLETE / NOT VERIFIED` | Local OCI candidate exists, but a protected registry-backed RC and exact-digest staging deployment/attestation are still required.                                                             |
| RELEASE-005 | `CODE_COMPLETE / NOT VERIFIED` | Staging protected backup and isolated schema restore pass after the focused `-T` remediation; application validation, production escrow governance and qualifying measured RPO/RTO remain.     |
| RELEASE-006 | `CODE_COMPLETE / NOT VERIFIED` | Transitional N-1 artifact is prepared, but baseline/application compatibility and backup-gated N-1→N rehearsal remain blocked by runtime/OIDC prerequisites.                                   |
| RELEASE-007 | `CODE_COMPLETE / NOT VERIFIED` | Local TLS material/configuration and Lima forwards are prepared, but deployed edge, public/network path, HTTPS smoke and direct Agent mTLS evidence are still required.                        |

**RPO:** `UNVERIFIED` for production release closure. Staging backup age was
within six hours and provides `MET` staging evidence only.

**RTO:** `UNVERIFIED` for release closure. The isolated database restore was
under two hours, but application usability validation was not completed.

## Environment readiness

| Prerequisite                   | Status                    | Evidence / boundary                                                                                        |
| ------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Local immutable OCI candidate  | `READY`                   | `RC-LOCAL-7EA3001`; local-only, not a promotable RC.                                                       |
| Registry-backed RC metadata    | `OPERATOR_REQUIRED`       | Registry URL/repository and protected publish credentials are absent.                                      |
| `age` in Lima                  | `READY`                   | `age 1.3.1`.                                                                                               |
| HOST_PROTECTED mount           | `READY`                   | Writable host-backed `virtiofs`; marker write/read/remove passed.                                          |
| Staging age escrow             | `READY`                   | Staging identity exists outside Lima on the host-backed path; production governance remains separate.      |
| Staging Agent PKI              | `READY`                   | Staging CA/server/client material exists outside the repository; application enrollment is still required. |
| Agent CA/private issuer escrow | `OPERATOR_REQUIRED`       | Production recovery custody/reference is not evidenced.                                                    |
| Staging OIDC                   | `OPERATOR_REQUIRED`       | No provider, test identity or token supplied.                                                              |
| Staging TLS                    | `READY` (local)           | Independent local staging mode is configured; public DNS/ACME remains unverified.                          |
| Lima port forwarding           | `CONFIGURED / UNVERIFIED` | Loopback forwards configured for staging HTTP/HTTPS/Agent mTLS; deployed listeners are still required.     |
| N-1 release reference          | `READY`                   | Transitional reference from `7c403ab53f...`; local artifact only, not a historical production release.     |

The exact unresolved operator actions are maintained in
`docs/release/RELEASE_OPERATOR_PREREQUISITES.md`.

Until every item above has qualifying evidence and RPO/RTO are measured, do
not mark any item `VERIFIED`, advance `CURRENT_RELEASE_ITEM` to
RELEASE-GATE-001, or execute the gate.
