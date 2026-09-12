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
SENT
PARTIALLY_RESPONDED
CLOSED
CANCELLED
```

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
```

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

# 19. WF-PROC03 — Create Purchase Order

Preconditions:

```text
Procurement approved
Supplier selected
Budget valid if required
Quote/contract available if required
```

Flow:

```text
Approved Request
↓
Create PO
↓
Copy Approved Lines
↓
Set Supplier
↓
Delivery Location
↓
Terms
↓
Approval if required
↓
Issue PO
```

---

# 20. PO Model

```yaml
purchase_order:
  id:
  supplier:
  currency:
  order_date:
  delivery_location:
  expected_delivery:
  payment_terms:
  cost_center:
  project:
  source_request:
  contract:
  status:
  lines:
```

---

# 21. PO Line

```yaml
po_line:
  item_type:
  product_or_service:
  description:
  quantity:
  unit:
  unit_price:
  tax:
  discount:
  expected_delivery:
  asset_model:
  license_product:
  spare_part:
```

---

# 22. PO State Machine

```text
DRAFT
↓
PENDING_APPROVAL
├─ REJECTED
└─ APPROVED
      ↓
ISSUED
      ↓
PARTIALLY_RECEIVED
      ↓
FULLY_RECEIVED
      ↓
INVOICED
      ↓
CLOSED
```

Alternatives:

```text
CANCELLED
ON_HOLD
```

---

# 23. PO Amendment

Không sửa silently PO đã issue.

Nếu cần đổi:

```text
quantity
price
delivery
supplier terms
```

thì tạo:

```text
PO Amendment / Version
```

Lưu:

```text
before
after
reason
approver
timestamp
```

---

# 24. WF-PROC04 — Goods Receipt Integration

Physical asset receipt dùng workflow Warehouse, nhưng procurement phải nhận result.

Flow:

```text
PO
↓
Goods Arrive
↓
Goods Receipt
↓
Serial/Quantity Validation
↓
Asset Creation
↓
PO Received Quantity Updated
```

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
status = PARTIALLY_RECEIVED
remaining = 60
```

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

Use:

```text
SERVICE RECEIPT
```

Flow:

```text
Service Delivered
↓
Requester/Owner Confirms
↓
Service Receipt
↓
Invoice Matching
```

---

# 27. WF-PROC05 — Invoice Intake

Invoice sources:

```text
Manual Upload
Email Integration
Supplier Portal
API
Accounting Import
```

Required:

```text
Invoice Number
Supplier
Invoice Date
Currency
Amount
Tax
Lines
```

---

# 28. Invoice Duplicate Prevention

Fingerprint:

```text
supplier
invoice_number
invoice_date
gross_amount
```

Nếu match invoice active/existing:

```text
flag duplicate
do not create silently
```

---

# 29. Invoice State

```text
RECEIVED
VALIDATING
MATCHING
EXCEPTION
APPROVED
RECORDED_FOR_PAYMENT
PAID
CREDITED
REJECTED
```

---

# 30. Invoice Validation

Check:

```text
Supplier exists
PO exists if required
Invoice number unique
Currency matches
Tax data
Line totals
Grand total
Required documents
```

---

# 31. 3-Way Match

Core:

```text
PURCHASE ORDER
vs
GOODS/SERVICE RECEIPT
vs
INVOICE
```

Compare:

```text
Quantity
Unit Price
Item
Tax
Total
```

---

# 32. Match Result

```text
MATCHED
QUANTITY_MISMATCH
PRICE_MISMATCH
ITEM_MISMATCH
TAX_MISMATCH
MISSING_RECEIPT
MISSING_PO
OVER_INVOICE
PARTIAL_MATCH
```

---

# 33. Tolerance Rules

Có thể cấu hình:

```text
price tolerance %
quantity tolerance
rounding tolerance
tax tolerance
```

Ví dụ:

```text
price variance <= 1%
→ auto-acceptable
```

Nếu vượt:

```text
Invoice Exception
```

---

# 34. Invoice Exception Flow

```text
Mismatch
↓
Identify Type
↓
Assign Owner
↓
Resolve
```

Actions:

```text
Correct Invoice
Correct Receipt
Create PO Amendment
Request Credit Note
Approve Exception
Reject Invoice
```

---

# 35. Credit Note

Credit Note phải link tới:

```text
Supplier
Original Invoice
Reason
Amount
Lines
```

Không overwrite original invoice amount.

---

# 36. Partial Invoice

PO có thể được invoice nhiều lần.

Example:

```text
PO total 100 units
Invoice 1 = 40
Invoice 2 = 60
```

System track cumulative invoiced quantity/value.

---

# 37. Over-Invoice Protection

Nếu:

```text
invoiced qty > received qty
```

hoặc:

```text
invoiced amount > allowed PO amount
```

→ block/exception theo policy.

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

Asset có thể lưu:

```text
purchase_cost
invoice_reference
supplier
purchase_date
cost_center
depreciation_reference if integrated
```

Không duplicate accounting logic nếu ERP là source-of-truth.

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
  effective_from:
  effective_to:
  auto_renew:
  notice_period:
  currency:
  value:
  owner:
  business_owner:
  service_owner:
  terms:
  documents:
  status:
```

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

```text
DRAFT
REVIEW
APPROVED
ACTIVE
EXPIRING
EXPIRED
RENEWAL_IN_PROGRESS
TERMINATED
ARCHIVED
```

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

Threshold configurable:

```text
180d
120d
90d
60d
30d
7d
```

Events:

```text
CONTRACT.EXPIRING
CONTRACT.EXPIRED
```

---

# 50. WF-CON02 — Contract Renewal

Flow:

```text
Contract Expiring
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
Contract Expiring
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

Contract activation chỉ sau required approvals/documents.

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
PROCUREMENT.REQUEST_CREATED
PROCUREMENT.REQUESTED
PROCUREMENT.BUDGET_CHECKED
PROCUREMENT.APPROVAL_REQUESTED
PROCUREMENT.APPROVED
PROCUREMENT.REJECTED
RFQ.CREATED
RFQ.SENT
QUOTATION.RECEIVED
SUPPLIER.SELECTED
PO.CREATED
PO.APPROVED
PO.ISSUED
PO.AMENDED
PO.PARTIALLY_RECEIVED
PO.FULLY_RECEIVED
PO.DELIVERY_OVERDUE
PO.CLOSED
```

## Invoice

```text
INVOICE.RECEIVED
INVOICE.DUPLICATE_DETECTED
INVOICE.MATCH_STARTED
INVOICE.MATCHED
INVOICE.MISMATCH
INVOICE.APPROVED
INVOICE.RECORDED_FOR_PAYMENT
INVOICE.PAID
CREDIT_NOTE.RECEIVED
```

## Contract

```text
CONTRACT.CREATED
CONTRACT.APPROVED
CONTRACT.ACTIVE
CONTRACT.EXPIRING
CONTRACT.RENEWAL_STARTED
CONTRACT.RENEWED
CONTRACT.EXPIRED
CONTRACT.SLA_BREACH
CONTRACT.TERMINATED
```

## Document

```text
DOCUMENT.CREATED
DOCUMENT.VERSION_CREATED
DOCUMENT.APPROVED
DOCUMENT.SIGNED
DOCUMENT.EXPIRING
DOCUMENT.EXPIRED
DOCUMENT.SUPERSEDED
DOCUMENT.ARCHIVED
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
Contracts Expiring
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
invoice:{supplier}:{invoice_number}
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
5. Approve invoice nếu 3-way mismatch vượt tolerance mà không exception approval.
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
16. Hardcode tax/currency/approval threshold vào core workflow.
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
PO = PARTIALLY_RECEIVED
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
PO fully received/invoiced
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
Price tolerance exceeded
↓
INVOICE.MISMATCH
↓
Procurement reviews
↓
Supplier confirms invoice error
↓
Corrected invoice uploaded
↓
Old invoice rejected/superseded
↓
3-Way Match PASS
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
- Invoice duplicate detection hoạt động.
- 3-way match có tolerance + exception handling.
- Partial invoice và credit note hoạt động.
- Payment chỉ được sync/record nếu hệ thống không phải ERP.
- License purchase cập nhật entitlement.
- Spare part purchase nối Maintenance.
- Contract có lifecycle + coverage + expiry + notice deadline.
- Contract renewal dùng actual usage/performance.
- Document có metadata/version/status/permission/retention.
- Signed/final document immutable.
- Auto-generated documents lấy dữ liệu từ workflow context.
- Procurement exceptions vào Work Queue.
- Permissions, notifications, SLA, idempotency và audit trail đầy đủ.
