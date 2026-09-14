# Current Release Item

| Field         | Value                                                                 |
| ------------- | --------------------------------------------------------------------- |
| Selected item | RELEASE-001 — Production API Authentication & Authorization Adapter   |
| Priority      | P0                                                                    |
| Status        | `NOT_STARTED`                                                         |
| Readiness     | `READY`                                                               |
| Blocker       | None — R1 contract complete; runtime adapter remains outstanding.     |
| Contract      | RELEASE-001-R1 — Production Authentication Contract (`CODE_COMPLETE`) |

RELEASE-001 is selected by deterministic P0 order and foundational impact:
the executable API currently fails closed because production authentication
and authorization adapters are not wired. R1 has now fixed the normative
provider-neutral OIDC access-token, identity-link, tenant-membership and
authorization contract. RELEASE-001 is eligible to start, but no runtime work
is included in this R1 completion.

The R1 decisions are persisted in
[RELEASE-001-R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md).
The global release decision remains `BLOCKED_FOR_RC` until runtime blockers
are cleared. Do not automatically start RELEASE-002.

The rest of the derived READY list is RELEASE-002, RELEASE-003, RELEASE-004,
and RELEASE-005. See [RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
