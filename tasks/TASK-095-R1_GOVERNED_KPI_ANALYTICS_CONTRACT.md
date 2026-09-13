# TASK-095-R1 — Governed KPI + Analytics Contract

```yaml
task_id: TASK-095-R1
parent_task: TASK-095
feature_id: F-048
workflow_id: WF-RPT01
status: NOT_STARTED
readiness: READY
blocker: none
scope: normative_contract_only
```

## Purpose

TASK-095's declared runtime dependencies TASK-039, TASK-061 and TASK-076 are
satisfied. Reconciliation found no implementable TASK-095 detailed contract:
the registry still says `GENERATE_ON_READY`, and the Reporting workflow is a
broad design with KPI examples and generic governance. This remediation must
settle the normative v1 product and data semantics before runtime work starts.

R1 is planning/specification only. It must not implement Reporting runtime,
change domain behavior, or begin TASK-096.

## Repository baseline

- TASK-039 provides `GET /api/v1/operations/overview`, a tenant-scoped live
  count aggregation for open Work Items, Incidents, critical/breached SLAs,
  pending approvals, active Maintenance and Automation attention. It queries
  several schemas directly and returns `generated_at`; it is not a governed
  KPI catalog, historical snapshot store, or general reporting boundary.
- TASK-061 provides tenant/RBAC-aware Search candidate discovery, exact
  fallback and freshness metadata. Search is derived and is not a canonical
  source for KPI calculations.
- TASK-076 provides immutable tenant-scoped CostProvenance and cost-allocation
  lineage, including `COMMITTED`, `ACTUAL` and `ADJUSTMENT`; it does not define
  aggregate currency conversion for Reporting.
- Work Queue has an owning module and canonical actionable-item read/write
  behavior. It is not a reporting aggregate or source of its referenced
  workflow state.
- Asset, Incident, Monitoring, Maintenance, Knowledge, Procurement and other
  domains expose a mixture of owning-domain application queries and APIs;
  there is no shared governed Reporting query/projection contract covering
  the TASK-095 KPI catalog.
- The workflow names many candidate KPI families and gives a generic
  `metric_definition` shape, but those examples are not a normative v1 list or
  formulas. It mentions common periods, dimensions, report formats, export
  logging and scheduled-report examples without binding their behavior to a
  TASK-095 v1 surface.
- No Reporting module, KPI definition/snapshot persistence, report/export
  API, or scheduled-report worker exists. The Operations Overview endpoint is
  the only discovered reporting-like API; no general report export endpoint
  was found.

## Normative decisions R1 must resolve

R1 must record explicit decisions for each item below. Do not infer answers
from examples, names such as MTTR, existing endpoint behavior, or current
schema shape.

1. **TASK-095 v1 scope.** Name the exact KPI/report catalog and user-visible
   surfaces included. Decide which of live dashboards, historical analytics,
   ad-hoc reports, scheduled reports, forecasts, metric alerts, and exports
   are in or out of v1. Candidate KPI names in the workflow are not automatic
   inclusion.
2. **Definition per KPI.** For every included KPI, state the business meaning,
   exact formula, numerator and denominator (if any), unit, inclusion and
   exclusion rules, zero-denominator behavior, and canonical source domain /
   query or approved projection. Clarify deduplication keys and episode or
   entity grain where relevant.
3. **Time semantics.** For every time-based KPI, name the authoritative event
   timestamp, window/period choices, timezone, inclusive/exclusive boundaries,
   calendar/fiscal period rules, `as_of` semantics, and late-arriving or
   corrected-source behavior.
4. **Dimensions and filtering.** Define allowed grouping/filter dimensions
   per KPI, their canonical sources, null/unknown buckets, cardinality limits,
   and whether comparisons (previous period, target, prior-year) are supported.
5. **Unavailable and partial data.** Define empty-success versus source
   failure, `UNKNOWN` versus zero, completeness representation, partial
   aggregation rules, source outage behavior, and when a result is unavailable
   rather than partial.
6. **Calculation mode and freshness.** Classify every v1 result as `LIVE`,
   `SNAPSHOT`, or `MATERIALIZED/PROJECTED`; define refresh/freshness SLA,
   stale/degraded status, processing-lag observability, `generated_at` and
   `as_of`, and whether a stale result may be served with an explicit status.
7. **Versioning and lineage.** Define immutable KPI definition identity and
   version/effective/deprecation behavior; threshold versioning where used;
   snapshot identity/retention; source generations/as-of references; filters,
   tenant/scope, completeness, exclusions and reproducibility requirements.
   Formula changes must not reinterpret historical results silently.
8. **Authorization.** Define report/KPI read permissions and resource-scope
   evaluation, role/principal semantics, tenant boundary, sensitive-field
   classification, aggregate visibility, and per-record drill-down
   reauthorization. An aggregate grant must not grant record-level access.
9. **Cost and currency.** For any monetary KPI, define accepted CostProvenance
   bases and adjustment treatment, grouping by currency, same-currency-only
   behavior or an explicitly governed FX policy, and incomplete/mixed-currency
   results. Do not infer FX from current rates.
10. **Exports.** Decide whether export is in v1. If included, specify supported
    formats, authorization parity with UI/API and drill-down, sensitive export
    permission/approval, audit fields, file lifecycle/expiry, row/column
    filtering, and spreadsheet formula-injection handling. If excluded, state
    that TASK-095 does not add export APIs/jobs.
11. **Scheduled reports.** Decide whether scheduling/delivery is in v1. If
    included, define authorized recipients, tenant/scope capture and
    revalidation, report/KPI version binding, timezone/period evaluation,
    formats/channels, retries/failure/revocation, sensitive attachment
    handling, idempotency and audit. Reuse the existing scheduler if an
    explicitly suitable one exists; do not assume one exists.
12. **Custom definitions.** Decide whether user-authored KPIs/reports are in
    v1. If included, define an allow-listed typed DSL, dimensions/measures,
    validation, limits, permissions and tenant isolation. Arbitrary SQL,
    JavaScript, `eval`, shell or unvalidated expressions are forbidden. If
    excluded, enumerate governed built-in definitions only.
13. **Threshold and action boundary.** For included thresholds/alerts, define
    metric-specific target/warning/critical values, version/effective rules,
    evaluation cadence, deduplication and permitted notification/Work Queue
    effects. KPI output itself remains derived and cannot mutate domain state
    or trigger automation absent an explicit consuming workflow contract.

## Required normative deliverables

- Persist a detailed TASK-095 v1 contract with the decisions above and exact
  acceptance criteria. Any decision still unresolved remains a blocker; R1
  must not fill it with an implementation assumption.
- Reconcile the Reporting/KPI workflow's examples and generic language with
  the chosen v1 scope. Do not rewrite TASK-039's existing projection unless a
  specific contract conflict is demonstrated.
- Update the traceability matrix, data model, storage boundary, API/command,
  permission, audit/export and retry/idempotency specifications as applicable
  to the chosen scope. Update Search specification only if Search is assigned
  a defined Reporting role; preserve Search as derived and non-authoritative
  for KPI facts unless the contract explicitly establishes otherwise.
- Update TASK-095 detailed task and registry with exact dependencies, scope,
  status, runtime acceptance tests and verification gates.

## Minimum acceptance criteria for R1

- Exact v1 KPI/report inventory is explicit; each included KPI has a
  deterministic formula and canonical source.
- Time, timezone, period edges, grouping and deduplication are deterministic.
- `UNKNOWN`, no rows, source failure and partial data are distinguishable.
- Late/corrected data, snapshot/live mode, freshness and historical version
  reproducibility are explicit.
- Tenant/RBAC/sensitive-data/drill-down rules are implementable.
- Cost/currency behavior is explicit and does not invent FX.
- Export, scheduled reports and custom formulas are each explicitly in or out;
  any included behavior has complete security and operational semantics.
- Reporting is read-only derived capability. It does not directly mutate
  Asset, Incident, Ticket, Procurement, Knowledge, Maintenance or Automation.
- Required formula, boundary, tenant/RBAC, completeness, freshness, replay,
  correction/rebuild, currency, drill-down and (when in scope) export/schedule
  tests are listed per KPI/surface.
- No runtime code or TASK-096 work is included in R1.

## State after R1

Only after all acceptance criteria are normative and persisted may TASK-095
be restored to `READY / NOT_STARTED`. Otherwise TASK-095 remains
`BLOCKED / NOT_STARTED` with the exact unresolved `SPEC_GAP` recorded.

TASK-096 remains `WAITING_DEPENDENCY / NOT_STARTED` until TASK-095 is complete.
