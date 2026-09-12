# TASK-071-R1 — RFQ + Quotation Lifecycle Contract

## 1. Task Metadata

```yaml
task_id: TASK-071-R1
feature_id: F-040
workflow_id: WF-P02
phase: P4
priority: P1
readiness: SATISFIED
status: CODE_COMPLETE
owner_domain: procurement
depends_on: TASK-070
```

## 2. Objective

Resolve TASK-071's missing normative RFQ/Quotation state, command, permission,
eligibility, event, persistence and concurrency contracts before runtime
implementation.

## 3. Normative Rules

This remediation records the approved business rules:

### RFQ

States are `DRAFT`, `OPEN`, `EVALUATING`, `AWARDED`, `CLOSED_NO_AWARD` and
`CANCELLED`. Terminal states are `AWARDED`, `CLOSED_NO_AWARD` and `CANCELLED`.

| From | Command | To |
|---|---|---|
| none | `RFQ.CREATE` | `DRAFT` |
| `DRAFT` | `RFQ.UPDATE_DRAFT` | `DRAFT` |
| `DRAFT` | `RFQ.ISSUE` | `OPEN` |
| `DRAFT`, `OPEN`, `EVALUATING` | `RFQ.CANCEL` | `CANCELLED` |
| `OPEN` | `RFQ.CLOSE_SUBMISSIONS` | `EVALUATING` |
| `EVALUATING` | `RFQ.AWARD` | `AWARDED` |
| `EVALUATING` | `RFQ.CLOSE_NO_AWARD` | `CLOSED_NO_AWARD` |

Only DRAFT commercial terms and candidate membership are editable. Material
change after ISSUE requires cancel/new RFQ; TASK-071 adds no OPEN amendment.
Award validates the selected SUBMITTED quotation, current Supplier eligibility
and any required approval, persists the decision, accepts the selected quote,
rejects other active valid SUBMITTED quotes and transitions the RFQ atomically.
Close-no-award rejects remaining valid SUBMITTED quotations. Cancel voids
DRAFT/SUBMITTED child quotations and never rewrites terminal quotation history.

### Quotation

States are `DRAFT`, `SUBMITTED`, `WITHDRAWN`, `DISQUALIFIED`, `ACCEPTED`,
`REJECTED` and `VOID`. Terminal states are `WITHDRAWN`, `DISQUALIFIED`,
`ACCEPTED`, `REJECTED` and `VOID`.

| From | Command / parent action | To |
|---|---|---|
| none | `QUOTATION.CREATE` | `DRAFT` |
| `DRAFT` | `QUOTATION.UPDATE_DRAFT` | `DRAFT` |
| `DRAFT` | `QUOTATION.SUBMIT` | `SUBMITTED` |
| `DRAFT`, `SUBMITTED` | `QUOTATION.WITHDRAW` | `WITHDRAWN` |
| `SUBMITTED` | `QUOTATION.DISQUALIFY` | `DISQUALIFIED` |
| selected SUBMITTED | parent `RFQ.AWARD` | `ACCEPTED` |
| other active SUBMITTED | parent `RFQ.AWARD` | `REJECTED` |
| active SUBMITTED | parent `RFQ.CLOSE_NO_AWARD` | `REJECTED` |
| DRAFT/SUBMITTED | parent `RFQ.CANCEL` | `VOID` |

SUBMITTED quotations are immutable. Revision requires withdrawal, a new DRAFT
linked by `replaces_quotation_id`/revision reference, then submission. A
partial unique database invariant permits at most one current SUBMITTED quote
per tenant/RFQ/Supplier.

### Supplier, permission, command and event contracts

- RFQ participation/quotation submission: `PROSPECT`, `APPROVED`, `PREFERRED`.
- RFQ award: `APPROVED`, `PREFERRED` only. Prospect quotations may be
  evaluated but cannot be awarded before Supplier qualification. SUSPENDED,
  BLOCKED and INACTIVE Suppliers cannot submit new quotations or be awarded.
- Permissions: `rfq.read/create/update/issue/close/cancel/award` and
  `quotation.read/create/update/submit/withdraw/evaluate`. QUOTATION.DISQUALIFY
  uses `quotation.evaluate`. Supplier-facing writes are scoped to their own
  `supplier_id` if such principals exist.
- Retryable state-changing commands use idempotency; protected mutations use
  expected version, tenant/resource scope authorization, correlation,
  transactional audit and outbox. Cancel, withdraw, disqualify and award
  exceptions require reason. Award permission does not bypass approval.
- Events are `RFQ.CREATED`, `RFQ.UPDATED`, `RFQ.ISSUED`,
  `RFQ.SUBMISSIONS_CLOSED`, `RFQ.CANCELLED`, `RFQ.AWARDED`,
  `RFQ.CLOSED_NO_AWARD`, `QUOTATION.CREATED`, `QUOTATION.UPDATED`,
  `QUOTATION.SUBMITTED`, `QUOTATION.WITHDRAWN`,
  `QUOTATION.DISQUALIFIED`, `QUOTATION.ACCEPTED`, `QUOTATION.REJECTED` and
  `QUOTATION.VOIDED`. Earlier draft names RFQ.SENT, QUOTATION.RECEIVED and
  SUPPLIER.SELECTED are not emitted for TASK-071.

### Concurrency and persistence

- Serialize quotation submit vs RFQ close on RFQ version/lock.
- Serialize RFQ award vs RFQ cancel; exactly one may commit.
- Serialize same-supplier/RFQ parallel submission and enforce one current
  SUBMITTED row with a partial unique constraint.
- Parent RFQ and affected quotation state/history/audit/outbox changes commit
  atomically. Failed competing actions create no partial effects.
- Persist quotation revision references within the same tenant/RFQ/Supplier;
  preserve all submitted commercial values and append-only history.

## 4. Required Specification Updates

- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `tasks/TASK-071_RFQ_QUOTATION_SUPPLIER_SELECTION.md`
- `tasks/CODEX_TASK_REGISTRY.md`
- `CURRENT_TASK.md`
- `IMPLEMENTATION_HANDOFF.md`

## 5. Completion Report

- Made both RFQ and Quotation state machines, terminal states, command
  permissions, supplier eligibility, award/no-award/cancel atomic effects,
  revision semantics, idempotency/version/audit/outbox requirements and named
  concurrency cases normative across workflow, state-machine, permission,
  event, data-model and traceability specifications.
- Added `replaces_quotation_id`, revision identity/history and the
  tenant/RFQ/Supplier partial unique constraint requirement for one current
  `SUBMITTED` quotation.
- Replaced preliminary event names `RFQ.SENT`, `QUOTATION.RECEIVED` and
  `SUPPLIER.SELECTED` with the approved RFQ/Quotation lifecycle facts.
- Generated the detailed TASK-071 implementation contract from
  `CODEX_TASK_TEMPLATE.md` and reconciled the registry, current task and
  handoff. TASK-071 is `READY` / `NOT_STARTED`.
- No runtime code was implemented. TASK-071 remains pending explicit user
  authorization.
- Verification: cross-document rule/event/permission/transition consistency,
  Prettier and `git diff --check`.
