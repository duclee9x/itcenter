# Current Release Item

| Field         | Value                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| Selected item | RELEASE-003 — Worker Readiness & Background Processing Health                           |
| Priority      | P0                                                                                      |
| Status        | `NOT_STARTED`                                                                           |
| Readiness     | `READY`                                                                                 |
| Blocker       | None; RELEASE-003-R1 operational contract is `CODE_COMPLETE`.                           |
| Contract      | [RELEASE-003-R1](items/RELEASE-003-R1_PRODUCTION_READINESS_CRITICAL_WORKER_CONTRACT.md) |

RELEASE-001 runtime is `CODE_COMPLETE` but not `VERIFIED`; real provider and
staging acceptance remain open. RELEASE-002-R1 fixes Agent authentication as
mTLS with per-Agent certificates and governed enrollment, credential
lifecycle, session, replay and TASK-091 execution binding. RELEASE-002
runtime is `CODE_COMPLETE`; automated verification passes. The production
channel remains unavailable until valid mTLS, CA and database configuration
are deployed and proven through staging.

The decisions are persisted in
[RELEASE-001-R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md)
and [RELEASE-001-R2](items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md).
The global release decision remains `BLOCKED_FOR_RC`. RELEASE-002 code
completion does not verify production mTLS or staging. RELEASE-003 is selected
and ready for runtime implementation under its completed R1 contract. Overall
release readiness remains `BLOCKED_FOR_RC`.

RELEASE-004 and RELEASE-005 remain independently `READY`. RELEASE-004 is not
started. See
[RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
