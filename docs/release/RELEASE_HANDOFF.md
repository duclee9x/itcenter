# Release Planning Handoff

## Current position

- Product implementation roadmap: complete through Phase 5; TASK-097 is
  `CODE_COMPLETE / VERIFIED`.
- Product roadmap is frozen for this planning activity. Do not create
  TASK-098 or open Phase 6.
- Release decision: `BLOCKED_FOR_RC` until the items in
  [RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) are verified.
- Release-readiness assessment: commit `3a0cda2`.
- Current release item: RELEASE-001, `CODE_COMPLETE`; automated acceptance
  passes, while real OIDC provider/staging verification remains open.
- Unrelated user change in `AGENTS.md` is preserved and must remain outside
  release-planning commits unless a later explicit scope requires a separate
  relevant edit.

## Next action

RELEASE-001-R1 — Production Authentication Contract and RELEASE-001-R2 —
Explicit Tenant Context & Membership Foundation are persisted and
`CODE_COMPLETE`. RELEASE-001 runtime is `CODE_COMPLETE` with full automated
verification. Real IdP configuration and staging acceptance remain required
before `VERIFIED`; RR-01 therefore remains release-blocking. Do not start
RELEASE-002 automatically. RELEASE-002 through RELEASE-005 remain available
in the backlog, but no next item is selected here.

## Release order

The current independent READY items are RELEASE-001 through RELEASE-005.
RELEASE-006 waits
for RELEASE-004 and RELEASE-005; RELEASE-007 waits for RELEASE-004; the final
RELEASE-GATE-001 waits for every initial remediation item to be verified.
Follow [RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).

## Scope boundaries

- Do not alter `tasks/CODEX_TASK_REGISTRY.md` or product task readiness to
  represent release work.
- Do not include known non-blocking repair-cost limitations or PostgreSQL
  client deprecation debt in the blocking backlog unless launch scope changes.
- Keep runtime fail-closed behavior until real production adapters are
  configured and verified.
- Keep `AGENTS.md` unrelated working-tree changes unstaged and uncommitted.
