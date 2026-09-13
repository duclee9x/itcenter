# PROBLEM + CHANGE + KNOWLEDGE WORKFLOW SPEC
## Execution-Level Workflow Design

**Version:** 0.1  
**Status:** Draft for implementation  
**Parent:** `MASTER_WORKFLOW_MAP.md`  
**Depends on:** `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`  
**Scope:** Problem Management, Root Cause Analysis, Known Error, Change Management, Verification, Knowledge Management

---

# 1. Mục tiêu

Tài liệu này chi tiết hóa chuỗi:

```text
Incident lặp lại / Major Incident
        ↓
Problem Candidate
        ↓
Problem
        ↓
RCA
        ↓
Known Error / Workaround
        ↓
Change Request
        ↓
Approval
        ↓
Implementation
        ↓
Verification
        ↓
Problem Resolution
        ↓
Knowledge
```

Mục tiêu là bảo đảm hệ thống không chỉ "đóng ticket", mà phải học từ sự cố để:

- giảm Incident lặp lại;
- tạo workaround nhanh;
- kiểm soát thay đổi;
- giảm rủi ro triển khai;
- tạo Knowledge dùng lại;
- liên kết đầy đủ Incident → Problem → Change → Knowledge;
- giữ audit trail xuyên suốt.

---

# 2. Core Entities

```text
INCIDENT
PROBLEM
PROBLEM CANDIDATE
KNOWN ERROR
WORKAROUND
ROOT CAUSE ANALYSIS
CHANGE REQUEST
CHANGE TASK
CHANGE WINDOW
CHANGE APPROVAL
ROLLBACK PLAN
VERIFICATION
KNOWLEDGE ARTICLE
KNOWLEDGE CANDIDATE
SERVICE
ASSET
CI
USER
OWNER
APPROVER
AUDIT TRAIL
```

---

# 3. Problem Candidate Rules

Problem Candidate có thể được tạo tự động khi:

```text
same incident signature repeated >= threshold
same asset/service has repeated incidents
Major Incident occurred
P1/P2 incident root cause unknown
temporary workaround used repeatedly
incident resolution time is abnormally high
repair cost repeats
multiple assets fail with same symptom
monitoring detects recurring pattern
```

Ví dụ:

```text
VPN disconnect incident
7 lần / 30 ngày
cùng client version
cùng certificate module
```

→ tạo `Problem Candidate`.

---

# 4. Problem Candidate Object

```yaml
problem_candidate:
  id:
  title:
  signature:
  source:
  related_incidents:
  related_assets:
  related_services:
  recurrence_count:
  first_seen:
  last_seen:
  business_impact:
  suggested_owner:
  confidence:
  status:
```

Status:

```text
NEW
REVIEWED
ACCEPTED
REJECTED
MERGED
```

---

# 5. WF-P01 — Create Problem Candidate

## Trigger

Một trong:

```text
Incident threshold reached
Major Incident closed
Manual technician flag
Correlation engine detects recurring pattern
```

## Context Enrichment

Thu thập:

```text
Incident history
Affected assets
Affected services
Common versions
Recent changes
Monitoring pattern
Agent telemetry
Repair history
Known errors
Workarounds
```

## Duplicate Prevention

Fingerprint:

```text
service
symptom_category
root_cause_candidate
asset_class
software_version
time_pattern
```

Nếu đã có Problem đang `OPEN/INVESTIGATING` với cùng fingerprint:

```text
link new incidents
do not create duplicate Problem
```

## Human Action

Problem Manager:

```text
Accept
Reject
Merge
Request more evidence
```

## Output Events

```text
PROBLEM.CANDIDATE_CREATED
PROBLEM.CANDIDATE_ACCEPTED
PROBLEM.CANDIDATE_REJECTED
```

---

# 6. WF-P02 — Problem Lifecycle

State machine:

```text
NEW
↓
UNDER_REVIEW
↓
INVESTIGATING
├── WORKAROUND_AVAILABLE
├── KNOWN_ERROR
└── CHANGE_REQUIRED
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

# 7. Problem Workspace Context

Khi mở Problem, operator phải thấy:

```text
Problem ID / Title
Affected Service
Impact
Recurrence
Related Incidents
Affected Assets
Common Symptoms
Known Workarounds
Recent Changes
Monitoring Evidence
Agent Evidence
Current RCA
Owner
Priority
Next Action
```

Không bắt người xử lý mở nhiều module để thu thập lại context.

---

# 8. RCA Model

RCA không nên chỉ là textarea "Nguyên nhân".

Cần cấu trúc:

```yaml
rca:
  problem_statement:
  impact_summary:
  timeline:
  detection:
  contributing_factors:
  root_cause:
  why_not_detected_earlier:
  why_existing_controls_failed:
  workaround:
  permanent_fix:
  prevention:
  evidence:
```

---

# 9. RCA Techniques

Hệ thống có thể hỗ trợ template:

```text
5 Whys
Fishbone / Ishikawa
Fault Tree
Timeline Analysis
Change Correlation
Dependency Analysis
```

Không ép một kỹ thuật cho mọi Problem.

---

# 10. Example RCA

```text
Problem:
VPN client randomly disconnects

Impact:
42 users / 3 departments

Root Cause:
Certificate renewal module in client v6.2.0 fails after token refresh.

Contributing Factors:
- outdated client package
- retry logic missing
- health check only checks process state

Workaround:
Restart VPN service.

Permanent Fix:
Deploy client v6.2.1.

Prevention:
Add certificate renewal synthetic check.
```

---

# 11. Known Error

Known Error được tạo khi:

```text
root cause known
AND
permanent fix not yet implemented
```

Known Error object:

```yaml
known_error:
  id:
  problem_id:
  symptom:
  root_cause:
  affected_versions:
  affected_assets:
  workaround:
  risk:
  permanent_fix_status:
```

---

# 12. Workaround Rules

Workaround phải:

```text
be explicit
have applicability conditions
have risk level
have rollback/undo if relevant
have verification step
```

Ví dụ:

```text
Restart VPN service
Applicable to: client v6.2.0
Risk: Low
Expected downtime: <30s
Verify: VPN tunnel connected
```

Nếu workaround được approve:

```text
Helpdesk may run directly
Automation may use if policy allows
```

---

# 13. WF-P03 — Publish Workaround to Helpdesk

## Trigger

```text
Problem enters WORKAROUND_AVAILABLE
```

## Actions

System tự:

```text
Attach workaround to related incidents
Expose in Ticket Workspace
Expose to automation engine
Optionally expose to self-service
```

## Guardrail

Không publish externally nếu:

```text
security-sensitive
requires admin privileges
has material operational risk
```

---

# 14. Problem Priority

Problem Priority nên xem xét:

```text
incident recurrence
business impact
service criticality
number of assets affected
workaround availability
repair cost
security/compliance impact
```

Ví dụ:

```text
High recurrence + Critical service + No workaround
→ High Priority Problem
```

---

# 15. Change Requirement Decision

Problem cần Change khi fix vĩnh viễn đòi hỏi:

```text
production config change
network change
software upgrade
infrastructure change
policy change
agent deployment
service restart with risk
database/schema change
security control change
```

Nếu fix chỉ là low-risk routine action đã được pre-approved:

```text
Standard Change
```

---

# 16. Change Types

```text
STANDARD
NORMAL
EMERGENCY
```

## Standard Change

```text
Low risk
Repeatable
Pre-approved
Documented procedure
```

Ví dụ:

```text
Deploy approved endpoint agent version
```

## Normal Change

```text
Requires assessment + approval
```

## Emergency Change

```text
Urgent
High business impact
Reduced approval path
Post-review mandatory
```

---

# 17. WF-C01 — Create Change Request

## Trigger

```text
Problem permanent fix
Manual operational request
Security remediation
Planned infrastructure work
Emergency incident mitigation
```

## Required Context

```text
Why
What changes
Affected Service/CI/Assets
Risk
Impact
Implementation plan
Test plan
Rollback plan
Change window
Owner
Approvers
```

---

# 18. Change Object

```yaml
change:
  id:
  type:
  title:
  reason:
  source_problem:
  related_incidents:
  affected_services:
  affected_cis:
  risk:
  impact:
  implementation_plan:
  test_plan:
  rollback_plan:
  maintenance_window:
  owner:
  approvers:
  status:
```

---

# 19. Change State Machine

```text
DRAFT
↓
ASSESSMENT
↓
PENDING_APPROVAL
├── REJECTED
└── APPROVED
      ↓
SCHEDULED
      ↓
IMPLEMENTING
      ├── FAILED
      ├── ROLLED_BACK
      └── VERIFYING
            ↓
SUCCESSFUL
            ↓
CLOSED
```

Emergency path:

```text
DRAFT
→ EMERGENCY_APPROVAL
→ IMPLEMENTING
→ VERIFYING
→ POST_REVIEW
→ CLOSED
```

---

# 20. Risk Assessment

Risk không nhập cảm tính duy nhất.

Có thể tính từ:

```text
service criticality
number of affected users
change complexity
rollback difficulty
historical failure rate
dependency count
change type
maintenance window
test coverage
```

Ví dụ:

```text
Risk Score = 72/100
Risk = High
```

Phải giải thích được vì sao.

---

# 21. Change Collision Detection

Trước khi approve/schedule:

```text
Check same Service
Check same CI
Check same Site
Check same VLAN
Check same maintenance window
Check dependency relationship
```

Nếu hai Change xung đột:

```text
CHANGE.COLLISION_DETECTED
```

Actions:

```text
reschedule
merge
sequence
approve exception
```

---

# 22. Approval Engine

Approval có thể phụ thuộc:

```text
Change type
Risk
Service criticality
Cost
Security impact
Business unit
```

Ví dụ:

```text
Standard Change
→ pre-approved

Normal Low Risk
→ Team Lead

Normal High Risk
→ Service Owner + Change Manager

Emergency
→ Incident Manager + Authorized Approver
```

---

# 23. Segregation of Duties

Policy có thể yêu cầu:

```text
Requester != Approver
```

với Change rủi ro cao.

System phải kiểm tra quyền trước approval.

---

# 24. Change Tasks

Một Change có thể gồm:

```text
Pre-check
Backup
Implementation
Validation
Monitoring
Rollback
Documentation
```

Ví dụ:

```text
CHG-1204 Upgrade VPN client

Task 1: Publish artifact
Task 2: Pilot 10 devices
Task 3: Verify
Task 4: Deploy 200 devices
Task 5: Monitor failure rate
Task 6: Close
```

---

# 25. Pilot / Progressive Rollout

Không nhất thiết deploy toàn bộ ngay.

Flow:

```text
Pilot
↓
Verify
↓
10%
↓
Verify
↓
50%
↓
Verify
↓
100%
```

Có thể stop nếu:

```text
failure rate > threshold
health decreases
incident spike detected
```

---

# 26. WF-C02 — Change Implementation

## Pre-check

Bắt buộc kiểm:

```text
approval valid
window active
dependencies healthy
backup available if required
rollback available
responsible operator online
```

## Execute

```text
Start Change
↓
Record actual start
↓
Execute Tasks
↓
Capture Result
```

## Failure

Nếu task failure:

```text
pause
↓
evaluate rollback threshold
```

---

# 27. Rollback Rules

Rollback có thể tự động nếu:

```text
critical validation failed
service health below threshold
error rate exceeds limit
agent deployment failures exceed threshold
```

Mỗi rollback phải ghi:

```text
trigger
actor
steps
result
verification
```

---

# 28. Verification

Change không được `SUCCESSFUL` chỉ vì implementation command chạy xong.

Cần:

```text
technical verification
service verification
monitoring verification
user/business verification if needed
```

Ví dụ:

```text
VPN client deployment complete
↓
Agent reports version 6.2.1
↓
VPN connection synthetic test PASS
↓
Incident rate normal
↓
Change SUCCESSFUL
```

---

# 29. Change Verification Window

Có thể yêu cầu stability window:

```text
5 minutes
30 minutes
2 hours
24 hours
```

tùy loại Change.

Trong window:

```text
monitor related metrics
monitor ticket spike
monitor agent health
```

---

# 30. Failed Change

Event:

```text
CHANGE.FAILED
```

System phải:

```text
link affected incidents
notify owner
increase risk history
capture failure reason
create follow-up
```

Nếu rollback thành công:

```text
status = ROLLED_BACK
```

Không coi là successful.

---

# 31. Emergency Change

Emergency Change chỉ dùng khi trì hoãn gây rủi ro lớn hơn.

Flow:

```text
Major Incident
↓
Emergency Change proposed
↓
Fast approval
↓
Implement
↓
Verify
↓
Restore Service
↓
Mandatory Post Implementation Review
```

Không được dùng Emergency như đường tắt cho planning kém.

---

# 32. Post Implementation Review

PIR bắt buộc khi:

```text
Emergency Change
Failed Change
High Risk Change
Major Incident-related Change
```

PIR lưu:

```text
planned vs actual
unexpected impact
rollback needed?
monitoring result
incident impact
lesson learned
follow-up actions
```

---

# 33. WF-P04 — Resolve Problem

Problem chỉ được resolve khi:

```text
permanent fix implemented
AND
verification passed
AND
incident recurrence drops below threshold
```

Không resolve chỉ vì Change closed.

Flow:

```text
Change Successful
↓
Observation Window
↓
No recurrence / health stable
↓
Problem RESOLVED
```

---

# 34. Problem Observation Window

Ví dụ:

```text
7 days
30 days
N business cycles
```

tùy loại Problem.

Nếu incident tái diễn:

```text
Problem → REOPENED
```

---

# 35. Knowledge Candidate Creation

Knowledge Candidate có thể sinh từ:

```text
resolved incident
approved workaround
known error
completed RCA
successful change
recurring user question
```

Event:

```text
KNOWLEDGE.CANDIDATE_CREATED
```

---

# 36. Knowledge Types

```text
HOW_TO
TROUBLESHOOTING
KNOWN_ERROR
WORKAROUND
FAQ
RUNBOOK
SERVICE_GUIDE
RECOVERY_PROCEDURE
```

---

# 37. Knowledge Audience

Mỗi article phải có scope:

```text
PUBLIC_END_USER
AUTHENTICATED_USER
HELPDESK_INTERNAL
IT_OPS_INTERNAL
ADMIN_ONLY
```

Không tự public nội dung nội bộ.

---

# 38. Knowledge Article Model

```yaml
knowledge_article:
  id:
  type:
  title:
  symptom:
  audience:
  applicability:
  prerequisites:
  steps:
  expected_result:
  verification:
  rollback:
  related_service:
  related_asset_class:
  related_software:
  source_problem:
  source_change:
  owner:
  review_date:
  status:
```

---

# 39. Knowledge State Machine

```text
DRAFT
↓
IN_REVIEW
↓
PUBLISHED
↓
ARCHIVED
```

These are the canonical TASK-037 persistence states. `REVIEW_DUE` is derived
review context, not an article state. `UPDATED` is an event/new aggregate
version, not a state. The former labels `REVIEW`, `APPROVED` and `RETIRED`
are documentation drift; use `IN_REVIEW`, the existing publish transition
into `PUBLISHED`, and `ARCHIVED` respectively. TASK-093 does not change this
lifecycle or introduce parallel Knowledge version persistence.

---

# 40. Knowledge Quality Rules

Article phải:

```text
solve a defined problem
state applicability
avoid obsolete versions
contain verification
have owner
have review date
link source evidence
```

Không tạo knowledge từ mọi ticket tự động.

---

# 41. Knowledge Feedback Loop

Khi article được sử dụng:

```text
Article suggested
↓
User/Technician uses it
↓
Resolved?
├─ YES → usefulness +1
└─ NO  → feedback
```

Metrics:

```text
view count
use count
resolution rate
deflection rate
helpfulness
last successful use
```

---

# 42. Knowledge Deflection

Self-service có thể thử trước ticket:

```text
User enters issue
↓
System identifies intent
↓
Suggest Knowledge
↓
Solved?
├─ YES → no ticket needed
└─ NO → create ticket with attempted article attached
```

Không ép user đọc article trước khi được hỗ trợ.

---

# 43. Knowledge in Helpdesk Workspace

Khi technician mở ticket:

```text
Symptom
Service
Asset
Software version
Known Problem
```

→ Knowledge Engine đề xuất:

```text
Most relevant workaround
Known Error
Runbook
Similar resolved case
```

---

# 44. Knowledge from Problem

Ví dụ:

```text
PRB-0042 VPN certificate renewal issue
↓
Known Error
↓
Workaround: restart VPN service
↓
Change CHG-1204 deploys v6.2.1
↓
Problem resolved
↓
Knowledge article:
"VPN disconnects on client v6.2.0"
```

Article có thể giữ workaround cho thiết bị chưa upgrade.

---

# 45. End-to-End Example

```text
Day 1
5 VPN incidents
↓
Day 4
12 VPN incidents
↓
Problem Candidate created
↓
Problem Manager accepts
↓
RCA finds bug in VPN v6.2.0
↓
Known Error created
↓
Workaround published to Helpdesk
↓
Ticket resolution time drops
↓
Normal Change created
↓
Pilot v6.2.1 to 10 devices
↓
Verification PASS
↓
Rollout 100%
↓
30-day observation
↓
No recurrence
↓
Problem resolved
↓
Knowledge published
```

---

# 46. Generated Events

## Problem

```text
PROBLEM.CANDIDATE_CREATED
PROBLEM.CREATED
PROBLEM.INVESTIGATION_STARTED
PROBLEM.WORKAROUND_AVAILABLE
PROBLEM.KNOWN_ERROR_CREATED
PROBLEM.CHANGE_REQUIRED
PROBLEM.RESOLVED
PROBLEM.REOPENED
PROBLEM.CLOSED
```

## Change

```text
CHANGE.CREATED
CHANGE.ASSESSED
CHANGE.APPROVAL_REQUESTED
CHANGE.APPROVED
CHANGE.REJECTED
CHANGE.SCHEDULED
CHANGE.STARTED
CHANGE.TASK_FAILED
CHANGE.ROLLBACK_STARTED
CHANGE.ROLLED_BACK
CHANGE.VERIFICATION_STARTED
CHANGE.SUCCESSFUL
CHANGE.FAILED
CHANGE.CLOSED
```

## Knowledge

```text
KNOWLEDGE.CANDIDATE_CREATED
KNOWLEDGE.REVIEW_REQUESTED
KNOWLEDGE.APPROVED
KNOWLEDGE.PUBLISHED
KNOWLEDGE.UPDATED
KNOWLEDGE.REVIEW_DUE
KNOWLEDGE.RETIRED
```

---

# 47. Permissions

## Helpdesk L1

```text
view known errors
run approved workaround
suggest knowledge candidate
link incident to problem
```

## Helpdesk L2 / IT Ops

```text
contribute RCA
create problem candidate
create change draft
execute standard change
```

## Problem Manager

```text
accept/merge Problem
approve RCA
declare Known Error
resolve Problem
```

## Change Manager

```text
assess risk
approve scheduling
manage collisions
close Normal Change
```

## Service Owner

```text
approve high-impact change
accept business risk
```

## Knowledge Manager

```text
approve/publish/retire article
```

---

# 48. Notification Rules

Không gửi mọi state transition.

## Immediate

```text
Emergency Change approved
Change failed
Rollback started
High-impact Change collision
```

## Action Required

```text
Problem review
Change approval
PIR required
Knowledge review
```

## Informational

```text
Workaround available
Change successful
Problem resolved
Knowledge published
```

---

# 49. Audit Trail

Mọi object phải lưu:

```text
who
what
when
before
after
reason
source
related records
```

Đặc biệt Change cần:

```text
planned start
actual start
planned end
actual end
approvals
commands/actions
verification evidence
rollback evidence
```

---

# 50. Idempotency / Duplicate Prevention

## Problem

```text
same signature + active Problem
→ link, do not create new
```

## Change

```text
same external request / same implementation job
→ update existing Change
```

## Knowledge

```text
same Problem + same audience + same purpose
→ suggest update existing article
```

---

# 51. Metrics / KPI

## Problem Management

```text
Repeat Incident Rate
Problems Open
Mean Time to Root Cause
Known Error Coverage
Problem Recurrence after Fix
Incidents linked per Problem
```

## Change Management

```text
Change Success Rate
Failed Change Rate
Rollback Rate
Emergency Change Rate
Unauthorized Change Count
Change-induced Incidents
Average Lead Time
```

## Knowledge

```text
Knowledge Deflection Rate
Article Success Rate
Helpfulness
Stale Article Count
Knowledge Reuse
Time to Publish
```

---

# 52. Guardrails

Hệ thống không được:

1. Đóng Problem chỉ vì một Incident đã resolve.
2. Tạo Problem mới nếu đã có Problem cùng signature đang active.
3. Public workaround nhạy cảm cho End User.
4. Cho Change rủi ro cao không có rollback plan nếu policy yêu cầu.
5. Mark Change successful trước verification.
6. Bỏ qua collision detection.
7. Dùng Emergency Change để né approval bình thường.
8. Publish Knowledge không có owner/review date.
9. Xóa liên kết Incident → Problem → Change sau closure.
10. Tự động thay đổi root cause history sau khi RCA được approved mà không audit.

---

# 53. Definition of Done

Cụm workflow này đạt yêu cầu khi:

- Repeated incidents tự tạo được Problem Candidate.
- Problem có duplicate prevention.
- RCA có cấu trúc rõ.
- Known Error và Workaround liên kết Helpdesk.
- Change có type, state machine, risk, approval, window, collision detection.
- Change có implementation + verification + rollback.
- Emergency Change có PIR bắt buộc.
- Problem chỉ resolve sau observation window.
- Knowledge Candidate sinh từ Incident/Problem/Change.
- Knowledge có audience, owner, review date.
- Self-service có thể dùng Knowledge để deflect ticket.
- Audit trail xuyên suốt Incident → Problem → Change → Knowledge.

---

# 54. TASK-093 Knowledge Recommendation and Deflection

TASK-093 uses TASK-037 Knowledge governance, TASK-061 Search, and optional
TASK-092 Root Incident context. It does not publish Knowledge, create another
search engine, generate authoritative troubleshooting content, invoke
TASK-091, mutate infrastructure, or automatically close Ticket/Incident.

Recommend only same-tenant, canonical current `PUBLISHED`, visible,
applicable Knowledge that passes `knowledge.read`, audience and resource
scope. Exclude `DRAFT`, `IN_REVIEW`, `ARCHIVED`, withdrawn, superseded and
otherwise unavailable versions. Revalidate canonical state, exact aggregate
version, audience and authorization immediately before presentation. Search
index presence is insufficient. On Search failure use only TASK-061-permitted
fallback; otherwise return `NO_RECOMMENDATION` and allow Ticket intake.

Preserve existing audience values (`PUBLIC_END_USER`, `AUTHENTICATED_USER`,
`HELPDESK_INTERNAL`, `IT_OPS_INTERNAL`, `ADMIN_ONLY`). End users receive only
governed end-user-safe content. Do not leak inaccessible content through
title, snippet, count, score, tags, rank, errors, events or timeline. Do not
propagate credentials or protected raw telemetry.

TASK-093 v1 has versioned 0..100 scoring: exact Known Error/explicit
Knowledge binding +60 STRONG; same Problem/Known Error +50 STRONG; if both
represent the same semantic source, count only the stronger. Same canonical
Service/product +20; same normalized category/symptom +15; same supported
platform/environment +10; prior explicitly confirmed deflection for
equivalent normalized context +10. Cap at 100. Raw free text is never strong.
Score >=70 is eligible; below 70 is not presented. Score cannot bypass any
eligibility/safety gate. TASK-061 fuzzy/full-text helps discovery/ranking
only. Return at most three explainable, relevance-ordered items, no filler;
profile/version changes create a new immutable profile version.

An ACTIVE Root Incident may prioritize associated eligible end-user-safe
status/guidance where appropriate; avoid repeating local remediation known
ineffective for a shared outage. Do not mutate the Root. Track
`KNOWN_INCIDENT_DEFLECTION` separately from `KNOWLEDGE_RESOLUTION`.

Persist a `KnowledgeRecommendationSession`, items with exact Knowledge
aggregate version/rank/score/evidence/profile/eligibility reference, and
append-only interactions. Do not copy article bodies. Outcomes are
`NO_RECOMMENDATION`, `PRESENTED`, `USER_RESOLVED`, `NOT_HELPFUL`, `ESCALATED`.
Open/click, remaining on article, `HELPFUL`, or score 100 is not resolution.
Only explicit `ISSUE_RESOLVED` confirms v1 deflection; objective verification
is allowed only if already normatively defined. Feedback does not change
ranking weights or Knowledge publication.

On explicit resolution, Ticket creation may be avoided. Otherwise continue
canonical Ticket intake, preserve normalized context and recommendation
attempt/session, and avoid equivalent re-entry. Existing Tickets are never
closed directly; all Ticket transitions use Helpdesk commands. Recommendation
is not an Action Intent/Execution and never calls TASK-091; future remediation
must use TASK-090/TASK-091.

Permissions are `knowledge.recommendation.use`,
`knowledge.recommendation.review`, `knowledge.feedback.submit` or existing
equivalents. Underlying `knowledge.read`, audience, tenant and resource
authorization always applies. Define events `KNOWLEDGE.RECOMMENDATION_CREATED`,
`KNOWLEDGE.RECOMMENDATION_PRESENTED`, `KNOWLEDGE.RECOMMENDATION_SELECTED`,
`KNOWLEDGE.RECOMMENDATION_FEEDBACK`, `KNOWLEDGE.DEFLECTION_CONFIRMED`,
`KNOWLEDGE.RECOMMENDATION_ESCALATED`, and where applicable
`KNOWLEDGE.KNOWN_INCIDENT_DEFLECTION_CONFIRMED`; use references/minimal data,
never article bodies. Stable tenant/request-session identity and
Idempotency-Key prevent duplicate sessions, items, interactions, events and
handoffs. Handle version/access changes before presentation, concurrent
Ticket creation, duplicate feedback and resolution without rewriting history.

Ordinary views use interaction history, not excessive compliance audit.
Audit privileged/manual overrides. Work Queue is only for actionable data
integrity, authorization/audience inconsistency or infrastructure exceptions.
Track sessions, presentations, selections, helpful/not-helpful feedback,
confirmed resolutions, known-incident deflections, escalations, Tickets
avoided and Tickets created after recommendation separately. Click rate is
not deflection rate. Acceptance tests are specified in the detailed TASK-093
contract.
