# IMPLEMENTATION HANDOFF

## Next Task

TASK-060 — User Offboarding Orchestration

Feature: F-004/OFFBOARDING

Workflow: WF-ID04/WF-019

Phase/Priority: P3 / P0

Dependency readiness: SATISFIED (TASK-003, TASK-015, TASK-058)

Status: BLOCKED — SPEC_CONFLICT

Task contract: `tasks/TASK-060_USER_OFFBOARDING_ORCHESTRATION.md`

## Previous Task Completed

TASK-058 — License Assignment + Reclaim + Compliance (`CODE_COMPLETE`)

- Added License-owned assignments, deployment reservations, immutable histories,
  reclaim verification, usage evidence, and compliance findings.
- Software deployment reserves before Agent dispatch, activates only after a
  successful post-check, releases only after a safe pre-execution failure, and
  retains reservations for uncertain execution.
- Unsupported models and missing/stale usage evidence report `UNKNOWN`;
  principal validation stays at the Identity/Asset application boundaries.
- Applied migration and permission seed to local PostgreSQL.
- `npm test` passed (58 tests: 22 unit, 2 contract, 1 migration, 18 integration,
  15 E2E); typecheck, lint, format check, and `git diff --check` passed.

## TASK-060 Readiness and Blocker

All declared prerequisites are complete. A normative conflict remains:
TASK-058 permits reclaim only from `ACTIVE`/`SUSPENDED`, while offboarding must
release user License allocations and `ASSIGNED` (not activated) allocations
also consume capacity. Leaving one behind prevents clearance; treating it as
reclaimed would invent a transition.

Keep implementation paused at this boundary. TASK-060 proposes a narrow,
audited License command to cancel an unactivated assignment, with expected
version and reason. The specification owner must resolve this before that
transition is implemented. Meanwhile, offboarding can safely report such a
case as blocked/unresolved.

## Repository State

- Branch: `master`
- TASK-058 implementation and completion report are committed in repository
  history.
- No generated task artifacts or temporary repository files were removed.
