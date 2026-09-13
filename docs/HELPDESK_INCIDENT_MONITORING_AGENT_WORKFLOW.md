# HELPDESK + INCIDENT + MONITORING + AGENT WORKFLOW SPEC
## Execution-Level Workflow Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Scope:** Helpdesk, Incident Management, Monitoring, Endpoint Agent, Correlation, Auto-remediation, SLA, Notifications, Audit Trail

---

# 1. Mục tiêu

Tài liệu này chi tiết hóa các workflow:

- `WF-002` User Reports an Incident
- `WF-003` Monitoring Critical Event
- `WF-004` Agent Offline Threshold
- `WF-020` Root Incident Correlation

Mục tiêu là biến các mô tả nghiệp vụ thành workflow đủ rõ để triển khai:

```text
Trigger
→ Preconditions
→ Context Enrichment
→ Correlation
→ Decision
→ Automation
→ Human Work Queue
→ Verification
→ State Update
→ Notification
→ Audit Trail
→ Downstream Workflow
```

Nguyên tắc chính:

> Ticket không phải trung tâm duy nhất. Hệ thống phải xử lý theo context:
> USER → SERVICE → ASSET → AGENT/MONITORING → INCIDENT → RESOLUTION.

---

# 2. Shared Context Model

Mọi Ticket/Incident phải cố gắng resolve các context sau trước khi giao cho Helpdesk.

```yaml
request_context:
  user:
    id:
    name:
    department:
    manager:
    location:
    contact_channels:

  asset:
    id:
    hostname:
    serial:
    lifecycle:
    operational_state:
    health_state:
    assignment_state:
    owner:
    location:

  service:
    id:
    name:
    criticality:
    owner:
    dependencies:

  agent:
    status:
    last_seen:
    version:
    inventory_last_sync:
    pending_actions:

  network:
    ip:
    mac:
    vlan:
    subnet:
    switch:
    port:
    site:

  monitoring:
    active_events:
    recent_events:
    availability:
    metrics:

  itsm:
    open_tickets:
    open_incidents:
    recent_incidents:
    known_problems:
    active_changes:

  warranty:
    state:
    expiry_date:

  compliance:
    state:
    exceptions:
```

Không phải context nào cũng bắt buộc tồn tại.

Nếu dữ liệu không tìm thấy:

```text
KNOWN
UNKNOWN
NOT_APPLICABLE
STALE
```

phải được phân biệt rõ.

---

# 3. Common Priority Model

Priority không được nhập thủ công hoàn toàn.

```text
Priority = Impact × Urgency
```

## Impact

| Level | Điều kiện tham khảo |
|---|---|
| 1 - Low | 1 user, không ảnh hưởng service quan trọng |
| 2 - Medium | nhiều user nhỏ hoặc 1 asset quan trọng |
| 3 - High | department/site/service bị ảnh hưởng |
| 4 - Critical | business-critical service hoặc nhiều site |

## Urgency

| Level | Điều kiện |
|---|---|
| 1 | Có workaround, không gấp |
| 2 | Công việc suy giảm |
| 3 | Không thể làm việc |
| 4 | Production/business outage |

## Mapping

```text
Impact 4 + Urgency 4 → P1
High combinations         → P2
Medium                    → P3
Low                       → P4
```

Priority có thể tăng tự động khi:

```text
affected_users increases
SLA threshold approaches
critical service affected
security risk detected
executive/VIP policy applies
```

---

# 4. Work Queue Model

Helpdesk không nhận raw alerts.

Work Queue chỉ nhận **actionable work**.

Mỗi Work Item gồm:

```yaml
work_item:
  id:
  type:
  priority:
  title:
  primary_entity:
  related_entities:
  reason:
  evidence:
  recommended_action:
  assignee:
  team:
  sla:
  created_at:
  age:
  automation_attempts:
```

Các loại:

```text
USER_INCIDENT
SERVICE_REQUEST
MONITORING_INCIDENT
AGENT_EXCEPTION
AUDIT_EXCEPTION
NETWORK_EXCEPTION
SOFTWARE_EXCEPTION
LICENSE_EXCEPTION
MAINTENANCE_TASK
APPROVAL
```

---

# 5. WF-002 — User Reports an Incident

## 5.1 Trigger

Nguồn vào:

```text
Self-service Portal
Email
Teams
Slack
Mobile
API/Webhook
```

Event:

```text
TICKET.CREATED
```

---

## 5.2 Preconditions

Tối thiểu phải có:

```text
requester identity
description
source channel
timestamp
```

Nếu SSO channel:

```text
requester identity = trusted
```

Nếu email/channel ngoài:

```text
resolve identity by verified email/account mapping
```

Không resolve được user:

```text
route → Identity Review Queue
```

---

## 5.3 Initial Classification

Classifier xác định:

```text
Incident
Service Request
Question
Access Request
Software Request
Asset Request
Unknown
```

Nếu confidence thấp:

```text
do not guess silently
→ classify as Needs Triage
```

---

## 5.4 Context Enrichment

### Step 1 — User

```text
Identity
Department
Location
Manager
Assigned Assets
Entitlements
Open Tickets
```

### Step 2 — Asset

Ưu tiên:

```text
explicit asset selected by user
→ primary assigned asset
→ currently active device from agent/session
→ ask user only if ambiguity remains
```

### Step 3 — Service

Resolve theo:

```text
selected service
keywords
software/process
asset dependency
network/service topology
```

### Step 4 — Technical Context

```text
Agent status
Monitoring events
Health
IP/MAC
VLAN
Last seen
Recent changes
Known Problems
Maintenance window
```

---

# 6. WF-002 Decision Table

| Condition | Action |
|---|---|
| Known major incident exists | Link ticket to Root Incident |
| Known problem + approved workaround | Offer guided/auto resolution |
| Safe auto-remediation exists | Execute automatically |
| Same user + same asset + same symptom already open | Suggest merge/link |
| Monitoring confirms outage | Create/link Incident |
| No technical signal but user blocked | Send Helpdesk queue |
| Missing essential context | Request only missing information |
| Service Request detected | Route to request workflow |

---

# 7. Duplicate Prevention

Fingerprint:

```text
user
asset
service
symptom_category
time_window
```

Ví dụ:

```text
Nguyễn Văn A
AST-0042
Corporate VPN
VPN_CONNECTIVITY
30 minutes
```

Nếu ticket tương tự đang `OPEN/IN_PROGRESS`:

```text
do not silently create duplicate
```

Action:

```text
Attach new user message/evidence
or
create linked child request if policy requires
```

Idempotency key cho API/channel:

```text
channel_message_id
source_event_id
external_request_id
```

---

# 8. Auto-remediation Pipeline

Auto-remediation chỉ chạy khi action:

```text
approved
reversible OR low risk
permission-safe
asset reachable
not inside conflicting change
```

Flow:

```text
Candidate Fix
↓
Policy Check
↓
Pre-check
↓
Execute
↓
Post-check
↓
Verified?
├─ YES → Resolve
└─ NO  → Rollback if needed
         ↓
       Human Queue
```

Ví dụ VPN:

```text
Check VPN process
↓
Restart VPN service
↓
Refresh certificate
↓
Test VPN gateway
↓
Verify connectivity
```

Mỗi action phải lưu:

```text
command/action
initiator
target
start/end
result
stdout/error summary
verification result
```

---

# 9. Human Helpdesk Workflow

Nếu automation không giải quyết:

```text
Ticket
↓
Work Queue
↓
Assignment
↓
Technician opens Ticket Workspace
```

Workspace phải hiển thị ngay:

```text
User
Asset
Service
Agent
Monitoring
Network
Recent Incidents
Known Problems
Warranty
Suggested Actions
```

Technician không cần tự tra lại ở nhiều module.

---

# 10. Ticket State Machine

```text
NEW
↓
TRIAGE
↓
IN_PROGRESS
├── WAITING_USER
├── WAITING_VENDOR
├── WAITING_APPROVAL
├── WAITING_CHANGE
└── ON_HOLD
↓
RESOLVED
↓
CLOSED
```

Có thể:

```text
RESOLVED → REOPENED → IN_PROGRESS
```

Không cho:

```text
CLOSED → IN_PROGRESS
```

trừ quyền đặc biệt hoặc create linked follow-up.

---

# 11. Ticket SLA

SLA timers:

```text
Time to Acknowledge
Time to First Response
Time to Resolution
```

Pause SLA chỉ khi policy cho phép:

```text
WAITING_USER
WAITING_VENDOR
```

Không tự pause chỉ vì:

```text
technician has not acted
```

Events:

```text
TICKET.SLA_WARNING
TICKET.SLA_BREACHED
```

Threshold ví dụ:

```text
70% → warning
90% → urgent
100% → breached
```

Escalation:

```text
Assignee
→ Team Lead
→ Service Owner
→ Incident Manager
```

---

# 12. WF-003 — Monitoring Critical Event

## Trigger

```text
MONITORING.CRITICAL
```

Input:

```yaml
monitor_event:
  event_id:
  source:
  metric:
  value:
  threshold:
  asset_id:
  service_id:
  timestamp:
  severity:
```

---

# 13. Monitoring Pre-processing

Trước khi tạo Incident:

```text
Deduplicate
↓
Maintenance Window Check
↓
Flapping Check
↓
Dependency Check
↓
Correlation
```

## Suppress khi

```text
planned maintenance active
parent dependency already explains symptom
same event already active
known flapping policy applies
```

Suppression không có nghĩa xóa event.

Phải lưu:

```text
suppressed = true
reason
related_parent_event
```

---

# 14. Monitoring Correlation

Correlation keys:

```text
same service
same site
same VLAN/subnet
same upstream switch/router
same dependency
same change window
same time cluster
```

Ví dụ:

```text
48 endpoint unreachable
+ 6 AP unreachable
+ 2 switches degraded
+ same site
```

→ không tạo 56 Incident.

Hệ thống phải tìm:

```text
Shared dependency = Site WAN / Core Switch
```

---

# 15. WF-020 — Root Incident Correlation

## Trigger Conditions

Root Incident được xem xét khi có:

```text
multiple child events
multiple user tickets
shared dependency
high-confidence common cause
```

TASK-092 quyết định attach, đề xuất review hoặc không liên kết bằng
correlation decision bất biến. Không được suy ra auto-link/root creation chỉ
từ danh sách trigger dưới đây. Root tự động chỉ được tạo khi có ít nhất hai
Incident eligible cùng tenant chia sẻ exact canonical source correlation key
mạnh, không có Root hợp lệ hoặc active-root conflict; topology/heuristic-only
correlation phải đưa qua human review.

Root Incident:

```yaml
root_incident:
  id:
  title:
  affected_services:
  affected_sites:
  affected_assets:
  affected_users:
  root_cause_candidate:
  linked_events:
  linked_tickets:
  priority:
  incident_commander:
```

---

# 16. Root Incident Flow

```text
Signals
  ├─ Monitoring events
  ├─ Agent failures
  ├─ Network discovery
  └─ User tickets
       ↓
TASK-092 candidate discovery + versioned explainable score
       ↓
AUTO_LINK only: score ≥85 + strong evidence + exactly one plausible Root
REVIEW_REQUIRED: score 60..84, competing candidates, or material ambiguity
NO_LINK: score <60

Existing valid Root is preferred. Never select the highest candidate when
another Root reaches review threshold. Topology freshness comes only from
TASK-051. Automatic new Root creation is limited to a deterministic shared
canonical source key; topology-only correlation never creates a Root.
```

Sau khi Root Incident tồn tại:

```text
new matching alerts/tickets → evaluate as new correlation evidence;
attach automatically only when TASK-092 AUTO_LINK guards pass
```

Không tạo incident trùng lặp.

---

# 17. Root Incident States

```text
DETECTED
↓
INVESTIGATING
↓
IDENTIFIED
↓
MITIGATING
↓
MONITORING_RECOVERY
↓
RESOLVED
↓
CLOSED
```

Có thể:

```text
RESOLVED → REOPENED
```

---

# 18. Major Incident Rules

Có thể đánh dấu Major Incident nếu:

```text
Priority = P1
OR
critical service unavailable
OR
affected user threshold exceeded
OR
multiple sites affected
OR
manual Incident Manager escalation
```

Khi Major Incident:

```text
assign Incident Manager
open communication channel
start stakeholder updates
increase update cadence
freeze duplicate incident creation
```

---

# 19. Root Incident Communication

User-facing message không chứa raw technical details không cần thiết.

Ví dụ:

```text
Dịch vụ VPN tại Hà Nội đang gặp sự cố.
Đội IT đang xử lý.
Bạn không cần tạo thêm ticket.
Ticket hiện tại đã được liên kết với sự cố INC-2042.
```

Internal view:

```text
WAN packet loss 87%
Router R-HN-01
BGP session flapping
Change CHG-221 executed 18m before incident
```

---

# 20. Root Incident Resolution

Không resolve chỉ vì alert biến mất.

Cần:

```text
Primary signal recovered
AND
service check passed
AND
critical dependencies healthy
AND
observation window passed
```

Ví dụ:

```text
Recovery detected
↓
5 minute stability window
↓
Synthetic test
↓
Agent sample verification
↓
Resolve Root Incident
```

Sau resolution:

```text
linked tickets → RESOLVED/PENDING_USER_CONFIRMATION
linked events → recovered
asset health → recalculate
service health → recalculate
notifications → send
```

---

# 21. Problem Candidate Creation

Sau Incident closure, tạo Problem Candidate nếu:

```text
same incident repeated >= threshold
P1/P2 major incident
root cause unknown
manual workaround used repeatedly
high downtime
high business impact
```

Flow:

```text
Incident
↓
Problem Candidate
↓
Problem Manager Review
↓
RCA
↓
Known Error
↓
Permanent Fix / Change
↓
Knowledge
```

---

# 22. WF-004 — Agent Offline Threshold

## Trigger

```text
AGENT.OFFLINE_THRESHOLD
```

Không trigger ngay heartbeat đầu tiên bị miss.

Ví dụ policy:

```text
Laptop: 48h
Server: 5m
Kiosk: 10m
```

Threshold phụ thuộc asset class.

---

# 23. Agent Offline Decision Tree

```text
Agent heartbeat missing
↓
Asset lifecycle?
├─ Retired/Disposed → ignore + data quality check
├─ Repair → expected state
├─ Available/Storage → low priority policy
└─ In Use → continue
      ↓
Asset reachable?
├─ YES
│   ↓
│ Agent service running?
│ ├─ NO → restart
│ └─ YES → reconnect/re-register
│
└─ NO
    ↓
Network reachable?
    ├─ site outage → attach Root Incident
    ├─ user device possibly off → wait threshold
    └─ unexplained → Work Item
```

---

# 24. Agent Auto Recovery

Safe actions:

```text
restart agent service
refresh token
re-register agent
retry inventory sync
retry pending deployment
```

Không tự:

```text
reboot production server
remove arbitrary software
change VLAN
disable security controls
```

nếu không có explicit policy/approval.

---

# 25. Agent State Machine

```text
ENROLLED
↓
ONLINE
├─ DEGRADED
├─ UPDATE_REQUIRED
└─ OFFLINE
     ↓
RECOVERING
     ↓
ONLINE
```

Hoặc:

```text
OFFLINE → UNMANAGED
```

nếu vượt policy dài hạn và không thể khôi phục.

---

# 26. Agent Data Freshness

Mỗi dataset có timestamp riêng:

```text
heartbeat_last_seen
hardware_inventory_at
software_inventory_at
patch_inventory_at
logged_in_user_at
network_context_at
```

Không được hiển thị dữ liệu cũ như dữ liệu realtime.

Ví dụ:

```text
Software Inventory
Last updated 7 days ago
STALE
```

---

# 27. Agent Enrollment Workflow

```text
Asset exists
↓
Generate enrollment token
↓
Agent install
↓
Mutual authentication
↓
Match hostname/serial
↓
Bind Agent ↔ Asset
↓
Initial Inventory
↓
Health baseline
↓
AGENT.ENROLLED
```

Nếu không match asset:

```text
Unmatched Agent Queue
```

Không tự tạo duplicate asset nếu chưa qua rule.

---

# 28. Permission Matrix

## End User

Có thể:

```text
create own ticket
view own tickets
view assigned assets
run approved self-service fixes
request approved software/service
confirm resolution
```

Không thể:

```text
view other users' assets
run admin remediation
change asset state
```

## Helpdesk L1

```text
triage
run low-risk remediation
assign/escalate tickets
view asset/user context
install approved software
```

## Helpdesk L2 / IT Ops

```text
advanced diagnostics
maintenance actions
agent recovery
network diagnostics
asset state transition
```

## Incident Manager

```text
declare Major Incident
merge/link incidents
manage communications
resolve Root Incident
```

## System Automation

Chỉ chạy action được allowlist bởi policy.

---

# 29. Failure Handling

Mọi automation action phải có:

```text
timeout
retry policy
max attempts
backoff
rollback strategy
human fallback
```

Ví dụ:

```yaml
restart_agent:
  timeout: 60s
  retries: 2
  backoff: 30s
  rollback: none
  fallback: create AGENT_EXCEPTION work item
```

Không retry vô hạn.

This historical generic example does not govern TASK-091 v1. For the
`RESTART_AGENT` capability, TASK-091-R1 is authoritative: one automatic
attempt, zero automatic business retries, no compensation and a five-minute
verification window starting from authenticated Agent acceptance.

---

# 30. Idempotency

Các workflow phải chống chạy lặp.

Ví dụ:

```text
MONITORING.CRITICAL event_id=ZBX-10292
```

Nếu event được nhận lại:

```text
same event_id
→ update existing event
→ do not create another Incident
```

Action keys:

```text
incident:{correlation_key}
ticket:{channel_message_id}
agent_action:{asset_id}:{action}:{time_bucket}
notification:{recipient}:{event}:{version}
```

---

# 31. Generated Events

## User Incident

Có thể sinh:

```text
TICKET.CREATED
TICKET.ENRICHED
INCIDENT.CREATED
INCIDENT.CORRELATED
AUTOMATION.STARTED
AUTOMATION.SUCCEEDED
AUTOMATION.FAILED
TICKET.ASSIGNED
TICKET.RESOLVED
```

## Monitoring Incident

```text
MONITORING.CRITICAL
INCIDENT.CORRELATED
INCIDENT.ROOT_CREATED
SERVICE.DEGRADED
MONITORING.RECOVERED
INCIDENT.RESOLVED
```

## Agent Offline

```text
AGENT.OFFLINE
AGENT.OFFLINE_THRESHOLD
AGENT.RECOVERY_STARTED
AGENT.ONLINE
AGENT.AUTOMATION_ACTION_ACCEPTED
AGENT.AUTOMATION_ACTION_REJECTED
```

For TASK-091 `RESTART_AGENT`, the authenticated Agent Gateway records a
durable command receipt before returning the fixed typed command. The Agent
uses `command_id` for deduplication and separately acknowledges acceptance or
reports a typed rejection. Acceptance is not restart success. Verification
requires a subsequent authenticated heartbeat for the same tenant and Agent
with a new `agent_runtime_id`; ordinary heartbeat/session reconnection does
not prove restart. The Gateway must be configured with an enrolled-Agent
authentication adapter; its unavailable-authentication default remains
fail-closed.

---

# 32. Downstream Workflow Mapping

```text
Repeated Incident
→ Problem Management

Permanent infrastructure fix required
→ Change Management

Repair required
→ Maintenance

User needs replacement device
→ Asset Assignment / Loan

Software issue
→ Software Catalog / Deployment

License issue
→ License Management

Network mismatch
→ Network Operations / Change

Known solution
→ Knowledge Candidate
```

---

# 33. Unified Timeline Rules

Asset Workspace timeline phải nhận events từ:

```text
Ticket
Incident
Monitoring
Agent
Network
Assignment
Movement
Maintenance
Audit
Software
License
Change
```

Ví dụ:

```text
09:42 MONITORING
High CPU detected

09:43 SYSTEM
INC-2042 created

09:44 AGENT
Diagnostic collected

09:46 HELPDESK
Assigned to Network Team

10:05 CHANGE
Temporary routing fix applied

10:08 MONITORING
Service recovered

10:14 INCIDENT
Resolved after stability verification
```

---

# 34. Notification Matrix

| Event | End User | Assignee | Team Lead | Service Owner |
|---|---|---|---|---|
| Ticket created | Yes | If assigned | No | No |
| Ticket assigned | Optional | Yes | No | No |
| SLA 70% | No | Yes | Optional | No |
| SLA 90% | Optional | Yes | Yes | Optional |
| P1 created | Affected users | Yes | Yes | Yes |
| Major Incident update | Affected users | Yes | Yes | Yes |
| Resolved | Yes | Yes | No | Optional |
| Agent auto-recovered | No | Optional | No | No |

Notification phải được deduplicate và rate-limit.

---

# 35. User Helpdesk Experience

User flow phải tối giản:

```text
Login via SSO
↓
"I need help"
↓
Select issue OR type description
↓
Asset auto-selected if unambiguous
↓
Submit
```

Sau đó hệ thống tự làm:

```text
identify user
identify asset
identify service
collect agent health
collect monitoring
check known incident
check knowledge
attempt safe remediation
```

User không phải nhập:

```text
serial
hostname
IP
department
location
```

nếu hệ thống đã biết.

---

# 36. User Ticket View

User chỉ cần thấy:

```text
Ticket ID
Issue
Status
Assigned team/person
Latest meaningful update
Expected next step
SLA/ETA if policy permits
Messages
Resolution
```

Không hiển thị nội bộ:

```text
raw monitoring event IDs
correlation score
SNMP internals
internal notes
private RCA hypotheses
security-sensitive diagnostics
```

---

# 37. Resolution Confirmation

Sau khi technician resolve:

```text
RESOLVED
↓
User Notification
↓
User:
[Đã ổn]
[Vẫn còn lỗi]
```

Nếu:

```text
Đã ổn → CLOSED
```

Nếu:

```text
Vẫn còn lỗi → REOPENED
```

Nếu không phản hồi:

```text
auto-close after policy duration
```

---

# 38. Example E2E — VPN Failure

```text
08:42 User reports "Không vào được VPN"
↓
Identity resolved from SSO
↓
Asset AST-0042 identified
↓
Agent = Online
↓
VPN service process = stopped
↓
No root incident exists
↓
Approved auto-remediation available
↓
Restart VPN service
↓
Connectivity test PASS
↓
Ticket marked RESOLVED
↓
User notified
↓
Asset timeline updated
```

Helpdesk không cần tham gia.

---

# 39. Example E2E — Site Network Outage

```text
10:02 12 endpoints unreachable
10:02 3 AP unreachable
10:03 1 switch unreachable
10:03 6 users submit tickets
↓
TASK-092 scores candidate Root relationships using versioned evidence
↓
AUTO_LINK only if score ≥85, strong evidence and exactly one plausible Root;
otherwise REVIEW_REQUIRED or NO_LINK
↓
Existing eligible Root preferred; new Root auto-created only for the
deterministic shared-source-key case defined by TASK-092
↓
Only the active Incident↔Root relationship is changed; source Incidents,
alerts and Tickets remain independently auditable
↓
P1 Major Incident
↓
Network team assigned
↓
WAN provider fault identified
↓
Provider restores link
↓
Monitoring recovered
↓
5-minute stability window
↓
Synthetic tests PASS
↓
Root Incident resolved
↓
Each child Incident/Ticket follows its own authorized resolution workflow;
correlation alone does not close either record
↓
Affected users notified
```

Không tạo 22 Incident riêng.

---

# 40. Example E2E — Agent Offline

```text
Laptop agent misses heartbeat
↓
48h threshold reached
↓
Asset = In Use
↓
Network ping succeeds
↓
Agent service = stopped
↓
Auto restart
↓
Heartbeat restored
↓
Health recalculated
↓
No human ticket created
↓
Timeline records recovery
```

Nếu restart thất bại:

```text
AGENT_EXCEPTION
→ Helpdesk Work Queue
```

---

# 41. Metrics / KPI

## Helpdesk

```text
First Response Time
Resolution Time
SLA Compliance
Reopen Rate
First Contact Resolution
Tickets per Service
Tickets per Asset
```

## Automation

```text
Auto-remediation Success Rate
Tickets Avoided
Mean Automation Time
Automation Failure Rate
```

## Incident

```text
MTTD
MTTA
MTTR
Major Incident Count
Repeat Incident Rate
Correlation Accuracy
```

## Agent

```text
Agent Coverage
Online Rate
Inventory Freshness
Recovery Success
Deployment Success
```

---

# 42. Guardrails

Hệ thống không được:

1. Tạo Incident mới cho mỗi alert nếu đã có correlation hợp lệ.
2. Tạo duplicate ticket vì channel retry.
3. Chạy remediation nguy hiểm mà không có policy.
4. Resolve Incident chỉ dựa vào alert disappeared.
5. Hiển thị stale agent data như realtime.
6. Bắt user nhập dữ liệu hệ thống đã biết.
7. Buộc Helpdesk chuyển module chỉ để xem Asset/Monitoring context.
8. Gửi notification cho mọi low-level event.
9. Thay đổi nhiều Asset states không liên quan trong một action.
10. Xóa lịch sử sau merge/correlation.

---

# 43. Definition of Done

Một implementation của cụm workflow này chỉ đạt yêu cầu khi:

- Ticket được enrich tự động.
- Asset/User/Service correlation hoạt động.
- Duplicate prevention hoạt động.
- Monitoring event correlation hoạt động.
- Root Incident có child events/tickets.
- Agent offline có policy theo asset class.
- Safe remediation có verify step.
- SLA timers và escalation hoạt động.
- State transitions có audit trail.
- Notification được deduplicate.
- Unified timeline phản ánh toàn bộ operational history.
- User có thể reopen resolution.
- Repeated incidents có thể tạo Problem Candidate.
- Workflow chịu được retry mà không tạo duplicate side effects.

---

# 44. TASK-091 v1 — Authenticated RESTART_AGENT Execution

This section is normative for TASK-091 v1 and narrows the broader automation
examples above. TASK-091 v1 supports only the reviewed capability
`RESTART_AGENT` targeting a canonically registered `AGENT`. It does not
support arbitrary shell commands, scripts, binaries, process commands, URLs
or caller-supplied action payloads. The executor maps the typed capability to
one fixed, allow-listed Agent protocol operation.

## 44.1 Execution boundary and security recheck

The Automation domain owns Action Intent decisions; TASK-091 owns a separate
Action Execution attempt. TASK-091 consumes only a canonically `READY`
Action Intent. Immediately before dispatch it rechecks, against canonical
current state:

- the intent remains `READY`;
- the capability still permits automatic `RESTART_AGENT` execution;
- the tenant Action Policy still permits this action and target;
- the tenant-bound `SYSTEM_AUTOMATION` principal still has
  `agent.restart` over the target resource scope;
- any required approval remains approved and bound to the current intent and
  action context;
- no unresolved conflict, cancellation or superseding execution exists;
- the kill switch permits execution; and
- the target resolves to the same registered Agent in the same tenant and
  resource scope.

Missing, stale, unavailable or ambiguous evidence fails closed. Do not
dispatch; persist a reasoned non-success execution outcome and create one
actionable Work Item where operator action is required. These checks do not
use the Rule author's or current human session's privileges. `READY` is not a
permanent authorization token.

## 44.2 Agent authentication and command identity

Dispatch and reporting use the existing authenticated Agent Gateway
contract. The platform derives `tenant_id` and Agent identity from the
authenticated enrolled-Agent principal; it never trusts an Agent ID supplied
only by Rule/action parameters. The Agent accepts commands only through the
trusted authenticated platform channel.

Each attempt has immutable `execution_id` and `command_id`. The fixed command
envelope contains `intent_id`, `tenant_id`, `target_agent_id`,
`action_type=RESTART_AGENT`, `correlation_id` and `issued_at`. `command_id` is
stable across transport redelivery. Durable Agent-side inbox/deduplication
must ensure redelivery of the same command does not restart the Agent twice.
The platform must never create a new command ID for automatic retry in v1.

The Agent protocol distinguishes delivery from acceptance. `DISPATCHED`
means the platform durably recorded/sent the command. `ACCEPTED` requires a
positive authenticated acknowledgement for that exact `command_id` after the
Agent durably records it for execution. Acceptance does not prove successful
restart.

## 44.3 Pre-execution baseline and restart proof

Before dispatch, capture an immutable baseline including available canonical
Agent ID and tenant, connection/session identity, `agent_runtime_id` or an
equivalent restart generation, last heartbeat, target/resource context,
policy and authorization evidence, and correlation references. Wall-clock
heartbeat time alone is insufficient when a stronger runtime marker is
available.

The Agent publishes an authenticated `agent_runtime_id` in heartbeat and
command acknowledgement/result context. It is generated for one Agent
process/service runtime and changes when that process/service restarts; an
ordinary network reconnect does not change it. A positive verification
requires a post-acceptance authenticated heartbeat/reconnect from the same
Agent and tenant with a runtime marker newer/different from the captured
baseline. An ordinary heartbeat from the pre-restart runtime never proves
success.

The verification window is exactly five minutes from the authoritative
Agent `ACCEPTED` timestamp. If acceptance cannot be established, do not start
the ordinary verification window; classify uncertain delivery as `UNKNOWN`.
This five-minute limit applies only to `RESTART_AGENT` v1, not as a global
automation timeout policy.

## 44.4 Execution result and recovery

Execution outcome is one of:

- `SUCCEEDED`: positive post-restart evidence is observed within the window.
- `FAILED`: authoritative evidence proves non-success, including a signed
  Agent rejection, pre-dispatch security recheck denial, or deterministic
  execution failure.
- `UNKNOWN`: the platform cannot establish safely whether the restart
  occurred, including lost acknowledgement, accepted command without
  verifiable reconnect by deadline, lost platform connectivity, or ambiguous
  evidence.

Verification timeout defaults to `UNKNOWN`, never `FAILED`, unless
authoritative failure evidence exists. `UNKNOWN` is terminal for the
automatic attempt, creates one idempotent actionable Work Item and is never
automatically retried. TASK-091 v1 has exactly one automatic execution
attempt and zero automatic business retries. A redelivery of the same
`command_id` is transport recovery, not a new execution attempt.

`RESTART_AGENT` has no automatic compensation. No inverse restart, stop/start
or rollback command may be invented. Execution success means only that the
Agent runtime restarted; it does not prove global Agent health, Incident
resolution or root-cause correction. TASK-091 must not close an Incident on
this result alone.

## 44.5 Cancellation and manual retry

Cancellation is allowed only when durable evidence proves the Agent has not
accepted the command. If the platform cannot prove non-acceptance, cancellation
is unsafe and the execution becomes `UNKNOWN` for reconciliation. Cancellation
after `ACCEPTED` is forbidden. Do not report `CANCELLED` if delivery outcome
is ambiguous.

Manual retry requires explicit operator reconciliation that the prior attempt
did not successfully restart the Agent. It creates a new `execution_id` and
`command_id`, links the prior execution, records actor/reason/evidence, and
rechecks all current authorization, policy, approval, target, conflict and
kill-switch guards. It cannot reuse or erase the prior execution. If
reconciliation finds that the restart succeeded, close the fallback as
reconciled without issuing another command.

## 44.6 Concurrency and crash safety

An atomic durable claim/lease permits only one worker to own an execution
attempt. Enforce uniqueness for one automatic attempt per Action Intent,
attempt number within an intent, and `command_id`. Concurrent workers may not
dispatch twice. Persist command intent/outbox before external dispatch.

If a worker crashes before dispatch is durably recorded, the attempt may
resume from durable state. If it crashes after dispatch, do not blindly
redispatch or create another attempt. Reconcile the same command ID, Agent
acceptance and runtime marker. If outcome remains uncertain, set `UNKNOWN`
and create the single human fallback. At-most-once safety takes precedence
over blind retry.

## 44.7 Operator evidence and Work Queue

Preserve intent/rule/version, execution/command IDs, capability, target Agent,
service principal, policy version/decision, permission/scope result, approval,
kill-switch and conflict results, claim/lease, dispatch and acceptance times,
pre-execution baseline, verification evidence, terminal outcome, reason codes
and correlation IDs. Never expose Agent credentials/secrets in audit, events,
timeline or Work Queue.

Create one actionable Work Item for `UNKNOWN`, deterministic failure needing
intervention, security/policy changes requiring operator review, verification
timeout, ambiguous Agent identity/session, or manual retry review. Work Queue
references the canonical execution and never replaces its state.

---

# TASK-093 Self-Service Recommendation and Ticket Handoff

Knowledge recommendations are advisory. On explicit user `ISSUE_RESOLVED`,
the recommendation session may end as `USER_RESOLVED` and Ticket creation may
be avoided. Otherwise (including no recommendation, unresolved guidance,
`NOT_HELPFUL` or escalation), continue through canonical Ticket intake and
preserve normalized support context plus the recommendation session/reference
without requiring equivalent re-entry. TASK-093 never transitions an existing
Ticket or Incident; Ticket lifecycle changes remain canonical Helpdesk
commands.

An ACTIVE Root Incident may supply status/context and prioritize associated
eligible end-user-safe Knowledge. Do not repeat local remediation known
ineffective for a shared outage. Track known-incident deflection separately
from Knowledge resolution. Do not close or otherwise mutate the Root Incident.

Only currently published TASK-037 Knowledge versions authorized for the
actor/audience may be presented. Open/click/helpful feedback does not confirm
resolution. TASK-093 does not generate authoritative troubleshooting text,
call TASK-091, or execute remediation. Search failure must not block Ticket
creation.
