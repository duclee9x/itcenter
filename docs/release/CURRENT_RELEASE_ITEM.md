# Current Release Item

| Field         | Value                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------ |
| Selected item | RELEASE-004 — Immutable Build / Staging / Promotion / Rollback Pipeline                    |
| Priority      | P0                                                                                         |
| Status        | `BLOCKED / NOT_STARTED`                                                                    |
| Readiness     | `BLOCKED`                                                                                  |
| Blocker       | `SPEC_GAP / OPERATIONAL_DECISION`; resolve R1 decisions before implementation.             |
| Contract      | [RELEASE-004-R1](items/RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md) |
| Item          | [RELEASE-004](items/RELEASE-004_IMMUTABLE_BUILD_STAGING_PROMOTION_ROLLBACK.md)             |

RELEASE-001 runtime is `CODE_COMPLETE` but not `VERIFIED`; real provider and
staging acceptance remain open. RELEASE-002-R1 fixes Agent authentication as
mTLS with per-Agent certificates and governed enrollment, credential
lifecycle, session, replay and TASK-091 execution binding. RELEASE-002
runtime is `CODE_COMPLETE`; automated verification passes. The production
channel remains unavailable until valid mTLS, CA and database configuration
are deployed and proven through staging.

The RELEASE-001 decisions are persisted in
[RELEASE-001-R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md)
and [RELEASE-001-R2](items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md).
The global release decision remains `BLOCKED_FOR_RC`. RELEASE-002 code
completion does not verify production mTLS or staging. RELEASE-003 runtime is
`CODE_COMPLETE`, but staging/orchestrator verification remains pending. R4
reconciliation found no deployment target, image registry, promotion authority,
controlled migration stage, or approved rollback contract; R1 records the
decisions required. Do not implement the pipeline until those decisions are
approved. Overall release readiness remains `BLOCKED_FOR_RC`.

RELEASE-005 remains independently `READY`. RELEASE-006 and RELEASE-007 remain
waiting on their declared dependencies. See
[RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
