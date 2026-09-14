# Current Release Item

| Field         | Value                                                                |
| ------------- | -------------------------------------------------------------------- |
| Selected item | None — RELEASE-002 completed; awaiting explicit selection            |
| Priority      | P0                                                                   |
| Status        | `CODE_COMPLETE`                                                      |
| Readiness     | `N/A`                                                                |
| Blocker       | Real private CA and staging-topology mTLS validation remain pending. |
| Contract      | RELEASE-002-R1 (`CODE_COMPLETE`)                                     |

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
completion does not verify production mTLS or staging. RELEASE-003 is
dependency-ready but is not selected; do not start it automatically.

RELEASE-003 through RELEASE-005 remain independently `READY`; no next item is
selected here. See
[RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
