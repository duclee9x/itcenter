# Current Release Item

| Field         | Value                                                                 |
| ------------- | --------------------------------------------------------------------- |
| Selected item | RELEASE-002 — Production Agent Authentication for TASK-091            |
| Priority      | P0                                                                    |
| Status        | `NOT_STARTED`                                                         |
| Readiness     | `READY`                                                               |
| Blocker       | None. Agent Gateway remains fail-closed until runtime implementation. |
| Contract      | RELEASE-002-R1 (`CODE_COMPLETE`)                                      |

RELEASE-001 runtime is `CODE_COMPLETE` but not `VERIFIED`; real provider and
staging acceptance remain open. RELEASE-002-R1 fixes Agent authentication as
mTLS with per-Agent certificates and governed enrollment, credential
lifecycle, session, replay and TASK-091 execution binding. RELEASE-002 is
`READY / NOT_STARTED`; its production channel remains fail-closed until the
runtime adapter is implemented.

The decisions are persisted in
[RELEASE-001-R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md)
and [RELEASE-001-R2](items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md).
The global release decision remains `BLOCKED_FOR_RC`. R1 completion does not
verify production mTLS or staging. Do not start RELEASE-003 in the same work
item.

RELEASE-003 through RELEASE-005 remain independently `READY`; no other item
is selected here. See
[RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
