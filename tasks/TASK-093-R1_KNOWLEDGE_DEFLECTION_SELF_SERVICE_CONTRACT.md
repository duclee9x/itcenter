# TASK-093-R1 — Knowledge Deflection + Self-Service Recommendation Contract

```yaml
task_id: TASK-093-R1
parent_task: TASK-093
work_type: NORMATIVE_SPEC_REMEDIATION
runtime_implementation: OUT_OF_SCOPE
status: CODE_COMPLETE
owner_domain: Helpdesk / Problem Knowledge
```

## Planning reconciliation

The authoritative TASK-093-R1 business rules were supplied and reconciled
with the accepted TASK-037 implementation and TASK-061/TASK-092 contracts.
TASK-037 canonical Knowledge states are `DRAFT`, `IN_REVIEW`, `PUBLISHED` and
`ARCHIVED`; the workflow's former `REVIEW`, `APPROVED`, `REVIEW_DUE`,
`UPDATED` and `RETIRED` state diagram was documentation drift. The workflow
has been normalized without changing TASK-037 persistence or runtime.

Declared dependencies TASK-037, TASK-061 and TASK-092 are
`SATISFIED / CODE_COMPLETE`. No material `SPEC_CONFLICT`,
`SCOPE_DEPENDENCY` or `SECURITY_CONCERN` remains for planning. Search remains
TASK-061-owned; recommendation history is separate from Knowledge lifecycle,
Ticket lifecycle, Incident lifecycle and Search indexing. No runtime TASK-093
code was implemented.

## Normative contract

The detailed implementation contract is
[`TASK-093_KNOWLEDGE_DEFLECTION_SELF_SERVICE_RECOMMENDATIONS.md`](TASK-093_KNOWLEDGE_DEFLECTION_SELF_SERVICE_RECOMMENDATIONS.md).
It defines governed Knowledge eligibility and visibility, versioned scoring,
recommendation sessions/items/interactions, explicit deflection evidence,
Ticket handoff, events, permissions, idempotency, concurrency and required
tests. TASK-093 is now `READY / NOT_STARTED`; runtime implementation remains
unstarted and requires an explicit instruction.

## Reconciled normative documents

- `PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md`
- `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `SEARCH_INDEXING_SPEC.md`
- `STATE_MACHINE_MASTER_SPEC.md`
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `API_COMMAND_CONTRACT_SPEC.md`
- `PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`
- `MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `tasks/TASK-093_KNOWLEDGE_DEFLECTION_SELF_SERVICE_RECOMMENDATIONS.md`
- `tasks/CODEX_TASK_REGISTRY.md`, `CURRENT_TASK.md`,
  `IMPLEMENTATION_HANDOFF.md`

## Completion

- TASK-093-R1: `SATISFIED / CODE_COMPLETE` (specification/planning only).
- TASK-093: `READY / NOT_STARTED`.
- Verification: documentation formatting and `git diff --check` pass.
- Runtime code/tests: unchanged; TASK-093 runtime was not started.
- Next action: stop here. Begin TASK-093 runtime only when explicitly asked.
