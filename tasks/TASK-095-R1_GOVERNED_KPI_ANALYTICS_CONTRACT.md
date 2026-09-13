# TASK-095-R1 — Governed KPI + Analytics Contract

```yaml
task_id: TASK-095-R1
parent_task: TASK-095
feature_id: F-048
workflow_id: WF-RPT01
status: CODE_COMPLETE
scope: normative_contract_only
```

## Result

This remediation resolves the TASK-095 `SPEC_GAP`. The detailed, implementable
v1 contract is persisted in
`tasks/TASK-095_ADVANCED_REPORTING_GOVERNED_KPI_ANALYTICS.md` and reconciled
with the normative Reporting, storage, data model, API, permission, Search,
audit, retry and traceability specifications.

TASK-095-R1 made no runtime, database, API or worker change. TASK-096 remains
unstarted.

## Reconciled foundations

- TASK-039 remains the backward-compatible Operations Overview foundation.
  Its existing live counters are not themselves the governed KPI catalog.
- TASK-061 remains a tenant/RBAC-aware discovery index. It is never canonical
  KPI evidence.
- TASK-076 CostProvenance is the immutable financial source. Its `ACTUAL` and
  signed `ADJUSTMENT` evidence supports the v1 spend KPI; `COMMITTED` does not.
- TASK-093 supplies durable recommendation-session outcomes and separate
  `KNOWLEDGE_RESOLUTION` / `KNOWN_INCIDENT_DEFLECTION` evidence.
- TASK-094 supplies immutable Risk and Replacement assessments with current
  validity/freshness semantics.
- Ticket, Incident/Root, Work Queue, SLA, Knowledge, Asset and Procurement
  sources are canonical. TASK-095 may add narrow read ports where a domain has
  no suitable reporting query, but may not query another domain's private
  tables or reproduce its business state machine.

## Normative outcome

TASK-095 v1 is limited to nine governed, system-defined KPI definitions,
tenant-scoped results, controlled dimensions, live counts, historical UTC
snapshots and revisions, canonical drill-down reauthorization, aggregate CSV
export, lineage and projection observability. Formula changes create a new KPI
definition version; historical results remain immutable and revisioned.

The accepted scope explicitly excludes custom formulas/DSL/SQL/code,
scheduled or email delivery, XLSX/PDF, cross-tenant analytics, warehouse/BI,
FX and AI-generated definitions. KPI output is derived read data and cannot
mutate a workflow or trigger Automation.

## Verification

This was a specification-only remediation. Cross-document consistency,
Prettier formatting and `git diff --check` are required. Runtime/migration/E2E
verification is not applicable because R1 contains no runtime change.

## Completion state

- TASK-095-R1: `CODE_COMPLETE`.
- TASK-095: `READY / NOT_STARTED`; direct dependencies are TASK-039,
  TASK-061, TASK-076, TASK-093, TASK-094 and TASK-095-R1, all satisfied.
- TASK-096 and TASK-097: `WAITING_DEPENDENCY / NOT_STARTED`.

## Subsequent dependency status

TASK-095-R2 later completed the required Incident and Work Queue historical
state foundation. TASK-095 remains `READY / IN_PROGRESS`; the main Reporting
acceptance work is not complete. See
`tasks/TASK-095-R2_IMPLEMENTATION_REPORT.md` for R2 scope and verification.
