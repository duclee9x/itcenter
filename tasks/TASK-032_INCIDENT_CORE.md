# TASK-032 — Incident Core + Incident State Machine

```yaml
task_id: TASK-032
feature_id: F-019/F-020
workflow_id: WF-020
phase: P2
priority: P0
status: CODE_COMPLETE
owner_domain: incident
```

## Objective

Create monitoring-backed incidents and enforce the canonical incident state
machine through explicit commands.

## Required specifications

- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`

## In scope

- Tenant-scoped incident persistence and source monitoring event link.
- `INCIDENT.CREATE` and state transition commands.
- DETECTED → INVESTIGATING → IDENTIFIED → MITIGATING →
  MONITORING_RECOVERY → RESTORED → RESOLVED → CLOSED.
- Major classification flag and explicit `INCIDENT.DECLARE_MAJOR`.
- Outbox and audit effects.

## Out of scope

- Root incident correlation and ticket linking (TASK-033).
- SLA timers, communication cadence and approval workflow.

## Acceptance criteria

1. A critical monitoring event can create one incident idempotently.
2. Invalid state transitions return a canonical business error.
3. RESTORED requires verification; RESOLVED requires a summary; CLOSED requires post checks.
4. Major classification is an attribute changed by an explicit command.
5. Outbox and audit are committed atomically with each command.
6. Full repository verification passes.
