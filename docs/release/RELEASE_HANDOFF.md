# Release Planning Handoff

## Current position

- Product implementation roadmap: complete through Phase 5; TASK-097 is
  `CODE_COMPLETE / VERIFIED`.
- Product roadmap is frozen for this planning activity. Do not create
  TASK-098 or open Phase 6.
- Release decision: `BLOCKED_FOR_RC` until the items in
  [RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) are verified.
- Release-readiness assessment: commit `3a0cda2`.
- Current release item: RELEASE-001, `NOT_STARTED / READY`; R1 is
  `CODE_COMPLETE`, and the runtime adapter remains outstanding.
- Unrelated user change in `AGENTS.md` is preserved and must remain outside
  release-planning commits unless a later explicit scope requires a separate
  relevant edit.

## Next action

RELEASE-001-R1 — Production Authentication Contract is persisted and
`CODE_COMPLETE`. It fixes provider-neutral OIDC 1.0, the RFC 9068 JWT access
token profile, local IdentityLink and tenant-membership resolution, local
RBAC, fail-closed behavior, bootstrap/emergency access boundaries and
acceptance tests. RELEASE-001 is now `READY / NOT_STARTED`. Its runtime
adapter has not been implemented. Do not automatically switch to RELEASE-002.

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
