# Current Release Item

| Field         | Value                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Selected item | RELEASE-002-R1 — Production Agent Authentication Contract                                                     |
| Priority      | P0                                                                                                            |
| Status        | `BLOCKED / PLANNING_REQUIRED`                                                                                 |
| Readiness     | `BLOCKED`                                                                                                     |
| Blocker       | `SECURITY_DECISION / SPEC_GAP`: Agent credential, enrollment, lifecycle and channel profile are not selected. |
| Contract      | RELEASE-002-R1 (security decisions pending)                                                                   |

RELEASE-001 runtime is `CODE_COMPLETE` but not `VERIFIED`; real provider and
staging acceptance remain open. RELEASE-002 is the next P0 item, but runtime
is blocked because its production Agent credential and enrollment contract is
not specified. The selected current work is the RELEASE-002-R1 security
planning remediation only.

The decisions are persisted in
[RELEASE-001-R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md)
and [RELEASE-001-R2](items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md).
The global release decision remains `BLOCKED_FOR_RC`. Do not start
RELEASE-002 runtime until the R1 security decisions are explicitly approved.
Do not start RELEASE-003 in the same work item.

RELEASE-003 through RELEASE-005 remain independently `READY`. See
[RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
