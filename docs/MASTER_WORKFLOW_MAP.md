# MASTER WORKFLOW MAP
## IT Operations Hub — AssetOps / Helpdesk / Monitoring / Network / Software / License

**Version:** 0.1  
**Status:** Foundation Draft  
**Purpose:** Chuẩn hóa toàn bộ sự kiện, workflow, state transition, automation, notification, document và audit trail của hệ thống.

# 1. Mục tiêu tài liệu

Tài liệu này là nguồn tham chiếu trung tâm cho toàn bộ luồng nghiệp vụ của hệ thống.

Mỗi workflow phải trả lời được:
1. Sự kiện nào kích hoạt?
2. Entity nào liên quan?
3. Hệ thống tự thu thập context gì?
4. Rule nào được đánh giá?
5. Automation nào chạy trước?
6. Khi nào cần người vận hành?
7. State nào thay đổi?
8. Ticket/Incident/Problem/Change nào được tạo hoặc liên kết?
9. Notification nào được gửi?
10. Document nào được sinh?
11. Audit trail nào được ghi?
12. Điều kiện kết thúc workflow là gì?

# 2. Nguyên tắc vận hành chung

## 2.1 Work-first, không Module-first

Người vận hành không cần suy nghĩ "Tôi phải vào module nào?". Hệ thống phải đưa đúng context và action đến nơi công việc xuất hiện.

```text
Signal / Request
      ↓
Identify
      ↓
Enrich Context
      ↓
Correlate
      ↓
Evaluate Rules
      ↓
Auto Remediation?
   ┌──┴──┐
  Yes    No
   ↓      ↓
Verify  Work Queue
   ↓      ↓
Update  Human Action
   └──┬───┘
      ↓
Update States
      ↓
Notify
      ↓
Audit Trail
      ↓
Close / Escalate
```

# 3. Core Entities

```text
USER
ASSET
SERVICE
LOCATION
SITE
BUILDING
FLOOR
ROOM
RACK
NETWORK
SUBNET
VLAN
SWITCH
PORT
AGENT
MONITORING EVENT
HEALTH SIGNAL
TICKET
REQUEST
INCIDENT
PROBLEM
CHANGE
MAINTENANCE ORDER
AUDIT
AUDIT EXCEPTION
SOFTWARE
SOFTWARE ARTIFACT
LICENSE
LICENSE ENTITLEMENT
INSTALLATION
SUPPLIER
PURCHASE ORDER
INVOICE
RECEIPT
GOODS RECEIPT
ASSIGNMENT
MOVEMENT
WARRANTY
CONTRACT
REPLACEMENT PLAN
DISPOSAL RECORD
DOCUMENT
NOTIFICATION
AUDIT TRAIL
```

# 4. State Model chuẩn

## 4.1 Asset Lifecycle

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

## 4.2 Operational State

```text
Online
Offline
Unavailable
Maintenance
Unknown
```

## 4.3 Health State

```text
Healthy
Warning
Critical
Unknown
```

## 4.4 Assignment State

```text
Unassigned
Reserved
Assigned
Pending Return
In Transit
Temporary Loan
```

## 4.5 Warranty State

```text
Valid
Expiring
Expired
Unknown
```

## 4.6 Compliance State

```text
Compliant
Exception
Non-Compliant
Unknown
```

## 4.7 Risk State

```text
Low
Medium
High
Critical
```

# 5. Workflow Template

```markdown
## WF-XXX — Workflow Name

### Trigger
...

### Entities
...

### Context Enrichment
...

### Rules
...

### Automation
...

### Human Action
...

### State Changes
...

### Related ITSM Records
...

### Notifications
...

### Documents
...

### Audit Trail
...

### Completion Condition
...

### Escalation
...
```

# 6. Event Taxonomy

## 6.1 Identity Events

```text
USER.CREATED
USER.UPDATED
USER.DEPARTMENT_CHANGED
USER.LOCATION_CHANGED
USER.DISABLED
USER.TERMINATED
USER.ROLE_CHANGED
SSO.LOGIN_FAILED
SSO.PROVIDER_UNAVAILABLE
SYNC.USER_FAILED
```

## 6.2 Asset Events

```text
ASSET.PURCHASED
ASSET.RECEIVED
ASSET.CREATED
ASSET.ASSIGNED
ASSET.TRANSFERRED
ASSET.RETURN_REQUESTED
ASSET.RETURNED
ASSET.REPAIR_STARTED
ASSET.REPAIR_COMPLETED
ASSET.RETIRED
ASSET.DISPOSED
ASSET.LOCATION_CHANGED
ASSET.OWNER_CHANGED
ASSET.WARRANTY_EXPIRING
ASSET.WARRANTY_EXPIRED
ASSET.UNKNOWN_DISCOVERED
```

## 6.3 Agent Events

```text
AGENT.ENROLLED
AGENT.ONLINE
AGENT.OFFLINE
AGENT.OFFLINE_THRESHOLD
AGENT.HEARTBEAT_FAILED
AGENT.INVENTORY_CHANGED
AGENT.SOFTWARE_DETECTED
AGENT.SOFTWARE_REMOVED
AGENT.DEPLOYMENT_FAILED
AGENT.UPDATE_REQUIRED
```

## 6.4 Monitoring Events

```text
MONITORING.WARNING
MONITORING.CRITICAL
MONITORING.RECOVERED
MONITORING.SERVICE_DOWN
MONITORING.SERVICE_RECOVERED
MONITORING.MULTI_ASSET_CORRELATED
```

## 6.5 Helpdesk / ITSM Events

```text
TICKET.CREATED
TICKET.UPDATED
TICKET.ASSIGNED
TICKET.SLA_WARNING
TICKET.SLA_BREACHED
TICKET.RESOLVED
TICKET.REOPENED
INCIDENT.CREATED
INCIDENT.CORRELATED
INCIDENT.ROOT_CREATED
INCIDENT.RESOLVED
PROBLEM.CREATED
PROBLEM.RCA_COMPLETED
CHANGE.REQUESTED
CHANGE.APPROVED
CHANGE.IMPLEMENTED
CHANGE.FAILED
CHANGE.ROLLED_BACK
```

## 6.6 Audit Events

```text
AUDIT.STARTED
AUDIT.ASSET_VERIFIED
AUDIT.LOCATION_MISMATCH
AUDIT.OWNER_MISMATCH
AUDIT.ASSET_MISSING
AUDIT.UNKNOWN_ASSET
AUDIT.DATA_MISMATCH
AUDIT.EXCEPTION_RESOLVED
AUDIT.COMPLETED
```

## 6.7 Network Events

```text
NETWORK.DEVICE_DISCOVERED
NETWORK.UNKNOWN_DEVICE
NETWORK.IP_CHANGED
NETWORK.MAC_CHANGED
NETWORK.VLAN_MISMATCH
NETWORK.PORT_CHANGED
NETWORK.DEVICE_OFFLINE
NETWORK.TOPOLOGY_CHANGED
```

## 6.8 Software / License Events

```text
SOFTWARE.APPROVED
SOFTWARE.UNAUTHORIZED_DETECTED
SOFTWARE.INSTALL_REQUESTED
SOFTWARE.INSTALLED
SOFTWARE.INSTALL_FAILED
SOFTWARE.REMOVED
ARTIFACT.UPLOADED
ARTIFACT.SCAN_PASSED
ARTIFACT.SCAN_FAILED
ARTIFACT.APPROVED
LICENSE.ASSIGNED
LICENSE.RECLAIMED
LICENSE.OVERUSED
LICENSE.UNDERUSED
LICENSE.EXPIRING
LICENSE.EXPIRED
```

## 6.9 Finance / Procurement Events

```text
PO.CREATED
PO.APPROVED
GOODS_RECEIPT.POSTED
INVOICE.SUBMITTED
INVOICE.MATCHED
INVOICE.PENDING_RECEIPT
INVOICE.MISMATCHED
INVOICE.APPROVED
CREDIT_NOTE.APPLIED
RECEIPT.UPLOADED
PAYMENT.RECORDED
```

# 7. MASTER WORKFLOW MAP — Priority Workflows

## WF-001 — User Login via SSO

### Trigger
User opens application.

### Entities
User, Identity Provider, Role, Department, Permission.

### Context Enrichment
- User identity
- Department
- Manager
- Location
- RBAC role
- Assigned assets
- Open tickets
- Pending approvals

### Rules
- Account active?
- SSO provider available?
- User has required role?
- Session valid?

### Automation
```text
SSO Authentication
→ User Sync
→ Role Resolution
→ Permission Resolution
→ Personalized Dashboard
```

### Audit Trail
User, Timestamp, Provider, Authentication result, Source IP, Session ID.

### Completion Condition
User truy cập thành công theo đúng quyền.

---

## WF-002 — User Reports an Incident

### Trigger
User gửi yêu cầu qua Portal, Email, Teams, Slack, Mobile hoặc API.

### Entities
User, Asset, Service, Ticket, Incident, Agent, Monitoring, Location, Network.

### Context Enrichment
```text
User identity
Assigned Asset
Department
Location
Service
Agent status
Health state
IP/MAC
VLAN
Recent incidents
Current monitoring alerts
Known outage
Warranty
```

### Rules
1. Có incident đang tồn tại cho cùng service/location không?
2. Có monitoring event liên quan không?
3. Có known issue/knowledge article không?
4. Có thể auto-remediate không?
5. Priority dựa trên impact + urgency.

### Automation
```text
Request
↓
Identify User
↓
Identify Asset
↓
Identify Service
↓
Correlate Monitoring
↓
Check Known Incident
```

Nếu Root Incident tồn tại:
```text
Link Ticket → Root Incident
```

Nếu không:
```text
Run diagnostic
↓
Auto remediation if safe
```

### Human Action
Nếu automation thất bại → Create Helpdesk Work Item.

### State Changes
Có thể cập nhật Ticket status, Incident status, Asset Health, Operational state.

### Notifications
Ticket created, Assigned, Waiting for user, Resolved, Reopened.

### Completion Condition
User xác nhận ổn hoặc ticket auto-close theo policy.

---

## WF-003 — Monitoring Critical Event

### Trigger
```text
MONITORING.CRITICAL
```

### Context Enrichment
- Asset
- Service dependency
- Site/location
- Related events
- Existing incidents
- Recent changes
- Maintenance window

### Rules
```text
Is maintenance window?
Is duplicate event?
Is parent dependency already down?
How many assets/services/users affected?
```

### Automation
```text
Event
↓
Correlation
↓
Dependency Analysis
↓
Existing Incident?
```

Nếu có → Attach Event.  
Nếu không → Auto remediation? → Execute → Verify hoặc Create Incident.

### State Changes
```text
Asset Health → Critical
Operational → Offline/Degraded if applicable
Incident → Open
```

### Completion Condition
Monitoring recovered và service verification thành công.

---

## WF-004 — Agent Offline Threshold

### Trigger
```text
AGENT.OFFLINE_THRESHOLD
```

Ví dụ Offline >48h.

### Context Enrichment
- Last heartbeat
- Asset operational state
- User activity
- Network reachability
- Device ping
- Open incident

### Rules
```text
Device intentionally offline?
Asset in storage?
Asset retired?
Maintenance?
Network outage?
```

### Automation
Nếu máy reachable:
```text
Restart Agent Service
↓
Verify heartbeat
```

Nếu không reachable:
```text
Network test
↓
Correlate site/network incident
```

### State Changes
```text
Health → Warning
Agent status → Offline
```

### Completion Condition
Agent heartbeat restored hoặc trạng thái offline được xác nhận hợp lệ.

---

## WF-005 — Receive New Assets into Warehouse

### Trigger
```text
GOODS_RECEIPT.POSTED
```

### Entities
Purchase Order, Supplier, Invoice, Goods Receipt, Asset, Warehouse, Warranty, Document.

### Workflow
```text
PO
↓
Goods Arrival
↓
Scan/Import Serial
↓
Validate Quantity
↓
Post immutable Goods Receipt + PO accepted progress + audit/outbox
↓
Asynchronous Asset-owned registration by received_unit_id
↓
Lifecycle = RECEIVED; Assignment = UNASSIGNED; Location = receiving warehouse
↓
Asset validation/put-away → AVAILABLE
```

### Rules
Quantity mismatch, Unknown serial, Duplicate serial, Missing invoice, Damaged item.

### State Changes
```text
Lifecycle = RECEIVED until validated/put away
Assignment = Unassigned
Location = Warehouse
Warranty = Valid/Unknown
```

### Documents
Purchase Order, Goods Receipt, Invoice, Delivery Note, Asset Labels.

### Completion Condition
Số lượng thực tế khớp và asset records hoàn chỉnh.

---

## WF-006 — Assign Asset to User

### Trigger
Approved Asset Request hoặc Manual Assignment.

### Workflow
```text
Select User
↓
Reserve Asset
↓
Prepare Device
↓
Install Approved Software
↓
Verify Agent
↓
Generate Handover Document
↓
User Confirmation
↓
Complete Assignment
```

### State Changes
```text
Lifecycle = In Use
Assignment = Assigned
Owner/User = target user
Location = user location
```

### Documents
Biên bản bàn giao, Asset handover acknowledgment.

### Completion Condition
User xác nhận nhận thiết bị.

---

## WF-007 — Transfer Asset

### Workflow
```text
Current Asset
↓
Select New User/Location
↓
Preview Current → After
↓
Confirm
↓
Update Asset
↓
Create Movement
↓
Update Assignment
↓
Audit Trail
↓
Notification
```

### State Changes
Ví dụ:
```text
Owner A → Owner B
Location Hanoi → HCM
Assignment Assigned → In Transit → Assigned
```

### Completion Condition
Người nhận xác nhận hoặc operator hoàn tất theo policy.

---

## WF-008 — Return Asset

### Trigger
Return request, User termination, Device replacement hoặc Manual recall.

### Workflow
```text
Return Task
↓
User Notification
↓
Receive Asset
↓
QR Scan
↓
Condition Inspection
```

Decision:
```text
Good → Available
Repair needed → Repair
End of Life → Retired
```

### State Changes
```text
Assignment = Unassigned
Owner = None
Location = Warehouse/Repair
Lifecycle = Available/Repair/Retired
```

### Documents
Biên bản thu hồi, Condition report.

---

## WF-009 — Maintenance / Repair

### Trigger
Incident, Monitoring, Audit, Preventive Maintenance hoặc Manual Inspection.

### Workflow
```text
Problem
↓
Maintenance Order
↓
Lifecycle = Repair
↓
Technician/Vendor
↓
Repair Work
↓
Parts + Cost
↓
Invoice/Receipt
↓
Technical Verification
↓
Health Recalculation
↓
Return to Available or In Use
```

### State Changes

Repair → Available:
```text
Lifecycle = Available
Assignment = Unassigned
Location = Storage
```

Repair → In Use:
```text
Lifecycle = In Use
Assignment = Restored
Owner = Previous User
Location = Previous/User Location
```

### Documents
Maintenance order, Vendor receipt, Invoice, Repair report, Technical checklist.

### Completion Condition
Verification pass và asset health đạt mức cho phép.

---

## WF-010 — Asset Audit / Inventory Check

### Trigger
```text
AUDIT.STARTED
```

### Sources
QR Scan, Agent Inventory, Network Discovery, Manual Verification.

### Workflow
```text
Expected Inventory
↓
Actual Observation
↓
Compare
```

Possible results:
```text
Verified
Location Mismatch
Owner Mismatch
Missing
Unknown Asset
Data Mismatch
```

Ví dụ sai vị trí:
```text
Expected Floor 4
Actual Floor 2
↓
Operator chooses:
- Update Location
- Request Return
- Investigate
```

Nếu Update Location:
```text
Asset Location updated
Movement created
Audit Exception resolved
Timeline updated
Audit Trail written
```

### Completion Condition
Tất cả exception được resolved/accepted.

---

## WF-011 — Network Discovery

### Trigger
Scheduled Scan, Manual Scan, SNMP Discovery hoặc Agent Detection.

### Workflow
```text
Subnet/VLAN
↓
Discover Device
↓
Collect IP/MAC/Hostname/Vendor/Switch/Port/VLAN
↓
Match Asset?
```

Nếu match → Update Network Context.  
Nếu không:
```text
Unknown Device
↓
Identify / Create Asset / Block / Ignore
```

### Rules
Unknown device, Unexpected VLAN, Port movement, MAC change, Duplicate IP.

---

## WF-012 — VLAN Mismatch

### Trigger
```text
NETWORK.VLAN_MISMATCH
```

### Workflow
```text
Detect
↓
Check approved network policy
↓
Check recent Change
↓
Explain mismatch
```

### Actions
```text
Change VLAN
Approve Exception
Create Change Request
Investigate
```

Nếu thay đổi có rủi ro:
```text
Change Request
↓
Approval
↓
Implementation
↓
Verification
↓
Close
```

---

## WF-013 — Unauthorized Software Detection

### Trigger
Agent phát hiện software không thuộc Approved Catalog.

### Workflow
```text
Detected Software
↓
Compare Software Catalog
↓
Unauthorized
↓
Compliance Exception
```

### Actions
Remove Automatically, Request Approval, Create Exception, Ignore by Policy.

Nếu Remove:
```text
Agent Uninstall
↓
Verify
↓
Compliance Restored
↓
Timeline Updated
```

---

## WF-014 — Software Installation Request

### Workflow
```text
Request Software
↓
Check Approved Catalog
↓
Check License
↓
Approval if required
↓
Reserve License
↓
Deploy Artifact
↓
Agent Install
↓
Verify
↓
Assign License
↓
Close Request
```

### Failure
Nếu install lỗi → Retry hoặc Helpdesk Work Item.

---

## WF-015 — License Overuse

### Trigger
```text
LICENSE.OVERUSED
```

### Calculation
```text
Entitlement < Assigned/Installed
```

### Workflow
```text
Detect Overuse
↓
Identify installations
↓
Check actual usage
↓
Find reclaim candidates
```

### Actions
Reclaim unused license, Purchase more licenses, Approve temporary exception, Remove unauthorized install.

---

## WF-016 — Warranty Expiring

### Trigger
```text
ASSET.WARRANTY_EXPIRING
```

Ví dụ <30 days.

### Context
Asset age, Health, Incident frequency, Repair cost, Replacement score, Contract, Vendor.

### Decision
```text
Renew Warranty
Replace Asset
Continue Without Warranty
Exception
```

### Completion
Decision được ghi vào Asset history.

---

## WF-017 — Replacement / Renewal

### Workflow
```text
Detect
↓
Explain
↓
Recommend
↓
Manager Decision
↓
Replacement Plan
↓
Budget
↓
Procurement
↓
Receive New Asset
↓
Migration
↓
Assign New Asset
↓
Return Old Asset
↓
Retire/Dispose
```

---

## WF-018 — Asset Disposal

### Workflow
```text
Retired Asset
↓
Approval
↓
Data Backup if required
↓
Data Wipe
↓
Wipe Verification
↓
Remove Agent/MDM
↓
Reclaim Licenses
↓
Remove Network Access
↓
Dispose/Sell/Return Vendor
↓
Generate Disposal Documents
↓
Lifecycle = Disposed
```

### Documents
Biên bản thanh lý, Biên bản xóa dữ liệu, Approval, Receipt, Invoice, Vendor handover.

---

## WF-019 — User Termination / Offboarding

### Trigger
```text
USER.TERMINATED
```

### Workflow
```text
Identity Disabled
↓
Find Assigned Assets
↓
Create Return Tasks
↓
Reclaim Licenses
↓
Remove Access
↓
Collect Assets
↓
Inspect
↓
Update Inventory
```

### Completion Condition
```text
No outstanding asset
No active license
No active privileged access
```

---

## WF-020 — Root Incident Correlation

### Trigger
Nhiều event/ticket cùng chỉ về một nguyên nhân.

### Example
```text
42 network alerts
27 user tickets
1 WAN outage
```

### Workflow
```text
Events + Tickets
↓
Correlation
↓
Shared dependency detected
↓
Create Root Incident
↓
Attach child tickets/events
↓
Notify affected users
↓
Resolve root cause
↓
Verify recovery
↓
Update all linked records
```

### Rule
Không tạo hàng chục Incident độc lập nếu cùng một root cause.

# 8. Một ngày làm việc của người vận hành

## 08:00 — Daily Operations Overview
- Critical Incidents
- Health Critical
- Offline Agents
- SLA Risk
- Audit Exceptions
- Warranty Expiry
- License Issues
- Unauthorized Software
- Unknown Network Devices
- Maintenance Overdue
- Asset Returns
- Financial/Document Exceptions

## 08:15 — Critical Operations
P1 Incidents, Service Outages, Network Issues, Security/Compliance Critical.

## 09:00 — Helpdesk Queue
User Incidents, Service Requests, Software Install Requests, Access Requests, Asset Requests.

## 10:00 — Asset Operations
Receive Assets, Assign, Transfer, Return, Warehouse, Maintenance.

## 13:30 — Audit / Compliance
Inventory Audit, Unauthorized Software, License Compliance, Unknown Devices, Data Mismatch.

## 15:00 — Network / Agent Operations
Network Discovery, VLAN Exceptions, Agent Offline, Agent Update, Deployment Failures.

## 16:00 — Renewal / Procurement
Warranty, Replacement, License Renewal, Procurement, Budget, Disposal.

## 17:00 — End-of-Day Review
Unresolved P1/P2, SLA at risk, Pending approvals, Failed automation, Pending maintenance, Pending return, Audit exceptions, Overdue tasks.

# 9. Notification Rules

## Immediate
P1 Incident, Security Critical, Major Outage, Failed Change.

## Action Required
Approval, Asset Return, Audit Exception, Warranty Decision, License Overuse.

## Informational
Ticket resolved, Assignment completed, Software installed, Audit completed.

## Digest
Daily Operations Summary, Weekly Asset Health, Monthly License Compliance.

# 10. Document Rules

Document phải liên kết trực tiếp với entity/workflow.

```text
Asset
├── Invoice
├── Receipt
├── Handover Document
├── Return Document
├── Maintenance Report
├── Warranty
├── Disposal Document
└── Audit Evidence
```

# 11. Audit Trail Rules

Mọi action quan trọng phải lưu:

```text
Who
What
When
Where
Before
After
Reason
Source
Workflow ID
Related Ticket/Incident/Change
```

# 12. Next Expansion

1. Service Request Catalog
2. Approval Engine
3. SLA Engine
4. Problem Management
5. Change Management
6. Knowledge Management
7. Procurement & Finance
8. Contract Management
9. Software Repository / Artifact Security
10. Enterprise Branding
11. Channel Integration
12. Role & Permission Matrix
13. Network Topology
14. Automation Rules Engine
15. Notification Matrix
16. Document Lifecycle
17. Reporting & KPI
18. Major Incident Workflow

# 13. Definition of Done cho một workflow

Một workflow chỉ được xem là hoàn chỉnh khi đã xác định đủ:
- Trigger
- Entities
- Context
- Rule
- Automation
- Human action
- State transitions
- Related ITSM records
- Notification
- Document
- Audit trail
- Completion condition
- Failure handling
- Escalation
- Idempotency / duplicate prevention
- Permission requirement

## TASK-096 Explainable Recommendation Aggregation

TASK-096 aggregates and presents only canonical TASK-092 Incident review,
TASK-093 Knowledge guidance and TASK-059/TASK-094 Asset replacement review
artifacts. Source domains retain decision, eligibility, score and lifecycle
ownership. The aggregation layer provides immutable explanation revisions,
context filtering and actor-scoped view/dismiss/open metadata; it is not a
global recommender, Work Queue or automation workflow. A recommendation only
navigates to its owning workflow. It never executes the suggested action.
See `tasks/TASK-096_EXPLAINABLE_RECOMMENDATION_LAYER.md`.

TASK-096 runtime exposes only the three governed families through a tenant-scoped Recommendation feed. Periodic reconciliation consumes owner queries, records immutable source-generation revisions, and never executes the typed source navigation actions.
