# TASK-014 — Asset Transfer End-to-End

```yaml
task_id: TASK-014
feature_id: F-007
workflow_id: WF-007
phase: P1
priority: P1
status: CODE_COMPLETE
owner_domain: asset
```

## Objective

Implement authorized asset transfer between active locations and users.

## In scope

- Movement persistence with source/destination location and user.
- `ASSET.TRANSFER` command with idempotency and optimistic concurrency.
- Active asset, destination location, and destination user validation.
- Assignment history preservation when the owner changes.
- `ASSET.TRANSFERRED` outbox event and audit record.

## Out of scope

Return, handover documents, temporary loans, and UI.
