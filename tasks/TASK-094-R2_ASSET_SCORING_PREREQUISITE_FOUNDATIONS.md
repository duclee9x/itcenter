# TASK-094-R2 — Asset Scoring Prerequisite Foundations

## Status

`CODE_COMPLETE` — runtime foundations only. TASK-094 scoring remains
`READY / NOT_STARTED` and is not started by this remediation.

## Scope

R2 closes three implementation dependencies without adding Risk or Replacement
assessment runtime:

1. **Maintenance classification and evidence query.** Maintenance owns typed
   `CORRECTIVE`, `PREVENTIVE`, `INSPECTION`, `OTHER` and `UNKNOWN` order
   classification. Existing rows migrate to `UNKNOWN`; normal creation needs
   explicit classification; completed classifications are immutable. The
   owning query returns tenant-scoped completed Asset work in a requested
   interval and exposes UNKNOWN rows as ambiguous evidence. Empty successful
   results return `AVAILABLE` with zero rows; source failure remains an error
   and must be treated as unavailable by the future scoring consumer. The
   query requires the narrow `maintenance.read` permission through the
   tenant-scoped `AuthorizationPort`; catalog registration grants no roles.
2. **TASK-059 candidate application boundary.** The Asset application command
   accepts only scoped `PLAN`/`PRIORITY` assessment recommendation evidence,
   authorizes `replacement.create_candidate`, serializes on the Asset row and
   uses TASK-059 candidate persistence/history and one-active-candidate DB
   uniqueness. It returns explicit creation/update/current/terminal/ineligible/
   conflict outcomes. It does not overwrite progressed human review state or
   recreate a terminal candidate. Material changes persist outbox, audit and
   one review Work Item in the same transaction.
3. **Offboarding recovery state.** The return clearance owns typed
   `PENDING_RETURN`, `RETURNED`, `UNRETURNED` and `MISSING` state with append-only
   history. Asset Risk excludes `MISSING` and is constrained to its canonical
   values. Offboarding consumes the recovery state and no longer reads
   `risk_state` to decide whether an Asset is missing.

R2 does not add Asset Risk/Replacement assessments, formulas, useful-life
policy, scoring worker/history, CRITICAL-risk Work Queue logic or recalculation.
It does not mutate Asset lifecycle/assignment due to recovery state and does
not perform procurement or TASK-091 actions.

## Legacy migration

Legacy Maintenance classification is `UNKNOWN`, without text inference. Legacy
Asset `risk_state=MISSING` is normalized to `UNKNOWN`. Only an exact,
same-tenant, unique Asset Return clearance receives the recovery state
`MISSING`; otherwise Asset lifecycle evidence records an explicit
reconciliation requirement and no Offboarding relationship is fabricated.
The Asset Risk database constraint rejects new noncanonical values.

## Required verification

- typed Maintenance creation/correction, completion immutability, completed
  Asset history, UNKNOWN ambiguity, tenant isolation and empty-query result;
- TASK-059 authorized recommendation create/replay/update, preservation of
  candidate state, terminal suppression, concurrent one-active-candidate,
  and outbox/audit/Work Item behavior;
- Offboarding MISSING/UNRETURNED outside Risk, verified return, idempotency,
  historical legacy migration both linked and ambiguous, and rejection of
  `risk_state=MISSING`;
- full repository tests, typecheck, lint/boundaries, format, migration,
  PostgreSQL integration/E2E and `git diff --check`.

## Completion

Implemented and verified. `npm test` passed all 145 tests, including
PostgreSQL migration, integration and E2E suites. `npm run typecheck`,
`npm run lint` (including boundary checks), `npm run format:check` and
`git diff --check` passed. The local PostgreSQL test environment was supplied
through the existing `TEST_DATABASE_URL` mechanism; its credential was not
persisted or printed.

No Risk/Replacement score, policy, assessment history, worker, Work Queue
scoring behavior or recalculation was implemented. The three R2 prerequisite
boundaries are available for a separately authorized TASK-094 implementation.
