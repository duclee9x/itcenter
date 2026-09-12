# PROCUREMENT + SUPPLIER + PO + INVOICE + CONTRACT + DOCUMENT MANAGEMENT WORKFLOW SPEC
## Execution-Level Workflow Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:**  
- `ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `MAINTENANCE_WARRANTY_REPLACEMENT_DISPOSAL_WORKFLOW.md`
- `SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md`

**Scope:** Procurement Request, Supplier, RFQ/Quotation, Approval, Purchase Order, Goods Receipt, Invoice, 3-Way Match, Payment Record, Contract, Warranty/Support Contract, License Renewal, Document Lifecycle, Document Linking, Audit Trail

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa chuỗi tài chính/chứng từ:

```text
Business Need
→ Procurement Request
→ Budget Check
→ Supplier/RFQ
→ Quote Comparison
→ Approval
→ Purchase Order
→ Goods/Service Receipt
→ Invoice
→ 3-Way Match
→ Payment Record
→ Asset / License / Contract Update
→ Document Archive
```

Các nhu cầu có thể đến từ:

```text
New Asset Request
Replacement Plan
Maintenance Spare Part
Warranty Renewal
License Renewal
Software Purchase
Network Equipment
Service Contract
Project Procurement
Emergency Purchase
```

Mục tiêu:

- mọi khoản mua có nguồn yêu cầu rõ ràng;
- không tách Procurement khỏi Asset/License/Maintenance;
- PO, Receipt, Invoice, Contract và Asset liên kết xuyên suốt;
- hỗ trợ partial delivery, partial invoice;
- kiểm soát chênh lệch số lượng/giá;
- không duplicate invoice;
- hỗ trợ 3-way match;
- contract/warranty/license expiry được theo dõi;
- document có version, permission, retention và audit trail;
- giảm nhập lại dữ liệu từ request → PO → receiving → invoice.

---

# 2. Core Entities

```text
PROCUREMENT REQUEST
PROCUREMENT LINE
BUDGET
COST CENTER
PROJECT
SUPPLIER
SUPPLIER CONTACT
RFQ
RFQ LINE
QUOTATION
QUOTATION LINE
QUOTE COMPARISON
PURCHASE ORDER
PO LINE
GOODS RECEIPT
SERVICE RECEIPT
INVOICE
INVOICE LINE
CREDIT NOTE
PAYMENT RECORD
CONTRACT
CONTRACT LINE
SERVICE CONTRACT
WARRANTY CONTRACT
LICENSE CONTRACT
SUPPORT CONTRACT
RENEWAL
ASSET
ASSET MODEL
LICENSE ENTITLEMENT
SOFTWARE PRODUCT
MAINTENANCE ORDER
SPARE PART
DOCUMENT
DOCUMENT VERSION
APPROVAL
AUDIT TRAIL
```

---

# 3. Procurement Request Sources

Procurement Request có thể được tạo từ:

```text
User Asset Request
Replacement Plan
Warehouse Reorder
Maintenance Part Request
Warranty Renewal
License Renewal
Software Request
Contract Renewal
Network Expansion
Manual Request
```

Mỗi request phải giữ:

```text
source_type
source_id
requester
business_reason
requested_items
target_date
cost_center
project
budget
priority
```

---

# 4. WF-PROC01 — Create Procurement Request

## Trigger

```text
PROCUREMENT.REQUEST_CREATED  # DRAFT persisted
PROCUREMENT.REQUESTED        # DRAFT submitted
```

## Required Fields

```text
Requester
Business Reason
Item/Service
Quantity
Target Date
Cost Center / Project
Estimated Cost if available
```

## Context Enrichment

System tự lấy:

```text
requested asset profile
existing stock
existing contract
preferred supplier
historical purchase price
replacement plan
license usage
maintenance need
```

---

# 5. Stock Check Before Purchase

Trước mua mới:

```text
Request
↓
Check Existing Stock
```

Nếu có hàng phù hợp:

```text
Reserve Existing Stock
→ do not create unnecessary PO
```

Nếu không:

```text
Continue Procurement
```

Rule này đặc biệt quan trọng với:

```text
Laptop
Monitor
Spare Part
License Seat
```

---

# 6. Duplicate Demand Prevention

System kiểm tra:

```text
same requester
same item
same project
same active request
same target period
```

Nếu duplicate:

```text
link / merge / warn
```

Không tự tạo nhiều procurement requests do retry.

---

# 7. Budget Check

Possible result:

```text
AVAILABLE
PARTIALLY_AVAILABLE
NOT_AVAILABLE
NOT_REQUIRED
NEEDS_REVIEW
```

Nếu budget thiếu:

```text
WAITING_BUDGET
```

Không chuyển sang PO nếu policy yêu cầu budget approval trước.

---

# 8. Procurement Request States

```text
DRAFT
SUBMITTED
UNDER_REVIEW
WAITING_BUDGET
WAITING_RFQ
WAITING_APPROVAL
APPROVED
ORDERED
PARTIALLY_FULFILLED
FULFILLED
REJECTED
CANCELLED
```

---

# 9. Approval Rules

Approval có thể dựa trên:

```text
Amount
Category
Cost Center
Project
Emergency
Supplier
Security Impact
Contract Type
```

Ví dụ:

```text
< threshold A
→ Department Manager

threshold A-B
→ Department Manager + IT Manager

> threshold B
→ Finance + Procurement + IT Manager
```

Threshold configurable.

---

# 10. Segregation of Duties

Policy có thể yêu cầu:

```text
Requester != Final Approver
Buyer != Invoice Approver
Receiver != Invoice Approver
```

Không hardcode nếu tổ chức không yêu cầu, nhưng hệ thống phải hỗ trợ.

---

# 11. Supplier Master

Supplier record:

```yaml
supplier:
  id:
  legal_name:
  tax_id:
  address:
  contacts:
  bank_info_reference:
  categories:
  status:
  rating:
  preferred:
  contracts:
  sla:
  risk:
```

Không expose bank/payment-sensitive information cho role không cần thiết.

---

# 12. Supplier Status

```text
PROSPECT
APPROVED
PREFERRED
SUSPENDED
BLOCKED
INACTIVE
```

`INACTIVE` is not terminal. Supplier records must not be hard-deleted because
they may be referenced by RFQs, Quotations, Purchase Orders, Invoices or
Contracts. Lifecycle changes never delete or rewrite those commercial records.

## 12.1 Normative Supplier Lifecycle Commands

The Procurement domain owns the Supplier state machine. State is changed only
through the following explicit commands; clients must not write Supplier state
through generic update/PATCH operations.

| Command | From | To | Permission |
|---|---|---|---|
| `SUPPLIER.CREATE` | none | `PROSPECT` | `supplier.create` |
| `SUPPLIER.APPROVE` | `PROSPECT` | `APPROVED` | `supplier.approve` |
| `SUPPLIER.MARK_PREFERRED` | `APPROVED` | `PREFERRED` | `supplier.approve` |
| `SUPPLIER.REMOVE_PREFERRED` | `PREFERRED` | `APPROVED` | `supplier.approve` |
| `SUPPLIER.SUSPEND` | `APPROVED`, `PREFERRED` | `SUSPENDED` | `supplier.status.change` |
| `SUPPLIER.RESUME` | `SUSPENDED` | `APPROVED` | `supplier.status.change` |
| `SUPPLIER.BLOCK` | `PROSPECT`, `APPROVED`, `PREFERRED`, `SUSPENDED` | `BLOCKED` | `supplier.block` |
| `SUPPLIER.UNBLOCK` | `BLOCKED` | `PROSPECT` | `supplier.block` |
| `SUPPLIER.DEACTIVATE` | any non-`INACTIVE` state | `INACTIVE` | `supplier.status.change` |
| `SUPPLIER.REACTIVATE` | `INACTIVE` | `PROSPECT` | `supplier.status.change` |

Profile changes use `SUPPLIER.UPDATE_PROFILE` and `supplier.update`; this
command cannot change lifecycle state. The following transitions are
forbidden: `BLOCKED -> APPROVED`, `BLOCKED -> PREFERRED`,
`INACTIVE -> APPROVED`, and `INACTIVE -> PREFERRED`. Such Suppliers must return
to `PROSPECT` and complete re-qualification first. A Supplier that was
`PREFERRED`, then `SUSPENDED`, becomes `APPROVED` on `SUPPLIER.RESUME`; previous
preference is not restored implicitly.

Every mutating command is tenant- and resource-scope authorized, idempotent,
audited and committed with its outbox event. Existing-record profile and
lifecycle changes require `expected_version`; every Supplier write requires a
non-empty reason. `Idempotency-Key` is required for retryable writes. Audit
records capture actor, reason, before/after state or changed-field names,
expected/new version, correlation and outcome. Events publish only after
commit. Competing lifecycle commands use optimistic concurrency against the
same Supplier version; at most one command based on a version may succeed, and
the loser receives `VERSION_CONFLICT` without a second history/audit/outbox
transition.

## 12.2 Supplier Eligibility and Commercial History

- RFQ candidates may be in `PROSPECT`, `APPROVED` or `PREFERRED`.
- New Purchase Orders may be issued only to `APPROVED` or `PREFERRED`
  Suppliers. `SUSPENDED`, `BLOCKED` and `INACTIVE` Suppliers are ineligible.
- State changes do not automatically cancel or mutate an existing RFQ,
  Quotation, Purchase Order, Invoice or Contract. TASK-070 does not implement
  such commercial cancellation behavior.
- The Supplier state is authoritative for new RFQ candidate and PO issue
  decisions; candidate/issue commands revalidate canonical Supplier state at
  execution time.

---

# 13. Supplier Evaluation

Track:

```text
Price
Delivery Accuracy
Quality
SLA Compliance
Warranty Handling
Repair Quality
Invoice Accuracy
Support Responsiveness
```

---

# 14. WF-PROC02 — RFQ

RFQ dùng khi cần lấy báo giá nhiều nhà cung cấp.

Flow:

```text
Approved Procurement Need
↓
Create RFQ
↓
Select Suppliers
↓
Send RFQ
↓
Receive Quotes
↓
Normalize
↓
Compare
↓
Select Supplier
```

---

# 15. RFQ States

```text
DRAFT
OPEN
EVALUATING
AWARDED
CLOSED_NO_AWARD
CANCELLED
```

Terminal: `AWARDED`, `CLOSED_NO_AWARD`, `CANCELLED`. Normative commands and
transition guards are defined in section 18.1.

---

# 16. Quotation Model

```yaml
quotation:
  supplier:
  quote_number:
  currency:
  valid_until:
  lead_time:
  payment_terms:
  warranty:
  delivery_terms:
  lines:
  attachments:
  state:
```

Quotation states are `DRAFT`, `SUBMITTED`, `WITHDRAWN`, `DISQUALIFIED`,
`ACCEPTED`, `REJECTED` and `VOID`; terminal states are all except `DRAFT` and
`SUBMITTED`. Normative commands and guards are defined in section 18.2.

---

# 17. Quote Comparison

Không chỉ so giá.

Factors:

```text
Unit Price
Total Price
Lead Time
Warranty
Payment Terms
Supplier Score
Availability
Support
Delivery Cost
Technical Match
```

System có thể đưa recommendation nhưng phải explainable.

---

# 18. Quote Exception

Nếu chọn supplier không phải lựa chọn tốt nhất theo score:

```text
require reason
```

Ví dụ:

```text
Lowest price not selected because delivery time exceeds project deadline.
```

---

## 18.1 Normative RFQ Lifecycle

The Procurement domain owns the RFQ lifecycle. Its states are:

```text
DRAFT
OPEN
EVALUATING
AWARDED
CLOSED_NO_AWARD
CANCELLED
```

`AWARDED`, `CLOSED_NO_AWARD` and `CANCELLED` are terminal. State changes use
only these commands:

| From | Command | To | Permission |
|---|---|---|---|
| none | `RFQ.CREATE` | `DRAFT` | `rfq.create` |
| `DRAFT` | `RFQ.UPDATE_DRAFT` | `DRAFT` | `rfq.update` |
| `DRAFT` | `RFQ.ISSUE` | `OPEN` | `rfq.issue` |
| `DRAFT`, `OPEN`, `EVALUATING` | `RFQ.CANCEL` | `CANCELLED` | `rfq.cancel` |
| `OPEN` | `RFQ.CLOSE_SUBMISSIONS` | `EVALUATING` | `rfq.close` |
| `EVALUATING` | `RFQ.AWARD` | `AWARDED` | `rfq.award` |
| `EVALUATING` | `RFQ.CLOSE_NO_AWARD` | `CLOSED_NO_AWARD` | `rfq.close` |

When an RFQ references a Procurement Request, that request must be tenant-bound
and in `WAITING_RFQ`. TASK-071 does not advance the Procurement Request state.

RFQ commercial terms and its supplier candidate list may change only through
`RFQ.UPDATE_DRAFT` while the RFQ is `DRAFT`. After `RFQ.ISSUE`, material
changes require cancellation and creation of a new RFQ. TASK-071 defines no
open-RFQ amendment workflow. `RFQ.ISSUE` revalidates candidate eligibility;
`RFQ.AWARD` revalidates the selected Supplier's current state and required
approval policy. Approval is conditional: if one or more same-tenant approval
requests with `source_type=RFQ_AWARD` target this RFQ, every linked request must
be `APPROVED`; otherwise award may proceed without an approval request. TASK-071
does not create approval requests or infer an approval threshold.

`RFQ.AWARD` is one Procurement transaction. It requires an `EVALUATING` RFQ, a
selected `SUBMITTED` quotation belonging to that RFQ, a currently
`APPROVED`/`PREFERRED` Supplier, and any linked approval request must be
`APPROVED`. It persists the award decision, transitions the RFQ to `AWARDED`,
accepts the selected quotation, rejects every other `SUBMITTED` quotation, and
voids every remaining `DRAFT` quotation. If any guard fails, none of those
writes, histories, audits or events commit.

`RFQ.CLOSE_NO_AWARD` transitions each remaining `SUBMITTED` quotation to
`REJECTED` and each remaining `DRAFT` quotation to `VOID` in the same
transaction. `RFQ.CANCEL` voids associated `DRAFT` and `SUBMITTED` quotations.
Thus no terminal RFQ has a non-terminal child quotation. These parent actions
never change already terminal quotation history. No terminal RFQ may transition
again.

## 18.2 Normative Quotation Lifecycle

Quotation states are:

```text
DRAFT
SUBMITTED
WITHDRAWN
DISQUALIFIED
ACCEPTED
REJECTED
VOID
```

`WITHDRAWN`, `DISQUALIFIED`, `ACCEPTED`, `REJECTED` and `VOID` are terminal.
The state transitions and permissions are:

| From | Command | To | Permission |
|---|---|---|---|
| none | `QUOTATION.CREATE` | `DRAFT` | `quotation.create` |
| `DRAFT` | `QUOTATION.UPDATE_DRAFT` | `DRAFT` | `quotation.update` |
| `DRAFT` | `QUOTATION.SUBMIT` | `SUBMITTED` | `quotation.submit` |
| `DRAFT`, `SUBMITTED` | `QUOTATION.WITHDRAW` | `WITHDRAWN` | `quotation.withdraw` |
| `SUBMITTED` | `QUOTATION.DISQUALIFY` | `DISQUALIFIED` | `quotation.evaluate` |
| selected `SUBMITTED` | parent `RFQ.AWARD` | `ACCEPTED` | `rfq.award` |
| other active `SUBMITTED` | parent `RFQ.AWARD` | `REJECTED` | `rfq.award` |
| active `SUBMITTED` | parent `RFQ.CLOSE_NO_AWARD` | `REJECTED` | `rfq.close` |
| `DRAFT`, `SUBMITTED` | parent `RFQ.CANCEL` | `VOID` | `rfq.cancel` |
| remaining `DRAFT` | parent `RFQ.AWARD` | `VOID` | `rfq.award` |
| remaining `DRAFT` | parent `RFQ.CLOSE_NO_AWARD` | `VOID` | `rfq.close` |

“Active” in the parent RFQ decisions means a quotation currently in
`SUBMITTED`; already terminal quotation records are not rewritten. A
`SUBMITTED` quotation is immutable. While its parent RFQ remains `OPEN`, a
supplier revises a submitted offer by withdrawing it, creating a new `DRAFT`
quotation linked by `replaces_quotation_id` (and its revision reference), then
submitting the new record. The referenced prior quotation must be `WITHDRAWN`
and belong to the same tenant, RFQ and Supplier. Previously submitted
commercial values are never overwritten.

For one tenant, RFQ and Supplier, at most one current quotation may be
`SUBMITTED`. Concurrent submissions serialize on the parent RFQ and enforce
this invariant in application logic and a partial database unique constraint.
On supplier-facing requests, `quotation.create`, `quotation.update`,
`quotation.submit` and `quotation.withdraw` are additionally scoped to the
principal's own `supplier_id`.

## 18.3 Supplier Eligibility

- `PROSPECT`, `APPROVED` and `PREFERRED` Suppliers may participate in an RFQ
  and submit quotations.
- A `PROSPECT` Supplier's quotation may be evaluated but cannot be awarded
  until that Supplier is `APPROVED` or `PREFERRED`.
- Only `APPROVED` and `PREFERRED` Suppliers are award-eligible. `SUSPENDED`,
  `BLOCKED` and `INACTIVE` Suppliers cannot submit a new quotation or receive
  an award.
- Check canonical Supplier state at RFQ issue, quotation submission and
  award. A state change does not rewrite a previously submitted quotation.

## 18.4 Command Integrity and Concurrency

Where applicable, every state-changing command carries `expected_version`,
`Idempotency-Key`, tenant/resource-scope authorization, correlation ID and
reason for cancellation, withdrawal, disqualification or an award exception.
Every committed mutation records audit before/after evidence and writes its
outbox event in the same transaction. Approval policy remains separate from
`rfq.award`; command permission cannot bypass a required approval.

Serialize `QUOTATION.SUBMIT` against `RFQ.CLOSE_SUBMISSIONS` on the RFQ
aggregate: if submit wins, the quotation is included before the RFQ enters
`EVALUATING`; if close wins, the later submit is rejected and creates no
submission event. Serialize `RFQ.AWARD` against `RFQ.CANCEL` on RFQ version;
exactly one may commit and a terminal RFQ cannot take the competing action.
Parallel submissions for the same tenant/RFQ/Supplier produce at most one
current `SUBMITTED` quotation; the losing command receives a conflict and
must not emit a second submit event.

# 19. WF-PROC03 — Create and Manage Purchase Order

Preconditions for issue:

```text
PO is DRAFT and expected_version matches
Supplier is APPROVED or PREFERRED
PO has at least one valid line and all required commercial fields
If linked to an RFQ, that RFQ is AWARDED, the PO Supplier is the winning
Supplier, and the source quotation is the ACCEPTED quotation
Any linked PO_ISSUE approval is valid for the current PO version/context
```

Flow:

```text
Approved Procurement Request / accepted RFQ quotation
→ PO.CREATE (DRAFT; receipt_state NOT_RECEIVED)
→ PO.UPDATE_DRAFT as needed
→ PO.ISSUE (freeze commercial version 1)
→ PO.HOLD / PO.RESUME as operationally required
→ Goods Receipt updates receipt_state through the Procurement/Warehouse-owned TASK-073 workflow
→ PO.CLOSE when fully received, or PO.CLOSE_REMAINDER when intentionally
  short-closed after partial receipt
```

Approval is a control gate, not a PO lifecycle state. TASK-072 does not infer
an approval threshold or require approval for every issue: no linked
`PO_ISSUE` approval request means `PO.ISSUE` may proceed subject to other
guards. A linked request must belong to the same tenant, target this PO, have
purpose/type `PO_ISSUE`, be `APPROVED`, and bind to the current aggregate and
commercial version plus the canonical context snapshot. An approval for an
older version or different context cannot authorize issue. Pending, rejected,
expired, cancelled or stale linked approval blocks issue. Material draft
changes after approval require approval re-evaluation under the Approval
Engine context-snapshot rules.

The PO's nullable `issue_approval_request_id` is the authoritative current
link. The Approval Engine owns setting/replacing this link through its
application contract; prior approval requests remain immutable history but
are no longer the current link after replacement. A stale current link blocks
issue until re-evaluation replaces it with a request bound to the current
snapshot. TASK-072 neither creates approval requests nor lets the caller clear
an existing current link to bypass its gate.

## 19.1 Independent PO State Dimensions

Purchase Order has two independent dimensions:

```text
Lifecycle: DRAFT | ISSUED | ON_HOLD | CLOSED | CANCELLED
Receipt:   NOT_RECEIVED | PARTIALLY_RECEIVED | FULLY_RECEIVED
```

`CLOSED` and `CANCELLED` are terminal lifecycle states. Receipt states are not
lifecycle states. TASK-073 Goods Receipt POST may transition
`NOT_RECEIVED → PARTIALLY_RECEIVED`, `NOT_RECEIVED → FULLY_RECEIVED`,
`PARTIALLY_RECEIVED → PARTIALLY_RECEIVED`, or
`PARTIALLY_RECEIVED → FULLY_RECEIVED`. Only accepted quantity counts.
Closing an incomplete order preserves `PARTIALLY_RECEIVED`; it does not
pretend the order was fully received. Invoice state is independent.

## 19.2 Normative PO Lifecycle Commands

| From | Command | To | Guard / effect |
|---|---|---|---|
| none | `PO.CREATE` | `DRAFT` | Start at `receipt_state=NOT_RECEIVED`; persist draft and initial history. |
| `DRAFT` | `PO.UPDATE_DRAFT` | `DRAFT` | Draft fields/lines may change; increment aggregate version. |
| `DRAFT` | `PO.ISSUE` | `ISSUED` | Validate Supplier/RFQ/Quotation and linked approval; freeze commercial version 1. |
| `DRAFT` | `PO.CANCEL` | `CANCELLED` | No committed Goods Receipt; record reason. |
| `ISSUED` | `PO.HOLD` | `ON_HOLD` | Reason required; no new receipt may be posted while held. |
| `ON_HOLD` | `PO.RESUME` | `ISSUED` | Preserve receipt state. |
| `ISSUED`, `ON_HOLD` | `PO.CANCEL` | `CANCELLED` | Allowed only when receipt state is `NOT_RECEIVED` and no committed receipt exists; reason required. |
| `ISSUED`, `ON_HOLD` | `PO.CLOSE` | `CLOSED` | Requires `receipt_state=FULLY_RECEIVED`. |
| `ISSUED`, `ON_HOLD` | `PO.CLOSE_REMAINDER` | `CLOSED` | Requires `receipt_state=PARTIALLY_RECEIVED`; reason required; preserve received quantities and history. |

Once any Goods Receipt has committed, `PO.CANCEL` is forbidden, including
when a data inconsistency reports `NOT_RECEIVED`. Use `CANCELLED` for an
unfulfilled order and `CLOSED` for a fulfilled or intentionally short-closed
order. No transition out of `CLOSED` or `CANCELLED` is valid.

## 19.3 Draft Update and Issued-PO Amendment

`PO.UPDATE_DRAFT` is the only edit command while lifecycle is `DRAFT`. It
increments the optimistic aggregate version and does not create an issued-PO
amendment.

After issue, commercial changes use explicit `PO.AMEND`, only when lifecycle
is `ISSUED` or `ON_HOLD` and receipt state is `NOT_RECEIVED`. `PO.AMEND`
requires a reason, preserves the previous immutable commercial version, and
creates a new immutable version with its own before/after snapshot, actor,
reason, approval reference if applicable and timestamp. Supplier cannot be
changed after issue; changing Supplier requires cancelling the unreceived PO
and creating a new one.

If receipt state is `PARTIALLY_RECEIVED` or `FULLY_RECEIVED`, TASK-072 cannot
amend Supplier, quantity, unit price or any other commercial term. Use
`PO.CLOSE_REMAINDER` for an unreceived balance when appropriate. A future
explicit post-receipt amendment contract may extend this rule.

If a `PO_AMENDMENT` approval is linked, it must be same-tenant, target this PO,
be `APPROVED`, bind to the current base PO version and proposed change context
snapshot, and remain valid under Approval Engine re-evaluation rules. If none
is linked, the amendment may proceed subject to other guards. A material
change after approval invalidates that approval and requires re-evaluation;
an approval for an older base version or different proposed snapshot cannot
authorize the amendment. `PO.AMEND` accepts an optional approval request
reference; when supplied, it is persisted in the new immutable version. An
existing linked request that is pending, rejected, expired, cancelled or bound
to different amendment context blocks the command. A caller cannot bypass a
linked gate by omitting the reference.

## 19.4 Concurrency Ownership

All PO commands use optimistic aggregate-version checks and serialize writes
on the PO aggregate.

- `PO.UPDATE_DRAFT` vs `PO.ISSUE`: only a command based on the current DRAFT
  version may commit; after issue, a draft update is invalid.
- `PO.AMEND` vs `PO.CANCEL`: both fence on the same PO version; at most one
  competing command based on that version commits. The winner's state/version
  determines whether the other command is rejected.
- `GOODS_RECEIPT.POST` vs `PO.HOLD`, `PO.CANCEL`, `PO.AMEND` (especially the
  first receipt), relevant `PO.CLOSE_REMAINDER`, and parallel receipt posts
  competing for remaining line quantity serialize on the PO identity/version.
  POST is allowed only while `ISSUED`; if receipt wins, the PO command must
  revalidate receipt state/progress; if hold/cancel/close wins, POST fails.
  TASK-073 owns these integration races; TASK-072 provides the PO-side
  locking/version/invariant boundary.

State-changing commands require `expected_version` for existing POs,
idempotency, tenant/resource authorization, correlation, audit before/after
and a transactional outbox event. `PO.HOLD`, `PO.CANCEL`, `PO.AMEND` and
`PO.CLOSE_REMAINDER` require a non-empty reason. Approval waits and external
calls remain outside the PO transaction.

## 20. PO Model

The canonical PO stores independent lifecycle and receipt dimensions, an
aggregate version and the current commercial version. The lifecycle fields
are independent of approval request state and Goods Receipt records.

```yaml
purchase_order:
  tenant_id:
  id:
  po_code:
  procurement_request_id:
  supplier_id:
  rfq_id:
  accepted_quotation_id:
  lifecycle_state: DRAFT | ISSUED | ON_HOLD | CLOSED | CANCELLED
  receipt_state: NOT_RECEIVED | PARTIALLY_RECEIVED | FULLY_RECEIVED
  aggregate_version:
  current_commercial_version: # null before issue; starts at 1 on issue
  currency:
  issued_at:
  expected_delivery:
```

If `rfq_id` is set, `accepted_quotation_id` must belong to that RFQ and
reference the winning Supplier. The PO Supplier must equal that winning
Supplier. Cross-tenant references are forbidden.

## 21. PO Commercial Lines and Immutable Versions

```yaml
purchase_order_version:
  tenant_id:
  purchase_order_id:
  commercial_version:
  base_aggregate_version:
  canonical_snapshot:
  snapshot_hash:
  created_by:
  reason:
  approval_request_id:
  correlation_id:
  created_at:
```

The DRAFT working copy is mutable only through `PO.UPDATE_DRAFT`. `PO.ISSUE`
creates immutable commercial version 1. Each allowed `PO.AMEND` creates the
next immutable version; it never updates an earlier version or its lines.
Store a canonical snapshot of Supplier/source references, currency, terms,
delivery fields and every line's item, description, quantity, unit, unit
price, tax, discount and references. Persist its stable hash for approval
binding. Keep immutable version records/lines append-only; aggregate state
history records lifecycle, receipt-state observations, before/after,
expected/resulting aggregate version, actor, reason and correlation.

Goods Receipt lines must refer to the PO and the commercial version/line they
received. TASK-073 owns the receipt ledger and receipt-state progression. A
receipt does not rewrite a PO commercial version.

---

# 24. WF-PROC04 — Goods Receipt Integration

TASK-073 owns canonical Goods Receipt creation/posting and PO accepted-quantity
progress. A Goods Receipt is a posted fact of physical receiving; it is not a
PO lifecycle state and does not create Asset records inside the Procurement
transaction. Procurement/Warehouse owns the receipt aggregate and snapshot;
Asset owns asset registration.

Flow:

```text
GOODS_RECEIPT.CREATE → DRAFT
GOODS_RECEIPT.UPDATE_DRAFT → DRAFT
GOODS_RECEIPT.POST → POSTED + PO accepted-quantity/receipt-state update
commit receipt, PO progress, audit and outbox atomically
GOODS_RECEIPT.POSTED → asynchronous Asset registration for accepted tracked units
```

## 24.1 Goods Receipt Lifecycle

```text
DRAFT → POST → POSTED
DRAFT → CANCEL → CANCELLED
```

`POSTED` and `CANCELLED` are terminal. `POSTED` is immutable and represents
an actual receiving fact. Never delete a receipt or transition `POSTED` back
to `DRAFT`/`CANCELLED`. Corrections or reversals require a future explicit
compensating workflow and are out of scope for TASK-073. Draft edits and
cancellation do not change PO receipt progress. Cancellation requires a
reason.

## 24.2 PO Receipt Progress and Eligibility

PO lifecycle remains independent:

```text
Lifecycle: DRAFT | ISSUED | ON_HOLD | CLOSED | CANCELLED
Receipt:   NOT_RECEIVED | PARTIALLY_RECEIVED | FULLY_RECEIVED
```

Only `GOODS_RECEIPT.POST` changes PO receipt state. The transitions are:

```text
NOT_RECEIVED → PARTIALLY_RECEIVED
NOT_RECEIVED → FULLY_RECEIVED
PARTIALLY_RECEIVED → PARTIALLY_RECEIVED
PARTIALLY_RECEIVED → FULLY_RECEIVED
```

Posting never closes the PO. `FULLY_RECEIVED` means quantities are fulfilled;
`PO.CLOSE` remains an explicit lifecycle command. A receipt may post only when
the PO lifecycle is `ISSUED`; `DRAFT`, `ON_HOLD`, `CLOSED` and `CANCELLED`
are ineligible. Supplier must match the PO supplier/context, and every receipt
line must reference a line in the current issued commercial version. Receipt
lines retain that immutable PO commercial-version context.

## 24.3 Quantity and Condition Rules

For each PO line:

```text
remaining_quantity = ordered_quantity - previously_accepted_quantity
accepted_quantity > 0 for every posted receipt line
cumulative accepted_quantity <= ordered_quantity
```

Under-receipt is allowed and leaves the PO `PARTIALLY_RECEIVED`. No over-
receipt tolerance exists in TASK-073. If previous accepted plus proposed
accepted quantity exceeds ordered quantity, fail the entire POST with
`GOODS_RECEIPT_OVER_ORDERED_QUANTITY`; do not partially commit receipt,
quantities, state, audit or events.

Physical observed/received, accepted and rejected/damaged quantities are
distinct. Only accepted quantity advances canonical PO progress. Damaged or
rejected items do not count as fulfillment. Capture receiving exception or
evidence for rejected/damaged facts. Any unresolved blocking exception that
makes item identity or accepted quantity uncertain blocks POST. TASK-073 does
not define a complete quarantine-resolution workflow.

## 24.4 Serialized Units and Asset-Tracked Lines

When an issued PO line's item/Asset policy requires serialized tracking, each
accepted physical unit must have its required stable unit identity and serial
data before POST. Duplicate unit identity within one receipt blocks POST.
Serial text is not a global Asset primary key. A deterministic match to an
existing Asset must never silently create a duplicate; ambiguous candidates
create an exception and human-review work rather than an automatic merge.
Unresolved identity uncertainty that affects an accepted unit blocks POST.
Posted receipt snapshots retain immutable received-unit identity/serial facts.

## 24.5 Atomic POST, Concurrency and Idempotency

`GOODS_RECEIPT.POST` requires `expected_version`, `Idempotency-Key`,
tenant/resource authorization, correlation ID, audit and outbox. One owning-
domain transaction commits the receipt `DRAFT → POSTED`, immutable snapshot,
accepted lines/units, PO accepted counters and received/remaining summaries,
PO receipt state/version/history, durable audit reference and outbox events.
Any blocking validation failure leaves all these effects uncommitted.

The POST transaction locks/serializes on the PO aggregate and validates the
current lifecycle, version and remaining line quantities inside that
transaction. Database invariants must prevent over-receipt under competing
POSTs. Competing receipt/PO commands use the same PO concurrency fence:

- `GOODS_RECEIPT.POST` vs `PO.CANCEL`;
- `GOODS_RECEIPT.POST` vs `PO.HOLD`;
- `GOODS_RECEIPT.POST` vs `PO.CLOSE_REMAINDER` where applicable;
- `GOODS_RECEIPT.POST` vs `PO.AMEND`, especially the first receipt;
- parallel receipt POSTs consuming the same remaining PO-line quantity.

At most one conflicting operation may commit based on a stale version. A
receipt cannot be accepted while PO is cancelled/held/closed; if the receipt
wins first, the conflicting PO command must re-evaluate the new state. The
first POST moves receipt state from `NOT_RECEIVED`, so it also fences TASK-072
commercial amendment. All accepted-quantity checks must be repeated under the
transaction lock; an application precheck is insufficient.

Same idempotency key and semantic request returns the original POST result
without incrementing progress or duplicating events. Same key with different
request returns `IDEMPOTENCY_KEY_CONFLICT`. Event consumers use inbox/durable
idempotency independently.

## 24.6 Receipt Snapshot and Immutability

A posted receipt snapshot preserves, where applicable: PO ID/code and
commercial version, supplier ID/display reference, receiving warehouse and
location, immutable receipt lines and PO line references, ordered-quantity
context, observed/accepted/rejected quantities, accepted-unit/serial
identities, receiving actor, received/posted timestamps and evidence/document
references. Historical evidence must not depend only on future mutable PO or
Supplier values. After POST, target PO, Supplier, PO line, accepted quantities,
unit identities and receiving context cannot be edited in place.

## 24.7 Asynchronous Asset Registration

Procurement must not write Asset tables or call Asset writes inside the Goods
Receipt transaction. After commit, `GOODS_RECEIPT.POSTED` drives an
idempotent workflow that invokes the Asset-owned `ASSET.REGISTER_RECEIVED`
application command for each accepted Asset-tracked physical unit. The
command is keyed by immutable `received_unit_id` (or equivalent stable
receipt-unit identity), never serial text alone. The Asset owner applies its
own duplicate rules and persists an Asset in `RECEIVED`, at the receiving
warehouse/location, with assignment `UNASSIGNED`; it must not create it as
`ASSIGNED` or `IN_USE`. Transition to `AVAILABLE` uses existing validation
and put-away commands.

Assetization failure never unposts a Goods Receipt. Retry is bounded and
idempotent; exhausted retry creates actionable Work Queue/human fallback and
an observable failure state. Event redelivery cannot duplicate Assets.
Asset registration emits Asset-owned events/timeline only after the Asset
actually exists. Normal successful receipt does not create a Work Item.

## 24.8 Events, Audit and Timeline

Required events: `GOODS_RECEIPT.CREATED`, `GOODS_RECEIPT.UPDATED`,
`GOODS_RECEIPT.POSTED`, `GOODS_RECEIPT.CANCELLED`,
`PO.PARTIALLY_RECEIVED`, and `PO.FULLY_RECEIVED`. A successful receipt that
leaves the PO incomplete emits `PO.PARTIALLY_RECEIVED`, including when the
previous receipt state was already partial. Emit `PO.FULLY_RECEIVED` only on
transition into full receipt; idempotent replay emits neither duplicate
effect. Events contain stable receipt/PO/version/unit references needed by
consumers, not full documents or protected Supplier tax/financial data.

Audit POST with actor, PO and receipt IDs, receipt-state before/after, PO
receipt progress before/after, accepted quantities, correlation ID and
evidence references. Do not include protected financial/bank/tax values.
Operator timeline may show posted quantity and whether the PO is partial or
full. Asset timeline records Asset registration only after that Asset exists.

## 24.9 3-Way Match and Service Boundary

Only `POSTED` Goods Receipts are authoritative receiving evidence for
TASK-074 3-Way Match. `DRAFT` and `CANCELLED` receipts do not count; accepted
quantities from posted receipts are canonical. TASK-073 covers physical Goods
Receipt only. Service receipt/acceptance remains a separate future workflow;
do not generalize these commands or state rules to services.

No Goods Receipt command requires free-form reason for normal POST. Reason is
required for CANCEL and for any implemented exception/manual override.

## 24.10 Command API Shape

```text
POST /api/v1/goods-receipts
POST /api/v1/goods-receipts/{id}/commands/update-draft
POST /api/v1/goods-receipts/{id}/commands/post
POST /api/v1/goods-receipts/{id}/commands/cancel
```

All existing-receipt commands require `expected_version`, idempotency,
permission and tenant/resource scope. Only POST creates PO receipt progress.
---

# 25. Partial Receipt

Ví dụ:

```text
PO Qty = 100
Received = 40
```

System:

```text
PO line received = 40/100
receipt_state = PARTIALLY_RECEIVED
PO lifecycle_state remains ISSUED
remaining = 60
```

This receipt projection is not a PO lifecycle transition. Only accepted
quantity counts; posting does not close the PO. A held PO cannot accept a new
receipt; a partial PO may be intentionally closed using `PO.CLOSE_REMAINDER`,
which preserves received units and partial receipt history.

---

# 26. Service Receipt

Không phải mọi PO đều có hàng vật lý.

Ví dụ:

```text
Consulting
Support Contract
Cloud Service
Training
```

Service receipt/acceptance is a separate future workflow. TASK-073 Goods
Receipt commands and PO receipt transitions apply only to physical goods and
must not be reused for services.

---

# 27. WF-PROC05 — Invoice Intake and Lifecycle (TASK-074)

Invoice sources include manual upload, email integration, supplier portal,
API and accounting import. Each document begins as a draft and becomes an
immutable commercial fact at submission.

```text
none → INVOICE.CREATE → DRAFT
DRAFT → INVOICE.UPDATE_DRAFT → DRAFT
DRAFT → INVOICE.SUBMIT → SUBMITTED
DRAFT → INVOICE.CANCEL → CANCELLED
SUBMITTED → INVOICE.APPROVE → APPROVED
SUBMITTED → INVOICE.REJECT → REJECTED
```

`APPROVED`, `REJECTED` and `CANCELLED` are terminal. `SUBMITTED` freezes the
supplier, document number, date, currency, PO reference, lines, quantities,
unit prices, tax/charges, total and evidence references. Submitted commercial
values are never edited in place. Supplier corrections use a new replacement
invoice and/or separate Credit Note. Invoice lifecycle is independent of
match and credit status. `APPROVED` means procurement/AP validation passed or
an authorized mismatch exception was accepted; it does not mean paid. TASK-074
does not implement payment settlement or a `PAID` state.

No transition exists from a submitted or terminal Invoice back to `DRAFT`;
`APPROVED → CANCELLED` and any transition out of `REJECTED` are forbidden.
`INVOICE.CANCEL` is an explicit domain command allowed only from `DRAFT`;
after submission it is forbidden. It must not be implemented as a generic
status update. Any future cancellation or reversal after submission or
approval requires a separate command, permission and compensating/reversal
rules. Cancellation uses the normal command envelope, including
`expected_version`, idempotency, tenant/resource authorization, audit, outbox
and correlation context. A reason is required only where the existing
command/audit standard requires one; TASK-074 adds no separate reason rule.

## 27.1 Independent Match State

```text
NOT_EVALUATED
PENDING_RECEIPT
MATCHED
MISMATCHED
```

`NOT_EVALUATED` means no evaluation has completed. `PENDING_RECEIPT` means
invoice terms are valid against the PO, accepted receipt quantity is not yet
sufficient, and the PO can still receive goods. `MATCHED` means all required
comparisons pass. `MISMATCHED` means at least one blocking commercial or
identity comparison fails. Match history is append-only; re-evaluation adds a
new evidence record without overwriting prior results or the frozen invoice
snapshot.

Submission starts the initial match evaluation. Until it completes, status
remains `NOT_EVALUATED` and the invoice cannot be approved. `PENDING_RECEIPT`
also blocks approval until new receipt evidence is explicitly re-evaluated to
`MATCHED` or `MISMATCHED`.

## 27.2 Authoritative Sources and Partial Invoices

3-Way Match compares the applicable immutable PO commercial version,
`SUBMITTED` Invoice snapshot and `POSTED` Goods Receipt accepted quantities.
Draft/cancelled receipts and observed, rejected or damaged quantities do not
count. A partial invoice is valid when its positive line quantity is no more
than currently invoiceable accepted quantity; it is not a mismatch merely
because some PO quantity remains uninvoiced. Multiple invoices may cover a PO
line.

```text
net_invoiceable_quantity = max(0,
  cumulative POSTED accepted receipt quantity
  - receipt-backed quantity allocated to previous effective invoice matches
  - quantity reserved by approved mismatch exceptions
  + quantity released by applied Credit Notes
)
```

Business quantity tolerance is zero. If submitted quantity exceeds current
invoiceable accepted quantity but is within legitimate ordered quantity and
the PO can receive more, status is `PENDING_RECEIPT`. Quantity above the PO's
legitimate ordered quantity, or that cannot become valid through future
receipt, is `MISMATCHED`. No over-receipt or invoice tolerance is implicit.

## 27.3 Commercial Comparisons and Arithmetic

Invoice currency must equal PO currency. Unit price must equal the applicable
PO unit price; business price tolerance is zero. A derived line-total
calculation may differ by at most one currency minor unit solely where
mathematical rounding requires it (`USD` 0.01; other currencies use configured
minor-unit semantics). This allowance never excuses a unit-price variance.
Taxes, freight, fees and other charges are valid only when represented in PO
commercial terms or another explicit normative rule. Unexpected charges are
`MISMATCHED`. Document total reconciles line totals plus recognized taxes and
charges, minus recognized credits, subject only to the stated arithmetic
rounding.

## 27.4 Duplicate Identity and Candidate Detection

Preserve the original supplier document number and derive its comparison form
using Unicode NFKC, leading/trailing trim, repeated whitespace collapse and
case normalization. Do not strip arbitrary punctuation. Durable submitted-
document uniqueness is:

```text
tenant_id + supplier_id + document_type + supplier_document_number_normalized
document_type ∈ {INVOICE, CREDIT_NOTE}
```

The unique reservation is acquired atomically on submission and remains
durable; application pre-check alone is insufficient. Drafts may coexist
before reservation. A conflicting submission fails with canonical
`INVOICE_DUPLICATE`. A candidate fingerprint may consider supplier, date,
currency, gross total, PO and normalized number; it is advisory, may create
review work, and must never auto-merge or reject solely on heuristic
similarity.

## 27.5 Match Allocation, Re-evaluation and Exceptions

Matching persists durable Invoice-line to PO-line quantity allocations and,
where available, POSTED Goods Receipt line references supporting each
allocation. Aggregate PO-line serialization and database invariants prevent
concurrent invoices from allocating the same remaining quantity. When one of
two competing partial invoices wins the final available quantity, the loser
must re-evaluate to `PENDING_RECEIPT` or `MISMATCHED` using current facts.

`INVOICE.REEVALUATE_MATCH` is explicit and allowed for submitted invoices.
Each evaluation records its version/fingerprint and cited PO/receipt
evidence. Newly posted Goods Receipts may make a `PENDING_RECEIPT` invoice
become `MATCHED`; they never cause edits to invoice or receipt snapshots.

Each mismatch persists an immutable Match Exception with invoice, PO,
relevant Goods Receipt references, canonical reason codes, expected and
observed values, evaluation version/fingerprint, status and audit/correlation
references. Resolution appends history; it does not overwrite comparison
evidence. An invoice approved under `INVOICE_MATCH_EXCEPTION` reserves its
full approved line quantity against reuse by later invoices, even when part
of that quantity has no Goods Receipt allocation. Receipt-supported
allocation and exception reservation remain separately identified; the match
status stays `MISMATCHED`. An applied Credit Note releases its credited
quantity/amount once. A POSTED Goods Receipt is never edited to satisfy an invoice. A
receiving error requires a receiving/reconciliation exception and any future
explicit correction workflow; commercial alternatives are replacement
invoice, Credit Note or authorized match exception.

## 27.6 Conditional Approval

Approval remains independent from lifecycle and authorization. For a
`MATCHED` invoice, a linked `INVOICE_APPROVAL` request is optional. If linked,
it must belong to the same tenant, target this invoice, have purpose
`INVOICE_APPROVAL`, bind to the current immutable invoice and match context,
and be `APPROVED`; pending, rejected, expired or cancelled requests block
`INVOICE.APPROVE`. No linked request does not itself block approval.

A `MISMATCHED` invoice cannot use normal approval. It may be approved only
with a linked, `APPROVED` `INVOICE_MATCH_EXCEPTION` request bound to the
invoice, immutable version, current mismatch evaluation/fingerprint and
exception reason/context. Approval does not change `match_status` from
`MISMATCHED`; failed comparisons and accepted exception remain distinct.
Any material change to invoice, match evaluation, PO context or exception
fingerprint makes earlier approval stale. An approval cannot be silently
reused for a different mismatch.

## 27.7 Credit Note

A Credit Note is a separate immutable commercial document and never edits the
original Invoice. It references the Supplier and the Invoice/lines credited
where applicable and uses positive semantic credit quantities and amounts.

```text
none → CREDIT_NOTE.CREATE → DRAFT
DRAFT → CREDIT_NOTE.UPDATE_DRAFT → DRAFT
DRAFT → CREDIT_NOTE.SUBMIT → SUBMITTED
DRAFT → CREDIT_NOTE.CANCEL → CANCELLED
SUBMITTED → CREDIT_NOTE.APPLY → APPLIED
SUBMITTED → CREDIT_NOTE.REJECT → REJECTED
```

`APPLIED`, `REJECTED` and `CANCELLED` are terminal. Submitted Credit Note
commercial values are immutable. A Credit Note must use the same tenant,
Supplier and currency as its referenced Invoice. Multiple partial credits are
allowed, but cumulative quantity and amount cannot exceed the remaining
creditable quantity/amount of the referenced Invoice lines.
`CREDIT_NOTE.APPLY` records credited quantity/amount atomically and cannot be
replayed or applied twice. Only explicitly credited line quantity that had
consumed invoiceable quantity releases that quantity for a valid replacement
invoice; amount-only credits reduce net billed amount without releasing
quantity. Credit changes net billed values but never changes PO
ordered quantity, accepted Goods Receipt quantity/history or original Invoice
snapshot. Invoice lifecycle remains `APPROVED`; derived credit status is
independently `NONE`, `PARTIALLY_CREDITED` or `FULLY_CREDITED`.
`CREDIT_NOTE.CANCEL` is an explicit domain command allowed only from `DRAFT`;
after submission it is forbidden. It must not be implemented as a generic
status update. Any future cancellation or reversal after submission or
application requires a separate command, permission and
compensating/reversal rules. Cancellation uses the normal command envelope,
including `expected_version`, idempotency, tenant/resource authorization,
audit, outbox and correlation context. A reason is required only where the
existing command/audit standard requires one; TASK-074 adds no separate reason
rule.

## 27.8 Canonical Mismatch Reasons and Boundaries

Canonical reason codes include `SUPPLIER_MISMATCH`, `PO_NOT_ELIGIBLE`,
`PO_LINE_NOT_FOUND`, `CURRENCY_MISMATCH`, `UNIT_PRICE_MISMATCH`,
`QUANTITY_EXCEEDS_ORDERED`, `QUANTITY_EXCEEDS_RECEIVED`,
`UNEXPECTED_CHARGE`, `TOTAL_MISMATCH`, `DUPLICATE_INVOICE`, `TAX_MISMATCH`,
`ITEM_MISMATCH`, `CHARGE_MISMATCH` and `DATA_INTEGRITY_CONFLICT`. A shortfall covered by a legitimate future receipt
is `PENDING_RECEIPT`, not permanent mismatch. The system never mutates PO
commercial history or posted receipt evidence to make documents agree. Only
an explicit linked match-exception approval can accept a mismatch while
preserving failed-comparison evidence.

Actionable Work Queue items may reference exact duplicate review, blocking
3-Way Match mismatch, unresolved approval, data-integrity conflict or
reconciliation failure. Normal MATCHED invoices do not require Work Items.
The source Invoice, evaluation, exception and Credit Note remain canonical;
the Work Queue is only an operational reference/projection.

---

# 38. WF-PROC06 — Payment Record

Hệ thống ITSM có thể không thực hiện payment trực tiếp.

Thay vào đó quản lý:

```text
payment reference
payment status
paid date
accounting reference
```

Flow:

```text
Invoice Approved
↓
Export/Sync Accounting
↓
Payment Performed Externally
↓
Payment Record Synced
```

---

# 39. Payment States

```text
NOT_READY
READY
SUBMITTED_TO_FINANCE
SCHEDULED
PAID
FAILED
CANCELLED
```

Không giả định hệ thống này là ERP/accounting engine.

---

# 40. Asset Cost Capitalization Link

Sau purchase:

```text
PO
Invoice
Goods Receipt
Asset
```

Asset read models may expose derived summaries such as:

```text
committed_cost
actual_cost
net_cost
currency
cost_source_summary
```

These summaries are not canonical financial history. Immutable cost
provenance/allocation records retain the source document/version/line, amount,
currency and allocation basis. Preserve PO-derived COMMITTED cost when an
effective Invoice creates ACTUAL cost; an applied Credit Note creates a new
ADJUSTMENT and never mutates the Invoice allocation. Goods Receipt proves
physical receiving, not financial cost. Do not duplicate accounting logic if
an ERP is the financial source of truth.

Example: an Asset receives COMMITTED cost `1,000` from its PO line. An
effective Invoice allocation of `980` appends ACTUAL cost `980`; both facts
remain. The current acquisition-cost projection may prefer `980`. A later
applied Credit Note appends a separate positive-amount CREDIT adjustment; it
does not change either prior source fact.

---

# 41. License Purchase Integration

Software/license procurement:

```text
License Request
↓
Procurement
↓
PO
↓
Invoice
↓
License Entitlement Created/Updated
```

Entitlement update must retain canonical commercial cost provenance rather
than only a free-form cost or reference. Cost provenance attaches to the
License Entitlement or License Pool/commercial entitlement unit, not to each
user assignment unless an explicit allocation policy requires that.

Entitlement update phải dựa trên:

```text
contract
quantity
validity
license model
```

---

# 42. Spare Part Procurement Integration

Maintenance thiếu part:

```text
Maintenance Order
↓
Part Request
↓
Stock Check
↓
Procurement if unavailable
↓
PO
↓
Receive Part
↓
Inventory
↓
Resume Maintenance
```

---

# 43. WF-CON01 — Contract Creation

Contract sources:

```text
Purchase
Warranty
Support Agreement
License Agreement
Service Agreement
Maintenance Contract
Vendor Framework Agreement
```

---

# 44. Contract Model

```yaml
contract:
  id:
  type:
  supplier:
  title:
  lifecycle_state:
  usage_status:
  current_contract_version_id:
  effective_at:
  end_at:
  auto_renew:
  renewal_notice_date:
  renewal_notice_period_days:
  currency:
  value:
  owner:
  business_owner:
  service_owner:
  terms:
  renewed_from_contract_id:
```

Commercial proposal and execution terms are stored in immutable
ContractVersions; document links reference governed document versions. Do not
collapse usage, Approval or signature state into `lifecycle_state`.

---

# 45. Contract Types

```text
WARRANTY
SUPPORT
MAINTENANCE
SOFTWARE_LICENSE
SAAS
HARDWARE_PURCHASE
FRAMEWORK
SERVICE
LEASE
OTHER
```

---

# 46. Contract State Machine

Contract legal/commercial lifecycle is independent from usage status,
Renewal Case lifecycle, document governance and signature/execution evidence.
Approval remains an independent Approval Engine control gate.

Legal lifecycle:

```text
DRAFT
PENDING_SIGNATURE
EXECUTED
ACTIVE
EXPIRED
TERMINATED
CANCELLED
```

Terminal states are `EXPIRED`, `TERMINATED` and `CANCELLED`.
`EXPIRING` is derived operational context, never a Contract lifecycle state.

Usage status is independently `ENABLED` or `ON_HOLD`. A legally ACTIVE or
EXECUTED Contract may be ON_HOLD without changing its legal history.

Renewal Cases have independent states `OPEN`, `COMPLETED`, `NOT_RENEWED` and
`CANCELLED`; the last three are terminal. A Renewal creates a successor
Contract and never extends or rewrites the predecessor's historical term.

Commercial Documents have governance status `DRAFT`, `FINAL`, `SUPERSEDED` or
`VOID`, independently from signature status (`NONE`, `PENDING`,
`PARTIALLY_SIGNED`, `SIGNED`, `DECLINED`). A finalized signed document is
`FINAL` plus `SIGNED`, not a combined status.

Normative Contract transitions:

```text
none → CONTRACT.CREATE → DRAFT
DRAFT → CONTRACT.UPDATE_DRAFT → DRAFT
DRAFT → CONTRACT.SUBMIT_FOR_SIGNATURE → PENDING_SIGNATURE
DRAFT → CONTRACT.CANCEL → CANCELLED
PENDING_SIGNATURE → CONTRACT.RECALL_SIGNATURE → DRAFT
PENDING_SIGNATURE → CONTRACT.RECORD_EXECUTION → EXECUTED
PENDING_SIGNATURE → CONTRACT.CANCEL → CANCELLED
EXECUTED → CONTRACT.ACTIVATE → ACTIVE
EXECUTED → CONTRACT.TERMINATE → TERMINATED
ACTIVE → CONTRACT.EXPIRE → EXPIRED
ACTIVE → CONTRACT.TERMINATE → TERMINATED
```

Do not allow `EXECUTED/ACTIVE → CANCELLED`, `EXPIRED/TERMINATED → ACTIVE`,
or `CANCELLED → DRAFT`. Recall is allowed only before final execution
evidence is accepted. It returns the frozen proposal to DRAFT and invalidates
approval/execution context bound to the recalled version.

Usage commands are `CONTRACT.HOLD` (`ENABLED → ON_HOLD`, reason required) and
`CONTRACT.RESUME` (`ON_HOLD → ENABLED`). An ON_HOLD Contract cannot authorize
new downstream procurement where Contract eligibility is required; historical
transactions remain unchanged.

Activation requires lifecycle `EXECUTED`, current time at or after
`effective_at` and before `end_at`, valid execution evidence for the exact
immutable version, and an `APPROVED` or `PREFERRED` Supplier. Contract terms
must satisfy `effective_at < end_at`. Execution/activation is forbidden for
PROSPECT, SUSPENDED, BLOCKED or INACTIVE suppliers. A later Supplier state
change does not silently terminate or rewrite the Contract.

`CONTRACT.RECORD_EXECUTION` has the same `APPROVED`/`PREFERRED` Supplier
eligibility guard. Each material DRAFT proposal update advances entity
optimistic version and records a new immutable ContractVersion snapshot;
submitted/executed snapshots remain independently addressable.

`CONTRACT.EXPIRE` is idempotent and may run under an authorized scheduler or
system principal once `end_at` is reached. Expiry preserves POs, Invoices,
Goods Receipts, Contract versions and commercial documents.

`CONTRACT.TERMINATE` requires a reason, termination effective time/date,
authorization, `expected_version`, audit, outbox and correlation context. It
does not delete or cancel Contract/Version/Document/PO/Invoice/Goods Receipt
history. A later Supplier SUSPENDED/BLOCKED/INACTIVE state preserves legal
Contract lifecycle and creates/reuses operational review or policy handling.

Where a downstream workflow requires Contract eligibility, it checks
canonical `lifecycle == ACTIVE` and `usage_status == ENABLED`. Expired,
terminated, cancelled or ON_HOLD Contracts cannot authorize new commitments;
historical transactions are not retroactively invalidated.

After execution, in-term changes use `CONTRACT.AMEND`, create a new immutable
ContractVersion, require a reason, preserve changed-field history and attach
amendment evidence. Amendment is allowed only for EXECUTED/ACTIVE Contracts;
Supplier identity and the existing end date cannot be changed by amendment.
Term extension uses Renewal; early ending uses termination. A linked
`CONTRACT_AMENDMENT` approval, when present, must be same-tenant, target the
Contract, bind the exact base version and proposed snapshot, and be APPROVED.
Material proposal changes make the approval stale.

Execution approval is conditional: when no linked `CONTRACT_EXECUTION`
request exists, recording execution may proceed subject to other guards. When
one exists, it must be same-tenant, target the Contract, bind the exact
submitted ContractVersion, have purpose `CONTRACT_EXECUTION`, and be APPROVED.
Approval is never execution evidence. A rejected request does not mark a
Renewal `NOT_RENEWED`.

Renewal transitions:

```text
none → RENEWAL.OPEN → OPEN
OPEN → RENEWAL.UPDATE_PROPOSAL → OPEN
OPEN → RENEWAL.COMPLETE → COMPLETED
OPEN → RENEWAL.MARK_NOT_RENEWED → NOT_RENEWED
OPEN → RENEWAL.CANCEL → CANCELLED
```

`RENEWAL.CANCEL` is for an erroneous/abandoned process; `NOT_RENEWED` records
an explicit business decision. At most one OPEN Renewal Case may exist per
predecessor, and it owns at most one canonical DRAFT successor Contract.
`RENEWAL.COMPLETE` requires the successor to be EXECUTED or ACTIVE. Renewal
approval is optional unless linked; a linked `CONTRACT_RENEWAL` request must
be same-tenant, target the Renewal Case and/or canonical successor under the
repository's approval-link convention, bind the exact proposed snapshot, and
be APPROVED before the governed completion/execution action. Proposal changes
make it stale; PENDING, REJECTED, EXPIRED or CANCELLED requests block the
governed action. A renewal successor must start at or after the predecessor's
contractual end; overlap is forbidden absent a future explicit policy. If the
predecessor remains ACTIVE, it continues under its original terms until its
end or explicit termination; the successor activates under its own effective
date and lifecycle.

Automatic-renewal metadata does not automatically execute a new Contract. It
may create an alert/candidate or a Renewal Case only where existing automation
rules authorize that action. Actual commercial renewal remains explicit.

---

# 47. Contract Linking

Contract có thể link:

```text
Supplier
Assets
Asset Models
Services
Licenses
Software
Sites
Maintenance
POs
Invoices
```

Ví dụ:

```text
Dell Support Contract
→ 120 Servers
```

---

# 48. Contract Coverage

Coverage có thể mô tả:

```text
included assets
included services
parts
labor
response SLA
replacement entitlement
support hours
geography
exclusions
```

---

# 49. Contract Expiry Watch

Proactive renewal/expiry action is derived only from explicit contract-specific
configuration. Supported trigger sources are `renewal_notice_date`, or an
explicit renewal notice period combined with `end_at`. If both are present,
`renewal_notice_date` is authoritative. If neither exists, do not create a
proactive warning from a global threshold; natural expiry at `end_at` remains
independent and must proceed normally. Invalid/impossible configuration
creates a configuration/data-integrity exception rather than a guessed date.

Alert configuration binds to the applicable immutable ContractVersion and
term context. Material changes to renewal terms schedule future alerts from
the new applicable version; prior alert facts remain immutable. Alert identity
includes tenant, Contract, ContractVersion, trigger type and trigger time, so
repeated scheduler runs create one logical alert. The alert may create an
actionable Work Item/notification or an authorized renewal candidate. It never
executes or extends a Contract. Auto-renew metadata alone grants no authority
to execute a renewal.

Events:

```text
CONTRACT.RENEWAL_NOTICE_DUE
CONTRACT.EXPIRY_ACTION_DUE
CONTRACT.EXPIRED
```

Due events reference Contract, ContractVersion, trigger type and `trigger_at`;
they carry no confidential Contract body. `CONTRACT.EXPIRED` remains a
separate lifecycle fact.

---

# 50. WF-CON02 — Contract Renewal

Flow:

```text
Explicit Contract Renewal/Expiry Action Due
↓
Evaluate Usage/Performance
↓
Supplier Performance
↓
Cost
↓
Business Need
↓
Renew / Renegotiate / Replace / Terminate
```

---

# 51. Contract Renewal Context

For software:

```text
entitlement
assigned
usage
cost/user
```

For support:

```text
ticket volume
vendor SLA
repair history
downtime
```

For warranty:

```text
asset age
health
replacement plan
```

---

# 52. Auto-Renewal Guardrail

Nếu contract auto-renew:

```text
alert before cancellation notice deadline
```

The clause may trigger a renewal candidate, notification, Work Queue item or
an authorized Renewal Case creation. It never silently executes a successor
Contract; execution remains explicit unless a separate normative automation
policy authorizes it.

Không chỉ alert trước expiry date.

Ví dụ:

```text
Expiry = 31/12
Cancellation notice = 90 days
Important deadline = 02/10
```

---

# 53. Supplier SLA / Contract Breach

Track:

```text
delivery late
repair SLA breach
support response breach
warranty breach
```

Event:

```text
CONTRACT.SLA_BREACH
```

Link evidence từ:

```text
Maintenance
Incident
Delivery
Helpdesk
```

---

# 54. Contract Performance Review

Metrics:

```text
SLA Compliance
Issue Count
Cost
Utilization
Supplier Score
Renewal Value
```

---

# 55. Document Management Principles

Document không tồn tại như file rời không context.

Mỗi document phải link đến một hoặc nhiều entity and use the central document
storage/governance architecture. Commercial documents are typed evidence, not
mutable file blobs attached ad hoc. Supported types include `CONTRACT`,
`AMENDMENT`, `RENEWAL`, `TERMINATION_NOTICE`, `EXECUTION_EVIDENCE` and
`OTHER_COMMERCIAL_EVIDENCE`.

Each content version is immutable and preserves document identity/version,
linked entity, storage reference, content hash, content type, size, actor,
timestamp, classification/access metadata and finalization/signature metadata
where applicable. Replacing bytes creates a new version. `FINAL` content is
never replaced in place; amendment, renewal and termination add new evidence
while preserving the old final document. Only permitted pre-execution evidence
may be marked `VOID`; executed/signed evidence is not casually voided.

Use `commercial_document.read`, `commercial_document.write` and
`commercial_document.finalize`, with tenant/resource scope. Events and
timelines carry protected references only, never raw document bytes.

Mỗi document phải link đến một hoặc nhiều entity:

```text
Asset
PO
Invoice
Supplier
Contract
Maintenance
Assignment
Audit
License
Disposal
```

---

# 56. Document Types

```text
Purchase Order
Quotation
Invoice
Receipt
Delivery Note
Goods Receipt
Handover
Return Document
Warranty Certificate
Contract
License Certificate
Maintenance Report
Repair Invoice
Data Wipe Certificate
Disposal Record
Audit Evidence
Photo
Approval Record
```

---

# 57. Document Metadata

```yaml
document:
  id:
  type:
  title:
  owner:
  related_entities:
  source:
  created_at:
  effective_date:
  expiry_date:
  confidentiality:
  retention_policy:
  status:
```

---

# 58. Document Versioning

Document editable before finalization:

```text
DRAFT v1
DRAFT v2
FINAL v3
```

Sau ký/approved:

```text
FINAL / SIGNED
```

không overwrite.

Correction:

```text
new version
or
amendment
```

---

# 59. Document Status

```text
DRAFT
REVIEW
APPROVED
SIGNED
FINAL
SUPERSEDED
EXPIRED
ARCHIVED
```

---

# 60. Signed Document Immutability

Không xóa/sửa silently:

```text
Signed Handover
Signed Contract
Approved Invoice
Disposal Certificate
```

Nếu correction:

```text
create correction record
link original
record reason
```

---

# 61. Document Expiry

Documents có expiry:

```text
Warranty
Certificate
Contract
Insurance
License Certificate
```

Scheduled watcher:

```text
expiry threshold
→ notification / workflow
```

---

# 62. Document Access Control

Permission theo:

```text
document type
entity
department
confidentiality
role
```

Ví dụ:

```text
Invoice
→ Finance + Procurement + authorized IT

Handover
→ Helpdesk + Asset Admin + user involved
```

---

# 63. Document Retention

Retention configurable:

```text
asset lifetime + N years
contract expiry + N years
invoice statutory period
security evidence retention
```

Không hardcode một retention cho tất cả.

---

# 64. OCR / Metadata Extraction

Nếu có OCR/extraction:

```text
Extract Invoice Number
Supplier
Amount
Date
PO Number
```

Nhưng extracted fields phải:

```text
confidence scored
reviewable
```

Không auto-post financial data confidence thấp.

---

# 65. Document Duplicate Detection

Fingerprint có thể dùng:

```text
document type
supplier
document number
date
amount
file hash
```

---

# 66. File Integrity

Store:

```text
checksum
file size
uploaded_by
uploaded_at
```

Nếu file content thay đổi:

```text
new version
```

không silently replace.

---

# 67. WF-DOC01 — Generate Operational Document

Documents có thể auto-generate:

```text
Handover
Return
Goods Receipt
Transfer
Disposal
Maintenance
```

Flow:

```text
Workflow Context
↓
Document Template
↓
Populate Known Data
↓
Preview
↓
Confirm/Sign
↓
Final Document
↓
Attach to Entities
```

---

# 68. Template Rules

Template có thể phụ thuộc:

```text
Company
Country
Department
Document Type
Asset Type
Language
```

Enterprise branding áp dụng:

```text
Logo
Company Name
Header/Footer
Signature Block
```

---

# 69. Document Signature

Possible:

```text
SSO Confirmation
Digital Signature
OTP
Uploaded Signature
External e-sign provider
```

Signature method configurable.

---

# 70. Document Numbering

Document IDs có thể theo template:

```text
PO-2026-000142
GR-2026-000921
HD-2026-001288
INV-EXT-...
```

Internal immutable ID vẫn nên riêng với display number.

---

# 71. Procurement Exception Work Queue

Actionable exceptions:

```text
Budget Missing
Quote Expired
PO Approval Pending
Delivery Overdue
Quantity Mismatch
Invoice Mismatch
Duplicate Invoice
Contract Renewal/Expiry Action Due (explicit trigger only)
Supplier SLA Breach
```

Raw document upload không tự tạo work item nếu không có vấn đề.

---

# 72. Delivery Overdue

If:

```text
expected_delivery < now
AND
remaining quantity > 0
```

Event:

```text
PO.DELIVERY_OVERDUE
```

Actions:

```text
Contact Supplier
Update ETA
Escalate
Cancel Remaining
Switch Supplier if policy permits
```

---

# 73. Supplier Return / RMA Integration

Damaged receiving:

```text
Goods Receipt Exception
↓
Supplier Return/RMA
↓
Return Shipment
↓
Replacement / Credit Note
```

Link:

```text
PO
Asset/Serial
Invoice
Credit Note
```

---

# 74. Emergency Purchase

Emergency path:

```text
Critical Need
↓
Emergency Approval
↓
Purchase
↓
Receive
↓
Post-facto documentation/review
```

Không cho Emergency path trở thành cách né procurement chuẩn.

---

# 75. Recurring Purchase

Use cases:

```text
Monthly SaaS
Cloud Subscription
Support Contract
Consumables
```

Could generate:

```text
scheduled procurement/renewal task
```

Không tự issue PO/payment nếu policy không cho.

---

# 76. Currency Handling

Store:

```text
transaction currency
base currency
exchange rate reference
conversion date
```

Nếu cần reporting đa tiền tệ.

Không overwrite original currency amount.

---

# 77. Tax Handling

Tax model configurable theo jurisdiction.

System nên lưu:

```text
tax type
rate
tax amount
```

không hardcode luật thuế vào workflow core.

---

# 78. Cost Allocation

Purchase có thể allocate:

```text
Cost Center
Department
Project
Service
Site
```

Một invoice line có thể split nếu policy hỗ trợ.

---

# 79. Procurement → Asset Creation

Không tạo Asset khi mới có Procurement Request.

Recommended:

```text
Procurement Request
→ PO
→ Goods Receipt
→ Serial identified
→ Asset created
```

Trừ trường hợp `Planned Asset` placeholder.

---

# 80. Planned Asset

Có thể tạo placeholder:

```text
Lifecycle = Planned
```

để phục vụ:

```text
capacity
budget
replacement plan
```

Khi actual serial nhận:

```text
bind planned record → actual asset
```

tránh duplicate.

---

# 81. Procurement → License Entitlement

License không cần physical receipt.

Flow:

```text
PO
↓
License Certificate / Vendor Confirmation
↓
Service Receipt
↓
Invoice Match
↓
Entitlement Activated
```

---

# 82. Procurement → Contract

PO có thể sinh contract requirement:

```text
Hardware Support
Warranty Extension
SaaS Agreement
Maintenance Agreement
```

Contract activation requires valid execution evidence and all applicable
guards. A linked `CONTRACT_EXECUTION` approval must be approved and bound to
the exact submitted ContractVersion; absence of a linked request does not
create a blanket approval requirement. Approval is not signature/execution
evidence.

---

# 83. Audit Trail

Every important action records:

```text
who
what
when
before
after
reason
source
related request
related PO
related invoice
related contract
```

---

# 84. Generated Events

## Procurement

```text
RFQ.CREATED
RFQ.UPDATED
RFQ.ISSUED
RFQ.SUBMISSIONS_CLOSED
RFQ.CANCELLED
RFQ.AWARDED
RFQ.CLOSED_NO_AWARD
QUOTATION.CREATED
QUOTATION.UPDATED
QUOTATION.SUBMITTED
QUOTATION.WITHDRAWN
QUOTATION.DISQUALIFIED
QUOTATION.ACCEPTED
QUOTATION.REJECTED
QUOTATION.VOIDED
PROCUREMENT.REQUEST_CREATED
PROCUREMENT.REQUESTED
PROCUREMENT.BUDGET_CHECKED
PROCUREMENT.APPROVAL_REQUESTED
PROCUREMENT.APPROVED
PROCUREMENT.REJECTED
PO.CREATED
PO.UPDATED
PO.ISSUED
PO.HELD
PO.RESUMED
PO.AMENDED
PO.CANCELLED
PO.CLOSED
PO.REMAINDER_CLOSED
PO.PARTIALLY_RECEIVED
PO.FULLY_RECEIVED
PO.DELIVERY_OVERDUE
```

## Invoice

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

## Contract

```text
CONTRACT.CREATED
CONTRACT.UPDATED
CONTRACT.SUBMITTED_FOR_SIGNATURE
CONTRACT.SIGNATURE_RECALLED
CONTRACT.EXECUTED
CONTRACT.ACTIVATED
CONTRACT.HELD
CONTRACT.RESUMED
CONTRACT.AMENDED
CONTRACT.RENEWAL_NOTICE_DUE
CONTRACT.EXPIRY_ACTION_DUE
CONTRACT.EXPIRED
CONTRACT.SLA_BREACH
CONTRACT.TERMINATED
CONTRACT.CANCELLED
CONTRACT.RENEWAL_OPENED
CONTRACT.RENEWAL_UPDATED
CONTRACT.RENEWAL_COMPLETED
CONTRACT.RENEWAL_NOT_RENEWED
CONTRACT.RENEWAL_CANCELLED
```

## Document

```text
COMMERCIAL_DOCUMENT.ADDED
COMMERCIAL_DOCUMENT.FINALIZED
COMMERCIAL_DOCUMENT.SUPERSEDED
```

---

# 85. Downstream Workflow Mapping

```text
New Asset Purchase
→ Warehouse Receiving

License Purchase
→ License Entitlement

Spare Part Purchase
→ Maintenance

Contract Expiry
→ Renewal

Supplier SLA Breach
→ Vendor Review

Invoice Mismatch
→ Procurement Exception

Goods Damaged
→ Supplier Return / Maintenance

Replacement Plan
→ Procurement Request
```

---

# 86. Permissions

## Requester

```text
create procurement request
view own request
```

## Manager

```text
approve business need
approve budget within authority
```

## Procurement

```text
RFQ
supplier selection
PO management
contract coordination
```

## Warehouse

```text
goods receipt
delivery exception
```

## Finance

```text
invoice review
payment reference
financial controls
```

## IT Asset Admin

```text
link purchase to assets
verify asset-related procurement
```

## Contract Owner

```text
review renewal
manage terms
```

## Auditor

```text
read procurement/document history
```

---

# 87. Notification Rules

## Immediate / Action Required

```text
Approval required
Invoice mismatch
Duplicate invoice
Delivery overdue
Contract cancellation deadline
Supplier SLA breach
```

## Informational

```text
PO issued
Goods received
Invoice matched
Contract renewed
```

Do not notify every document version save.

---

# 88. SLA / Timers

Configurable:

```text
Procurement review SLA
Approval SLA
RFQ response deadline
Supplier delivery date
Invoice matching SLA
Contract renewal lead time
Cancellation notice deadline
Document review SLA
```

---

# 89. Metrics / KPI

## Procurement

```text
Procurement Lead Time
Approval Lead Time
PO Cycle Time
On-Time Delivery Rate
Purchase Price Variance
Emergency Purchase Rate
```

## Supplier

```text
Supplier SLA Compliance
Delivery Accuracy
Quality Exception Rate
Invoice Accuracy
Warranty Response Time
```

## Invoice

```text
3-Way Match Rate
Invoice Exception Rate
Duplicate Invoice Rate
Average Match Time
```

## Contract

```text
Configured Renewal/Expiry Actions Due
Renewal Completion Rate
Auto-renewal Risk
Contract Utilization
SLA Breach Count
```

## Document

```text
Missing Document Rate
Unsigned Document Count
Expired Document Count
```

---

# 90. Idempotency

Examples:

```text
procurement_request:{source_type}:{source_id}:{version}
po:{approved_request}:{supplier}:{version}
goods_receipt:{po}:{delivery_reference}
invoice_submit:{tenant_id}:{invoice_id}:{version}
contract:{supplier}:{contract_number}:{version}
document:{entity}:{document_type}:{business_version}
```

Retry không tạo duplicate:

```text
Procurement Request
PO
Goods Receipt
Invoice
Contract
Signed Document
```

---

# 91. Duplicate Prevention

System phải detect:

```text
duplicate request
duplicate supplier quote
duplicate PO retry
duplicate invoice
duplicate contract import
duplicate document upload
```

Nhưng không merge nếu evidence không đủ.

---

# 92. Guardrails

Hệ thống không được:

1. Tạo PO từ request chưa approved nếu policy yêu cầu approval.
2. Tự tạo purchase nếu stock sẵn có phù hợp mà workflow yêu cầu reuse stock.
3. Overwrite PO issued mà không version/amendment.
4. Đóng PO partial receipt như fully received.
5. Approve a MISMATCHED invoice without an approved, context-bound
   `INVOICE_MATCH_EXCEPTION` request.
6. Xóa original invoice khi có credit note.
7. Duplicate invoice do email/API retry.
8. Tạo Asset trước khi xác định serial trừ Planned Asset workflow.
9. Gộp payment engine với ERP nếu hệ thống chỉ sync payment status.
10. Auto-renew contract mà bỏ qua notice deadline/approval.
11. Sửa signed/final document silently.
12. Lưu document không link context.
13. Cho OCR confidence thấp tự post dữ liệu tài chính.
14. Expose confidential financial documents cho role không cần.
15. Xóa contract/PO/invoice history sau closure.
16. Invent nonzero commercial tolerance or a blanket Invoice approval
   requirement without a normative policy selector.
17. Emergency Purchase được dùng để né quy trình bình thường mà không post-review.

---

# 93. End-to-End Example — New Laptop Purchase

```text
Replacement Plan requires 20 laptops
↓
Procurement Request created
↓
Warehouse stock check = insufficient
↓
Budget check PASS
↓
RFQ sent to 3 suppliers
↓
3 quotes received
↓
Supplier B selected based on price + lead time + warranty
↓
PO-2026-0142 approved and issued
↓
Supplier delivers 12/20
↓
Goods Receipt GR-001
↓
12 serials scanned
↓
12 Asset records created
↓
PO.receipt_state = PARTIALLY_RECEIVED
PO.lifecycle_state remains ISSUED
↓
Invoice for 12 units received
↓
3-Way Match PASS
↓
Invoice approved
↓
Remaining 8 delivered later
↓
Second Goods Receipt
↓
Second Invoice
↓
PO receipt_state = FULLY_RECEIVED
PO lifecycle_state = ISSUED until PO.CLOSE; Invoice state is independent
PO.CLOSE → lifecycle_state = CLOSED
↓
PO closed
```

---

# 94. End-to-End Example — Invoice Mismatch

```text
PO unit price = 20,000,000
↓
Goods received = 10
↓
Invoice unit price = 21,000,000
↓
Invoice unit price differs from the PO unit price
↓
INVOICE.MISMATCHED
↓
Procurement reviews
↓
Supplier confirms invoice error
↓
Corrected invoice uploaded
↓
Old invoice rejected/superseded
↓
INVOICE.MATCH_EVALUATED → MATCHED
↓
Approved
```

---

# 95. End-to-End Example — License Renewal

```text
Adobe contract expires in 90 days
↓
Renewal workflow starts
↓
Current entitlement = 200
↓
Active usage = 142
↓
License workflow recommends 160 seats
↓
Procurement requests quote
↓
Supplier quote received
↓
Manager approves 160
↓
PO issued
↓
Service confirmation received
↓
Invoice matched
↓
Contract renewed
↓
Entitlement updated 200 → 160
↓
New expiry stored
```

---

# 96. End-to-End Example — Support Contract

```text
Server support contract expiring
↓
System checks:
- 120 covered servers
- 14 repairs last year
- vendor SLA = 97%
- 18 servers scheduled for retirement
↓
Recommendation:
renew coverage for 102 servers
↓
Contract Owner reviews
↓
RFQ / negotiation
↓
New contract approved
↓
Coverage linked to remaining assets
↓
Retiring assets excluded
```

---

# 97. End-to-End Example — Damaged Delivery

```text
PO for 20 monitors
↓
20 delivered
↓
2 damaged on arrival
↓
Goods Receipt:
18 accepted
2 quarantine
↓
Supplier RMA created
↓
Invoice received for 20
↓
3-Way Match finds only 18 accepted
↓
Invoice exception
↓
Supplier sends credit/replacement
↓
Replacement 2 monitors received
↓
Receipt completed
↓
Invoice/credit reconciliation completed
```

---

# 98. Definition of Done

Cụm workflow này đạt yêu cầu khi:

- Procurement Request có source và business context.
- Stock check chạy trước purchase khi phù hợp.
- Budget + approval policy configurable.
- RFQ/quotation comparison hỗ trợ nhiều supplier.
- PO có version/amendment.
- Partial receiving hoạt động.
- Goods Receipt liên kết Warehouse/Asset.
- Service Receipt hỗ trợ non-physical purchase.
- Invoice duplicate identity is durably enforced at submit and candidate
  matching remains advisory.
- 3-way match có zero business tolerance, arithmetic rounding và exception
  handling.
- Partial invoice và credit note hoạt động.
- Payment chỉ được sync/record nếu hệ thống không phải ERP.
- License purchase cập nhật entitlement.
- Spare part purchase nối Maintenance.
- Contract có lifecycle + coverage + expiry + notice deadline.
- Contract renewal dùng actual usage/performance.
- Contract alerts use only explicit version-bound notice/action terms; no
  global threshold. Asset/License cost provenance links to immutable
  PO/Invoice/Credit Note/Contract source versions and lines.
- Document có metadata/version/status/permission/retention.
- Signed/final document immutable.
- Auto-generated documents lấy dữ liệu từ workflow context.
- Procurement exceptions vào Work Queue.
- Permissions, notifications, SLA, idempotency và audit trail đầy đủ.
