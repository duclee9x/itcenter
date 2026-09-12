# TASK-074-R1 — Invoice + Duplicate Protection + 3-Way Match + Credit Note Contract

## Task Metadata

```yaml
task_id: TASK-074-R1
feature_id: F-043/F-044
workflow_id: WF-P04/WF-P05
phase: P4
priority: P0
status: CODE_COMPLETE
owner_domain: procurement
depends_on: TASK-072, TASK-073
```

## Objective

Resolve TASK-074's `SPEC_GAP / PLANNING_REQUIRED` by making Invoice lifecycle,
duplicate identity, 3-Way Match, approval exception and Credit Note rules
normative before runtime implementation. This is a specification-only
remediation; it does not implement TASK-074 behavior.

## Normative Decisions Recorded

- Invoice lifecycle is `DRAFT → SUBMITTED → APPROVED | REJECTED`, with
  DRAFT-only cancellation to `CANCELLED`; submitted commercial snapshots are
  immutable. Match status (`NOT_EVALUATED`, `PENDING_RECEIPT`, `MATCHED`,
  `MISMATCHED`) and derived credit status are independent dimensions.
- Credit Note lifecycle is `DRAFT → SUBMITTED → APPLIED | REJECTED`, with
  DRAFT-only cancellation. It is a separate immutable commercial document,
  uses positive semantic quantities/amounts and cannot exceed remaining
  creditable line quantities/amounts.
- 3-Way Match reads the applicable immutable PO version, submitted Invoice
  snapshot and POSTED accepted Goods Receipt quantities only. Quantity and
  unit-price business tolerances are zero; arithmetic total rounding is at
  most one configured currency minor unit. Partial invoices are supported.
- Submitted duplicate identity is transactionally unique on tenant, Supplier,
  document type and normalized supplier document number. Normalization uses
  Unicode NFKC, trim, repeated-whitespace collapse and case normalization;
  punctuation is preserved. Candidate fingerprints remain advisory.
- Every match evaluation and exception is retained as immutable history.
  Durable allocation and Credit Note application invariants serialize
  concurrent invoices/credits. An approved mismatch exception reserves its
  full approved invoice quantity against later invoices while preserving
  `MISMATCHED` and keeping unsupported quantity distinct from receipt evidence.
- Linked approval is conditional. `INVOICE_APPROVAL` is optional for
  `MATCHED` invoices; if linked, it must bind tenant, target, purpose and
  current invoice/match context. `MISMATCHED` approval requires an approved,
  current `INVOICE_MATCH_EXCEPTION`; approval never converts the match result
  or erases failed comparisons.
- Permission mapping is explicit for every write. DRAFT-only
  `INVOICE.CANCEL` uses `invoice.update`; DRAFT-only `CREDIT_NOTE.CANCEL` uses
  `credit_note.update`. Both remain explicit domain commands, are forbidden
  after submission and cannot use generic status updates. They retain normal
  version, idempotency, scope, audit, outbox and correlation requirements;
  reason follows the existing command/audit standard. Any later cancellation
  or reversal requires a distinct command, permission and compensation or
  reversal contract. Approval decisions remain `approval.decide`.
- Credit Note application can release only explicitly credited quantity that
  previously consumed invoiceable capacity, once. Amount-only credits do not
  release quantity or change PO quantity, Goods Receipt facts or the original
  Invoice.
- No payment settlement, `PAID` state, automatic Approval Request creation,
  service receipt, or Goods Receipt correction path is in TASK-074.

## Files Updated

- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/SYSTEM_WORKFLOW_INDEX_TRACEABILITY_MATRIX.md`
- `docs/MASTER_WORKFLOW_MAP.md`
- `docs/MVP_PHASED_IMPLEMENTATION_PLAN.md`
- `docs/SEARCH_INDEXING_SPEC.md`
- `tasks/TASK-074_INVOICE_DUPLICATE_PROTECTION_3_WAY_MATCH.md`
- `tasks/TASK-074-R1_INVOICE_DUPLICATE_MATCH_CREDIT_NOTE_CONTRACT.md`
- `tasks/CODEX_TASK_REGISTRY.md`
- `CURRENT_TASK.md`
- `IMPLEMENTATION_HANDOFF.md`

## Completion Report

### Status

`CODE_COMPLETE` — specification-only.

### Database / API / Runtime

No runtime code or migration was changed. The data model, command-style API,
permission mappings, canonical errors, event payload references, audit and
timeline behavior are specified for TASK-074 implementation.

### Validation

- Cross-checked lifecycle, independent status dimensions, immutable evidence,
  duplicate uniqueness, allocation formulas, approval context and Credit Note
  rules across all listed specifications.
- Confirmed TASK-073 remains the owner of Goods Receipt facts and TASK-074
  reads POSTED accepted receipt evidence only.
- Required implementation tests and concurrency cases are recorded in the
  detailed TASK-074 contract.
- `npm run format:check` and `git diff --check` passed.

### Remaining Gaps / Conflicts / Assumptions

- None identified in the TASK-074 contract scope after the explicit decisions
  recorded above.
- Runtime TASK-074 remains `NOT_STARTED`; it must not begin without a later
  explicit user instruction.
