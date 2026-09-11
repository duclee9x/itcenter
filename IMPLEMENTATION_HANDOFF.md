# IMPLEMENTATION HANDOFF

## Active Task

TASK-003 — Authorization Scopes + Privileged Access

Feature: F-002
Workflow: WF-ID02
Branch: master (repository has no commits yet)

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

- TASK-002 is complete at commit `c518d48`.
- TASK-003 task contract has been created from the registry and required specs.
- Existing RBAC evaluator and temporary grant migration are the starting point.
- Added tenant-first active-user authorization filtering.
- Added versioned, revocable temporary grant persistence helpers and migration.
- Added temporary grant validation/revocation unit coverage.
- Added temporary-grant create/revoke API commands with `rbac.manage`,
  idempotency, expected version, audit and outbox handling.
- Added E2E coverage for create, replay, key conflict, revoke and cross-tenant
  isolation.

## Verification State

PASS: TASK-002 gates pass at commit `c518d48`; TASK-003 unit, migration,
integration, E2E, typecheck, format, lint and build checks pass.

NOT RUN: none for TASK-003 acceptance criteria.

## Exact Next Step

Proceed to TASK-004 only through the task registry workflow.

## SPEC_CONFLICT

None.

## SCOPE_DEPENDENCY

None.
