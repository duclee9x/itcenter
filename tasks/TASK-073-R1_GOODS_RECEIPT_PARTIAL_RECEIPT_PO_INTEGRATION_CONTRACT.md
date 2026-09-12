# TASK-073-R1 — Goods Receipt + Partial Receipt + PO Receipt Integration Contract

## Task Metadata

```yaml
task_id: TASK-073-R1
feature_id: F-042
workflow_id: WF-005
phase: P4
priority: P0
readiness: SATISFIED
status: CODE_COMPLETE
owner_domain: procurement
depends_on: TASK-072
```

## Objective

Make the Goods Receipt lifecycle, partial receiving, PO receipt integration,
and asynchronous Asset registration contract normative before TASK-073 runtime
implementation.

## Resolution

The normative contract now distinguishes three independent state dimensions:

```text
Goods Receipt: DRAFT | POSTED | CANCELLED
PO lifecycle: DRAFT | ISSUED | ON_HOLD | CLOSED | CANCELLED
PO receipt:   NOT_RECEIVED | PARTIALLY_RECEIVED | FULLY_RECEIVED
```

Posted receipts are immutable physical facts. Only a POST against an ISSUED
PO changes receipt progress; posting never closes the PO. Accepted quantities
alone count, under-receipt is allowed, and cumulative over-receipt fails the
entire transaction. Blocking identity/quantity uncertainty and duplicate
unit identity within one receipt prevent posting.

The Procurement/Warehouse transaction owns receipt facts, PO accepted
progress, audit and outbox atomically. It does not write Asset tables.
`GOODS_RECEIPT.POSTED` asynchronously invokes Asset-owned
`ASSET.REGISTER_RECEIVED`, idempotent per immutable received-unit ID. New
Assets start in `RECEIVED`, at the receiving location, with assignment
`UNASSIGNED`; assetization retry failure does not reverse the physical
receipt and eventually creates actionable human work.

The contract specifies posted-only 3-Way Match evidence, Goods Receipt
permissions/events/API/error semantics, immutable receiving snapshots, and
concurrency ownership for competing receipts against PO cancel, hold,
amendment, relevant remainder close, and remaining-quantity races.

## Documents Updated

- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `docs/MASTER_WORKFLOW_MAP.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `tasks/TASK-073_GOODS_RECEIPT_ASSETIZATION_PARTIAL_RECEIPT.md`
- `tasks/CODEX_TASK_DEPENDENCY_GRAPH.md`
- `tasks/CODEX_TASK_REGISTRY.md`
- `CURRENT_TASK.md`
- `IMPLEMENTATION_HANDOFF.md`

## Scope Boundary

This remediation changes specifications and planning state only. It does not
implement TASK-073 runtime code, database migrations, APIs, consumers or tests.
TASK-073 is now `READY / NOT_STARTED`; runtime implementation still requires
explicit user authorization.

## Verification

- Cross-checked Goods Receipt lifecycle, PO receipt state and Asset lifecycle
  semantics across workflow, state-machine, data-model, event, API, permission,
  error/retry and traceability documents.
- Confirmed TASK-073 acceptance tests cover the specified state guards,
  idempotency, immutability, over-receipt, Asset redelivery/failure, partial
  quantity race and PO concurrency cases.
- Formatting check and `git diff --check` pass.
- Runtime tests are not applicable to this specification-only remediation.

## Completion State

`TASK-073` no longer has `SPEC_GAP / PLANNING_REQUIRED`; its detailed
implementation contract is `tasks/TASK-073_GOODS_RECEIPT_ASSETIZATION_PARTIAL_RECEIPT.md`.
No TASK-073 runtime implementation has started.
