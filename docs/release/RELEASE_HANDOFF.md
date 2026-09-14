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
- RELEASE-002 is `CODE_COMPLETE`, not `VERIFIED`; real private CA provisioning
  and mTLS validation through the RELEASE-007 staging topology remain open.
- RELEASE-003-R1 is `CODE_COMPLETE`; RELEASE-003 runtime is
  `CODE_COMPLETE / NOT VERIFIED`. Staging/orchestrator verification remains.
  See
  [RELEASE-003-R1](items/RELEASE-003-R1_PRODUCTION_READINESS_CRITICAL_WORKER_CONTRACT.md).
- RELEASE-004-R1 is `CODE_COMPLETE`; RELEASE-004 is `READY / NOT_STARTED`.
  Its authoritative Linux/Docker Compose v2 contract is at
  [RELEASE-004-R1](items/RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md).
- Unrelated user change in `AGENTS.md` is preserved and must remain outside
  release-planning commits unless a later explicit scope requires a separate
  relevant edit.

## Next action

RELEASE-001 runtime has full automated verification but still requires a real
staging IdP before `VERIFIED`; RR-01 remains open. RELEASE-002 runtime and
automated tests are complete under its R1 mTLS contract, but real CA
provisioning and staging topology validation remain before `VERIFIED`.
RELEASE-003 runtime is implemented and automated checks pass; staging/
orchestrator verification remains required before `VERIFIED`. RELEASE-004-R1
resolves the deployment decisions and authorizes a separate implementation
activity using one OCI image promoted unchanged through Docker Compose v2 on a
Linux host. The selected v1 deployment is single-host and explicitly not HA.
The production operator runs the versioned deployment command; the server
pulls but never builds the image. See the R1 contract before implementation.
Do not begin RELEASE-005, RELEASE-006, or RELEASE-007 in that activity.

## Release order

RELEASE-004 and RELEASE-005 are independently READY. RELEASE-006 waits for
RELEASE-004 and RELEASE-005; RELEASE-007 waits for RELEASE-004; the final
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
