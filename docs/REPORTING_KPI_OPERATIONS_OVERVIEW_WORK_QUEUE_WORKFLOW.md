# REPORTING + KPI + OPERATIONS OVERVIEW + WORK QUEUE WORKFLOW SPEC
## Execution-Level Operational Experience Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:**  
- `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md`
- `ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `MAINTENANCE_WARRANTY_REPLACEMENT_DISPOSAL_WORKFLOW.md`
- `AUDIT_NETWORK_DISCOVERY_VLAN_TOPOLOGY_WORKFLOW.md`
- `SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md`
- `PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md`
- `CHANNEL_BRANDING_NOTIFICATION_COMMUNICATION_WORKFLOW.md`
- `APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`

**Scope:** Operations Overview, Work Queue, Attention Center, KPI, Reporting, Trend Analysis, Daily Operations, Role-based Dashboard, Drill-down, Actionability, Handover, Scheduled Reports, Data Freshness, Metric Governance, Auditability

---

# 1. Mục tiêu

Tài liệu này định nghĩa cách người vận hành nhìn và điều khiển toàn bộ hệ thống trong một ngày làm việc.

Nguyên tắc cốt lõi:

```text
Không mở app để xem dashboard.
Mở app để biết:
1. Điều gì đang xảy ra?
2. Điều gì cần xử lý?
3. Việc nào quan trọng nhất?
4. Tại sao?
5. Ai đang chịu trách nhiệm?
6. SLA/timer còn bao lâu?
7. Tôi có thể làm gì ngay?
```

Hệ thống phải tổ chức trải nghiệm theo:

```text
OPERATIONS OVERVIEW
        ↓
ATTENTION CENTER
        ↓
WORK QUEUE
        ↓
CONTEXT
        ↓
ACTION
        ↓
RESULT / FEEDBACK
```

Không biến mọi màn hình thành BI dashboard.

---

# 2. Core Entities

```text
OPERATIONS OVERVIEW
WORK ITEM
WORK QUEUE
ATTENTION ITEM
KPI
METRIC
METRIC SNAPSHOT
REPORT
REPORT SCHEDULE
DASHBOARD VIEW
FILTER PRESET
HANDOVER
SHIFT
ESCALATION
SLA INSTANCE
INCIDENT
TICKET
ASSET
SERVICE
AGENT
AUDIT EXCEPTION
NETWORK EXCEPTION
LICENSE EXCEPTION
MAINTENANCE ORDER
APPROVAL
CONTRACT
PROCUREMENT REQUEST
NOTIFICATION
AUDIT TRAIL
```

---

# 3. Role-based Operations View

Dashboard không giống nhau cho mọi người.

## Helpdesk L1

Ưu tiên:

```text
New Tickets
Unassigned Tickets
SLA Risk
Waiting User
Known Incident-linked Tickets
Approved Self-Service Actions
```

## IT Operations

```text
Critical Incidents
Monitoring Alerts
Agent Offline
Asset Health
Maintenance
Network Exceptions
Failed Automation
```

## Asset Admin

```text
Assets Needing Attention
Warehouse Exceptions
Assignments
Returns
Audit Exceptions
Warranty
Replacement Candidates
```

## Network Team

```text
Network Incidents
Unknown Devices
VLAN Mismatch
Topology Health
Discovery Failure
Change Queue
```

## Software/License Admin

```text
Unauthorized Software
Failed Deployments
License Overuse
License Expiry
Artifact Scan Failure
```

## IT Manager

```text
Major Incidents
SLA Compliance
Critical Risk
Backlog
Replacement/Budget
Contract/Warranty Exposure
Automation Effectiveness
```

---

# 4. Operations Overview Structure

Recommended hierarchy:

```text
1. Critical / Needs Attention
2. My Work Queue
3. Operational Health
4. Time-sensitive Deadlines
5. Recent Changes
6. Trends / KPI
```

Không đặt chart trước actionable information.

---

# 5. Daily Attention Center

Attention Center trả lời:

```text
"Hôm nay cần xử lý gì?"
```

Ví dụ:

```text
3 P1 Incidents
12 Tickets at SLA Risk
8 Agents offline > threshold
5 Assets Health Critical
6 Assets waiting return
9 Warranty expiring <30d
4 Licenses overused
3 Unauthorized software findings
2 VLAN mismatches
7 Audit exceptions
5 Maintenance overdue
2 Contracts near cancellation deadline
4 Approvals overdue
3 Failed automations
```

---

# 6. Attention Item Model

```yaml
attention_item:
  id:
  type:
  severity:
  title:
  reason:
  primary_entity:
  related_entities:
  owner:
  due_at:
  sla:
  source:
  recommended_action:
  created_at:
  age:
  status:
```

---

# 7. Severity Model

```text
CRITICAL
HIGH
MEDIUM
LOW
INFORMATIONAL
```

Severity không chỉ dựa trên màu từ source.

Tính từ:

```text
business impact
urgency
risk
SLA
service criticality
number affected
security/compliance impact
```

---

# 8. Attention Prioritization

Possible score:

```text
Priority Score =
Business Impact
+ Urgency
+ SLA Risk
+ Security Risk
+ Age
+ Service Criticality
```

Score phải explainable.

Ví dụ:

```text
Score 92
Why:
+ Critical service
+ 240 users affected
+ SLA 92% consumed
+ no workaround
```

---

# 9. Work Queue Principle

Work Queue chỉ chứa:

```text
actionable work
```

Không chứa:

```text
raw monitoring events
every discovery result
every successful automation
every informational notification
```

---

# 10. Work Item Types

```text
TICKET
INCIDENT
AGENT_EXCEPTION
ASSET_ACTION
MAINTENANCE
AUDIT_EXCEPTION
NETWORK_EXCEPTION
SOFTWARE_EXCEPTION
LICENSE_EXCEPTION
APPROVAL
PROCUREMENT_EXCEPTION
CONTRACT_ACTION
AUTOMATION_FAILURE
AUTOMATION_CONFLICT
AUTOMATION_REVIEW
SECURITY_REVIEW
```

---

# 11. Work Item Required Context

Mỗi item hiển thị tối thiểu:

```text
What
Why
Who/What affected
Priority
Owner/Team
Age
Due/SLA
Current state
Recommended action
```

---

# 12. Work Item Example

```text
P1
INC-2042
Hanoi WAN outage

Affected:
247 users
6 services
42 assets

SLA:
34 min remaining

Owner:
Network Team

Recommended:
Open Major Incident Workspace
```

---

# 13. Work Queue Views

Default views:

```text
My Work
Unassigned
Critical
SLA Risk
Waiting
Overdue
Team Queue
Recently Updated
```

---

# 14. Filter Dimensions

```text
Priority
Type
Team
Assignee
Service
Site
Department
Asset
SLA
Age
Status
Risk
Source
```

---

# 15. Saved Views

Users can save:

```text
"Critical Hanoi"
"Asset Returns This Week"
"Network Exceptions"
"P1/P2 Unresolved"
```

Saved view = filters + sort + columns.

---

# 16. Work Queue Sorting

Default should prioritize:

```text
Severity
SLA Risk
Business Impact
Age
```

not simply newest first.

---

# 17. Queue Assignment

Modes:

```text
Manual assignment
Auto assignment
Round-robin
Skill-based
Service-based
Site-based
Load-based
```

---

# 18. Auto-assignment Guardrails

Do not assign if:

```text
user unavailable
skill mismatch
team overloaded beyond policy
conflict of interest
restricted scope
```

---

# 19. Queue Ownership

Every actionable item needs:

```text
owner team
```

Assignee can be empty.

No ownerless work item.

---

# 20. Queue Aging

Track:

```text
created_at
last_action_at
time_in_current_state
```

Stale work:

```text
no activity > threshold
```

creates attention.

---

# 21. Work Item Lifecycle

```text
NEW
↓
ASSIGNED
↓
IN_PROGRESS
├─ WAITING_USER
├─ WAITING_VENDOR
├─ WAITING_APPROVAL
├─ WAITING_CHANGE
└─ ON_HOLD
↓
RESOLVED
↓
CLOSED
```

Specific workflows may extend this.

---

# 22. Inline Actions

Simple actions should be possible from queue:

```text
Assign
Acknowledge
Approve
Reject
Retry Automation
Link Incident
Open Asset
Mark Waiting
```

Complex actions open workspace.

---

# 23. Deep Investigation Rule

Open entity workspace when:

```text
cross-domain context needed
history needed
diagnosis required
multiple related records
high-risk action
```

---

# 24. Bulk Actions

Possible:

```text
Assign Team
Change Priority
Acknowledge
Export
Schedule
Create Incident
Create Maintenance
```

Only for safe, compatible items.

---

# 25. Bulk Action Guardrail

System must validate each selected item.

If mixed compatibility:

```text
show eligible count
show skipped count
show reasons
```

---

# 26. Operations Health Summary

High-level:

```text
Services
Assets
Network
Agents
Helpdesk
Automation
Compliance
Contracts
```

Each tile should show:

```text
current health
delta
critical count
drill-down
```

---

# 27. Service Health KPI

Examples:

```text
Operational Services %
Degraded Services
Unavailable Services
Service Incidents
```

---

# 28. Asset Health KPI

Examples:

```text
Healthy %
Warning %
Critical %
Unknown %
```

Do not use health score without explainability.

---

# 29. Agent KPI

```text
Agent Coverage
Online Rate
Stale Inventory
Version Compliance
Recovery Success
```

---

# 30. Helpdesk KPI

```text
Open Tickets
Unassigned
SLA at Risk
First Response Time
Resolution Time
Reopen Rate
First Contact Resolution
```

---

# 31. Incident KPI

```text
P1/P2 Open
MTTD
MTTA
MTTR
Major Incident Count
Repeat Incident Rate
```

---

# 32. Asset Operations KPI

```text
Available Stock
Reserved
In Use
Repair
Pending Return
Missing
Audit Exceptions
```

---

# 33. Maintenance KPI

```text
Open Maintenance
Overdue
Waiting Part
Waiting Vendor
Repeat Repair
Preventive Maintenance Compliance
```

---

# 34. Audit KPI

```text
Inventory Accuracy
Verified Rate
Missing Asset Rate
Wrong Location Rate
Exception Resolution Time
```

---

# 35. Network KPI

```text
Discovery Coverage
Unknown Devices
VLAN Compliance
Topology Freshness
IP Conflicts
Critical Network Incidents
```

---

# 36. Software KPI

```text
Approved Software Coverage
Unauthorized Software
Install Success
Outdated Versions
Vulnerable Installations
```

---

# 37. License KPI

```text
Entitled
Assigned
Active
Overused
Underused
Expiring
Reclaimable
```

---

# 38. Procurement KPI

```text
Open Requests
Approval Backlog
PO Delivery Overdue
Invoice Match Rate
Procurement Lead Time
```

---

# 39. Contract KPI

```text
Expiring Contracts
Cancellation Deadlines
Renewal In Progress
Supplier SLA Breaches
```

Contract alert Work Items are created only from explicit version-bound
`renewal_notice_date` or `renewal_notice_period_days` triggers. No global
warning threshold is allowed. Stable alert identity prevents duplicate Work
Items across scheduler runs; version changes recalculate future scheduling
without rewriting alert history. Auto-renew metadata never creates an executed
renewal. Invalid/impossible configuration creates actionable
configuration/data-integrity work without a guessed date.

Cost-provenance Work Items are exceptional and actionable: missing or
ambiguous canonical source, unresolved allocation, amount reconciliation
failure or data-integrity conflict. Successful cost linkage is not queue work.
Work Queue references the canonical Contract alert or CostProvenance record;
it never becomes that record's source of truth.

---

# 40. Automation KPI

```text
Automation Success Rate
Failed Automation
Human Fallback Rate
Tickets Avoided
Time Saved
Rollback Rate
```

---

# 41. KPI Governance

Every KPI must define:

```text
name
business meaning
formula
source
owner
refresh rate
dimensions
exclusions
target
```

---

# 42. KPI Definition Object

```yaml
metric_definition:
  id:
  name:
  description:
  formula:
  source_entities:
  owner:
  refresh_interval:
  dimensions:
  target:
  warning_threshold:
  critical_threshold:
```

---

# 43. Metric Source-of-Truth

Do not compute same KPI differently in multiple dashboards.

Example:

```text
SLA Compliance
```

must have one canonical definition.

---

# 44. Metric Freshness

Show:

```text
Updated 2 min ago
Updated 4 hours ago
STALE
```

Critical operational metrics should not silently display stale data.

---

# 45. Real-time vs Analytical

Separate:

```text
Operational Real-time
```

from:

```text
Historical Analytics
```

Operational:

```text
Current P1
Current SLA Risk
Agents Offline
```

Historical:

```text
MTTR trend
Monthly SLA compliance
Repair cost trend
```

---

# 46. Trend Reporting

Common periods:

```text
24h
7d
30d
90d
Quarter
Year
```

---

# 47. Comparison

Support:

```text
vs previous period
vs target
vs same period last year
```

---

# 48. Drill-down Principle

Every KPI should answer:

```text
"Which records caused this number?"
```

Example:

```text
12 SLA breaches
→ click
→ show 12 records
```

---

# 49. No Dead-end Dashboard

Do not show:

```text
"14 Critical Assets"
```

without:

```text
[View 14 assets]
```

and possible actions.

---

# 50. Operations Overview — Morning Flow

Example 08:00:

```text
Login
↓
Overview
↓
Critical:
2 P1
5 Critical Assets
8 SLA Risk
3 Failed Automation
↓
Open Work Queue
↓
Acknowledge / Assign / Investigate
```

---

# 51. 08:15 Critical Review

Recommended focus:

```text
Major Incidents
Critical Service Health
Network Outage
Security/Compliance Critical
```

---

# 52. 09:00 Helpdesk Review

```text
Unassigned Tickets
SLA Risk
Waiting User > threshold
Known Incident-linked Tickets
```

---

# 53. 10:00 Asset Operations Review

```text
Asset Return
Warehouse Exception
Maintenance
Audit
Warranty
```

---

# 54. 13:30 Compliance Review

```text
Unauthorized Software
License Overuse
Unknown Devices
Audit Exceptions
Role Drift
```

---

# 55. 15:00 Platform Health Review

```text
Agent Coverage
Discovery Health
Channel Health
Automation Failures
Integration Failures
```

---

# 56. 16:00 Planning Review

```text
Replacement
Warranty
Contract
Procurement
Budget
Renewal
```

---

# 57. 17:00 End-of-Day Review

```text
Open P1/P2
SLA Risk
Pending Approval
Waiting Vendor
Failed Automation
Pending Return
Overdue Maintenance
Audit Exceptions
```

---

# 58. Shift Handover

Handover object:

```yaml
handover:
  shift:
  outgoing_team:
  incoming_team:
  critical_items:
  unresolved_items:
  waiting_external:
  risks:
  notes:
  created_at:
```

---

# 59. Handover Auto-generation

System can prepare:

```text
Open P1/P2
Recently escalated
Waiting vendor
Waiting user
Failed automations
Changes in progress
Major incidents
```

Operator reviews and confirms.

---

# 60. Handover Guardrail

Do not rely only on free-text notes.

Critical items must be linked to actual entities.

---

# 61. Personal Dashboard

User can personalize:

```text
saved views
widgets
filters
default site/team
```

But system-required critical section remains visible.

---

# 62. Team Dashboard

Shared team view:

```text
Team Backlog
SLA Risk
Workload
Escalations
Critical Items
```

---

# 63. Manager Dashboard

Focus:

```text
Risk
Trend
Backlog
SLA
Major Incidents
Cost Exposure
Replacement
Compliance
```

Not raw technical event volume.

---

# 64. Executive Summary

High-level only:

```text
Service Availability
Major Incidents
SLA Compliance
Asset Risk
Security/Compliance Exposure
Cost/Renewal Exposure
```

---

# 65. Scheduled Reports

Examples:

```text
Daily Operations Summary
Weekly Helpdesk Report
Weekly Asset Health
Monthly License Compliance
Monthly Audit Compliance
Quarterly Asset Renewal
Monthly Supplier Performance
```

---

# 66. Report Schedule

```yaml
report_schedule:
  report:
  audience:
  frequency:
  timezone:
  format:
  delivery_channel:
  filters:
```

---

# 67. Report Formats

```text
Portal
Email
PDF
CSV
XLSX
API
```

---

# 68. Report Audience

Can be:

```text
User
Role
Team
Department
Service Owner
Manager
External Auditor
```

---

# 69. Report Permission

Report output must respect:

```text
resource scope
document confidentiality
row-level permission
```

Scheduled report must not bypass RBAC.

---

# 70. Snapshot vs Live Report

Two types:

```text
LIVE
```

queries current data.

```text
SNAPSHOT
```

preserves historical state.

Audit/compliance reports may require snapshot.

---

# 71. Report Versioning

Important reports may store:

```text
definition version
generated_at
filters
data timestamp
```

---

# 72. Data Export

Export must log:

```text
who
what
scope
format
timestamp
```

for sensitive data.

---

# 73. Export Guardrails

Large/sensitive export may require:

```text
permission
approval
watermark
expiry
```

---

# 74. Metric Dimensioning

Common dimensions:

```text
Time
Site
Department
Service
Team
Asset Type
Vendor
Priority
Risk
```

---

# 75. Cohort Analysis

Useful examples:

```text
Laptop model failure rate
Vendor repair performance
Software version incident rate
Department ticket rate
Asset age vs repair cost
```

---

# 76. Asset Intelligence Reporting

Examples:

```text
Replacement Candidates
Risk by Age
Repair Cost vs Replacement Cost
Warranty Exposure
TCO by Asset Class
```

---

# 77. Root Cause Reporting

From Problem Management:

```text
Top recurring incident signatures
Top root causes
Top services causing incidents
Workaround effectiveness
Problem recurrence after fix
```

---

# 78. Change Reporting

```text
Change Success Rate
Failed Changes
Emergency Changes
Change-induced Incidents
Rollback Rate
```

---

# 79. Knowledge Reporting

```text
Article Use
Deflection Rate
Resolution Rate
Stale Articles
Top Missing Knowledge
```

---

# 80. Notification/Channel Reporting

```text
Delivery Success
Channel Failures
Acknowledgement Time
Message Volume
Cross-channel continuity
```

---

# 81. Data Quality KPI

Track:

```text
Assets without owner
Assets without location
Stale agents
Unknown serials
Duplicate candidates
Missing warranty dates
Unlinked invoices
Unknown software
```

---

# 82. Data Quality Work Queue

Critical data quality issues should create actionable tasks.

Examples:

```text
20 assets missing serial
8 users without manager
12 devices unmatched to asset
5 contracts without owner
```

---

# 83. Report Alerting

Metric threshold can emit event.

Example:

```text
SLA Compliance < 90%
→ Management Attention
```

But do not create alert loops.

---

# 84. KPI Thresholds

Could be:

```text
Target
Warning
Critical
```

Example:

```text
Agent Coverage:
Target 98%
Warning <96%
Critical <90%
```

---

# 85. Threshold Governance

Threshold changes must be versioned.

---

# 86. Forecasting

Optional:

```text
Warranty expiry forecast
License renewal forecast
Replacement demand
Ticket volume forecast
Stock demand
```

Forecast must be clearly labeled as prediction.

---

# 87. Forecast Explainability

Example:

```text
Expected 34 laptop replacements next quarter

Based on:
- 22 age threshold
- 8 health degradation
- 4 warranty + repair cost
```

---

# 88. Workload View

Team workload:

```text
Assigned
In Progress
SLA Risk
Waiting
Capacity
```

Avoid ranking employees purely by ticket count.

---

# 89. Queue Load Balancing

Can suggest reassignment based on:

```text
skills
current load
priority
site
availability
```

Human override allowed.

---

# 90. Operational Noise Reduction

System should aggregate:

```text
duplicate alerts
child incidents
repeated notifications
related audit exceptions
```

into meaningful groups.

---

# 91. Attention Grouping

Example:

```text
"12 endpoints offline due to SW-HN-01"
```

rather than 12 individual cards.

---

# 92. Aging Buckets

Useful:

```text
<1h
1-4h
4-24h
1-3d
3-7d
>7d
```

for backlog views.

---

# 93. Waiting-State Visibility

Need distinguish:

```text
Waiting User
Waiting Vendor
Waiting Approval
Waiting Change
Waiting Part
```

to understand bottlenecks.

---

# 94. Bottleneck Reporting

Examples:

```text
42% of maintenance backlog waiting parts
31 approvals overdue
18 tickets waiting user >3d
```

---

# 95. Automation Savings

Track:

```text
manual steps avoided
tickets avoided
estimated time saved
auto-resolved count
```

Must label estimation method.

---

# 96. Cost Reporting

Possible:

```text
Repair Cost
License Cost
Procurement Cost
Replacement Forecast
Contract Exposure
Asset TCO
```

If ERP is source-of-truth:

```text
report synced references
```

not duplicate accounting.

---

# 97. Data Freshness Dashboard

Show integrations:

```text
Agent Sync
Directory Sync
Network Discovery
Email Channel
Teams/Slack
ERP Sync
SaaS License Sync
```

with:

```text
Last Success
Lag
Status
```

---

# 98. Integration Health

States:

```text
HEALTHY
DEGRADED
FAILED
STALE
```

---

# 99. Failed Integration Attention

Only actionable failures:

```text
Directory sync failed 3 times
Teams token expired
Discovery stale 6h
License SaaS sync failed
```

---

# 100. Work Item Creation Rules

A metric anomaly should create work item only if:

```text
actionable
owned
non-duplicate
above threshold
```

---

# 101. Work Item Deduplication

Key may use:

```text
type
entity
condition
time_window
```

Example:

```text
AGENT_EXCEPTION:AST-0042:OFFLINE
```

Only one active item.

---

# 102. Work Item Merge

Related work can merge under parent:

```text
Root Incident
Problem
Campaign
Audit
```

---

# 103. Work Item Closing

Close only when:

```text
business condition resolved
or accepted exception
```

not merely because metric disappeared once.

---

# 104. Work Item Reopen

If condition returns:

```text
reopen
```

or create linked recurrence based on policy.

---

# 105. Work Queue Audit Trail

Track:

```text
created
assigned
reassigned
acknowledged
state changed
priority changed
closed
reopened
```

---

# 106. Report Audit Trail

Track:

```text
generated
viewed
exported
shared
scheduled
```

for sensitive reports.

---

# 107. Permissions

## End User

```text
view own tickets/assets/status
```

## Helpdesk

```text
view Helpdesk queue
team KPI
```

## IT Ops

```text
view operational health
monitoring/network/agent queues
```

## Asset Admin

```text
asset/warehouse/audit/maintenance reporting
```

## Manager

```text
cross-team KPI
risk
SLA
cost exposure
```

## Auditor

```text
audit/compliance snapshots
read-only
```

## Reporting Admin

```text
metric/report definitions
```

---

# 108. Data Access Guardrails

Dashboard counts must respect RBAC.

Example:

```text
User can only see Hanoi
```

then KPI should not leak total company counts if policy disallows.

---

# 109. Generated Events

```text
WORK_ITEM.CREATED
WORK_ITEM.ASSIGNED
WORK_ITEM.ESCALATED
WORK_ITEM.OVERDUE
WORK_ITEM.RESOLVED
WORK_ITEM.REOPENED

KPI.WARNING
KPI.CRITICAL
KPI.RECOVERED

REPORT.GENERATED
REPORT.DELIVERED
REPORT.FAILED

HANDOVER.CREATED
HANDOVER.CONFIRMED
```

---

# 110. Notifications

## Operator

```text
critical work item
SLA risk
handover
failed report
```

## Manager

```text
major trend deterioration
SLA breach
critical backlog
```

Do not notify for every KPI refresh.

---

# 111. End-to-End Example — Operator Morning

```text
08:00 Login
↓
Overview shows:
2 P1
8 SLA Risk
5 Critical Assets
3 Failed Automation
2 Unknown Devices
↓
Operator opens Critical Queue
↓
INC-3002 first
↓
Root Incident workspace
↓
Assigns Network Team
↓
Acknowledges SLA risk ticket
↓
Retries safe failed automation
↓
Opens Asset Critical group
↓
Creates Maintenance for 2 devices
```

---

# 112. End-to-End Example — Manager Review

```text
Manager opens Weekly Operations
↓
SLA = 94.2%
Target = 95%
↓
Drill-down
↓
Most breaches:
Network tickets
↓
Bottleneck:
Waiting Network Team
↓
View team workload
↓
Find capacity imbalance
↓
Create action plan
```

---

# 113. End-to-End Example — Asset Risk

```text
Overview:
18 replacement candidates
↓
Drill-down
↓
Top 5:
high repair cost + expired warranty
↓
Create Replacement Plan
↓
Procurement workflow starts
```

---

# 114. End-to-End Example — Data Quality

```text
Data Quality KPI:
12 devices unmatched to assets
↓
Open Work Queue
↓
6 auto-match high confidence
↓
4 manual review
↓
2 unknown devices → Security Review
```

---

# 115. Guardrails

System must not:

1. Put charts above critical actionable work by default.
2. Mix raw alerts with actionable work items.
3. Show KPI without drill-down path where applicable.
4. Calculate same KPI differently across dashboards.
5. Hide metric freshness.
6. Show stale operational data as realtime.
7. Create duplicate work items from recurring same condition.
8. Close work item only because source signal temporarily disappeared.
9. Expose counts/data outside user scope.
10. Rank operator performance only by ticket volume.
11. Create notification storms from KPI refresh.
12. Allow scheduled reports to bypass RBAC.
13. Export sensitive data without audit.
14. Treat forecasts as observed facts.
15. Let Work Queue have ownerless actionable items.
16. Lose handover links to actual records.
17. Create dead-end dashboards with no path to context/action.

---

# 116. Definition of Done

Cụm workflow này đạt yêu cầu khi:

- Operations Overview ưu tiên Attention trước KPI.
- Role-based dashboard hoạt động.
- Work Queue chỉ chứa actionable work.
- Work Item có owner, priority, SLA, reason và recommended action.
- Queue supports filters, saved views, assignment and aging.
- Simple actions inline, complex actions open workspace.
- KPI có canonical definition, owner, formula và freshness.
- KPI drill-down tới record gây ra metric.
- Real-time operational data tách historical analytics.
- Daily/weekly/monthly reports có scheduling và RBAC.
- Shift handover tự tổng hợp critical open work.
- Data quality có KPI + actionable queue.
- Integration freshness được theo dõi.
- Bottleneck/waiting-state reporting hoạt động.
- Work item dedupe/merge/reopen có rule.
- Exports và reports có audit trail.
- Guardrails chống dashboard overload, stale data và dead-end reporting được áp dụng.

---

# 117. TASK-090 Automation Conflict and Review Work

Create one actionable Work Item for an unresolved mutually incompatible
Action Intent conflict, missing approval policy/request that has no canonical
Approval Work Item, unsupported action or target, or evaluation integrity
failure that needs human action. The item
references the canonical conflict/evaluation/intent records, every affected
rule/version and source event, a safe reason code and correlation reference.
Use durable identity based on tenant + conflict/evaluation identity so event
redelivery and competing evaluations do not create duplicate work. Use
`AUTOMATION_CONFLICT` for incompatible intents and `AUTOMATION_REVIEW` for
other evaluation/policy exceptions. An existing pending Approval Work Item
remains the human approval task; do not create a duplicate automation review
item for the same approval wait.

Do not create Work Items for every event, condition miss, deduplicated
successful intent or ordinary READY intent. Work Queue is an actionable
projection, not the source of truth for rule/evaluation/intent state. Resolving
the item does not itself promote or execute an intent; an authorized explicit
resolution must update the canonical Automation-owned intent state, and
TASK-091 still rechecks execution eligibility.

## TASK-093 Knowledge Deflection Measures and Work Queue

Report recommendation sessions, presented items, selections, helpful and
not-helpful feedback, confirmed self-service resolutions, known-incident
deflections, escalations, Tickets avoided and Tickets created after
recommendation separately. Click rate is not deflection rate; canonical
deflection requires explicit resolution confirmation (or objective
verification defined by another normative workflow). Keep
`KNOWLEDGE_RESOLUTION` distinct from `KNOWN_INCIDENT_DEFLECTION`.

Ordinary no-recommendation, not-helpful and escalation flows do not create a
separate Work Item when Ticket intake handles the work. Use Work Queue for
actionable data-integrity, authorization/audience inconsistency, infrastructure
failure requiring an operator, or unsafe/incorrect Knowledge review supported
by existing governance. Deduplicate exceptions; Work Queue is not
recommendation state.

## TASK-094 Asset Scoring Projections and Work Queue

Operations/Reporting may expose the latest Operational Risk and Replacement
Priority score, band, completeness, freshness and principal evidence reasons.
Incomplete low scores and UNKNOWN bands must not rank an Asset as healthier
than a complete assessment. A stale assessment is not current decision
evidence; show its freshness explicitly and treat current Risk as UNKNOWN.

Only a current CRITICAL Operational Risk assessment creates/upserts one
`ASSET_RISK_REVIEW` Work Queue item per unresolved review. HIGH is reportable
without an automatic Work Item. Replacement MONITOR/REVIEW is reporting only;
UNKNOWN creates no candidate. PLAN/PRIORITY may feed the TASK-059 human
replacement review path, never Procurement directly. Recalculations and
repeated source events must not flood the queue. Work Queue remains a
projection and cannot change computed assessment or human disposition.
