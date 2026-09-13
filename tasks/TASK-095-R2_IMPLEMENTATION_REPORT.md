# TASK-095-R2 Implementation Report — Historical State Timeline Foundation

Status: `CODE_COMPLETE`.

R2 supplies the Incident and Work Queue state history needed to reconstruct
missed point-in-time Reporting snapshots. It does not implement KPI drill-down,
finish TASK-095, or begin TASK-096.

## Persistence and migration

Added `incident.state_transitions` and
`operations.work_item_state_transitions`, with tenant/entity foreign keys,
append-only enforcement, effective and recorded timestamps, source/provenance
fields, coverage kind and a deterministic entity transition sequence. The
Incident and Work Queue migrations install narrow PostgreSQL triggers and
create one `CREATE` anchor for new rows.

Pre-existing rows receive one `LEGACY_BASELINE` at migration time with the
then-current state and version. This is forward-only coverage: it does not
claim the state was known between original entity creation and the migration
anchor. No earlier lifecycle transitions are fabricated. Existing current
state and tenant ownership are preserved.

## Trigger guarantees and limits

Triggers append history only when the canonical lifecycle state changes.
Metadata-only updates and same-state replays add no row. Tenant and entity
identity are copied from the canonical `NEW` row; uniqueness and foreign keys
protect identity and sequence. The state mutation and history append run in the
same PostgreSQL transaction, so a trigger/history failure aborts the state
change. An initial insert creates exactly one `CREATE` anchor.

Triggers provide persistence atomicity only. They do not decide authorization,
whether a lifecycle transition is legal, reporting semantics, Root correlation,
or audit/outbox/timeline effects. They publish no events and do not duplicate
application audit or outbox effects. Domain commands remain responsible for
authorization and expected-version checks. Incident transition sequence uses
the committed entity version; Work Queue uses the entity version in the same
way. Equal effective timestamps are ordered by sequence.
Replaying a transition command with its consumed entity version fails its
expected-version check and leaves exactly one committed transition record.

The trigger actor/source fields identify the history mechanism, not the
initiating human actor or command. This preserves historical state evidence;
normal audit/outbox records remain the source for actor and event provenance.

## Query/application boundaries

Added Incident-owned `queryIncidentStateAt` and
`queryActiveIncidentEpisodesAt`, plus Work Queue-owned `queryWorkItemStateAt`
and `queryActionableWorkItemsAt`. They use effective transitions and
domain-owned active/actionable semantics, enforce transaction tenant scope,
and do not query history from Reporting.

Per-entity state queries distinguish `KNOWN_STATE`, `NOT_YET_CREATED`,
`INSUFFICIENT_HISTORY` and `UNAVAILABLE` (the latter for absent or
cross-tenant identity). Aggregate queries return `COMPLETE` or `PARTIAL`;
when any in-scope legacy row predates its anchor, they return partial coverage
without presenting a guessed count basis. Query infrastructure errors
propagate; they are not translated into an empty result. A successful query
with no active/actionable entities returns complete coverage and an empty ID
set.

Incident episodes use Root membership active at the requested instant, with
the half-open interval `[linked_at, detached_at)`. Episode identity is the
active Root ID or otherwise the Incident ID. A Root relation groups episodes;
it does not propagate Asset or Incident membership to siblings. Current Root
links cannot rewrite earlier snapshots.

## Verification

The full uninterrupted repository run completed successfully, including E2E:

- `npm test`: 167 passed, 0 failed (61 unit/architecture, 2 contract,
  5 migration, 42 integration, 57 E2E).
- `npm run typecheck`: passed.
- `npm run lint`: passed, including boundary checks.
- `npm run format:check`: passed.
- `npm run test:migration`: 5 passed, 0 failed against local PostgreSQL.
- `tests/integration/task095-r2-state-history.test.ts`: 3 PostgreSQL tests
  passed as part of the integration suite.
- `git diff --check`: passed.

The R2 integration and migration coverage verifies state changes versus
metadata/same-state updates, a single creation anchor, trigger-failure rollback
for both domains, visibility within the committing transaction, legacy
forward-only coverage, NOT_YET_CREATED versus insufficient history, tenant
isolation, equal-timestamp sequence ordering, expected-version race behavior,
late point-in-time Work Queue counts, and Root attach/detach boundaries.

## Limitations

Legacy state before the migration anchor is intentionally unavailable. The
history trigger records technical actor/source markers; actor-level audit and
domain events remain governed by existing command/audit/outbox paths. R2 does
not close TASK-095 acceptance, add drill-down, or change any KPI definition.
