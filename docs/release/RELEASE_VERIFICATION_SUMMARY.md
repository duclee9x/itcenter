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

No registry-backed immutable RC metadata, staging OIDC provider, Agent
registration/credential, usable N-1 release artifact/reference, public
staging DNS/ACME evidence, or production escrow governance evidence is
available. No release is therefore VERIFIED.

## Verification result

| Item        | Result                         | Evidence / remaining blocker                                                                                                                                                   |
| ----------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RELEASE-001 | `CODE_COMPLETE / NOT VERIFIED` | Staging OIDC issuer, RFC9068 test identity/token, IdentityLink, TenantMembership and RBAC evidence are still required.                                                         |
| RELEASE-002 | `CODE_COMPLETE / NOT VERIFIED` | Staging CA/certificates exist, but registration/credential setup and direct mTLS acceptance, binding, replay, enrollment, rotation and revocation evidence are still required. |
| RELEASE-003 | `CODE_COMPLETE / NOT VERIFIED` | Candidate deployment has not run through the Lima Podman lifecycle; readiness, dependency failure, worker criticality and drain evidence are still required.                   |
| RELEASE-004 | `CODE_COMPLETE / NOT VERIFIED` | Local OCI candidate exists, but a protected registry-backed RC and exact-digest staging deployment/attestation are still required.                                             |
| RELEASE-005 | `CODE_COMPLETE / NOT VERIFIED` | Age and writable HOST_PROTECTED staging prerequisites are prepared. Protected backup, restore, production escrow governance, measured RPO and RTO evidence are still required. |
| RELEASE-006 | `CODE_COMPLETE / NOT VERIFIED` | No usable immutable N-1 artifact/reference or qualifying candidate migration rehearsal exists.                                                                                 |
| RELEASE-007 | `CODE_COMPLETE / NOT VERIFIED` | Local TLS material/configuration and Lima forwards are prepared, but deployed edge, public/network path, HTTPS smoke and direct Agent mTLS evidence are still required.        |

**RPO:** `UNVERIFIED` — no successful HOST_PROTECTED backup timestamp.

**RTO:** `UNVERIFIED` — no actual encrypted restore rehearsal with application
validation.

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
| N-1 release reference          | `OPERATOR_REQUIRED`       | No previous immutable artifact is available; use the authorized transitional reference.                    |

The exact unresolved operator actions are maintained in
`docs/release/RELEASE_OPERATOR_PREREQUISITES.md`.

Until every item above has qualifying evidence and RPO/RTO are measured, do
not mark any item `VERIFIED`, advance `CURRENT_RELEASE_ITEM` to
RELEASE-GATE-001, or execute the gate.
