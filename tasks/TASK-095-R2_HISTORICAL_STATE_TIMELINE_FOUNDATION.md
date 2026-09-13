# TASK-095-R2 — Historical State Timeline Foundation

Status: `CODE_COMPLETE`.

Owns append-only Incident and Work Queue state-transition evidence, tenant-scoped
point-in-time state queries, Root-relation-time episode grouping and fail-closed
legacy coverage. It does not implement KPI drill-down, new KPIs or TASK-096.

Current mutable state is the latest projection; transition history is the
historical evidence. PostgreSQL triggers guarantee only atomic persistence
for state changes and do not own authorization, transition legality, audit or
outbox behavior. Initial creation yields one `CREATE` anchor. Legacy
`LEGACY_BASELINE` anchors do not imply known state before their timestamp.

Root membership at time T uses `[linked_at, detached_at)` and deterministic
episode identity from the relationship effective at T. Query results
distinguish `KNOWN_STATE`, `NOT_YET_CREATED`, `INSUFFICIENT_HISTORY`, and
aggregate `COMPLETE`/`PARTIAL` coverage; infrastructure failures propagate as
unavailable errors instead of empty results.
