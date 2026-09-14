# TASK-096-R2 Implementation Report

**Status:** `CODE_COMPLETE`
**Scope:** Incident and Asset owner-domain recommendation-source read adapters

## Delivered

- Incident now exports a tenant-scoped, read-only query for the latest current
  `REVIEW_REQUIRED` correlation decision per Incident. It excludes
  `AUTO_LINK`, `NO_LINK`, superseded decisions, completed human reviews,
  active detach suppressions, ineligible/terminal Incidents, and invalid
  candidate Roots. It preserves the immutable decision/evaluation identity,
  score/confidence, profile/version, reason and structured candidate evidence.
- Asset now exports a tenant-scoped, read-only query for active
  `UNDER_REVIEW` replacement candidates bound to their exact assessment. The
  assessment must still be the Asset's current scoring projection, valid at
  `as_of`, and banded `PLAN` or `PRIORITY`; Asset eligibility reuses the
  canonical TASK-094 lifecycle set. Stable source generation combines
  candidate ID/version and assessment ID.
- Both queries require narrow source read permissions at collection and
  resource scope, validate tenant identity, provide bounded deterministic
  pagination, and distinguish `AVAILABLE`, `AVAILABLE_EMPTY`, and
  `SOURCE_UNAVAILABLE`. Query errors roll back to a savepoint so callers can
  continue the enclosing transaction safely.
- TASK-093 already exposes session reads and canonical recommendation
  eligibility/presentation checks, including publication version and audience
  authorization. No third adapter was needed.

## Boundaries and persistence

The adapters live and are exported from the Incident and Asset owning modules;
they do not introduce a Recommendation module, recommendation/revision/
interaction tables, migration, worker or API route. Source reads perform no
correlation, candidate, assessment, Procurement, Work Queue, Asset lifecycle,
or TASK-091 writes. No source payload bodies or unrelated financial data are
returned.

## Acceptance coverage

`tests/integration/task096-r2-recommendation-sources.test.ts` covers:

1. Incident REVIEW selection and preservation of canonical generation,
   profile, reasons and candidate evidence; excludes AUTO/NO_LINK,
   superseded, manually reviewed, attached and suppressed decisions; validates
   tenant/context and per-resource authorization.
2. Active PLAN/PRIORITY candidate selection bound to the latest fresh
   assessment; excludes REVIEW, terminal, stale and mismatched assessments;
   validates tenant and Asset/scoring authorization.
3. Distinguishes available-empty from query failure for both adapters.
4. Injected PostgreSQL read failure returns unavailable after savepoint
   rollback, leaving the surrounding transaction usable.

## Verification

- `npm test` — passed, **189 tests**: 68 unit/architecture, 2 contract,
  6 migration, 54 PostgreSQL integration, 59 E2E.
- `npm run typecheck` — passed.
- `npm run lint` — passed, including dependency-boundary checks.
- `npm run format:check` — passed.
- `npm run test:migration` — passed against local PostgreSQL.
- `git diff --check` — passed.

`npm test` used the repository's local `TEST_DATABASE_URL` mechanism; its
credentials were not printed or persisted.

## State reconciliation and limits

TASK-096-R2 is `CODE_COMPLETE`; its source-boundary dependency is cleared.
TASK-096 is `READY / NOT_STARTED`. Recommendation aggregation, projection and
interaction runtime remain unimplemented. TASK-097 remains
`WAITING_DEPENDENCY / NOT_STARTED` and was not started.

Incident correlation decisions do not define a separate TTL, so the adapter
rechecks current TASK-092 reviewability but does not invent a freshness
duration. Replacement freshness follows the canonical TASK-094
`calculated_at`/`valid_until` assessment validity.
