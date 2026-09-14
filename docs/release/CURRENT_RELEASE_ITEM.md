# Current Release Item

| Field         | Value                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| Selected item | RELEASE-001 — Production API Authentication & Authorization Adapter       |
| Priority      | P0                                                                        |
| Status        | `NOT_STARTED`                                                             |
| Readiness     | `READY`                                                                   |
| Blocker       | None — R1 and R2 contracts complete; runtime adapter remains outstanding. |
| Contract      | RELEASE-001-R1 and RELEASE-001-R2 (`CODE_COMPLETE`)                       |

RELEASE-001 is selected by deterministic P0 order and foundational impact:
the executable API currently fails closed because production authentication
and authorization adapters are not wired. R1 fixes provider-neutral OIDC
access-token semantics; R2 fixes required `X-Tenant-ID` selection and the
IdentityLink-to-tenant-local-User membership model. RELEASE-001 is eligible to
start, but no runtime work is included in these planning contracts.

The decisions are persisted in
[RELEASE-001-R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md)
and [RELEASE-001-R2](items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md).
The global release decision remains `BLOCKED_FOR_RC` until runtime blockers
are cleared. Do not automatically start RELEASE-002.

The rest of the derived READY list is RELEASE-002, RELEASE-003, RELEASE-004,
and RELEASE-005. See [RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
