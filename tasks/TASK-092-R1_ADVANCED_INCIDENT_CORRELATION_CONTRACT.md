# TASK-092-R1 — Advanced Incident Correlation Contract

```yaml
task_id: TASK-092-R1
status: CODE_COMPLETE
work_type: NORMATIVE_SPEC_REMEDIATION
runtime_implementation: OUT_OF_SCOPE
parent_task: TASK-092
```

## Planning reconciliation

TASK-092 was reconciled to `NOT_STARTED / BLOCKED` with the explicit blocker
`SPEC_GAP / PLANNING_REQUIRED`: its dependencies were complete, but the
implementation contract did not yet define scoring thresholds, candidate
ambiguity, automatic Root creation, relationship history, detach behavior,
authorization, or concurrency invariants. `CURRENT_TASK.md` and
`IMPLEMENTATION_HANDOFF.md` were set to TASK-092-R1 for this spec-only work.

The normative contract is now complete in
[`TASK-092_ADVANCED_INCIDENT_CORRELATION.md`](TASK-092_ADVANCED_INCIDENT_CORRELATION.md).
It defines the versioned v1 evidence weights and score bands, strong evidence
and unambiguous auto-link gate, deterministic-only automatic Root creation,
human-review/no-link behavior, immutable decisions, relationship history,
manual attach/detach and reattach suppression, scoped SYSTEM_CORRELATION
authorization, events, audit/timeline/Work Queue, durable identity/uniqueness,
concurrency and acceptance tests. It preserves TASK-033 Incident/Root
ownership, TASK-051 topology freshness and prohibits TASK-091 execution.

## Normative documents updated

- `docs/HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `docs/AUDIT_NETWORK_DISCOVERY_VLAN_TOPOLOGY_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `tasks/TASK-092_ADVANCED_INCIDENT_CORRELATION.md`
- `tasks/CODEX_TASK_REGISTRY.md`
- `CURRENT_TASK.md`
- `IMPLEMENTATION_HANDOFF.md`

`docs/PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md` contains no Root Incident or
Incident-correlation contract references, so no unrelated edit was needed.
No runtime code or migration was added. The pre-existing `AGENTS.md` change is
excluded from this remediation commit.

## Completion state

The `SPEC_GAP / PLANNING_REQUIRED` blocker is cleared. TASK-092 is
`READY / NOT_STARTED`; dependencies TASK-033, TASK-051, TASK-090 and this
remediation are satisfied. No TASK-092 runtime implementation was started.
Stop here until explicitly instructed to begin TASK-092.

## Verification

- Reviewed all named normative sources and existing TASK-033/TASK-051/TASK-090
  boundary semantics.
- Documentation consistency review: correlation state, incident lifecycle,
  decision outcome, topology freshness and Root creation remain distinct and
  consistently constrained.
- `git diff --check` passed.
- Prettier check passed for all modified Markdown/task/state files.
