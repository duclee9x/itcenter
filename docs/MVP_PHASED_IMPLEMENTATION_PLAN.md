# MVP + PHASED IMPLEMENTATION PLAN
## IT Operations Hub — Build Order, Dependencies, Scope, and Delivery Roadmap

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`  
**Depends on:**  
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

**Purpose:** Convert the complete architecture/specification set into an executable implementation roadmap with phased scope, dependency order, service boundaries, schema delivery, API/event/state-machine milestones, integration checkpoints, testing requirements, migration strategy, and Definition of Done.

---

# 1. Mục tiêu

Tài liệu này trả lời:

```text
Build cái gì trước?
Build cái gì sau?
Dependency nào phải có trước?
MVP tối thiểu gồm những gì?
Khi nào một phase được coi là hoàn thành?
Khi nào nên tách service?
Khi nào nên thêm search engine / analytics / automation?
```

Nguyên tắc chính:

```text
Build operational backbone first
→ then add automation
→ then add intelligence
```

Không bắt đầu bằng:

```text
microservice explosion
AI everywhere
complex analytics
full CMDB graph
multi-region
```

khi core workflow chưa ổn định.

---

# 2. Target Product Shape

Sản phẩm cuối hướng tới:

```text
IT Operations Hub
```

với luồng:

```text
Signal / Request
→ Identify Context
→ Enrich
→ Correlate
→ Decide
→ Execute
→ Update
→ Audit / Timeline / KPI
```

Người vận hành làm việc qua:

```text
Operations Overview
→ Attention Center
→ Work Queue
→ Context
→ Action
```

không phải nhảy giữa hàng loạt module rời rạc.

---

# 3. Delivery Philosophy

Ưu tiên:

```text
1. Data integrity
2. Workflow correctness
3. Operator speed
4. Auditability
5. Automation
6. Intelligence
```

Không đảo thứ tự.

---

# 4. Phase Overview

```text
PHASE 0 — Platform Foundation
PHASE 1 — Helpdesk + Asset Core MVP
PHASE 2 — Operations + Monitoring + Maintenance
PHASE 3 — Audit + Network + Software + License
PHASE 4 — Procurement + Supplier + Contract + Finance Links
PHASE 5 — Automation + Intelligence + Advanced Reporting
```

---

# 5. Phase Dependency Graph

```text
PHASE 0
   ↓
PHASE 1
   ↓
PHASE 2
   ↓
PHASE 3
   ↓
PHASE 4
   ↓
PHASE 5
```

Một số workstream có thể song song, nhưng canonical data + auth + event + audit foundation phải đi trước.

---

# 6. PHASE 0 — PLATFORM FOUNDATION

## Objective

Tạo nền móng để mọi domain sau dùng chung:

```text
Identity
Authorization
API conventions
Database
Eventing
Audit
Operations framework
```

---

# 7. Phase 0 Deliverables

Core components:

```text
Authentication
User / Identity
RBAC
Tenant / Organization context
PostgreSQL
Domain schemas
API Gateway
Command framework
Event Outbox
Event Bus
Consumer Inbox
Idempotency
Audit framework
Operation registry
Error standard
Observability
```

---

# 8. Phase 0 Service Boundaries

Recommended initial logical services:

```text
identity-service
platform-api
audit-service
notification-service
```

Can initially deploy as:

```text
modular monolith
```

with strict package/domain boundaries.

---

# 9. Phase 0 Database Schemas

Create:

```text
identity
control
communication
platform
audit
```

---

# 10. Phase 0 Core Tables

Minimum:

```text
identity.users
identity.external_identities
identity.roles
identity.permissions
identity.role_permissions
identity.role_bindings

platform.idempotency_records
platform.outbox_events
platform.inbox_events
platform.operations

audit.audit_events
audit.audit_event_relations
audit.audit_evidence_links
```

---

# 11. Phase 0 API

Minimum:

```text
GET /me
GET /users/{id}
GET /roles
POST /authorization/evaluate

GET /operations/{id}
GET /audit-events
```

---

# 12. Phase 0 Core Events

```text
USER.CREATED
USER.UPDATED
USER.SUSPENDED
USER.TERMINATED

RBAC.BINDING_CREATED
RBAC.BINDING_REVOKED

OPERATION.RETRY_EXHAUSTED
```

---

# 13. Phase 0 State Machines

Implement:

```text
User Lifecycle
Operation State
Approval skeleton
```

---

# 14. Phase 0 Infrastructure

Recommended MVP stack:

```text
PostgreSQL
Redis/Valkey
Event Broker
Object Storage
OpenTelemetry
Prometheus
Grafana
Loki
Tempo/Jaeger
```

Search engine can wait.

---

# 15. Phase 0 Security

Must have:

```text
OIDC
RBAC
Tenant scope
TLS
Secret Manager references
Audit for privileged actions
No shared admin credential
```

---

# 16. Phase 0 Testing

Must cover:

```text
login
permission allow/deny
tenant isolation
idempotent command
version conflict
outbox publish
consumer dedupe
audit persistence
```

---

# 17. Phase 0 Definition of Done

Phase 0 complete when:

- User can authenticate.
- RBAC works server-side.
- Tenant/scope isolation works.
- API error contract is consistent.
- Idempotency works.
- Outbox/inbox works.
- Audit records are append-only.
- Correlation ID propagates.
- Basic observability exists.
- CI/CD and migration pipeline exist.
- Secrets are not stored in application config/database directly.
- Core service health is monitored.

---

# 18. PHASE 1 — HELPDESK + ASSET CORE MVP

## Objective

Deliver usable operational system for:

```text
User
Asset
Ticket
Assignment
Movement
Work Queue
Timeline
```

This is the first phase that should be usable by real Helpdesk.

---

# 19. Phase 1 Primary User Stories

End user:

```text
Create Ticket
View Ticket
Reply
Track status
```

Helpdesk:

```text
Receive Ticket
See user context
See assigned asset
Assign ticket
Resolve ticket
```

Asset operator:

```text
Create/receive asset
Assign asset
Transfer asset
Request return
Receive return
View asset timeline
```

---

# 20. Phase 1 Service Boundaries

Recommended logical domains:

```text
helpdesk
asset
work-queue
timeline
```

Can remain same deployable unit initially.

---

# 21. Phase 1 Database Schemas

Add:

```text
asset
helpdesk
operations
```

---

# 22. Phase 1 Core Tables — Asset

```text
asset.assets
asset.asset_models
asset.asset_categories
asset.locations
asset.assignments
asset.movements
asset.asset_state_history
asset.asset_external_refs
```

---

# 23. Phase 1 Core Tables — Helpdesk

```text
helpdesk.tickets
helpdesk.ticket_messages
helpdesk.ticket_relations
```

---

# 24. Phase 1 Core Tables — Operations

```text
operations.work_items
operations.timeline_events
operations.timeline_projection_checkpoints
```

---

# 25. Phase 1 Asset State Machines

Implement:

```text
Asset Lifecycle
Assignment State
Operational State
Health State
```

Initial lifecycle:

```text
RECEIVED
AVAILABLE
RESERVED
ASSIGNED
IN_USE
RETURNED
RETIRED
```

Can defer full disposal workflow to later if needed.

---

# 26. Phase 1 Ticket State Machine

Implement:

```text
NEW
TRIAGE
ASSIGNED
IN_PROGRESS
WAITING_USER
RESOLVED
CLOSED
REOPENED
CANCELLED
```

---

# 27. Phase 1 APIs — Asset

```text
GET  /assets
POST /assets
GET  /assets/{id}

POST /assets/{id}/commands/reserve
POST /assets/{id}/commands/assign
POST /assets/{id}/commands/transfer
POST /assets/{id}/commands/request-return
POST /assets/{id}/commands/receive-return

GET /assets/{id}/timeline
```

---

# 28. Phase 1 APIs — Helpdesk

```text
GET  /tickets
POST /tickets
GET  /tickets/{id}

POST /tickets/{id}/commands/assign
POST /tickets/{id}/commands/request-info
POST /tickets/{id}/commands/resolve
POST /tickets/{id}/commands/reopen
```

---

# 29. Phase 1 APIs — Work Queue

```text
GET /work-items
POST /work-items/{id}/commands/assign
POST /work-items/{id}/commands/start
POST /work-items/{id}/commands/resolve
```

---

# 30. Phase 1 Core Events

```text
TICKET.CREATED
TICKET.ASSIGNED
TICKET.STATE_CHANGED
TICKET.RESOLVED

ASSET.CREATED
ASSET.RESERVED
ASSET.ASSIGNED
ASSET.TRANSFERRED
ASSET.RETURN_REQUESTED
ASSET.RETURNED
ASSET.STATE_CHANGED

WORK_ITEM.CREATED
WORK_ITEM.ASSIGNED
WORK_ITEM.RESOLVED
```

---

# 31. Phase 1 Search

Can use PostgreSQL initially.

Search:

```text
Asset Code
Asset Tag
Serial
User
Email
Ticket Code
Hostname
```

No dedicated search engine required yet.

---

# 32. Phase 1 Asset Workspace

Minimum Asset Workspace sections:

```text
Identity
Current Owner
Location
Lifecycle
Health
Open Tickets
Timeline
Available Actions
```

---

# 33. Phase 1 Ticket Context

When ticket opens, show:

```text
Requester
Department
Location
Assigned Assets
Ticket History
Open Related Tickets
```

---

# 34. Phase 1 Work Queue

Sources:

```text
Tickets
Asset returns
Assignment tasks
Manual asset exceptions
```

Work Item is projection/reference, not source-of-truth.

---

# 35. Phase 1 Audit

Audit:

```text
Asset create
Asset assignment
Asset transfer
Asset return
Ticket assignment
Ticket resolution
Manual override
```

---

# 36. Phase 1 Notifications

Minimum:

```text
Ticket created
Ticket assigned
Waiting for user
Ticket resolved
Asset return request
Asset assignment confirmation
```

Channels:

```text
Portal
Email
```

Teams/Slack can wait.

---

# 37. Phase 1 Documents

Minimum:

```text
Asset Handover
Asset Return
```

Generated PDF/document with immutable version after signing/confirmation.

---

# 38. Phase 1 Data Integrity

Must enforce:

```text
One active primary assignment per asset
Asset tag uniqueness
Ticket code uniqueness
No assignment of disposed/invalid asset
Idempotent assign/return
```

---

# 39. Phase 1 Definition of Done

Phase 1 complete when:

- End user can submit and track ticket.
- Helpdesk can process ticket end-to-end.
- Asset operator can assign/return/transfer assets.
- Asset Workspace shows canonical current state.
- Work Queue shows actionable work.
- Timeline displays meaningful history.
- Assignment duplicate prevention works.
- Ticket/Asset audit trail works.
- Core notification flow works.
- Helpdesk can operate without manually updating multiple linked records.

---

# 40. PHASE 2 — OPERATIONS + MONITORING + MAINTENANCE

## Objective

Turn product from basic Helpdesk/Asset system into operational hub.

Add:

```text
Monitoring
Agent
Incident
Correlation
Maintenance
SLA
Approval
Automation Safe Actions
```

---

# 41. Phase 2 User Stories

Helpdesk:

```text
Ticket automatically enriched
Known outage recognized
Duplicate outage tickets correlated
```

IT Ops:

```text
See critical alerts
See agent offline
Auto-remediate safe failures
Manage incident
```

Maintenance:

```text
Create repair order
Diagnose
Repair
Verify
Return asset to service
```

---

# 42. Phase 2 Schemas

Add:

```text
incident
maintenance
monitoring
agent
control.sla
control.approval
control.automation
```

---

# 43. Phase 2 Incident Tables

```text
incident.incidents
incident.incident_entities
incident.incident_tickets
incident.incident_events
```

---

# 44. Phase 2 Maintenance Tables

```text
maintenance.maintenance_orders
maintenance.diagnoses
maintenance.repair_actions
maintenance.part_usages
maintenance.warranties
```

---

# 45. Phase 2 Agent Tables

```text
agent.agents
agent.agent_jobs
agent.agent_job_results
agent.asset_current_inventory
```

High-volume heartbeat stays outside core OLTP or summarized.

---

# 46. Phase 2 Monitoring Ingestion

Pipeline:

```text
Monitoring Source
→ Normalize
→ Event
→ Correlate
→ Incident / Work Item
```

Do not create ticket for every raw alert.

---

# 47. Phase 2 Incident State Machine

Implement:

```text
DETECTED
INVESTIGATING
MITIGATING
MONITORING_RECOVERY
RESTORED
RESOLVED
CLOSED
```

---

# 48. Phase 2 Maintenance State Machine

Implement full:

```text
OPEN
DIAGNOSING
WAITING_APPROVAL
WAITING_PART
WAITING_VENDOR
IN_REPAIR
VERIFYING
COMPLETED
```

---

# 49. Phase 2 SLA

Apply to:

```text
Ticket
Incident
Approval
Maintenance
```

Support:

```text
Start
Pause
Resume
Warning
Critical
Breach
Met
```

---

# 50. Phase 2 Approval

Initial approval cases:

```text
High-cost repair
Asset exception
High-risk automation
Manual override
```

---

# 51. Phase 2 Safe Automation

Allowed initial automations:

```text
Create Work Item
Assign Team
Send Notification
Restart Agent Service
Retry Agent Sync
Close recovered duplicate alert
```

Do not start with network configuration automation.

---

# 52. Phase 2 Core Events

```text
MONITORING.CRITICAL
MONITORING.RECOVERED

AGENT.OFFLINE_THRESHOLD
AGENT.ONLINE

INCIDENT.CREATED
INCIDENT.CORRELATED
INCIDENT.ROOT.CREATED
INCIDENT.MAJOR_DECLARED
INCIDENT.RESTORED
INCIDENT.RESOLVED

MAINTENANCE.CREATED
MAINTENANCE.COMPLETED

SLA.WARNING
SLA.BREACHED

APPROVAL.CREATED
APPROVAL.APPROVED
APPROVAL.REJECTED

AUTOMATION.ACTION_FAILED
AUTOMATION.HUMAN_FALLBACK
```

---

# 53. Phase 2 Ticket Enrichment

Automatic context:

```text
User
Asset
Location
Service
Agent status
Health
Recent incidents
```

---

# 54. Phase 2 Correlation

Initial correlation signals:

```text
service
site
asset group
time window
monitor signature
same dependency
```

---

# 55. Phase 2 Root Incident

Multiple:

```text
Alerts
Tickets
Incidents
```

may link to:

```text
Root Incident
```

Child ticket resolution follows root where appropriate.

---

# 56. Phase 2 Operations Overview

Initial cards:

```text
P1 Incidents
Critical Assets
Agent Offline > Threshold
Tickets Near SLA
Maintenance Waiting
Automation Failures
```

---

# 57. Phase 2 Definition of Done

Phase 2 complete when:

- Monitoring events normalize into canonical events.
- Agent health/status is visible.
- Duplicate outage tickets correlate.
- Root Incident exists.
- SLA timers work.
- Maintenance lifecycle works.
- Safe automation can execute with verification.
- Failed automation falls back to human.
- Operations Overview and Work Queue drive daily work.

---

# 58. PHASE 3 — AUDIT + NETWORK + SOFTWARE + LICENSE

## Objective

Add technical control domains and compliance workflows.

---

# 59. Phase 3 Scope

```text
Asset Audit
Network Discovery
VLAN / IP / MAC
Topology
Software Catalog
Artifact Repository
Deployment
License Entitlement
License Assignment
Usage / Reclaim
Warranty / Replacement
```

---

# 60. Phase 3 Schemas

Add:

```text
audit_ops
network
software
artifact
license
warranty
replacement
```

---

# 61. Phase 3 Audit Tables

```text
audit_ops.audits
audit_ops.audit_expected_assets
audit_ops.audit_observations
audit_ops.audit_exceptions
```

---

# 62. Phase 3 Network Tables

```text
network.network_devices
network.network_interfaces
network.ip_addresses
network.interface_ip_assignments
network.vlans
network.subnets
network.switch_ports
network.network_observations
network.topology_edges
```

---

# 63. Phase 3 Software Tables

```text
software.software_products
software.software_versions
software.software_installations
artifact.artifact_versions
artifact.artifact_scan_results
```

---

# 64. Phase 3 License Tables

```text
license.license_entitlements
license.license_pools
license.license_assignments
license.software_usage_snapshots
```

---

# 65. Phase 3 Audit Workflow

Implement:

```text
Expected Snapshot
→ Observation
→ Compare
→ Exception
→ Resolve
```

Sources:

```text
QR
Agent
Network
Manual
```

---

# 66. Phase 3 Network Discovery

Support:

```text
SNMP
ICMP
ARP/MAC
LLDP/CDP
DHCP
DNS
Agent
API
```

Start with subset supported by environment.

---

# 67. Phase 3 Network Principle

Network observation:

```text
does not overwrite canonical asset state
```

Mismatch creates:

```text
Network Exception
```

---

# 68. Phase 3 Software Catalog

Catalog states:

```text
APPROVED
RESTRICTED
PROHIBITED
UNKNOWN
DEPRECATED
RETIRED
```

---

# 69. Phase 3 Artifact Repository

Flow:

```text
Upload
→ Checksum
→ Scan
→ Review
→ Approve
→ Active
→ Deploy
```

---

# 70. Phase 3 Deployment

Agent workflow:

```text
Precheck
→ Download
→ Verify Artifact
→ Install
→ Postcheck
→ Verify Version
```

---

# 71. Phase 3 License Model

Must separate:

```text
Entitlement
Assignment
Installation
Usage
```

Never merge into one license table.

---

# 72. Phase 3 License Automation

Initial:

```text
Expiry warning
Overuse detection
Unused license candidate
Offboarding reclaim
```

---

# 73. Phase 3 Dedicated Search

Introduce dedicated search engine if needed.

Index:

```text
Assets
Users
Tickets
Incidents
IP
MAC
Serial
Software
PO
Invoice later
```

---

# 74. Phase 3 Duplicate Detection

Add candidate scoring for:

```text
Assets
Users
Tickets
Unknown network devices
```

No automatic fuzzy merge.

---

# 75. Phase 3 Definition of Done

Phase 3 complete when:

- Asset audit works via multiple observation sources.
- Expected vs Observed is explicit.
- Network unknown device/VLAN mismatch workflows work.
- Software catalog and approved artifacts work.
- Deployment verifies actual installed version.
- Unauthorized software can create controlled exception.
- License entitlement/assignment/usage separation works.
- Expiry/overuse/reclaim flows work.
- Dedicated search supports exact and fuzzy operational lookup.

---

# 76. PHASE 4 — PROCUREMENT + SUPPLIER + CONTRACT + FINANCIAL CONTROL

## Objective

Connect operational IT work to commercial lifecycle.

---

# 77. Phase 4 Scope

```text
Procurement Request
Supplier
RFQ
Quotation
Purchase Order
Goods Receipt
Invoice
3-Way Match
Contract
Renewal
Document Governance
```

---

# 78. Phase 4 Schemas

Add:

```text
procurement
supplier
contract
finance_integration
```

---

# 79. Phase 4 Procurement Tables

```text
procurement.procurement_requests
procurement.procurement_request_lines
procurement.rfqs
procurement.quotations
procurement.purchase_orders
procurement.purchase_order_lines
procurement.goods_receipts
procurement.goods_receipt_lines
```

---

# 80. Phase 4 Invoice Tables

```text
procurement.invoices
procurement.invoice_lines
procurement.invoice_match_results
```

---

# 81. Phase 4 Contract Tables

```text
contract.contracts
contract.contract_coverages
contract.contract_versions
contract.renewal_cases
document.documents
document.document_versions
document.document_links
```

---

# 82. Phase 4 Supplier Tables

```text
supplier.suppliers
supplier.contacts
supplier.evaluations
```

---

# 83. Phase 4 Procurement Workflow

```text
Request
→ Budget/Stock Check
→ RFQ
→ Quote
→ Supplier Selection
→ Approval
→ PO
→ Receipt
→ Asset Creation
```

---

# 84. Phase 4 3-Way Match

Match:

```text
PO
Goods Receipt
Invoice
```

Output:

```text
NOT_EVALUATED
PENDING_RECEIPT
MATCHED
MISMATCHED
```

Match is independent from Invoice lifecycle and credit status. Business
quantity and unit-price tolerance are zero; arithmetic line-total rounding
allows at most one configured currency minor unit.

---

# 85. Phase 4 Invoice Duplicate Prevention

DB constraint:

```text
tenant_id + supplier_id + document_type + supplier_document_number_normalized
```

Reserved durably when submitted; normalized with NFKC, trim, whitespace
collapse and case normalization. Idempotency remains a separate command
retry mechanism. Invoice quantity and unit-price business tolerance are zero;
only arithmetic rounding up to one currency minor unit is allowed.

---

# 86. Phase 4 Contract Workflow

```text
Draft
→ Review
→ Approved
→ Active
→ Expiring
→ Renewal
→ Active / Expired / Terminated
```

---

# 87. Phase 4 Document Governance

Documents:

```text
PO
Invoice
Contract
Handover
Repair report
Warranty evidence
Disposal certificate
```

Support:

```text
version
checksum
signature
expiry
retention
```

---

# 88. Phase 4 Asset Cost Enrichment

Asset Workspace can show:

```text
purchase date
supplier
PO
purchase cost
warranty
contract
```

subject to permission.

---

# 89. Phase 4 License Cost

License entitlement links:

```text
contract
supplier
cost
renewal
```

---

# 90. Phase 4 Definition of Done

Phase 4 complete when:

- Procurement request to PO works.
- Receiving can create assets.
- Partial receiving works.
- Invoice duplicate prevention works.
- 3-way match works.
- Contract expiry/renewal alerts work.
- Documents are versioned/immutable where required.
- Asset and license costs link back to procurement/contract sources.

---

# 91. PHASE 5 — AUTOMATION + INTELLIGENCE + ADVANCED REPORTING

## Objective

Only after workflows/data are stable, automate and optimize.

---

# 92. Phase 5 Scope

```text
Advanced Rules Engine
Self-Healing
Advanced Correlation
Risk Scoring
Replacement Scoring
Predictive Maintenance
Advanced KPI
Executive Reporting
Knowledge Deflection
Recommendation Engine
```

---

# 93. Phase 5 Automation Maturity Levels

## Level 1

```text
Notify
Assign
Create Work Item
```

## Level 2

```text
Safe Remediation
Retry
Reconcile
```

## Level 3

```text
Controlled Change
Approval-gated execution
```

## Level 4

```text
Recommendation / Intelligence
```

---

# 94. Phase 5 Self-Healing

Examples:

```text
Restart agent
Restart safe service
Clear safe cache
Retry sync
Re-run failed inventory
```

Must:

```text
precheck
execute
verify
rollback/fallback
```

---

# 95. Phase 5 Risk Scoring

Potential factors:

```text
asset health
age
warranty
incident frequency
repair cost
security findings
software compliance
business criticality
```

---

# 96. Phase 5 Replacement Scoring

Input:

```text
age
repair frequency
repair cost
downtime
warranty
performance
business criticality
```

Output:

```text
candidate
score
explanation
```

No opaque auto-disposal.

---

# 97. Phase 5 Knowledge Deflection

User request:

```text
→ detect known issue
→ suggest knowledge
→ detect current outage
→ safe self-service
```

before creating human work where appropriate.

---

# 98. Phase 5 Advanced Correlation

Use:

```text
service dependency
topology
site
event signature
change history
time windows
historical pattern
```

---

# 99. Phase 5 Advanced Reporting

Add:

```text
data mart
historical cohorts
vendor performance
asset TCO
incident trends
automation effectiveness
license optimization
```

---

# 100. Phase 5 Definition of Done

Phase 5 complete when:

- Automation rules are versioned/testable.
- High-risk automation is policy-gated.
- Safe remediation verifies success.
- Intelligence outputs are explainable.
- Recommendations never silently mutate canonical state.
- Advanced KPI comes from governed metric definitions.
- Automation noise and false positives are controlled.

---

# 101. Recommended Deployable Architecture by Phase

## Phase 0–1

```text
Modular Monolith
+
PostgreSQL
+
Redis
+
Object Storage
+
Broker
```

Recommended for speed.

---

# 102. Phase 2–3

Potential split:

```text
core-app
agent-service
monitoring-ingestion
network-discovery
notification-service
```

Only split when operational reason exists.

---

# 103. Phase 4–5

Potential split:

```text
procurement-service
search-service
automation-service
reporting-service
integration-service
```

---

# 104. Service Extraction Triggers

Split module into separate service when one or more applies:

```text
independent scaling
different security boundary
different deployment cadence
high-volume workload
failure isolation needed
separate owning team
special storage requirement
```

---

# 105. Do Not Split Because

Avoid service split only because:

```text
"microservices are modern"
```

---

# 106. Recommended Code Organization

Initial:

```text
/apps
  api
  worker
  agent-gateway

/modules
  identity
  asset
  helpdesk
  incident
  maintenance
  approval
  sla
  automation
  audit
  notification
```

Each module owns:

```text
domain
application
infrastructure
API
events
migrations
```

---

# 107. Domain Package Boundary

No module imports another module's persistence repository directly.

Use:

```text
Application contract
Domain event
Read model
```

---

# 108. Database Migration Order

Recommended:

```text
1 Identity
2 Platform
3 Audit
4 Asset
5 Helpdesk
6 Operations
7 Incident
8 Maintenance
9 Control engines
10 Network
11 Software
12 License
13 Procurement
14 Contract
15 Reporting
```

---

# 109. API Implementation Order

Implement in order:

```text
Authentication
Authorization
Asset
Ticket
Work Queue
Incident
Maintenance
Approval
SLA
Agent
Audit
Network
Software
License
Procurement
Contract
Reporting
```

---

# 110. Event Implementation Order

First:

```text
Asset
Ticket
User
Work Item
```

Then:

```text
Incident
Agent
Monitoring
Maintenance
Approval
SLA
```

Then:

```text
Network
Software
License
Procurement
Contract
```

---

# 111. Timeline Implementation Order

```text
Asset
Ticket
Incident
User
Maintenance
Network
Software
Procurement
```

---

# 112. Search Implementation Order

```text
Asset
User
Ticket
Incident
IP/MAC
Software
PO
Invoice
Contract
Knowledge
```

---

# 113. Notification Implementation Order

```text
Email
Portal
Teams/Slack
Push/Mobile
SMS
```

Only add channels with real demand.

---

# 114. Integration Implementation Order

```text
Identity Provider
Monitoring
Agent
Email
ERP/Finance
Teams/Slack
Vendor APIs
```

---

# 115. Testing Pyramid

```text
Unit Tests
Domain State Tests
Repository Integration Tests
API Contract Tests
Event Contract Tests
Workflow Tests
E2E Tests
Failure/Chaos Tests
```

---

# 116. Mandatory Domain Tests

Every critical state machine transition:

```text
valid
invalid
permission denied
scope denied
approval required
version conflict
duplicate retry
event emitted
audit created
```

---

# 117. Contract Tests

Must cover:

```text
API schema
Event schema
Backward compatibility
Error codes
Idempotency
Authorization
```

---

# 118. Workflow E2E Test Set

Minimum:

```text
User Ticket
Monitoring Incident
Asset Assignment
Asset Return
Maintenance
Offboarding
Software Request
Procurement Receive
```

---

# 119. Failure Tests

Test:

```text
DB deadlock
Broker unavailable
Duplicate event
Duplicate webhook
Agent offline
Search unavailable
Object storage failure
Notification provider failure
```

---

# 120. Security Tests

Include:

```text
tenant isolation
horizontal privilege escalation
scope bypass
IDOR
privileged role grant
service account misuse
sensitive export
```

---

# 121. Performance Tests

Critical paths:

```text
Work Queue
Asset Search
Ticket List
Asset Workspace
Global Search
Event ingestion
Agent heartbeat
```

---

# 122. Suggested SLO Targets for MVP

Illustrative:

```text
Interactive API p95 < 500ms
Work Queue p95 < 1s
Exact Search p95 < 300ms
Global Search p95 < 800ms
Important timeline lag < 10s
Event projection lag < 60s
```

Tune after real load.

---

# 123. Data Migration Strategy

If replacing existing spreadsheets/tools:

```text
Extract
→ Stage
→ Validate
→ Normalize
→ Dedupe
→ Import
→ Reconcile
→ Freeze legacy writes
→ Cutover
```

---

# 124. Migration Order

Recommended:

```text
Users
Locations
Asset Models
Assets
Assignments
Open Tickets
Open Incidents
Contracts
Licenses
Historical Records
```

---

# 125. Legacy Data Confidence

Imported records can carry:

```text
source
import_batch_id
confidence
migration_note
```

---

# 126. Historical Import

Do not fake precise audit history if unavailable.

Mark:

```text
LEGACY_IMPORT
```

---

# 127. Feature Flags

Use for risky/new features:

```text
automation
network execution
advanced search
new workflow
```

Enable progressively.

---

# 128. Rollout Strategy

Recommended:

```text
Internal IT Pilot
↓
One Site
↓
One Department
↓
Broader Rollout
↓
Enterprise
```

---

# 129. Pilot Scope

Start with:

```text
one Helpdesk team
one Asset team
one Site
limited asset classes
```

---

# 130. Pilot Success Criteria

Measure:

```text
ticket handling time
clicks per operation
duplicate tickets
asset data accuracy
assignment errors
manual reconciliation
SLA visibility
operator feedback
```

---

# 131. UX Success Criterion

Core action should generally require:

```text
one context
one decision
one confirmation
```

not multiple module navigation steps.

---

# 132. Operational Readiness Checklist

Before production:

```text
backup verified
restore tested
alerts configured
runbooks written
DLQ monitored
audit health monitored
secrets rotated
admin accounts reviewed
```

---

# 133. Runbooks Required

Minimum:

```text
DB outage
Broker outage
Search outage
Identity provider outage
Notification outage
Agent service outage
DLQ recovery
Failed migration rollback
```

---

# 134. Release Management

Each release includes:

```text
DB migration
API compatibility check
Event compatibility check
Rollback plan
Feature flag plan
Observability dashboard
```

---

# 135. Schema Compatibility Gate

CI must block:

```text
breaking API change
breaking event schema
unsafe DB migration
```

without explicit versioning.

---

# 136. Event Compatibility Gate

Check:

```text
removed field
type change
renamed field
semantic break
```

---

# 137. Definition of Ready for New Feature

Before implementation:

```text
workflow defined
entity owner defined
state machine defined
permission defined
API command defined
events defined
audit/timeline impact defined
error behavior defined
```

---

# 138. Definition of Done for New Feature

Feature complete only when:

```text
data model
API
authorization
state machine
events
audit
timeline
tests
observability
runbook
```

are done.

---

# 139. Technical Debt Rules

Do not defer:

```text
authorization
idempotency
audit
unique constraints
state integrity
```

These are not polish.

---

# 140. Technical Debt That Can Wait

Can defer:

```text
semantic search
advanced analytics
full graph visualization
complex personalization
AI recommendations
```

---

# 141. MVP Cut Line

Strict MVP includes:

```text
Identity
RBAC
Asset
Assignment
Location
Ticket
Work Queue
Audit
Timeline
Notification
Basic Search
Idempotency
Events
```

---

# 142. MVP Optional

Optional if timeline permits:

```text
Incident
Agent
Monitoring
Maintenance
SLA
```

But strongly recommended for first operational release if goal is true IT Operations Hub.

---

# 143. MVP Excluded

Do not require for first usable release:

```text
Full Procurement
Advanced Contracts
Full Network Topology
Advanced License Optimization
AI Correlation
Predictive Maintenance
Vector Search
Multi-region
```

---

# 144. Suggested Delivery Epics

## EPIC-001

```text
Platform Foundation
```

## EPIC-002

```text
Identity + RBAC
```

## EPIC-003

```text
Asset Core
```

## EPIC-004

```text
Helpdesk Core
```

## EPIC-005

```text
Work Queue + Timeline
```

## EPIC-006

```text
Monitoring + Incident
```

## EPIC-007

```text
Maintenance
```

## EPIC-008

```text
Audit + Network
```

## EPIC-009

```text
Software + License
```

## EPIC-010

```text
Procurement + Contract
```

## EPIC-011

```text
Automation + Intelligence
```

---

# 145. Suggested Implementation Sprints

Not fixed calendar duration, but sequence:

```text
Sprint A — Platform/Auth
Sprint B — Asset Core
Sprint C — Ticket Core
Sprint D — Work Queue/Timeline
Sprint E — Incident/Monitoring
Sprint F — Maintenance/SLA
Sprint G — Audit/Network
Sprint H — Software/License
Sprint I — Procurement
Sprint J — Automation/Reporting
```

---

# 146. Critical Dependency Matrix

| Feature | Depends On |
|---|---|
| Asset Assignment | Identity, Asset, RBAC |
| Ticket Enrichment | Identity, Asset |
| Work Queue | Ticket/Asset/Incident sources |
| Root Incident | Monitoring, Incident, Correlation |
| Maintenance | Asset |
| Software Deployment | Agent, Artifact, License |
| Offboarding | Identity, Asset, License |
| Procurement Receiving | PO, Warehouse, Asset |
| Automation | Events, Permissions, Error Standard |
| Advanced Reporting | Stable canonical events/data |

---

# 147. Risk Register — Architecture

High risks:

```text
Over-splitting services
Weak data ownership
Generic status field
Missing idempotency
No audit durability
Search treated as canonical
Too much automation too early
```

---

# 148. Risk Register — Product

High risks:

```text
Too many clicks
Operators still navigate modules
Duplicate work items
Alert noise
Poor correlation
Manual data reconciliation
```

---

# 149. Risk Mitigation

Architecture:

```text
modular monolith first
strict domain ownership
contract-first APIs/events
```

Product:

```text
Work Queue
Asset Workspace
Contextual Actions
Auto-enrichment
Correlation
```

---

# 150. Governance

Every new domain must register:

```text
Owner
Entities
States
Commands
Events
Permissions
SLA
Audit
Documents
Work Queue sources
```

---

# 151. Architecture Review Gate

Review new feature against:

```text
Does it create duplicate source-of-truth?
Does it bypass command/state machine?
Does it mutate another domain directly?
Does it need idempotency?
Does it generate actionable work or noise?
```

---

# 152. Data Review Gate

Check:

```text
PK
Unique constraints
History
Soft delete
Retention
Tenant scope
Indexes
```

---

# 153. Security Review Gate

Check:

```text
Permissions
Scope
High-risk classification
Secrets
Audit
Export
External integration
```

---

# 154. Operations Review Gate

Check:

```text
Retry
Timeout
DLQ
Metrics
Alerts
Runbook
Recovery
```

---

# 155. UX Review Gate

Check:

```text
Can operator complete action without module hopping?
Is context auto-enriched?
Are side effects visible?
Does one confirmation update linked records?
```

---

# 156. Success Metrics — Helpdesk

Track:

```text
First response time
Resolution time
SLA breach rate
Reopen rate
Ticket reassignment count
Duplicate ticket rate
```

---

# 157. Success Metrics — Asset

Track:

```text
Assignment accuracy
Return overdue
Unknown owner
Unknown location
Inventory accuracy
Time to assign
```

---

# 158. Success Metrics — Operations

Track:

```text
MTTA
MTTR
Alert-to-Incident conversion
Duplicate suppression
Auto-remediation success
Human fallback count
```

---

# 159. Success Metrics — Automation

Track:

```text
Automation success rate
Rollback rate
False positive rate
Manual work avoided
Incidents prevented
```

---

# 160. Exit Criteria — MVP

MVP exits pilot when:

```text
core workflows stable
no critical data integrity issue
RBAC verified
backup/restore tested
audit gap = 0 for high-risk actions
operator adoption acceptable
critical runbooks validated
```

---

# 161. Exit Criteria — Production Scale

Scale-up when real evidence shows:

```text
DB bottleneck
consumer lag
search latency
deployment coupling
team ownership conflict
```

Then split components.

---

# 162. Recommended Final Architecture Evolution

```text
Stage 1
Modular Monolith

Stage 2
Modular Monolith + Specialized Workers

Stage 3
Extract High-Volume / High-Isolation Services

Stage 4
Domain Services where operationally justified
```

---

# 163. Anti-Patterns

Do not:

1. Build all domains before piloting.
2. Split every module into microservice from day one.
3. Introduce AI before workflow/data quality is stable.
4. Skip RBAC/audit for MVP.
5. Use direct DB writes from integrations.
6. Let monitoring create one ticket per alert.
7. Build UI around modules instead of work.
8. Make Work Item the source-of-truth.
9. Store all telemetry in PostgreSQL.
10. Build dedicated search engine before search volume justifies it.
11. Add high-risk automation without verification/rollback.
12. Import dirty legacy data directly into canonical tables.
13. Define success only as "feature exists".
14. Defer idempotency until production incidents occur.
15. Allow product phases to redefine canonical ownership inconsistently.

---

# 164. Recommended Immediate Build Order

If implementation starts now:

```text
1. Repository structure
2. PostgreSQL schemas/migrations
3. Identity + RBAC
4. Platform command/error/idempotency framework
5. Outbox/inbox
6. Audit framework
7. Asset core
8. Ticket core
9. Work Queue
10. Timeline
11. Notification
12. Basic search
13. Agent/Monitoring
14. Incident
15. Maintenance/SLA
```

---

# 165. First Vertical Slice

Best first end-to-end slice:

```text
User creates Ticket
↓
Ticket auto-identifies User
↓
Assigned Asset attached
↓
Helpdesk Work Item created
↓
Helpdesk opens Ticket
↓
Sees User + Asset context
↓
Assigns self
↓
Resolves Ticket
↓
Notification sent
↓
Audit + Timeline updated
```

This validates almost every foundational layer.

---

# 166. Second Vertical Slice

```text
Asset available
↓
Assign Asset
↓
Create Assignment
↓
Create Movement
↓
Generate Handover
↓
Notify User
↓
Update Asset Workspace
↓
Audit + Timeline
```

---

# 167. Third Vertical Slice

```text
Monitoring Critical
↓
Normalize
↓
Create Incident
↓
Create Work Item
↓
Link matching Tickets
↓
Resolve Incident
↓
Auto-update child Tickets
```

---

# 168. Fourth Vertical Slice

```text
Agent Offline
↓
Automation precheck
↓
Safe restart
↓
Verify
├─ success → close
└─ fail → Work Item
```

---

# 169. Phase Review Deliverables

Every phase closes with:

```text
Architecture review
Data integrity report
Security review
Workflow E2E test
Operational runbook
Metrics dashboard
Pilot feedback
```

---

# 170. Master Traceability Requirement

Every implemented feature must map back to:

```text
Workflow ID
Entity
State Machine
Command
Event
Permission
Audit
Timeline
Metric
```

---

# 171. Implementation Tracking Matrix Template

```markdown
| Feature | Workflow | Tables | API | Command | Event | Permission | State | Audit | Test | Status |
|---|---|---|---|---|---|---|---|---|---|---|
```

---

# 172. Definition of Done

MVP + Phased Implementation Plan đạt yêu cầu khi:

- Build order rõ từ foundation tới intelligence.
- MVP cut line rõ.
- Mỗi phase có mục tiêu và DoD.
- Service extraction không bị làm sớm.
- Database/API/Event/State implementation order rõ.
- Core vertical slices được xác định.
- Testing/security/operations gates đầy đủ.
- Migration strategy rõ.
- Pilot rollout strategy rõ.
- Success metrics rõ.
- Traceability từ feature → workflow → data → API → event → permission → audit được giữ xuyên suốt.
