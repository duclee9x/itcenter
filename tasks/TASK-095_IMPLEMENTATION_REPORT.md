# TASK-095 Implementation Report — Advanced Reporting + Governed KPI + Analytics

**Status: CODE_COMPLETE**
**Task:** F-048 / WF-RPT01
**Scope:** Governed TASK-095 v1 only; TASK-096 and TASK-097 were not started.

## Delivered

- Added the immutable, system-governed nine-KPI v1 catalog and versioned
  `KPIDefinition` storage. The supported KPI IDs are exactly KPI-001 through
  KPI-009; tenant input cannot define formulas, SQL, code or arbitrary group
  expressions.
- Added tenant-scoped current, historical, catalog, observability,
  contribution drill-down and aggregate CSV routes. Periods and `as_of` use
  UTC `[start,end)` semantics. Catalog responses publish the allow-listed
  dimensions and unsupported query parameters/dimensions fail validation.
- Implemented domain-owned Reporting read ports for Ticket, Incident/Root,
  Work Queue, SLA, Knowledge, Asset scoring and Procurement CostProvenance.
  KPI-002/003 use TASK-095-R2 state-at queries and their forward-only coverage;
  KPI-004 consumes TASK-095-R3 typed Resolution SLA outcomes and canonical
  `completed_at`. No Search index or cross-domain private-table join is used
  by Reporting.
- Implemented each governed formula: canonical non-terminal Tickets; active
  Root-deduplicated Incident episodes; actionable Work Items; MET divided by
  MET + BREACHED typed Resolution obligations; confirmed Knowledge resolution
  ratio; confirmed Known Incident deflection count; current non-stale CRITICAL
  Risk; current non-stale PLAN/PRIORITY assessments; and integer ACTUAL plus
  signed ADJUSTMENT amounts grouped by currency with COMMITTED excluded.
- Added append-only KPI result snapshots and source watermarks. A durable
  tenant/KPI/version/period/dimension lock and unique revision identity make
  identical generations idempotent and material source changes append exactly
  one new immutable revision. Historical queries select the latest revision
  by default and can request a revision explicitly. Closed periods remain
  materializable after the 15-minute operational target; actual generation
  time and late-generation SLO metadata are persisted.
- Added explicit tenant-scoped `SYSTEM_REPORTING` materialization principals
  with an exact capability allow-list. Source query errors roll back to a
  savepoint before returning UNAVAILABLE; historical coverage gaps, ambiguous
  SLA/Knowledge evidence and successful empty datasets retain distinct
  semantics.
- Drill-down candidates follow the same formula/query path and reauthorize
  each underlying Ticket, Incident, Work Queue item, Knowledge session/article,
  Asset or CostProvenance contribution. Aggregate access does not reveal
  unauthorized record identifiers or metadata. CSV uses the same result or
  selected snapshot revision, requires `report.export`, escapes formula-like
  text in the exported representation and writes a metadata-only
  `REPORTING.KPI_CSV_EXPORTED` AuditPort record.
- Preserved `/api/v1/operations/overview`. It has no open-Ticket counter;
  its legacy `open_incidents` row count remains distinct from KPI-002's
  Root-deduplicated episode count. Search remains outside KPI authority.

## Persistence and routes

Reporting migrations add `reporting.kpi_definitions`,
`reporting.kpi_result_snapshots`, `reporting.source_watermarks`, immutable
definition/snapshot guards and scoped `identity.reporting_principals`.
Historical source records remain owned by their domains. Worker entrypoints
reuse the existing reporting snapshot task and can materialize or backfill a
closed UTC period internally; no public arbitrary rebuild endpoint was added.

Routes:

- `GET /api/v1/kpis/catalog`
- `GET /api/v1/kpis/observability`
- `GET /api/v1/kpis/{id}/current`
- `GET /api/v1/kpis/{id}/history`
- `GET /api/v1/kpis/{id}/drilldown`
- `GET /api/v1/kpis/{id}/export.csv`

Permissions are `metric.read`, `report.read` for history, `report.export` for
CSV and narrow `procurement.cost.read` for KPI-009. Drill-down applies the
owning-domain permission separately. The materializer has no wildcard or
tenantless grant.

## Acceptance test mapping

- `tests/unit/task095-reporting.test.ts` — exactly nine definitions, controlled
  dimensions, ratio aggregation by summed numerator/denominator, point-in-time
  series, no fake zero for missing snapshots, source failure semantics, UTC
  timestamp validation and CSV formula escaping.
- `tests/integration/task095-reporting-acceptance.test.ts` — all nine KPI
  formulas; tenant isolation; UTC start/end; non-UTC process timezone;
  Resolution-only SLA purpose, priority filtering and UNKNOWN ambiguity;
  Knowledge confirmation and ambiguity; stale/ineligible Asset scores;
  currency separation; source failure; concurrent worker materialization;
  immutable revisions; late backfill; explicit revision CSV; export audit;
  dimension validation; and per-domain drill-down authorization/leakage.
- `tests/e2e/task095-reporting-overview-compatibility.test.ts` — TASK-039
  Operations Overview HTTP response compatibility.
- `tests/integration/task095-r2-state-history.test.ts` — historical Incident
  state, Root attach/detach intervals, Work Queue state-at, late snapshots and
  pre-anchor coverage used by KPI-002/003.
- `tests/integration/task095-r3-sla-target-purpose.test.ts`,
  `tests/migration/task095-r3-sla-target-purpose.test.ts` and
  `tests/e2e/task095-r3-sla-target-purpose.test.ts` — typed target-purpose,
  canonical finalization time, ambiguity, authorization and legacy fail-closed
  foundation used by KPI-004.

The TASK-095-specific tests comprise **11 tests** (7 unit, 3 PostgreSQL
acceptance integration and 1 HTTP E2E). Existing R2/R3 foundation suites also
run in the repository-wide gates.

## Verification

All commands exited successfully. `npm test` completed through E2E with **185
passed, 0 failed**: 68 unit/architecture, 2 contract, 6 migration, 50
integration and 59 E2E tests. The E2E runner exited successfully.

- `npm test` — pass, 185/185.
- `npm run typecheck` — pass.
- `npm run lint` — pass, including boundary checks.
- `npm run format:check` — pass.
- `npm run test:migration` against local PostgreSQL — pass, 6/6.
- `git diff --check` — pass.
- Dedicated TASK-095 PostgreSQL acceptance — pass, 3/3; unit acceptance —
  pass, 7/7; Operations Overview compatibility E2E — pass, 1/1.

PostgreSQL was accessed through the existing `TEST_DATABASE_URL` wrapper;
credentials were not printed or persisted.

## v1 boundaries and limitations

- No canonical Ticket `service_id` is present in the current Ticket schema, so
  KPI-001 and KPI-004 expose `priority` only; Reporting does not infer a
  service dimension.
- Direct canonical reads have no projection lag and are reported as current;
  TASK-094 assessment validity and historical snapshot generation lag are
  checked separately. A late snapshot is observable but remains backfillable.
- Scheduled delivery, custom formulas, cross-tenant analytics, FX, XLSX/PDF,
  external BI and bulk underlying-record export remain excluded. Reporting
  never changes domain lifecycle/workflow state or invokes TASK-091.
- TASK-096 and TASK-097 readiness was recalculated after TASK-095 completion;
  neither task's runtime was started.
