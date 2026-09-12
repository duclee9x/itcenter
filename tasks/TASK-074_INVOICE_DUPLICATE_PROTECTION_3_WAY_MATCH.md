# TASK-074 — Invoice + Duplicate Protection + 3-Way Match + Credit Note

## 1. Task Metadata

```yaml
task_id: TASK-074
feature_id: F-043/F-044
workflow_id: WF-P04/WF-P05
phase: P4
priority: P0
readiness: SATISFIED
status: CODE_COMPLETE
owner_domain: procurement
depends_on: TASK-072, TASK-073, TASK-074-R1
```

## 2. Objective

Implement Procurement-owned Invoice lifecycle, durable duplicate protection,
3-Way Match, match exception handling and Credit Note lifecycle/application
according to this contract and TASK-074-R1. Do not implement payment
settlement.

## 3. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `tasks/TASK-074-R1_INVOICE_DUPLICATE_MATCH_CREDIT_NOTE_CONTRACT.md`

## 4. In Scope

- Invoice and Credit Note canonical entities, histories, immutable submitted
  snapshots and API commands.
- Durable normalized supplier-document identity reservation and duplicate
  candidate review references.
- Append-only 3-Way Match evaluations, durable PO/receipt line allocations,
  Match Exceptions and context-bound Approval Engine integration.
- Credit Note partial submission/application, creditable quantity/amount
  guards and invoiceable-capacity release.
- Permissions, tenant/resource authorization, idempotency, concurrency,
  audit, outbox, timeline, actionable Work Queue references, error mapping
  and observability.

## 5. Out of Scope

- Payment settlement, payment execution, `PAID` lifecycle or ERP payment
  integration.
- Goods Receipt edits, deletion, reversal or correction. A future explicit
  Goods Receipt correction workflow owns those actions.
- Service receipt/acceptance; TASK-074 covers physical Goods Receipt evidence.
- Automatic Approval Request creation or a global invoice approval policy
  selector.
- Fuzzy duplicate auto-merge or rejection solely on a heuristic fingerprint.
- Rewriting PO commercial versions, Supplier history or POSTED Goods Receipt
  snapshots.

## 6. Current Repository Context

Existing Procurement workflows own Supplier, RFQ/Quotation, PO and Goods
Receipt. TASK-072 owns PO commercial versions. TASK-073 owns immutable Goods
Receipt posting, accepted PO receipt progress and the POSTED-only accepted
quantity query. Shared command infrastructure provides authorization,
idempotency, audit, outbox, tenant scoping and PostgreSQL tests. Inspect actual
module and migration conventions before implementation; Invoice runtime code
is not implemented by TASK-074-R1.

## 7. Domain Rules

- Invoice lifecycle is `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`,
  `CANCELLED`; terminal states are `APPROVED`, `REJECTED`, `CANCELLED`.
- Credit Note lifecycle is `DRAFT`, `SUBMITTED`, `APPLIED`, `REJECTED`,
  `CANCELLED`; terminal states are `APPLIED`, `REJECTED`, `CANCELLED`.
- Match status is independent: `NOT_EVALUATED`, `PENDING_RECEIPT`, `MATCHED`,
  `MISMATCHED`. Credit status is independently derived as `NONE`,
  `PARTIALLY_CREDITED`, `FULLY_CREDITED`.
- Submission freezes all supplier commercial fields, source references,
  lines, quantities, unit prices, tax/charges, totals and evidence references.
  Never edit submitted Invoice/Credit Note snapshots in place.
- Match only against the applicable immutable PO commercial version,
  submitted Invoice snapshot and POSTED accepted Goods Receipt quantities.
  DRAFT/CANCELLED receipts and observed/rejected/damaged quantities do not
  count.
- Partial invoices are valid. Quantity tolerance and unit-price tolerance
  are zero. Invoice currency equals PO currency. Unexpected charges mismatch;
  arithmetic line-total rounding is capped at one configured currency minor
  unit and cannot permit a price variance.
- Per PO line, net invoiceable quantity is the non-negative result of
  cumulative POSTED accepted quantity minus receipt-backed allocations and
  quantities reserved by approved mismatch exceptions, plus quantity released
  by applied Credit Notes. A partial invoice within that available quantity
  is valid.
- Quantity beyond available accepted receipt but within legitimate ordered
  quantity while further receipt remains possible is `PENDING_RECEIPT`.
  Quantity beyond legitimate PO quantity or not curable by future receipt is
  `MISMATCHED`.
- Duplicate identity is
  `tenant_id + supplier_id + document_type + normalized supplier document
  number`, with document type `INVOICE` or `CREDIT_NOTE`. Normalization is
  Unicode NFKC, trim, collapse repeated whitespace and case-normalize; retain
  punctuation. Reserve durably at submission; drafts are not reserved.
- Heuristic duplicate candidates are advisory only. Exact duplicate submit
  returns `INVOICE_DUPLICATE`.
- Each match evaluation is append-only and records its evidence fingerprint.
  Durable allocations bind Invoice line to PO line and supporting POSTED
  Goods Receipt line where applicable. PO-line serialization prevents double
  consumption under concurrent invoices.
- Mismatch reasons are canonical, including `SUPPLIER_MISMATCH`,
  `PO_NOT_ELIGIBLE`, `PO_LINE_NOT_FOUND`, `CURRENCY_MISMATCH`,
  `UNIT_PRICE_MISMATCH`, `QUANTITY_EXCEEDS_ORDERED`,
  `QUANTITY_EXCEEDS_RECEIVED`, `UNEXPECTED_CHARGE`, `TOTAL_MISMATCH`,
  `DUPLICATE_INVOICE`, `DATA_INTEGRITY_CONFLICT`.
- Every mismatch has immutable exception evidence and append-only resolution
  history. Never alter posted receipt/PO/Supplier history to force a match.
- `INVOICE.SUBMIT` starts the initial match evaluation. While status remains
  `NOT_EVALUATED` or `PENDING_RECEIPT`, invoice approval is blocked.
- For MATCHED invoices, linked `INVOICE_APPROVAL` is optional; if present it
  must be same-tenant, target this invoice, purpose `INVOICE_APPROVAL`, bind
  to current immutable invoice/match context and be APPROVED.
- MISMATCHED invoices cannot be normally approved. An approved linked
  `INVOICE_MATCH_EXCEPTION` must bind the current invoice snapshot, evaluation
  fingerprint and exception context. Acceptance preserves `MISMATCHED` and
  failed comparison evidence. It also reserves the full approved line
  quantity against later invoices, separately from receipt-backed
  allocations. Applied Credit Notes release only explicitly credited
  invoiceable quantity once; amount-only credits do not release quantity.
- Credit Notes use positive semantic quantities/amounts, match the referenced
  Invoice tenant, Supplier and currency, reference the credited Invoice/lines
  where applicable, and cannot cumulatively exceed remaining creditable line
  quantity/amount. Only explicitly credited line quantity that had consumed
  invoiceable capacity releases that quantity; amount-only credits do not
  release quantity. Application does not change PO ordered quantity, received
  quantity/history or the original Invoice.
- Approval is not payment. Do not implement `PAID` or payment-side effects.

## 8. State Transitions

```text
none → INVOICE.CREATE → DRAFT
DRAFT → INVOICE.UPDATE_DRAFT → DRAFT
DRAFT → INVOICE.SUBMIT → SUBMITTED
DRAFT → INVOICE.CANCEL → CANCELLED
SUBMITTED → INVOICE.APPROVE → APPROVED
SUBMITTED → INVOICE.REJECT → REJECTED
SUBMITTED + INVOICE.REEVALUATE_MATCH → new independent match evaluation

none → CREDIT_NOTE.CREATE → DRAFT
DRAFT → CREDIT_NOTE.UPDATE_DRAFT → DRAFT
DRAFT → CREDIT_NOTE.SUBMIT → SUBMITTED
DRAFT → CREDIT_NOTE.CANCEL → CANCELLED
SUBMITTED → CREDIT_NOTE.APPLY → APPLIED
SUBMITTED → CREDIT_NOTE.REJECT → REJECTED
```

No submitted or terminal document transitions to DRAFT. Match re-evaluation
does not change Invoice lifecycle or immutable Invoice fields.
`INVOICE.CANCEL` and `CREDIT_NOTE.CANCEL` are explicit domain commands valid
only from `DRAFT`; they are forbidden from `SUBMITTED` and later states. They
must not be implemented through generic status updates. Both use the normal
command requirements, including `expected_version`, idempotency,
tenant/resource authorization, audit, outbox and correlation context. A
reason is required when the existing command/audit standard requires it; this
task adds no separate reason requirement. Any future post-submission or
post-approval cancellation/reversal requires a separate command, permission
and compensating/reversal rules.

## 9. Preconditions

- Invoice/Credit Note and referenced Supplier, PO, PO line, Invoice line and
  receipt evidence are tenant-consistent and canonically readable.
- Update/cancel is allowed only in DRAFT; submission is allowed only in DRAFT.
- Match source receipts are POSTED and accepted quantity is read canonically.
- Current PO commercial version and immutable Invoice snapshot fingerprints
  are retained in each match evaluation.
- Approval context exactly matches the current document and match/exception
  fingerprint.
- Credit application is within remaining creditable quantity/amount and is
  not already applied.

## 10. Authorization

```yaml
invoice.read: invoice queries
invoice.create: INVOICE.CREATE
invoice.update: INVOICE.UPDATE_DRAFT and DRAFT-only INVOICE.CANCEL
invoice.submit: INVOICE.SUBMIT
invoice.match: INVOICE.REEVALUATE_MATCH
invoice.approve: INVOICE.APPROVE
invoice.reject: INVOICE.REJECT
credit_note.read: Credit Note queries
credit_note.create: CREDIT_NOTE.CREATE
credit_note.update: CREDIT_NOTE.UPDATE_DRAFT and DRAFT-only CREDIT_NOTE.CANCEL
credit_note.submit: CREDIT_NOTE.SUBMIT
credit_note.apply: CREDIT_NOTE.APPLY
credit_note.reject: CREDIT_NOTE.REJECT
```

Approval decisions use `approval.decide`. All commands enforce tenant and
resource scope. Do not add a broad `procurement.manage` permission.

## 11. Database / Data Model

Implement owning-domain persistence for Invoices, Invoice lines, submitted
document identity reservations, append-only match evaluations, durable match
allocations, Match Exceptions/history, Credit Notes/lines and one-time Credit
Note applications. Required unique identity:

```text
UNIQUE(tenant_id, supplier_id, document_type, supplier_document_number_normalized)
```

The reservation is inserted atomically at submission and retained. Add
foreign keys, tenant-consistent constraints, immutable submitted-snapshot
fences, lifecycle checks, allocation quantity invariants, creditable quantity
and amount constraints, and append-only history protections. `RECEIPT_MATCHED`
allocation quantity cannot exceed accepted POSTED receipt quantity after
applied credits. `APPROVED_EXCEPTION` reservations consume future capacity
without being represented as receipt evidence.

## 12. API

```text
POST /api/v1/invoices
POST /api/v1/invoices/{id}/commands/update-draft
POST /api/v1/invoices/{id}/commands/submit
POST /api/v1/invoices/{id}/commands/reevaluate-match
POST /api/v1/invoices/{id}/commands/approve
POST /api/v1/invoices/{id}/commands/reject
POST /api/v1/invoices/{id}/commands/cancel
POST /api/v1/credit-notes
POST /api/v1/credit-notes/{id}/commands/update-draft
POST /api/v1/credit-notes/{id}/commands/submit
POST /api/v1/credit-notes/{id}/commands/apply
POST /api/v1/credit-notes/{id}/commands/reject
POST /api/v1/credit-notes/{id}/commands/cancel
```

Adapt path naming to existing conventions without changing command semantics.
Use API field naming consistently with the repository.

## 13. Commands

```text
INVOICE.CREATE
INVOICE.UPDATE_DRAFT
INVOICE.SUBMIT
INVOICE.REEVALUATE_MATCH
INVOICE.APPROVE
INVOICE.REJECT
INVOICE.CANCEL
CREDIT_NOTE.CREATE
CREDIT_NOTE.UPDATE_DRAFT
CREDIT_NOTE.SUBMIT
CREDIT_NOTE.APPLY
CREDIT_NOTE.REJECT
CREDIT_NOTE.CANCEL
```

`INVOICE.APPROVE` validates the conditional linked approval appropriate to
MATCHED versus MISMATCHED state. `CREDIT_NOTE.APPLY` persists its application
and capacity release atomically.

## 14. Events Produced

```text
INVOICE.CREATED
INVOICE.UPDATED
INVOICE.SUBMITTED
INVOICE.DUPLICATE_DETECTED
INVOICE.MATCH_EVALUATED
INVOICE.MATCHED
INVOICE.PENDING_RECEIPT
INVOICE.MISMATCHED
INVOICE.MATCH_EXCEPTION_CREATED
INVOICE.MATCH_EXCEPTION_ACCEPTED
INVOICE.APPROVED
INVOICE.REJECTED
INVOICE.CANCELLED
CREDIT_NOTE.CREATED
CREDIT_NOTE.UPDATED
CREDIT_NOTE.SUBMITTED
CREDIT_NOTE.APPLIED
CREDIT_NOTE.REJECTED
CREDIT_NOTE.CANCELLED
```

Outbox payloads contain stable references and minimal state only; exclude full
invoice content, bank references and protected tax identifiers.

## 15. Events Consumed

- `GOODS_RECEIPT.POSTED` / canonical Procurement receipt progress as needed
  for explicit Invoice re-evaluation. Consumers are idempotent and never
  mutate Invoice snapshots or Goods Receipts.
- Approval Engine request state/context is read through its owning contract;
  no direct cross-domain table writes.

## 16. Idempotency

- Require `Idempotency-Key` for retryable state-changing commands.
- Same key + same semantic request returns the original result without a
  duplicate document, allocation, application, audit or outbox effect.
- Same key + different semantic request returns
  `IDEMPOTENCY_KEY_CONFLICT`.
- Durable document identity uniqueness is independent from command
  idempotency. Different request keys cannot submit the same normalized
  supplier document identity twice; return `INVOICE_DUPLICATE`.
- Invoice matching/allocation, exception acceptance and Credit Note
  application each have durable deduplication references.

## 17. Concurrency

Use expected versions plus database constraints/transactional serialization
for:

- Duplicate `INVOICE.SUBMIT` against `INVOICE.SUBMIT` for the same identity.
- Two partial Invoices competing for the same remaining PO-line quantity.
- `INVOICE.REEVALUATE_MATCH` against a new Goods Receipt POST/progress update.
- `INVOICE.APPROVE` against a new match evaluation or stale exception
  fingerprint.
- `CREDIT_NOTE.APPLY` replay and two Credit Notes racing for remaining
  creditable Invoice-line quantity/amount.

No application-only precheck may authorize duplicate identity, double
allocation or over-credit. A losing command reloads canonical state and
returns a canonical conflict/business error without partial effects.

## 18. Transaction Boundary

Atomically commit each owning command's canonical writes, immutable snapshots
or evaluation/allocation/application records, entity history, required audit
reference and outbox event. For match evaluation, serialize PO-line capacity
and cite canonical POSTED receipt evidence. For exception approval, record
the approval reference and full quantity reservation without changing
the failed evaluation. For Credit Note apply, validate and persist remaining
creditable amounts and any eligible released quantity in one transaction. Never hold a
transaction open for external approval, document storage, notifications or
timeline projection.

## 19. Async Side Effects

- Timeline, notifications, duplicate-candidate Work Queue enrichment and
  downstream projections may be asynchronous.
- Create actionable Work Queue references for blocking mismatch, duplicate
  review, unresolved approval or reconciliation/data-integrity failure;
  normal MATCHED invoices need no Work Item.
- Approval Request creation is not automatic; an existing linked request is
  validated synchronously at Invoice approval.
- Document bytes use the existing document governance/storage system.

## 20. Audit Requirements

Append audit for Invoice submission and duplicate detection, each match
evaluation, exception creation/resolution/acceptance, approval/rejection and
Credit Note submit/apply/reject. Record actor, tenant, entities, PO and
relevant POSTED receipt references, lifecycle/match/credit before/after,
reason, approval, correlation and outcome. Do not include document bytes,
bank references or protected tax identifiers.

## 21. Timeline Requirements

Primary timelines: Invoice, Credit Note and PO. Show submission, current match
outcome, pending receipt, mismatch reason summary, accepted exception and
Credit Note application. Timeline is an operator-facing projection only;
canonical history/evaluation/allocation remains authoritative.

## 22. Notification Requirements

No new notification channel is required by this task. Use existing
notification policy/templates only when an existing normative rule applies;
do not create approval requests automatically.

## 23. Search / Projection Impact

Expose tenant/resource-authorized Invoice and Credit Note read models. Search
only identifiers and safe metadata according to existing search policy; do
not index full invoice content, tax identifiers or bank references. Projections
are non-authoritative.

## 24. Error Codes

```text
INVOICE_DUPLICATE                         409
INVOICE_MATCH_EXCEPTION_REQUIRED          409
INVOICE_APPROVAL_STALE                     409
CREDIT_NOTE_OVER_CREDITABLE_AMOUNT         422
VERSION_CONFLICT                           409
IDEMPOTENCY_KEY_CONFLICT                   409
PERMISSION_DENIED                          403
NOT_FOUND                                  404
```

Use canonical mismatch reason codes for evaluations rather than treating
every mismatch as a command transport error.

## 25. Retry / Compensation

- Do not retry duplicate, authorization, invalid-state or business quantity
  errors without a changed request/current business state.
- Retry only transient storage/dependency failures within existing budgets.
- On uncertain Credit Note application outcome, read its durable application
  before retrying; do not blindly apply again.
- No compensation rewrites a submitted commercial document. Corrections use
  replacement Invoice/Credit Note; Goods Receipt correction is out of scope.

## 26. Observability

Record structured command/evaluation outcomes with tenant, correlation,
causation, entity IDs, match evaluation version, duplicate result,
allocation/application references, conflict counts and retry exhaustion.
Metrics include duplicate submission conflicts, match outcomes, pending
receipt age, mismatch/exception age, allocation conflicts and over-credit
rejections. Do not log protected document values.

## 27. Required Tests

### Unit / Domain / Repository / API / E2E

- [ ] Create, update and submit Invoice; freeze every submitted commercial
  field and reject all edits/reopen attempts.
- [ ] DRAFT-only Invoice and Credit Note cancellation use `invoice.update`
  and `credit_note.update`; no separate cancel permissions are required.
- [ ] CANCEL is rejected after SUBMITTED and cannot be reached through a
  generic status-update operation; successful draft cancellation records its
  audit and outbox effects once under idempotent/version-checked execution.
- [ ] Exact normalized duplicate Invoice/Credit Note fails durably; concurrent
  duplicate submission has one winner and maps DB uniqueness to
  `INVOICE_DUPLICATE`; candidate duplicate is advisory only.
- [ ] NFKC, trim, whitespace collapse and case normalization are deterministic;
  punctuation remains significant.
- [ ] Partial invoices allocate independently; multiple partial invoices can
  cover one PO line without requiring full-PO billing.
- [ ] Only POSTED accepted receipt quantity contributes; draft/cancelled,
  observed, rejected and damaged quantities do not.
- [ ] Not-yet-received but legitimate quantity is `PENDING_RECEIPT`; quantity
  beyond ordered capacity or not curable by receipt is `MISMATCHED`.
- [ ] Price, currency, unexpected charge and total mismatches are recorded;
  zero business tolerance and one-minor-unit arithmetic rounding are enforced.
- [ ] Canonical mismatch reason codes include supplier/PO/line, currency,
  unit-price, ordered/received quantity, unexpected charge, total, duplicate,
  tax, item, charge and data-integrity failures.
- [ ] Matched Invoice approval succeeds with no linked request; when a linked
  `INVOICE_APPROVAL` exists it must match tenant/target/purpose/context and be
  APPROVED. Pending/rejected/expired/cancelled or stale approvals block.
- [ ] MISMATCHED Invoice cannot normally approve; approved current
  `INVOICE_MATCH_EXCEPTION` permits approval without changing match result or
  comparison evidence and reserves full approved quantity.
- [ ] New Goods Receipt followed by explicit re-evaluation can progress
  PENDING_RECEIPT to MATCHED while preserving old evaluations.
- [ ] Concurrent partial invoices cannot allocate the same remaining
  quantity; loser re-evaluates against current evidence.
- [ ] Create/update/submit/apply/reject/cancel Credit Note; partial credits
  work, over-credit fails, duplicate application replays once, and concurrent
  applications cannot exceed remaining line quantity/amount.
- [ ] Applied Credit Note releases eligible credited quantity once; an
  amount-only credit does not release quantity and no application mutates PO,
  posted receipt or original Invoice evidence.
- [ ] Invoice mismatch never changes a POSTED Goods Receipt.
- [ ] Audit/outbox atomicity, timeline projection and protected-field
  redaction are verified.

## 28. Acceptance Criteria

1. Both lifecycle state machines and independent match/credit dimensions
   follow the normative transitions.
2. Submitted documents are immutable and exact document identity is
   transactionally unique.
3. Matching uses immutable PO/Invoice evidence and POSTED accepted receipt
   quantities only, with specified zero business tolerances.
4. Partial allocations and Credit Note releases are durable and concurrency
   safe; no quantity or amount can be consumed/released twice.
5. Match history and exception evidence are append-only; exception approval
   never rewrites `MISMATCHED` into `MATCHED`.
6. Context-bound conditional approvals are validated and stale approvals
   cannot authorize changed evidence.
7. Commands enforce exact permissions, tenant/resource scope, idempotency,
   expected-version handling, audit and outbox.
8. Events, timeline and Work Queue do not leak protected financial/tax data
   and never replace canonical source-of-truth.
9. Every required concurrency/failure case passes PostgreSQL-backed tests.
10. No payment settlement or Goods Receipt mutation is implemented.

## 29. Verification Commands

Run applicable repository commands, including:

```text
npm run format:check
npm run lint
npm run typecheck
npm test
git diff --check
```

Add migration, event-contract and PostgreSQL E2E coverage following repository
conventions.

## 30. Codex Execution Protocol

Inspect current Procurement, Approval, Goods Receipt, idempotency, audit,
outbox and Work Queue application contracts. Implement only this task after
explicit authorization. Do not modify other domain tables directly. Resolve
any material contradiction as `SPEC_CONFLICT` before runtime work.

## 31. Required Completion Report

Report implementation status; files and migrations; APIs/commands/events and
permissions; audit/timeline; tests and exact results; remaining gaps; spec
conflicts; assumptions. Do not claim payment or Goods Receipt correction is
implemented.
