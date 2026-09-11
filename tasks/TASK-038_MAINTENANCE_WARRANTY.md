# TASK-038 — Maintenance + Warranty Core

```yaml
task_id: TASK-038
feature_id: F-023/F-024
workflow_id: WF-009/WF-016
phase: P2
priority: P0
status: CODE_COMPLETE
owner_domain: maintenance/warranty
```

Implement maintenance order and warranty coverage foundations with protected
state transitions and asset ownership boundaries.

## In scope

- Maintenance orders linked to assets.
- Warranty coverage records and validity query.
- Maintenance state transitions, idempotency, outbox and audit.

## Out of scope

- Vendor integration, parts inventory, replacement/disposal and cost ledger.

## Acceptance criteria

1. Maintenance order starts DRAFT and warranty records preserve coverage dates.
2. Asset tenant boundary is enforced.
3. Invalid maintenance transitions are rejected.
4. Full repository verification passes.
