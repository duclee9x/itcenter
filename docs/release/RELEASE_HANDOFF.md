# Release Planning Handoff

## Current position

- Product implementation roadmap: complete through Phase 5; TASK-097 is
  `CODE_COMPLETE / VERIFIED`.
- Product roadmap is frozen for this planning activity. Do not create
  TASK-098 or open Phase 6.
- Release decision: `BLOCKED_FOR_RC` until the items in
  [RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) are verified.
- Release-readiness assessment: commit `3a0cda2`.
- Current release item: RELEASE-001, `NOT_STARTED / BLOCKED` by
  `SECURITY_DECISION / SPEC_GAP`.
- Unrelated user change in `AGENTS.md` is preserved and must remain outside
  release-planning commits unless a later explicit scope requires a separate
  relevant edit.

## Next action

Resolve [RELEASE-001-R1 — Production Authentication Contract](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md).
The existing contracts distinguish authentication from authorization,
prefer OIDC/OAuth2 for human users and mTLS/workload identity for services,
define fail-closed ports, and specify tenant-scoped RBAC. They do not choose a
production identity provider or a complete API credential/session and
principal-mapping flow. Do not select one by assumption.

Once the R1 security decisions are approved and normative, update the RELEASE
backlog item and derive readiness again. Only then may RELEASE-001 move to
`READY / NOT_STARTED`; this handoff does not authorize runtime work before
that state is persisted.

## Release order

The current independent READY items are RELEASE-002 through RELEASE-005
except RELEASE-001, which is blocked by its contract gap. RELEASE-006 waits
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
