# Current Release Item

| Field         | Value                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------ |
| Selected item | RELEASE-004 — Immutable Build / Staging / Promotion / Rollback Pipeline                    |
| Priority      | P0                                                                                         |
| Status        | `NOT_STARTED`                                                                              |
| Readiness     | `READY`                                                                                    |
| Blocker       | None; deployment decisions are fixed by RELEASE-004-R1.                                    |
| Contract      | [RELEASE-004-R1](items/RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md) |
| Item          | [RELEASE-004](items/RELEASE-004_IMMUTABLE_BUILD_STAGING_PROMOTION_ROLLBACK.md)             |

RELEASE-001 runtime is `CODE_COMPLETE` but not `VERIFIED`; real provider and
staging acceptance remain open. RELEASE-002-R1 fixes Agent authentication as
mTLS with per-Agent certificates and governed enrollment, credential
lifecycle, session, replay and TASK-091 execution binding. RELEASE-002
runtime is `CODE_COMPLETE`; automated verification passes. The production
channel remains unavailable until valid mTLS, CA and database configuration
are deployed and proven through staging.

RELEASE-003 runtime is `CODE_COMPLETE`, but staging/orchestrator verification
remains pending. RELEASE-004-R1 has resolved its contract gap and selects
Linux + Docker Engine + Docker Compose v2, one shared immutable OCI image,
isolated staging, operator-triggered deployment, a controlled migration step,
readiness/smoke gates, and exact-digest rollback/forward-fix semantics.
RELEASE-004 implementation has not started. Overall release remains
`BLOCKED_FOR_RC`.

RELEASE-005 remains independently `READY`. RELEASE-006 and RELEASE-007 remain
`WAITING_DEPENDENCY` on RELEASE-004 (and RELEASE-005 for RELEASE-006). Do not
start those items automatically. See
[RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
