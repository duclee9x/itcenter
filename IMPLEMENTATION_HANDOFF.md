# IMPLEMENTATION HANDOFF

## Next Task

TASK-056 — Unauthorized Software Detection + Resolution

Feature: F-033

Workflow: WF-013

Phase/Priority: P3 / P1

Readiness: READY (TASK-019, TASK-054, TASK-055 satisfied)

Status: NOT_STARTED

Task contract: `GENERATE_ON_READY` (create when implementation starts)

TASK-059 remains blocked; TASK-061 Phase 3 integration gate remains blocked on
TASK-059. TASK-056 is independently dependency-ready.

## Previous Task Completed

TASK-060 — User Offboarding Orchestration (`CODE_COMPLETE`)

- Added durable Identity-owned cases, independent User Lifecycle transitions,
  case/clearance/recovery history, session and access revocation, and
  permissioned, idempotent, versioned commands. Case reconciliation uses a
  short lease to serialize cross-domain work against cancellation/finalization.
- Added Asset return request/cancellation through the Asset application
  contract and License cleanup through License-owned cancellation/reclaim
  commands. Failures and pending actions remain actionable in Operations work
  items and cannot satisfy close conditions.
- Added explicit cancellation and recovery, request-withdrawal evidence,
  authorized exceptions, terminal User guard, audit/outbox events, migrations,
  traceability and command documentation.
- E2E covers Asset return and compensation, both License paths, duplicate start,
  missing-asset blocking/retry, access revocation, actionable pending work,
  cancellation recovery, denial, and the COMPLETE-vs-REQUEST_CANCEL race.
- Verification: `npm test` (62 tests), typecheck, lint, format check, migration
  tests, focused Offboarding E2E, and `git diff --check` passed.
- Assumption: in the absence of an HRIS provider, an authorized operator
  attests termination and withdrawal references. External verification remains
  outside TASK-060 scope.

## Previous Specification Remediation

TASK-060-R1 — Define Normative Offboarding State Machine (`CODE_COMPLETE`)

- Made case/user state machines, cancellation/recovery rules, terminal
  invariants, events and COMPLETE-vs-REQUEST_CANCEL concurrency normative.
- TASK-060 implementation was started only after a later explicit user request.
