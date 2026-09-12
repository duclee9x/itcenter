# MASTER IMPLEMENTATION TRACEABILITY MATRIX
## IT Operations Hub — Feature-to-Implementation Control Matrix

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `MVP_PHASED_IMPLEMENTATION_PLAN.md`  
**Depends on:**  
- `MASTER_WORKFLOW_MAP.md`
- `SYSTEM_WORKFLOW_INDEX_TRACEABILITY_MATRIX.md`
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `API_COMMAND_CONTRACT_SPEC.md`
- `PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `STATE_MACHINE_MASTER_SPEC.md`
- `ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `SEARCH_INDEXING_SPEC.md`
- `AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`

**Purpose:** Provide one implementation-control document mapping each feature to its workflow, owner domain, database entities, APIs, commands, events, permissions, state machines, audit/timeline requirements, phase, dependencies, tests, observability, and implementation status.

---

# 1. Mục tiêu

Tài liệu này là bảng điều khiển triển khai trung tâm.

Mỗi feature phải trace được theo chuỗi:

```text
Feature
→ Workflow
→ Domain Owner
→ Entity / Table
→ API
→ Command
→ Event
→ Permission
→ State Machine
→ Audit
→ Timeline
→ Work Queue
→ Notification
→ Metric
→ Phase
→ Test
→ Status
```

Không feature nào được coi là hoàn thành chỉ vì:

```text
UI đã có
```

hoặc:

```text
API chạy được
```

mà thiếu:

```text
permission
state validation
event
audit
idempotency
test
observability
```

---

# 2. Implementation Status Standard

Allowed status:

```text
NOT_STARTED
DESIGN_READY
IN_PROGRESS
BLOCKED
CODE_COMPLETE
INTEGRATION_TEST
PILOT
PRODUCTION
DEPRECATED
```

---

# 3. Priority Standard

```text
P0 = Foundation / critical blocker
P1 = Core operational capability
P2 = Important operational enhancement
P3 = Optimization / advanced capability
```

---

# 4. Phase Standard

```text
P0 = Platform Foundation
P1 = Helpdesk + Asset Core MVP
P2 = Operations + Monitoring + Maintenance
P3 = Audit + Network + Software + License
P4 = Procurement + Contract + Financial Control
P5 = Automation + Intelligence + Advanced Reporting
```

---

# 5. Master Feature Registry

| ID | Feature | Domain Owner | Workflow | Phase | Priority | Status |
|---|---|---|---|---|---|---|
| F-001 | User Authentication | Identity | WF-ID01 | P0 | P0 | DESIGN_READY |
| F-002 | RBAC Authorization | Identity/RBAC | WF-ID02 | P0 | P0 | DESIGN_READY |
| F-003 | External Identity Sync | Identity | WF-ID03 | P0/P2 | P1 | DESIGN_READY |
| F-004 | User Lifecycle | Identity | WF-ID04 | P0/P2 | P1 | DESIGN_READY |
| F-005 | Asset Registry | Asset | WF-A01 | P1 | P0 | DESIGN_READY |
| F-006 | Asset Assignment | Asset | WF-006 | P1 | P0 | DESIGN_READY |
| F-007 | Asset Transfer | Asset | WF-007 | P1 | P1 | DESIGN_READY |
| F-008 | Asset Return | Asset | WF-008 | P1 | P0 | DESIGN_READY |
| F-009 | Ticket Intake | Helpdesk | WF-002 | P1 | P0 | DESIGN_READY |
| F-010 | Ticket Assignment | Helpdesk | WF-002 | P1 | P0 | DESIGN_READY |
| F-011 | Ticket Resolution | Helpdesk | WF-002 | P1 | P0 | DESIGN_READY |
| F-012 | Work Queue | Operations | WF-OPS01 | P1 | P0 | DESIGN_READY |
| F-013 | Asset Timeline | Operations/Audit | WF-OPS02 | P1 | P1 | DESIGN_READY |
| F-014 | Ticket Timeline | Operations/Audit | WF-OPS02 | P1 | P1 | DESIGN_READY |
| F-015 | Notification Core | Communication | WF-COM01 | P1 | P1 | DESIGN_READY |
| F-016 | Document/Handover | Document | WF-A06 | P1 | P1 | DESIGN_READY |
| F-017 | Monitoring Ingestion | Monitoring | WF-003 | P2 | P0 | DESIGN_READY |
| F-018 | Agent Enrollment/Status | Agent | WF-004 | P2 | P0 | DESIGN_READY |
| F-019 | Root Incident Correlation | Incident | WF-020 | P2 | P0 | DESIGN_READY |
| F-020 | Major Incident | Incident | WF-020 | P2 | P1 | DESIGN_READY |
| F-021 | SLA Engine | Control Plane | WF-SLA01 | P2 | P0 | DESIGN_READY |
| F-022 | Approval Engine | Control Plane | WF-APR01 | P2 | P0 | DESIGN_READY |
| F-023 | Maintenance Order | Maintenance | WF-009 | P2 | P0 | DESIGN_READY |
| F-024 | Warranty Tracking | Warranty | WF-016 | P2/P3 | P1 | DESIGN_READY |
| F-025 | Safe Automation | Automation | WF-AUT01 | P2 | P1 | DESIGN_READY |
| F-026 | Asset Audit | Audit | WF-010 | P3 | P0 | DESIGN_READY |
| F-027 | Network Discovery | Network | WF-011 | P3 | P0 | DESIGN_READY |
| F-028 | VLAN Mismatch | Network | WF-012 | P3 | P1 | DESIGN_READY |
| F-029 | Unknown Device | Network | WF-NET02 | P3 | P1 | DESIGN_READY |
| F-030 | Software Catalog | Software | WF-SW01 | P3 | P0 | DESIGN_READY |
| F-031 | Artifact Repository | Artifact | WF-SW02 | P3 | P0 | DESIGN_READY |
| F-032 | Software Deployment | Software | WF-014 | P3 | P0 | DESIGN_READY |
| F-033 | Unauthorized Software | Software | WF-013 | P3 | P1 | DESIGN_READY |
| F-034 | License Entitlement | License | WF-L01 | P3 | P0 | DESIGN_READY |
| F-035 | License Assignment/Reclaim | License | WF-015 | P3 | P0 | DESIGN_READY |
| F-036 | License Overuse | License | WF-015 | P3 | P1 | DESIGN_READY |
| F-037 | Replacement Planning | Asset/Maintenance | WF-017 | P3 | P2 | DESIGN_READY |
| F-038 | Disposal | Asset | WF-018 | P3 | P1 | DESIGN_READY |
| F-039 | Procurement Request | Procurement | WF-P01 | P4 | P0 | DESIGN_READY |
| F-040 | RFQ / Quote | Procurement | WF-P02 | P4 | P1 | DESIGN_READY |
| F-041 | Purchase Order | Procurement | WF-P03 | P4 | P0 | DESIGN_READY |
| F-042 | Goods Receipt | Procurement/Warehouse | WF-005 | P4 | P0 | DESIGN_READY |
| F-043 | Invoice | Procurement/Finance | WF-P04 | P4 | P0 | DESIGN_READY |
| F-044 | 3-Way Match | Procurement/Finance | WF-P05 | P4 | P1 | DESIGN_READY |
| F-045 | Contract | Contract | WF-P06 | P4 | P1 | DESIGN_READY |
| F-046 | Renewal | Contract/License | WF-016 | P4 | P1 | DESIGN_READY |
| F-047 | Advanced Search | Search | WF-SRCH01 | P3/P4 | P1 | DESIGN_READY |
| F-048 | Reporting/KPI | Reporting | WF-RPT01 | P2/P5 | P1 | DESIGN_READY |
| F-049 | Advanced Automation | Automation | WF-AUT02 | P5 | P1 | DESIGN_READY |
| F-050 | Intelligence/Recommendation | Intelligence | WF-INT01 | P5 | P2 | DESIGN_READY |

---

# 6. Foundation Traceability

## F-001 — User Authentication

```text
Feature: User Authentication
Owner: Identity
Phase: P0
Priority: P0
```

### Entities / Tables

```text
identity.users
identity.external_identities
identity.sessions
```

### APIs

```text
GET /me
POST /auth/logout
```

OIDC redirects/token exchange handled by auth layer/provider integration.

### Commands

```text
AUTH.REVOKE_SESSION
```

### Events

```text
AUTH.LOGIN_SUCCESS
AUTH.LOGIN_FAILED
AUTH.SESSION_REVOKED
```

### Permissions

```text
session.revoke
```

### State Machine

```text
User Lifecycle
Session Lifecycle
```

### Audit

```text
login success/failure
session revoke
MFA step-up
```

### Timeline

Usually not exposed except:

```text
User security timeline
```

### Tests

```text
valid login
invalid login
suspended user
terminated user
session revoke
tenant isolation
```

---

# 7. F-002 — RBAC Authorization

### Tables

```text
identity.roles
identity.permissions
identity.role_permissions
identity.role_bindings
identity.temporary_grants
```

### API

```text
POST /authorization/evaluate
POST /authorization/evaluate-batch
```

### Commands

```text
RBAC.GRANT_ROLE
RBAC.REVOKE_ROLE
RBAC.CREATE_TEMPORARY_GRANT
```

### Events

```text
RBAC.BINDING_CREATED
RBAC.BINDING_REVOKED
RBAC.TEMPORARY_GRANT_CREATED
RBAC.TEMPORARY_GRANT_EXPIRED
```

### Permissions

```text
role.read
role.manage
role_binding.grant
role_binding.revoke
role_binding.privileged_grant
```

### Audit

Mandatory.

### Metrics

```text
authorization denied
privileged grants
temporary grants
break-glass usage
```

---

# 8. Asset Core Traceability Matrix

| Feature | Tables | API / Command | Event | Permission | State |
|---|---|---|---|---|---|
| Asset Registry | `assets`, `asset_models`, `asset_categories` | `POST /assets` | `ASSET.CREATED` | `asset.create` | Lifecycle |
| Reserve Asset | `reservations`, `assets` | `ASSET.RESERVE` | `ASSET.RESERVED` | `asset.reserve` | AVAILABLE→RESERVED |
| Assign Asset | `assignments`, `movements` | `ASSET.ASSIGN` | `ASSET.ASSIGNED` | `asset.assign` | RESERVED→ASSIGNED→IN_USE |
| Transfer Asset | `movements`, `assignments` | `ASSET.TRANSFER` | `ASSET.TRANSFERRED` | `asset.transfer` | ASSIGNED/IN_USE |
| Request Return | `assignments` | `ASSET.REQUEST_RETURN` | `ASSET.RETURN_REQUESTED` | `asset.request_return` | ASSIGNED→PENDING_RETURN |
| Receive Return | `assignments`, `movements` | `ASSET.RECEIVE_RETURN` | `ASSET.RETURNED` | `asset.receive_return` | PENDING_RETURN→RETURNED |
| Retire Asset | `retirement_records` | `ASSET.RETIRE` | `ASSET.RETIRED` | `asset.retire` | AVAILABLE→RETIRED |
| Dispose Asset | `disposal_records` | `ASSET.DISPOSE` | `ASSET.DISPOSED` | `asset.dispose` | RETIRED→DISPOSED |

---

# 9. F-006 — Asset Assignment Detailed Traceability

### Workflow

```text
WF-006
```

### Preconditions

```text
asset exists
asset not disposed
asset eligible
user active
no conflicting active assignment
reservation valid if required
scope permitted
```

### Transaction

```text
close reservation
create assignment
create movement
update asset.current_owner_user_id
update assignment/lifecycle state
write outbox
write durable audit reference
```

### Async

```text
generate handover
notify user
update timeline
update search/read model
```

### Idempotency

```text
asset + target_user + business_request
```

### Concurrency

```text
expected_version
partial unique active assignment
```

### Audit

```text
actor
before owner/state
after owner/state
reason
handover link
```

### Timeline

Asset:

```text
Assigned to <user>
```

User:

```text
Received <asset>
```

### Tests

```text
available asset success
wrong state
duplicate request
parallel assignment
wrong scope
terminated user
version conflict
notification failure after commit
```

---

# 10. Helpdesk Traceability Matrix

| Feature | Tables | Commands | Events | Permission | State |
|---|---|---|---|---|---|
| Ticket Create | `tickets`, `ticket_messages` | `TICKET.CREATE` | `TICKET.CREATED` | `ticket.create` | → NEW |
| Ticket Assign | `tickets` | `TICKET.ASSIGN` | `TICKET.ASSIGNED` | `ticket.assign` | TRIAGE→ASSIGNED |
| Start Work | `tickets` | `TICKET.START` | `TICKET.STATE_CHANGED` | `ticket.update` | ASSIGNED→IN_PROGRESS |
| Wait User | `tickets` | `TICKET.REQUEST_INFO` | `TICKET.STATE_CHANGED` | `ticket.update` | IN_PROGRESS→WAITING_USER |
| Resolve | `tickets` | `TICKET.RESOLVE` | `TICKET.RESOLVED` | `ticket.resolve` | IN_PROGRESS→RESOLVED |
| Reopen | `tickets` | `TICKET.REOPEN` | `TICKET.REOPENED` | `ticket.reopen` | RESOLVED/CLOSED→REOPENED |

---

# 11. F-009 — Ticket Intake Detailed Traceability

### Inputs

```text
Portal
Email
API
Teams/Slack later
```

### Normalize

```text
requester
channel
summary
description
attachments
external message ID
```

### Enrichment

```text
User
Department
Location
Assigned Assets
Service
Recent Incidents
Agent Health later
```

### Tables

```text
helpdesk.tickets
helpdesk.ticket_messages
communication.conversations
operations.work_items
```

### Events

```text
MESSAGE.RECEIVED
TICKET.CREATED
TICKET.ENRICHED
WORK_ITEM.CREATED
```

### Work Queue

```text
type = TICKET
```

### Timeline

```text
Ticket created via <channel>
Context enriched
```

### Duplicate prevention

```text
channel + external_message_id
idempotency key for API
```

---

# 12. Work Queue Traceability

### Source Domains

```text
Ticket
Incident
Agent
Asset
Maintenance
Audit
Network
Software
License
Approval
Procurement
Automation
```

### Table

```text
operations.work_items
```

### Commands

```text
WORK_ITEM.ASSIGN
WORK_ITEM.START
WORK_ITEM.RESOLVE
WORK_ITEM.REOPEN
```

### Events

```text
WORK_ITEM.CREATED
WORK_ITEM.ASSIGNED
WORK_ITEM.OVERDUE
WORK_ITEM.RESOLVED
```

### Permissions

```text
work_item.read
work_item.assign
work_item.resolve
```

### Guardrail

```text
Work Item is not source-of-truth
```

---

# 13. Incident Traceability Matrix

| Feature | Tables | Commands | Events | Permission | State |
|---|---|---|---|---|---|
| Create Incident | `incidents` | `INCIDENT.CREATE` | `INCIDENT.CREATED` | `incident.create` | DETECTED |
| Correlate | `incident_relations` | `INCIDENT.CORRELATE` | `INCIDENT.CORRELATED` | `incident.correlate` | same |
| Root Incident | `incidents` | `INCIDENT.CREATE_ROOT` | `INCIDENT.ROOT.CREATED` | `incident.create` | DETECTED |
| Declare Major | `incidents` | `INCIDENT.DECLARE_MAJOR` | `INCIDENT.MAJOR_DECLARED` | `incident.declare_major` | flag |
| Restore | `incidents` | `INCIDENT.MARK_RESTORED` | `INCIDENT.RESTORED` | `incident.mark_restored` | →RESTORED |
| Resolve | `incidents` | `INCIDENT.RESOLVE` | `INCIDENT.RESOLVED` | `incident.resolve` | →RESOLVED |

---

# 14. Monitoring Traceability

### Source

```text
Zabbix
Prometheus Alertmanager
Agent
Vendor monitoring
```

### Pipeline

```text
Raw Alert
→ Normalize
→ Deduplicate
→ Correlate
→ Incident / Existing Root
→ Work Item if actionable
```

### Events

```text
MONITORING.CRITICAL
MONITORING.RECOVERED
MONITORING.SUPPRESSED
```

### Storage

```text
raw metrics → TSDB
important event → event bus
incident → relational
```

### Guardrail

```text
one raw alert != one ticket
```

---

# 15. Agent Traceability

### Tables

```text
agent.agents
agent.agent_jobs
agent.agent_job_results
agent.asset_current_inventory
```

### APIs

```text
POST /agent/v1/heartbeat
POST /agent/v1/inventory
GET  /agent/v1/jobs
POST /agent/v1/jobs/{id}/result
```

### Events

```text
AGENT.ENROLLED
AGENT.OFFLINE_THRESHOLD
AGENT.ONLINE
AGENT.INVENTORY_SYNCED
```

### Automation

Safe:

```text
restart agent service
retry sync
```

### Permission

Agent has dedicated restricted principal.

---

# 16. Maintenance Traceability

| Feature | Command | Event | Permission | State |
|---|---|---|---|---|
| Create | `MAINTENANCE.CREATE` | `MAINTENANCE.CREATED` | `maintenance.create` | OPEN |
| Diagnose | `MAINTENANCE.START_DIAGNOSIS` | diagnosis event | `maintenance.start_diagnosis` | DIAGNOSING |
| Request Part | `MAINTENANCE.REQUEST_PART` | waiting event | `maintenance.request_part` | WAITING_PART |
| Send Vendor | `MAINTENANCE.SEND_VENDOR` | waiting event | `maintenance.assign_vendor` | WAITING_VENDOR |
| Repair | `MAINTENANCE.START_REPAIR` | `MAINTENANCE.REPAIR_STARTED` | `maintenance.start_repair` | IN_REPAIR |
| Verify | `MAINTENANCE.VERIFY` | verification event | `maintenance.verify` | VERIFYING |
| Complete | `MAINTENANCE.COMPLETE` | `MAINTENANCE.COMPLETED` | `maintenance.complete` | COMPLETED |

---

# 17. Approval Traceability

### Tables

```text
control.approval_requests
control.approval_steps
control.approval_step_assignees
```

### Commands

```text
APPROVAL.APPROVE
APPROVAL.REJECT
APPROVAL.REQUEST_CHANGES
APPROVAL.DELEGATE
```

### Events

```text
APPROVAL.CREATED
APPROVAL.STEP_STARTED
APPROVAL.APPROVED
APPROVAL.REJECTED
APPROVAL.EXPIRED
```

### Permission

```text
approval.read
approval.decide
```

### Audit

Mandatory.

### SoD

```text
requester cannot approve own high-risk request
```

where policy says so.

---

# 18. SLA Traceability

### Tables

```text
control.sla_policies
control.sla_targets
control.sla_instances
control.sla_events
```

### Events

```text
SLA.STARTED
SLA.PAUSED
SLA.RESUMED
SLA.WARNING
SLA.CRITICAL
SLA.BREACHED
SLA.MET
```

### Applies to

```text
Ticket
Incident
Approval
Maintenance
Vendor
Return
Procurement
Contract
```

---

# 19. Automation Traceability

### Tables

```text
control.automation_rules
control.automation_rule_versions
control.rule_executions
control.action_executions
```

### Commands

```text
AUTOMATION.ACTIVATE
AUTOMATION.DISABLE
AUTOMATION.SIMULATE
AUTOMATION.RETRY_ACTION
```

### Permissions

```text
automation.rule.create
automation.rule.edit
automation.activate_low_risk
automation.execute_high_risk
```

### Events

```text
RULE.MATCHED
AUTOMATION.STARTED
AUTOMATION.ACTION_SUCCEEDED
AUTOMATION.ACTION_FAILED
AUTOMATION.HUMAN_FALLBACK
AUTOMATION.COMPLETED
```

---

# 20. Asset Audit Traceability

### Tables

```text
audit_ops.audits
audit_ops.audit_expected_assets
audit_ops.audit_observations
audit_ops.audit_exceptions
```

### Commands

```text
AUDIT.START
AUDIT.RECORD_OBSERVATION
AUDIT.RESOLVE_EXCEPTION
AUDIT.COMPLETE
```

### Events

```text
AUDIT.STARTED
AUDIT.OBSERVATION_RECORDED
AUDIT.LOCATION_MISMATCH
AUDIT.OWNER_MISMATCH
AUDIT.ASSET_MISSING
AUDIT.UNKNOWN_ASSET
AUDIT.EXCEPTION_RESOLVED
AUDIT.COMPLETED
```

---

# 21. Network Traceability

| Feature | Tables | Event | Permission | Work Queue |
|---|---|---|---|---|
| Discovery | `network_observations` | `NETWORK.DEVICE_DISCOVERED` | `network.discovery.run` | On exception |
| Unknown Device | exception + obs | `NETWORK.UNKNOWN_DEVICE` | `network.unknown_device.link` | Yes |
| VLAN Mismatch | exception | `NETWORK.VLAN_MISMATCH` | `network.exception.resolve` | Yes |
| IP Conflict | exception | `NETWORK.IP_CONFLICT` | `network.exception.resolve` | Yes |
| Port Change | history | `NETWORK.PORT_CHANGED` | `network.read` | Maybe |
| VLAN Change | change task | config event | `network.vlan.change` | Controlled |

---

# 22. Network High-Risk Control

For:

```text
network.vlan.change
network.port.configure
network.unknown_device.quarantine
```

Require:

```text
Re-auth
MFA
Change Request
Approval
Verification
Rollback Plan
Audit
```

according to policy.

---

# 23. Software Traceability

### Catalog

Tables:

```text
software.software_products
software.software_versions
```

Events:

```text
SOFTWARE.CATALOG_ITEM_CREATED
SOFTWARE.VERSION_CREATED
SOFTWARE.CLASSIFICATION_CHANGED
SOFTWARE.CATALOG_VISIBILITY_CHANGED
SOFTWARE.CATALOG_VERSION_PUBLISHED
SOFTWARE.CATALOG_VERSION_WITHDRAWN
SOFTWARE.REQUESTED
SOFTWARE.APPROVED
```

### Deployment

Tables:

```text
software.deployments
software.deployment_targets
software.software_installations
software.deployment_attempts
```

Commands:

```text
SOFTWARE.DEPLOY
SOFTWARE.RETRY_DEPLOYMENT
SOFTWARE.REMOVE
```

Events:

```text
SOFTWARE.INSTALL_STARTED
SOFTWARE.INSTALLED
SOFTWARE.INSTALL_FAILED
SOFTWARE.DEPLOYMENT_CAMPAIGN_CREATED
SOFTWARE.DEPLOYMENT_CAMPAIGN_STARTED
SOFTWARE.DEPLOYMENT_JOB_QUEUED
SOFTWARE.DEPLOYMENT_JOB_CLAIMED
SOFTWARE.DEPLOYMENT_PRECHECK_COMPLETED
SOFTWARE.DEPLOYMENT_ARTIFACT_VERIFIED
SOFTWARE.INSTALLATION_REPORTED
SOFTWARE.INSTALLATION_VERIFIED
SOFTWARE.DEPLOYMENT_FAILED
SOFTWARE.DEPLOYMENT_SECURITY_FAILURE
SOFTWARE.DEPLOYMENT_CAMPAIGN_STOPPED
SOFTWARE.REMOVED
```

---

# 24. Artifact Traceability

### Tables

```text
artifact.artifact_versions
artifact.artifact_scan_results
```

### Storage

```text
binary → object storage
metadata → relational
```

### Events

```text
ARTIFACT.UPLOADED
ARTIFACT.SIGNATURE_VALIDATED
ARTIFACT.SCAN_REVIEW_REQUIRED
ARTIFACT.SCAN_PASSED
ARTIFACT.SCAN_FAILED
ARTIFACT.APPROVED
ARTIFACT.REJECTED
ARTIFACT.ACTIVATED
ARTIFACT.RESTRICTED
ARTIFACT.REVOKED
ARTIFACT.INTEGRITY_MISMATCH
```

### Permissions

```text
artifact.upload
artifact.scan.review
artifact.approve
artifact.revoke
```

---

# 25. License Traceability

| Capability | Tables | Event | Permission |
|---|---|---|---|
| Entitlement + terms | `license_entitlements`, entitlement history | `LICENSE.ENTITLEMENT_CREATED`, `LICENSE.ENTITLEMENT_UPDATED`, `LICENSE.RENEWED`, `LICENSE.EXPIRED` | `license.entitlement.manage` |
| Pool | `license_pools` | `LICENSE.POOL_CREATED`, `LICENSE.POOL_UPDATED` | `license.pool.manage` |
| Reservation | `deployment_reservations` | `LICENSE.RESERVED`, `LICENSE.RESERVATION_RELEASED` | Software application contract |
| Assignment | `assignments`, assignment history | `LICENSE.ASSIGNED`, `LICENSE.ASSIGNMENT_CANCELLED` | `license.assign` |
| Activation | assignment | `LICENSE.ACTIVATED` | system/integration or `license.assign` |
| Reclaim | assignment/history | `LICENSE.RECLAIM_PENDING`, `LICENSE.RECLAIMED` | `license.reclaim` |
| Usage evidence | `usage_observations` | `LICENSE.USAGE_OBSERVED` | `license.compliance.resolve` |
| Overuse | calculated projection | `LICENSE.OVERUSED` | `license.read` |
| Expiry | entitlement | `LICENSE.EXPIRING` | `license.read` |

---

# 26. License Core Invariant

Never collapse:

```text
Entitlement
Assignment
Installation
Usage
```

into one record.

---

# 27. Procurement Traceability

### Request

```text
procurement.procurement_requests
procurement.procurement_request_lines
```

Command:

```text
PROCUREMENT.SUBMIT
```

Event:

```text
PROCUREMENT.REQUESTED
```

### Approval

Event:

```text
PROCUREMENT.APPROVED
```

### RFQ

```text
procurement.rfqs
procurement.quotations
```

### PO

```text
procurement.purchase_orders
procurement.purchase_order_lines
```

Events:

```text
PO.CREATED
PO.ISSUED
PO.AMENDED
```

---

# 28. Goods Receipt Traceability

### Tables

```text
procurement.goods_receipts
procurement.goods_receipt_lines
procurement.received_serials
```

### Events

```text
GOODS.RECEIVING_STARTED
GOODS.RECEIVED
GOODS.RECEIVING_EXCEPTION
PO.PARTIALLY_RECEIVED
PO.FULLY_RECEIVED
```

### Downstream

```text
Create Assets
Tag Assets
Put Away
Update PO quantity
```

---

# 29. Invoice Traceability

### Tables

```text
procurement.invoices
procurement.invoice_lines
procurement.invoice_match_results
```

### DB constraint

```text
UNIQUE(tenant_id, supplier_id, invoice_number)
```

### Events

```text
INVOICE.RECEIVED
INVOICE.DUPLICATE_DETECTED
INVOICE.MATCH_STARTED
INVOICE.MATCHED
INVOICE.MISMATCH
INVOICE.APPROVED
INVOICE.PAID
```

---

# 30. Contract Traceability

### Tables

```text
contract.contracts
contract.contract_coverages
contract.renewals
```

### Commands

```text
CONTRACT.ACTIVATE
CONTRACT.START_RENEWAL
CONTRACT.RENEW
CONTRACT.TERMINATE
```

### Events

```text
CONTRACT.CREATED
CONTRACT.ACTIVE
CONTRACT.EXPIRING
CONTRACT.RENEWAL_STARTED
CONTRACT.RENEWED
CONTRACT.TERMINATED
```

---

# 31. Document Traceability

### Tables

```text
document.documents
document.document_versions
document.document_links
```

### Storage

```text
binary in object storage
```

### Events

```text
DOCUMENT.CREATED
DOCUMENT.VERSION_CREATED
DOCUMENT.SIGNED
DOCUMENT.EXPIRING
DOCUMENT.SUPERSEDED
```

### Audit

Signed versions immutable.

---

# 32. Search Traceability

### Searchable entities

```text
Asset
User
Ticket
Incident
Service
Location
IP
MAC
Software
PO
Invoice
Contract
Knowledge
```

### Update source

```text
Domain Events
```

### Guardrails

```text
search != canonical
RBAC filter mandatory
exact identifier > fuzzy
```

---

# 33. Audit Traceability

### Tables

```text
audit.audit_events
audit.audit_event_changes
audit.audit_event_relations
audit.audit_evidence_links
audit.audit_redactions
```

### Required coverage

```text
state change
high-risk action
RBAC change
approval
manual override
financial mutation
signed document
network configuration
```

---

# 34. Timeline Traceability

### Table

```text
operations.timeline_events
```

### Source

```text
domain event
audit event
message
document milestone
```

### Default projected entities

```text
Asset
Ticket
Incident
User
```

---

# 35. Notification Traceability

### Tables

```text
communication.notifications
communication.notification_deliveries
communication.preferences
communication.templates
```

### Events

```text
NOTIFICATION.CREATED
NOTIFICATION.SENT
NOTIFICATION.DELIVERED
NOTIFICATION.FAILED
NOTIFICATION.ACKNOWLEDGED
```

### Channels by phase

```text
P1: Portal + Email
P2/P3: Teams/Slack
P5: Push/SMS if justified
```

---

# 36. Feature-to-Permission Matrix

| Feature | Primary Permission |
|---|---|
| Asset Create | `asset.create` |
| Asset Assign | `asset.assign` |
| Asset Transfer | `asset.transfer` |
| Asset Return | `asset.receive_return` |
| Asset Dispose | `asset.dispose` |
| Ticket Assign | `ticket.assign` |
| Ticket Resolve | `ticket.resolve` |
| Major Incident | `incident.declare_major` |
| Maintenance Complete | `maintenance.complete` |
| Audit Resolve | `audit.exception.resolve` |
| Network Discovery | `network.discovery.run` |
| VLAN Change | `network.vlan.change` |
| Software Deploy | `software.deploy` |
| Artifact Approve | `artifact.approve` |
| License Reclaim | `license.reclaim` |
| Procurement Approve | `procurement.approve` |
| PO Issue | `po.issue` |
| Invoice Exception | `invoice.approve_exception` |
| Contract Renew | `contract.renew` |
| Privileged Role Grant | `role_binding.privileged_grant` |

---

# 37. Feature-to-State Machine Matrix

| Feature | State Machine |
|---|---|
| Asset Assignment | Asset Lifecycle + Assignment |
| Asset Return | Asset Lifecycle + Assignment |
| Ticket Handling | Ticket |
| Incident | Incident |
| Problem | Problem |
| Change | Change |
| Maintenance | Maintenance |
| Warranty | Warranty |
| Replacement | Replacement |
| Audit | Audit + Audit Exception |
| Network Exception | Network Exception |
| Software Request | Software Request |
| Deployment | Deployment |
| Artifact | Artifact |
| License Assignment | License Assignment |
| Procurement | Procurement Request |
| PO | Purchase Order |
| Invoice | Invoice |
| Contract | Contract |
| User | User Lifecycle |
| Approval | Approval |
| SLA | SLA |
| Work Queue | Work Item |

---

# 38. Feature-to-Work-Queue Matrix

| Source | Creates Work Item When |
|---|---|
| Ticket | Human handling required |
| Incident | Investigation/mitigation required |
| Agent | Recovery failed |
| Asset | Return overdue / exception |
| Maintenance | Waiting/action required |
| Audit | Exception unresolved |
| Network | Unknown/mismatch/conflict |
| Software | Unauthorized/install failure |
| License | Overuse/reclaim/expiry action |
| Approval | Decision required |
| Procurement | Exception/action required |
| Contract | Renewal/expiry action |
| Automation | Human fallback |

---

# 39. Feature-to-Audit Matrix

High-risk mandatory audit:

```text
RBAC changes
Asset disposal
Data wipe
Network configuration
Approval decisions
Invoice exceptions
Contract termination
Artifact approval/revoke
Automation rule activation
Manual override
Sensitive export
```

Standard audit:

```text
Asset assignment
Asset transfer
Ticket resolution
Maintenance completion
Audit exception resolution
License reclaim
PO issue
```

---

# 40. Feature-to-Timeline Matrix

Project to Asset Timeline:

```text
Assignment
Transfer
Return
Maintenance
Audit
Network exception
Software deploy
License action
Warranty
Replacement
Disposal
Documents
```

Project to User Timeline:

```text
Identity lifecycle
Role change
Asset assignment/return
License assignment/reclaim
Offboarding
```

Project to Ticket Timeline:

```text
messages
assignment
state
incident link
approval
SLA
resolution
```

---

# 41. Feature-to-Notification Matrix

| Feature | Notify |
|---|---|
| Ticket Created | Requester |
| Waiting User | Requester |
| Ticket Resolved | Requester |
| Asset Assignment | User |
| Asset Return Request | User/Manager |
| Major Incident | Affected audience |
| SLA Breach | Owner/Manager |
| Approval Required | Approver |
| Warranty Expiring | Asset owner/team |
| License Expiring | License owner |
| Contract Expiring | Contract owner |
| Procurement Approval | Approver |
| Automation Human Fallback | Ops owner |

---

# 42. Feature-to-Search Matrix

| Entity | Exact Fields | Text Fields |
|---|---|---|
| Asset | code, tag, serial, hostname | model, owner, location |
| User | email, username, employee code | name, department |
| Ticket | ticket code | summary, description |
| Incident | incident code | title, service |
| Network | IP, MAC | hostname/vendor |
| Software | product/version | aliases/vendor |
| PO | PO code | supplier/line |
| Invoice | invoice number | supplier |
| Contract | contract code | title/supplier |

---

# 43. Feature-to-Storage Matrix

| Data | Store |
|---|---|
| Canonical Business Data | PostgreSQL |
| Raw Metrics | TSDB |
| Agent Heartbeats | TSDB/current projection |
| Documents | Object Storage |
| Artifacts | Object Storage |
| Search | Search Index / PostgreSQL MVP |
| Cache | Redis/Valkey |
| Domain Events | Broker + Outbox |
| Audit | Append-only Relational + Archive |
| Analytics | Reporting store / warehouse later |

---

# 44. Feature-to-Idempotency Matrix

Critical commands requiring idempotency:

```text
Create Ticket
Assign Asset
Return Asset
Create Maintenance
Start Deployment
Assign/Reclaim License
Create Procurement Request
Create PO
Create Invoice
Create Approval
Bulk Import
Webhook Intake
```

---

# 45. Feature-to-Concurrency Matrix

Require optimistic concurrency or DB invariant:

```text
Asset Assignment
Reservation
Ticket Assignment
Approval Decision
License Allocation
PO Amendment
Invoice Creation
State Transition
```

---

# 46. Feature-to-Error Recovery Matrix

| Feature | Retry | Compensation |
|---|---|---|
| Notification | Yes | Channel fallback |
| Search Index | Yes | Rebuild |
| Asset Assign | Idempotent retry | End assignment if business cancellation |
| Software Deploy | Limited | Rollback / reclaim license |
| VLAN Change | No blind retry | Restore previous VLAN |
| Invoice Import | Yes with key | None; prevent duplicate |
| Data Wipe | Reconcile first | Manual recovery |
| Agent Action | Limited | Human fallback |

---

# 47. Feature-to-Metric Matrix

## Helpdesk

```text
FRT
MTTR
SLA breach
reopen
reassignment
duplicate ticket
```

## Asset

```text
assignment accuracy
unknown owner
unknown location
return overdue
inventory accuracy
```

## Incident

```text
MTTA
MTTR
correlation ratio
duplicate suppression
```

## Automation

```text
success
rollback
human fallback
false positive
```

## License

```text
utilization
overuse
reclaim
expiry
```

---

# 48. Phase 0 Implementation Checklist

```text
[ ] Repo structure
[ ] DB migrations
[ ] OIDC
[ ] User model
[ ] RBAC
[ ] Permission evaluator
[ ] Error envelope
[ ] Idempotency ledger
[ ] Outbox
[ ] Inbox
[ ] Audit append-only
[ ] Correlation ID
[ ] Operation registry
[ ] Metrics/logs/traces
[ ] Backup/restore
```

---

# 49. Phase 1 Implementation Checklist

```text
[ ] Asset tables
[ ] Location hierarchy
[ ] Assignment constraint
[ ] Movement history
[ ] Ticket tables
[ ] Ticket state machine
[ ] Asset state machine
[ ] Work Queue
[ ] Asset Timeline
[ ] Ticket Timeline
[ ] Portal ticket intake
[ ] Email intake
[ ] Notifications
[ ] Handover document
[ ] Basic search
[ ] E2E ticket slice
[ ] E2E assignment slice
```

---

# 50. Phase 2 Implementation Checklist

```text
[ ] Monitoring normalization
[ ] Agent service
[ ] Incident
[ ] Correlation
[ ] Root Incident
[ ] Major Incident
[ ] SLA
[ ] Approval
[ ] Maintenance
[ ] Safe automation
[ ] Operations Overview
[ ] Auto-enrichment
[ ] Human fallback
```

---

# 51. Phase 3 Implementation Checklist

```text
[ ] Asset Audit
[ ] QR observation
[ ] Network Discovery
[ ] IP/MAC/VLAN
[ ] Network exception
[ ] Software Catalog
[ ] Artifact Repository
[ ] Deployment
[ ] Unauthorized software
[ ] License entitlement
[ ] License assignment/reclaim
[ ] Warranty
[ ] Replacement
[ ] Dedicated search if justified
```

---

# 52. Phase 4 Implementation Checklist

```text
[ ] Supplier
[ ] Procurement Request
[ ] RFQ
[ ] Quote
[ ] PO
[ ] Goods Receipt
[ ] Partial Receipt
[ ] Invoice
[ ] 3-Way Match
[ ] Contract
[ ] Renewal
[ ] Document governance
[ ] Asset cost linkage
[ ] License cost linkage
```

---

# 53. Phase 5 Implementation Checklist

```text
[ ] Advanced Rules Engine
[ ] Controlled automation
[ ] Risk scoring
[ ] Replacement scoring
[ ] Knowledge deflection
[ ] Advanced correlation
[ ] Analytics warehouse if justified
[ ] Executive KPI
[ ] Explainable recommendations
```

---

# 54. First Vertical Slice Traceability

## User Ticket → Resolve

```text
Feature:
Ticket Intake + Processing

Workflow:
WF-002

Entities:
User
Ticket
Message
Asset
Work Item

Tables:
identity.users
helpdesk.tickets
helpdesk.ticket_messages
asset.assignments
operations.work_items
audit.audit_events
operations.timeline_events

API:
POST /tickets
GET /tickets/{id}
POST /tickets/{id}/commands/assign
POST /tickets/{id}/commands/resolve

Commands:
TICKET.CREATE
TICKET.ASSIGN
TICKET.RESOLVE

Events:
TICKET.CREATED
TICKET.ENRICHED
WORK_ITEM.CREATED
TICKET.ASSIGNED
TICKET.RESOLVED
WORK_ITEM.RESOLVED

Permissions:
ticket.create
ticket.read
ticket.assign
ticket.resolve

State:
NEW → TRIAGE → ASSIGNED → IN_PROGRESS → RESOLVED

Audit:
Ticket create
assignment
resolution

Timeline:
created
assigned
resolved

Notification:
ticket created
ticket resolved

Search:
ticket code
requester
summary

Metric:
FRT
resolution time

Phase:
P1
```

---

# 55. Second Vertical Slice Traceability

## Asset Assignment

```text
Workflow:
WF-006

Tables:
assets
assignments
movements
documents
audit
timeline

API:
POST /assets/{id}/commands/assign

Command:
ASSET.ASSIGN

Event:
ASSET.ASSIGNED

Permission:
asset.assign

State:
AVAILABLE/RESERVED → ASSIGNED → IN_USE

Audit:
mandatory

Timeline:
Asset + User

Notification:
User

Document:
Handover
```

---

# 56. Third Vertical Slice Traceability

## Monitoring → Root Incident

```text
Workflow:
WF-003 + WF-020

Input:
MONITORING.CRITICAL

Entities:
Monitor Event
Incident
Root Incident
Ticket
Work Item

Commands:
INCIDENT.CREATE
INCIDENT.CORRELATE
INCIDENT.CREATE_ROOT

Events:
INCIDENT.CREATED
INCIDENT.CORRELATED
INCIDENT.ROOT.CREATED

Permission:
incident.create
incident.correlate

Work Queue:
Incident work item

Metric:
alert-to-incident
duplicate suppression
MTTA
```

---

# 57. Fourth Vertical Slice Traceability

## Agent Offline → Auto Recovery

```text
Workflow:
WF-004

Input:
AGENT.OFFLINE_THRESHOLD

Automation:
Restart agent service

Verification:
Agent online

Success Event:
AGENT.ONLINE

Failure:
AUTOMATION.HUMAN_FALLBACK

Work Queue:
Agent recovery failure

Audit:
Automation actor + rule version

Timeline:
"Automatic recovery succeeded/failed"
```

---

# 58. Traceability Quality Gates

Before coding a feature, all must exist:

```text
[ ] Workflow ID
[ ] Domain owner
[ ] Entity model
[ ] State machine
[ ] Permission
[ ] API/command
[ ] Event
[ ] Idempotency strategy
[ ] Audit rule
[ ] Error behavior
```

---

# 59. Code Complete Gate

Before marking `CODE_COMPLETE`:

```text
[ ] DB migration
[ ] Domain logic
[ ] API
[ ] Authorization
[ ] Events
[ ] Idempotency
[ ] Audit
[ ] Unit tests
[ ] Contract tests
```

---

# 60. Integration Test Gate

Before marking `INTEGRATION_TEST` complete:

```text
[ ] Event consumer works
[ ] Timeline projection works
[ ] Notification works
[ ] Failure path tested
[ ] Duplicate retry tested
[ ] Version conflict tested
[ ] Observability visible
```

---

# 61. Pilot Gate

Before `PILOT`:

```text
[ ] Backup restore tested
[ ] Runbook exists
[ ] Security test passed
[ ] Tenant/scope test passed
[ ] Data migration reconciled
[ ] Key KPI dashboard exists
[ ] Pilot users trained
```

---

# 62. Production Gate

Before `PRODUCTION`:

```text
[ ] No critical data-integrity defect
[ ] No unresolved audit gap
[ ] SLO dashboards active
[ ] DLQ monitored
[ ] Retry/circuit policies active
[ ] Security review signed off
[ ] Rollback plan tested
```

---

# 63. Traceability Change Control

When changing:

```text
Workflow
State
Permission
Event
API
```

must review downstream mappings.

Example:

```text
Change Asset RETURNED semantics
```

review:

```text
Asset State Machine
API command
Events
Timeline
Audit
Search
Reporting
Automation
```

---

# 64. Cross-Spec Impact Matrix

| Change Type | Must Review |
|---|---|
| New State | State, API, Events, Search, Reporting |
| New Command | API, Permission, Audit, Idempotency |
| New Event | Event Catalog, Consumers, Timeline, Reporting |
| New Permission | RBAC, API, UI Actions, Audit |
| New Entity | Data Model, Storage, Search, Audit |
| New Integration | Error, Retry, Secret, Audit |
| New Automation | Permission, Safety, Approval, Rollback |

---

# 65. Ownership Matrix

| Area | Owner |
|---|---|
| Identity/RBAC | Identity Team |
| Asset | Asset Operations |
| Helpdesk | Service Desk |
| Incident | IT Operations |
| Maintenance | Asset Operations |
| Network | Network Team |
| Software/Artifact | Endpoint/Software Team |
| License | License/Asset Team |
| Procurement | Procurement/Finance |
| Contract | Procurement/Legal/Owner |
| Approval/SLA/Automation | Platform/Control Plane |
| Audit | Platform/Security |
| Search | Platform |
| Reporting | Platform/Data |

---

# 66. Implementation Status Matrix Template

Use this as live tracking table:

```markdown
| Feature ID | Feature | Phase | Status | Owner | Blocker | PR/Issue | Test | Pilot | Notes |
|---|---|---|---|---|---|---|---|---|---|
```

---

# 67. Recommended Issue Template

```markdown
# Feature

## Traceability
- Feature ID:
- Workflow:
- Domain:
- Phase:

## Data
- Tables:
- Constraints:

## API
- Endpoint:
- Command:

## State
- Current:
- Target:

## Permission
- Required:

## Events
- Produced:
- Consumed:

## Audit / Timeline
- Audit:
- Timeline:

## Idempotency
- Key:

## Errors
- Codes:

## Tests
- Unit:
- Integration:
- E2E:

## Observability
- Metrics:
- Logs:
- Alerts:
```

---

# 68. Recommended Pull Request Checklist

```text
[ ] No direct cross-domain table write
[ ] State transition uses command
[ ] Permission checked server-side
[ ] Idempotency implemented where required
[ ] Unique constraints added
[ ] Event emitted after commit
[ ] Audit written
[ ] Timeline mapping added if needed
[ ] Error code documented
[ ] Tests added
[ ] Metrics/logging added
[ ] Migration rollback considered
```

---

# 69. Recommended Architecture Decision Log

When implementation deviates from spec, create ADR:

```text
ADR ID
Decision
Context
Alternatives
Why chosen
Impact
Migration path
```

Do not silently drift from master specs.

---

# 70. Feature Completion Scoring

Optional internal scoring:

```text
Data Model          10%
API/Command         15%
Authorization       10%
State Machine       10%
Events              10%
Audit/Timeline      10%
Error/Idempotency   10%
Tests               15%
Observability       5%
Documentation       5%
```

Feature is not done if critical category is missing even if score appears high.

---

# 71. MVP Critical Path

Strict critical path:

```text
Identity/RBAC
↓
Platform Command Framework
↓
Asset
↓
Ticket
↓
Work Queue
↓
Timeline
↓
Notifications
↓
Basic Search
```

---

# 72. Operational Critical Path

To become real IT Operations Hub:

```text
Monitoring
↓
Agent
↓
Incident
↓
Correlation
↓
SLA
↓
Maintenance
↓
Automation
```

---

# 73. Governance Rule

No new feature enters sprint unless traceability row exists.

Minimum row:

```text
Feature
Workflow
Tables
API
Command
Event
Permission
State
Audit
Phase
```

---

# 74. Guardrails

System implementation must not:

1. Mark feature complete when only UI/API exists.
2. Implement state mutation without state-machine mapping.
3. Add command without permission mapping.
4. Add event without owner and consumer contract.
5. Add business write without idempotency review.
6. Add new table without owner domain.
7. Add high-risk action without audit.
8. Add Work Item as duplicate business state.
9. Add search field containing secret/sensitive data without review.
10. Add automation without safety/rollback/human fallback classification.
11. Split service without operational reason.
12. Bypass master traceability when implementation changes.
13. Let phase scope silently expand without dependency review.
14. Promote to production without failure-path testing.
15. Lose traceability between requirement and code.

---

# 75. Recommended Next Artifact

After this matrix, the next implementation artifact should be:

```text
BACKEND REPOSITORY + MODULE STRUCTURE SPEC
```

to define:

```text
repo layout
module boundaries
application/domain/infrastructure layers
migration folders
event handlers
API controllers
command handlers
test structure
shared libraries
dependency rules
```

This would be the direct bridge from architecture documentation to actual codebase initialization.

---

# 76. Definition of Done

Master Implementation Traceability Matrix đạt yêu cầu khi:

- Every major feature has a Feature ID.
- Every feature maps to workflow and domain owner.
- Tables/entities are identified.
- API/commands are identified.
- Produced events are identified.
- Permission codes are identified.
- State-machine dependencies are identified.
- Audit/timeline requirements are identified.
- Work Queue/notification/search impacts are visible.
- Phase and priority are defined.
- Testing and production gates are defined.
- Vertical slices are traceable end-to-end.
- Change-control impact rules are explicit.
- Implementation status can be tracked from this document.
