# ASSET RECEIVING + WAREHOUSE + ASSIGNMENT + TRANSFER + RETURN WORKFLOW SPEC
## Execution-Level Workflow Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:** `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`, `PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md`  
**Scope:** Asset Receiving, Warehouse, Stock In/Out, Asset Tagging, Reservation, Assignment, Handover, Transfer, Loan, Return, Inspection, Stock Reconciliation

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa toàn bộ vòng đời tài sản từ khi hàng được nhận đến khi:

```text
Nhập kho
→ Tạo Asset
→ Gắn Asset Tag/QR
→ Kiểm tra
→ Sẵn sàng cấp phát
→ Đặt chỗ
→ Cấp phát
→ Điều chuyển
→ Cho mượn
→ Thu hồi
→ Kiểm tra tình trạng
→ Trả về kho / Bảo trì / Thanh lý
```

Mục tiêu chính:

- không nhập cùng dữ liệu nhiều lần;
- một Asset chỉ có một record gốc;
- mọi biến động vật lý đều tạo Movement;
- mọi cấp phát đều có Assignment;
- mọi xuất/nhập kho đều có chứng từ;
- mọi thay đổi owner/location đều có audit trail;
- support barcode/QR scanning;
- phân biệt rõ Asset Lifecycle, Assignment State, Location và Warehouse Stock State;
- giảm tối đa thao tác thủ công cho Helpdesk/Asset Admin.

---

# 2. Core Entities

```text
ASSET
ASSET MODEL
ASSET TAG
SERIAL NUMBER
WAREHOUSE
WAREHOUSE LOCATION
BIN / SHELF
STOCK RECEIPT
STOCK ISSUE
GOODS RECEIPT
MOVEMENT
ASSIGNMENT
RESERVATION
LOAN
USER
DEPARTMENT
LOCATION
SITE
BUILDING
FLOOR
ROOM
SUPPLIER
PURCHASE ORDER
INVOICE
DELIVERY NOTE
HANDOVER DOCUMENT
RETURN DOCUMENT
CONDITION REPORT
DOCUMENT
AUDIT TRAIL
```

---

# 3. State Model

## 3.1 Asset Lifecycle

```text
Planned
Purchased
Received
Available
Reserved
Assigned
In Use
Repair
Returned
Retired
Disposed
```

## 3.2 Assignment State

```text
Unassigned
Reserved
Assigned
Pending Return
In Transit
Temporary Loan
```

## 3.3 Warehouse Stock State

```text
EXPECTED
RECEIVED
QUARANTINE
AVAILABLE
RESERVED
ISSUED
RETURN_PENDING
RETURNED
DAMAGED
MISSING
```

Warehouse Stock State không thay thế Asset Lifecycle.

Ví dụ:

```text
Lifecycle = Available
Assignment = Unassigned
Warehouse State = AVAILABLE
Location = HN-WH-A03
```

---

# 4. Location Model

Physical location hierarchy:

```text
Organization
↓
Site
↓
Building
↓
Floor
↓
Room
↓
Warehouse / Rack / Shelf / Bin
```

Ví dụ:

```text
VN
└─ Hanoi HQ
   └─ Building A
      └─ Floor B1
         └─ IT Warehouse
            └─ Rack A
               └─ Shelf 03
```

Mỗi Movement phải lưu:

```text
from_location
to_location
timestamp
actor
reason
related_document
```

---

# 5. Asset Identity Rules

Ưu tiên identity:

```text
Asset ID = internal immutable ID
Asset Tag = human/QR-readable identifier
Serial Number = manufacturer identifier
```

Không dùng Serial Number làm primary key duy nhất.

Một Asset có thể đổi:

```text
owner
location
hostname
IP
```

nhưng không đổi internal Asset ID.

---

# 6. WF-A01 — Receive Goods

## Trigger

```text
GOODS_RECEIPT.POSTED (Procurement-linked physical goods)
```

Nguồn:

```text
Purchase Order
Direct Purchase
Transfer from another warehouse
Donation
Manual intake
```

For PO-linked physical Goods Receipt, the authoritative trigger is
`GOODS_RECEIPT.POSTED` after commit. Other intake sources keep their owning
workflow; TASK-073 rules do not silently generalize to them.

## Preconditions

Tối thiểu:

```text
source
item/model
quantity
receiving location
receiver
```

Nếu có PO:

```text
PO number
supplier
ordered quantity
expected models
```

---

# 7. Goods Receiving Flow

```text
Goods Arrive
↓
Open Receiving Session
↓
Select PO / Source
↓
Scan Delivery Note / Invoice
↓
Count Physical Units
↓
Scan Serial Numbers
↓
Validate
↓
Inspect Condition
↓
Accept / Quarantine / Reject
↓
GOODS_RECEIPT.POST
↓
Commit receipt + PO accepted quantities + audit + outbox
↓
Asynchronous Asset-owned ASSET.REGISTER_RECEIVED per accepted tracked unit
↓
Generate Asset Tags / complete put-away through Asset workflow
↓
Close Receiving Session
```

The receiving session is an operator workflow, not the authoritative receipt
record. Asset registration never occurs in the Procurement Goods Receipt
transaction.

---

# 8. Receiving Validation

System kiểm tra:

```text
quantity ordered vs received
duplicate serial
unexpected model
damaged item
missing serial
missing mandatory document
existing asset with same serial
wrong supplier
```

Decision:

```text
MATCH
PARTIAL
UNDER_RECEIPT
DAMAGED
UNKNOWN_ITEM
DUPLICATE
```

TASK-073 is authoritative for Procurement-linked physical Goods Receipt.
Accepted quantity may never exceed the ordered PO quantity; an over-receipt
fails atomically and has no tolerance/approval path in this task. Observed,
accepted and rejected/damaged quantity remain distinct; only accepted
quantity advances the PO receipt dimension. A duplicate unit identity within
one receipt or unresolved uncertainty about accepted quantity/item identity
blocks posting. Do not auto-merge ambiguous Asset matches.

---

# 9. Partial Receiving

Ví dụ:

```text
PO = 50 laptops
Today received = 20
```

System:

```text
PO received quantity = 20/50
Goods Receipt = GR-001
Remaining = 30
```

Posting never closes the PO; `PO.CLOSE` remains an explicit lifecycle command.

---

# 10. Over / Under Receipt

## Under Receipt

```text
Ordered 50
Received 48
```

Actions:

```text
Accept partial
Wait remaining
Create supplier discrepancy
Close remainder through PO.CLOSE_REMAINDER with required reason
```

## Over Receipt

For TASK-073, if cumulative accepted quantity would exceed the issued PO line
quantity, reject the entire `GOODS_RECEIPT.POST` with
`GOODS_RECEIPT_OVER_ORDERED_QUANTITY`. Do not partially post, accept the extra
with approval, or amend the PO after receipt. No over-receipt tolerance or
approval policy is defined. A future explicit policy may extend this rule.

---

# 11. Damaged on Arrival

Nếu thiết bị hư khi nhận:

```text
Condition = DAMAGED_ON_ARRIVAL
Warehouse State = QUARANTINE
```

Không đưa vào `AVAILABLE`.

Flow:

```text
Capture photo/evidence
↓
Create Supplier Exception
↓
Return / Replace / Accept Discount
```

---

# 12. Asset Record Creation

After a Goods Receipt is committed as POSTED, each accepted Asset-tracked
physical unit is registered through the Asset-owned `ASSET.REGISTER_RECEIVED`
command. Procurement/Warehouse must not write Asset tables or create the
Asset inside its receipt transaction. Use immutable `received_unit_id` as
the idempotency identity; serial text alone is not a stable global key.

Initial state:

```text
Lifecycle = Received
Assignment = Unassigned
Operational = Unknown
Health = Unknown
Warehouse State = RECEIVED
```

Initial registration is asynchronous and starts in `RECEIVED`, at the
receiving warehouse/location, with assignment `UNASSIGNED`. It must not
create an Asset directly as `ASSIGNED` or `IN_USE`. A later transition to
`AVAILABLE` uses the existing validation and put-away workflow. Existing
deterministic or ambiguous Asset matches must follow Asset duplicate rules;
never auto-merge or silently create a duplicate. Asset registration failure
does not undo a posted physical receipt and must be retried idempotently or
left as actionable human work after retry exhaustion.

Sau kiểm tra/preparation:

```text
Lifecycle = Available
Warehouse State = AVAILABLE
```

---

# 13. Asset Tagging

Tag có thể chứa:

```text
Asset Tag
QR
Barcode
Human-readable ID
Company branding
```

QR nên resolve tới Asset Workspace, không chứa quá nhiều dữ liệu nhạy cảm.

Ví dụ:

```text
AST-2026-0042
```

Scan:

```text
QR
↓
Resolve Asset
↓
Open context
```

---

# 14. Receiving Documents

Có thể liên kết:

```text
Purchase Order
Invoice
Delivery Note
Goods Receipt
Photo Evidence
Warranty Document
Supplier Packing List
```

Mọi document phải link đến:

```text
Receiving Session
AND/OR
Asset
```

---

# 15. WF-A02 — Warehouse Put-away

Sau receiving:

```text
Received Assets
↓
Choose Warehouse
↓
Choose Rack/Shelf/Bin
↓
Scan Location
↓
Scan Asset
↓
Confirm
```

System:

```text
Asset Location updated
Movement created
Warehouse State updated
Timeline updated
```

Không nhập location bằng text tự do nếu location đã được quản lý.

---

# 16. Warehouse Capacity Rules

Có thể quản lý:

```text
max units
max weight
asset type restriction
security zone
temperature requirement
restricted access
```

---

# 17. WF-A03 — Asset Preparation

Trước khi cấp phát:

```text
Available Asset
↓
Hardware Check
↓
OS Provisioning
↓
Agent Enrollment
↓
Approved Software Profile
↓
Security Baseline
↓
Health Check
↓
Ready
```

Output:

```text
Asset = Ready for Assignment
```

Nếu fail:

```text
Maintenance / Quarantine
```

---

# 18. Preparation Profile

Profile có thể theo:

```text
Department
Role
Asset Model
Location
Security Level
```

Ví dụ:

```text
Developer Laptop Profile:
- Windows 11 Enterprise
- Endpoint Agent
- VPN
- VS Code
- Git
- Security Baseline
```

---

# 19. WF-A04 — Asset Reservation

Reservation dùng khi đã có request nhưng chưa bàn giao ngay.

Trigger:

```text
Approved Asset Request
Planned onboarding
Replacement plan
Temporary assignment
```

Flow:

```text
Request
↓
Find Eligible Asset
↓
Reserve
↓
Set Expiry
↓
Prepare
↓
Assign
```

State:

```text
Lifecycle = Reserved
Assignment = Reserved
Warehouse State = RESERVED
```

---

# 20. Reservation Expiry

Reservation phải có timeout.

Ví dụ:

```text
expires in 3 business days
```

Nếu hết hạn:

```text
Reservation Released
Lifecycle = Available
Assignment = Unassigned
Warehouse State = AVAILABLE
```

Trừ khi operator gia hạn.

---

# 21. Asset Eligibility Matching

Hệ thống có thể đề xuất Asset dựa trên:

```text
asset type
department policy
role profile
minimum specification
location
health
warranty
age
risk
availability
```

Không đề xuất:

```text
Critical Health
Expired/blocked asset
Maintenance asset
Reserved for another request
```

---

# 22. WF-A05 — Assign Asset to User

## Trigger

```text
Approved request
Onboarding
Replacement
Manual assignment
```

## Preconditions

```text
Asset eligible
Asset available/reserved
User active
Required approvals complete
Preparation complete
```

---

# 23. Assignment Flow

```text
Open Assignment
↓
Select User
↓
Select/Confirm Asset
↓
Show Current State
↓
Show Target State
↓
Verify Preparation
↓
Generate Handover Document
↓
User Confirmation
↓
Complete Assignment
```

---

# 24. Assignment State Transition

Before:

```text
Lifecycle = Available/Reserved
Assignment = Unassigned/Reserved
Location = Warehouse
```

After:

```text
Lifecycle = In Use
Assignment = Assigned
Owner/User = target user
Location = user/site location
Warehouse State = ISSUED
```

Create:

```text
Assignment
Movement
Stock Issue
Audit Trail
Timeline Event
```

---

# 25. Handover Document

Biên bản bàn giao nên được tạo tự động từ context:

```text
Asset ID
Asset Model
Serial
Accessories
Condition
User
Department
Location
Date
Issuer
Receiver
Terms
```

Không bắt operator nhập lại dữ liệu đã có.

Possible confirmation:

```text
Digital signature
SSO confirmation
OTP
Physical signature upload
```

---

# 26. Accessories

Assignment có thể gồm:

```text
Laptop
Charger
Dock
Mouse
Bag
Monitor
SIM
Access card
```

Phân biệt:

```text
tracked asset
consumable
accessory
```

Không nhất thiết tạo full Asset record cho mọi vật tư nhỏ nếu policy không yêu cầu.

---

# 27. WF-A06 — Stock Issue

Khi cấp phát:

```text
Stock Issue
↓
Warehouse quantity update
↓
Asset leaves warehouse
↓
Movement created
```

Stock Issue document:

```text
Issue ID
Asset
Warehouse
Destination
Reason
Related Request
Receiver
Timestamp
```

---

# 28. WF-A07 — Transfer Asset Between Users

Trigger:

```text
Department transfer
Role change
Manual reassignment
Device swap
```

Flow:

```text
Current Assignment
↓
Select New User
↓
Check eligibility
↓
Preview Current → After
↓
Confirm
↓
Create Movement
↓
Close old Assignment
↓
Create new Assignment
↓
Notify both users
```

---

# 29. Transfer Preview

Bắt buộc hiển thị:

```text
CURRENT
Owner: Nguyễn Văn A
Department: Finance
Location: Hanoi Floor 4
Assignment: Assigned

AFTER
Owner: Trần Văn B
Department: Legal
Location: Hanoi Floor 5
Assignment: Assigned
```

Nếu thiết bị cần di chuyển vật lý:

```text
Assignment = In Transit
```

cho đến khi receiver xác nhận.

---

# 30. WF-A08 — Transfer Between Locations

Ví dụ:

```text
Hanoi Warehouse
→ HCM Warehouse
```

Flow:

```text
Create Transfer Order
↓
Scan Out
↓
Assignment State = In Transit
↓
Movement created
↓
Shipping/Transport data
↓
Destination receives
↓
Scan In
↓
Verify quantity/condition
↓
Complete Transfer
```

---

# 31. Inter-Warehouse Transfer States

```text
DRAFT
READY
IN_TRANSIT
PARTIALLY_RECEIVED
RECEIVED
CANCELLED
EXCEPTION
```

Không chuyển thẳng Location từ Hanoi → HCM trước khi nhận thực tế.

---

# 32. Transfer Exception

Possible exceptions:

```text
missing item
damaged in transit
wrong item
serial mismatch
partial delivery
```

Tạo:

```text
Transfer Exception
Condition Report
Investigation Work Item
```

---

# 33. WF-A09 — Temporary Loan

Use case:

```text
Device under repair
Short-term project
Visitor/temporary staff
Emergency replacement
```

Flow:

```text
Loan Request
↓
Select Available Asset
↓
Define Due Date
↓
Generate Loan Document
↓
Assign Temporarily
↓
Notify Return Date
```

State:

```text
Assignment = Temporary Loan
Lifecycle = In Use
```

---

# 34. Loan Due Reminder

Notifications:

```text
T-3 days
T-1 day
Due date
Overdue
```

Nếu overdue:

```text
Create Return Work Item
Notify User
Notify Helpdesk
Escalate by policy
```

---

# 35. WF-A10 — Return Request

Trigger:

```text
User termination
Device replacement
Loan due
Manual recall
Role change
Asset refresh
```

State:

```text
Assignment = Pending Return
```

Flow:

```text
Create Return Task
↓
Notify User
↓
Schedule/Drop-off
↓
Receive Asset
```

---

# 36. Return Intake

Khi nhận lại:

```text
Scan Asset
↓
Match Assignment
↓
Confirm Accessories
↓
Inspect Condition
↓
Capture Evidence
↓
Close User Assignment
```

---

# 37. Return Condition Grades

Ví dụ:

```text
A - Good
B - Minor wear
C - Repair required
D - Major damage
E - Missing/Not returned
```

---

# 38. Return Decision Tree

```text
Asset Returned
↓
Condition?
├─ Good
│  ↓
│ Data wipe / re-provision
│  ↓
│ Available
│
├─ Repair Required
│  ↓
│ Maintenance
│
├─ End of Life
│  ↓
│ Retired
│
└─ Missing
   ↓
   Exception / Investigation
```

---

# 39. Return State Changes

Khi physically received:

```text
Owner/User = None
Assignment = Unassigned
Location = Receiving/Inspection Area
Warehouse State = RETURNED
```

Sau inspection:

### Good

```text
Lifecycle = Returned
↓
Re-provision
↓
Lifecycle = Available
Warehouse State = AVAILABLE
```

### Repair

```text
Lifecycle = Repair
Warehouse State = QUARANTINE/DAMAGED
```

### Retire

```text
Lifecycle = Retired
```

---

# 40. Return Document

Biên bản thu hồi:

```text
Asset
Serial
User
Accessories
Return Date
Condition
Damage
Missing items
Receiver
User acknowledgement
Notes
```

Generated automatically.

---

# 41. Employee Offboarding Integration

Identity event:

```text
USER.TERMINATED
```

System:

```text
Find all assigned assets
↓
Find loans
↓
Find accessories
↓
Create Return Tasks
↓
Reclaim licenses
↓
Notify manager/helpdesk
```

Clearance condition:

```text
No outstanding tracked asset
No active loan
No unresolved missing asset
```

---

# 42. Missing Asset Handling

Nếu asset không được trả:

```text
Assignment = Pending Return
Warehouse State = MISSING
Compliance/Risk = Exception/High
```

Actions:

```text
Contact User
Manager escalation
Security review
Loss report
Financial process
```

Không tự chuyển Asset sang `Disposed`.

---

# 43. Lost / Stolen Asset

Flow:

```text
Report Lost/Stolen
↓
Incident
↓
Mark Risk Critical
↓
Remote lock/wipe if supported
↓
Disable access
↓
Reclaim licenses
↓
Security notification
↓
Investigation
↓
Disposition decision
```

Asset Lifecycle không đổi ngay thành Disposed.

---

# 44. Warehouse Reconciliation

Periodic process:

```text
Expected Warehouse Inventory
↓
QR Scan / Agent / Manual Count
↓
Compare
```

Results:

```text
Verified
Missing
Unexpected
Wrong Bin
Wrong Warehouse
Data Mismatch
```

Exceptions link sang Audit workflow.

---

# 45. Cycle Count

Có thể audit theo:

```text
warehouse
bin
asset type
risk
value
random sample
```

Không cần kiểm toàn bộ kho mỗi lần.

---

# 46. Bulk Operations

Warehouse phải hỗ trợ:

```text
bulk receive
bulk tag
bulk reserve
bulk issue
bulk transfer
bulk return
bulk audit
bulk export
```

Bulk action vẫn phải tạo per-asset audit trail.

---

# 47. Barcode / QR Workflow

Pattern:

```text
Scan Location
↓
Scan Asset 1
↓
Scan Asset 2
↓
Scan Asset N
↓
Confirm Batch
```

Use cases:

```text
Receiving
Put-away
Assignment
Transfer
Return
Audit
Disposal
```

---

# 48. Duplicate Prevention

## Receiving

Key:

```text
serial + manufacturer/model
```

Nếu match Asset đã tồn tại:

```text
block automatic duplicate creation
```

## Assignment

Một Asset không được có hai active `Assigned` assignments cùng lúc.

## Movement

Action retry phải reuse:

```text
movement_operation_id
```

## Documents

Không tạo nhiều handover document cho cùng assignment version nếu request bị retry.

---

# 49. Idempotency Keys

```text
goods_receipt:{tenant_id}:{idempotency_key}
asset_register_received:{tenant_id}:{received_unit_id}
assignment:{asset_id}:{assignment_version}
movement:{operation_id}:{asset_id}
return:{return_task}:{asset_id}
warehouse_transfer:{transfer_id}:{asset_id}
```

---

# 50. Permission Model

## Warehouse Operator

```text
receive
scan
put-away
issue
receive return
inter-warehouse transfer tasks
```

## Asset Admin

```text
create/edit asset master data
assign
transfer
reserve
retire candidate
correct inventory exceptions
```

## Helpdesk

```text
assign approved asset
temporary loan
return intake
view stock
```

## Manager

```text
approve high-value requests
approve exceptions
```

## Auditor

```text
read inventory
run audit
view movements/documents
```

---

# 51. Approval Rules

Approval có thể yêu cầu khi:

```text
high-value asset
special asset class
cross-department transfer
inter-site transfer
lost asset
manual stock adjustment
```

Không cần approval cho mọi thao tác thường ngày.

---

# 52. Manual Stock Adjustment

Không cho operator sửa quantity trực tiếp không lý do.

Flow:

```text
Adjustment Request
↓
Reason
↓
Evidence
↓
Approval if policy requires
↓
Adjustment
↓
Audit Trail
```

Types:

```text
FOUND
MISSING
DAMAGED
DATA_CORRECTION
COUNT_CORRECTION
```

---

# 53. Documents

## Receiving

```text
Purchase Order
Invoice
Delivery Note
Goods Receipt
Inspection Evidence
```

## Assignment

```text
Handover Document
User Acceptance
Stock Issue
```

## Transfer

```text
Transfer Order
Shipping Document
Receiving Confirmation
```

## Return

```text
Return Document
Condition Report
Damage Evidence
```

Tài liệu phải versioned và immutable sau ký, trừ quy trình correction rõ ràng.

---

# 54. Unified Asset Timeline

Ví dụ:

```text
08/09 09:30 GOODS RECEIVED
Serial PF3X002 received from Supplier A

08/09 10:10 ASSET CREATED
AST-0042 created

08/09 10:25 WAREHOUSE
Placed at HN-WH-A03

09/09 15:00 RESERVATION
Reserved for Nguyễn Văn An

10/09 09:20 ASSIGNMENT
Assigned to Nguyễn Văn An

10/09 09:21 DOCUMENT
Handover HD-1021 signed

18/12 14:00 RETURN REQUEST
Offboarding return requested

20/12 10:15 RETURN
Asset received, condition B

20/12 11:30 WAREHOUSE
Returned to HN-WH-A05
```

---

# 55. Generated Events

```text
GOODS_RECEIPT.CREATED
GOODS_RECEIPT.UPDATED
GOODS_RECEIPT.POSTED
GOODS_RECEIPT.CANCELLED
GOODS.RECEIVING_EXCEPTION
ASSET.CREATED
ASSET.TAGGED
ASSET.PUT_AWAY
ASSET.AVAILABLE
ASSET.RESERVED
ASSET.RESERVATION_EXPIRED
ASSET.ASSIGNED
ASSET.TRANSFER_STARTED
ASSET.IN_TRANSIT
ASSET.TRANSFERRED
ASSET.LOANED
ASSET.LOAN_OVERDUE
ASSET.RETURN_REQUESTED
ASSET.RETURNED
ASSET.RETURN_INSPECTED
ASSET.MISSING
WAREHOUSE.ADJUSTMENT_REQUESTED
WAREHOUSE.ADJUSTMENT_COMPLETED
DOCUMENT.HANDOVER_SIGNED
DOCUMENT.RETURN_SIGNED
```

---

# 56. Downstream Workflow Mapping

```text
Damaged on receiving
→ Supplier / Procurement Exception

Return needs repair
→ Maintenance Workflow

Asset end-of-life
→ Replacement / Disposal Workflow

Lost/Stolen
→ Incident + Security Workflow

Warehouse mismatch
→ Audit Workflow

Assignment needs software
→ Software Deployment Workflow

User terminated
→ Identity Offboarding Workflow
```

---

# 57. Notifications

## Receiving

Chỉ notify exception:

```text
quantity mismatch
damage
unexpected item
```

## Reservation

```text
reservation created
reservation expiring
reservation released
```

## Assignment

```text
user receives handover request
assignment completed
```

## Transfer

```text
sender
receiver
destination warehouse/operator
```

## Return

```text
return requested
due reminder
overdue
return completed
```

Notification không gửi mỗi scan.

---

# 58. SLA / Operational Timers

Có thể cấu hình:

```text
Receiving completion SLA
Reservation expiry
Preparation SLA
Return due date
Loan due date
Transfer expected delivery
Inspection SLA
```

Ví dụ:

```text
Return received
→ inspection must complete within 4 business hours
```

---

# 59. Metrics / KPI

## Receiving

```text
Receiving Accuracy
Receiving Lead Time
Damage-on-Arrival Rate
PO Quantity Mismatch Rate
```

## Warehouse

```text
Inventory Accuracy
Stock Aging
Available vs Reserved
Missing Asset Rate
Wrong Location Rate
```

## Assignment

```text
Time to Provision
Time to Assign
Handover Completion Rate
Assets per User
```

## Return

```text
Return Completion Time
Overdue Return Rate
Damage Rate
Missing Accessory Rate
```

## Transfer

```text
Transfer Lead Time
Transit Exception Rate
Inter-site Transfer Accuracy
```

---

# 60. Guardrails

Hệ thống không được:

1. Tạo duplicate Asset khi scan lại cùng serial.
2. Đưa damaged-on-arrival asset vào Available.
3. Cho một Asset có hai active assignments.
4. Chuyển location đích trước khi inter-site transfer được nhận.
5. Cho sửa stock quantity trực tiếp mà không có adjustment record.
6. Mất lịch sử owner/location cũ.
7. Xóa signed handover/return document.
8. Đánh dấu Returned khi chưa nhận vật lý.
9. Đánh dấu Disposed chỉ vì user không trả asset.
10. Cho expired reservation giữ asset vô thời hạn.
11. Bắt operator nhập lại user/location/asset data đã biết.
12. Tạo Movement nhưng không update Asset Location, hoặc ngược lại.

---

# 61. End-to-End Example — New Laptop

```text
PO-1024 orders 50 Dell Latitude
↓
Warehouse receives 20 units
↓
Operator scans 20 serials
↓
System validates no duplicates
↓
20 Asset records created
↓
QR tags generated
↓
Assets placed in HN-WH-A03
↓
Preparation profile runs
↓
Agents enrolled
↓
Assets become Available
↓
Onboarding request for Nguyễn Văn An
↓
AST-0042 reserved
↓
Approved software installed
↓
Handover document generated
↓
User confirms
↓
Lifecycle = In Use
Assignment = Assigned
Location = Hanoi Floor 4
↓
Timeline updated
```

---

# 62. End-to-End Example — User Leaves Company

```text
USER.TERMINATED
↓
System finds:
Laptop AST-0042
Monitor AST-0344
Loan phone AST-0820
↓
3 Return Tasks created
↓
User/Manager notified
↓
Assets received by Helpdesk
↓
QR scan
↓
Laptop condition B
Monitor condition A
Phone screen damaged
↓
Laptop → re-provision → Available
Monitor → Available
Phone → Maintenance
↓
Assignments closed
↓
Return documents signed
↓
Offboarding asset clearance complete
```

---

# 63. End-to-End Example — Inter-Warehouse Transfer

```text
Hanoi needs to send 10 laptops to HCM
↓
Transfer Order TO-204
↓
10 assets reserved
↓
Scan Out
↓
Assignment State = In Transit
↓
Shipment tracking stored
↓
HCM receives 9/10
↓
9 assets scan in
↓
1 asset missing
↓
Transfer = PARTIALLY_RECEIVED
↓
Exception created for missing asset
↓
Remaining 9 assets available in HCM warehouse
```

---

# 64. Definition of Done

Cụm workflow này đạt yêu cầu khi:

- Receiving hỗ trợ partial/over/under receipt.
- Duplicate serial detection hoạt động.
- Damaged items đi vào quarantine.
- Asset Tag/QR được tạo và scan xuyên suốt workflow.
- Warehouse location có hierarchy.
- Reservation có expiry.
- Assignment tạo Assignment + Movement + Stock Issue + Handover.
- Transfer hỗ trợ Current → After preview.
- Inter-site transfer có In Transit state.
- Loan có due date và overdue workflow.
- Return có condition inspection.
- Returned asset được phân nhánh Available / Repair / Retired.
- Missing asset không bị tự coi là Disposed.
- Offboarding tự tìm toàn bộ assigned assets.
- Manual stock adjustment có approval/audit.
- Documents gắn đúng context.
- Unified Timeline phản ánh mọi movement.
- Tất cả action có idempotency và audit trail.

---

# 65. TASK-076 — Procurement Cost Provenance for Assets

Asset `purchase_cost`/cost API fields are derived summaries only. Canonical
history is immutable CostProvenance/CostAllocation linked by canonical IDs to
the source commercial document, version and line. For a received Asset the
trace is:

```text
Asset
→ received_unit_id
→ POSTED Goods Receipt line/unit
→ PO line + immutable PO commercial version
→ effective Invoice allocation where available
→ Contract/ContractVersion where applicable
```

Goods Receipt records physical receipt and never becomes cost authority. A
PO allocation may create COMMITTED cost. An effective Invoice allocation adds
ACTUAL cost without changing the committed record. An applied Credit Note adds
an ADJUSTMENT without mutating the Invoice-derived record. Source amount and
currency remain unchanged; any reporting-currency conversion is an additional
derived value under an explicit FX policy.

For homogeneous multi-unit lines, allocation is deterministic and reconciles
exactly to the source line total. Convert source total to currency minor units,
divide by the target-unit count covered by the durable source-line/receipt-line
quantity allocation, allocate the quotient to each unit, then assign one
extra minor unit to the first remainder units ordered by stable
`received_unit_id`. Invoice targets use TASK-074 receipt-line evidence and
stable received-unit identity. Header-level freight, tax, fees, discounts and other charges
remain at source unless an explicit allocation policy exists. Normal cost
linkage creates no Work Item; ambiguous/missing sources or reconciliation
failures create actionable exception work. Asset owns Asset state and cost
summary projections; Procurement/Contract sources remain owned by their
source domains. Cross-domain linkage uses application commands/events and
idempotent projections, never direct cross-domain table writes.
