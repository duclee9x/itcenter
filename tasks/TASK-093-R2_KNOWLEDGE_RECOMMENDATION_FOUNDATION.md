# TASK-093-R2 — Knowledge Recommendation Foundation

Current state: `READY / NOT_STARTED`; its canonical Service, Platform and
ServiceEnvironment prerequisites were completed by TASK-093-R2A. Do not begin
R2 runtime until explicitly instructed. TASK-093 remains
`BLOCKED / NOT_STARTED`.

```yaml
task_id: TASK-093-R2
parent_task: TASK-093
work_type: FOUNDATION_RUNTIME_REMEDIATION
readiness: READY
implementation: NOT_STARTED
blocker: null
```

## Reconciliation result

TASK-093-R2A established the authorized canonical Service,
Platform/Environment reference foundation and passed its PostgreSQL and full
repository verification. `incident.service_id` now has canonical,
tenant-validated semantics while old values remain preserved as legacy
unresolved context. R2's own audience, applicability, Knowledge indexing,
Incident query and Ticket handoff work remains unimplemented. This task is
`READY / NOT_STARTED`; wait for explicit implementation instruction.

## R2 scope

Implement only the TASK-093-R2 foundation. Do not implement Recommendation
Session, ranking/scoring, feedback, deflection runtime or recommendation API.
