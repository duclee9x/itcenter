# TASK-034 — Major Incident Communication + Status Flow

```yaml
task_id: TASK-034
feature_id: F-020
workflow_id: WF-020/WF-COM01
phase: P2
priority: P1
status: CODE_COMPLETE
owner_domain: incident/communication
```

Implement explicit major classification and auditable incident communication
records with audience, channel and publication status.

## In scope

- `INCIDENT.DECLARE_MAJOR` command.
- Major incident communication record and status flow.
- Outbox and audit effects.

## Out of scope

- Provider delivery workers and external channel adapters.
- Audience discovery and cadence scheduler.

## Acceptance criteria

1. Only an authorized operator can declare a major incident with a reason and cadence.
2. A major incident cannot be undeclared through this command.
3. Communication updates are tenant-scoped and auditable.
4. Publication creates an outbox fact without holding a transaction over delivery.
5. Full repository verification passes.
