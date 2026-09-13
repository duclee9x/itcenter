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
| F-004/OFFBOARDING | User Offboarding | Identity | WF-ID04/WF-019 | P3 | P0 | DESIGN_READY |
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

## F-004 — User Lifecycle / Offboarding

```text
Feature: User Lifecycle / Offboarding
Owner: Identity
Workflow: WF-ID04 / WF-019
Phase: P3
Priority: P0
Specification remediation: TASK-060-R1
Implementation task: TASK-060
```

### Entities

```text
identity.users
identity.offboarding_cases
identity.offboarding_case_history
identity.offboarding_clearance_tasks
identity.offboarding_recovery_actions
```

The Offboarding Case and User Lifecycle are independent state machines.
Persist `pre_offboarding_user_state` before the explicit User transition to
`TERMINATING`.

### Commands

```text
IDENTITY.START_OFFBOARDING
OFFBOARDING.START
OFFBOARDING.RESUME
OFFBOARDING.MARK_READY
OFFBOARDING.COMPLETE
OFFBOARDING.CANCEL
OFFBOARDING.REQUEST_CANCEL
OFFBOARDING.COMPLETE_CANCELLATION
OFFBOARDING.RECONCILE_CLEARANCES
OFFBOARDING.RESOLVE_RECOVERY_ACTION
OFFBOARDING.RESOLVE_CLEARANCE_EXCEPTION
```

Commands require authorization, expected version for every affected aggregate,
idempotency, reason, audit, outbox and correlation metadata as applicable.

### Events

```text
OFFBOARDING.STARTED
OFFBOARDING.BLOCKED
OFFBOARDING.RESUMED
OFFBOARDING.READY_TO_CLOSE
OFFBOARDING.CANCELLATION_REQUESTED
OFFBOARDING.CANCELLED
OFFBOARDING.COMPLETED
```

### Permissions

```text
identity.offboard
identity.offboard.cancel
identity.offboard.exception
```

### State Machines and Invariants

```text
Offboarding Case: INITIATED, IN_PROGRESS, BLOCKED, READY_TO_CLOSE,
                  CANCELLATION_PENDING, COMPLETED, CANCELLED
User Lifecycle: independent; TERMINATING may be restored to the captured
                pre_offboarding_user_state only by an explicit validated
                Identity transition after authoritative request withdrawal
```

Cancellation after side effects uses compensating/recovery actions. Historical
actions are retained; irreversible data wipe/disposal requires manual recovery
or policy-approved exception. `COMPLETE` races `OFFBOARDING.REQUEST_CANCEL` on
the case version; add a concurrency test proving only one can win.

### Audit, Timeline and Tests

```text
Immutable case transition/action history and audit/outbox per committed
command; user timeline projects Offboarding events.
E2E: completion, cancellation/recovery, missing Asset, License cancellation
and reclaim, actionable failure, authorization denial, idempotent replay, and
COMPLETE versus REQUEST_CANCEL concurrency.
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
| Replacement + retirement evidence | `replacement_plans`, `replacement_history`, `retirement_records`, `data_wipe_jobs`, `disposal_records`, `lifecycle_evidence_history` | `REPLACEMENT.*`, `RETIREMENT.CANDIDATE_CREATED/BLOCKED/APPROVED`, `ASSET.RETIRE`, `DATA_WIPE.*`, `ASSET.DISPOSE`, `ASSET.REACTIVATE` | Replacement/retirement/wipe/disposal event catalog | `replacement.create_candidate`, `replacement.review`, `asset.retire`, `data_wipe.execute`, `asset.dispose`, `asset.reactivate` | Separate state machines; assigned retirement candidate remains BLOCKED/actionable until Asset return clears the owner-side blocker |

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
automation.rules
automation.rule_versions
automation.rule_evaluations
automation.action_intents
automation.action_intent_contributors
automation.intent_conflicts
automation.intent_conflict_members
automation.action_capabilities
automation.action_policies                   # immutable tenant policy versions
authorization.automation_principals          # canonical service identities
authorization.automation_principal_grants    # tenant/resource-scoped grants
automation.rule_executions                 # TASK-091 execution evidence
automation.action_executions               # TASK-091 execution evidence
```

### Commands

```text
AUTOMATION.RULE.CREATE
AUTOMATION.RULE.UPDATE_DRAFT
AUTOMATION.RULE.PUBLISH_VERSION
AUTOMATION.ACTIVATE
AUTOMATION.DEACTIVATE
AUTOMATION.SIMULATE
AUTOMATION.EVENT.EVALUATE                  # internal event consumer
AUTOMATION.INTENT.RECHECK_APPROVAL         # internal approval consumer
AUTOMATION.INTENT.RESOLVE_CONFLICT
AUTOMATION.ACTION_POLICY.CREATE
AUTOMATION.ACTION_POLICY.UPDATE_DRAFT
AUTOMATION.ACTION_POLICY.ACTIVATE
AUTOMATION.ACTION_POLICY.DEACTIVATE
AUTOMATION.INTENT.REEVALUATE_POLICY          # explicit; no silent promotion
```

### Permissions

```text
automation.rule.read
automation.rule.create
automation.rule.edit
automation.simulate
automation.activate_low_risk
automation.activate_high_risk
automation.disable
automation.intent.read
automation.intent.resolve
automation.policy.read
automation.policy.create
automation.policy.update
automation.policy.activate
```

### Events

```text
AUTOMATION.RULE_CREATED
AUTOMATION.RULE_VERSION_PUBLISHED
AUTOMATION.RULE_ACTIVATED
AUTOMATION.RULE_DEACTIVATED
AUTOMATION.RULE_EVALUATED
AUTOMATION.INTENT_CREATED
AUTOMATION.INTENT_READY
AUTOMATION.INTENT_DEDUPLICATED
AUTOMATION.INTENT_BLOCKED
AUTOMATION.INTENT_CONFLICTED
AUTOMATION.INTENT_CONFLICT_RESOLVED
AUTOMATION.ACTION_POLICY_CREATED
AUTOMATION.ACTION_POLICY_UPDATED
AUTOMATION.ACTION_POLICY_VERSION_PUBLISHED
AUTOMATION.ACTION_POLICY_ACTIVATED
AUTOMATION.ACTION_POLICY_DEACTIVATED
```

TASK-090 owns rule definition/versioning, event-only evaluation, simulation,
policy gates and durable intent through READY/BLOCKED/CONFLICTED. READY
requires an explicit applicable tenant Action Policy AND a canonical
tenant/resource-scoped SYSTEM_AUTOMATION grant evaluated through
AuthorizationPort; absent or failed checks deny. Rule author permissions do
not confer execution authority, and no wildcard grant or bootstrap ALLOW is
permitted. Immutable policy/principal/scope decision evidence is retained.
TASK-091 must recheck current policy, principal authorization, approval,
conflict, kill switch and target eligibility immediately before execution.
TASK-090 never executes an action. Conflict resolution is fail-closed with one
human fallback; rule priority is not a winner-selection policy. Schedule,
temporal/windowed and absence-of-event triggers are outside TASK-090.

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

### Unauthorized Software / Inventory Compliance (F-033 / WF-013)

Tables:

```text
software.inventory_reports
software.inventory_observations
software.inventory_installations
software.product_aliases
software.software_exceptions
software.software_exception_history
software.uninstall_profiles
software.removal_jobs
software.removal_attempts
operations.work_items (SOFTWARE_EXCEPTION reference)
```

Commands and APIs:

```text
POST /agent/v1/inventory
GET /api/v1/software/inventory
GET /api/v1/software/exceptions[/{id}]
POST /api/v1/software/exceptions/{id}/commands/{request-approval|approve-temporary|mark-false-positive|investigate|request-removal|ignore-by-policy}
POST /api/v1/agent/software-removals/claim
POST /api/v1/agent/software-removals/{id}/commands/report
```

Events:

```text
SOFTWARE.INVENTORY_NORMALIZED
SOFTWARE.UNAUTHORIZED_DETECTED
SOFTWARE.EXCEPTION_UPDATED
SOFTWARE.REMOVAL_REQUESTED
SOFTWARE.REMOVAL_JOB_QUEUED
SOFTWARE.REMOVAL_JOB_CLAIMED
SOFTWARE.REMOVAL_JOB_REPORTED
SOFTWARE.REMOVAL_FAILED
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
procurement.purchase_order_versions
append-only PO lifecycle/receipt history
```

Feature: F-041; Workflow: WF-P03; normative specification remediation:
`tasks/TASK-072-R1_PURCHASE_ORDER_LIFECYCLE_APPROVAL_AMENDMENT_CONTRACT.md`.

PO lifecycle (`DRAFT`, `ISSUED`, `ON_HOLD`, `CLOSED`, `CANCELLED`) and receipt
state (`NOT_RECEIVED`, `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`) are independent.
Approval is a conditional control gate, not a PO state. Issue validates
Supplier eligibility and, when RFQ-linked, the awarded RFQ and accepted
winning quotation. Issued commercial versions are immutable; allowed
pre-receipt amendments append a new version. TASK-072 owns lifecycle,
conditional issue/amend approval validation, version/history, and
`UPDATE_DRAFT`/`ISSUE` plus `AMEND`/`CANCEL` concurrency. TASK-073-R1 defines
the normative Goods Receipt contract. TASK-073 owns receipt progression,
concurrent partial receipt protection, and POST races against PO cancel, hold,
amend and relevant remainder close.

Commands:

```text
PO.CREATE
PO.UPDATE_DRAFT
PO.ISSUE
PO.HOLD
PO.RESUME
PO.AMEND
PO.CANCEL
PO.CLOSE
PO.CLOSE_REMAINDER
```

Events:

```text
PO.CREATED
PO.UPDATED
PO.ISSUED
PO.HELD
PO.RESUMED
PO.AMENDED
PO.CANCELLED
PO.CLOSED
PO.REMAINDER_CLOSED
```

Implementation status: TASK-072 `CODE_COMPLETE`. The implementation report
and runtime acceptance evidence are recorded in
`tasks/TASK-072_PURCHASE_ORDER_APPROVAL_AMENDMENT.md`. TASK-073-R1's normative
specification is complete; TASK-073 remains the owner of Goods Receipt writes,
PO receipt-state progression, asynchronous Asset registration and all
receipt-vs-PO/partial-quantity concurrency races.

---

# 28. Goods Receipt Traceability

### Tables

```text
procurement.goods_receipts
procurement.goods_receipt_lines
procurement.goods_receipt_units
procurement.receiving_exceptions
procurement.goods_receipt_history
procurement.receipt_assetization_state
asset.received_unit_registrations
```

### State Dimensions

```text
Goods Receipt: DRAFT | POSTED | CANCELLED
PO lifecycle: DRAFT | ISSUED | ON_HOLD | CLOSED | CANCELLED
PO receipt:   NOT_RECEIVED | PARTIALLY_RECEIVED | FULLY_RECEIVED
Asset:        RECEIVED → AVAILABLE through Asset-owned validation/put-away
```

Goods Receipt POST is allowed only while PO lifecycle is `ISSUED`. The three
state dimensions remain independent: posting changes the Goods Receipt to
POSTED and updates only PO receipt progress; it never closes the PO or creates
an Asset synchronously. Posted receipts are immutable and are never deleted.

### Invariants

- Only accepted quantity advances PO progress; observed/rejected/damaged
  quantities remain separately evidenced.
- `accepted_quantity > 0`; cumulative accepted quantity per PO line cannot
  exceed ordered quantity. Over-receipt fails atomically.
- Supplier/context and PO line/commercial-version references match the PO.
- Blocking uncertainty, missing serialized unit identity, or duplicate unit
  identity within one receipt blocks POST.
- POST atomically commits receipt snapshot/lines/units, PO counters and
  summaries, receipt state/version/history, audit and outbox.
- PO row/version serialization protects receipt POST against PO cancel, hold,
  relevant remainder close, amendment, and parallel partial receipts.
- Only POSTED accepted quantities count as 3-Way Match receiving evidence.

### Commands and Permissions

```text
GOODS_RECEIPT.CREATE         → goods_receipt.create
GOODS_RECEIPT.UPDATE_DRAFT   → goods_receipt.update
GOODS_RECEIPT.POST           → goods_receipt.post
GOODS_RECEIPT.CANCEL         → goods_receipt.cancel
Goods Receipt queries        → goods_receipt.read
```

### Events

```text
GOODS_RECEIPT.CREATED
GOODS_RECEIPT.UPDATED
GOODS_RECEIPT.POSTED
GOODS_RECEIPT.CANCELLED
PO.PARTIALLY_RECEIVED
PO.FULLY_RECEIVED
```

`PO.PARTIALLY_RECEIVED` is emitted for each successful POST leaving fulfillment
incomplete, including partial-to-partial. `PO.FULLY_RECEIVED` is emitted only
on transition into fully received. Neither event changes PO lifecycle or
commercial version.

### Downstream

```text
GOODS_RECEIPT.POSTED outbox
→ idempotent Asset-owned ASSET.REGISTER_RECEIVED per received_unit_id
→ Asset lifecycle RECEIVED, assignment UNASSIGNED, receiving location
→ existing validation/put-away → AVAILABLE
```

Asset creation is asynchronous. Asset failure does not unpost Goods Receipt;
redelivery/retry is idempotent and exhaustion creates actionable human work.
Normal receiving does not create Work Queue items. Procurement must not write
Asset domain tables. Full service receipt/acceptance remains out of scope.

Planning status: TASK-073-R1 is `CODE_COMPLETE` (specification only);
TASK-073 is `SATISFIED / CODE_COMPLETE`. Implementation status and
PostgreSQL E2E coverage are recorded in
`tasks/TASK-073_GOODS_RECEIPT_ASSETIZATION_PARTIAL_RECEIPT.md`.

---

# 29. Invoice + Duplicate Protection + 3-Way Match Traceability (TASK-074)

### Canonical tables

```text
procurement.invoices
procurement.invoice_lines
procurement.invoice_history
procurement.invoice_document_identity_reservations
procurement.invoice_match_evaluations
procurement.invoice_match_allocations
procurement.invoice_match_exceptions
procurement.invoice_match_exception_history
procurement.credit_notes
procurement.credit_note_history
procurement.credit_note_lines
procurement.credit_note_applications
```

### Durable constraints and evidence

```text
UNIQUE(tenant_id, supplier_id, document_type, supplier_document_number_normalized)
```

The identity reservation is acquired at submit and retained thereafter. Match
evaluations and allocation/application history are append-only. PO-line
serialization prevents concurrent invoices consuming the same accepted
quantity; Credit Note line invariants prevent over-credit. Approved mismatch
exceptions reserve approved quantity against reuse while retaining
`MISMATCHED` evidence.

### Independent state dimensions

```text
Invoice lifecycle: DRAFT | SUBMITTED | APPROVED | REJECTED | CANCELLED
Match:             NOT_EVALUATED | PENDING_RECEIPT | MATCHED | MISMATCHED
Credit status:     NONE | PARTIALLY_CREDITED | FULLY_CREDITED (derived)
Credit Note:       DRAFT | SUBMITTED | APPLIED | REJECTED | CANCELLED
```

3-Way Match uses immutable PO commercial version, submitted Invoice snapshot
and POSTED Goods Receipt accepted quantities. Business quantity and unit-price
tolerance are zero; arithmetic line-total rounding is at most one configured
currency minor unit. Draft/cancelled receipts and observed/rejected/damaged
quantities never count. Partial invoices are supported; only `PENDING_RECEIPT`
may become `MATCHED` after a new receipt and explicit re-evaluation. Neither
Invoice nor Credit Note processing mutates PO or POSTED Goods Receipt history.

### Commands and permission mapping

```text
INVOICE.CREATE              → invoice.create
INVOICE.UPDATE_DRAFT        → invoice.update
INVOICE.CANCEL              → invoice.update
INVOICE.SUBMIT              → invoice.submit
INVOICE.REEVALUATE_MATCH    → invoice.match
INVOICE.APPROVE             → invoice.approve
INVOICE.REJECT              → invoice.reject
CREDIT_NOTE.CREATE          → credit_note.create
CREDIT_NOTE.UPDATE_DRAFT    → credit_note.update
CREDIT_NOTE.CANCEL          → credit_note.update
CREDIT_NOTE.SUBMIT          → credit_note.submit
CREDIT_NOTE.APPLY           → credit_note.apply
CREDIT_NOTE.REJECT          → credit_note.reject
```

Reads use `invoice.read` / `credit_note.read`; Approval Engine decisions use
`approval.decide`. No broad procurement write permission is introduced.
Draft cancellation remains an explicit lifecycle command restricted to DRAFT,
uses the existing `update` permission and command integrity controls, and
cannot be represented as a generic status update. Post-submission cancellation
or reversal is outside TASK-074 and requires a separate command/permission
contract.

### Events

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

Events use stable references and minimal required data; protected tax/bank
fields and full commercial documents are excluded.

### Required concurrency and failure tests

- Duplicate normalized document submissions race against the DB unique key.
- Partial invoice allocations race for the same remaining PO-line quantity.
- Re-evaluation races with Goods Receipt POST/progress update.
- Approval races with a new match evaluation or stale exception context.
- Credit Note apply replay is idempotent; concurrent applications cannot
  exceed remaining creditable line quantity/amount.
- A mismatch exception approval reserves its full approved invoice quantity without
  rewriting `MISMATCHED` or prior comparison evidence.
- Only POSTED accepted receipt quantities support match allocations.

Implementation status: TASK-074-R1 is `CODE_COMPLETE` (specification only);
TASK-074 is `SATISFIED / CODE_COMPLETE`. Runtime persistence, commands, API,
authorization, duplicate identity reservation, match allocation/exception and
credit-note application are implemented and exercised by PostgreSQL E2E tests.
See `tasks/TASK-074_IMPLEMENTATION_REPORT.md` and the task contract at
`tasks/TASK-074_INVOICE_DUPLICATE_PROTECTION_3_WAY_MATCH.md`.

---

# 30. Contract Traceability

### Tables

```text
contract.contracts
contract.contract_coverages
contract.contract_versions
contract.execution_evidence
contract.history
contract.amendment_changes
contract.renewal_cases
contract.renewal_history
document.documents
document.document_versions
document.document_links
document.document_relationships
```

### Commands

```text
CONTRACT.CREATE
CONTRACT.UPDATE_DRAFT
CONTRACT.SUBMIT_FOR_SIGNATURE
CONTRACT.RECALL_SIGNATURE
CONTRACT.RECORD_EXECUTION
CONTRACT.ACTIVATE
CONTRACT.HOLD
CONTRACT.RESUME
CONTRACT.AMEND
CONTRACT.EXPIRE
CONTRACT.TERMINATE
CONTRACT.CANCEL
RENEWAL.OPEN
RENEWAL.UPDATE_PROPOSAL
RENEWAL.COMPLETE
RENEWAL.MARK_NOT_RENEWED
RENEWAL.CANCEL
COMMERCIAL_DOCUMENT.ADD / CREATE_VERSION
COMMERCIAL_DOCUMENT.FINALIZE
COMMERCIAL_DOCUMENT.SUPERSEDE
```

### Events

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
CONTRACT.TERMINATED
CONTRACT.EXPIRED
CONTRACT.CANCELLED
CONTRACT.RENEWAL_OPENED
CONTRACT.RENEWAL_UPDATED
CONTRACT.RENEWAL_COMPLETED
CONTRACT.RENEWAL_NOT_RENEWED
CONTRACT.RENEWAL_CANCELLED
COST_PROVENANCE.RECORDED
COST_ADJUSTMENT.RECORDED
COMMERCIAL_DOCUMENT.ADDED
COMMERCIAL_DOCUMENT.FINALIZED
COMMERCIAL_DOCUMENT.SUPERSEDED
```

### Normative dimensions and invariants

- Contract lifecycle, usage status, Renewal Case lifecycle, ContractVersion,
  Commercial Document governance and signature/execution evidence are
  independent. Approval remains an Approval Engine control gate.
- Contract lifecycle is `DRAFT`, `PENDING_SIGNATURE`, `EXECUTED`, `ACTIVE`,
  `EXPIRED`, `TERMINATED`, `CANCELLED`; usage is `ENABLED` or `ON_HOLD`.
  `EXPIRING` is derived from explicit terms and never mutates lifecycle.
- Submitted/executed ContractVersions and FINAL document content are
  immutable. Amendments create versions; Renewal creates a successor Contract
  and never rewrites predecessor terms/end date.
- Renewal Case is `OPEN`, `COMPLETED`, `NOT_RENEWED` or `CANCELLED`; at most
  one OPEN case and one canonical successor exist per predecessor/case.
  Successor term starts at or after predecessor end. Completion requires an
  EXECUTED/ACTIVE successor.
- Supplier and approval links are validated against canonical, exact-version
  context. Execution evidence must bind the immutable version; approval is
  never evidence of signature/execution.
- Commercial document bytes live in central immutable object storage;
  database rows own metadata, governance, access references and hashes.
  Events/timelines carry references only.

### Permissions

`contract.create`, `contract.update`, `contract.execute`,
`contract.lifecycle`, `contract.amend`, `contract.renew`,
`contract.terminate`, `commercial_document.read`,
`commercial_document.write`, `commercial_document.finalize`; all are
tenant/resource scoped. Approval decisions use `approval.decide`.

### Required race/failure coverage

- UPDATE_DRAFT vs SUBMIT_FOR_SIGNATURE; RECALL_SIGNATURE vs RECORD_EXECUTION.
- ACTIVATE vs TERMINATE; AMEND vs TERMINATE.
- Concurrent RENEWAL.OPEN for one predecessor; COMPLETE vs MARK_NOT_RENEWED.
- Document finalization vs new/replacement version.
- Stale version-bound execution/amendment/renewal approvals must not authorize
  changed proposals. Durable uniqueness and optimistic concurrency are
  required; application prechecks alone are insufficient.

Implementation status: TASK-075-R1 is `CODE_COMPLETE` (specification only);
TASK-075 is `SATISFIED / CODE_COMPLETE`. Runtime persistence, commands, API,
permissions, conditional approvals, immutable ContractVersions, renewal
successors, document governance, audit/outbox/timeline and renewal Work Queue
integration are implemented and exercised by PostgreSQL E2E tests. See
`tasks/TASK-075_IMPLEMENTATION_REPORT.md` and
`tasks/TASK-075_CONTRACT_RENEWAL_COMMERCIAL_DOCUMENT_GOVERNANCE.md`.

The API uses the central `ObjectStore` boundary and verifies object metadata
outside the database transaction. Deployment must inject a configured storage
adapter before commercial documents can be finalized; the default unavailable
adapter fails closed. TASK-076-R1 has made Contract trigger scheduling and
canonical Asset/License cost provenance normative. TASK-076 is
`READY / NOT_STARTED`; it must verify the cross-domain path and environment
capability against
`tasks/TASK-076_PHASE4_PROCUREMENT_TO_ASSET_INTEGRATION_GATE.md`.

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
Committed outbox events → inbox-deduped Search Indexer
Bounded canonical reindex command for rebuild/reconciliation
```

### Guardrails

```text
search != canonical
RBAC filter mandatory
exact identifier > fuzzy
per-result owning-domain read permission and resource scope
source_version prevents stale overwrite; deletion uses tombstones
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
| Invoice approval command | `invoice.approve` (linked exception decision uses `approval.decide`) |
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
| Network observation | IP, MAC | hostname/vendor/model/switch |
| Software product | product code, aliases | name/vendor/category |
| License entitlement | product code, license type | product name/vendor |
| PO | PO code | supplier/line |
| Invoice | normalized supplier document number + supplier + tenant + document type | supplier/date/currency/PO/amount candidate fingerprint |
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

TASK-092 adds event-driven Incident-domain candidate discovery and immutable
CorrelationDecision evidence while reusing TASK-033 Incident/Root ownership
and TASK-051 topology freshness. TASK-090 primitives are optional where
applicable; no Action Intent/TASK-091 execution path is involved.

| Slice | Canonical data | Commands / events | Authorization | Required integrity |
|---|---|---|---|---|
| Candidate discovery/scoring | Incident; immutable decision/candidate evidence | event evaluation; `INCIDENT.CORRELATION_EVALUATED` | tenant-scoped read | Versioned 0..100 profile; TASK-051 freshness; explain each contribution; no cross-tenant disclosure |
| Automatic link/root creation | relationship history; deterministic active cluster | `INCIDENT.LINKED_TO_ROOT`, `ROOT_INCIDENT.CREATED_FROM_CORRELATION` | `incident.correlation.link` via AuthorizationPort | ≥85 + strong + unambiguous; deterministic source-key Root creation only; durable uniqueness |
| Human review/attach/detach | manual decision, active/detached relation, suppression history | attach/reject/detach commands and correlation events | `.review` / `.detach`, tenant/resource scope | expected version, reason, idempotency, immutable machine evidence, one active Root per child |
| History/fallback | audit/timeline/Work Queue | append-only audit/outbox; one Work Item per unresolved decision | scoped read | no ordinary NO_LINK item; no lifecycle close/delete/merge; no TASK-091 executor |

Required acceptance coverage includes scoring thresholds/strong signals,
fresh/stale topology, candidate ambiguity, tenant isolation, Root preference
and deterministic dedupe, attach/detach races and history, suppression,
replay idempotency, explanation/audit/outbox/Work Queue, and proof that no
remediation executor is called. Detailed normative contract:
`tasks/TASK-092_ADVANCED_INCIDENT_CORRELATION.md`.

Runtime implementation is recorded in
`tasks/TASK-092_IMPLEMENTATION_REPORT.md`: tenant-scoped event consumption,
immutable decision/candidate evidence, deterministic Root creation/linking,
human attach/reject/detach APIs, scoped `SYSTEM_CORRELATION` authorization,
deduplication, bounded retry fallback and PostgreSQL race coverage. TASK-092
does not call TASK-091 or mutate monitoring/topology facts.

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

# 77. Supplier Lifecycle Traceability — F-039 / WF-P01

| Concern | Normative contract | TASK-070 verification evidence |
|---|---|---|
| Owner and canonical data | Procurement owns tenant-scoped Supplier state; no hard delete; shared `version`; append-only change history | DB tenant constraints, no-delete behavior, version/history integration tests |
| Commands and transitions | `SUPPLIER.CREATE`, `UPDATE_PROFILE`, `APPROVE`, `MARK_PREFERRED`, `REMOVE_PREFERRED`, `SUSPEND`, `RESUME`, `BLOCK`, `UNBLOCK`, `DEACTIVATE`, `REACTIVATE`; exact transitions in state-machine spec | One success and invalid-state test per command/transition |
| Authorization | `supplier.read`, `supplier.create`, `supplier.update`, `supplier.approve`, `supplier.status.change`, `supplier.block`; tenant and resource scope checked server-side; no `supplier.manage` | Permission and scope denial tests for command mappings |
| Concurrency/idempotency | `expected_version` and durable `Idempotency-Key`; competing profile/state writes cannot both commit from one version | Concurrent conflicting-transition test, stale version test, duplicate replay/no duplicate event test |
| Audit, timeline and events | Before/after audit, outbox and idempotent timeline projection; eleven Supplier master events plus `PROCUREMENT.REQUEST_CREATED` / `PROCUREMENT.REQUESTED` exclude protected values | Atomic commit/rollback tests, timeline source-event dedupe, event schema tests, no sensitive value assertions |
| Commercial eligibility/history | RFQ candidates: PROSPECT/APPROVED/PREFERRED; PO issue: APPROVED/PREFERRED; state change preserves historical commercial records | RFQ/PO canonical-state eligibility tests; referenced history remains unchanged |
| Procurement Request vertical slice | Request create/review lifecycle stays within its existing explicit normative transitions | Request integration tests, tenant and source-boundary tests |

Supplier state changes do not automatically cancel existing RFQ, Quotation,
Purchase Order, Invoice or Contract records. Any future commercial remediation
is a separate workflow/task. TASK-070 is eligible to implement only after all
listed evidence and existing task acceptance criteria pass.

---

# 78. RFQ + Quotation Lifecycle Traceability — F-040 / WF-P02

| Concern | Normative contract | TASK-071 verification evidence |
|---|---|---|
| Owner and canonical data | Procurement owns tenant-bound RFQ, Quotation, versions and append-only history | Tenant FK/constraint, history immutability and aggregate version tests |
| RFQ commands | CREATE, UPDATE_DRAFT, ISSUE, CLOSE_SUBMISSIONS, AWARD, CLOSE_NO_AWARD, CANCEL; exact matrix in state-machine/workflow specs | Valid/invalid-state command tests, terminal-state tests |
| Quotation commands | CREATE, UPDATE_DRAFT, SUBMIT, WITHDRAW, DISQUALIFY plus parent-RFQ award/close/cancel decisions | Every transition, parent-driven child effects and immutable submitted-value tests |
| Permissions and scope | Granular `rfq.*`, `quotation.*`; DISQUALIFY uses `quotation.evaluate`; tenant/resource scope on all operations; conditional own-Supplier scope for supplier-facing principals | Permission/resource/supplier-scope denials and read-scope tests |
| Supplier eligibility | Participation/submission: PROSPECT/APPROVED/PREFERRED; award: APPROVED/PREFERRED only | Submit/award tests across canonical Supplier states, including Prospect upgrade before award |
| Revision and uniqueness | New revision links withdrawn prior quotation; one current SUBMITTED quote per tenant/RFQ/Supplier | Partial unique constraint and parallel submit test; submitted commercial values remain unchanged |
| Atomic decisions and events | AWARD accepts selected, rejects all other SUBMITTED and VOID-transitions remaining DRAFT; CLOSE_NO_AWARD rejects SUBMITTED and VOID-transitions DRAFT; CANCEL voids DRAFT/SUBMITTED. No terminal RFQ retains a non-terminal quotation. | Rollback/atomicity tests and exact RFQ/Quotation event payload assertions |
| Award approval | Approval is conditional on linked same-tenant `RFQ_AWARD` requests targeting the RFQ; every linked request must be APPROVED; none linked means no approval requirement and no auto-creation | Approved/missing/pending/rejected/expired/cancelled and cross-tenant/source mismatch tests |
| Concurrency/idempotency | Submit vs close; award vs cancel; parallel same-supplier submissions; expected_version and durable idempotency | Three required DB-backed race tests; loser has no duplicate effects |
| Events | `RFQ.CREATED`, `UPDATED`, `ISSUED`, `SUBMISSIONS_CLOSED`, `CANCELLED`, `AWARDED`, `CLOSED_NO_AWARD`; `QUOTATION.CREATED`, `UPDATED`, `SUBMITTED`, `WITHDRAWN`, `DISQUALIFIED`, `ACCEPTED`, `REJECTED`, `VOIDED` | Event contract validation and transactional outbox assertions; preliminary event names are not emitted |

RFQ commercial terms are editable only in DRAFT. Material changes after issue
require cancellation and a new RFQ; TASK-071 must not create an OPEN amendment
workflow. A quotation in SUBMITTED is immutable; revision is a linked new
record. Supplier eligibility is revalidated against canonical state at the
relevant command boundary. Required approval remains separate from `rfq.award`
permission.

---

# 79. Phase 4 Procurement-to-Asset Integration Gate — TASK-076

TASK-076 verifies the Phase 4 Definition of Done in
`docs/MVP_PHASED_IMPLEMENTATION_PLAN.md` §90 as one traceable system flow, not
as isolated CRUD checks.

| Gate criterion | Canonical path/evidence | Required gate result |
|---|---|---|
| Procurement Request to PO | Supplier → Procurement Request → RFQ/Quotation where used → issued PO; PO source quotation and winning Supplier are preserved | One authorized, tenant-scoped request produces a valid PO under TASK-070/071/072 guards |
| Receiving creates Assets | Issued PO → POSTED Goods Receipt → outbox → Asset-owned registration per `received_unit_id` | Accepted serialized units register idempotently in RECEIVED/UNASSIGNED state; procurement does not write Asset tables |
| Partial receiving | Multiple posted receipts update accepted PO quantities and receipt state | No over-receipt; last-quantity race serializes; PO lifecycle does not auto-close |
| Invoice duplicate prevention and 3-Way Match | Immutable submitted Invoice + PO version + POSTED accepted Goods Receipt evidence + durable allocations | Exact duplicate is blocked; partial invoices allocate without double consumption; draft/cancelled receipts do not count |
| Contract alert / renewal | Version-bound explicit notice date/period → stable alert fact → event/Work Queue/notification | No global threshold; date precedence/period derivation/version recalc/idempotency pass; alert never executes or extends Contract |
| Commercial documents | central governed metadata/version/ObjectStore boundary | Content versions/hash/governance are immutable; environment reports configured ObjectStore or explicit unavailable/not-ready; test fake is not production proof |
| Asset cost provenance | received unit → receipt/PO line and version → committed allocation → effective Invoice actual allocation → Credit Note adjustment; Contract source where applicable | Source amount/currency and history remain immutable; allocation reconciles exactly and no direct cross-domain writes occur |
| License cost provenance | License Entitlement/Pool → Contract/ContractVersion and applicable PO/Invoice/Credit Note line | Canonical IDs/version/period and basis are queryable; renewals add new period records; assignment does not rewrite cost |

Cost source types are `PURCHASE_ORDER`, `INVOICE`, `CREDIT_NOTE`, `CONTRACT`
and `CONTRACT_VERSION`. Cost bases are `COMMITTED`, `ACTUAL` and
`ADJUSTMENT`. Summary fields are projections only. Non-line charges remain at
source unless an explicit allocation method exists. Contract alert identity
is tenant + Contract + ContractVersion + trigger type + trigger time. Both
alert and cost consumers are idempotent under event redelivery.

TASK-076 must record gate evidence for each row, cross-domain ownership and
failure/retry outcome, then set the phase gate to passed only if every
criterion is verified and environment capability is reported. It must not
weaken TASK-070 through TASK-075 rules, introduce silent commercial
corrections, or count fake ObjectStore configuration as production readiness.

---

# 80. TASK-091 Controlled Self-Healing + Compensation — v1

TASK-091 v1 implements only `RESTART_AGENT` for a canonically registered
Agent. It consumes `READY` intents and rechecks capability, current tenant
policy, `SYSTEM_AUTOMATION` permission/resource scope, approval,
conflict/cancellation, kill switch and target identity immediately before
dispatch. Action Intent remains an immutable decision/request; execution and
attempt history are persisted separately.

| Gate | Canonical evidence | Required verification |
|---|---|---|
| Execution authorization | Fresh capability/policy/principal/scope/approval/conflict/kill-switch/target checks | Any denial, stale or unavailable evidence prevents dispatch and is explained |
| Agent command safety | Fixed typed RESTART_AGENT envelope, authenticated enrolled Agent, stable command ID and durable inbox dedupe | No arbitrary command body; same-command redelivery cannot restart twice |
| Execution lifecycle | Separate Action Execution, state transitions, unique automatic attempt and atomic lease | Competing workers/crash recovery do not double-dispatch |
| Acceptance and verification deadlines | Immutable `acceptance_deadline_at = dispatched_at + 30 seconds`; separate five-minute verification deadline starts at authenticated `accepted_at` | No ACCEPTED by deadline or ambiguous post-dispatch delivery becomes UNKNOWN; acceptance timeout does not start verification |
| Verification | Immutable pre-execution `agent_runtime_id` baseline and authenticated post-acceptance runtime marker | Old-session heartbeat/ACK do not pass; new runtime within five minutes of ACCEPTED succeeds; late runtime evidence after UNKNOWN is retained without rewriting outcome |
| Outcomes/recovery | SUCCEEDED / FAILED / UNKNOWN; at most one Work Item for terminal exception | Acceptance/verification timeout and ambiguous delivery are UNKNOWN; late ACCEPTED does not resurrect; no automatic retry or compensation |
| Cancellation/manual retry | `execution.cancel` before proven acceptance; `execution.retry` only after reconciliation | Post-acceptance/ambiguous cancellation is rejected; manual retry has new linked IDs and fresh checks |
| Events/audit/timeline | Transactional execution outbox and append-only security evidence | Replay idempotent; no Agent secrets; Work Queue is not source of truth |
| Business boundary | Execution result proves only Agent restart | No automatic Incident closure or invented inverse/compensation |

Required tests cover policy/security rechecks, unsupported actions, claim
races, authenticated Agent delivery/acceptance, the 30-second acceptance
deadline and ACCEPTED-vs-timeout race, runtime-marker verification with a
separate five-minute deadline from `accepted_at`, late evidence after UNKNOWN,
lost acknowledgement, explicit rejection, pre/post-acceptance cancellation,
manual retry lineage, duplicate delivery, worker crash after dispatch, unique
Work Queue fallback and preservation of Incident state.

---

## TASK-093 Knowledge Deflection Traceability

| Capability | Normative source | Acceptance evidence |
|---|---|---|
| Governed Knowledge candidate retrieval | TASK-037 lifecycle + TASK-061 Search + TASK-093 contract | Current `PUBLISHED` version, tenant/read/audience/scope validation, stale-version recheck and no metadata leakage |
| Explainable recommendation | TASK-093 v1 profile | Versioned evidence contributions, 0..100 score, >=70 candidate threshold, max three end-user results, no filler |
| Session, item and interaction history | TASK-093 data model/events | Exact article/profile versions, durable idempotency, append-only feedback and resolution evidence |
| Deflection and Ticket handoff | Helpdesk canonical Ticket workflow | Explicit resolution only; no-result/unresolved path preserves context/session and uses Ticket intake; no automatic closure |
| Incident-aware guidance | TASK-092 + TASK-093 | Eligible Root context can prioritize safe guidance; known-incident deflection separately measured; no Incident mutation |
| Security and domain boundaries | Permissions, Search, Audit, TASK-090/091 boundary | No unauthorized leakage, no generated authoritative fallback, no remediation execution |
| Operational measures | Reporting/KPI workflow | Clicks distinct from confirmed deflection; actionable Work Queue only for exceptions |

Detailed implementation gate and required tests: `tasks/TASK-093_KNOWLEDGE_DEFLECTION_SELF_SERVICE_RECOMMENDATIONS.md`.
Runtime implementation and full verification: `tasks/TASK-093_IMPLEMENTATION_REPORT.md`.

## TASK-093-R2A Canonical Reference Foundation

| Capability | Owner / persistence | Acceptance evidence |
|---|---|---|
| Service catalog | Service Reference / tenant-scoped relational records | unique tenant key, explicit lifecycle, scoped API and query contract |
| Platform catalog and observation resolution | Service Reference / typed Platform family | exact unique configured match only; unresolved text contributes no canonical applicability |
| ServiceEnvironment | Service Reference / composite Service FK | same-tenant active parent validation, unique key per Service, no hard-coded environment enum |
| Incident Service link | Incident / canonical composite FK plus preserved legacy column | no guessed historical mappings; new links tenant-validated |
| Knowledge applicability prerequisites | Service Reference + TASK-054 + TASK-037 | no duplicate catalog; typed canonical target identities |

Detailed contract: `tasks/TASK-093-R2A_CANONICAL_SERVICE_PLATFORM_REFERENCE_FOUNDATION.md`.

## TASK-093-R2 Knowledge Foundation Gate

| Capability | Owner / persistence | Acceptance evidence |
|---|---|---|
| Knowledge audience and narrow reads | TASK-037 Problem/Knowledge | legacy defaults fail closed; audience and RBAC both enforced |
| Typed applicability | Knowledge links to Service, Platform, Environment, Software Product, Problem/Known Error | composite tenant FKs, canonical ID/state validation, auditable replacement |
| Knowledge Search | TASK-061 projection/indexer | published-only indexing, audience action, canonical version check, no unauthorized metadata leak |
| Incident recommendation context | Incident application query | minimal same-tenant active Root/Service output, read-only and non-mutating |
| Ticket handoff provenance | Helpdesk `TICKET.CREATE` | optional typed immutable source reference; backward-compatible idempotent creation |

TASK-093-R2 does not implement recommendation sessions, score/rank, feedback,
deflection, or recommendation APIs; those remain TASK-093.

## TASK-094 Asset Risk + Replacement Scoring

| Capability | Owner / persistence | Acceptance evidence |
|---|---|---|
| Operational Risk assessment | Asset-owned immutable assessment/profile history; current condition, canonical Incident/Monitoring episodes, corrective Maintenance | exact v1 weights/bands, completeness/UNKNOWN behavior, Root and Monitoring episode dedup, append-only evidence |
| Replacement Priority assessment | Asset-owned immutable assessment; Risk, verified age/useful-life policy, Warranty and canonical same-currency ACTUAL cost evidence | exact v1 score/bands, no FX, no duplicate failure counts, missing dimensions lower completeness |
| Canonical age and useful-life inputs | Asset verified acquisition/in-service evidence and tenant/category/version policy | provenance retained, no `created_at` guessing, explicit policy version, historical assessments unchanged |
| TASK-059 integration | Asset application command/port | PLAN/PRIORITY may request one human Replacement Candidate; no direct table write, no reopen after terminal human disposition |
| Current projections and review work | Asset latest projection + Operations Work Queue projection | 24-hour freshness, stale Risk is UNKNOWN, one deduplicated Work Item only for current CRITICAL Risk |
| Safety / boundaries | Asset scoring principal and owning-domain query contracts | no score-triggered PO/lifecycle/assignment/TASK-091 action; tenant/scope enforced; source documents and histories not leaked |

### TASK-094 prerequisite foundation — TASK-094-R2

| Capability | Owner / persistence | Acceptance evidence |
|---|---|---|
| Typed Maintenance classification/history | Maintenance orders and `MaintenanceAssetHistoryQuery` | legacy `UNKNOWN`, explicit typed creation, completed classification immutable, UNKNOWN history reported as ambiguous |
| Replacement Candidate recommendation boundary | Asset/TASK-059 application command | `AuthorizationPort`, idempotency, one-active candidate, review-state preservation, terminal disposition suppression |
| Offboarding Asset recovery | Identity Offboarding clearance + append-only recovery history | `MISSING`/`UNRETURNED` remain recovery states; Asset Risk is canonical and legacy meaning is preserved without guessed linkage |
| Scope boundary | TASK-094-R2 only | no scoring assessments, scoring formulas, policy, worker, Risk Work Queue or recalculation implemented |

Detailed implementation contract: `tasks/TASK-094_ASSET_RISK_REPLACEMENT_SCORING.md`.
TASK-094's prerequisite `SCOPE_DEPENDENCY` items were resolved by TASK-094-R2
and TASK-094-R3. Runtime scoring now consumes these domain-owned boundaries
without text inference or cross-domain SQL.

### TASK-094-R3 reliability and Warranty foundations

| Capability | Owner / persistence | Acceptance evidence |
|---|---|---|
| Incident–Asset linkage | Incident-owned active link + immutable link history | deterministic Monitoring/intake/manual sources only, same-tenant constraints, audited detach, no Root sibling propagation |
| Incident reliability query | Incident application boundary | direct Asset links, Root episode dedup, time-window filter, AVAILABLE_EMPTY distinct from query error |
| Monitoring reliability query | Monitoring application boundary | validated Asset identity, stable correlation episode grouping, source references, unresolved identity unavailable |
| Warranty authority | Maintenance source + `WarrantyAssetQuery` | UTC `WARRANTY_STATE_V1`, 90-day EXPIRING threshold, ambiguous/missing evidence UNKNOWN |
| Warranty projection | Asset derived dimension + worker | canonical enum only, minute reconciliation across temporal boundaries, idempotent state/outbox update |
| Scope boundary | TASK-094-R3 only | no Risk/Replacement assessment, scoring formula/worker, candidate recommendation or Work Queue risk item |

### TASK-094 scoring runtime

| Capability | Owner / persistence | Acceptance evidence |
|---|---|---|
| Immutable assessments and freshness | Asset risk/replacement assessment history and latest projection | separate versioned profiles, 0..100 scores, evidence contributions, completeness, 24-hour validity and stale-safe reads |
| Evidence composition | Asset application over Incident, Monitoring, Maintenance, Warranty and Procurement query ports | tenant-scoped queries, Root/episode dedupe, unknown evidence lowers completeness, verified age and canonical Warranty state |
| Useful-life and acquisition | Asset versioned category policy and append-only verified acquisition evidence; Procurement posted-receipt provenance query | no `Asset.created_at` guessing; receipt references are resolved within Procurement without cross-domain table reads |
| Decision support | TASK-059 candidate port and Operations Work Queue | PLAN/PRIORITY only recommends human review; CRITICAL Risk creates one durably deduplicated review item |
| Safety and replay | scoped `SYSTEM_ASSET_SCORING`, REPEATABLE READ transaction and durable assessment identity | no PO, lifecycle/assignment mutation, TASK-091 invocation or wildcard grant; repeated work is idempotent |

TASK-094 runtime implementation and verification are recorded in
`tasks/TASK-094_IMPLEMENTATION_REPORT.md`. TASK-095 readiness is recalculated
from its declared dependencies separately; completion does not start it.
