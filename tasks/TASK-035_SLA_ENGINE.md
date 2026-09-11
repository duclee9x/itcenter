# TASK-035 — SLA Engine

```yaml
task_id: TASK-035
feature_id: F-021
workflow_id: WF-SLA01
phase: P2
priority: P0
status: CODE_COMPLETE
owner_domain: control-plane
```

Implement durable SLA policy, target and instance tracking for tickets and
incidents with explicit engine-managed state transitions.

## In scope

- Policy/target/instance/event tables.
- Start an SLA instance with calculated deadline.
- Engine transition command for pause/resume/met/breach.
- Tenant-scoped read API and outbox/audit effects.

## Out of scope

- Business calendars and holiday overrides.
- Automated scheduler worker and notification delivery.

## Acceptance criteria

1. SLA target duration is positive and deadline is calculated from start time.
2. Instance state follows the canonical SLA state machine.
3. Pause/resume/met/breach enforce valid transitions and expected version.
4. Instances are tenant-scoped and events are append-only.
5. Full repository verification passes.
