# Release Planning Handoff

## Current position

- Product implementation roadmap: complete through Phase 5; TASK-097 is
  `CODE_COMPLETE / VERIFIED`.
- Product roadmap is frozen for this planning activity. Do not create
  TASK-098 or open Phase 6.
- Release decision: `BLOCKED_FOR_RC` until the items in
  [RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) are verified.
- Release-readiness assessment: commit `3a0cda2`.
- RELEASE-001 is `CODE_COMPLETE`, not `VERIFIED`; real OIDC provider/staging
  validation remains open.
- Current release item: RELEASE-002-R1, planning only. RELEASE-002 runtime is
  `BLOCKED / NOT_STARTED` by an unresolved Agent-authentication
  `SECURITY_DECISION / SPEC_GAP`.
- Unrelated user change in `AGENTS.md` is preserved and must remain outside
  release-planning commits unless a later explicit scope requires a separate
  relevant edit.

## Next action

RELEASE-001 runtime has full automated verification but still requires a real
staging IdP before `VERIFIED`; RR-01 remains open. TASK-091 specifies an
authenticated enrolled Agent and exact Agent/tenant/execution binding, but
does not select production credential, enrollment, rotation/revocation,
replay or authenticated-channel semantics. Resolve the security decisions in
[RELEASE-002-R1](items/RELEASE-002-R1_PRODUCTION_AGENT_AUTHENTICATION_CONTRACT.md)
before starting RELEASE-002 runtime. Do not start RELEASE-003 automatically.

## Release order

The current independent READY items are RELEASE-003 through RELEASE-005.
RELEASE-002 is blocked by R1 security decisions. RELEASE-006 waits
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
