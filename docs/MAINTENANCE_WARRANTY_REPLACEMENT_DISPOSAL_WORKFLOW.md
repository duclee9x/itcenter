# MAINTENANCE + WARRANTY + REPLACEMENT + DISPOSAL WORKFLOW SPEC
## Execution-Level Workflow Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:**  
- `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md`
- `ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`

**Scope:** Maintenance, Repair, Preventive Maintenance, Warranty, Vendor Repair, Spare Parts, Cost Tracking, Repair-vs-Replace Decision, Replacement Planning, Retirement, Data Wipe, Disposal, Liquidation, Documentation, Audit Trail

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa chuỗi xử lý từ khi Asset phát sinh vấn đề hoặc đến hạn bảo trì cho tới khi:

```text
Issue / Maintenance Due
→ Diagnose
→ Warranty Check
→ Repair Decision
→ Maintenance Order
→ Repair / Vendor Service
→ Verification
→ Return to Service
```

hoặc:

```text
Issue / Aging / High Cost
→ Replacement Decision
→ Replacement Plan
→ New Asset
→ Migration
→ Return Old Asset
→ Retire
→ Data Wipe
→ License Reclaim
→ Disposal / Sale / Vendor Return
→ Final Documents
```

Mục tiêu chính:

- liên kết Incident, Asset Health, Maintenance, Warranty và Cost;
- tránh sửa một thiết bị không còn kinh tế;
- không bỏ sót warranty/vendor coverage;
- theo dõi toàn bộ chi phí sửa chữa;
- hỗ trợ preventive maintenance;
- hỗ trợ thiết bị tạm thay thế;
- kiểm soát quá trình retire/disposal;
- bảo đảm dữ liệu được xóa đúng quy trình;
- thu hồi license/access trước disposal;
- tạo đầy đủ biên bản, hóa đơn, chứng từ và audit trail.

---

# 2. Core Entities

```text
ASSET
ASSET MODEL
MAINTENANCE ORDER
MAINTENANCE TASK
MAINTENANCE PLAN
PREVENTIVE MAINTENANCE SCHEDULE
REPAIR CASE
DIAGNOSIS
FAILURE MODE
SPARE PART
PART USAGE
VENDOR
SERVICE CENTER
WARRANTY
WARRANTY CLAIM
CONTRACT
SERVICE CONTRACT
QUOTE
INVOICE
RECEIPT
COST RECORD
DOWNTIME RECORD
LOAN ASSET
REPLACEMENT CANDIDATE
REPLACEMENT PLAN
REPLACEMENT APPROVAL
RETIREMENT RECORD
DATA WIPE JOB
DATA WIPE EVIDENCE
DISPOSAL RECORD
DISPOSAL METHOD
SALE RECORD
VENDOR RETURN
DOCUMENT
AUDIT TRAIL
```

---

# 3. State Model

## 3.1 Maintenance Order State

```text
DRAFT
OPEN
DIAGNOSING
WAITING_APPROVAL
WAITING_PART
WAITING_VENDOR
IN_REPAIR
VERIFYING
COMPLETED
CANCELLED
FAILED
```

## 3.2 Asset Maintenance State

```text
NONE
DUE
SCHEDULED
UNDER_DIAGNOSIS
IN_REPAIR
WAITING_PART
WAITING_VENDOR
VERIFYING
```

## 3.3 Warranty State

```text
VALID
EXPIRING
EXPIRED
UNKNOWN
CLAIM_OPEN
CLAIM_APPROVED
CLAIM_REJECTED
```

## 3.4 Replacement State

```text
NONE
CANDIDATE
UNDER_REVIEW
APPROVED
PLANNED
PROCUREMENT
NEW_ASSET_READY
MIGRATING
REPLACED
CANCELLED
```

## 3.5 Retirement / Disposal State

```text
ACTIVE
RETIREMENT_CANDIDATE
APPROVED_FOR_RETIREMENT
RETIRED
DATA_WIPE_PENDING
DATA_WIPED
DISPOSAL_PENDING
DISPOSED
SOLD
RETURNED_TO_VENDOR
RECYCLED
DESTROYED
```

Asset Lifecycle vẫn là state riêng:

```text
In Use
Repair
Returned
Retired
Disposed
```

Không dùng Maintenance State thay thế Lifecycle.

---

# 4. Maintenance Trigger Sources

Maintenance có thể được kích hoạt từ:

```text
User Incident
Monitoring Alert
Agent Health
Audit Finding
Preventive Schedule
Manual Inspection
Return Inspection
Warranty Recommendation
Problem / RCA
Manufacturer Advisory
Security Advisory
```

Ví dụ:

```text
Battery health < 60%
→ Maintenance Candidate
```

hoặc:

```text
Fan RPM anomaly
→ Diagnostic
→ Maintenance
```

---

# 5. WF-M01 — Create Maintenance Order

## Trigger

Một trong:

```text
INCIDENT.REPAIR_REQUIRED
ASSET.HEALTH_CRITICAL
ASSET.MAINTENANCE_DUE
RETURN.INSPECTION_FAILED
MANUAL.MAINTENANCE_REQUEST
```

## Preconditions

Tối thiểu:

```text
Asset
Reason
Requester/Source
Current location
Current lifecycle
```

## Context Enrichment

System tự lấy:

```text
Asset model
Serial
User
Location
Warranty
Open incidents
Recent incidents
Health history
Recent repairs
Repair cost history
Vendor contract
Spare part availability
Current loan device
```

---

# 6. Maintenance Decision Tree

```text
Maintenance Trigger
↓
Safety/Critical?
├─ YES → Take Asset Out of Service
└─ NO  → Continue Diagnosis
        ↓
Warranty valid?
├─ YES → Check claim eligibility
└─ NO  → Internal/Vendor repair
        ↓
Repair economically viable?
├─ YES → Repair
└─ NO  → Replacement Candidate
```

---

# 7. Take Asset Out of Service

Nếu rủi ro vận hành cao:

```text
Operational State = Maintenance
Lifecycle = Repair
Assignment may remain linked but unusable
```

Nếu user cần thiết bị thay thế:

```text
Temporary Loan Workflow
```

Không tự xóa owner assignment nếu chỉ đang sửa tạm thời.

---

# 8. WF-M02 — Diagnosis

Diagnosis phải structured.

```yaml
diagnosis:
  symptom:
  observed_behavior:
  monitoring_evidence:
  agent_evidence:
  physical_inspection:
  suspected_component:
  suspected_failure_mode:
  severity:
  recommended_action:
  confidence:
```

Possible result:

```text
NO_FAULT_FOUND
SOFTWARE_FIX
PART_REPLACEMENT
VENDOR_REPAIR
WARRANTY_CLAIM
REPLACEMENT_RECOMMENDED
```

---

# 9. Diagnostic Evidence

Có thể gồm:

```text
Monitoring graphs
Agent logs
SMART data
Battery health
Temperature
Error codes
Photos
Crash dumps
Vendor diagnostics
Technician notes
```

Evidence phải linked vào Maintenance Order.

---

# 10. WF-M03 — Preventive Maintenance

Preventive Maintenance có thể theo:

```text
time interval
usage hours
mileage/runtime
battery cycle count
vendor schedule
risk class
asset type
```

Ví dụ:

```text
UPS battery inspection every 6 months
Server fan inspection every 12 months
Printer maintenance every 50,000 pages
```

Flow:

```text
Schedule Due
↓
Create Maintenance Task
↓
Notify Operator
↓
Perform Checklist
↓
Record Measurements
↓
Pass / Fail
```

Nếu fail:

```text
Corrective Maintenance Order
```

---

# 11. Maintenance Plan Template

```yaml
maintenance_plan:
  asset_class:
  frequency:
  checklist:
  required_tools:
  required_parts:
  estimated_duration:
  downtime_required:
  skill_requirement:
  verification:
```

---

# 12. WF-W01 — Warranty Evaluation

Trước khi trả phí sửa chữa:

```text
Check Warranty
↓
Check Contract
↓
Check Coverage
↓
Check Exclusions
↓
Check Expiry
↓
Check Vendor SLA
```

System phải biết:

```text
warranty provider
start date
expiry date
coverage type
service level
claim process
contact
contract documents
```

---

# 13. Warranty Claim Eligibility

Ví dụ rule:

```text
Warranty valid
AND
failure covered
AND
no excluded damage
AND
claim period valid
```

Result:

```text
ELIGIBLE
NOT_ELIGIBLE
NEEDS_REVIEW
```

---

# 14. WF-W02 — Warranty Claim

Flow:

```text
Maintenance Order
↓
Warranty Eligible
↓
Create Claim
↓
Attach Evidence
↓
Submit Vendor
↓
Claim Open
↓
Vendor Response
```

Possible:

```text
APPROVED
REJECTED
MORE_INFO_REQUIRED
REPLACEMENT_OFFERED
REPAIR_OFFERED
```

---

# 15. Warranty Claim Record

```yaml
warranty_claim:
  id:
  asset_id:
  provider:
  contract:
  claim_number:
  failure:
  submitted_at:
  evidence:
  status:
  vendor_response:
  expected_completion:
  actual_completion:
```

---

# 16. Vendor Repair

Nếu gửi vendor:

```text
Prepare Asset
↓
Generate Vendor Handover
↓
Record Shipment
↓
Lifecycle = Repair
↓
Maintenance State = WAITING_VENDOR
↓
Track Vendor SLA
```

Khi trả về:

```text
Receive
↓
Inspect
↓
Verify Serial
↓
Verify Repair
↓
Technical Test
```

Không auto-complete khi vendor chỉ đánh dấu "done".

---

# 17. Vendor SLA

Track:

```text
time to acknowledge
time to quote
time to repair
time to return
```

Nếu breach:

```text
Vendor SLA Exception
→ Notify Asset Admin
→ Escalate Vendor
```

---

# 18. Spare Parts Model

Spare Part record:

```text
Part Number
Description
Compatible Models
Stock
Cost
Supplier
Warranty
```

Usage:

```text
Maintenance Order
→ Part Usage
→ Stock decrement
→ Cost record
```

---

# 19. WF-M04 — Waiting for Parts

State:

```text
Maintenance Order = WAITING_PART
```

System track:

```text
required part
quantity
source
ETA
cost
```

Nếu part unavailable quá lâu:

```text
Repair-vs-Replace re-evaluation
```

---

# 20. Repair Cost Model

Maintenance cost có thể gồm:

```text
labor
parts
vendor fee
shipping
diagnostic fee
downtime cost
temporary loan cost
```

Total:

```text
Total Repair Cost = Direct Cost + Optional Estimated Downtime Cost
```

Không bắt buộc dùng downtime cost trong kế toán, nhưng có thể dùng cho intelligence.

---

# 21. Lifetime Cost

Asset Intelligence có thể tính:

```text
Purchase Cost
+ Repair Cost
+ Maintenance Cost
+ License Cost
+ Support Contract Cost
```

để có:

```text
Total Cost of Ownership
```

---

# 22. Repair-vs-Replace Decision

Không nên chỉ dựa vào tuổi thiết bị.

Factors:

```text
asset age
health
repair cost
repair frequency
incident frequency
downtime
warranty
performance
replacement cost
business criticality
part availability
security/support status
```

---

# 23. Repair-vs-Replace Score

Ví dụ:

```text
Replacement Score 86/100
```

Phải explain được:

```text
Age > policy              +20
Warranty expired          +10
3 repairs / 12 months     +20
Repair cost > 40% value   +20
Vendor support ended      +16
```

Không dùng magic score.

---

# 24. Decision Rules Example

```text
Repair Cost < 20% replacement value
AND incidents low
AND support valid
→ REPAIR
```

```text
Repair Cost > 50% replacement value
OR unsupported OS/hardware
OR repeated failures
→ REPLACE
```

Policy phải configurable.

---

# 25. WF-M05 — Execute Repair

Flow:

```text
Diagnosis Complete
↓
Approval if required
↓
Reserve Parts
↓
Assign Technician/Vendor
↓
Perform Repair
↓
Record Work
↓
Record Parts
↓
Record Cost
↓
Technical Verification
```

---

# 26. Repair Verification

Không hoàn tất chỉ vì technician bấm "done".

Verification có thể gồm:

```text
hardware test
agent health
monitoring health
performance test
burn-in
network connectivity
application check
user acceptance
```

Result:

```text
PASS
FAIL
CONDITIONAL_PASS
```

---

# 27. Repair → Available

Dùng khi asset chưa trả lại user ngay.

```text
Lifecycle = Available
Assignment = Unassigned
Location = Storage
Operational = Offline/Unknown until provisioned
```

---

# 28. Repair → In Use

Dùng khi trả lại user cũ.

```text
Lifecycle = In Use
Assignment = Restored
Owner = Previous User
Location = User Location
Operational = Online after verification
```

---

# 29. Loan Device During Repair

Nếu user cần thiết bị tạm:

```text
Maintenance Order
↓
Check Loan Pool
↓
Temporary Assignment
↓
Handover Loan
```

Khi thiết bị gốc sửa xong:

```text
Return Original
↓
Recover Loan Asset
↓
Close Temporary Assignment
```

---

# 30. Maintenance Documents

Có thể gồm:

```text
Maintenance Order
Diagnostic Report
Repair Report
Vendor Handover
Quotation
Approval
Part Usage
Invoice
Receipt
Warranty Claim
Technical Verification
```

---

# 31. WF-R01 — Replacement Candidate

Trigger:

```text
Repair-vs-Replace = REPLACE
Warranty expiring
Asset age threshold
Unsupported OS/hardware
Security requirement
Performance below baseline
Repeated incidents
High TCO
```

State:

```text
Replacement = CANDIDATE
```

---

# 32. Replacement Candidate Context

```text
Asset
User
Service criticality
Age
Health
Warranty
Incident history
Repair history
Repair cost
Replacement cost estimate
Business impact
Recommended replacement class
```

---

# 33. WF-R02 — Replacement Review

Decision:

```text
APPROVE_REPLACEMENT
CONTINUE_USE
REPAIR_FIRST
EXTEND_WARRANTY
DEFER
```

Nếu defer:

```text
reason
review_date
risk acceptance
approver
```

---

# 34. Replacement Plan

```yaml
replacement_plan:
  old_asset:
  target_user:
  replacement_reason:
  target_model/profile:
  budget:
  procurement_required:
  migration_required:
  target_date:
  approver:
  status:
```

---

# 35. Replacement Workflow

```text
Replacement Approved
↓
Check Available Stock
├─ Available
│   ↓
│ Reserve Replacement
└─ Not Available
    ↓
    Procurement
       ↓
Receive New Asset
↓
Prepare
↓
Migrate
↓
Assign New Asset
↓
Return Old Asset
↓
Retire Old Asset
```

---

# 36. Migration Plan

Có thể gồm:

```text
user files
profile
applications
browser data
certificates
VPN config
business application data
encryption keys
```

Security-sensitive items phải theo policy.

---

# 37. Migration Verification

Before cutover:

```text
new device prepared
agent enrolled
required software installed
licenses assigned
user data restored
network access verified
```

After cutover:

```text
user login success
business apps work
VPN works
old device no longer primary
```

---

# 38. Replacement Assignment

New Asset:

```text
Lifecycle = In Use
Assignment = Assigned
Owner = User
```

Old Asset:

```text
Assignment = Pending Return
```

Không mark old asset Retired trước khi physically returned nếu vẫn đang nằm ở user.

---

# 39. WF-RT01 — Retirement Candidate

Trigger:

```text
Replacement completed
End of support
Policy age limit
Unrepairable damage
Security non-compliance
No longer required
```

State:

```text
RETIREMENT_CANDIDATE
```

---

# 40. Retirement Review

Check:

```text
active user assignment?
active loan?
active license?
open incident?
open maintenance?
legal hold?
data retention requirement?
financial depreciation?
```

Không retire nếu còn blocking dependency chưa xử lý.

---

# 41. Retirement Approval

Possible approval based on:

```text
asset value
asset class
data sensitivity
department
finance policy
```

After approval:

```text
Lifecycle = Retired
```

Retired chưa có nghĩa Disposed.

---

# 42. License and Access Reclamation

Trước disposal:

```text
Reclaim software licenses
Remove MDM enrollment
Remove certificates
Remove VPN identity
Remove monitoring
Remove network reservation
Remove privileged access
```

Events:

```text
LICENSE.RECLAIMED
AGENT.RETIRED
ACCESS.REVOKED
```

---

# 43. WF-D01 — Data Wipe

Data-bearing assets bắt buộc qua:

```text
Data Classification Check
↓
Select Wipe Method
↓
Execute
↓
Verify
↓
Record Evidence
```

Không áp dụng giống nhau cho mọi asset.

---

# 44. Data Wipe Methods

Có thể gồm:

```text
Crypto erase
Secure erase
Vendor secure wipe
Factory reset
Physical destruction
```

Method phụ thuộc:

```text
storage type
data classification
security policy
disposal method
```

---

# 45. Data Wipe Job

```yaml
data_wipe:
  id:
  asset:
  method:
  operator:
  started_at:
  completed_at:
  verification:
  evidence:
  result:
```

Results:

```text
PASS
FAIL
NOT_APPLICABLE
PHYSICAL_DESTRUCTION_REQUIRED
```

---

# 46. Failed Data Wipe

Nếu wipe fail:

```text
Do NOT release asset for sale/reuse
```

Flow:

```text
Wipe Failed
↓
Retry approved method
↓
Alternative method
↓
Physical destruction if required
```

---

# 47. Data Wipe Evidence

Có thể lưu:

```text
tool report
certificate
hash/log
operator identity
photos
vendor destruction certificate
```

---

# 48. WF-D02 — Disposal Decision

Sau retirement + wipe:

Possible methods:

```text
REUSE_INTERNAL
SELL
RECYCLE
RETURN_VENDOR
DONATE
DESTROY
```

Decision dựa trên:

```text
condition
residual value
policy
data sensitivity
environmental policy
vendor program
```

---

# 49. Internal Reuse

Nếu còn dùng được:

```text
Retired Candidate
↓
Recondition
↓
Reclassify
↓
Available
```

Nếu reuse được approve, Asset có thể quay lại lifecycle `Available`.

Audit phải giữ lịch sử retirement review trước đó.

---

# 50. Sale

Flow:

```text
Approved for Sale
↓
Data Wipe PASS
↓
Valuation
↓
Buyer
↓
Sale Approval
↓
Invoice/Receipt
↓
Physical Handover
↓
Lifecycle = Disposed
Disposal Method = SOLD
```

---

# 51. Recycling

```text
Approved Recycler
↓
Handover
↓
Weight/Quantity Record
↓
Recycler Certificate
↓
Lifecycle = Disposed
Disposal Method = RECYCLED
```

---

# 52. Return to Vendor

```text
Vendor Return Authorization
↓
Prepare Shipment
↓
Handover
↓
Vendor Confirmation
↓
Lifecycle = Disposed/Returned to Vendor
```

---

# 53. Physical Destruction

Dùng khi policy yêu cầu:

```text
Storage/device physically destroyed
↓
Evidence
↓
Witness if required
↓
Destruction Certificate
```

---

# 54. Disposal Documents

Có thể gồm:

```text
Retirement Approval
Data Wipe Certificate
Biên bản thanh lý
Sales Invoice
Receipt
Buyer Handover
Recycler Certificate
Vendor Return
Destruction Certificate
Photo Evidence
```

---

# 55. Final Disposal State

Chỉ khi:

```text
retirement approved
AND required data wipe completed
AND licenses/access reclaimed
AND physical disposition confirmed
```

thì:

```text
Lifecycle = Disposed
```

---

# 56. Asset Record After Disposal

Không xóa Asset record.

Record vẫn giữ:

```text
identity
purchase history
assignment history
maintenance history
cost
documents
warranty
disposal method
disposal date
audit trail
```

Nhưng:

```text
active inventory = false
assignable = false
monitorable = false
```

---

# 57. WF-W03 — Warranty Expiry Watch

Scheduled check:

```text
90 days
60 days
30 days
7 days
```

Context:

```text
Age
Health
Repair history
Replacement score
Business criticality
Contract
```

Decision:

```text
Renew Warranty
Replace
Accept Risk
No Action
```

---

# 58. Warranty Renewal

Flow:

```text
Warranty Expiring
↓
Request Quote
↓
Compare Cost vs Replacement
↓
Approval
↓
Renew Contract
↓
Update Warranty Dates
```

---

# 59. Contract Integration

Maintenance/warranty may depend on:

```text
vendor contract
SLA
coverage
included parts
included labor
on-site service
replacement entitlement
```

Service Contract breach should create:

```text
Vendor Performance Exception
```

---

# 60. Scheduled Maintenance Calendar

System should support:

```text
daily
weekly
monthly
quarterly
annual
usage-based
```

Calendar must consider:

```text
maintenance windows
business hours
critical periods
change freezes
user availability
```

---

# 61. Maintenance Conflict Detection

Before scheduling:

```text
active Change?
major business event?
user already has critical ticket?
asset in transfer?
asset in audit?
```

If conflict:

```text
reschedule or approve exception
```

---

# 62. Cost Approval

Approval thresholds configurable.

Ví dụ:

```text
< 2M VND → Helpdesk Lead
2M–10M → IT Manager
>10M → Finance + IT Manager
```

Do not hardcode currency or thresholds.

---

# 63. Quote Comparison

Nếu external repair:

```text
Vendor A quote
Vendor B quote
Replacement estimate
```

System có thể compare:

```text
cost
ETA
warranty
vendor score
repair history
```

---

# 64. Vendor Performance Metrics

Track:

```text
SLA compliance
average repair time
repeat repair rate
claim rejection rate
cost variance
return quality
```

---

# 65. Maintenance Repeat Detection

Nếu cùng failure lặp lại:

```text
same asset
same component
same symptom
within threshold
```

Actions:

```text
flag repeat repair
create Problem Candidate
re-evaluate replacement
vendor quality review
```

---

# 66. Problem Integration

Example:

```text
12 laptops same battery swelling issue
↓
Maintenance data correlates
↓
Problem Candidate
↓
RCA
↓
Vendor/manufacturer issue
↓
Change / Recall / Replacement Campaign
```

---

# 67. Recall Campaign

Có thể tạo bulk campaign:

```text
Affected Model
↓
Find all assets
↓
Notify users
↓
Schedule return
↓
Repair/Replace
↓
Verify completion
```

---

# 68. Bulk Maintenance

Support:

```text
bulk preventive maintenance
bulk firmware update
bulk recall
bulk warranty claim
bulk replacement
```

Mỗi Asset vẫn có audit trail riêng.

---

# 69. Replacement Campaign

Ví dụ:

```text
Windows 10 unsupported hardware
↓
Find 180 devices
↓
Prioritize by risk
↓
Wave 1: 30 devices
↓
Wave 2: 50 devices
↓
Wave 3: 100 devices
```

Track:

```text
planned
ready
migrated
returned
retired
disposed
```

---

# 70. Generated Events

## Maintenance

```text
MAINTENANCE.CREATED
MAINTENANCE.DIAGNOSIS_STARTED
MAINTENANCE.DIAGNOSIS_COMPLETED
MAINTENANCE.WAITING_PART
MAINTENANCE.WAITING_VENDOR
MAINTENANCE.REPAIR_STARTED
MAINTENANCE.VERIFICATION_STARTED
MAINTENANCE.COMPLETED
MAINTENANCE.FAILED
MAINTENANCE.REPEAT_DETECTED
```

## Warranty

```text
WARRANTY.EXPIRING
WARRANTY.EXPIRED
WARRANTY.CLAIM_CREATED
WARRANTY.CLAIM_APPROVED
WARRANTY.CLAIM_REJECTED
WARRANTY.RENEWED
```

## Replacement

```text
REPLACEMENT.CANDIDATE_CREATED
REPLACEMENT.APPROVED
REPLACEMENT.PLAN_CREATED
REPLACEMENT.NEW_ASSET_READY
REPLACEMENT.MIGRATION_STARTED
REPLACEMENT.COMPLETED
```

## Retirement / Disposal

```text
RETIREMENT.CANDIDATE_CREATED
RETIREMENT.APPROVED
ASSET.RETIRED
DATA_WIPE.STARTED
DATA_WIPE.COMPLETED
DATA_WIPE.FAILED
DISPOSAL.APPROVED
DISPOSAL.COMPLETED
ASSET.DISPOSED
```

---

# 71. Downstream Workflow Mapping

```text
Maintenance needs part
→ Procurement / Inventory

Warranty claim rejected
→ Repair-vs-Replace

Repair repeated
→ Problem Management

Replacement approved
→ Warehouse / Procurement / Assignment

Old Asset returned
→ Return Workflow

Retirement approved
→ Data Wipe

Sale/Recycle
→ Finance / Documents

Vendor SLA breached
→ Vendor / Contract Management
```

---

# 72. Permission Model

## Helpdesk

```text
create maintenance request
perform basic diagnosis
assign loan device
close low-risk repair after verification
```

## Technician

```text
diagnose
repair
record parts
perform verification
```

## Asset Admin

```text
approve lifecycle transition
manage warranty
replacement candidate
retirement candidate
```

## IT Manager

```text
approve high-cost repair
approve replacement
approve retirement
```

## Finance/Procurement

```text
approve budget
validate invoices
manage sale/disposal finance
```

## Security

```text
approve wipe method
verify sensitive disposal
```

---

# 73. Notification Rules

## Maintenance

Notify:

```text
user when device taken for repair
user when loan available
user when repair complete
operator when part/vendor overdue
```

## Warranty

Notify:

```text
expiring threshold
claim response
claim SLA breach
```

## Replacement

Notify:

```text
approval required
new asset ready
migration scheduled
return old asset due
```

## Disposal

Notify only relevant operators/approvers.

Không notify end user về low-level wipe/disposal steps trừ khi policy cần.

---

# 74. SLA / Timers

Có thể track:

```text
Diagnosis SLA
Repair SLA
Vendor SLA
Part ETA
Warranty claim SLA
Replacement completion target
Data wipe SLA
Disposal completion SLA
```

---

# 75. Unified Asset Timeline

Ví dụ:

```text
01/09 09:10 HEALTH
Battery health dropped to 54%

01/09 09:12 MAINTENANCE
MT-2042 created

01/09 10:00 DIAGNOSIS
Battery replacement recommended

01/09 10:05 WARRANTY
Warranty valid until 30/11

01/09 10:20 CLAIM
WC-182 submitted

03/09 14:10 VENDOR
Claim approved

05/09 11:00 REPAIR
Battery replaced

05/09 11:45 VERIFY
Health restored to 96%

05/09 12:00 MAINTENANCE
MT-2042 completed
```

---

# 76. End-to-End Example — Warranty Repair

```text
Laptop battery health 48%
↓
Health Alert
↓
Maintenance Order
↓
Diagnosis confirms battery degradation
↓
Warranty valid
↓
Warranty Claim
↓
Vendor approves
↓
Loan laptop assigned
↓
Original sent to vendor
↓
Battery replaced
↓
Device returned
↓
Technical verification PASS
↓
Original returned to user
↓
Loan recovered
↓
Maintenance closed
↓
Timeline + cost + warranty updated
```

---

# 77. End-to-End Example — Repair vs Replace

```text
4-year-old laptop
↓
3 repairs in 8 months
↓
Current motherboard repair quote = 12M
↓
Replacement estimate = 22M
↓
Warranty expired
↓
Performance below baseline
↓
Replacement Score = 91/100
↓
Replacement Candidate
↓
Manager approves
↓
New asset reserved
↓
Migration
↓
New asset assigned
↓
Old asset returned
↓
Retired
↓
Data wipe PASS
↓
Sold
↓
Lifecycle = Disposed
```

---

# 78. End-to-End Example — Preventive Maintenance

```text
UPS inspection due
↓
Preventive Task created
↓
Technician checks battery
↓
Capacity below threshold
↓
Corrective Maintenance created
↓
Part reserved
↓
Battery replaced
↓
Load test PASS
↓
Next maintenance date scheduled
```

---

# 79. End-to-End Example — Failed Data Wipe

```text
Retired SSD laptop
↓
Secure erase fails
↓
Data Wipe = FAILED
↓
Asset blocked from sale
↓
Alternative crypto erase unavailable
↓
Security approves physical destruction
↓
Drive destroyed
↓
Destruction certificate attached
↓
Disposal completed
```

---

# 80. Metrics / KPI

## Maintenance

```text
MTTR
Repair Success Rate
Repeat Repair Rate
Preventive Maintenance Compliance
Maintenance Backlog
Downtime
```

## Warranty

```text
Warranty Claim Approval Rate
Average Claim Resolution Time
Warranty Savings
Expired Warranty Exposure
```

## Cost

```text
Repair Cost per Asset
Lifetime Maintenance Cost
TCO
Cost per Asset Class
Repair vs Replacement Ratio
```

## Replacement

```text
Replacement Candidate Count
Replacement Lead Time
Deferred High-Risk Assets
Migration Success Rate
```

## Disposal

```text
Retired Asset Aging
Data Wipe Success Rate
Disposal Lead Time
Residual Value Recovered
Recycler/Vendor Compliance
```

---

# 81. Idempotency

Examples:

```text
maintenance:{asset_id}:{source_event_id}
warranty_claim:{asset_id}:{failure_signature}
replacement:{asset_id}:{plan_version}
data_wipe:{asset_id}:{wipe_generation}
disposal:{asset_id}:{retirement_version}
```

Retry không được tạo duplicate:

```text
Maintenance Order
Warranty Claim
Replacement Plan
Data Wipe Certificate
Disposal Record
```

---

# 82. Guardrails

Hệ thống không được:

1. Đóng Maintenance trước technical verification.
2. Tự coi asset là Available khi vẫn Waiting Vendor/Part.
3. Thanh toán repair trước khi kiểm tra Warranty nếu policy yêu cầu.
4. Mark Warranty Claim complete chỉ vì vendor đã nhận thiết bị.
5. Đưa asset Critical Health trở lại In Use mà không verify.
6. Retire asset khi còn active assignment mà không xử lý.
7. Dispose asset trước Data Wipe nếu asset có dữ liệu và policy yêu cầu.
8. Xóa Asset record sau disposal.
9. Reuse/sell asset khi wipe thất bại.
10. Reclaim license mà không giữ lịch sử assignment.
11. Dùng Replacement Score mà không giải thích yếu tố.
12. Mark old asset Retired trước khi user trả thiết bị nếu thiết bị vẫn ở ngoài tổ chức.
13. Bỏ qua repeat repair correlation.
14. Cho operator sửa cost history trực tiếp mà không audit.
15. Cho disposal method thay đổi sau hoàn tất mà không correction workflow.

---

# 83. Definition of Done

Cụm workflow này đạt yêu cầu khi:

- Maintenance có trigger từ Incident, Monitoring, Audit và Schedule.
- Diagnosis có evidence và structured result.
- Preventive Maintenance có plan + schedule + checklist.
- Warranty được kiểm tra trước repair charge theo policy.
- Warranty Claim có state và vendor SLA.
- Vendor repair có send/receive/verify.
- Spare part usage cập nhật inventory và cost.
- Repair cost/TCO được lưu.
- Repair-vs-Replace có explainable scoring.
- Repair hoàn tất phải qua verification.
- Loan asset liên kết Maintenance.
- Replacement có candidate → approval → plan → migration → return old asset.
- Old asset không Retired trước khi thực tế thu hồi nếu policy yêu cầu.
- Retirement có blocking checks.
- License/access được reclaim trước disposal.
- Data Wipe có method, verification và evidence.
- Failed wipe block sale/reuse.
- Disposal có nhiều phương thức và chứng từ.
- Asset record vẫn tồn tại sau disposal.
- Unified Timeline phản ánh toàn bộ maintenance/warranty/replacement/disposal history.
- Tất cả workflow có permissions, notifications, timers, idempotency và audit trail.
