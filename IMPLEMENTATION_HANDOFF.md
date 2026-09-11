# IMPLEMENTATION HANDOFF

## Active Task

TASK-030 — Monitoring Ingestion + Normalization + Dedupe

Feature: F-017
Workflow: WF-003
Branch: master

## Overall Status

CODE_COMPLETE

TASK-030 monitoring ingestion and normalization verification passed.

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
- Added audit checksum/hash-chain metadata, tenant-scoped audit queries and
  integrity verification.
- Added migration and integration coverage for audit query/integrity controls.
- Added tenant-scoped asset registry schema and asset create command with
  idempotency, `ASSET.CREATED` outbox and audit.
- Added E2E coverage for asset creation and idempotent replay.
- Fixed migration runner ordering so identity schema is applied before asset.
- Added movement persistence with source/destination location and user.
- Added transfer validation, assignment history preservation, and `ASSET.TRANSFERRED` effects.
- Added `ASSET.REQUEST_RETURN` and `ASSET.RECEIVE_RETURN` commands with pending/returned state handling.
- Added immutable return documents, condition grades, return movement, and return E2E coverage.
- Added monitoring event normalization, persistence, tenant/source/provider-event dedupe,
  idempotency, critical/recovered outbox events, audit and API permission enforcement.
- Added incident persistence, create/state transition commands, state invariants,
  idempotency, outbox and audit effects.
- Added root incident relations, child incident/ticket correlation command,
  tenant checks, unique dedupe constraint, outbox and audit effects.
- Added major incident declaration and communication publication records with
  channel/audience validation, idempotency, outbox and audit effects.

## Verification State

PASS: `npm test`, `typecheck`, `format:check`, `lint` and `build`, with
`TEST_DATABASE_URL` pointed at the running PostgreSQL container so migration,
integration and E2E database gates used disposable databases.

PASS: `./local serve` connected to the running PostgreSQL container on the
published port `127.0.0.1:15432`; API readiness returned HTTP 200.

TASK-034 complete: major incident declaration and communication publication
are implemented with channel/audience validation, idempotency, outbox and audit.

MIGRATION_RISK: the existing local volume rejects `npm run db:migrate` because
an applied migration checksum differs. Do not edit migration history or reset
the volume automatically; restore the original migration or add a forward
migration before applying schema changes.

## Exact Next Step

TASK-035 is next; proceed only through the task registry workflow.

## SPEC_CONFLICT

None.

## SCOPE_DEPENDENCY

None.
