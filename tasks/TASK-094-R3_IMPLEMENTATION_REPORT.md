# TASK-094-R3 Implementation Report

## Outcome

`CODE_COMPLETE` — prerequisite runtime foundation only. TASK-094 has returned
to `READY / NOT_STARTED`. TASK-094-R1 remains complete and TASK-094-R2 remains
`CODE_COMPLETE`. TASK-095 was not started.

## Implemented

- Added Incident-owned tenant-scoped `AFFECTED_ASSET` relationships and
  append-only history. Same-tenant Incident/Asset references are constrained
  in PostgreSQL. Manual `INCIDENT.ASSET_LINK`/unlink commands are authorized,
  idempotent, audited and outbox-backed. Database guards prohibit link
  identity rewrites, deletion and history mutation; detach preserves evidence.
- Added explicit intake Asset association and deterministic Monitoring-origin
  association only when the exact same-tenant event has a canonical validated
  Asset. Legacy backfill uses the same deterministic constraints; ambiguous,
  missing and cross-tenant references remain unlinked.
- Added Incident-owned `IncidentAssetHistoryQuery`: reads direct active links,
  derives Root episode identity without propagating Asset links across Root
  siblings, applies its time window and authorization, and distinguishes an
  available empty result from query failure.
- Added Monitoring-owned Asset reliability query and event-to-episode
  resolver. Stable validated source/correlation identity deduplicates event
  redelivery; unresolved identity remains unavailable. Tenant filtering and
  event references support later Incident overlap exclusion.
- Added Maintenance-owned `WarrantyAssetQuery` and UTC calendar-date
  `WARRANTY_STATE_V1`: `ends_at <= as_of` is EXPIRED, through 90 days is
  EXPIRING, and more than 90 days is VALID. No, invalid or ambiguous effective
  Warranty evidence is UNKNOWN with an explicit reason. Overlapping plausible
  records are not resolved by guessing.
- Added the idempotent scheduled Asset Warranty projection refresh, canonical
  state constraint, migration normalization of unsupported legacy projection
  values to UNKNOWN, and narrow permission catalog entries without role
  grants. Aggregate Incident history uses its own narrow permission rather
  than treating an Asset ID as a specific Incident. Warranty source records
  remain Maintenance-owned.
- Updated workflow, API, event, state-machine, data/storage, permission,
  audit/retry and traceability specifications and task state.

No Risk/Replacement assessment, score/profile, useful-life policy, scoring
worker, Work Queue risk item, score-driven TASK-059 candidate, or TASK-095
runtime was introduced. No Asset creation timestamp is used as age evidence.

## Verification

Using the repository's local PostgreSQL test container through the supported
`TEST_DATABASE_URL` mechanism (credentials were neither printed nor saved):

- `npm test` — passed, 153 tests across unit, contract, migration,
  PostgreSQL integration and E2E suites.
- Focused R3 Incident/Monitoring/Warranty integration and Incident API E2E —
  passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed, including boundary checks.
- `npm run format:check` — passed.
- `git diff --check` — passed.
- Migration tests verify conservative legacy Warranty normalization and
  deterministic same-tenant Monitoring-to-Incident Asset backfill; the
  cross-tenant reference remains unvalidated and unlinked.

## Remaining boundary

TASK-094 scoring itself remains unimplemented until explicitly instructed.
Warranty state is a projection and scoring consumers must use the owning
Maintenance query. Incident, Monitoring and Warranty evidence stays behind
its owning-domain boundary. TASK-095 remains unchanged and unstarted.
