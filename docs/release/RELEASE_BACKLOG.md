# Release Remediation Backlog

**Baseline:** Phase 5 passed; TASK-097 `CODE_COMPLETE / VERIFIED` at
`af42b52`. Release-readiness documentation is committed at `3a0cda2`.
**Current release decision:** `BLOCKED_FOR_RC`.
**Product roadmap:** frozen. This backlog is separate from
`tasks/CODEX_TASK_REGISTRY.md`; its entries are release-readiness work, not
product implementation tasks. No TASK-098 or Phase 6 is created.

## Status model

Each entry records a `status` and a derived `readiness` independently.

- **Status:** `NOT_STARTED`, `IN_PROGRESS`, `CODE_COMPLETE`, `VERIFIED`, or
  `BLOCKED`.
- **Readiness:** `READY`, `WAITING_DEPENDENCY`, `BLOCKED`, or `N/A`.
- `READY` requires `status = NOT_STARTED`, every declared release-item
  dependency `VERIFIED` (or an equivalent explicitly accepted state), and no
  unresolved blocker/specification/security decision.
- Readiness is recalculated from the graph whenever an item is verified; a
  stored value is not authoritative by itself.
- Verification requires the item’s stated evidence and acceptance checks. A
  completed code change alone is not `VERIFIED`.

## Initial release items

These are exactly the seven remediation items and one final gate authorized
for this backlog. Initial P0 entries are listed in priority order.

| ID               | Title                                                     | Priority | Status        | Readiness            | Dependencies                    | Blocker / note                                                                                                                                                               |
| ---------------- | --------------------------------------------------------- | -------: | ------------- | -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RELEASE-001      | Production API Authentication & Authorization Adapter     |       P0 | `NOT_STARTED` | `BLOCKED`            | None                            | `SECURITY_DECISION / SPEC_GAP`; production identity provider, credential/session flow and principal/tenant mapping are not normatively selected. R1 planning child required. |
| RELEASE-002      | Production Agent Authentication for TASK-091              |       P0 | `NOT_STARTED` | `READY`              | None                            | Use a real enrolled-Agent identity; retain fail-closed behavior.                                                                                                             |
| RELEASE-003      | Worker Readiness & Background Processing Health           |       P0 | `NOT_STARTED` | `READY`              | None                            | Readiness must reflect actual required worker dependencies.                                                                                                                  |
| RELEASE-004      | Immutable Build / Staging / Promotion / Rollback Pipeline |       P0 | `NOT_STARTED` | `READY`              | None                            | Produce and promote one immutable artifact.                                                                                                                                  |
| RELEASE-005      | Backup / Restore + RPO / RTO Validation                   |       P0 | `NOT_STARTED` | `READY`              | None                            | Restore must be tested; define and approve RPO/RTO.                                                                                                                          |
| RELEASE-006      | PostgreSQL Migration Rehearsal + N-1 Compatibility        |       P0 | `NOT_STARTED` | `WAITING_DEPENDENCY` | RELEASE-004, RELEASE-005        | Must use the verified artifact and recovery path.                                                                                                                            |
| RELEASE-007      | Production TLS Ingress + Rate Limiting                    |       P0 | `NOT_STARTED` | `WAITING_DEPENDENCY` | RELEASE-004                     | Validate controls against the actual release topology.                                                                                                                       |
| RELEASE-GATE-001 | Release Candidate Readiness Re-verification               |     Gate | `NOT_STARTED` | `WAITING_DEPENDENCY` | RELEASE-001 through RELEASE-007 | Run only after each required item is verified and all blockers are cleared.                                                                                                  |

RELEASE-001 remains the selected first item because it blocks normal
production API access. Its readiness is blocked pending the focused
contract decision; it must not enter runtime implementation until that
decision is resolved. Current release item and handoff are recorded in
[CURRENT_RELEASE_ITEM.md](CURRENT_RELEASE_ITEM.md) and
[RELEASE_HANDOFF.md](RELEASE_HANDOFF.md).

## Dependency source and exclusions

The authoritative release dependency graph is
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md). The graph contains
only the dependencies expressly approved for these release items.

Known limitations that do not block the currently assessed release scope,
including unavailable canonical repair-cost evidence and the PostgreSQL
deprecation warning, remain in
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). They are not added to this
blocking backlog unless the approved release scope changes.

## Decision boundary

This planning pass creates no runtime implementation and changes no product
task registry semantics. RELEASE-001 has an unresolved authentication
contract, documented in
[RELEASE-001-R1 — Production Authentication Contract](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md).
No provider, protocol flow, or implementation is selected here.
