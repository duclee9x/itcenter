# IMPLEMENTATION HANDOFF

## Active Task

TASK-004 — Command, Idempotency, Outbox, Inbox + Operation Hardening

Feature: FOUNDATION
Workflow: PLATFORM-CONTROL
Branch: master

## Overall Status

CODE_COMPLETE

## Completed

- Added `identity.sessions` migration with tenant/user foreign key, expiry,
  revocation, version and active-session index.
- Added OIDC claim validation and active-user session creation/revocation
  helpers.
- Added `/api/v1/me` authentication boundary and logout route wiring with
  authorization, outbox and audit writes.
- Logout now requires `Idempotency-Key` and executes through the durable,
  tenant/principal/session scoped idempotency ledger.
- Session use now locks the authoritative row and requires the canonical user
  to remain active.
- Added regression coverage for invalid session durations and authoritative
  session-use checks.
- Added the OIDC login application use case: verified claims create a session
  and emit success audit/outbox effects; failed authentication emits failure
  audit/outbox effects without recording a token.
- Added unit coverage for verified OIDC login and success effects.
- Updated migration coverage for the session table.
- Replaced stale prompt examples with reusable current-task and handoff
  templates.

## Remaining Work

- TASK-002 completed at `c518d48`; TASK-003 completed at `7b7c2c0`.
- Existing idempotency, outbox, inbox and operation foundations are the
  starting point for TASK-004.
- Added versioned operation state transitions with allowed-state validation.
- Added outbox claim/attempt and tenant-scoped publication marking.
- Added explicit expired-idempotency-key conflict behavior.
- Added PostgreSQL integration coverage for operation and outbox hardening.

## Verification State

PASS: `npm test`, `typecheck`, `format:check`, `lint` and `build`.

NOT RUN: none for TASK-004 acceptance criteria.

## Exact Next Step

Proceed to TASK-005 only through the task registry workflow.

## SPEC_CONFLICT

None.

## SCOPE_DEPENDENCY

None.
