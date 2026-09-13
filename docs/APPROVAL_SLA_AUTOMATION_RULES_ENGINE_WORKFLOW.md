# APPROVAL ENGINE + SLA ENGINE + AUTOMATION RULES ENGINE WORKFLOW SPEC
## Execution-Level Control Plane Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:**  
- `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md`
- `ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `MAINTENANCE_WARRANTY_REPLACEMENT_DISPOSAL_WORKFLOW.md`
- `SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md`
- `PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md`
- `CHANNEL_BRANDING_NOTIFICATION_COMMUNICATION_WORKFLOW.md`

**Scope:** Approval Engine, Approval Routing, Delegation, Escalation, SLA Engine, Business Calendar, Pause/Resume, Breach Handling, Automation Rules, Conditions, Actions, Safety Guardrails, Retry, Rollback, Human Fallback, Rule Versioning, Explainability, Idempotency, Audit Trail

---

# 1. Mục tiêu

Tài liệu này định nghĩa control plane dùng chung cho toàn bộ hệ thống.

Ba engine cốt lõi:

```text
APPROVAL ENGINE
Ai cần phê duyệt?
Theo điều kiện nào?
Theo thứ tự nào?

SLA ENGINE
Khi nào timer bắt đầu?
Khi nào pause?
Khi nào cảnh báo/escalate/breach?

AUTOMATION RULES ENGINE
Khi sự kiện xảy ra
→ điều kiện nào được đánh giá
→ action nào được chạy
→ khi nào dừng / rollback / giao người xử lý
```

Mục tiêu:

- không hardcode approval trong từng module;
- không hardcode SLA timer trong từng loại ticket;
- không viết automation ad-hoc rời rạc;
- mọi rule đều versioned, explainable và auditable;
- workflow retry không gây duplicate side effect;
- automation nguy hiểm phải có guardrail;
- operator luôn biết tại sao hệ thống ra quyết định;
- có human fallback khi automation thất bại hoặc confidence thấp.

---

# 2. Core Entities

```text
APPROVAL POLICY
APPROVAL REQUEST
APPROVAL STEP
APPROVAL DECISION
APPROVER
DELEGATION
ESCALATION
APPROVAL MATRIX

SLA POLICY
SLA INSTANCE
SLA TARGET
SLA TIMER
BUSINESS CALENDAR
HOLIDAY CALENDAR
PAUSE CONDITION
BREACH EVENT

AUTOMATION RULE
RULE VERSION
RULE CONDITION
RULE ACTION
RULE EXECUTION
ACTION EXECUTION
RETRY POLICY
ROLLBACK POLICY
SAFETY POLICY
HUMAN FALLBACK
SCHEDULE
EVENT
AUDIT TRAIL
```

---

# 3. Control Plane Principle

Business workflow phát event:

```text
EVENT
↓
Policy Evaluation
├─ Approval required?
├─ SLA applicable?
└─ Automation applicable?
```

Ba engine không được thay thế business state machine.

Ví dụ:

```text
PROCUREMENT.REQUESTED
```

Business workflow vẫn quản lý procurement state.

Approval Engine chỉ trả lời:

```text
approval required
approvers
decision
```

---

# 4. Policy Resolution Order

Khi nhiều policy match:

```text
1. Explicit exception / override
2. Resource-specific policy
3. Department / Site policy
4. Category policy
5. Global default
```

Nếu có conflict:

```text
more restrictive wins
```

trừ khi policy định nghĩa khác.

---

# 5. Policy Versioning

Mỗi policy phải có:

```yaml
policy:
  id:
  version:
  status:
  effective_from:
  effective_to:
  owner:
  change_reason:
```

State:

```text
DRAFT
REVIEW
ACTIVE
DEPRECATED
RETIRED
```

Running workflow giữ policy version đã resolve tại thời điểm bắt đầu, trừ explicit migration rule.

---

# 6. APPROVAL ENGINE

---

# 7. Approval Trigger Sources

Approval có thể xuất hiện trong:

```text
Asset Request
Software Request
Paid License
Procurement
PO
Invoice Exception
Asset Transfer
High-value Stock Adjustment
Maintenance Cost
Replacement
Retirement
Disposal
Change Request
Emergency Change
Access Request
Privileged Role
Contract Renewal
Warranty Renewal
Exception Waiver
```

---

# 8. Approval Policy Model

```yaml
approval_policy:
  id:
  name:
  object_type:
  trigger:
  conditions:
  routing:
  quorum:
  timeout:
  escalation:
  delegation_allowed:
  reauth_required:
  segregation_rules:
```

---

# 9. Approval Routing Types

```text
SEQUENTIAL
PARALLEL
ANY_ONE
ALL_REQUIRED
QUORUM
CONDITIONAL
```

## Sequential

```text
Manager
→ IT Manager
→ Finance
```

## Parallel

```text
Security + Finance
```

## Any One

Một trong nhiều authorized approver.

## Quorum

Ví dụ:

```text
2 of 3 approvers
```

---

# 10. Approval Conditions

Có thể dựa trên:

```text
Amount
Risk
Asset Value
Software Classification
Department
Site
Service Criticality
Change Type
Security Impact
Data Sensitivity
Contract Value
License Cost
```

---

# 11. WF-APP01 — Create Approval Request

Flow:

```text
Business Workflow
↓
Policy Resolution
↓
Approval Required?
├─ NO → Continue
└─ YES
    ↓
Resolve Approver(s)
↓
Create Approval Request
↓
Notify
↓
Wait Decision
```

---

# 12. Approver Resolution

Approver có thể được resolve từ:

```text
User Manager
Department Manager
Cost Center Owner
Service Owner
Asset Owner
Security Role
Finance Role
Change Manager
Specific User
Dynamic Group
```

---

# 13. Approval Request Object

```yaml
approval_request:
  id:
  source_type:
  source_id:
  policy_id:
  policy_version:
  requested_by:
  amount_or_risk:
  context_snapshot:
  current_step:
  status:
  created_at:
  due_at:
```

---

# 14. Context Snapshot

Approval phải giữ snapshot:

```text
request details
amount
risk
asset
supplier
change impact
requested scope
```

để approver biết mình approve cái gì.

Nếu nội dung material thay đổi sau approval:

```text
approval invalidated
→ re-approval
```

---

# 15. Material Change Rules

Ví dụ material change:

```text
Amount increases > threshold
Supplier changed
Scope expanded
Risk increased
Target assets changed materially
Implementation plan changed materially
```

---

# 16. Approval Decision

Possible:

```text
APPROVE
REJECT
REQUEST_CHANGES
DELEGATE
ABSTAIN
```

Store:

```text
actor
decision
reason
timestamp
channel
auth_strength
```

---

# 17. Rejection

Reject:

```text
Approval Request → REJECTED
```

Business workflow decides:

```text
cancel
revise
resubmit
```

Approval engine không tự sửa business object.

---

# 18. Request Changes

```text
REQUEST_CHANGES
```

Flow:

```text
Return to requester
↓
Modify request
↓
Re-evaluate policy
↓
New approval version
```

---

# 19. Delegation

Delegation object:

```yaml
delegation:
  from:
  to:
  scope:
  valid_from:
  valid_until:
  reason:
```

Could be:

```text
all approvals
specific category
specific cost center
specific period
```

---

# 20. Delegation Guardrails

Không cho delegate:

```text
break-glass approval
certain security approvals
self-approval if segregation rules forbid
```

---

# 21. Approval Escalation

If no response:

```text
Reminder
→ Manager/Backup
→ Escalation Role
```

Example:

```text
T+4h reminder
T+8h manager
T+24h escalation owner
```

---

# 22. Approval Timeout

On timeout:

```text
EXPIRED
ESCALATED
AUTO_REJECT
```

depending policy.

Không auto-approve by default.

---

# 23. Segregation of Duties

Examples:

```text
Requester != Final Approver
Buyer != Invoice Approver
Change Implementer != High-risk Change Approver
Privileged Access Requester != Sole Approver
```

---

# 24. Self-Approval

Only if policy explicitly allows.

Example:

```text
Low-cost standard item
Manager requesting for own department
```

must still be auditable.

---

# 25. Approval via Channel

Allowed:

```text
Portal
Teams
Slack
Email link
Mobile
```

High-risk actions may require:

```text
SSO re-auth
MFA
authenticated portal
```

---

# 26. Approval State Machine

```text
PENDING
↓
IN_PROGRESS
├─ APPROVED
├─ REJECTED
├─ CHANGES_REQUESTED
├─ EXPIRED
└─ CANCELLED
```

---

# 27. Approval Metrics

```text
Average Approval Time
Approval Backlog
Rejection Rate
Expired Approval Count
Delegation Rate
Escalation Rate
```

---

# 28. SLA ENGINE

---

# 29. SLA Scope

SLA có thể áp dụng cho:

```text
Ticket
Incident
Major Incident
Service Request
Approval
Maintenance
Vendor Repair
Asset Return
Audit Exception
Procurement
Contract Renewal
```

---

# 30. SLA Policy Model

```yaml
sla_policy:
  id:
  object_type:
  conditions:
  targets:
  business_calendar:
  pause_rules:
  escalation_rules:
  breach_actions:
  priority_mapping:
```

---

# 31. SLA Targets

Examples:

```text
Time to Acknowledge
Time to First Response
Time to Assign
Time to Resolution
Time to Restore
Time to Approve
Time to Return Asset
Time to Complete Maintenance
Vendor Response Time
```

---

# 32. SLA Start

Start event configurable:

```text
Ticket Created
Incident Declared
Approval Requested
Asset Return Requested
Maintenance Opened
```

---

# 33. SLA Stop

Stop event:

```text
Acknowledged
Responded
Resolved
Approved
Asset Returned
Maintenance Completed
```

Each target has its own stop condition.

---

# 34. SLA Pause

Allowed states examples:

```text
WAITING_USER
WAITING_VENDOR
WAITING_APPROVAL
PLANNED_MAINTENANCE
```

But only if policy explicitly permits.

---

# 35. SLA Pause Guardrail

Do not pause just because:

```text
operator has not acted
team is busy
queue is large
```

Pause reason must be auditable.

---

# 36. Business Calendar

Support:

```text
24x7
Business Hours
Regional Calendar
Custom Shift Calendar
```

Calendar:

```yaml
calendar:
  timezone:
  working_days:
  working_hours:
  holidays:
  exceptions:
```

---

# 37. Timezone

SLA uses:

```text
policy timezone
or
service/site timezone
```

not browser timezone by default.

---

# 38. Holiday Calendar

Could vary by:

```text
Country
Site
Business Unit
```

---

# 39. SLA Instance

```yaml
sla_instance:
  object:
  policy:
  target:
  started_at:
  due_at:
  paused_duration:
  remaining:
  status:
```

---

# 40. SLA Status

```text
RUNNING
PAUSED
WARNING
CRITICAL
BREACHED
MET
CANCELLED
```

---

# 41. SLA Thresholds

Example:

```text
70% → WARNING
90% → CRITICAL
100% → BREACHED
```

Could also use remaining absolute time.

---

# 42. SLA Escalation

Example:

```text
70% → Assignee
90% → Team Lead
100% → Service Owner
120% → Incident/Operations Manager
```

---

# 43. Priority Change

If ticket priority changes:

```text
recalculate SLA?
```

Policy options:

```text
KEEP_ORIGINAL
RECALCULATE_FROM_START
RECALCULATE_REMAINING
NEW_TARGET_FROM_CHANGE_TIME
```

Must be explicit.

---

# 44. SLA Policy Change

Running instances do not silently migrate to new policy version.

Options:

```text
grandfather old
manual migrate
bulk migrate with audit
```

---

# 45. SLA Breach Event

```text
SLA.BREACHED
```

Actions can include:

```text
notification
escalation
manager work item
reporting
priority increase
```

---

# 46. Vendor SLA

External supplier SLA can use same engine.

Examples:

```text
Warranty Response
Repair Turnaround
Quote Response
Delivery SLA
```

---

# 47. OLA / Internal Target

Could support:

```text
OLA
```

between internal teams.

Example:

```text
Helpdesk → Network Team
30 min accept target
```

---

# 48. SLA Metrics

```text
SLA Compliance
Average Breach Duration
First Response Compliance
Resolution Compliance
By Service
By Team
By Priority
```

---

# 49. AUTOMATION RULES ENGINE

---

# 50. Automation Principle

Automation uses:

```text
WHEN Event
IF Conditions
THEN Actions
```

Example:

```text
WHEN AGENT.OFFLINE_THRESHOLD
IF Asset.Lifecycle = In Use
AND Asset.Type = Laptop
AND Network.Reachable = true
THEN Restart Agent Service
```

---

# 51. Automation Rule Model

```yaml
automation_rule:
  id:
  name:
  trigger:
  conditions:
  actions:
  priority:
  safety_level:
  retries:
  rollback:
  timeout:
  human_fallback:
  enabled:
  version:
```

---

# 52. Trigger Types

```text
EVENT
SCHEDULE
STATE_CHANGE
THRESHOLD
MANUAL
API
```

---

# 53. Event Trigger

Examples:

```text
TICKET.CREATED
MONITORING.CRITICAL
AGENT.OFFLINE
ASSET.WARRANTY_EXPIRING
LICENSE.OVERUSED
AUDIT.LOCATION_MISMATCH
```

---

# 54. Schedule Trigger

Examples:

```text
daily
hourly
weekly
monthly
cron-like schedule
```

Use cases:

```text
expiry watch
inventory refresh
license review
contract check
```

---

# 55. Condition Operators

Support:

```text
equals
not equals
contains
in
not in
greater than
less than
exists
changed
matches regex
within time window
```

---

# 56. Compound Conditions

```text
AND
OR
NOT
```

Example:

```text
Asset.Health = Critical
AND
Warranty = Expired
AND
RepairCost > 50% ReplacementCost
```

---

# 57. Context Lookups

Rules may query:

```text
Asset
User
Service
Monitoring
Agent
Network
License
Contract
History
Open Incidents
```

Need timeout and failure handling.

---

# 58. Action Types

```text
UPDATE_FIELD
CREATE_RECORD
LINK_RECORD
SEND_NOTIFICATION
RUN_AGENT_ACTION
CALL_WEBHOOK
CREATE_TICKET
CREATE_INCIDENT
CREATE_APPROVAL
ASSIGN_TEAM
START_WORKFLOW
PAUSE_WORKFLOW
EXECUTE_SCRIPT
SCHEDULE_JOB
```

---

# 59. Safety Levels

```text
SAFE
LOW_RISK
CONTROLLED
HIGH_RISK
PROHIBITED_AUTO
```

Examples:

```text
Restart agent service → SAFE/LOW_RISK
Install approved software → CONTROLLED
Change production VLAN → HIGH_RISK
Delete asset record → PROHIBITED_AUTO
```

---

# 60. Action Authorization

Automation runs under:

```text
System Automation Principal
```

with explicit allowed permissions.

Do not let rule bypass RBAC.

---

# 61. Policy Gate

Before action:

```text
Rule Match
↓
Safety Policy
↓
Permission Check
↓
Conflict Check
↓
Execute
```

---

# 62. Approval Before Automation

Some actions:

```text
Rule matches
↓
Create Approval
↓
Approved?
├─ YES → execute
└─ NO → stop
```

---

# 63. Auto-remediation Pipeline

```text
Detect
↓
Pre-check
↓
Execute
↓
Post-check
↓
Verified?
├─ YES → Complete
└─ NO → Retry/Rollback/Human
```

---

# 64. Pre-check

Could include:

```text
asset reachable
maintenance window
no conflicting change
agent healthy
required backup exists
permissions valid
```

---

# 65. Verification

Automation success requires verification.

Examples:

```text
Restart service
→ heartbeat restored

Install software
→ version detected

Change VLAN
→ rediscovery confirms VLAN
```

---

# 66. Retry Policy

```yaml
retry:
  max_attempts:
  backoff:
  retryable_errors:
  timeout:
```

No infinite retry.

---

# 67. Backoff

Support:

```text
fixed
linear
exponential
```

---

# 68. Rollback Policy

If action partially succeeds:

```text
rollback
```

Examples:

```text
software deployment → uninstall new version
network change → restore previous config
```

Not every action supports rollback.

---

# 69. Human Fallback

If:

```text
automation failed
confidence low
permission denied
approval rejected
context unavailable
```

then:

```text
Create Work Item
```

with full evidence.

---

# 70. Explainability

Every execution must answer:

```text
Why did this rule run?
Which conditions matched?
Which policy version?
Which actions executed?
What changed?
```

---

# 71. Rule Execution Object

```yaml
rule_execution:
  id:
  rule:
  version:
  trigger_event:
  matched:
  condition_results:
  actions:
  started_at:
  completed_at:
  result:
```

---

# 72. Action Execution Object

```yaml
action_execution:
  action:
  target:
  input:
  before:
  after:
  result:
  error:
  verification:
```

---

# 73. Rule Priority

If multiple rules match:

```text
priority
```

Could support:

```text
stop_processing = true
```

to prevent conflicting actions.

---

# 74. Rule Conflict Detection

Example:

```text
Rule A → set priority P1
Rule B → set priority P3
```

Need conflict resolution.

Options:

```text
higher priority rule wins
explicit precedence
merge only non-conflicting actions
human review
```

---

# 75. Rule Recursion Protection

Rule action may emit event that triggers another rule.

Need:

```text
execution_depth
cycle detection
correlation_id
```

Prevent infinite loops.

---

# 76. Cooldown

Example:

```text
restart agent
```

should not run every minute.

Policy:

```text
cooldown = 30 minutes
```

---

# 77. Debounce

For noisy signals:

```text
event must persist N minutes
```

before action.

Example:

```text
CPU > 90% for 10 min
```

---

# 78. Flapping Protection

If state rapidly changes:

```text
online/offline
```

automation can:

```text
suppress repeated action
create instability work item
```

---

# 79. Correlation Context

Rules should operate on correlated events when applicable.

Example:

```text
48 endpoints offline
```

should not trigger 48 independent remediation jobs if Root Incident explains them.

---

# 80. Automation Maintenance Windows

Actions may only run in:

```text
approved window
```

unless emergency policy.

---

# 81. Dry Run / Simulation

Rule can run in:

```text
DRY_RUN
```

showing:

```text
would match
would execute
affected entities
```

No side effects.

---

# 82. Test Mode

Before activation:

```text
historical event replay
sample data
simulation
```

---

# 83. Rule Activation

State:

```text
DRAFT
REVIEW
ACTIVE
DISABLED
DEPRECATED
RETIRED
```

---

# 84. Rule Change Approval

High-risk automation rule changes may require approval.

Example:

```text
new rule can reboot servers
```

→ Security/Change approval.

---

# 85. Rule Version Migration

Existing scheduled executions keep original version unless explicitly migrated.

---

# 86. Kill Switch

Global:

```text
Disable all automation
Disable category
Disable specific rule
```

Use during incident or unsafe behavior.

---

# 87. Emergency Disable

Need:

```text
fast privileged action
full audit
notification to automation owner
```

---

# 88. Automation Ownership

Every rule must have:

```text
owner
team
purpose
review_date
```

No ownerless automation.

---

# 89. Rule Review

Periodic review:

```text
unused
high failure
high rollback
obsolete
unsafe
```

---

# 90. Approval + SLA Integration

Approval wait can affect SLA.

Policy choices:

```text
SLA pauses while waiting approval
or
SLA continues
```

Must be explicit per target.

---

# 91. Approval + Automation Integration

Automation can:

```text
create approval
wait
resume after decision
```

Idempotency required.

---

# 92. SLA + Automation Integration

At SLA threshold:

```text
SLA.WARNING
```

can trigger automation:

```text
notify
reassign
escalate
increase priority
```

---

# 93. Example — Software Approval

```text
Software Request
↓
Policy:
Paid + Restricted
↓
Approvers:
Manager → Software Owner
↓
SLA:
Approval target = 8 business hours
↓
Approved
↓
Automation resumes
↓
Deploy artifact
```

---

# 94. Example — Agent Offline

```text
AGENT.OFFLINE_THRESHOLD
↓
Rule conditions match
↓
Safety = LOW_RISK
↓
Restart Agent
↓
Verify heartbeat
↓
Success
```

If fail:

```text
Retry 2x
↓
Human Work Item
```

---

# 95. Example — High-cost Repair

```text
Repair Quote = 15M
↓
Approval Policy resolves:
IT Manager + Finance
↓
Approval SLA = 1 business day
↓
Approved
↓
Maintenance resumes
```

---

# 96. Example — SLA Escalation

```text
P1 Incident
Resolution SLA = 4h

70%
→ notify assignee

90%
→ team lead + incident manager

100%
→ breach event
→ service owner
→ escalation work item
```

---

# 97. Example — Warranty Expiry Automation

```text
Daily Schedule
↓
Find Warranty <30d
↓
If Replacement Score < threshold
→ Create Renewal Review
Else
→ Create Replacement Candidate
```

---

# 98. Example — Audit Auto-correction

```text
Audit Location Mismatch
↓
QR = Floor 2
Switch = Floor 2
Agent subnet = Floor 2
Confidence = 98%
↓
Policy allows low-risk location correction
↓
Update Asset Location
↓
Create Movement
↓
Resolve Exception
```

---

# 99. Example — Network VLAN Change

```text
VLAN mismatch
↓
Rule detects production asset
↓
Safety = HIGH_RISK
↓
Automation cannot direct execute
↓
Create Change Request
↓
Approval
↓
Network action
↓
Verify
```

---

# 100. Generated Events

## Approval

```text
APPROVAL.CREATED
APPROVAL.STEP_STARTED
APPROVAL.REMINDER
APPROVAL.ESCALATED
APPROVAL.APPROVED
APPROVAL.REJECTED
APPROVAL.CHANGES_REQUESTED
APPROVAL.EXPIRED
```

## SLA

```text
SLA.STARTED
SLA.PAUSED
SLA.RESUMED
SLA.WARNING
SLA.CRITICAL
SLA.BREACHED
SLA.MET
SLA.CANCELLED
```

## Automation

```text
RULE.MATCHED
RULE.NOT_MATCHED
AUTOMATION.STARTED
AUTOMATION.ACTION_STARTED
AUTOMATION.ACTION_SUCCEEDED
AUTOMATION.ACTION_FAILED
AUTOMATION.RETRY
AUTOMATION.ROLLBACK_STARTED
AUTOMATION.ROLLED_BACK
AUTOMATION.HUMAN_FALLBACK
AUTOMATION.COMPLETED
AUTOMATION.DISABLED
```

---

# 101. Permissions

## Policy Admin

```text
create/edit policies
```

## Approval Admin

```text
manage approval routing
delegation policy
```

## SLA Admin

```text
manage calendars
targets
escalations
```

## Automation Admin

```text
create rules
test rules
activate low-risk rules
```

## Security / Change Manager

```text
approve high-risk automation
```

## Operator

```text
view rule execution
retry allowed actions
```

---

# 102. Audit Trail

Every decision stores:

```text
policy
version
input
condition results
actor
decision
timestamp
before
after
```

For automation:

```text
trigger_event
correlation_id
rule_version
action
verification
rollback
```

---

# 103. Metrics / KPI

## Approval

```text
Approval Time
Backlog
Escalation Rate
Rejection Rate
Timeout Rate
```

## SLA

```text
Compliance
Breaches
Average Remaining Time
Breach Duration
By Team/Service/Priority
```

## Automation

```text
Automation Success Rate
Failure Rate
Rollback Rate
Human Fallback Rate
Tickets Avoided
Time Saved
Rule Match Count
False Positive Rate
```

---

# 104. Idempotency

Examples:

```text
approval:{source}:{policy_version}
sla:{object}:{target}:{policy_version}
automation:{rule}:{trigger_event}:{target}
action:{execution}:{action_index}
```

Retry must not duplicate:

```text
approval request
notification
ticket creation
incident creation
movement
license assignment
deployment
```

---

# TASK-090 Normative Rules Engine Boundary

This section is normative for TASK-090 and clarifies the broader automation
catalog above. TASK-090 supports event triggers only. Schedule, recurring,
delayed, absence-of-event, sustained-condition and occurrence-window triggers
require a future explicit scheduler/windowed-rule contract. Ordinary numeric,
string and set comparisons against the current event/context remain supported.

For TASK-090, Rule lifecycle is `DRAFT`, `ACTIVE` or `INACTIVE` (or equivalent
repository representation), while version lifecycle is independently
`DRAFT` or `PUBLISHED`. Broader review/deprecation/retirement states remain
future governance states unless their transitions are explicitly defined.
High-risk activation requires an approved `AUTOMATION_RULE_ACTIVATION` request
in the same tenant targeting the rule and exact published version, bound to
its immutable content/context.

TASK-090 owns rule definition/versioning, validation, publication,
activation/deactivation, simulation, event matching, condition evaluation,
policy/safety gate decisions, durable Action Intent creation,
deduplication/conflict detection, human fallback for unresolved conflicts,
kill-switch enforcement, and decision audit/outbox/timeline/observability.
Published versions are immutable. Editing a published definition creates a
new version. Production event evaluation uses only the active published
version. Evaluation and intent history retain their exact rule/version and
are not rewritten by later rule changes.

Simulation uses the production evaluator/policy semantics as far as practical
but cannot create an executable intent, mutate a target domain, or invoke an
action adapter. Simulation evidence is marked separately from production
evaluation.

Policy evaluation returns `ALLOW`, `DENY` or `REQUIRE_APPROVAL`. A match alone
does not authorize an action. `ALLOW` may produce a READY intent only after
permission, tenant/resource scope, target, conflict and kill-switch checks.
`DENY` is non-executable. `REQUIRE_APPROVAL` remains non-executable until an
appropriately scoped Approval Engine request bound to the intent/action
context with purpose `AUTOMATION_ACTION_INTENT` is approved. TASK-090 does not
decide approvals or invent a missing
approval policy. The most restrictive decision applies when deduplicated
contributors differ: DENY, then REQUIRE_APPROVAL, then ALLOW.

On Approval Engine decision delivery, an idempotent internal intent
re-evaluation validates same-tenant target, approval purpose, exact intent and
context hash, current conflict state and kill switch. A valid APPROVED request
may promote the intent to READY. Rejected, expired, cancelled, stale or
mismatched approval remains non-executable. TASK-091 rechecks again immediately
before acting.

An Action Intent is a durable request, not a completed action. Identical
normalized actions for the same target and event/decision context deduplicate
to one canonical intent while retaining every contributing rule/version.
Compatible intents for one target may coexist. Conflict is only defined for
mutually incompatible actions sharing a declared tenant/target/action-domain/
exclusivity-group/decision-context scope; target identity alone is not a
conflict. Rule priority never resolves business-action conflicts. Conflicting
intents are non-executable and create one idempotent actionable human fallback
with all source references.

Conflict resolution is explicit. An authorized human selects the compatible
intent set to retain with reason, expected version and idempotency key. The
command rechecks policy, approval, target scope and kill switch, cannot
override DENY, and records the selected and blocked intents. Resolving the
Work Item alone does not resolve the canonical conflict.

For one source event/decision context, stage candidates from all matching
active rule versions and complete deduplication/conflict detection before any
candidate becomes READY. Concurrent producers for the same conflict identity
serialize durably; no intent in an unresolved conflict is eligible for
TASK-091.

The automation kill switch overrides intent promotion. Evidence is retained;
new intents are blocked and cannot be consumed by TASK-091. TASK-091 must
recheck kill switch, READY state, policy, approval and conflict eligibility
immediately before execution.

TASK-090 stops at durable intent creation and the states READY/BLOCKED/
CONFLICTED (or equivalent pending-approval state). TASK-091 owns consuming
eligible intents and all action execution, self-healing, retry, verification,
timeout, compensation/rollback, execution result and execution-failure
escalation. TASK-090 must not call remediation, business mutation, agent,
script or webhook adapters.

## TASK-090-R1 Automation Action Policy and Principal Authorization Contract

This section is normative for action eligibility and closes the TASK-090
security contract gap. Automation is deny-by-default. A matched Rule, its
author, publisher or activation approver grants no authority to perform the
proposed action. The only path to a production `READY` intent is:

```text
active Rule/version
→ supported Action Capability
→ applicable active tenant Action Policy
→ target/parameter policy constraints
→ tenant-bound SYSTEM_AUTOMATION principal resolution
→ canonical permission and resource-scope authorization
→ kill-switch check
→ conflict check
→ required approval check
→ READY
```

Missing or ambiguous evidence at any step fails closed. Policy-store,
authorization-store or principal-resolver failure, unsupported action, invalid
scope, unresolved target or ambiguous tenant must never produce READY. Preserve
bounded evaluation evidence and create actionable human fallback when an
operator must resolve the failure. TASK-090 performs no action execution.

### Action Capability Catalog

The Automation domain maintains or consumes a canonical, versioned,
allow-listed Action Capability Catalog. Each entry defines `action_type`,
`target_type`, required execution permission/capability, safety class,
automatic-execution support, approval eligibility/requirements, conflict or
exclusivity group, typed parameter schema and supported executor type. An
arbitrary action string is never executable. Catalog absence, unsupported
executor, invalid parameters or missing conflict semantics yields `DENY` and
a non-executable intent; create human fallback where appropriate.

Safety classes are `SAFE_AUTOMATION`, `CONTROLLED`, `HIGH_RISK` and
`PROHIBITED` (legacy names may map only when their semantics are identical).
`PROHIBITED` always denies automation. `HIGH_RISK` cannot become automatically
executable absent explicit applicable tenant policy and all required approval
and security controls. Rule priority is never a safety or authorization input.

### Tenant Action Policy

Each tenant must have an explicit tenant-scoped Action Policy to authorize an
action category. A policy identifies tenant, action type, target type, mode
(`DENY`, `ALLOW`, `REQUIRE_APPROVAL`), resource scope/selector, parameter
constraints, approval requirement, active/effective interval, immutable
version, creator/changer, reason and audit reference. No applicable policy,
inactive/expired policy, invalid policy or unsupported target/parameters means
`DENY`; there is no wildcard or implicit `ALLOW` bootstrap policy.
Applicable policy selection must be deterministic and unambiguous for the
tenant, action, target and effective time. Overlapping equally applicable
policies are a configuration-integrity failure and fail closed; do not select
the more permissive result.

Capability support, Action Policy and authorization grants are distinct:
policy answers whether the tenant permits this automation category;
authorization answers whether this principal may perform it on this target.
Both must pass. `REQUIRE_APPROVAL` remains non-executable until a valid
approval is satisfied; approval never bypasses policy denial, authorization,
tenant/resource scope, conflict or kill switch.

Active/published policy versions are immutable. A change creates a new
version. Historical evaluation and Action Intent evidence retains the exact
policy id/version and decision; later policy changes never rewrite history.
More permissive policy changes do not silently promote old blocked intents.
Any retry/re-evaluation must be an explicit authorized operation, idempotent
and auditable; no background resurrection is allowed.

### System Automation Principal and Authorization

Production evaluation resolves an explicit internal principal of type
`SYSTEM_AUTOMATION` (or equivalent canonical service identity), bound to the
tenant, action, target/resource scope and correlation context. It is neither a
human user, a tenantless superuser, an administrator impersonation nor the
Rule author's identity. Tenant is obtained from canonical event/target
context and checked against the canonical target; tenant values inside Rule
parameters are untrusted. Cross-tenant automation is denied.

The principal resolver supplies canonical `ActorContext`; it does not invent
privileges. Existing `AuthorizationPort` and canonical authorization/grant
data decide required permission and resource scope. Principal grants are
explicitly tenant-scoped and identify service principal, permission/capability,
target/resource scope, active/validity interval and audit metadata. No
implicit `*`, administrator, superuser, all-tenant or all-resource grant is
permitted. A permission without matching target scope is insufficient.

Rule-authoring permissions and policy-administration permissions are separate
from action execution grants. Rule create/edit/publication/activation never
confers execution rights. Policy management requires the distinct
`automation.policy.read`, `automation.policy.create`,
`automation.policy.update` and `automation.policy.activate` permissions, with
tenant scope, separation of duties and audit. It does not grant permission to
author Rules or execute actions by itself.

### Decision evidence and READY invariant

Every decision records the exact Action Capability/catalog version where
versioned, tenant Action Policy id/version, principal identity, permission and
resource scope evaluated, policy decision, authorization decision, approval
reference/context, kill-switch result, conflict result and canonical reason
codes. This evidence is immutable and sufficient to explain why an intent was
allowed or blocked without copying sensitive source-event data.

An Action Intent may become `READY` only if its source Rule/version was active
at evaluation; the action is supported; active applicable policy permits it;
target and parameters satisfy policy; `SYSTEM_AUTOMATION` is authorized for
the exact tenant and resource scope; any required approval is valid and bound
to intent, action, target, normalized parameters/context hash, tenant and
policy/Rule context; no unresolved conflict, cancellation, duplication or
supersession applies; and the current kill switch permits it. Failure or
missing evidence leaves the intent non-executable.

Each `READY` value is an eligibility decision, not a permanent authorization
token. TASK-091 must immediately before execution recheck the current kill
switch, tenant Action Policy, principal permission and resource scope,
approval/context validity, conflict/cancellation and target eligibility.
Revoked policy/grant or any changed context blocks execution and records the
reason. TASK-091 owns that execution-time recheck and all execution outcomes.

### Policy and grant failure handling

Unsupported actions, invalid policy, missing/ambiguous tenant or target,
missing scope data, principal resolution failure and policy/authorization
backend failure are fail-closed outcomes. Retain explainable evaluation
evidence and create one idempotent actionable fallback when human action is
needed. A safe initial positive integration test may use an already-supported
`RESTART_AGENT` capability only with explicit test-tenant `ALLOW` policy and a
specific `agent.restart` grant/scope. Tests must also prove absent policy,
grant, tenant match or resource scope cannot reach READY. Production defaults
remain deny-by-default.

The normative remediation and its acceptance criteria are tracked in
[`TASK-090-R1`](../tasks/TASK-090-R1_AUTOMATION_ACTION_POLICY_SYSTEM_PRINCIPAL_AUTHORIZATION_CONTRACT.md).

Event evaluation is idempotent by tenant + source event identity + rule id +
immutable rule version. Historical replay is out of scope; any future replay
must be explicit and idempotent. Work Items are created only for unresolved conflicts, missing
required approval/policy, unsupported action/target or evaluation integrity
failures requiring human action. Normal successful matching creates no Work
Item. Events emitted by TASK-090 describe rule decisions/intents only; actual
execution-result events belong to TASK-091.

---

# 105. Guardrails

System must not:

1. Auto-approve by timeout unless policy explicitly allows.
2. Let requester bypass required approval.
3. Lose original approval context after request changes.
4. Pause SLA for operator inactivity.
5. Recalculate running SLA silently after policy changes.
6. Run high-risk automation without policy gate.
7. Retry forever.
8. Treat action execution success as business success without verification.
9. Create duplicate side effects on retry.
10. Let rules recurse infinitely.
11. Run automation without owner/version/audit.
12. Allow automation principal to exceed granted permissions.
13. Apply stale context as current without freshness checks.
14. Activate high-risk rule without required review.
15. Hide why a rule matched.
16. Continue unsafe automation after kill switch.
17. Allow conflicting rules to overwrite each other silently.

---

# 106. Definition of Done

Control plane đạt yêu cầu khi:

- Approval routing dynamic theo context.
- Sequential/parallel/quorum approval hoạt động.
- Delegation + escalation + timeout có policy.
- Segregation of duties hỗ trợ.
- Approval context snapshot và re-approval khi material change hoạt động.
- SLA có business calendar/timezone/holiday.
- Start/stop/pause/resume rõ ràng.
- Warning/critical/breach escalation hoạt động.
- Running SLA giữ policy version.
- Automation hỗ trợ event/schedule/state/threshold/manual triggers.
- Conditions hỗ trợ compound logic.
- Actions có safety class, permission gate, retry, rollback, verification.
- Human fallback tạo Work Item đầy đủ context.
- Rule versioning, simulation, dry-run và kill switch hoạt động.
- Conflict/cycle/cooldown/debounce/flapping protection hoạt động.
- Approval/SLA/Automation tích hợp được với nhau.
- Tất cả action có explainability, idempotency và audit trail.
