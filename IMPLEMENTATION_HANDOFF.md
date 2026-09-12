# IMPLEMENTATION HANDOFF

## Current Task — TASK-059

Replacement + Retirement + Disposal + Data Wipe

Feature: F-037/F-038
Workflow: WF-017/WF-018
Phase/Priority: P3 / P1
Readiness: READY
Status: NOT_STARTED

Task contract: `tasks/TASK-059_REPLACEMENT_RETIREMENT_DISPOSAL_DATA_WIPE.md`

## Registry Reconciliation

- TASK-015 `CODE_COMPLETE`: registry/task report agree; implementation commit
  `32c3267` contains Asset return commands, immutable documents and E2E tests.
- TASK-036 `CODE_COMPLETE`: registry/task report agree; implementation commit
  `e043c31` contains Approval requests/decisions, separation of duties,
  audit/outbox and full verification.
- TASK-038 `CODE_COMPLETE`: registry/task report agree; implementation commit
  `296336a` contains Maintenance/Warranty persistence, protected transitions,
  audit/outbox and full verification.
- TASK-059 is `NOT_STARTED`, has no explicit blocker and no unresolved
  `SPEC_CONFLICT`; readiness is therefore derived as `READY`.
- TASK-061 remains `BLOCKED` because TASK-059 is not yet `CODE_COMPLETE`.
- This is a registry/planning update only. Do not implement TASK-059 until the
  user explicitly asks to continue.

## Last Completed Task — TASK-056

Unauthorized Software Detection + Resolution (`CODE_COMPLETE`; commit
`89857bd`). See `tasks/TASK-056_UNAUTHORIZED_SOFTWARE_DETECTION_RESOLUTION.md`.

- Implemented tenant-scoped software inventory normalization, deterministic
  catalog aliases, unauthorized detection, exceptions and actionable Work
  Queue references.
- Added approval and policy decisions, bounded safe symbolic removal jobs,
  agent claims/reports, retries and later complete-inventory verification.
- Added migrations, tenant-scoped APIs, audit/outbox events, permissions,
  specifications/traceability and database-backed E2E tests.
- Verification passed: `npm test` (65 tests), typecheck, lint, format check,
  migration tests and `git diff --check`.
- Assumptions: UNKNOWN grace defaults to 72 hours; OS-specific uninstall
  adapters are out of scope and unsupported adapters fail closed.

## Earlier Completed Task — TASK-060

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
