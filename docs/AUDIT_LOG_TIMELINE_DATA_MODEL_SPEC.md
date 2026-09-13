# AUDIT LOG + TIMELINE DATA MODEL SPEC
## IT Operations Hub — Immutable Audit History and Operator Timeline Standard

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `SEARCH_INDEXING_SPEC.md`  
**Depends on:**  
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `STATE_MACHINE_MASTER_SPEC.md`
- `PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `DATABASE_STORAGE_BOUNDARY_SPEC.md`

**Purpose:** Define the audit-grade immutable history model and the operator-facing timeline model across all domains. Standardize actor attribution, before/after evidence, reason, correlation, causation, cross-domain linkage, visibility, redaction, retention, immutability, timeline projection, correction handling, and audit query patterns.

---

# 1. Mục tiêu

Hệ thống cần hai loại lịch sử khác nhau:

```text
AUDIT LOG
→ bằng chứng kỹ thuật/compliance
→ immutable
→ đầy đủ
→ có before/after
→ có actor
→ phục vụ điều tra, pháp lý, kiểm toán

TIMELINE
→ lịch sử dễ đọc cho operator
→ ngắn gọn
→ liên kết xuyên domain
→ tập trung vào sự kiện có ý nghĩa
```

Không được dùng một bảng duy nhất cho cả hai mục đích.

Chuỗi chuẩn:

```text
Business Action
→ Domain Transaction
→ Domain Event
→ Audit Record
→ Timeline Projection
```

Mục tiêu:

- mọi thay đổi nhạy cảm phải truy được ai làm, khi nào, vì sao;
- history không bị ghi đè;
- timeline không spam bởi low-level event;
- operator nhìn một Asset/Ticket/Incident có thể hiểu toàn bộ lịch sử quan trọng;
- cross-domain action có cùng `correlation_id`;
- audit evidence có thể liên kết document/attachment;
- redaction không phá integrity;
- audit access bản thân cũng được audit;
- correction tạo record mới, không sửa record cũ.

---

# 2. Core Concepts

```text
AUDIT EVENT
DOMAIN EVENT
TIMELINE EVENT
EVIDENCE
ACTOR
SUBJECT
CORRELATION
CAUSATION
VISIBILITY
REDACTION
RETENTION
IMMUTABILITY
CORRECTION
SNAPSHOT
```

---

# 3. Audit vs Domain Event vs Timeline

## Domain Event

```text
Hệ thống thông báo một business fact đã xảy ra.
```

Ví dụ:

```text
ASSET.ASSIGNED
```

## Audit Event

```text
Bằng chứng đầy đủ về ai/điều gì đã thay đổi.
```

Ví dụ:

```text
Actor: usr-18
Command: ASSET.ASSIGN
Before: Available / no owner
After: In Use / user-42
Reason: New employee assignment
```

## Timeline Event

```text
Bản mô tả dễ đọc cho operator.
```

Ví dụ:

```text
"Thiết bị được bàn giao cho Nguyễn Văn An"
```

---

# 4. Core Principle

```text
Domain Event ≠ Audit Event ≠ Timeline Event
```

Một business action có thể sinh cả ba.

---

# 5. Audit Event Requirements

Audit-grade record phải trả lời được:

```text
WHAT happened?
WHO did it?
WHEN?
WHERE / through what channel?
WHY?
TO WHAT entity?
FROM WHAT state/value?
TO WHAT state/value?
UNDER WHICH workflow/policy?
WHAT evidence exists?
WHAT was the outcome?
```

---

# 6. Canonical Audit Event Model

```yaml
audit_event:
  id:
  event_type:
  event_version:

  occurred_at:
  recorded_at:

  actor:
    type:
    id:
    display_snapshot:

  action:
    command_type:
    operation_id:
    request_id:

  subject:
    entity_type:
    entity_id:
    display_code_snapshot:

  related_entities:
    - type:
      id:
      relation:

  source:
    service:
    channel:
    integration_id:
    source_ip:
    user_agent:

  context:
    tenant_id:
    organization_id:
    site_id:
    department_id:
    workflow_id:
    policy_id:
    approval_request_id:

  correlation_id:
  causation_id:

  reason:
    code:
    text:

  before:
  after:
  changed_fields:

  outcome:
    status:
    error_code:

  evidence:
    document_ids:
    attachment_ids:
    external_refs:

  security:
    classification:
    visibility:
    redaction_state:

  integrity:
    checksum:
    previous_hash:
```

---

# 7. Required Audit Fields

Minimum:

```text
id
event_type
occurred_at
actor.type
subject.entity_type
subject.entity_id
action
correlation_id
outcome
```

For mutation:

```text
before
after
```

where technically and legally appropriate.

---

# 8. Actor Types

```text
USER
SYSTEM
AUTOMATION
INTEGRATION
SERVICE_ACCOUNT
BACKGROUND_JOB
EXTERNAL_USER
UNKNOWN_LEGACY
```

`UNKNOWN_LEGACY` chỉ dùng cho import/history cũ.

---

# 9. Actor Snapshot

Audit record nên giữ snapshot tối thiểu:

```text
display name
username/email if policy allows
role at action time
```

Lý do:

```text
user record có thể đổi tên / archive sau này
```

Không phụ thuộc hoàn toàn vào current user table.

---

# 10. Subject Snapshot

Audit record có thể giữ:

```text
display_code
title/name
```

tại thời điểm event.

Ví dụ:

```text
AST-0042
TCK-2042
PO-2026-0018
```

---

# 11. Before / After Strategy

Không bắt buộc lưu full row.

Preferred:

```text
changed fields only
```

Example:

```json
{
  "before": {
    "lifecycle_state": "AVAILABLE",
    "current_owner_user_id": null
  },
  "after": {
    "lifecycle_state": "IN_USE",
    "current_owner_user_id": "usr-18"
  }
}
```

---

# 12. Before/After Guardrail

Không ghi vào audit:

```text
password
access token
private key
raw secret
full license key
```

Use:

```text
<REDACTED>
secret_ref changed
```

---

# 13. Changed Fields

Canonical representation:

```yaml
changed_fields:
  - field: lifecycle_state
    before: AVAILABLE
    after: IN_USE
  - field: current_owner_user_id
    before: null
    after: usr-18
```

---

# 14. Reason Model

Reason gồm:

```text
reason_code
reason_text
```

Reason code dùng machine logic/reporting.

Reason text là human explanation.

---

# 15. Reason Required Actions

Mandatory reason for:

```text
manual override
asset force state
asset disposal
privileged role grant
network quarantine
high-risk change
invoice exception approval
contract termination
data correction
bulk sensitive export
break-glass access
```

---

# 16. Outcome Model

```text
SUCCESS
REJECTED
FAILED
PARTIAL
COMPENSATED
CANCELLED
```

Rejected authorization/business validation may also be audited when security/operationally relevant.

---

# 17. Successful vs Attempt Audit

Two classes:

```text
ACTION_ATTEMPT
ACTION_COMMITTED
```

Not every failed validation requires audit persistence.

High-risk denied attempt should be retained.

---

# 18. Audit Event Types

Examples:

```text
STATE_CHANGED
ASSIGNMENT_CREATED
ASSIGNMENT_ENDED
PERMISSION_GRANTED
PERMISSION_REVOKED
APPROVAL_DECIDED
LOGIN_SUCCEEDED
LOGIN_FAILED
EXPORT_EXECUTED
DOCUMENT_SIGNED
MANUAL_OVERRIDE
POLICY_CHANGED
RULE_ACTIVATED
DATA_CORRECTED
RECORD_MERGED
```

---

# 19. Mutation Audit Coverage

Must audit:

```text
create
update
state transition
delete/archive
assignment
approval
role grant/revoke
policy changes
automation activation
financial changes
document signing
network changes
security overrides
```

---

# 20. Read Audit Coverage

Not every read needs audit.

Audit reads for:

```text
restricted/security records
sensitive reports
financial exports
personal data exports
secret metadata
break-glass views
```

---

# 21. Export Audit

Store:

```text
who exported
what report/entity scope
filters
format
record count
generated file id
expiration
download events if required
```

---

# 22. Login Audit

Examples:

```text
AUTH.LOGIN_SUCCESS
AUTH.LOGIN_FAILED
AUTH.SESSION_REVOKED
AUTH.MFA_STEP_UP
```

Do not log password/token.

---

# 23. Authorization Audit

High-risk allow/deny decisions:

```yaml
authorization_audit:
  principal:
  action:
  resource:
  result:
  policy:
  reason:
```

---

# 24. Approval Audit

Track:

```text
approval created
step activated
approver resolved
decision
delegation
escalation
expiration
material change invalidation
```

---

# 25. SLA Audit

Track meaningful control events:

```text
SLA started
paused
resumed
breached
met
policy version
```

Not every timer tick.

---

# 26. Automation Audit

Track:

```text
rule version
trigger event
conditions matched
action executed
before/after
verification
rollback
human fallback
```

---

# 27. State Transition Audit

Every protected transition:

```text
from
to
command
actor
reason
version
```

---

# 28. Data Correction Audit

Correction never edits historical audit record.

Instead:

```text
DATA_CORRECTION.CREATED
```

with:

```text
incorrect value
correct value
reason
approver if required
```

---

# 29. Merge Audit

Entity merge:

```text
survivor entity
merged entity
match reasons
actor
references migrated
aliases retained
```

---

# 30. Delete / Archive Audit

Track:

```text
who archived/deleted/anonymized
policy
retention reason
scope
```

---

# 31. Audit Immutability

Audit event:

```text
append-only
```

No UPDATE/DELETE through application API.

Corrections:

```text
new event
```

---

# 32. Database Controls

Recommended:

```text
restricted DB role
append-only table policy
no ordinary UPDATE/DELETE
partition retention via controlled process
```

---

# 33. Tamper Evidence

Optional stronger integrity:

```text
hash chaining
```

Each record:

```text
checksum
previous_hash
```

Useful for regulated environments.

---

# 34. Hash Chain Principle

Hash may include:

```text
event id
timestamp
actor
subject
before/after
previous hash
```

Do not claim cryptographic non-repudiation without proper signing/KMS design.

---

# 35. Audit Signing

Optional:

```text
periodic batch signing
```

using KMS/HSM.

Example:

```text
daily audit partition digest
```

---

# 36. Audit Partitioning

Large table should be partitioned by:

```text
time
```

optionally:

```text
tenant
```

Example:

```text
monthly partitions
```

---

# 37. Audit Retention

Retention by class:

```text
SECURITY
FINANCIAL
ASSET
ACCESS
OPERATIONAL
```

Each organization can configure durations subject to policy/legal needs.

---

# 38. Audit Archive

Old partitions may move to:

```text
immutable object archive
```

Keep:

```text
index/reference
checksum
archive location
```

---

# 39. Audit Query Store

Hot audit history:

```text
relational
```

Cold:

```text
archive
```

Operator timeline should not depend on cold audit queries for every page load.

---

# 40. Audit Classification

Recommended:

```text
INTERNAL
CONFIDENTIAL
RESTRICTED
SECURITY_RESTRICTED
```

---

# 41. Audit Access Permissions

Examples:

```text
audit.read
audit.read_sensitive
audit.export
audit.verify_integrity
audit.manage_retention
```

---

# 42. Audit Access Audit

Access to restricted audit logs itself generates:

```text
AUDIT.LOG_VIEWED
AUDIT.LOG_EXPORTED
```

for high-risk scopes.

---

# 43. Timeline Purpose

Timeline answers:

```text
"What happened to this entity?"
```

not:

```text
"What exactly changed at database field level?"
```

---

# 44. Timeline Event Model

```yaml
timeline_event:
  id:
  primary_entity_type:
  primary_entity_id:

  category:
  event_type:
  title:
  summary:

  occurred_at:

  actor:
    type:
    id:
    display_name:

  related_entities:
    - type:
      id:
      display_code:
      relation:

  source_event_id:
  audit_event_id:
  correlation_id:

  visibility:
  importance:
  icon_hint:
  metadata:
```

---

# 45. Timeline Visibility

```text
PUBLIC_TO_REQUESTER
INTERNAL
RESTRICTED
SYSTEM
```

---

# 46. Timeline Importance

```text
CRITICAL
IMPORTANT
NORMAL
LOW
```

Used for default filtering/collapsing.

---

# 47. Timeline Categories

```text
LIFECYCLE
ASSIGNMENT
LOCATION
HEALTH
INCIDENT
MAINTENANCE
AUDIT
NETWORK
SOFTWARE
LICENSE
PROCUREMENT
DOCUMENT
APPROVAL
COMMUNICATION
SECURITY
AUTOMATION
```

---

# 48. Timeline Projection Principle

Timeline is derived from:

```text
Domain Events
Audit Events
Messages
Documents
Workflow milestones
```

Projection should be rebuildable.

---

# 49. Timeline Event Examples — Asset

```text
Asset received into Hanoi Warehouse
Asset tag AST-0042 printed
Reserved for Nguyễn Văn An
Assigned to Nguyễn Văn An
Moved to Hanoi / Floor 4
Agent enrolled
Health changed to Warning
Maintenance order MNT-014 created
Sent to vendor repair
Returned from repair
Audit verified location
Warranty expires in 30 days
Retired
Data wipe completed
Disposed by recycling
```

---

# 50. Timeline Event Examples — Ticket

```text
Ticket created via Email
Context enriched with AST-0042
Assigned to Helpdesk L1
Linked to Root Incident INC-102
Waiting for user
User replied
Resolved
User confirmed issue fixed
Closed
```

---

# 51. Timeline Event Examples — Incident

```text
Monitoring critical alert received
Incident created
12 child tickets correlated
Declared Major Incident
Network Team assigned
Mitigation started
Service restored
5-minute stability verification passed
Resolved
Problem candidate created
```

---

# 52. Timeline Event Examples — User

```text
User activated
Asset assigned
Adobe license assigned
Department changed
Role binding updated
Offboarding started
Access revoked
Asset returned
License reclaimed
Offboarding completed
```

---

# 53. Timeline Noise Reduction

Do not project every low-level event.

Suppress:

```text
every heartbeat
every successful sync
every retry
every metric sample
every search indexing event
```

unless relevant to troubleshooting.

---

# 54. Timeline Aggregation

Repeated events can be grouped.

Example:

```text
"Agent went offline 6 times in the last 24h"
```

instead of six separate rows by default.

---

# 55. Expandable Groups

Timeline UI may show:

```text
6 repeated network observations
[Expand]
```

---

# 56. Timeline Correlation Grouping

Events with same:

```text
correlation_id
```

can be grouped as one operation.

Example:

```text
Asset Assignment
├─ reservation released
├─ assignment created
├─ movement created
├─ handover generated
└─ user notified
```

Display by default:

```text
"Asset assigned to Nguyễn Văn An"
```

with expandable technical details.

---

# 57. Timeline Primary Entity

One timeline event has one primary entity.

Can be projected into multiple entity timelines.

Example:

```text
ASSET.ASSIGNED
```

may appear in:

```text
Asset Timeline
User Timeline
Assignment Timeline
```

---

# 58. Timeline Cross-Projection

Use same source event with different presentation.

Asset view:

```text
"Assigned to Nguyễn Văn An"
```

User view:

```text
"Received asset AST-0042"
```

---

# 59. Timeline Localization

Timeline title/summary should use:

```text
template key
variables
locale
```

not permanently store only rendered Vietnamese text if multilingual support required.

---

# 60. Timeline Rendering Contract

Preferred storage:

```yaml
presentation:
  template_key:
  variables:
```

Optional cached rendered text:

```text
title
summary
```

---

# 61. Timeline Evidence

Timeline item may link:

```text
handover document
invoice
photo
repair report
audit evidence
change plan
```

---

# 62. Timeline Actions

Timeline can offer contextual actions when still relevant.

Example:

```text
Warranty expiring
→ Review renewal
```

But action permission must be re-evaluated.

---

# 63. Timeline Filters

Support:

```text
category
date range
actor
workflow
importance
visibility
```

---

# 64. Timeline Search

Within entity:

```text
search timeline text/metadata
```

Useful for long-lived assets.

---

# 65. Timeline Pagination

Cursor by:

```text
occurred_at + id
```

Stable ordering.

---

# 66. Timeline Ordering

Default:

```text
occurred_at DESC
```

Tie-breaker:

```text
id
```

---

# 67. Late-arriving Event

If old event arrives late:

```text
insert based on occurred_at
```

not recorded_at.

Mark optionally:

```text
late_arrival = true
```

---

# 68. Audit Time Fields

Keep both:

```text
occurred_at
recorded_at
```

For external integration:

```text
source_occurred_at
received_at
```

---

# 69. Causation Chain

Example:

```text
MESSAGE.RECEIVED
→ TICKET.CREATED
→ INCIDENT.CREATED
→ ROOT_INCIDENT.CREATED
```

Audit/timeline can expose causal relationship when troubleshooting.

---

# 70. Correlation View

Provide global query:

```text
GET /audit/correlations/{correlation_id}
```

or equivalent internal tooling.

Shows:

```text
all cross-domain events in one operation
```

---

# 71. Workflow View

Audit can group by:

```text
workflow_instance_id
```

Example:

```text
Offboarding Case
```

across Identity/Asset/License/Notification.

---

# 72. Operation View

Group technical retries/actions by:

```text
operation_id
```

Useful for automation/deployment/network action.

---

# 73. Evidence Model

Evidence types:

```text
DOCUMENT
ATTACHMENT
PHOTO
LOG_EXCERPT
EXTERNAL_REFERENCE
SIGNATURE
CHECKSUM
SCAN_REPORT
```

---

# 74. Evidence Integrity

Evidence stores:

```text
document_id/object_key
checksum
captured_at
captured_by/source
```

---

# 75. Evidence Snapshot

When external evidence may later disappear:

```text
capture immutable copy
```

if policy permits/needs it.

---

# 76. External Reference

Example:

```text
Vendor RMA #12345
ERP Payment Ref
Zabbix Event ID
Entra Object ID
```

Audit stores reference, not necessarily external content.

---

# 77. Network Change Audit

Must capture:

```text
target device
port/interface
before config
after config
change request
approver
implementer
verification
rollback if any
```

---

# 78. Data Wipe Audit

Must capture:

```text
asset
wipe method
operator/system
start/end
verification
evidence
result
```

---

# 79. Financial Audit

For PO/Invoice/Contract:

```text
version
amount changes
supplier
approvals
exceptions
documents
```

No destructive overwrite.

TASK-074 audit is append-only and records Invoice submission and duplicate
rejection, every match evaluation and its evidence fingerprint, Match Exception
creation/resolution/acceptance, Invoice approval/rejection, Credit Note
submission/application/rejection, and the corresponding before/after
lifecycle, match and derived credit outcomes. Include actor, tenant, invoice
or Credit Note, PO, relevant POSTED Goods Receipt references, approval
reference, reason code where required, correlation ID and outcome. Keep the
frozen commercial snapshot and prior evaluation evidence addressable; do not
copy full invoice files, bank references or protected tax identifiers into
general audit payloads.

---

# 80. RBAC Audit

Track:

```text
role created/changed
permission changed
binding granted/revoked
scope changed
temporary grant
break-glass
```

---

# 81. Policy Audit

Track changes to:

```text
approval policy
SLA policy
automation rule
notification policy
retention policy
```

with version and reason.

---

# 82. Automation Rule Audit

On activation:

```text
rule version
diff
approver
safety level
owner
```

---

# 83. Audit Diff

For structured config:

```text
field-level diff
```

For large JSON:

```text
JSON Patch / structured diff
```

Avoid storing huge duplicated configs where version references suffice.

---

# 84. Snapshot References

Audit may store:

```text
policy_version
template_version
artifact_version
document_version
```

rather than full content.

---

# 85. Sensitive Data Redaction

Audit immutable does not mean unredactable.

Need controlled redaction model for legal/security requirements.

---

# 86. Redaction Strategy

Do not edit event row destructively if integrity matters.

Use:

```text
redaction overlay
```

or encrypted field key destruction.

---

# 87. Redaction Overlay

```yaml
audit_redaction:
  audit_event_id:
  field_path:
  reason:
  redacted_by:
  redacted_at:
  replacement:
```

Query layer applies overlay.

Original may remain encrypted/restricted according to policy.

---

# 88. Redaction Audit

Redaction itself creates:

```text
AUDIT.REDACTION_APPLIED
```

---

# 89. Anonymization

For user privacy:

```text
display snapshot
email
name
```

may be anonymized where policy requires.

Keep surrogate references if lawful and operationally necessary.

---

# 90. Timeline Redaction

Timeline should refresh/redact derived text when source personal data is anonymized.

---

# 91. Confidential Timeline Events

Security incident timeline may be visible only to:

```text
Security
Incident Manager
authorized Admin
```

---

# 92. Public Ticket Timeline

End user sees only:

```text
public replies
meaningful status changes
request progress
```

Not:

```text
internal notes
security details
operator discussions
```

---

# 93. Internal Notes

Internal note is communication content with:

```text
visibility = INTERNAL
```

It can appear in internal ticket timeline.

Never public timeline.

---

# 94. Timeline and Messages

Message event can produce:

```text
"User replied via Email"
```

while full body remains in message storage.

Timeline stores summary/reference, not duplicate full content.

---

# 95. Timeline and Documents

Document creation may project:

```text
"Handover document generated"
```

with link.

---

# 96. Timeline and Notifications

Do not project every notification delivery.

Project only meaningful:

```text
"Major incident notice sent to 247 affected users"
```

or required acknowledgment.

---

# 97. Timeline and SLA

Project:

```text
SLA breached
```

Maybe:

```text
SLA warning
```

for internal operational timeline.

Do not project every threshold calculation.

---

# 98. Timeline and Approval

Project:

```text
Approval requested from Manager
Approved by ...
Rejected by ...
```

Sensitive approval reason visibility must follow policy.

---

# 99. Timeline and Automation

Project:

```text
"Agent service automatically restarted and verified"
```

instead of low-level retry steps.

Expandable detail may show attempts.

---

# 100. Timeline Projection Rules

Each domain event mapping defines:

```yaml
timeline_mapping:
  source_event_type:
  primary_entity:
  categories:
  template_key:
  importance:
  visibility:
  group_key:
  suppress_if:
```

---

# 101. Timeline Group Key

Example:

```text
correlation_id + operation_type
```

Used for collapsing child side effects.

---

# 102. Timeline Suppression Rules

Suppress:

```text
duplicate retry event
successful index update
heartbeat
cache invalidation
background refresh
```

---

# 103. Timeline Promotion Rules

Promote to IMPORTANT/CRITICAL:

```text
P1 incident
asset missing
data wipe failed
privileged role grant
license overuse
contract termination
automation failed after retries
```

---

# 104. Audit Query Patterns

Must support:

```text
by entity
by actor
by action
by date range
by correlation
by workflow
by policy
by approval
by site/tenant
by outcome
```

---

# 105. Audit Query API

Examples:

```text
GET /audit-events?entity_type=ASSET&entity_id=...
GET /audit-events?actor_id=...
GET /audit-events?correlation_id=...
```

Sensitive endpoint.

---

# 106. Timeline Query API

Examples:

```text
GET /assets/{id}/timeline
GET /tickets/{id}/timeline
GET /users/{id}/timeline
GET /incidents/{id}/timeline
```

---

# 107. Timeline Projection Storage

Recommended:

```text
separate table/read model
```

Example:

```yaml
timeline_events:
  id:
  primary_entity_type:
  primary_entity_id:
  occurred_at:
  category:
  template_key:
  variables_json:
  actor_snapshot_json:
  source_event_id:
  audit_event_id:
  correlation_id:
  visibility:
  importance:
```

---

# 108. Timeline Indexes

Useful:

```text
(primary_entity_type, primary_entity_id, occurred_at DESC)
correlation_id
category
actor_id
```

---

# 109. Audit Indexes

Useful:

```text
(subject_type, subject_id, occurred_at)
actor_id
correlation_id
workflow_id
event_type
occurred_at
```

---

# 110. High-volume Audit Guardrail

Do not audit every telemetry sample.

Audit meaningful business/security changes.

Telemetry belongs in observation/time-series storage.

---

# 111. Audit vs Log Guardrail

Do not dump application logs into audit table.

Examples not audit:

```text
HTTP request debug
SQL query timing
cache miss
GC pause
```

---

# 112. Audit Availability

For high-risk mutation:

```text
audit persistence must be available
```

If not:

```text
fail action
```

when policy requires mandatory audit.

---

# 113. Low-risk Audit Degradation

Some low-risk operational events may buffer temporarily if audit store degraded.

Must have:

```text
durable queue/outbox
```

not silently drop.

---

# 114. Audit Write Transaction

Preferred:

```text
domain mutation
+
audit/outbox reference
```

same local transaction where feasible.

If central audit service async:

```text
outbox guarantees eventual delivery
```

---

# 115. Audit Event Idempotency

Unique:

```text
source_event_id + audit_type
```

or:

```text
audit_event_id
```

Prevents duplicate audit records on event redelivery.

---

# 116. Timeline Projection Idempotency

Unique:

```text
source_event_id + primary_entity
```

unless one source intentionally creates multiple timeline entries.

---

# 117. Late Projection Rebuild

Timeline can be fully rebuilt from:

```text
domain events
audit events
messages/documents
```

depending retention.

---

# 118. Rebuild Checkpoint

Store:

```text
last processed event offset/version
```

---

# 119. Timeline Rebuild Guardrail

Do not delete visible current timeline before rebuilt copy is ready.

Use:

```text
new projection version
→ validate
→ switch
```

for large rebuild.

---

# 120. Audit Archive Integrity Check

Periodic:

```text
verify checksum/hash chain
verify object archive checksum
```

---

# 121. Audit Integrity Failure

Create:

```text
SECURITY/COMPLIANCE Work Item
```

High priority.

---

# 122. Audit Retention Policy Object

```yaml
audit_retention_policy:
  id:
  category:
  hot_days:
  archive_days:
  delete_or_anonymize_after:
  legal_hold_supported:
```

---

# 123. Legal Hold

If required:

```text
prevent scheduled deletion/archive purge
```

for scoped events/documents.

---

# 124. Legal Hold Audit

Track:

```text
who applied
scope
reason
start/end
```

---

# 125. Timeline Retention

Timeline may retain longer/shorter than hot audit depending UX needs.

Since timeline is derived:

```text
can rebuild
```

if source retained.

---

# 126. Audit Export

Export format:

```text
CSV
JSON
PDF summary
```

Sensitive export requires:

```text
audit.export
reason
scope
watermark where useful
expiry
```

---

# 127. Audit Export Integrity

Include:

```text
generated_at
filters
record count
checksum
exporter
```

---

# 128. External Auditor Access

Prefer:

```text
read-only
time-bound
scoped
```

No broad admin role.

---

# 129. Audit Reporting

Examples:

```text
Privileged changes
Manual overrides
Asset disposal history
Permission grants
PO approval trail
Failed automation
Data corrections
```

---

# 130. Timeline UX — Asset Workspace

Default groups:

```text
Today
This Week
Older
```

Show high-value categories first.

Filters:

```text
All
Assignments
Maintenance
Audit
Network
Software
Documents
```

---

# 131. Timeline UX — Ticket

Default:

```text
Conversation + meaningful workflow milestones
```

Internal-only staff can toggle:

```text
System Events
Automation
SLA
```

---

# 132. Timeline UX — Incident

Focus:

```text
detection
correlation
assignment
major declaration
communications
mitigation
recovery
verification
resolution
```

---

# 133. Timeline UX — User

Focus:

```text
identity lifecycle
role changes
asset assignment/return
license assignment/reclaim
access reviews
offboarding
```

---

# 134. Current State vs Timeline

Current state comes from canonical/read model.

Timeline answers historical progression.

Do not derive current critical state by scanning timeline at request time.

---

# 135. Timeline Snapshot vs Live Entity Name

Historical event should preserve:

```text
snapshot display name/code
```

but UI may also link current entity.

Example:

```text
Assigned to "Nguyễn Văn An" (snapshot)
```

even if user's display name later changes.

---

# 136. Relation History

Audit should preserve historical relationship:

```text
old owner
old location
old approver
old team
```

---

# 137. Cross-domain Timeline Example — Asset Repair

```text
10:02 Ticket TCK-2021 linked to AST-0042
10:08 Maintenance MNT-81 created
10:15 Asset lifecycle changed IN_USE → REPAIR
10:20 Loan asset AST-0098 assigned
13:40 Part replaced
14:10 Verification passed
14:20 Asset lifecycle REPAIR → IN_USE
14:25 Original assignment restored
14:30 Loan asset return requested
14:32 Ticket resolved
```

One asset workspace can show cross-domain history without operator navigating modules.

---

# 138. Cross-domain Timeline Example — Offboarding

```text
Termination received
Session revoked
Privileged role removed
Asset return task created
Adobe license reclaim pending
Laptop returned
License reclaimed
Service ownership transferred
Clearance completed
User terminated
```

---

# 139. Correlated Timeline Summary

For complex operation:

```text
Offboarding completed
```

can be top-level summary with expandable 12 child events.

---

# 140. Timeline Child Event Model

Optional:

```text
parent_timeline_event_id
```

for grouping.

---

# 141. Timeline Rendering Stability

Template changes should not unexpectedly rewrite historical meaning.

Options:

```text
store template version
```

or store rendered snapshot.

Recommended:

```text
template_key + template_version + variables + cached rendered text
```

---

# 142. Timeline Localization History

If rendered snapshot is localized:

```text
keep semantic variables
```

so UI can re-render another locale where desired.

---

# 143. Timeline Source Priority

Preferred:

```text
canonical domain event
```

over duplicative:

```text
notification event
```

for same business action.

---

# 144. Duplicate Timeline Prevention

Dedupe key:

```text
source_event_id + primary_entity_id + presentation_type
```

---

# 145. Timeline Correction

If timeline projection wrong due template/data bug:

```text
rebuild/correct projection
```

No need to alter immutable audit source.

---

# 146. Audit Correction

If audit payload itself contains incorrect non-security metadata:

```text
add correction event
```

never silently overwrite.

---

# 147. Imported Historical Data

Legacy import should mark:

```text
source = LEGACY_IMPORT
actor = UNKNOWN_LEGACY if unavailable
confidence
import_batch_id
```

---

# 148. Imported Timeline

Legacy history can be projected with:

```text
"Imported historical record"
```

and visual distinction.

---

# 149. Audit Confidence

For inferred observations:

```text
confidence
```

may be relevant.

For committed business actions:

```text
confidence = not applicable
```

---

# 150. Evidence Confidence

Observation-derived audit exception can store:

```text
source confidence
```

Example:

```text
QR = 100%
Network inference = 80%
Wi-Fi location = 60%
```

---

# 151. Timeline and Observation

Do not show raw every observation.

Show only state-changing/exception-generating observations.

---

# 152. Audit and Observation

Observation may be stored in specialized observation store.

Audit stores:

```text
decision based on observation
```

plus evidence reference.

---

# 153. Timeline Performance

Do not join 20 domain tables live.

Use projection/read model.

---

# 154. Timeline Cache

Can cache recent timeline pages.

Must invalidate on new timeline event.

Cache not authoritative.

---

# 155. Audit Performance

Large audit queries should require:

```text
date range
entity
actor
```

or use analytics/archive query path.

---

# 156. Audit Full-text Search

Index selected safe fields:

```text
reason
event type
display code
actor
```

Do not full-text index secrets or restricted payload indiscriminately.

---

# 157. Audit Search Permissions

Search result snippets/counts must respect audit permissions.

---

# 158. Audit API Pagination

Use cursor:

```text
occurred_at + id
```

not offset for large histories.

---

# 159. Audit Export Async

Large export:

```text
202 Accepted
→ Report/Export Job
→ Object Storage
→ Signed URL
```

---

# 160. Audit Export Retention

Generated file expires.

Audit metadata remains.

---

# 161. Timeline Notification

Timeline creation itself should not normally trigger notification.

Notification depends on business event/policy.

---

# 162. Audit Event → Work Queue

Only if audit system identifies actionable issue:

```text
integrity failure
manual override anomaly
repeated privilege denial
unexpected admin action
```

---

# 163. Audit Metrics

Track:

```text
audit events/day
high-risk changes
manual overrides
privileged grants
denied sensitive actions
audit delivery lag
integrity verification failures
archive lag
```

---

# 164. Timeline Metrics

Track:

```text
projection lag
timeline build failures
duplicate suppression
average timeline query latency
```

---

# 165. Audit SLO

Example:

```text
High-risk audit record persisted before command success response
or durable outbox committed in same transaction
```

Async audit projection lag:

```text
< 60s
```

configurable.

---

# 166. Timeline SLO

Example:

```text
new important event visible < 10s
```

for operational entities.

---

# 167. Failure Handling — Audit

If audit sink fails:

```text
outbox retry
```

For mandatory audit action:

```text
command may fail if durable audit cannot be guaranteed
```

---

# 168. Failure Handling — Timeline

If timeline projector fails:

```text
business action succeeds
timeline retries
```

Timeline can rebuild later.

---

# 169. Audit DLQ

Audit event in DLQ is high priority.

Need:

```text
dedicated Work Item
```

if beyond threshold.

---

# 170. Timeline DLQ

Timeline projection DLQ:

```text
medium operational priority
```

unless critical workspace history unavailable.

---

# 171. Multi-Tenant Audit Isolation

Every audit event:

```text
tenant_id
organization_id
```

Tenant boundary first.

---

# 172. Cross-Tenant Platform Support Audit

Platform support access must include:

```text
support session
tenant context
reason
duration
actions
```

---

# 173. Break-glass Audit

Must record:

```text
identity
MFA/reauth
reason
scope
start/end
resources accessed
actions performed
review outcome
```

---

# 174. Service Account Audit

Record:

```text
service account
owner
integration
action
scope
```

Not just generic SYSTEM actor.

---

# 175. Automation Actor Audit

Actor:

```text
AUTOMATION:<rule-id>
```

Store:

```text
rule version
creator/owner reference
```

---

# 176. Approval Delegation Audit

Record:

```text
delegator
delegate
scope
validity
reason
decision made under delegation
```

---

# 177. SLA Pause Audit

Pause requires:

```text
reason code
actor/system
policy
started_at
resumed_at
```

---

# 178. Manual SLA Adjustment

If supported:

```text
special permission
reason
before/after
approval if policy requires
```

---

# 179. Timeline Security Event

Security-sensitive event may appear as:

```text
"Security action performed"
```

for general operator, while full details are restricted.

---

# 180. Redacted Timeline Template

Support:

```text
full internal template
safe generic template
```

based on viewer permission.

---

# 181. Timeline Viewer Context

Renderer evaluates:

```text
viewer role
resource scope
visibility
classification
```

before exposing variables.

---

# 182. Audit Viewer Context

Audit API can return redacted payload depending permission.

Raw unrestricted payload should be rare.

---

# 183. Evidence Access

Timeline may show evidence link only if viewer authorized to document/evidence.

---

# 184. Evidence Missing

If referenced evidence was archived:

```text
show archived
```

with authorized restore action.

---

# 185. Immutable Signed Evidence

Signed handover/wipe certificates:

```text
document version immutable
checksum recorded in audit
```

---

# 186. Audit Source-of-Truth

Audit event is authoritative for:

```text
historical evidence of action
```

but not necessarily current business state.

---

# 187. Timeline Source-of-Truth

Timeline is never canonical business truth.

It is an operator projection.

---

# 188. Reconciliation — Audit vs Domain State

Periodic checker can sample:

```text
state transition exists
→ corresponding audit record exists
```

for high-risk domains.

---

# 189. Missing Audit Record

If committed high-risk state exists without expected audit:

```text
AUDIT_GAP
```

Create critical compliance work item.

---

# 190. Duplicate Audit Record

Dedupe by:

```text
source_event_id
event_type
subject
```

Keep ingestion idempotent.

---

# 191. Audit Chain Across Compensation

Example:

```text
VLAN change committed
verification failed
rollback executed
```

Audit shows all three facts.

Do not replace original change with final state only.

---

# 192. Timeline Chain Across Compensation

Operator timeline may show:

```text
VLAN changed
Verification failed
Rolled back to VLAN 20
```

---

# 193. Timeline Chain Across Retry

Successful retries can be collapsed:

```text
Deployment succeeded after 2 retries
```

Expand for diagnostics.

---

# 194. Audit Chain Across Retry

Audit/operation log retains:

```text
attempt 1 failed
attempt 2 failed
attempt 3 succeeded
```

where operational evidence matters.

---

# 195. Audit Data Model Tables

Recommended logical tables:

```text
audit_events
audit_event_changes
audit_event_relations
audit_evidence_links
audit_redactions
audit_integrity_batches
audit_archive_refs
```

---

# 196. Timeline Data Model Tables

Recommended:

```text
timeline_events
timeline_event_relations
timeline_projection_checkpoints
timeline_projection_dlq
```

---

# 197. Audit Event Relation

```yaml
audit_event_relations:
  audit_event_id:
  related_entity_type:
  related_entity_id:
  relation_type:
```

---

# 198. Audit Evidence Link

```yaml
audit_evidence_links:
  audit_event_id:
  evidence_type:
  evidence_id:
  checksum:
  relation:
```

---

# 199. Audit Integrity Batch

```yaml
audit_integrity_batch:
  id:
  period_start:
  period_end:
  event_count:
  root_hash:
  signature_ref:
  created_at:
```

Optional advanced feature.

---

# 200. Timeline Projection Checkpoint

```yaml
timeline_projection_checkpoint:
  projector:
  partition:
  last_event_offset:
  last_event_id:
  updated_at:
```

---

# 201. MVP Audit Scope

Implement first:

```text
Asset assignment/return
Ticket state
Incident state
Approval decision
RBAC changes
Asset lifecycle
Maintenance
Manual override
Document generation/signing
User lifecycle
```

---

# 202. MVP Timeline Scope

Implement:

```text
Asset Timeline
Ticket Timeline
Incident Timeline
User Timeline
```

with:

```text
assignment
state
messages
maintenance
incident links
documents
approval milestones
```

---

# 203. Phase 2

Add:

```text
Network
Software
License
Audit
Change
Warranty
Automation
Cross-domain correlation grouping
```

---

# 204. Phase 3

Add:

```text
Tamper-evident hash chains
batch signing
advanced redaction overlays
legal hold
cold archive query
auditor portal
```

---

# 205. Implementation Flow Example — Asset Assignment

```text
POST ASSET.ASSIGN
↓
Authorization passes
↓
Transaction:
- Assignment created
- Movement created
- Asset state updated
- Audit source/outbox committed
↓
ASSET.ASSIGNED event
↓
Audit Event finalized
↓
Timeline Projector
↓
Asset Timeline:
"Assigned to Nguyễn Văn An"

User Timeline:
"Received asset AST-0042"
```

---

# 206. Implementation Flow Example — Privileged Role Grant

```text
Role grant requested
↓
Approval
↓
MFA/Re-auth
↓
Role Binding committed
↓
RBAC.BINDING_CREATED
↓
Restricted Audit Event
↓
User Timeline:
"Privileged access updated"
(full details visible only to authorized viewers)
```

---

# 207. Implementation Flow Example — Automation Failure

```text
Rule triggered
↓
Restart Agent
↓
Retry 2x
↓
Failed
↓
Human fallback Work Item
↓
Audit:
all attempts + rule version

Timeline:
"Automatic agent recovery failed; manual action required"
```

---

# 208. Guardrails

System must not:

1. Use timeline as compliance audit log.
2. Use audit log as operator-facing raw activity feed without filtering.
3. Update/delete audit events through normal application APIs.
4. Store secrets in before/after snapshots.
5. Lose actor identity for service accounts/automation.
6. Treat current user name as historical actor identity without snapshot.
7. Project every telemetry sample into timeline.
8. Show internal notes to requester timeline.
9. Let restricted audit result counts leak through search/facets.
10. Correct historical audit by overwriting old record.
11. Drop high-risk audit event silently on sink failure.
12. Depend on timeline projection for current business state.
13. Allow redaction without its own audit record.
14. Expose evidence without independent authorization.
15. Generate duplicate timeline entries on event redelivery.
16. Let late older event overwrite newer canonical state.
17. Store application debug logs as audit records.
18. Make cross-domain history impossible to correlate due missing correlation IDs.
19. Archive audit without integrity/checksum metadata.
20. Claim tamper-proof guarantees without implementing proper integrity/signing controls.

---

# 209. Recommended Next Spec

Sau Audit Log + Timeline, tài liệu tiếp theo nên là:

```text
MVP + PHASED IMPLEMENTATION PLAN
```

để gom toàn bộ thiết kế hiện có thành kế hoạch build thực tế:

```text
Phase 0 Foundation
Phase 1 Helpdesk + Asset Core
Phase 2 Operations + Monitoring
Phase 3 Audit + Network + Software
Phase 4 Procurement + Contracts
Phase 5 Automation + Intelligence
```

với:

```text
service boundaries
database tables
API endpoints
events
state machines
dependencies
definition of done
migration order
```

---

# 210. Definition of Done

Audit Log + Timeline Spec đạt yêu cầu khi:

- Audit, Domain Event và Timeline được tách rõ.
- Audit event có actor/subject/action/before/after/reason/correlation.
- Audit records append-only.
- High-risk audit persistence có durability guarantee.
- Before/after redacts secrets.
- Correction tạo event mới.
- Restricted read/export access được audit.
- Evidence linkage và checksum rõ.
- Timeline là rebuildable projection.
- Timeline có visibility/importance/category.
- Cross-domain correlation/grouping được hỗ trợ.
- Noise suppression và repeated-event aggregation rõ.
- Asset/Ticket/Incident/User timeline được định nghĩa.
- Redaction/anonymization/legal-hold path có chỗ mở rộng.
- Audit archive/partition/retention/integrity strategy rõ.
- Idempotency cho Audit và Timeline projection rõ.
- MVP → Phase 3 implementation path được xác định.

---

# 211. TASK-074 Invoice and Credit Note Audit / Timeline

Append audit evidence for Invoice submission and duplicate rejection, every
match evaluation, Match Exception creation/resolution/acceptance, Invoice
approval/rejection, and Credit Note submission/application/rejection. Include
actor, tenant, invoice or Credit Note, PO, relevant POSTED Goods Receipt
references, before/after lifecycle and match state, derived credit outcome,
approval reference, reason code where required, correlation ID and outcome.
Keep immutable snapshots and previous match evaluations addressable.

Do not put full invoice files, bank references, protected tax identifiers or
unnecessary financial line values into broad audit/event payloads. Evidence is
linked by protected document/reference IDs.

Timeline remains a derived operator view and may show:

```text
Invoice INV-123 submitted for PO-456
Invoice INV-123 matched successfully
Invoice INV-123 pending additional Goods Receipt
Invoice INV-123 has a price mismatch
Match exception approved; match evidence remains mismatched
Credit Note CN-17 applied to Invoice INV-123
```

Timeline projections are rebuildable and never become Invoice, match,
allocation or Credit Note source of truth.

---

# 212. TASK-075 Contract, Renewal and Commercial Document Audit / Timeline

Append audit evidence for Contract creation and material draft updates,
signature submission/recall, execution evidence recording, activation,
hold/resume, amendment, expiry, termination/cancellation, Renewal Case
decisions, approval use and Commercial Document finalization/supersession.
Preserve actor, tenant, Contract/Renewal Case/document IDs, immutable
ContractVersion, before/after lifecycle and usage status, reason, linked
approval reference, evidence document-version references, correlation ID and
outcome. Audit remains append-only; an amendment or successor renewal adds
history and never overwrites the predecessor's evidence.

Timeline is a derived operator view and may show submission for signature,
execution, activation, hold/resume, amendment version, renewal opened or
completed, not-renewed decision, expiry, early termination and document
finalization/supersession. Display protected references only, not document
bytes or unrestricted commercial terms. Derived `EXPIRING` alerts use
explicit notice/end-date terms and must not mutate Contract lifecycle.

---

# 213. TASK-076 Contract Alert and Cost Provenance Audit

Append audit evidence for material Contract renewal-alert configuration
changes, renewal/expiry action due facts, cost provenance creation/source
linkage, Credit Note cost adjustments/corrections, and authorized manual
allocation. Preserve actor/system principal, tenant, Contract and immutable
ContractVersion or target/source IDs, source line/version, trigger identity,
cost basis, amount/currency only where authorized, allocation method,
correlation, outcome and event/Work Item references. Audit is append-only;
correction adds evidence and never rewrites the source transaction.

Timeline and Work Queue are derived/operator-facing. Timeline may state that
a Contract renewal action became due or that a cost source was linked, using
protected references. Do not expose contract terms, raw invoice/document
contents or protected Supplier bank/tax information. Normal successful cost
linkage creates no Work Item. Create actionable work only for configured
renewal action, invalid/missing/ambiguous source, deterministic-allocation
failure, total reconciliation failure or integrity exception. Resolving a
Work Item does not mutate canonical cost provenance.

---

# 214. TASK-090 Rule Evaluation and Action Intent Evidence

Audit rule creation/draft changes, version publication, activation and
deactivation, simulation classification, production evaluation, condition
results, policy decisions, kill-switch blocks, intent creation/deduplication/
conflict and human fallback. Preserve tenant, initiating actor or service
principal, rule id/version, source event reference, evaluation/intent IDs,
target reference, safe action reference, policy outcome/reason, approval
reference/context hash where applicable, before/after, correlation and
causation references. Retain sufficient evidence to explain a non-match as
well as a match. Do not copy unnecessary raw event payload or secrets into
audit.

Audit is append-only. Rule version changes, deactivation, conflict resolution
and later TASK-091 execution results append evidence; they do not rewrite an
earlier evaluation or Action Intent explanation.

Explicit human conflict resolution records the resolver, reason, chosen
compatible intent set and resulting eligibility decision. It cannot override
policy DENY, required approval, target permission or kill-switch state.

TASK-090-R1 additionally requires append-only evidence for Action Capability
selection, tenant Action Policy creation/version/activation/deactivation,
principal resolution, permission and resource-scope authorization, approval
binding, and explicit blocked-intent policy re-evaluation. Record policy
id/version, capability id/version, service-principal reference, permission,
scope reference, policy and authorization decisions, safe reason code, actor,
tenant, target reference and correlation. Do not place raw scope selectors,
secrets, sensitive event payloads or executable parameters in broad
audit/timeline records. Authorization grant changes remain owned and audited
by the canonical Authorization domain. Policy changes append new evidence and
never rewrite earlier decisions.

Timeline may show rule publication/activation and operator-relevant blocked,
conflicted or ready-intent milestones using protected references. It is a
derived view and does not replace the audit/evaluation ledger. Normal
successful evaluation need not create a Work Item; an unresolved conflict or
other actionable human fallback is linked to one idempotent Work Item.

---

# 215. TASK-091 Action Execution Audit and Timeline

Append execution audit evidence for attempt creation, claim, pre-dispatch
security recheck, dispatch, authenticated Agent acceptance, verification,
terminal outcome, cancellation and manual retry. Preserve tenant, intent,
execution and command IDs, exact rule/version and capability references,
target Agent, `SYSTEM_AUTOMATION` principal, policy version/decision,
permission/resource-scope result, approval reference, conflict and
kill-switch results, pre-execution runtime baseline reference, dispatch and
acceptance times, verification evidence, actor/reason, correlation, outcome
and Work Item reference. Never record Agent credentials/secrets or arbitrary
command bodies.

Audit is append-only; retries create linked new execution rows and never
rewrite an earlier `FAILED` or `UNKNOWN` result. Agent command dedupe/receipt
and runtime evidence are referenced from Automation audit, while Agent
identity/authentication remains owned by the Agent domain.

Timeline may show command dispatched/accepted, verified Agent restart,
deterministic failure, unknown result requiring reconciliation, cancellation
before acceptance, and authorized manual retry. It is derived/operator-facing
and cannot assert success from dispatch/acceptance alone. `UNKNOWN`, timeout,
security failure requiring operator review and manual retry review create at
most one actionable Work Item per terminal execution. Resolving a Work Item
does not mutate execution state; explicit reconciliation/retry commands do.

## TASK-092 Incident Correlation Audit and Timeline

Audit automatic links, manual attach, reviewer rejection, detach,
deterministic Root creation and detach-suppression creation/override as
append-only evidence. Preserve tenant, actor or `SYSTEM_CORRELATION`, child
Incident, Root, relationship and decision IDs, algorithm/profile version,
confidence, reason, evidence references, correlation ID and outcome. Never
overwrite the original machine decision after a human action or profile
change. Do not include raw monitoring/topology payloads when references are
sufficient.

Timeline may render automatic link/confidence, review-required candidate
ambiguity, operator detach, and manual override/attach as readable derived
entries. Timeline is not relationship authority. Successful automatic links
and ordinary NO_LINK do not create Work Items; one unresolved
REVIEW_REQUIRED decision may own at most one actionable Work Item.

---

## TASK-093 Recommendation Interaction, Audit and Timeline

Ordinary recommendation presentation, article opening and feedback use
interaction history; they do not require excessive compliance audit. Audit
privileged/manual overrides where applicable, preserving actor, tenant,
session/item, exact Knowledge version, reason, correlation and outcome.
Ticket timeline may show a recommendation attempt, authorized Knowledge
reference/version, not-helpful feedback and Ticket creation after unsuccessful
self-service. Timeline is derived, not interaction authority. Recheck viewer
authorization before exposing a Knowledge reference. Never reveal inaccessible
title, snippet or existence, and do not store full article bodies, credentials
or protected telemetry in broad audit, events or timeline.
