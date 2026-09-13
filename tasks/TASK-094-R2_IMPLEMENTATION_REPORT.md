# TASK-094-R2 Implementation Report

**Status:** `CODE_COMPLETE`
**Scope:** prerequisite foundations only; TASK-094 scoring runtime was not
implemented.

## Delivered

- Maintenance now requires typed `CORRECTIVE`, `PREVENTIVE`, `INSPECTION` or
  `OTHER` classification for normal new orders. Legacy rows remain `UNKNOWN`.
  Classification can be corrected with version/reason while work is
  non-terminal and is immutable after completion. The Maintenance-owned,
  tenant-scoped completed Asset history query requires `maintenance.read`
  authorization, reports unknown classifications separately and distinguishes
  an empty result from query failure. Permission registration adds no role
  grants.
- Asset exports an authorized, idempotent TASK-059 Replacement Candidate
  recommendation application command. It accepts only scoped PLAN/PRIORITY
  evidence under a tenant-bound SYSTEM principal, serializes concurrent
  recommendations, preserves human review state, deduplicates active candidates
  and suppresses automatic recreation after terminal disposition. Outcomes are
  explicit; TASK-059 owns candidate persistence, audit, outbox and review work.
- Offboarding Asset return recovery is represented on the Offboarding clearance
  with append-only state history (`PENDING_RETURN`, `RETURNED`, `UNRETURNED`,
  `MISSING`). Offboarding no longer interprets Asset Risk as return status.
  Asset Risk is constrained to `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, `UNKNOWN`.
  Legacy `MISSING` is preserved on an exact unique same-tenant return clearance;
  unlinked evidence is retained for reconciliation without fabricating a
  relationship.
- Added owning-domain migrations, API/application boundaries, audit/outbox
  events, traceability/spec updates and PostgreSQL integration/migration/E2E
  coverage.

## Verification

- `npm test` — passed, 145 tests across unit/architecture, contract,
  PostgreSQL migration, integration and E2E suites.
- `npm run typecheck` — passed.
- `npm run lint` — passed, including repository boundary checks.
- `npm run format:check` — passed.
- `git diff --check` — passed.
- `TEST_DATABASE_URL` used the existing local PostgreSQL container mechanism;
  credentials were neither printed nor persisted.

The suite covers legacy migration preservation and canonical Risk constraint,
typed Maintenance history and ambiguity, candidate authorization/idempotency/
concurrency/terminal suppression, Offboarding recovery state and the absence
of Risk mutation.

## Resulting task state

TASK-094-R2 is `CODE_COMPLETE`. Its three prerequisite dependencies are
resolved. TASK-094 is `READY / NOT_STARTED`; scoring requires separate explicit
authorization. TASK-095 remains unchanged and has not started.
