# TASK-013 — Asset Assignment End-to-End

```yaml
task_id: TASK-013
feature_id: F-006
workflow_id: WF-006
phase: P1
priority: P0
status: CODE_COMPLETE
owner_domain: asset
```

## Objective

Implement the authorized `ASSET.ASSIGN` command from `RESERVED` to `ASSIGNED`.

## In scope

- Active primary assignment persistence with a tenant-scoped uniqueness invariant.
- Active-user and optimistic-concurrency validation.
- `POST /api/v1/assets/{id}/commands/assign` with idempotency.
- `ASSET.ASSIGNED` outbox event and immutable audit record.

## Out of scope

Transfer, return, handover confirmation, temporary loans, and UI.

## Required specifications

- `docs/ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`

## State transition

`RESERVED → ASSET.ASSIGN → ASSIGNED`, with assignment state `RESERVED → ASSIGNED`.

## Authorization

Permission: `asset.assign`; tenant and resource scope are enforced by the existing authorization boundary.
