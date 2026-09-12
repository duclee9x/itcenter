# TASK-075-R1 — Contract Lifecycle + Renewal + Commercial Document Governance Contract

## Status

`CODE_COMPLETE` — normative/specification remediation only. No runtime
TASK-075 code is authorized or included.

## Objective

Replace conflicting high-level Contract, Renewal and Document state summaries
with a normative implementation contract, reconcile supporting specifications,
and make TASK-075 implementation-ready while leaving it `NOT_STARTED`.

## Normative outcome

- Contract lifecycle is `DRAFT`, `PENDING_SIGNATURE`, `EXECUTED`, `ACTIVE`,
  `EXPIRED`, `TERMINATED`, `CANCELLED`; the final three are terminal.
- Contract usage (`ENABLED`/`ON_HOLD`), Renewal Case lifecycle, immutable
  ContractVersion, Commercial Document governance and signature/execution
  evidence are independent dimensions. Approval is an independent control
  gate.
- Signature submission freezes a version; recall is allowed only before
  accepted execution evidence and returns to DRAFT. Execution evidence binds
  the exact immutable version; approval is not evidence of execution.
- Activation requires the effective term, execution evidence and
  APPROVED/PREFERRED Supplier. Expiry is idempotent. `EXPIRING` is derived
  using explicit notice terms only. HOLD/RESUME changes operational
  availability without rewriting legal lifecycle.
- In-term amendments use a new immutable version, reason, evidence and
  optional exact-context approval. Amendment cannot change Supplier or extend
  term; Renewal creates a successor Contract without modifying the
  predecessor.
- Renewal Cases distinguish OPEN, COMPLETED, NOT_RENEWED and CANCELLED; a
  durable one-open-case/one-successor invariant applies. Completion requires
  an EXECUTED/ACTIVE successor with non-overlapping default term.
- Commercial document governance (`DRAFT`, `FINAL`, `SUPERSEDED`, `VOID`) and
  signature status remain separate. FINAL bytes and historical versions are
  immutable and remain in the central document/object-storage governance
  model.
- Permission mapping, events, audit/timeline, API commands, idempotency,
  concurrency and required TASK-075 tests are specified in the normative docs
  and detailed task contract.

## Documents reconciled

- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `tasks/TASK-075_CONTRACT_RENEWAL_COMMERCIAL_DOCUMENT_GOVERNANCE.md`
- `tasks/CODEX_TASK_REGISTRY.md`

`CURRENT_TASK.md` and `IMPLEMENTATION_HANDOFF.md` identify TASK-075 as
`READY / NOT_STARTED`. TASK-076 remains blocked on TASK-075. Runtime TASK-075
was not implemented.

## Verification

- Cross-document transition, dimension, permission, event, storage, approval,
  versioning, audit and concurrency reconciliation.
- `npm run format:check`
- `git diff --check`
