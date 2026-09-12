# IMPLEMENTATION HANDOFF

## Next Task

TASK-060 — User Offboarding Orchestration

Feature: F-004/OFFBOARDING

Workflow: WF-ID04/WF-019

Phase/Priority: P3 / P0

Readiness: READY (TASK-003, TASK-015, TASK-058, TASK-058-R1, TASK-060-R1 satisfied)

Status: NOT_STARTED

Task contract: `tasks/TASK-060_USER_OFFBOARDING_ORCHESTRATION.md`

## Previous Task Completed

TASK-060-R1 — Define Normative Offboarding State Machine (`CODE_COMPLETE`,
specification remediation only)

- Defined the independent Offboarding Case and User Lifecycle state machines,
  normal transitions, cancellation and recovery transitions, terminal rules,
  and COMPLETE-vs-REQUEST_CANCEL concurrency invariant.
- Updated workflow, data model, API command guidance, permissions, events,
  traceability, TASK-060 contract and registry.
- No TASK-060 implementation code was started.

Previous implementation task: TASK-058-R1 — Cancel Unactivated License Assignment (`CODE_COMPLETE`)

- Added explicit `LICENSE.CANCEL_ASSIGNMENT` for only unactivated `ASSIGNED`
  License assignments. The assignment/history remains retained and capacity is
  released once via `CANCELLED` state.
- Added expected-version concurrency handling, idempotent replay/no-op behavior,
  `license.assign` authorization, atomic audit/outbox, and DB guards against
  cancelling active assignments or reactivating cancelled assignments.
- Normative state, data model, API, permission, event, traceability, License and
  offboarding workflows define the cancellation/reclaim routing.
- Applied migration and permission seed to local PostgreSQL.
- `npm test` passed (58 tests: 22 unit, 2 contract, 1 migration, 18 integration,
  15 E2E); typecheck, lint, format check, and `git diff --check` passed.
- Commit: `99c98b8 Implement TASK-058-R1 unactivated license cancellation`.

## TASK-060 Start Boundary

The `SPEC_CONFLICT` is resolved. Offboarding must route `ASSIGNED` to
`LICENSE.CANCEL_ASSIGNMENT`, `ACTIVE`/`SUSPENDED` to `LICENSE.RECLAIM`, and
terminal/non-capacity states to no-op. Cancellation/reclaim failures must stay
actionable and cannot count as completed License clearance.

TASK-060 is `READY` / `NOT_STARTED`. Its implementation has not been authorized
by the latest instruction; wait for an explicit user request before starting.
