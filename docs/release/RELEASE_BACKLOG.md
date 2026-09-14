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

| ID               | Title                                                     | Priority | Status          | Readiness            | Dependencies                    | Blocker / note                                                                                                            |
| ---------------- | --------------------------------------------------------- | -------: | --------------- | -------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| RELEASE-001      | Production API Authentication & Authorization Adapter     |       P0 | `CODE_COMPLETE` | `N/A`                | None                            | Automated acceptance passes; real IdP/staging validation remains before VERIFIED and keeps RR-01 open.                    |
| RELEASE-002      | Production Agent Authentication for TASK-091              |       P0 | `NOT_STARTED`   | `READY`              | None                            | R1 mTLS/Agent credential contract is `CODE_COMPLETE`; runtime remains fail-closed until implemented and staging-verified. |
| RELEASE-003      | Worker Readiness & Background Processing Health           |       P0 | `NOT_STARTED`   | `READY`              | None                            | Readiness must reflect actual required worker dependencies.                                                               |
| RELEASE-004      | Immutable Build / Staging / Promotion / Rollback Pipeline |       P0 | `NOT_STARTED`   | `READY`              | None                            | Produce and promote one immutable artifact.                                                                               |
| RELEASE-005      | Backup / Restore + RPO / RTO Validation                   |       P0 | `NOT_STARTED`   | `READY`              | None                            | Restore must be tested; define and approve RPO/RTO.                                                                       |
| RELEASE-006      | PostgreSQL Migration Rehearsal + N-1 Compatibility        |       P0 | `NOT_STARTED`   | `WAITING_DEPENDENCY` | RELEASE-004, RELEASE-005        | Must use the verified artifact and recovery path.                                                                         |
| RELEASE-007      | Production TLS Ingress + Rate Limiting                    |       P0 | `NOT_STARTED`   | `WAITING_DEPENDENCY` | RELEASE-004                     | Validate controls against the actual release topology.                                                                    |
| RELEASE-GATE-001 | Release Candidate Readiness Re-verification               |     Gate | `NOT_STARTED`   | `WAITING_DEPENDENCY` | RELEASE-001 through RELEASE-007 | Run only after each required item is verified and all blockers are cleared.                                               |

RELEASE-001's R1 and R2 contracts and runtime implementation are
`CODE_COMPLETE`; real provider/staging verification remains outstanding. The
current selected item and handoff are recorded in
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

This release backlog does not change product task registry semantics.
RELEASE-001 runtime implementation is now `CODE_COMPLETE`; this work fulfills
the previously authorized release item and creates no new product feature.
RELEASE-001's authentication and tenant-context
decisions are resolved by [RELEASE-001-R1 — Production Authentication
Contract](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md) and
[RELEASE-001-R2 — Explicit Tenant Context & Membership
Foundation](items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md).
No provider brand is selected; the provider-neutral OIDC profile and sole
`X-Tenant-ID` selector are fixed. Real provider configuration and staging
verification remain open; overall release readiness remains `BLOCKED_FOR_RC`.

RELEASE-002-R1 fixes production Agent authentication as mTLS with one
CA-issued X.509 credential per Agent, trusted registration/enrollment,
credential lifecycle, session/message replay protection, and exact TASK-091
execution binding. RELEASE-002 is `READY / NOT_STARTED`; its gateway remains
fail-closed until runtime implementation. RELEASE-003 is not selected or
started in this planning item.
