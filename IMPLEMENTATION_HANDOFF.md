# IMPLEMENTATION HANDOFF

## Next Task

TASK-060 — User Offboarding Orchestration

Feature: F-004/OFFBOARDING

Workflow: WF-ID04/WF-019

Phase/Priority: P3 / P0

Readiness: BLOCKED (SPEC_CONFLICT in offboarding state-machine transitions)

Status: BLOCKED

Task contract: `tasks/TASK-060_USER_OFFBOARDING_ORCHESTRATION.md`

## Previous Task Completed

TASK-058-R1 — Cancel Unactivated License Assignment (`CODE_COMPLETE`)

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

The previous `SPEC_CONFLICT` is resolved. Offboarding must route `ASSIGNED` to
`LICENSE.CANCEL_ASSIGNMENT`, `ACTIVE`/`SUSPENDED` to `LICENSE.RECLAIM`, and
terminal/non-capacity states to no-op. Cancellation/reclaim failures must stay
actionable and cannot count as completed License clearance.

TASK-060 cannot safely start until the normative offboarding transition graph is
defined. `docs/STATE_MACHINE_MASTER_SPEC.md` §69 lists the eight states but no
allowed edges; §107 only states the `READY_TO_CLOSE → COMPLETED` dependency.
The task contract requires enforcing normative transitions and forbids
inferring transitions from the state list. License cancellation/reclaim routing
is already resolved. Await the transition policy decision before implementing
TASK-060. TASK-056 remains dependency-ready at P1, but TASK-060 is the P0 task
currently blocked by this specification conflict.
