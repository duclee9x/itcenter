# TASK-095 — Advanced Reporting + Governed KPI + Analytics

```yaml
task_id: TASK-095
feature_id: F-048
workflow_id: WF-RPT01
phase: P5
priority: P1
status: CODE_COMPLETE
readiness: SATISFIED
owner_domain: reporting
dependencies: [TASK-039, TASK-061, TASK-076, TASK-092, TASK-093, TASK-094, TASK-095-R1, TASK-095-R2, TASK-095-R3]
```

## Scope and exclusions

TASK-095 v1 owns system-governed/versioned KPI definitions, deterministic
calculation, tenant-scoped current and historical result queries, controlled
dimensions, UTC daily snapshots and immutable revisions, result
freshness/completeness, RBAC-aware drill-down, aggregate CSV export, lineage,
and reporting-projection observability.

It does not implement user-authored KPI formulas, arbitrary SQL/code/DSL,
scheduled/email reports, XLSX/PDF, cross-tenant analytics, an external BI
warehouse, FX, AI-generated definitions, bulk underlying-record export, or an
automation/workflow action caused by a result or threshold.

## KPI definition and result model

`KPIDefinition` is immutable and system-governed. It records `kpi_id`, semantic
name, version, mode, formula/source/inclusion/exclusion/timestamp semantics,
allowed dimensions, unit, freshness policy, access classification,
`effective_from`, and optional supersession. A formula semantic change creates
a new version; tenants cannot edit a formula.

`KPIResultSnapshot` is immutable and records tenant, KPI/version, period,
snapshot type, canonical dimension set, numerator/denominator where relevant,
value/unit, status/completeness, source watermarks/generation references,
`as_of`, `generated_at`, and revision. Logical snapshot identity is tenant +
KPI/version + period + dimensions. Late/corrected canonical evidence creates
revision N+1; it never overwrites N. Historical queries default to the latest
revision and expose it.

`ReportingSourceWatermark` records each required source's last successful
position/time, projection watermark, last successful calculation and safe
failure state. It supports lag, stale and rebuild observability.

All periods are UTC `[start_at, end_at)`: start inclusive and end exclusive.
A daily snapshot is the point-in-time observation at the UTC day boundary.
Server, browser and implicit tenant timezones do not affect v1 results.

Result status is one of `COMPLETE`, `COMPLETE_EMPTY`, `PARTIAL`, `STALE`, or
`UNAVAILABLE`. A successful empty count is `0 / COMPLETE`; a zero ratio
denominator is `null / COMPLETE_EMPTY`; source failure and unknown evidence
are never zero. A required source failure yields `UNAVAILABLE`. `PARTIAL` is
allowed only where a future KPI definition explicitly permits optional-source
calculation; none of the nine v1 KPIs substitutes a failed primary source.

## Governed v1 KPI catalog

| ID | Mode | Canonical source | Allowed dimensions |
|---|---|---|---|
| KPI-001 `OPS_OPEN_TICKETS_COUNT` | `LIVE_COUNT` + daily point-in-time snapshot | Ticket lifecycle query | priority, canonical service_id |
| KPI-002 `OPS_ACTIVE_INCIDENT_EPISODES_COUNT` | `LIVE_COUNT` + daily point-in-time snapshot | Incident/Root query | canonical severity |
| KPI-003 `OPS_ACTIONABLE_WORK_QUEUE_COUNT` | `LIVE_COUNT` + daily point-in-time snapshot | Work Queue query | priority, source_type |
| KPI-004 `HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT` | `PERIOD_RATIO` | canonical SLA outcome query | Ticket priority, canonical service_id |
| KPI-005 `KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT` | `PERIOD_RATIO` | TASK-093 RecommendationSession history | none in v1 |
| KPI-006 `KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT` | `PERIOD_COUNT` | TASK-093 confirmation history | none in v1 |
| KPI-007 `ASSET_CRITICAL_RISK_COUNT` | `LIVE_COUNT` + daily point-in-time snapshot | TASK-094 Risk assessment query | canonical asset category/model-category ID |
| KPI-008 `ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT` | `LIVE_COUNT` + daily point-in-time snapshot | TASK-094 Replacement assessment query | replacement band, canonical asset category/model-category ID |
| KPI-009 `PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY` | `PERIOD_SUM` | immutable CostProvenance query | currency (mandatory) |

Unsupported dimension/filter names are validation errors. Reporting never
executes arbitrary columns, joins, SQL or group-by expressions.

### KPI-001 — open Tickets

Count unique `ticket_id` for same-tenant canonical Tickets that are
non-terminal at `as_of`, as determined by the Ticket domain. Reporting does
not reproduce terminal-state logic. Snapshot values are end-of-UTC-day
point-in-time values.

### KPI-002 — active Incident episodes

Count one episode per Asset-independent incident identity: `root_incident_id`
when the incident belongs to a canonical Root, otherwise `incident_id`.
Children under the same Root count once; Root plus children never count as
multiple episodes. The Incident domain determines active lifecycle semantics.

### KPI-003 — actionable Work Queue backlog

Count unique `work_item_id` in a canonical non-terminal/actionable Work Queue
state. Completed, dismissed, cancelled or equivalent terminal items are
excluded by the Work Queue domain.

### KPI-004 — resolution SLA compliance

The denominator is canonical resolution-SLA obligations whose final,
evaluable outcome became `MET` or `BREACHED` during the requested interval.
The numerator is the `MET` subset. No-SLA, pending, not-applicable, cancelled
and non-evaluable outcomes are excluded. Period membership uses the canonical
SLA finalization/evaluation timestamp. `denominator = 0` is
`null / COMPLETE_EMPTY`. Reporting consumes, and may add a narrow read port
for, the SLA outcome; it must never reproduce SLA clock, pause, calendar or
due-date logic.

### KPI-005 — confirmed self-service resolution

The denominator is pre-Ticket self-service sessions that presented at least
one eligible Knowledge item and reached `USER_RESOLVED`, `NOT_HELPFUL` or
`ESCALATED` in the interval, excluding `KNOWN_INCIDENT_DEFLECTION`. The
numerator is `USER_RESOLVED` with `KNOWLEDGE_RESOLUTION`. Presentation, article
open/select, `HELPFUL` alone and `NOT_HELPFUL` are not a numerator.
`denominator = 0` is `null / COMPLETE_EMPTY`.

### KPI-006 — known Incident deflection

Count a TASK-093 session only when canonical confirmation records
`KNOWN_INCIDENT_DEFLECTION` in the interval. Root context, recommendation
presentation and clicks alone do not count. It remains separate from KPI-005.

### KPI-007 — critical Asset Risk

At `as_of`, count Assets whose latest valid current TASK-094 Operational Risk
Assessment has `band = CRITICAL` and is not stale. Never use a stale or
unvalidated `Asset.risk_state` projection as authority.

### KPI-008 — replacement PLAN/PRIORITY

At `as_of`, count Assets whose latest valid current TASK-094 Replacement
Assessment has band `PLAN` or `PRIORITY` and is not stale. This reports a
scoring assessment, never approval, candidate disposition, procurement or an
Asset lifecycle effect.

### KPI-009 — net actual spend by currency

For the period, include canonical `ACTUAL` CostProvenance plus signed
`ADJUSTMENT`, excluding `COMMITTED`. Use the canonical financial effective
timestamp and canonical net/sign query semantics. Return one integer minor-unit
amount per currency; no cross-currency grand total and no FX are permitted.

## Current, historical and range semantics

`LIVE_COUNT` is an `as_of` point-in-time count. `PERIOD_COUNT`, `PERIOD_SUM`
and `PERIOD_RATIO` cover `[start_at, end_at)`. An open UTC period may be
calculated from current canonical query/projection state and must expose
`as_of`, `generated_at` and freshness; it is not a closed snapshot.

For additive period metrics, range values sum canonical components. Ratios
store numerator and denominator and a multi-day result is
`SUM(numerator) / SUM(denominator)`, never an average of daily percentages.
Historical range queries for point-in-time counts return a time series and do
not sum snapshots as events.

## Boundaries, freshness and rebuild

Reporting consumes domain-owned query ports or approved reporting projections:
Ticket, Incident, Work Queue, SLA, Knowledge, Asset Scoring and
CostProvenance. It may add the smallest read contract only when an owner lacks
one. It cannot make uncontrolled joins to private domain tables. Search is
only resource discovery/filter navigation and never KPI authority.

Required-source lag target is five minutes for live results. A projected
required source beyond that target makes the result `STALE`; direct canonical
queries without projection lag are not stale for that reason. Closed daily
snapshots should be generated within 15 minutes of UTC close. Late completion
is observable rather than silently represented as on-time.

Workers are idempotent on equivalent source generation and snapshot identity.
Competing workers, late correction versus initial calculation, source changes
during calculation, rebuild and export-versus-revision races use durable
uniqueness/transactions/expected versions. Rebuilds are deterministic for KPI
version + source generation + period, and never mutate domain source data.

## API, access and CSV

Expose repository-conventional routes/handlers for catalog, current result,
history/period result, allowed dimensions, drill-down and aggregate CSV
export. Validate KPI ID/version, UTC dates, controlled dimensions/filters,
tenant and authorization. No arbitrary query language exists.

`metric.read` is required for catalog/results. `report.export` is additionally
required for aggregate CSV. KPI-009 additionally requires narrow canonical
financial aggregate access (use existing equivalent or add `procurement.cost.read`;
never require `procurement.manage`). Each drill-down separately authorizes the
underlying Ticket, Incident, Asset or Procurement record. Aggregate access
does not reveal unauthorized IDs, titles, names or snippets.

CSV is aggregate-only and binds tenant, KPI/version, period, dimensions,
filters, historical revision when applicable, `as_of` and `generated_at`. It
uses the identical result authorization path and may not export underlying
records. Cells beginning `=`, `+`, `-` or `@` are escaped in the exported
representation to prevent spreadsheet formula injection. CSV does not mutate
canonical data.

TASK-039 Operations Overview remains backward compatible. Overlapping values
must use a shared governed primitive or be explicitly documented as distinct
non-governed counters; they may not silently drift.

## Non-action invariant

Reporting is derived/read-only. A KPI value or threshold does not create an
ActionIntent, invoke TASK-091, mutate Asset/Knowledge/Ticket/Incident,
create Procurement work, or change a Work Queue state.

## Required runtime tests

Test all nine formula definitions: Ticket terminal exclusion/deduplication;
Root Incident episode deduplication; Work Queue terminal exclusion; SLA
MET/BREACHED/no-SLA/pending/zero-denominator behavior without reimplementing
the clock; Knowledge confirmation versus clicks/helpfulness; separate known
Incident deflection; current non-stale Risk/Replacement assessment rules; and
CostProvenance ACTUAL/ADJUSTMENT/COMMITTED/currency rules.

Also test UTC `[start,end)`, timezone invariance, daily point-in-time values,
ratio aggregation by summed numerator/denominator, current partial periods,
late revision immutability/latest selection, empty versus failure, watermark
and stale status, tenant isolation, metric/export/financial permissions,
aggregate versus drill-down leakage, CSV formula escaping, duplicate and
concurrent materialization, deterministic rebuild, export revision binding,
TASK-039 compatibility, and the no-action boundary.

## Completion rule

TASK-095 runtime requires a Reporting module, migrations/projections/worker,
domain read ports, routes, permissions, audit/export history and all applicable
verification gates. Historical daily snapshots for active Incident episodes
and actionable Work Queue items require TASK-095-R2 effective-time state
history. A legacy baseline is forward-only and must not be used to invent
pre-anchor state. TASK-095-R2 is complete; its report records the history
coverage and query contract. Main TASK-095 remains in progress until its own
acceptance and verification gates pass.

TASK-095-R3 supplies the typed SLA target-purpose prerequisite for KPI-004.
The main task consumes only Control Plane `ResolutionSlaOutcomeQuery`; it must
not infer purpose from names, condition text or duration. Legacy UNKNOWN
purposes that could affect the requested population make the source ambiguous
and unavailable, rather than disappearing from a supposedly complete ratio.
TASK-095-R3 is `CODE_COMPLETE`; it is a required direct prerequisite alongside
R1 and R2. Main runtime and acceptance closure are recorded in
`tasks/TASK-095_IMPLEMENTATION_REPORT.md`; TASK-095 is `CODE_COMPLETE`.
