# SYSTEM WORKFLOW INDEX + TRACEABILITY MATRIX
## IT Operations Hub — Central Workflow Registry

**Version:** 0.1  
**Status:** Central Index Draft  
**Purpose:** Single entry point for navigating all workflow specifications and tracing events, entities, states, controls, documents, and downstream processes across the platform.

---

# 1. Mục tiêu

Tài liệu này là **mục lục trung tâm** của toàn bộ hệ thống.

Thay vì phải nhớ một nghiệp vụ nằm ở file nào, tài liệu này cho phép truy ngược theo:

```text
Event
→ Workflow
→ Entity
→ State
→ Approval
→ SLA
→ Automation
→ Notification
→ Document
→ Downstream Workflow
```

Tài liệu này không thay thế các workflow spec chi tiết.

Nó đóng vai trò:

```text
System Index
Traceability Matrix
Workflow Registry
Cross-domain Dependency Map
Implementation Navigation Map
```

---

# 2. Tài liệu nền hiện có

| ID | Tài liệu | Phạm vi chính |
|---|---|---|
| DOC-000 | `MASTER_WORKFLOW_MAP.md` | Kiến trúc workflow tổng thể |
| DOC-001 | `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md` | Helpdesk, Incident, Monitoring, Agent |
| DOC-002 | `PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md` | Problem, Change, RCA, Knowledge |
| DOC-003 | `ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md` | Receiving, Warehouse, Assignment, Transfer, Return |
| DOC-004 | `MAINTENANCE_WARRANTY_REPLACEMENT_DISPOSAL_WORKFLOW.md` | Maintenance, Warranty, Replacement, Disposal |
| DOC-005 | `AUDIT_NETWORK_DISCOVERY_VLAN_TOPOLOGY_WORKFLOW.md` | Audit, Discovery, VLAN, Topology |
| DOC-006 | `SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md` | Software, Artifact, Deployment, License |
| DOC-007 | `PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md` | Procurement, Supplier, PO, Invoice, Contract, Documents |
| DOC-008 | `IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md` | Identity, SSO, RBAC, Joiner/Mover/Leaver |
| DOC-009 | `CHANNEL_BRANDING_NOTIFICATION_COMMUNICATION_WORKFLOW.md` | Portal, Email, Teams/Slack, Notifications, Branding |
| DOC-010 | `APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md` | Approval, SLA, Automation Control Plane |
| DOC-011 | `REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md` | Operations Overview, Work Queue, KPI, Reporting |

---

# 3. Kiến trúc điều hướng tổng thể

```text
USER / SYSTEM / AGENT / MONITORING / INTEGRATION
                    ↓
                 EVENT
                    ↓
        CONTEXT ENRICHMENT LAYER
                    ↓
     CORRELATION / POLICY EVALUATION
                    ↓
        ┌───────────┼───────────┐
        ↓           ↓           ↓
    APPROVAL       SLA      AUTOMATION
        └───────────┼───────────┘
                    ↓
               WORKFLOW
                    ↓
       BUSINESS STATE CHANGE
                    ↓
     NOTIFICATION / DOCUMENT
                    ↓
            AUDIT / TIMELINE
                    ↓
        DOWNSTREAM WORKFLOW
```

---

# 4. Domain Registry

| Domain | Prefix | Main Entities |
|---|---|---|
| Identity | ID | User, Identity, Role, Session |
| Helpdesk | HD | Ticket, Request, Work Item |
| Incident | INC | Incident, Root Incident |
| Problem | PRB | Problem, Known Error, RCA |
| Change | CHG | Change, Change Task |
| Asset | AST | Asset, Assignment, Movement |
| Warehouse | WH | Warehouse, Stock Receipt, Stock Issue |
| Maintenance | MNT | Maintenance Order, Repair |
| Warranty | WAR | Warranty, Claim |
| Replacement | RPL | Replacement Candidate, Plan |
| Disposal | DSP | Retirement, Data Wipe, Disposal |
| Audit | AUD | Audit, Observation, Exception |
| Network | NET | VLAN, Subnet, Switch, Port, Topology |
| Software | SW | Software Product, Installation |
| Artifact | ART | Artifact, Package, Scan |
| License | LIC | Entitlement, Assignment, Usage |
| Procurement | PROC | Request, RFQ, PO |
| Supplier | SUP | Supplier, Quote |
| Finance Docs | FIN | Invoice, Credit Note, Payment Record |
| Contract | CON | Contract, Renewal |
| Document | DOC | Document, Version |
| Communication | COM | Message, Channel, Notification |
| Approval | APP | Approval Policy, Request |
| SLA | SLA | SLA Policy, Instance |
| Automation | AUTO | Rule, Execution |
| Reporting | RPT | KPI, Metric, Report |
| Operations | OPS | Attention Item, Work Queue |

---

# 5. Workflow Registry

## 5.1 Identity / Access

| Workflow | Name | Source Spec |
|---|---|---|
| WF-ID01 | Initial User Sync | DOC-008 |
| WF-ID02 | User Login via SSO | DOC-008 |
| WF-ID03 | Access Review | DOC-008 |
| WF-JML01 | Joiner | DOC-008 |
| WF-JML02 | Mover | DOC-008 |
| WF-JML03 | Leaver / Offboarding | DOC-008 |

## 5.2 Helpdesk / Incident / Monitoring

| Workflow | Name | Source Spec |
|---|---|---|
| WF-002 | User Reports an Incident | DOC-001 |
| WF-003 | Monitoring Critical Event | DOC-001 |
| WF-004 | Agent Offline Threshold | DOC-001 |
| WF-020 | Root Incident Correlation | DOC-001 |

## 5.3 Problem / Change / Knowledge

| Workflow | Name | Source Spec |
|---|---|---|
| WF-P01 | Create Problem Candidate | DOC-002 |
| WF-P02 | Problem Lifecycle | DOC-002 |
| WF-P03 | Publish Workaround to Helpdesk | DOC-002 |
| WF-P04 | Resolve Problem | DOC-002 |
| WF-C01 | Create Change Request | DOC-002 |
| WF-C02 | Change Implementation | DOC-002 |

## 5.4 Asset / Warehouse

| Workflow | Name | Source Spec |
|---|---|---|
| WF-A01 | Receive Goods | DOC-003 |
| WF-A02 | Warehouse Put-away | DOC-003 |
| WF-A03 | Asset Preparation | DOC-003 |
| WF-A04 | Asset Reservation | DOC-003 |
| WF-A05 | Assign Asset to User | DOC-003 |
| WF-A06 | Stock Issue | DOC-003 |
| WF-A07 | Transfer Asset Between Users | DOC-003 |
| WF-A08 | Transfer Between Locations | DOC-003 |
| WF-A09 | Temporary Loan | DOC-003 |
| WF-A10 | Return Request | DOC-003 |

## 5.5 Maintenance / Warranty / Replacement / Disposal

| Workflow | Name | Source Spec |
|---|---|---|
| WF-M01 | Create Maintenance Order | DOC-004 |
| WF-M02 | Diagnosis | DOC-004 |
| WF-M03 | Preventive Maintenance | DOC-004 |
| WF-M04 | Waiting for Parts | DOC-004 |
| WF-M05 | Execute Repair | DOC-004 |
| WF-W01 | Warranty Evaluation | DOC-004 |
| WF-W02 | Warranty Claim | DOC-004 |
| WF-W03 | Warranty Expiry Watch | DOC-004 |
| WF-R01 | Replacement Candidate | DOC-004 |
| WF-R02 | Replacement Review | DOC-004 |
| WF-RT01 | Retirement Candidate | DOC-004 |
| WF-D01 | Data Wipe | DOC-004 |
| WF-D02 | Disposal Decision | DOC-004 |

## 5.6 Audit / Network

| Workflow | Name | Source Spec |
|---|---|---|
| WF-AUD01 | Create Audit | DOC-005 |
| WF-AUD02 | QR Audit | DOC-005 |
| WF-AUD03 | Agent-assisted Audit | DOC-005 |
| WF-AUD04 | Reconciliation | DOC-005 |
| WF-N01 | Network Discovery Job | DOC-005 |
| WF-N02 | Device Discovery | DOC-005 |
| WF-N03 | IP/MAC Reconciliation | DOC-005 |
| WF-N04 | VLAN Validation | DOC-005 |

## 5.7 Software / Artifact / License

| Workflow | Name | Source Spec |
|---|---|---|
| WF-SW01 | Artifact Intake | DOC-006 |
| WF-SW02 | Publish Software to Catalog | DOC-006 |
| WF-SW03 | Software Installation Request | DOC-006 |
| WF-SW04 | Deployment Job | DOC-006 |
| WF-SW05 | Software Inventory Discovery | DOC-006 |
| WF-SW06 | Unauthorized Software Detection | DOC-006 |
| WF-SW07 | Outdated Software Remediation | DOC-006 |
| WF-L01 | Assign License | DOC-006 |
| WF-L02 | License Compliance Calculation | DOC-006 |
| WF-L03 | License Overuse | DOC-006 |
| WF-L04 | License Reclaim | DOC-006 |
| WF-L05 | License Expiry Watch | DOC-006 |

## 5.8 Procurement / Contract / Document

| Workflow | Name | Source Spec |
|---|---|---|
| WF-PROC01 | Create Procurement Request | DOC-007 |
| WF-PROC02 | RFQ | DOC-007 |
| WF-PROC03 | Create Purchase Order | DOC-007 |
| WF-PROC04 | Goods Receipt Integration | DOC-007 |
| WF-PROC05 | Invoice Intake | DOC-007 |
| WF-PROC06 | Payment Record | DOC-007 |
| WF-CON01 | Contract Creation | DOC-007 |
| WF-CON02 | Contract Renewal | DOC-007 |
| WF-DOC01 | Generate Operational Document | DOC-007 |

## 5.9 Channel / Communication

| Workflow | Name | Source Spec |
|---|---|---|
| WF-CH01 | Inbound Portal Request | DOC-009 |
| WF-CH02 | Inbound Email | DOC-009 |
| WF-CH03 | Teams / Slack Inbound | DOC-009 |
| WF-CH04 | API Request Inbound | DOC-009 |
| WF-CH05 | Channel Intent Classification | DOC-009 |
| WF-COM01 | Ticket Communication | DOC-009 |
| WF-COM02 | Major Incident Communication | DOC-009 |
| WF-NOT01 | Approval Notification | DOC-009 |
| WF-NOT02 | SLA Notification | DOC-009 |
| WF-NOT03 | Asset Return Notification | DOC-009 |
| WF-NOT04 | Warranty / Contract / License Expiry | DOC-009 |

## 5.10 Control Plane

| Workflow | Name | Source Spec |
|---|---|---|
| WF-APP01 | Create Approval Request | DOC-010 |
| SLA Engine | SLA lifecycle | DOC-010 |
| Automation Engine | Event → Condition → Action | DOC-010 |

---

# 6. Core Cross-Domain Traceability Matrix

| Trigger / Event | Primary Workflow | Core Entity | Important State Change | Approval | SLA | Automation | Notification | Document | Downstream |
|---|---|---|---|---|---|---|---|---|---|
| `TICKET.CREATED` | WF-002 | Ticket | NEW → TRIAGE | Conditional | Yes | Enrich / dedupe / auto-fix | Requester, assignee | Attachments | Incident / Request |
| `MONITORING.CRITICAL` | WF-003 | Monitoring Event | ACTIVE | No | Incident SLA if created | Suppress / correlate | Ops if actionable | Evidence | Root Incident |
| `AGENT.OFFLINE_THRESHOLD` | WF-004 | Agent/Asset | ONLINE → OFFLINE/RECOVERING | No | Optional | Restart/reconnect | Only if failed/actionable | Logs | Work Item / Incident |
| Recurring incident threshold | WF-P01 | Problem Candidate | NEW | No | Optional | Auto-create candidate | Problem Manager | Evidence | Problem |
| `PROBLEM.CHANGE_REQUIRED` | WF-C01 | Change | DRAFT → ASSESSMENT | Yes | Change target | Prechecks | Approver | Change Plan | Implementation |
| Goods arrive | WF-A01 | Goods Receipt / Asset | Purchased → Received | Exception only | Receiving SLA | Validate/duplicate check | Warehouse exception | GR / Delivery Note | Put-away |
| Asset ready for user | WF-A05 | Assignment | Available → In Use | Conditional | Provisioning SLA | Generate docs / update linked data | User | Handover | Software/License |
| User termination | WF-JML03 | Offboarding Case | ACTIVE → TERMINATING | Usually no | Offboarding SLA | Revoke / create return tasks | User/manager/admin | Clearance | Asset Return / License Reclaim |
| `ASSET.HEALTH_CRITICAL` | WF-M01 | Maintenance Order | In Use → Repair | Cost/risk-based | Maintenance SLA | Diagnose / loan suggestion | User/operator | Repair docs | Warranty / Replace |
| Warranty expiring | WF-W03 | Warranty | VALID → EXPIRING | Renewal decision | Renewal timer | Score / recommendation | Owner/procurement | Contract quote | Renewal / Replace |
| Replacement approved | WF-R02 | Replacement Plan | Candidate → Approved | Yes | Replacement target | Reserve/procure asset | User/manager | Approval | Procurement / Assignment |
| Retirement approved | WF-RT01 | Asset | In Use/Returned → Retired | Yes | Optional | License/access cleanup | Asset Admin | Retirement Approval | Data Wipe |
| `AUDIT.LOCATION_MISMATCH` | WF-AUD04 | Audit Exception | OPEN → RESOLVED | Sometimes | Exception SLA | Confidence-based correction | Asset Admin | Audit Evidence | Movement |
| `NETWORK.UNKNOWN_DEVICE` | WF-N02 | Network Exception | OPEN | Security dependent | Investigation SLA | Match/link candidate | Network/Security | Evidence | Asset/Security |
| VLAN mismatch | WF-N04 | Network Exception | OPEN → WAITING_CHANGE | Often | Network exception SLA | Create Change | Network team | Change ref | Change Mgmt |
| `ARTIFACT.UPLOADED` | WF-SW01 | Artifact | DRAFT → SCANNING | Security/software owner | Review SLA | Hash/signature/scan | Reviewer | Scan report | Catalog |
| `SOFTWARE.INSTALL_REQUESTED` | WF-SW03 | Software Request | Requested → Approved/Installing | Conditional | Request SLA | Eligibility/license/deploy | User | Approval evidence | Deployment |
| `SOFTWARE.UNAUTHORIZED_DETECTED` | WF-SW06 | Software Exception | OPEN | Exception path | Compliance SLA | Remove if safe | Security/software admin | Evidence | Removal / Approval |
| `LICENSE.OVERUSED` | WF-L03 | License Exception | COMPLIANT → OVERUSED | Maybe purchase/exception | Compliance SLA | Reclaim candidate | License admin | License report | Reclaim / Procurement |
| Procurement need | WF-PROC01 | Procurement Request | DRAFT → SUBMITTED | Yes | Procurement SLA | Stock/budget check | Requester/approver | Request | RFQ / PO |
| Approved procurement | WF-PROC03 | Purchase Order | DRAFT → ISSUED | Yes | Delivery timer | Copy approved lines | Supplier/Procurement | PO | Receipt |
| Invoice received | WF-PROC05 | Invoice | RECEIVED → MATCHING | Exception approval | Match SLA | 3-way match | Finance/Procurement | Invoice | Payment |
| Contract expiring | WF-CON02 | Contract | ACTIVE → EXPIRING | Renewal approval | Renewal deadline | Usage/performance recommendation | Owner/procurement | Contract | Renewal |
| `APPROVAL.CREATED` | WF-APP01 | Approval Request | PENDING | n/a | Approval SLA | Route/escalate | Approver | Context snapshot | Resume source workflow |
| SLA threshold reached | SLA Engine | SLA Instance | RUNNING → WARNING/CRITICAL | No | n/a | Escalate | Assignee/lead | n/a | Work Queue |
| Rule matched | Automation Engine | Rule Execution | STARTED | Sometimes | Action timeout | Execute | Operator if failure | Execution evidence | Business workflow |
| Major Incident declared | WF-COM02 | Root Incident | INVESTIGATING | No | Update cadence | Audience resolution | Affected users/stakeholders | Status updates | Incident resolution |

---

# 7. State Transition Registry

## 7.1 Ticket

```text
NEW
→ TRIAGE
→ IN_PROGRESS
→ WAITING_*
→ RESOLVED
→ CLOSED

RESOLVED
→ REOPENED
→ IN_PROGRESS
```

## 7.2 Root Incident

```text
DETECTED
→ INVESTIGATING
→ IDENTIFIED
→ MITIGATING
→ MONITORING_RECOVERY
→ RESOLVED
→ CLOSED
```

## 7.3 Problem

```text
NEW
→ UNDER_REVIEW
→ INVESTIGATING
→ WORKAROUND_AVAILABLE / KNOWN_ERROR / CHANGE_REQUIRED
→ RESOLVED
→ CLOSED
```

## 7.4 Change

```text
DRAFT
→ ASSESSMENT
→ PENDING_APPROVAL
→ APPROVED
→ SCHEDULED
→ IMPLEMENTING
→ VERIFYING
→ SUCCESSFUL
→ CLOSED
```

## 7.5 Asset Lifecycle

```text
Planned
→ Purchased
→ Received
→ Available
→ Reserved
→ Assigned / In Use
→ Repair / Returned
→ Retired
→ Disposed
```

## 7.6 Assignment

```text
Unassigned
→ Reserved
→ Assigned
→ Pending Return
→ Unassigned
```

Alternative:

```text
Assigned
→ Temporary Loan / In Transit
```

## 7.7 Maintenance

```text
DRAFT
→ OPEN
→ DIAGNOSING
→ WAITING_PART / WAITING_VENDOR / IN_REPAIR
→ VERIFYING
→ COMPLETED
```

## 7.8 Audit Exception

```text
OPEN
→ INVESTIGATING
→ WAITING_CONFIRMATION
→ RESOLVED
```

Alternative:

```text
ACCEPTED_EXCEPTION
FALSE_POSITIVE
```

## 7.9 Software Deployment

```text
QUEUED
→ PRECHECK
→ DOWNLOADING
→ VERIFYING_ARTIFACT
→ INSTALLING
→ POSTCHECK
→ SUCCESS
```

## 7.10 Approval

```text
PENDING
→ IN_PROGRESS
→ APPROVED / REJECTED / CHANGES_REQUESTED / EXPIRED
```

---

# 8. Entity Relationship Traceability

```text
USER
├─ owns/uses → ASSET
├─ requests → TICKET / SERVICE REQUEST
├─ assigned → LICENSE
├─ has → ROLE BINDING
└─ participates → APPROVAL
```

```text
ASSET
├─ assigned to → USER
├─ located at → LOCATION
├─ monitored by → AGENT / MONITORING
├─ connected via → NETWORK
├─ has → SOFTWARE INSTALLATION
├─ may consume → LICENSE
├─ may have → MAINTENANCE
├─ may be covered by → WARRANTY / CONTRACT
├─ acquired through → PO / INVOICE
└─ appears in → AUDIT
```

```text
INCIDENT
├─ affects → SERVICE / ASSET / USER
├─ may create → PROBLEM
├─ may require → CHANGE
├─ may use → KNOWLEDGE
└─ may become → ROOT INCIDENT
```

```text
PROCUREMENT REQUEST
→ RFQ
→ QUOTATION
→ PURCHASE ORDER
→ GOODS/SERVICE RECEIPT
→ INVOICE
→ ASSET / LICENSE / CONTRACT
```

---

# 9. Event Family Registry

## Identity

```text
USER.CREATED
USER.UPDATED
USER.ACTIVATED
USER.SUSPENDED
USER.TERMINATING
USER.TERMINATED
USER.DEPARTMENT_CHANGED
USER.LOCATION_CHANGED
USER.MANAGER_CHANGED
USER.ROLE_CHANGED
```

## Helpdesk / Incident

```text
TICKET.CREATED
TICKET.ENRICHED
TICKET.ASSIGNED
TICKET.RESOLVED
INCIDENT.CREATED
INCIDENT.CORRELATED
INCIDENT.ROOT_CREATED
INCIDENT.RESOLVED
```

## Monitoring / Agent

```text
MONITORING.CRITICAL
MONITORING.RECOVERED
AGENT.OFFLINE
AGENT.OFFLINE_THRESHOLD
AGENT.RECOVERY_STARTED
AGENT.ONLINE
```

## Asset

```text
ASSET.CREATED
ASSET.TAGGED
ASSET.AVAILABLE
ASSET.RESERVED
ASSET.ASSIGNED
ASSET.TRANSFERRED
ASSET.RETURN_REQUESTED
ASSET.RETURNED
ASSET.MISSING
ASSET.RETIRED
ASSET.DISPOSED
```

## Maintenance / Warranty

```text
MAINTENANCE.CREATED
MAINTENANCE.COMPLETED
MAINTENANCE.FAILED
WARRANTY.EXPIRING
WARRANTY.CLAIM_CREATED
WARRANTY.CLAIM_APPROVED
```

## Audit / Network

```text
AUDIT.STARTED
AUDIT.LOCATION_MISMATCH
AUDIT.ASSET_MISSING
AUDIT.COMPLETED
NETWORK.UNKNOWN_DEVICE
NETWORK.VLAN_MISMATCH
NETWORK.IP_CONFLICT
NETWORK.TOPOLOGY_CHANGED
```

## Software / License

```text
SOFTWARE.REQUESTED
SOFTWARE.INSTALLED
SOFTWARE.UNAUTHORIZED_DETECTED
SOFTWARE.VULNERABLE_DETECTED
ARTIFACT.UPLOADED
ARTIFACT.APPROVED
ARTIFACT.REVOKED
LICENSE.ASSIGNED
LICENSE.OVERUSED
LICENSE.RECLAIMED
LICENSE.EXPIRING
```

## Procurement / Contract

```text
PROCUREMENT.REQUESTED
PROCUREMENT.APPROVED
PO.CREATED
PO.ISSUED
PO.PARTIALLY_RECEIVED
PO.FULLY_RECEIVED
INVOICE.RECEIVED
INVOICE.MATCHED
INVOICE.MISMATCH
CONTRACT.EXPIRING
CONTRACT.RENEWED
```

## Control Plane

```text
APPROVAL.CREATED
APPROVAL.APPROVED
APPROVAL.REJECTED
SLA.WARNING
SLA.CRITICAL
SLA.BREACHED
RULE.MATCHED
AUTOMATION.STARTED
AUTOMATION.COMPLETED
AUTOMATION.HUMAN_FALLBACK
```

---

# 10. Approval Touchpoint Matrix

| Domain | Approval Usually Required For |
|---|---|
| Identity | Privileged access, temporary elevation |
| Asset | High-value assignment, special transfer, stock adjustment |
| Maintenance | High repair cost, vendor repair |
| Replacement | Replacement approval |
| Disposal | Retirement, disposal method |
| Change | Normal/High-risk/Emergency Change |
| Software | Restricted/paid software |
| License | Paid license, exception, overuse purchase |
| Procurement | Request, PO, invoice exception |
| Contract | Renewal, termination |
| Network | High-risk VLAN/network change |
| Security | Exception waiver, destructive action |

---

# 11. SLA Touchpoint Matrix

| Workflow | Typical SLA / Timer |
|---|---|
| Ticket | First response, resolution |
| Incident | acknowledge, restore, resolve |
| Approval | decision time |
| Asset Preparation | ready-to-assign |
| Asset Return | due date |
| Maintenance | diagnosis, repair |
| Vendor Repair | response, turnaround |
| Audit Exception | resolution |
| Unknown Device | investigation |
| Procurement | review, approval, delivery |
| Invoice | match/exception |
| Contract | renewal/cancellation deadline |
| Software | approval/install |
| License | reclaim/renewal |
| Offboarding | access revoke / clearance |

---

# 12. Automation Touchpoint Matrix

| Condition | Typical Automated Action |
|---|---|
| Agent offline but asset reachable | Restart/re-register agent |
| Known ticket signature | Link existing incident |
| Root outage correlation | Attach child alerts/tickets |
| Reservation expired | Release asset |
| Warranty approaching expiry | Create review |
| Asset health critical | Create maintenance |
| High-confidence location mismatch | Suggest/perform correction per policy |
| Approved software request | Deploy artifact |
| License unused | Create reclaim candidate |
| Contract nearing deadline | Create renewal work item |
| SLA threshold reached | Notify/escalate |
| User terminated | Revoke access, create returns, reclaim licenses |

---

# 13. Notification Touchpoint Matrix

| Event Type | Primary Audience |
|---|---|
| Ticket Created | Requester |
| SLA Risk | Assignee / Team Lead |
| P1 Incident | Affected Users / Ops / Service Owner |
| Approval Required | Approver |
| Asset Return | User / Manager |
| Maintenance Complete | User / Helpdesk |
| Warranty Expiry | Asset Owner / Procurement |
| Unknown Device | Network / Security |
| License Overuse | License Admin |
| Contract Deadline | Contract Owner / Procurement |
| Automation Failure | Operator / Automation Owner |

---

# 14. Document Touchpoint Matrix

| Workflow | Generated / Attached Documents |
|---|---|
| Receiving | PO, Delivery Note, Goods Receipt |
| Assignment | Handover |
| Transfer | Transfer Order |
| Return | Return Document, Condition Report |
| Maintenance | Diagnostic Report, Repair Report, Invoice |
| Warranty | Claim Evidence |
| Replacement | Approval, Migration Record |
| Disposal | Data Wipe Certificate, Disposal Record |
| Audit | Audit Report, Exception Evidence |
| Procurement | RFQ, Quote, PO |
| Invoice | Invoice, Credit Note |
| Contract | Contract, Renewal |
| License | License Certificate |
| Change | Implementation Plan, PIR |
| Knowledge | Published Article |
| Offboarding | Clearance Record |

---

# 15. Work Queue Source Matrix

Work Queue có thể nhận từ:

```text
Helpdesk
Incident
Monitoring
Agent
Asset
Warehouse
Maintenance
Audit
Network
Software
License
Procurement
Contract
Identity
Automation
Security
```

Nhưng chỉ khi item:

```text
actionable
owned
non-duplicate
above threshold
```

---

# 16. Major Cross-Domain Chains

## 16.1 User Incident → Permanent Fix

```text
User
→ Ticket
→ Incident
→ Root Incident
→ Problem
→ RCA
→ Change
→ Verification
→ Knowledge
```

## 16.2 New Employee

```text
Identity
→ Joiner
→ Role
→ Asset Request
→ Reservation
→ Preparation
→ Software
→ License
→ Assignment
→ Handover
```

## 16.3 Employee Exit

```text
Termination
→ Access Revocation
→ Asset Return
→ License Reclaim
→ Ownership Transfer
→ Clearance
→ Archive
```

## 16.4 Asset Purchase

```text
Need
→ Procurement
→ RFQ
→ PO
→ Receiving
→ Asset Creation
→ Put-away
→ Preparation
→ Assignment
```

## 16.5 Asset Failure

```text
Health / Ticket
→ Maintenance
→ Warranty
→ Repair-vs-Replace
→ Repair
or
→ Replacement
→ Return Old Asset
→ Retirement
→ Wipe
→ Disposal
```

## 16.6 Software Request

```text
Request
→ Catalog
→ Approval
→ License
→ Artifact
→ Deployment
→ Verification
→ Usage
→ Reclaim
```

## 16.7 Audit Mismatch

```text
Audit Observation
→ Exception
→ Evidence Correlation
→ Correct Asset/Owner/Location
or
→ Investigation
or
→ Change
→ Resolve
```

## 16.8 Network Outage

```text
Monitoring
→ Topology Correlation
→ Root Incident
→ Major Incident
→ Communication
→ Change/Repair
→ Verification
→ Resolution
```

---

# 17. Source-of-Truth Matrix

| Data | Primary Source |
|---|---|
| User employment | HRIS / authoritative identity source |
| Authentication | IdP |
| System authorization | Internal RBAC |
| Asset identity | Asset Registry |
| Asset assignment | Asset Assignment |
| Current physical location | Verified Asset Location |
| Agent telemetry | Endpoint Agent |
| Network connection | Discovery/Network sources |
| Ticket state | Helpdesk |
| Incident state | Incident Management |
| Software approval | Software Catalog |
| Artifact binary | Artifact Repository |
| License entitlement | License Management / Contract |
| Purchase order | Procurement |
| Invoice | Finance/Procurement integration |
| Contract | Contract Registry |
| SLA | SLA Engine |
| Approval decision | Approval Engine |
| Automation decision | Automation Rule Execution |
| Operational KPI | Canonical Metric Definition |

---

# 18. Common Context Object

Cross-domain workflow nên resolve:

```yaml
context:
  user:
  asset:
  service:
  location:
  agent:
  monitoring:
  network:
  ticket:
  incident:
  problem:
  change:
  maintenance:
  software:
  license:
  warranty:
  contract:
  procurement:
  compliance:
  risk:
  approvals:
  sla:
```

Unknown field phải biểu diễn:

```text
UNKNOWN
STALE
NOT_APPLICABLE
```

không dùng null mơ hồ cho mọi trường hợp.

---

# 19. Unified Audit Trail Contract

Mọi domain nên ghi tối thiểu:

```yaml
audit_event:
  event_id:
  event_type:
  actor:
  actor_type:
  source:
  entity_type:
  entity_id:
  timestamp:
  before:
  after:
  reason:
  correlation_id:
  workflow_id:
  related_entities:
```

---

# 20. Correlation ID

Một chuỗi E2E nên dùng:

```text
correlation_id
```

Ví dụ:

```text
User ticket
→ Incident
→ Problem
→ Change
```

có thể truy cùng một correlation family.

---

# 21. Idempotency Contract

Mỗi workflow/action tạo side effect cần:

```text
idempotency_key
```

Pattern:

```text
{domain}:{source}:{entity}:{version}
```

Ví dụ:

```text
ticket:email:message-123
assignment:AST-0042:v3
invoice:SUP-12:INV-8821
automation:RULE-7:event-991
```

---

# 22. Common Workflow Definition Contract

Mọi workflow mới phải khai báo:

```text
Workflow ID
Name
Trigger
Preconditions
Primary Entity
Related Entities
Context Enrichment
Decision Table
State Transition
Approval
SLA
Automation
Human Action
Notification
Documents
Audit Trail
Idempotency
Failure Handling
Escalation
Completion Condition
Downstream Workflows
Permissions
Metrics
Guardrails
```

---

# 23. Traceability Checklist

Một workflow chưa hoàn tất nếu không trả lời được:

```text
What starts it?
Who/what owns it?
What state changes?
What can be automated?
What requires approval?
What timer applies?
What happens on failure?
Who is notified?
What document is created?
What downstream workflow starts?
How do we prevent duplicates?
How is it audited?
```

---

# 24. Implementation Layer Mapping

Recommended implementation layers:

```text
1. Event Bus
2. Entity Services
3. Context Resolver
4. Correlation Engine
5. Policy Engine
6. Approval Engine
7. SLA Engine
8. Automation Engine
9. Workflow Orchestrator
10. Notification Engine
11. Document Engine
12. Audit/Timeline Service
13. Reporting/Metric Layer
14. Work Queue
15. UI Workspaces
```

---

# 25. Suggested Service Boundaries

Logical boundaries:

```text
identity-service
asset-service
helpdesk-service
incident-service
problem-change-service
maintenance-service
network-discovery-service
software-license-service
procurement-contract-service
notification-service
document-service
workflow-service
policy-service
reporting-service
audit-service
```

This is a logical decomposition, not a requirement that every boundary be a separate microservice.

---

# 26. Event Bus Naming Convention

Recommended:

```text
DOMAIN.ENTITY.ACTION
```

Examples:

```text
ASSET.ASSIGNMENT.CREATED
INCIDENT.ROOT.CREATED
LICENSE.ASSIGNMENT.RECLAIMED
CONTRACT.RENEWAL.STARTED
```

For backward compatibility, existing simpler events may remain aliases.

---

# 27. Entity ID Conventions

Suggested display prefixes:

```text
AST-      Asset
TCK-      Ticket
INC-      Incident
PRB-      Problem
CHG-      Change
MNT-      Maintenance
AUD-      Audit
PO-       Purchase Order
GR-       Goods Receipt
INV-      Invoice
CON-      Contract
APP-      Approval
LIC-      License
```

Internal immutable IDs should remain independent from display IDs.

---

# 28. Ownership Matrix

Every major entity needs an owner:

| Entity | Typical Owner |
|---|---|
| Ticket | Helpdesk Team |
| Incident | Incident Owner / Team |
| Problem | Problem Manager |
| Change | Change Owner |
| Asset | Asset Admin / Assigned User context |
| Maintenance | Technician / Maintenance Team |
| Audit | Auditor / Asset Admin |
| Network Exception | Network Team |
| Software Product | Software Owner |
| License Pool | License Admin |
| Procurement Request | Requester + Procurement |
| Contract | Contract Owner |
| Approval | Approver chain |
| Automation Rule | Automation Owner |
| KPI | Metric Owner |

---

# 29. Cross-Domain Permission Principle

A user may be able to:

```text
view asset
```

but not:

```text
assign asset
```

and may be able to:

```text
view incident
```

but not:

```text
declare major incident
```

Therefore permissions remain action-scoped and resource-scoped.

---

# 30. Failure Routing Matrix

| Failure | Destination |
|---|---|
| Identity sync fail | Identity Work Queue |
| Agent remediation fail | Helpdesk/Ops Work Queue |
| Deployment fail | Software/Helpdesk Work Queue |
| Discovery fail | Network Operations |
| Approval timeout | Escalation |
| SLA breach | Team Lead / Service Owner |
| Invoice mismatch | Procurement/Finance |
| Data wipe fail | Security / Asset Admin |
| Webhook delivery fail | Integration Ops |
| Automation failure | Automation Owner / Human Fallback |

---

# 31. Human-vs-Automation Boundary

## Prefer automation when

```text
high confidence
low risk
reversible
repeatable
policy-approved
verifiable
```

## Prefer human when

```text
ambiguous
high impact
security sensitive
financial approval
destructive
irreversible
cross-domain conflict
```

---

# 32. UI Navigation Mapping

Recommended sidebar:

```text
Tổng quan
Tài sản
Vận hành
Làm mới
```

`Asset Workspace` is not a sidebar module.

It opens from any linked Asset ID/name.

---

# 33. Contextual Action vs Workspace

## Contextual Action

Use drawer for:

```text
Resolve Audit Exception
Transfer Asset
Lifecycle Transition
Approve Request
Retry Automation
```

## Deep Investigation

Open workspace for:

```text
Incident diagnosis
Asset history
Network analysis
Maintenance history
Cross-domain context
```

---

# 34. One-action Multi-record Update

Example:

```text
Confirm Asset Transfer
```

may update:

```text
Assignment
Movement
Location
Warehouse State
Audit Trail
Timeline
Notification
```

User must not update each module manually.

---

# 35. Data Freshness Contract

Any operational value from external/telemetry source should carry:

```text
observed_at
source
freshness
```

Examples:

```text
Agent last seen
Network mapping
SaaS license sync
Directory sync
Monitoring status
```

---

# 36. Historical Integrity Principle

Never destroy history for:

```text
Asset Owner
Location
IP/MAC
License Assignment
PO Amendment
Document Version
Role Binding
Approval
Incident relation
```

Current state and history must coexist.

---

# 37. Closure Principle

Do not close based only on "signal disappeared."

Closure should require business verification appropriate to domain.

Examples:

```text
Incident
→ service healthy + stability window

Repair
→ technical verification

Software install
→ actual version detected

VLAN change
→ rediscovery + connectivity

Data wipe
→ verification evidence
```

---

# 38. Exception Principle

Exceptions are first-class entities.

Examples:

```text
Audit Exception
Network Exception
Software Exception
License Exception
Procurement Exception
Identity Exception
```

Each should have:

```text
owner
reason
risk
status
expiry where applicable
resolution
audit trail
```

---

# 39. Recommended Next Documents

After this central index, remaining high-value specs should be developed in this order:

```text
1. DATA MODEL + ENTITY RELATIONSHIP SPEC
2. EVENT CATALOG + EVENT PAYLOAD CONTRACT
3. API / COMMAND CONTRACT
4. PERMISSION MATRIX
5. STATE MACHINE MASTER SPEC
6. ERROR / RETRY / IDEMPOTENCY STANDARD
7. DATABASE / STORAGE BOUNDARY
8. SEARCH + INDEXING SPEC
9. AUDIT LOG + TIMELINE DATA MODEL
10. MVP / PHASED IMPLEMENTATION PLAN
```

---

# 40. Definition of Done

System Workflow Index đạt yêu cầu khi:

- Mọi spec chính đều có DOC ID.
- Mọi workflow có Workflow ID.
- Có mapping Event → Workflow → Entity.
- Có mapping Workflow → Approval/SLA/Automation.
- Có mapping Workflow → Notification/Document.
- Có downstream dependency.
- Có state registry.
- Có source-of-truth registry.
- Có ownership registry.
- Có failure routing.
- Có common workflow contract.
- Có idempotency/audit conventions.
- Có clear next-step path sang data model và implementation architecture.
