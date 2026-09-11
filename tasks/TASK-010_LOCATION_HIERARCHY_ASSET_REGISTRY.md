# TASK-010 — Location Hierarchy + Asset Registry

```yaml
task_id: TASK-010
feature_id: F-005
workflow_id: WF-A01
phase: P1
priority: P0
status: CODE_COMPLETE
owner_domain: Asset
```

## Objective

Implement the canonical location hierarchy and asset registry foundation for
creating and reading assets. Asset lifecycle commands remain TASK-011.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`

## In Scope

- Location hierarchy with tenant ownership and parent validation.
- Asset categories, models and canonical asset registry.
- `POST /api/v1/assets` and tenant-scoped asset query.
- `asset.create` authorization, idempotency, audit and `ASSET.CREATED` outbox.
- Database constraints and unit/migration/integration/E2E tests.

## Out of Scope

- Asset lifecycle transitions, receiving, reservation, assignment, transfer,
  return, disposal and warehouse workflows.

## Acceptance Criteria

1. Location and asset records are tenant-scoped and cannot cross-reference a
   different tenant.
2. Location parent hierarchy rejects cycles and invalid parents.
3. Asset identifiers required by the registry are unique within tenant.
4. Asset create requires authorization, idempotency and audit/outbox atomicity.
5. Queries are read-only and tenant-filtered.
6. Unit, migration, contract, integration, E2E, format, lint, typecheck and
   build gates pass.
