# TASK-096-R1 — Explainable Recommendation Layer Contract

```yaml
task_id: TASK-096-R1
parent_task: TASK-096
feature_id: F-050
workflow_id: WF-INT01
phase: P5
priority: P0
status: CODE_COMPLETE
readiness: SATISFIED
implementation_status: SPEC_COMPLETE
scope: normative_contract_only
```

## Result

The normative TASK-096 v1 contract is now persisted in
`tasks/TASK-096_EXPLAINABLE_RECOMMENDATION_LAYER.md` and reconciled with the
workflow, data model, storage, API, event, permission, audit, retry and
traceability specifications. R1 changes specifications and task metadata only;
no runtime code, migration, API or worker was implemented.

The contract defines TASK-096 as an explainable aggregation/presentation layer
for exactly `INCIDENT_CORRELATION_REVIEW`, `KNOWLEDGE_GUIDANCE`, and
`ASSET_REPLACEMENT_REVIEW`. The source domains retain their decisions and
lifecycles. No global score, generative explanation, generic accept/action,
Work Queue creation or TASK-091 execution is permitted.

## Source-boundary reconciliation

The existing query primitives were inspected:

- Incident provides `readIncidentCorrelationHistory` for one tenant-scoped
  Incident, but no compact current-review feed query.
- TASK-093 provides session read and canonical Knowledge eligibility queries;
  the TASK-096 adapter must compose these and preserve presentation-time
  authorization.
- Asset/TASK-059 provides the candidate recommendation command but no
  exported read-only query binding active candidate review state to its current
  TASK-094 assessment.

The TASK-096 contract records the exact potential implementation-time
`SCOPE_DEPENDENCY`: add minimal read adapters in the owning Incident,
Problem/Knowledge and Asset domains as required. The Incident adapter must
enumerate current review decisions with stable generation and eligibility;
the Asset adapter must read active candidates with current assessment band,
freshness and human review state. TASK-096 must not bypass these boundaries
with cross-domain SQL. TASK-093's session/eligibility ports are reusable but
need a compact family adapter. The parent remains `READY / NOT_STARTED` as
directed; implementation must stop if the adapters cannot be provided within
TASK-096 scope.

## Reconciled specifications

- `docs/MASTER_WORKFLOW_MAP.md`
- Incident, Knowledge, Asset replacement, Reporting/Work Queue workflows
- Data model and database storage boundaries
- API and event contracts
- Permission and audit/timeline policies
- Error, retry and idempotency standard
- Master implementation traceability matrix and task dependency graph

## Verification and status

- Cross-document contract consistency reviewed against TASK-090/091/092/093/
  094/095 ownership and current application exports.
- `npx prettier --check` on all changed Markdown files: passed.
- `git diff --check`: passed.
- Runtime/migration tests are not applicable; R1 is specification-only.

TASK-096-R1 is `CODE_COMPLETE`. TASK-096 is `READY / NOT_STARTED`; runtime
implementation has not begun. TASK-097 remains
`WAITING_DEPENDENCY / NOT_STARTED` and was not started.
