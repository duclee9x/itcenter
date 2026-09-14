# Current Release Item

| Field          | Value                                                               |
| -------------- | ------------------------------------------------------------------- |
| Selected item  | RELEASE-001 — Production API Authentication & Authorization Adapter |
| Priority       | P0                                                                  |
| Status         | `NOT_STARTED`                                                       |
| Readiness      | `BLOCKED`                                                           |
| Blocker        | `SECURITY_DECISION / SPEC_GAP`                                      |
| Planning child | RELEASE-001-R1 — Production Authentication Contract                 |

RELEASE-001 is selected by deterministic P0 order and foundational impact:
the executable API currently fails closed because production authentication
and authorization adapters are not wired. This selection does not authorize
runtime implementation. Existing specifications list acceptable/preferred
mechanisms but do not select the deployment identity provider or resolve the
API token/session and canonical identity integration contract.

The next action is to resolve the normative questions in
[RELEASE-001-R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md).
After its decisions are approved and persisted, recalculate RELEASE-001
readiness. Do not implement by choosing defaults in code.

The rest of the derived READY list is RELEASE-002, RELEASE-003, RELEASE-004,
and RELEASE-005. See [RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
