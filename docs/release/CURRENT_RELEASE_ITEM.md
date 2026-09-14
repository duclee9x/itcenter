# Current Release Item

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Selected item | RELEASE-001 — Production API Authentication & Authorization Adapter                               |
| Priority      | P0                                                                                                |
| Status        | `CODE_COMPLETE`                                                                                   |
| Readiness     | `N/A`                                                                                             |
| Blocker       | Automated acceptance passes; real OIDC provider/staging validation is required before `VERIFIED`. |
| Contract      | RELEASE-001-R1 and RELEASE-001-R2 (`CODE_COMPLETE`)                                               |

RELEASE-001 is selected by deterministic P0 order and foundational impact:
the executable API remains fail-closed until production OIDC is configured.
R1 fixes provider-neutral OIDC
access-token semantics; R2 fixes required `X-Tenant-ID` selection and the
IdentityLink-to-tenant-local-User membership model. RELEASE-001 runtime
implementation is `CODE_COMPLETE`; real provider/staging acceptance remains
open before `VERIFIED`.

The decisions are persisted in
[RELEASE-001-R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md)
and [RELEASE-001-R2](items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md).
The global release decision remains `BLOCKED_FOR_RC` until runtime blockers
are cleared. Do not automatically start RELEASE-002.

RELEASE-002 through RELEASE-005 remain independently `READY`; no next item is
selected here. See [RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
