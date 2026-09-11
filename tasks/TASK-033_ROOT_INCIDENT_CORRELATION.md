# TASK-033 — Root Incident Correlation + Ticket Linking

```yaml
task_id: TASK-033
feature_id: F-019
workflow_id: WF-020
phase: P2
priority: P0
status: CODE_COMPLETE
owner_domain: incident
```

Implement explicit correlation of child incidents and tickets to a root
incident with tenant-scoped, idempotent relations.

## In scope

- Root incident creation from an existing incident.
- `INCIDENT.CORRELATE` command for child incident and ticket links.
- Relation reason and score.
- `INCIDENT.ROOT.CREATED` / `INCIDENT.CORRELATED` outbox and audit effects.

## Out of scope

- Automatic correlation scoring engine.
- Major incident communication.

## Acceptance criteria

1. A root incident is an incident with no parent and can receive child links.
2. A child incident cannot link to itself or cross tenant boundaries.
3. Duplicate links replay safely through idempotency and unique constraints.
4. Ticket links preserve ticket ownership and are auditable.
5. Full repository verification passes.
