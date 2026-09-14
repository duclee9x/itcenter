# EVENT CATALOG + EVENT PAYLOAD CONTRACT
## IT Operations Hub — Event Bus Specification

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`  
**Depends on:**  
- `SYSTEM_WORKFLOW_INDEX_TRACEABILITY_MATRIX.md`
- `APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`

**Purpose:** Define canonical event names, event envelopes, payload contracts, producer/consumer ownership, ordering, idempotency, correlation, retry, dead-letter behavior, schema evolution, observability, and cross-domain event integration.

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa Event Bus cho toàn bộ IT Operations Hub.

Mỗi event phải trả lời được:

```text
Event là gì?
Ai phát?
Ai sở hữu sự thật đó?
Aggregate nào thay đổi?
Payload tối thiểu là gì?
Event có thể phát lại không?
Consumer chống duplicate thế nào?
Ordering có quan trọng không?
Retry bao nhiêu lần?
Khi lỗi đi đâu?
Schema version thay đổi thế nào?
```

Mục tiêu chính:

- event name nhất quán;
- producer ownership rõ;
- consumer không phụ thuộc implementation nội bộ của producer;
- event envelope dùng chung;
- mọi event có `event_id`, `correlation_id`, `causation_id`;
- consumer xử lý idempotent;
- retry không tạo side effect trùng;
- ordering chỉ đảm bảo ở nơi thật sự cần;
- schema evolution backward-compatible;
- event không chứa secret;
- audit/debug được chuỗi E2E;
- hỗ trợ outbox/inbox pattern;
- có DLQ/replay policy rõ.

---

# 2. Event Architecture Principle

```text
Business Command
↓
Domain Transaction
↓
State Updated
↓
Outbox Event Written
↓
Event Published
↓
Consumers
├─ Workflow
├─ Notification
├─ Reporting
├─ Search Index
├─ Timeline
├─ Automation
└─ Integration
```

Event không phải là command.

Ví dụ:

```text
Command:
AssignAsset

Event:
ASSET.ASSIGNED
```

Consumer không được dùng event để "yêu cầu" producer thực hiện hành động đã xảy ra.

---

# 3. Event Naming Convention

Recommended pattern:

```text
DOMAIN.ENTITY.ACTION
```

Ví dụ:

```text
ASSET.ASSIGNMENT.CREATED
INCIDENT.ROOT.CREATED
LICENSE.ASSIGNMENT.RECLAIMED
CONTRACT.RENEWAL_OPENED
```

Đối với event đơn giản có thể dùng:

```text
TICKET.CREATED
USER.TERMINATED
SLA.BREACHED
```

Nguyên tắc:

- uppercase;
- dot-separated;
- action ở thì quá khứ hoặc trạng thái đã xảy ra;
- tránh tên command như `CREATE_TICKET`;
- tránh tên mơ hồ như `UPDATED` nếu có thể cụ thể hơn.

---

# 4. Canonical Event Envelope

Mọi event phải có envelope tối thiểu:

```yaml
event:
  event_id: uuid
  event_type: string
  schema_version: integer

  occurred_at: timestamp
  published_at: timestamp

  producer:
    service:
    instance:

  aggregate:
    type:
    id:
    version:

  actor:
    type:
    id:

  correlation_id:
  causation_id:

  tenant_id:
  organization_id:

  idempotency_key:

  payload:
```

---

# 5. Event Envelope Example

```json
{
  "event_id": "018f8f1d-6f7e-7a30-ae45-20c2f4e92c11",
  "event_type": "ASSET.ASSIGNED",
  "schema_version": 1,
  "occurred_at": "2026-09-11T02:15:24Z",
  "published_at": "2026-09-11T02:15:24Z",
  "producer": {
    "service": "asset-service",
    "instance": "asset-service-3"
  },
  "aggregate": {
    "type": "ASSET",
    "id": "018f8f1d-5aa2-7c31-a0db-181234567890",
    "version": 17
  },
  "actor": {
    "type": "USER",
    "id": "018f8f1d-1b92-7b44-9021-111111111111"
  },
  "correlation_id": "corr-8b943",
  "causation_id": "cmd-assign-1204",
  "tenant_id": "tenant-main",
  "organization_id": "org-vn",
  "idempotency_key": "assignment:AST-0042:v17",
  "payload": {
    "asset_id": "018f8f1d-5aa2-7c31-a0db-181234567890",
    "assignment_id": "018f8f1d-7712-7c31-a0db-181234567891",
    "user_id": "018f8f1d-2ab2-7c31-a0db-181234567892"
  }
}
```

---

# 6. Required Envelope Fields

| Field | Required | Purpose |
|---|---|---|
| `event_id` | Yes | Global event uniqueness |
| `event_type` | Yes | Routing/semantic identity |
| `schema_version` | Yes | Payload evolution |
| `occurred_at` | Yes | Business time |
| `published_at` | Yes | Delivery timing |
| `producer.service` | Yes | Ownership/debug |
| `aggregate.type` | Yes | Aggregate routing |
| `aggregate.id` | Yes | Partition/order |
| `aggregate.version` | Recommended | Concurrency/order |
| `actor.type` | Yes | User/Agent/System/Integration |
| `actor.id` | Conditional | May be null for system |
| `correlation_id` | Yes | E2E tracing |
| `causation_id` | Yes | Immediate cause |
| `tenant_id` | Conditional | Multi-tenant boundary |
| `idempotency_key` | Recommended | Consumer dedupe |
| `payload` | Yes | Domain data |

---

# 7. Actor Types

```text
USER
AGENT
SYSTEM
AUTOMATION
INTEGRATION
BACKGROUND_JOB
SERVICE_ACCOUNT
EXTERNAL_USER
```

`AGENT` identifies an enrolled endpoint agent authenticated at the Agent
Gateway. It is distinct from a human user and is used for agent-originated
deployment claim and result facts.

Không dùng:

```text
UNKNOWN
```

trừ trường hợp legacy import và phải có reason/source.

---

# 8. Correlation vs Causation

## correlation_id

Theo toàn bộ chuỗi nghiệp vụ.

Ví dụ:

```text
User Ticket
→ Incident
→ Problem
→ Change
```

có thể dùng cùng correlation family.

## causation_id

Chỉ event/command trực tiếp gây ra event hiện tại.

Ví dụ:

```text
TICKET.CREATED
caused by
MESSAGE.RECEIVED
```

---

# 9. Aggregate Version

Mỗi event domain có thể mang:

```text
aggregate.version = N
```

Consumer có thể detect:

```text
received version 18
last processed version 16
```

→ version 17 missing.

Không phải mọi read-model consumer đều cần block khi thiếu version, nhưng stateful consumer phải có policy.

---

# 10. Event Categories

```text
DOMAIN_EVENT
INTEGRATION_EVENT
SYSTEM_EVENT
CONTROL_EVENT
OBSERVATION_EVENT
AUDIT_EVENT
```

## DOMAIN_EVENT

Business state đã thay đổi.

## INTEGRATION_EVENT

External integration input/output.

## SYSTEM_EVENT

Platform/infrastructure state.

## CONTROL_EVENT

Approval/SLA/Automation.

## OBSERVATION_EVENT

Monitoring/Agent/Network observation.

---

# 11. Event Retention Classes

Suggested:

```text
SHORT
STANDARD
LONG
AUDIT
```

Example:

```text
High-frequency observation → SHORT
Business domain event → STANDARD/LONG
Approval decision → AUDIT
Financial event → AUDIT
```

---

# 12. Topic Strategy

Logical topics:

```text
identity.events
helpdesk.events
incident.events
asset.events
maintenance.events
audit.events
network.events
software.events
license.events
procurement.events
contract.events
control.events
communication.events
system.events
```

Alternative:

```text
single event stream + event_type routing
```

Implementation may vary.

---

# 13. Partition Key Strategy

Recommended partition key:

```text
aggregate_id
```

Benefits:

```text
same aggregate
→ ordered partition
```

Examples:

```text
Asset events partition by asset_id
Ticket events partition by ticket_id
Incident events partition by incident_id
```

---

# 14. Ordering Guarantees

Do not assume global ordering.

Expected:

```text
ordering per aggregate/partition
```

Possible:

```text
ASSET.CREATED
→ ASSET.ASSIGNED
→ ASSET.RETURNED
```

Global cross-domain order:

```text
best effort
```

Use `occurred_at`, `causation_id`, `aggregate.version`.

---

# 15. Outbox Contract

Producer transaction:

```text
1. update domain state
2. insert outbox row
3. commit
```

Publisher later:

```text
read outbox
→ publish
→ mark published
```

Never:

```text
DB commit
then publish manually
```

without outbox if event reliability matters.

---

# 16. Inbox Contract

Consumer stores:

```text
consumer_name
event_id
processed_at
result
```

Unique:

```text
(consumer_name, event_id)
```

If same event redelivered:

```text
skip side effect
return success
```

---

# 17. Delivery Semantics

Assume:

```text
AT_LEAST_ONCE
```

therefore:

```text
consumer must be idempotent
```

Do not design based on exactly-once assumption.

---

# 18. Retry Policy

Transient failure:

```text
retry with exponential backoff
```

Example:

```text
1m
5m
15m
1h
```

Configurable by consumer class.

---

# 19. Non-retryable Errors

Examples:

```text
schema invalid
unauthorized payload
unsupported schema version
business invariant impossible
```

Route:

```text
DLQ
```

not infinite retry.

---

# 20. Dead Letter Queue

DLQ record should include:

```yaml
dlq_record:
  event:
  consumer:
  error_code:
  error_message:
  attempts:
  first_failed_at:
  last_failed_at:
```

Operator can:

```text
inspect
replay
discard with reason
```

---

# 21. Replay

Replay must preserve original:

```text
event_id
occurred_at
correlation_id
causation_id
```

Add transport metadata separately:

```text
replayed_at
replay_batch_id
```

Do not generate a new domain event ID just because message is replayed.

---

# 22. Event Schema Evolution

Every payload carries:

```text
schema_version
```

Rules:

```text
v1 → v2
```

prefer:

```text
add optional field
add enum value
add nested object
```

avoid:

```text
rename/remove required field
change semantic meaning silently
```

---

# 23. Breaking Schema Change

If unavoidable:

```text
new schema version
```

Consumers declare supported versions.

Example:

```text
ASSET.ASSIGNED v1
ASSET.ASSIGNED v2
```

---

# 24. Event Payload Principle

Payload should include enough for common consumers, but not entire aggregate dump.

Good:

```text
entity IDs
state changes
key context
```

Avoid:

```text
full database row
all PII
all internal metadata
```

---

# 25. Sensitive Data Rules

Do not include:

```text
password
access token
refresh token
private key
raw secret
full payment card
```

Use references:

```text
secret_ref
document_id
credential_ref
```

---

# 26. PII Minimization

Use IDs instead of copying personal details where possible.

Example:

```text
user_id
```

rather than:

```text
full address
personal phone
manager chain
```

unless consumer truly requires.

---

# 27. Common State Change Payload

Recommended:

```yaml
state_change:
  previous:
  current:
  reason:
```

Example:

```json
{
  "previous": "AVAILABLE",
  "current": "IN_USE",
  "reason": "ASSIGNMENT_COMPLETED"
}
```

---

# 28. Identity Event Catalog

## `USER.CREATED`

Producer:

```text
identity-service
```

Consumers:

```text
asset-service
notification-service
reporting-service
workflow-service
```

Payload:

```yaml
user_id:
employment_status:
department_id:
manager_user_id:
location_id:
source:
```

---

## `USER.UPDATED`

Payload should include changed fields:

```yaml
user_id:
changed_fields:
  department_id:
    previous:
    current:
  location_id:
    previous:
    current:
```

Do not publish full user object by default.

---

## `USER.ACTIVATED`

```yaml
user_id:
activated_at:
source:
```

---

## `USER.SUSPENDED`

```yaml
user_id:
reason:
effective_at:
```

---

## `USER.TERMINATING`

```yaml
user_id:
effective_at:
termination_source:
offboarding_case_id:
```

---

## `USER.TERMINATED`

```yaml
user_id:
terminated_at:
offboarding_case_id:
clearance_state:
```

Consumers:

```text
asset
license
notification
reporting
search
```

---

## Offboarding Case Events

These events are produced by Identity after the corresponding Offboarding Case
transaction commits. The common event envelope carries `correlation_id`,
`causation_id`, actor, tenant, aggregate version, and idempotency key. Payloads
contain identifiers and state facts only; they do not publish the full User
record. `case_version` is the committed Offboarding Case version.

### `OFFBOARDING.CREATED`

```yaml
offboarding_case_id:
user_id:
case_version: 1
user_version:
state: INITIATED
pre_offboarding_user_state:
termination_request_id:
reason:
created_at:
```

### `OFFBOARDING.STARTED`

```yaml
offboarding_case_id:
user_id:
case_version:
user_version:
from_state: INITIATED
to_state: IN_PROGRESS
pre_offboarding_user_state:
termination_request_id:
started_at:
reason:
```

### `OFFBOARDING.BLOCKED`

```yaml
offboarding_case_id:
user_id:
case_version:
from_state: IN_PROGRESS
to_state: BLOCKED
blocking_task_ids: []
reason:
blocked_at:
```

### `OFFBOARDING.RESUMED`

```yaml
offboarding_case_id:
user_id:
case_version:
from_state: BLOCKED
to_state: IN_PROGRESS
resolved_blocker_ids: []
reason:
resumed_at:
```

### `OFFBOARDING.READY_TO_CLOSE`

```yaml
offboarding_case_id:
user_id:
case_version:
from_state: IN_PROGRESS
to_state: READY_TO_CLOSE
termination_request_id:
mandatory_task_summary:
reason:
ready_at:
```

### `OFFBOARDING.CANCELLATION_REQUESTED`

```yaml
offboarding_case_id:
user_id:
case_version:
from_state: [IN_PROGRESS, BLOCKED, READY_TO_CLOSE]
to_state: CANCELLATION_PENDING
termination_request_withdrawal_reference: # required when User is TERMINATING
recovery_action_ids: []
reason:
requested_at:
```

### `OFFBOARDING.CANCELLED`

```yaml
offboarding_case_id:
user_id:
case_version:
user_version:
from_state: [INITIATED, CANCELLATION_PENDING]
to_state: CANCELLED
recovery_dispositions: []
user_lifecycle_state:
reason:
cancelled_at:
```

`user_lifecycle_state` records the observed canonical state after cancellation.
It does not imply a User state transition. Any restoration from `TERMINATING`
to `pre_offboarding_user_state` is a separate validated Identity transition.

### `OFFBOARDING.COMPLETED`

```yaml
offboarding_case_id:
user_id:
case_version:
user_version:
from_state: READY_TO_CLOSE
to_state: COMPLETED
user_lifecycle_state: TERMINATED
termination_request_id:
clearance_summary:
reason:
completed_at:
```

### `OFFBOARDING.RECOVERY_ACTION_UPDATED`

```yaml
case_id:
recovery_action_id:
disposition: # SUCCEEDED, WAIVED, ACCEPTED_EXCEPTION
version:
evidence_reference:
reason:
```

### `OFFBOARDING.CLEARANCE_EXCEPTION_RECORDED`

```yaml
case_id:
clearance_id:
disposition: # WAIVED, ACCEPTED_EXCEPTION
version:
evidence_reference:
reason:
```

---

## `USER.DEPARTMENT_CHANGED`

```yaml
user_id:
previous_department_id:
new_department_id:
effective_at:
```

---

## `USER.LOCATION_CHANGED`

```yaml
user_id:
previous_location_id:
new_location_id:
effective_at:
```

---

## `USER.ROLE_CHANGED`

```yaml
user_id:
role_binding_id:
change_type:
role_id:
scope_type:
scope_id:
```

---

# 29. Authentication Event Catalog

## `AUTH.LOGIN_SUCCESS`

```yaml
user_id:
session_id:
provider_id:
auth_method:
risk_state:
```

Do not include token.

## `AUTH.LOGIN_FAILED`

```yaml
principal_hint:
provider_id:
reason_code:
source_context:
```

Use privacy-safe hint.

## `AUTH.SESSION_REVOKED`

```yaml
user_id:
session_id:
reason:
```

---

# 30. Helpdesk Event Catalog

## `TICKET.CREATED`

Producer:

```text
helpdesk-service
```

Payload:

```yaml
ticket_id:
ticket_code:
requester_user_id:
type:
priority:
state:
service_id:
primary_asset_id:
source_channel:
```

---

## `TICKET.ENRICHED`

```yaml
ticket_id:
resolved_context:
  asset_id:
  service_id:
  location_id:
  agent_state:
  known_incident_id:
```

---

## `TICKET.ASSIGNED`

```yaml
ticket_id:
previous_team_id:
new_team_id:
previous_assignee_id:
new_assignee_id:
```

---

## `TICKET.STATE_CHANGED`

```yaml
ticket_id:
previous_state:
current_state:
reason:
```

---

## `TICKET.RESOLVED`

```yaml
ticket_id:
resolution_code:
resolved_by:
resolved_at:
related_incident_id:
verification:
```

---

## `TICKET.REOPENED`

```yaml
ticket_id:
reason:
reopened_by:
```

---

# 31. Incident Event Catalog

## `INCIDENT.CREATED`

```yaml
incident_id:
incident_code:
priority:
service_id:
source:
```

---

## `INCIDENT.CORRELATED`

```yaml
incident_id:
root_incident_id:
correlation_reason:
correlation_score:
```

---

## `INCIDENT.ROOT.CREATED`

```yaml
incident_id:
priority:
affected_service_ids:
affected_site_ids:
affected_count:
root_cause_candidate:
```

---

## `INCIDENT.MAJOR_DECLARED`

```yaml
incident_id:
declared_by:
reason:
communication_cadence:
```

---

## `INCIDENT.STATE_CHANGED`

```yaml
incident_id:
previous_state:
current_state:
reason:
```

---

## `INCIDENT.RESTORED`

```yaml
incident_id:
restored_at:
verification_status:
stability_window_seconds:
```

---

## `INCIDENT.RESOLVED`

```yaml
incident_id:
resolved_at:
resolution_summary:
problem_candidate_created:
```

---

# 32. Monitoring Event Catalog

## `MONITORING.CRITICAL`

Observation event.

```yaml
monitor_event_id:
source:
asset_id:
service_id:
metric:
observed_value:
threshold:
severity:
observed_at:
```

---

## `MONITORING.RECOVERED`

```yaml
monitor_event_id:
asset_id:
service_id:
recovered_at:
observed_value:
```

---

## `MONITORING.SUPPRESSED`

```yaml
monitor_event_id:
reason:
parent_event_id:
maintenance_window_id:
```

---

# 33. Agent Event Catalog

## `AGENT.ENROLLED`

```yaml
agent_id:
asset_id:
agent_version:
enrolled_at:
```

---

## `AGENT.OFFLINE`

```yaml
agent_id:
asset_id:
last_seen_at:
```

---

## `AGENT.OFFLINE_THRESHOLD`

```yaml
agent_id:
asset_id:
threshold_seconds:
asset_class:
last_seen_at:
```

---

## `AGENT.RECOVERY_STARTED`

```yaml
agent_id:
asset_id:
action:
execution_id:
```

---

## `AGENT.ONLINE`

```yaml
agent_id:
asset_id:
restored_at:
agent_version:
last_seen_at:
agent_runtime_id: # authenticated per-process restart marker; no secrets
agent_session_id: # authenticated connection/session reference; no credentials
```

## `AGENT.AUTOMATION_ACTION_ACCEPTED`

```yaml
agent_id:
command_id:
execution_id:
accepted_at:
```

This fact acknowledges the exact fixed typed Agent command. It does not prove
that the requested action completed successfully.

## `AGENT.AUTOMATION_ACTION_REJECTED`

```yaml
agent_id:
command_id:
execution_id:
reason_code: UNSUPPORTED_CAPABILITY | LOCAL_SAFETY_DENIED | AGENT_BUSY | COMMAND_EXPIRED
```

---

## `AGENT.INVENTORY_SYNCED`

```yaml
agent_id:
asset_id:
dataset:
snapshot_id:
observed_at:
```

Payload should not include giant full inventory.

---

# 34. Asset Event Catalog

## `ASSET.CREATED`

```yaml
asset_id:
asset_code:
asset_model_id:
serial_number:
source:
lifecycle_state:
assignment_state:
current_location_id:
goods_receipt_id: # populated for ASSET.REGISTER_RECEIVED
received_unit_id: # stable receipt-unit identity; populated for receipt registration
```

For `ASSET.REGISTER_RECEIVED`, `source=GOODS_RECEIPT`,
`lifecycle_state=RECEIVED`, `assignment_state=UNASSIGNED`, and
`current_location_id` is the receiving location. This Asset-owned event is
emitted only after registration commits.

---

## `ASSET.TAGGED`

```yaml
asset_id:
asset_tag:
tag_type:
```

---

## `ASSET.STATE_CHANGED`

```yaml
asset_id:
dimension:
previous_state:
current_state:
reason:
```

---

## `ASSET.RESERVED`

```yaml
asset_id:
reservation_id:
request_id:
reserved_for:
expires_at:
```

---

## `ASSET.RESERVATION_EXPIRED`

```yaml
asset_id:
reservation_id:
expired_at:
```

---

## `ASSET.ASSIGNED`

```yaml
asset_id:
assignment_id:
user_id:
location_id:
handover_document_id:
```

---

## `ASSET.TRANSFER_STARTED`

```yaml
asset_id:
movement_id:
from_location_id:
to_location_id:
from_user_id:
to_user_id:
```

---

## `ASSET.TRANSFERRED`

```yaml
asset_id:
movement_id:
new_location_id:
new_user_id:
completed_at:
```

---

## `ASSET.RETURN_REQUESTED`

```yaml
asset_id:
assignment_id:
user_id:
due_at:
reason:
```

## `ASSET.RETURN_REQUEST_CANCELLED`

```yaml
asset_id:
return_request_id:
reason:
offboarding_case_id:
```

---

## `ASSET.RETURNED`

```yaml
asset_id:
return_id:
condition_grade:
received_location_id:
received_at:
```

---

## `ASSET.MISSING`

```yaml
asset_id:
last_known_location_id:
last_seen_at:
offboarding_case_id:
clearance_id:
recovery_state: # MISSING; Asset Risk is not changed
investigation_id:
```

`ASSET.MISSING` records an Offboarding/return recovery determination. It must
not write `asset.risk_state`; canonical Asset Risk is `LOW`, `MEDIUM`, `HIGH`,
`CRITICAL` or `UNKNOWN`.

## `OFFBOARDING.ASSET_RECOVERY_STATE_CHANGED`

```yaml
offboarding_case_id:
asset_id:
clearance_id:
from_state:
state: # PENDING_RETURN, RETURNED, UNRETURNED, MISSING
version:
reason:
correlation_id:
```

`RETURNED` is emitted only after the Asset-owned return request is confirmed
complete. Recovery state changes do not modify Asset Risk, Health, Operational,
Assignment or Lifecycle dimensions.

---

## `ASSET.RETIRED`

```yaml
asset_id:
retirement_record_id:
reason:
retired_at:
```

---

## `ASSET.DISPOSED`

```yaml
asset_id:
disposal_record_id:
method:
disposed_at:
```

---

# 35. Warehouse Event Catalog

## `GOODS.RECEIVING_STARTED`

```yaml
goods_receipt_id:
purchase_order_id:
warehouse_id:
```

## `GOODS.RECEIVED`

`GOODS.RECEIVED` is not the authoritative posted Goods Receipt event.
`GOODS_RECEIPT.POSTED` is the canonical event for the immutable physical
receiving fact; keep any legacy/session notification separate and do not use
it for PO quantities, Asset registration or invoice matching.

## `GOODS.RECEIVING_EXCEPTION`

```yaml
goods_receipt_id:
exception_type:
line_id:
expected:
observed:
```

## `ASSET.PUT_AWAY`

```yaml
asset_id:
movement_id:
warehouse_id:
location_id:
```

---

# 36. Maintenance Event Catalog

## `MAINTENANCE.CREATED`

```yaml
maintenance_order_id:
asset_id:
source_type:
source_id:
maintenance_type:
classification: # CORRECTIVE, PREVENTIVE, INSPECTION, OTHER, UNKNOWN
```

## `MAINTENANCE.CLASSIFICATION_CHANGED`

```yaml
maintenance_order_id:
asset_id:
from_classification:
classification:
version:
reason:
correlation_id:
```

The event applies only before the order reaches a terminal state. Completed
classification is immutable and is retained as typed scoring evidence.

---

## `MAINTENANCE.DIAGNOSIS_COMPLETED`

```yaml
maintenance_order_id:
asset_id:
diagnosis_result:
failure_mode:
recommended_action:
confidence:
```

---

## `MAINTENANCE.WAITING_PART`

```yaml
maintenance_order_id:
part_id:
quantity:
eta:
```

---

## `MAINTENANCE.WAITING_VENDOR`

```yaml
maintenance_order_id:
vendor_id:
expected_completion:
```

---

## `MAINTENANCE.REPAIR_STARTED`

```yaml
maintenance_order_id:
technician_id:
vendor_id:
```

---

## `MAINTENANCE.COMPLETED`

```yaml
maintenance_order_id:
asset_id:
result:
total_cost:
currency:
verification:
```

---

## `MAINTENANCE.REPEAT_DETECTED`

```yaml
asset_id:
failure_signature:
repeat_count:
window_days:
```

---

# 37. Warranty Event Catalog

## `WARRANTY.EXPIRING`

```yaml
warranty_id:
asset_id:
expiry_date:
days_remaining:
```

## `WARRANTY.EXPIRED`

```yaml
warranty_id:
asset_id:
expired_at:
```

## `WARRANTY.CLAIM_CREATED`

```yaml
claim_id:
warranty_id:
asset_id:
maintenance_order_id:
claim_number:
```

## `WARRANTY.CLAIM_APPROVED`

```yaml
claim_id:
provider_id:
resolution_type:
expected_completion:
```

## `WARRANTY.CLAIM_REJECTED`

```yaml
claim_id:
reason_code:
reason_summary:
```

---

# 38. Replacement / Disposal Event Catalog

## `REPLACEMENT.CANDIDATE_CREATED`

```yaml
replacement_plan_id:
asset_id:
score:
reasons:
```

## `REPLACEMENT.CANDIDATE_RECOMMENDATION_UPDATED`

```yaml
replacement_plan_id:
asset_id:
assessment_id:
score:
band:
profile_id:
profile_version:
state:
```

The event updates recommendation evidence only. It preserves candidate
lifecycle and human review state; it does not approve or execute replacement.

## `REPLACEMENT.APPROVED`

```yaml
replacement_plan_id:
asset_id:
approved_by:
target_date:
```

## `REPLACEMENT.NEW_ASSET_READY`

```yaml
replacement_plan_id:
old_asset_id:
new_asset_id:
```

## `REPLACEMENT.COMPLETED`

```yaml
replacement_plan_id:
old_asset_id:
new_asset_id:
completed_at:
```

## `DATA_WIPE.STARTED`

```yaml
data_wipe_job_id:
asset_id:
method:
```

## `DATA_WIPE.COMPLETED`

```yaml
data_wipe_job_id:
asset_id:
verification_result:
evidence_document_id:
```

## `DATA_WIPE.FAILED`

```yaml
data_wipe_job_id:
asset_id:
error_code:
requires_alternative_method:
```

## `DISPOSAL.COMPLETED`

```yaml
disposal_record_id:
asset_id:
method:
value_recovered:
currency:
evidence_document_id:
evidence_checksum:
```

## `REPLACEMENT.REVIEWED`

```yaml
replacement_plan_id:
asset_id:
decision:
reviewed_by:
reason:
review_date:
risk_acceptance:
version:
```

## `REPLACEMENT.PLAN_CREATED`

```yaml
replacement_plan_id:
asset_id:
target_user_id:
target_model:
budget:
target_date:
procurement_required:
migration_required:
state:
version:
```

## `REPLACEMENT.MIGRATION_STARTED`

```yaml
replacement_plan_id:
old_asset_id:
new_asset_id:
migration_required:
version:
```

## `RETIREMENT.CANDIDATE_CREATED`

```yaml
retirement_record_id:
asset_id:
state:
reason:
version:
blockers: []
```

## `RETIREMENT.APPROVED`

```yaml
retirement_record_id:
asset_id:
approval_id:
approved_by:
clearances:
version:
```

## `RETIREMENT.BLOCKED`

```yaml
retirement_record_id:
asset_id:
blockers:
version:
```

## `DISPOSAL.APPROVED`

```yaml
disposal_record_id:
asset_id:
method:
approval_id:
```

## `ASSET.REACTIVATED`

```yaml
asset_id:
from_state:
to_state:
version:
approval_id:
reconditioning_evidence_id:
reconditioning_evidence_checksum:
```

`RETIREMENT.BLOCKED` retains the actionable gate result when owner clearance is
missing. `REPLACEMENT.REVIEWED` records non-approval decisions, including a
defer that remains under review. These facts use the Asset-owned aggregate and
carry the standard event envelope.

---

# 39. Audit Event Catalog

## `AUDIT.CREATED`

```yaml
audit_id:
audit_type:
scope:
due_at:
```

## `AUDIT.STARTED`

```yaml
audit_id:
expected_asset_count:
started_at:
```

## `AUDIT.OBSERVATION_RECORDED`

```yaml
audit_id:
observation_id:
asset_id:
source:
confidence:
observed_at:
```

## `AUDIT.LOCATION_MISMATCH`

```yaml
audit_exception_id:
audit_id:
asset_id:
expected_location_id:
observed_location_id:
confidence:
```

## `AUDIT.OWNER_MISMATCH`

```yaml
audit_exception_id:
asset_id:
expected_user_id:
observed_user_id:
confidence:
```

## `AUDIT.ASSET_MISSING`

```yaml
audit_exception_id:
asset_id:
last_seen_at:
last_known_location_id:
```

## `AUDIT.UNKNOWN_ASSET`

```yaml
audit_exception_id:
observation_id:
serial:
asset_tag:
location_id:
```

## `AUDIT.EXCEPTION_RESOLVED`

```yaml
audit_exception_id:
resolution_type:
resolution_entity_id:
resolved_by:
```

## `AUDIT.COMPLETED`

```yaml
audit_id:
verified_count:
exception_count:
open_exception_count:
```

---

# 40. Network Event Catalog

## `DISCOVERY.JOB_STARTED`

```yaml
job_id:
scope_type:
scope_id:
source_types:
```

## `DISCOVERY.JOB_COMPLETED`

```yaml
job_id:
devices_seen:
matched:
unknown:
duration_ms:
```

## `DISCOVERY.JOB_FAILED`

```yaml
job_id:
error_code:
scope_type:
scope_id:
```

## `NETWORK.DEVICE_DISCOVERED`

```yaml
observation_id:
asset_id:
mac:
ip:
hostname:
vendor:
confidence:
```

## `NETWORK.UNKNOWN_DEVICE`

```yaml
network_exception_id:
mac:
ip:
hostname:
vlan_id:
switch_port_id:
risk:
```

## `NETWORK.IP_CHANGED`

```yaml
asset_id:
interface_id:
previous_ip:
new_ip:
observed_at:
```

## `NETWORK.IP_CONFLICT`

```yaml
network_exception_id:
ip:
macs:
subnet_id:
```

## `NETWORK.VLAN_MISMATCH`

```yaml
network_exception_id:
asset_id:
expected_vlan_id:
observed_vlan_id:
switch_port_id:
confidence:
```

## `NETWORK.EXCEPTION_RESOLVED`

```yaml
network_exception_id:
exception_type:
state: RESOLVED | ACCEPTED
resolution_action:
resolution_reason:
linked_asset_id:
version:
resolved_at:
```

## `NETWORK.PORT_CHANGED`

```yaml
asset_id:
interface_id:
previous_switch_port_id:
new_switch_port_id:
observed_at:
```

## Controlled VLAN Change Events

These Network-owned events record the controlled operation and its durable
operator evidence. They do not assert that a device connector executed a
configuration change.

### `NETWORK.VLAN_CHANGE_CREATED`
### `NETWORK.VLAN_CHANGE_STARTED`
### `NETWORK.VLAN_CHANGE_IMPLEMENTATION_RECORDED`
### `NETWORK.VLAN_CHANGE_VERIFIED`
### `NETWORK.VLAN_CHANGE_ROLLBACK_RECORDED`

```yaml
vlan_change_id:
change_id:
target_device:
target_port:
previous_vlan:
desired_vlan:
state:
version:
reason:
evidence: # phase-specific record when the command captures operator evidence
```

## `NETWORK.TOPOLOGY_CHANGED`

```yaml
edge_id:
change_type:
from_entity:
to_entity:
source:
confidence:
```

---

# 41. Software Event Catalog

The following catalog-management facts are additive TASK-054 events; they are
distinct from end-user software request approval.

## `SOFTWARE.CATALOG_ITEM_CREATED`

```yaml
software_product_id:
product_code:
classification:
visibility:
self_service_allowed:
```

## `SOFTWARE.VERSION_CREATED`

```yaml
software_product_id:
software_version_id:
version:
```

## `SOFTWARE.CLASSIFICATION_CHANGED`

```yaml
software_product_id:
from_classification:
classification:
self_service_allowed:
reason:
```

## `SOFTWARE.CATALOG_VISIBILITY_CHANGED`

```yaml
software_product_id:
visibility:
self_service_allowed:
reason:
```

## `SOFTWARE.CATALOG_VERSION_PUBLISHED`

```yaml
software_product_id:
software_version_id:
artifact_version_id:
approved_by:
```

## `SOFTWARE.CATALOG_VERSION_WITHDRAWN`

```yaml
software_product_id:
software_version_id:
artifact_version_id:
classification:
reason:
```

## Software Deployment Events

Deployment events are written only after the corresponding Software state
commits. They contain metadata and normalized outcomes; download grants, raw
installer output, credentials, and storage references are excluded.

## `SOFTWARE.DEPLOYMENT_CAMPAIGN_CREATED`

```yaml
campaign_id:
software_version_id:
artifact_version_id:
state:
rollout_stage_percent:
target_count:
version:
reason:
```

## `SOFTWARE.DEPLOYMENT_CAMPAIGN_STARTED`, `SOFTWARE.DEPLOYMENT_CAMPAIGN_PAUSED`, `SOFTWARE.DEPLOYMENT_CAMPAIGN_RESUMED`, `SOFTWARE.DEPLOYMENT_CAMPAIGN_ADVANCED`, `SOFTWARE.DEPLOYMENT_CAMPAIGN_COMPLETED`

```yaml
campaign_id:
state:
rollout_stage_percent:
queued_count:
version:
reason:
```

## `SOFTWARE.DEPLOYMENT_CAMPAIGN_STOPPED`

```yaml
campaign_id:
trigger:
deployment_job_id:
```

## `SOFTWARE.DEPLOYMENT_JOB_QUEUED`

```yaml
campaign_id:
rollout_stage_percent:
queued_count:
```

## `SOFTWARE.DEPLOYMENT_JOB_CLAIMED`

```yaml
campaign_id:
deployment_job_id:
asset_id:
agent_id:
attempt_number:
lease_expires_at:
```

## `SOFTWARE.DEPLOYMENT_JOB_RETRIED`

```yaml
deployment_job_id:
campaign_id:
state:
version:
reason:
```

## `SOFTWARE.DEPLOYMENT_PRECHECK_COMPLETED`

```yaml
campaign_id:
deployment_job_id:
asset_id:
agent_id:
passed:
attempt_id:
```

## `SOFTWARE.DEPLOYMENT_ARTIFACT_VERIFIED`

```yaml
campaign_id:
deployment_job_id:
asset_id:
checksum_verified:
signature_verified:
attempt_id:
```

## `SOFTWARE.INSTALLATION_REPORTED`

```yaml
campaign_id:
deployment_job_id:
asset_id:
agent_id:
attempt_id:
attempt_number:
outcome:
retryable:
error_code:
```

## `SOFTWARE.INSTALLATION_VERIFIED`

```yaml
deployment_job_id:
asset_id:
software_product_id:
software_version_id:
installation_id:
verification:
```

## `SOFTWARE.DEPLOYMENT_FAILED`, `SOFTWARE.DEPLOYMENT_SECURITY_FAILURE`

```yaml
campaign_id:
deployment_job_id:
asset_id:
attempt_id:
error_code:
retryable:
```

## `SOFTWARE.REQUESTED`

```yaml
software_request_id:
user_id:
asset_id:
software_product_id:
```

## `SOFTWARE.APPROVAL_REQUIRED`

```yaml
software_request_id:
approval_request_id:
reason:
```

## `SOFTWARE.APPROVED`

```yaml
software_request_id:
approved_by:
artifact_version_id:
license_required:
```

## `SOFTWARE.INSTALL_STARTED`

```yaml
deployment_job_id:
asset_id:
artifact_version_id:
agent_id:
```

## `SOFTWARE.INSTALLED`

```yaml
deployment_job_id:
asset_id:
software_product_id:
software_version_id:
installation_id:
verification:
```

## `SOFTWARE.INSTALL_FAILED`

```yaml
deployment_job_id:
asset_id:
artifact_version_id:
error_code:
retryable:
```

## `SOFTWARE.UNAUTHORIZED_DETECTED`

```yaml
software_exception_id:
asset_id:
software_product_id: # nullable when catalog matching remains UNKNOWN
detected_version:
classification:
installation_id:
```

## `SOFTWARE.INVENTORY_NORMALIZED`

```yaml
inventory_report_id:
asset_id:
agent_id:
inventory_complete:
item_count:
payload_sha256:
```

## `SOFTWARE.PRODUCT_ALIAS_CREATED`

```yaml
software_product_id:
alias_id:
alias:
normalized_alias:
```

## `SOFTWARE.EXCEPTION_UPDATED`

```yaml
software_exception_id:
state:
version:
reason:
approval_request_id: # nullable
approved_until: # nullable
```

## `SOFTWARE.UNINSTALL_PROFILE_CREATED`, `SOFTWARE.UNINSTALL_PROFILE_APPROVED`

```yaml
uninstall_profile_id:
software_product_id:
symbolic_method:
auto_removal_allowed:
approval_request_id: # nullable for creation, required after approval
version:
```

## `SOFTWARE.REMOVAL_REQUESTED`, `SOFTWARE.REMOVAL_JOB_QUEUED`

```yaml
software_exception_id:
removal_job_id: # nullable when operator action is required
state:
automatic_dispatch:
version:
```

## `SOFTWARE.REMOVAL_JOB_CLAIMED`

```yaml
removal_job_id:
software_exception_id:
asset_id:
agent_id:
symbolic_method:
attempt_number:
lease_expires_at:
```

## `SOFTWARE.REMOVAL_JOB_REPORTED`, `SOFTWARE.REMOVAL_FAILED`

```yaml
removal_job_id:
software_exception_id:
outcome:
state:
error_code: # nullable
version:
```
```

## `SOFTWARE.REMOVED`

```yaml
asset_id:
software_product_id:
installation_id:
reason:
```

## `SOFTWARE.VERSION_OUTDATED`

```yaml
asset_id:
software_product_id:
current_version:
required_version:
```

## `SOFTWARE.VULNERABLE_DETECTED`

```yaml
asset_id:
software_product_id:
software_version_id:
vulnerability_ref:
severity:
```

---

# 42. Artifact Event Catalog

These lifecycle facts extend the artifact event catalog for the explicit
review, activation and restriction commands. They do not carry binary content
or storage credentials.

## `ARTIFACT.UPLOADED`

```yaml
artifact_version_id:
software_version_id:
filename:
checksum_sha256:
source_type:
```

## `ARTIFACT.SCAN_PASSED`

```yaml
artifact_version_id:
scan_result_id:
scanner:
```

## `ARTIFACT.SCAN_FAILED`

```yaml
artifact_version_id:
scan_result_id:
severity:
reason:
```

## `ARTIFACT.SCAN_REVIEW_REQUIRED`

```yaml
artifact_version_id:
scan_result_id:
reason:
```

## `ARTIFACT.SIGNATURE_VALIDATED`

```yaml
artifact_version_id:
signature_status:
verifier:
```

## `ARTIFACT.APPROVED`

```yaml
artifact_version_id:
approved_by:
approved_at:
```

## `ARTIFACT.REJECTED`

```yaml
artifact_version_id:
rejected_by:
reason:
```

## `ARTIFACT.ACTIVATED`

```yaml
artifact_version_id:
activated_by:
activated_at:
```

## `ARTIFACT.RESTRICTED`

```yaml
artifact_version_id:
restricted_by:
reason:
```

## `ARTIFACT.REVOKED`

```yaml
artifact_version_id:
reason:
revoked_by:
```

## `ARTIFACT.INTEGRITY_MISMATCH`

```yaml
artifact_version_id:
expected_checksum:
observed_checksum:
storage_object_key:
```

---

# 43. License Event Catalog

## `LICENSE.ENTITLEMENT_CREATED`

```yaml
entitlement_id:
software_product_id:
license_type:
quantity:
valid_from:
valid_until:
```

## `LICENSE.POOL_CREATED`

```yaml
pool_id:
name:
pool_type:
scope_reference:
version:
```

## `LICENSE.POOL_UPDATED`

```yaml
pool_id:
name:
state:
version:
```

## `LICENSE.ENTITLEMENT_UPDATED`

```yaml
entitlement_id:
software_product_id:
version:
changed_fields:
reason:
```

`changed_fields` contains field names only; it must not contain license keys,
credentials, or unrestricted contract data.

## `LICENSE.RENEWED`

```yaml
entitlement_id:
software_product_id:
term_version:
previous_valid_from:
previous_valid_until:
valid_from:
valid_until:
reason:
```

This event records committed new contractual terms. The previous term remains
available in append-only entitlement history.

## `LICENSE.ASSIGNED`

```yaml
assignment_id:
entitlement_id:
principal_type:
principal_id:
```

## `LICENSE.ASSIGNMENT_CANCELLED`

```yaml
assignment_id:
entitlement_id:
principal_type:
principal_id:
cancelled_at:
reason:
```

## `LICENSE.RESERVED`

```yaml
reservation_id:
entitlement_id:
deployment_target_id:
asset_id:
```

## `LICENSE.RESERVATION_RELEASED`

```yaml
reservation_id:
entitlement_id:
deployment_target_id:
asset_id:
reason:
```

## `LICENSE.ACTIVATED`

```yaml
assignment_id:
activated_at:
activation_source:
```

## `LICENSE.SUSPENDED`

```yaml
assignment_id:
entitlement_id:
principal_type:
principal_id:
reason:
```

## `LICENSE.USAGE_OBSERVED`

```yaml
entitlement_id:
observation_id:
source:
active_usage:
observed_at:
```

## `LICENSE.OVERUSED`

```yaml
entitlement_id:
entitled:
assigned:
installed:
active_usage:
overage:
```

## `LICENSE.UNDERUSED`

```yaml
entitlement_id:
entitled:
active_usage:
reclaimable_count:
```

## `LICENSE.RECLAIM_PENDING`

```yaml
assignment_id:
reason:
grace_until: # nullable when the entitlement has no configured reclaim grace period
```

## `LICENSE.RECLAIMED`

```yaml
assignment_id:
entitlement_id:
principal_type:
principal_id:
reclaimed_at:
```

## `LICENSE.EXPIRING`

```yaml
entitlement_id:
valid_until:
days_remaining:
usage_summary:
```

## `LICENSE.EXPIRED`

```yaml
entitlement_id:
term_version:
expired_at:
valid_until:
```

The event represents the validity-window boundary, not a mutable entitlement
state transition. Emit at most once for each entitlement term version.

---

# 44. Procurement Event Catalog

## `PROCUREMENT.REQUESTED`

```yaml
procurement_request_id:
requester_user_id:
source_type:
source_id:
estimated_total:
currency:
state: SUBMITTED
version:
reason:
```

## `PROCUREMENT.REQUEST_CREATED`

Emitted when the Procurement domain commits a new `DRAFT` request.

```yaml
procurement_request_id:
request_code:
requester_user_id:
source_type:
source_id:
state: DRAFT
version: 1
estimated_total:
currency:
reason:
```

## `PROCUREMENT.BUDGET_CHECKED`

```yaml
procurement_request_id:
result:
budget_id:
available_amount:
```

## `PROCUREMENT.APPROVED`

```yaml
procurement_request_id:
approval_request_id:
approved_total:
currency:
```

## `RFQ.CREATED`

```yaml
rfq_id:
procurement_request_id:
state: DRAFT
version: 1
supplier_ids:
due_at:
```

## `RFQ.UPDATED`

Emitted only for `RFQ.UPDATE_DRAFT`.

```yaml
rfq_id:
state: DRAFT
version:
changed_fields:
```

## `RFQ.ISSUED`

```yaml
rfq_id:
procurement_request_id:
previous_state: DRAFT
new_state: OPEN
version:
supplier_ids:
issued_at:
due_at:
```

## `RFQ.SUBMISSIONS_CLOSED`

```yaml
rfq_id:
previous_state: OPEN
new_state: EVALUATING
version:
```

## `RFQ.CANCELLED`

```yaml
rfq_id:
previous_state: DRAFT | OPEN | EVALUATING
new_state: CANCELLED
version:
reason:
voided_quotation_ids:
```

## `RFQ.AWARDED`

```yaml
rfq_id:
procurement_request_id:
previous_state: EVALUATING
new_state: AWARDED
version:
selected_quotation_id:
selected_supplier_id:
approval_reference: # linked approved RFQ_AWARD request ID, or null when none is linked
award_exception_reason: # required only when policy/score exception applies
rejected_quotation_ids:
voided_quotation_ids:
```

## `RFQ.CLOSED_NO_AWARD`

```yaml
rfq_id:
previous_state: EVALUATING
new_state: CLOSED_NO_AWARD
version:
rejected_quotation_ids:
voided_quotation_ids:
```

## `QUOTATION.CREATED`

```yaml
quotation_id:
rfq_id:
supplier_id:
state: DRAFT
version: 1
replaces_quotation_id:
revision_number:
```

## `QUOTATION.UPDATED`

Emitted only for `QUOTATION.UPDATE_DRAFT`.

```yaml
quotation_id:
rfq_id:
supplier_id:
state: DRAFT
version:
changed_fields:
```

## `QUOTATION.SUBMITTED`

```yaml
quotation_id:
rfq_id:
supplier_id:
previous_state: DRAFT
new_state: SUBMITTED
version:
revision_number:
```

## `QUOTATION.WITHDRAWN`

```yaml
quotation_id:
rfq_id:
supplier_id:
previous_state: DRAFT | SUBMITTED
new_state: WITHDRAWN
version:
reason:
```

## `QUOTATION.DISQUALIFIED`

```yaml
quotation_id:
rfq_id:
supplier_id:
previous_state: SUBMITTED
new_state: DISQUALIFIED
version:
reason:
```

## `QUOTATION.ACCEPTED`

```yaml
quotation_id:
rfq_id:
supplier_id:
previous_state: SUBMITTED
new_state: ACCEPTED
version:
award_event_id:
```

## `QUOTATION.REJECTED`

```yaml
quotation_id:
rfq_id:
supplier_id:
previous_state: SUBMITTED
new_state: REJECTED
version:
decision_event_id:
decision: AWARD_OTHER_QUOTATION | RFQ_CLOSED_NO_AWARD
```

## `QUOTATION.VOIDED`

```yaml
quotation_id:
rfq_id:
supplier_id:
previous_state: DRAFT | SUBMITTED
new_state: VOID
version:
rfq_cancelled_event_id:
rfq_decision_event_id:
decision: RFQ_CANCELLED | RFQ_AWARDED | RFQ_CLOSED_NO_AWARD
```

`RFQ.AWARDED` and `RFQ.CLOSED_NO_AWARD` include every affected child ID in
`rejected_quotation_ids` and `voided_quotation_ids`. A parent award/no-award
decision rejects SUBMITTED quotations and VOID-transitions remaining DRAFT
quotations. The child `QUOTATION.VOIDED` fact references its parent event via
`rfq_decision_event_id`; `rfq_cancelled_event_id` is populated only for
`RFQ.CANCELLED`. An RFQ_AWARD approval request is optional. When one or more
same-tenant requests target the RFQ, each must be APPROVED before award;
otherwise the award does not require approval evidence.

RFQ/Quotation lifecycle facts above replace the earlier draft names
`RFQ.SENT`, `QUOTATION.RECEIVED` and `SUPPLIER.SELECTED` for this workflow.
`RFQ.AWARDED` and its atomic `QUOTATION.ACCEPTED`/`QUOTATION.REJECTED` facts
are authoritative for supplier selection. Do not emit the earlier draft names
for TASK-071.

Each state-changing command writes its canonical event(s), audit evidence and
all affected aggregate histories in the same local transaction. Parent
commands that transition quotations emit one quotation event per changed
quotation with that quotation's committed version; all facts share the
causation/correlation context of the RFQ command.

## Supplier Master Facts

Producer and aggregate owner: Procurement / Supplier. These events are emitted
from the transaction outbox only after the corresponding Supplier mutation
commits. The common envelope carries `event_id`, `event_type`,
`schema_version`, `occurred_at`, producer, aggregate type/id/version, actor,
`correlation_id`, `causation_id`, tenant and payload.

All event payloads include `supplier_id`, committed `version`, and `reason`.
Payloads must not contain tax/banking secrets, raw bank details, or full
sensitive identity values. `SUPPLIER.UPDATED` carries changed field names, not
field values for protected fields. Lifecycle events include `previous_state`
and `new_state`; creation uses `previous_state: null`.

| Event | Trigger | Additional minimum payload |
|---|---|---|
| `SUPPLIER.CREATED` | `SUPPLIER.CREATE` | `previous_state: null`, `new_state: PROSPECT` |
| `SUPPLIER.UPDATED` | `SUPPLIER.UPDATE_PROFILE` | `changed_fields` |
| `SUPPLIER.APPROVED` | `SUPPLIER.APPROVE` | `previous_state: PROSPECT`, `new_state: APPROVED`, `reason` |
| `SUPPLIER.PREFERRED` | `SUPPLIER.MARK_PREFERRED` | `previous_state: APPROVED`, `new_state: PREFERRED`, `reason` |
| `SUPPLIER.PREFERRED_REMOVED` | `SUPPLIER.REMOVE_PREFERRED` | `previous_state: PREFERRED`, `new_state: APPROVED`, `reason` |
| `SUPPLIER.SUSPENDED` | `SUPPLIER.SUSPEND` | `previous_state`, `new_state: SUSPENDED`, `reason` |
| `SUPPLIER.RESUMED` | `SUPPLIER.RESUME` | `previous_state: SUSPENDED`, `new_state: APPROVED`, `reason` |
| `SUPPLIER.BLOCKED` | `SUPPLIER.BLOCK` | `previous_state`, `new_state: BLOCKED`, `reason` |
| `SUPPLIER.UNBLOCKED` | `SUPPLIER.UNBLOCK` | `previous_state: BLOCKED`, `new_state: PROSPECT`, `reason` |
| `SUPPLIER.DEACTIVATED` | `SUPPLIER.DEACTIVATE` | `previous_state`, `new_state: INACTIVE`, `reason` |
| `SUPPLIER.REACTIVATED` | `SUPPLIER.REACTIVATE` | `previous_state: INACTIVE`, `new_state: PROSPECT`, `reason` |

`previous_state` for `SUPPLIER.SUSPENDED`, `SUPPLIER.BLOCKED` and
`SUPPLIER.DEACTIVATED` is the actual committed source state listed in the
Supplier lifecycle state machine. A retry of a committed command returns its
idempotent result and does not emit a second event.

## `PO.CREATED`

```yaml
purchase_order_id:
po_code:
supplier_id:
procurement_request_id:
rfq_id:
accepted_quotation_id:
lifecycle_state: DRAFT
receipt_state: NOT_RECEIVED
aggregate_version: 1
```

## `PO.UPDATED`

Emitted only for `PO.UPDATE_DRAFT`.

```yaml
purchase_order_id:
previous_lifecycle_state: DRAFT
lifecycle_state: DRAFT
receipt_state: NOT_RECEIVED
aggregate_version:
changed_fields:
```

## `PO.ISSUED`

```yaml
purchase_order_id:
previous_lifecycle_state: DRAFT
lifecycle_state: ISSUED
receipt_state: NOT_RECEIVED
aggregate_version:
commercial_version: 1
supplier_id:
issued_at:
expected_delivery:
approval_reference: # approved linked PO_ISSUE request ID, or null when none is linked
commercial_snapshot_hash:
```

## `PO.HELD`

```yaml
purchase_order_id:
previous_lifecycle_state: ISSUED
lifecycle_state: ON_HOLD
receipt_state:
aggregate_version:
reason:
```

## `PO.RESUMED`

```yaml
purchase_order_id:
previous_lifecycle_state: ON_HOLD
lifecycle_state: ISSUED
receipt_state:
aggregate_version:
reason:
```

## `PO.AMENDED`

```yaml
purchase_order_id:
previous_lifecycle_state: ISSUED | ON_HOLD
lifecycle_state:
receipt_state: NOT_RECEIVED
aggregate_version:
base_commercial_version:
new_commercial_version:
approval_reference: # approved linked PO_AMENDMENT request ID, or null when none is linked
commercial_snapshot_hash:
material_changes:
reason:
```

## `PO.CANCELLED`

```yaml
purchase_order_id:
previous_lifecycle_state: DRAFT | ISSUED | ON_HOLD
lifecycle_state: CANCELLED
receipt_state: NOT_RECEIVED
aggregate_version:
reason:
```

## `PO.CLOSED`

```yaml
purchase_order_id:
previous_lifecycle_state: ISSUED | ON_HOLD
lifecycle_state: CLOSED
receipt_state: FULLY_RECEIVED
aggregate_version:
completed_at:
```

## `PO.REMAINDER_CLOSED`

```yaml
purchase_order_id:
previous_lifecycle_state: ISSUED | ON_HOLD
lifecycle_state: CLOSED
receipt_state: PARTIALLY_RECEIVED
aggregate_version:
received_quantities:
remaining_quantities:
reason:
```

## PO Receipt-State Events — TASK-073

Producer/owner: Goods Receipt workflow under TASK-073. These events update
only the independent PO receipt state; they do not change `lifecycle_state`
or a PO commercial version. Goods Receipt posting is allowed only while
`lifecycle_state=ISSUED`; it is forbidden for `DRAFT`, `ON_HOLD`, `CLOSED` and
`CANCELLED`.

## `PO.PARTIALLY_RECEIVED`

```yaml
purchase_order_id:
goods_receipt_id:
previous_receipt_state: NOT_RECEIVED | PARTIALLY_RECEIVED
receipt_state: PARTIALLY_RECEIVED
aggregate_version:
commercial_version:
accepted_quantities:
received_summary:
remaining_summary:
```

## `PO.FULLY_RECEIVED`

```yaml
purchase_order_id:
goods_receipt_id:
previous_receipt_state: NOT_RECEIVED | PARTIALLY_RECEIVED
receipt_state: FULLY_RECEIVED
aggregate_version:
commercial_version:
completed_at:
accepted_quantities:
received_summary:
```

Emit `PO.PARTIALLY_RECEIVED` for a successfully posted receipt that leaves
fulfillment incomplete, including a later receipt where the previous and new
receipt state are both `PARTIALLY_RECEIVED`. Emit `PO.FULLY_RECEIVED` only
when the receipt dimension transitions into `FULLY_RECEIVED`. Idempotent
command replay and event redelivery must not duplicate either event/effect.
Receipt events never close the PO lifecycle.

## 44.1 Goods Receipt Events — TASK-073

Goods Receipt events are produced by the Procurement/Warehouse owner. Posted
receipt facts are immutable and are emitted from the same transaction as PO
receipt progress, audit references and the outbox write.

### `GOODS_RECEIPT.CREATED`

```yaml
goods_receipt_id:
receipt_code:
purchase_order_id:
supplier_id:
warehouse_id:
location_id:
state: DRAFT
aggregate_version:
```

### `GOODS_RECEIPT.UPDATED`

```yaml
goods_receipt_id:
purchase_order_id:
state: DRAFT
aggregate_version:
changed_fields:
```

### `GOODS_RECEIPT.POSTED`

```yaml
goods_receipt_id:
receipt_code:
purchase_order_id:
purchase_order_code:
purchase_order_commercial_version:
supplier_id:
supplier_display_reference:
warehouse_id:
location_id:
aggregate_version:
posted_at:
received_unit_ids: # stable immutable IDs for accepted Asset-tracked units
accepted_line_references: # receipt line ID, PO line ID, accepted quantity/unit
evidence_references: # references only; no full document content
correlation_id:
```

The event contains references required for downstream Asset registration,
not full documents or protected Supplier financial/tax values. The Asset
consumer uses the immutable `received_unit_id` as command idempotency identity
and obtains any additional canonical unit fields through the owning
application contract.

### `GOODS_RECEIPT.CANCELLED`

```yaml
goods_receipt_id:
purchase_order_id:
aggregate_version:
reason:
cancelled_at:
```

Draft update/cancellation do not advance PO quantities. No event rewrites a
posted receipt; future reversal/correction events belong to a separate
out-of-scope workflow.

## `PO.DELIVERY_OVERDUE`

```yaml
purchase_order_id:
expected_delivery:
remaining_lines:
days_overdue:
```

---

# 45. Invoice and Credit Note Event Catalog (TASK-074)

Invoice and Credit Note events are completed facts written to the owning
outbox in the same transaction as their lifecycle, match, exception,
allocation or application effects. Payloads contain stable references and
minimal state needed by consumers. Never include raw bank data, protected tax
identifiers, full invoice documents or unnecessary line-level financial
values. Standard envelope metadata carries tenant, correlation, causation and
schema version.

## Invoice events

| Event | Minimum payload |
|---|---|
| `INVOICE.CREATED` | `invoice_id`, `supplier_id`, `document_type`, `version` |
| `INVOICE.UPDATED` | `invoice_id`, `version` |
| `INVOICE.SUBMITTED` | `invoice_id`, `supplier_id`, `purchase_order_id`, `snapshot_fingerprint`, `version` |
| `INVOICE.DUPLICATE_DETECTED` | attempted `invoice_id`, existing `document_id`, `supplier_id`, `document_type`, `normalized_number_fingerprint` |
| `INVOICE.MATCH_EVALUATED` | `invoice_id`, `match_evaluation_id`, `evaluation_version`, `match_status`, `reason_codes`, `po_id`, receipt reference IDs |
| `INVOICE.MATCHED` | `invoice_id`, `match_evaluation_id`, `allocation_reference_ids` |
| `INVOICE.PENDING_RECEIPT` | `invoice_id`, `match_evaluation_id`, `po_id`, affected PO line references |
| `INVOICE.MISMATCHED` | `invoice_id`, `match_evaluation_id`, `match_exception_id`, `reason_codes` |
| `INVOICE.MATCH_EXCEPTION_CREATED` | `invoice_id`, `match_exception_id`, `match_evaluation_id`, `reason_codes` |
| `INVOICE.MATCH_EXCEPTION_ACCEPTED` | `invoice_id`, `match_exception_id`, `approval_request_id`, `match_evaluation_id` |
| `INVOICE.APPROVED` | `invoice_id`, `match_status`, optional `approval_request_id`, optional `match_exception_id` |
| `INVOICE.REJECTED` | `invoice_id`, `reason_code`, `reason_reference` |
| `INVOICE.CANCELLED` | `invoice_id`, `reason_reference` |

`INVOICE.MATCHED`, `INVOICE.PENDING_RECEIPT` and `INVOICE.MISMATCHED` are
emitted from the corresponding immutable match evaluation outcome. Acceptance
of a mismatch never emits `INVOICE.MATCHED` or changes that evaluation.
Duplicate detection is a rejected command/audit outcome; if published,
`INVOICE.DUPLICATE_DETECTED` exposes only a non-reversible number fingerprint,
not the raw supplier document number.

## Credit Note events

| Event | Minimum payload |
|---|---|
| `CREDIT_NOTE.CREATED` | `credit_note_id`, `invoice_id`, `supplier_id`, `version` |
| `CREDIT_NOTE.UPDATED` | `credit_note_id`, `version` |
| `CREDIT_NOTE.SUBMITTED` | `credit_note_id`, `invoice_id`, `supplier_id`, `snapshot_fingerprint` |
| `CREDIT_NOTE.APPLIED` | `credit_note_id`, `invoice_id`, `application_id`, credited line reference IDs, released allocation reference IDs |
| `CREDIT_NOTE.REJECTED` | `credit_note_id`, `invoice_id`, `reason_code`, `reason_reference` |
| `CREDIT_NOTE.CANCELLED` | `credit_note_id`, `reason_reference` |

Events do not carry full document content. Asset/procurement cross-domain
consumers must use idempotent references and read protected canonical details
through authorized application contracts where necessary.

---

# 46. Contract Event Catalog

## `CONTRACT.CREATED`

```yaml
contract_id:
contract_code:
supplier_id:
contract_type:
contract_version_id:
effective_at:
end_at:
```

## `CONTRACT.UPDATED`

```yaml
contract_id:
contract_version_id:
version:
changed_field_names:
```

## `CONTRACT.SUBMITTED_FOR_SIGNATURE`

```yaml
contract_id:
contract_version_id:
snapshot_fingerprint:
```

## `CONTRACT.SIGNATURE_RECALLED`

```yaml
contract_id:
recalled_contract_version_id:
new_draft_version_id:
reason_reference:
```

## `CONTRACT.EXECUTED`

```yaml
contract_id:
contract_version_id:
execution_evidence_document_version_ids:
executed_at:
```

## `CONTRACT.ACTIVATED`

```yaml
contract_id:
activated_at:
contract_version_id:
usage_status:
```

## `CONTRACT.HELD`

```yaml
contract_id:
usage_status: ON_HOLD
reason_reference:
```

## `CONTRACT.RESUMED`

```yaml
contract_id:
usage_status: ENABLED
```

## `CONTRACT.AMENDED`

```yaml
contract_id:
base_contract_version_id:
contract_version_id:
changed_field_names:
amendment_evidence_document_version_ids:
```

## `CONTRACT.EXPIRED`

```yaml
contract_id:
contract_version_id:
expired_at:
end_at:
```

## `CONTRACT.CANCELLED`

```yaml
contract_id:
contract_version_id:
reason_reference:
```

## `CONTRACT.RENEWAL_OPENED`

```yaml
renewal_case_id:
predecessor_contract_id:
successor_contract_id:
successor_contract_version_id:
```

## `CONTRACT.RENEWAL_UPDATED`

```yaml
renewal_case_id:
successor_contract_id:
proposal_fingerprint:
version:
```

## `CONTRACT.RENEWAL_COMPLETED`

```yaml
renewal_case_id:
predecessor_contract_id:
successor_contract_id:
successor_contract_version_id:
```

## `CONTRACT.RENEWAL_NOT_RENEWED`

```yaml
renewal_case_id:
predecessor_contract_id:
reason_reference:
```

## `CONTRACT.RENEWAL_CANCELLED`

```yaml
renewal_case_id:
predecessor_contract_id:
reason_reference:
```

## `CONTRACT.TERMINATED`

```yaml
contract_id:
contract_version_id:
terminated_at:
effective_at:
reason_reference:
termination_evidence_document_version_ids:
```

## `CONTRACT.RENEWAL_NOTICE_DUE`

```yaml
contract_id:
contract_version_id:
trigger_type: RENEWAL_NOTICE
trigger_source: EXPLICIT_DATE | NOTICE_PERIOD
trigger_at:
```

## `CONTRACT.EXPIRY_ACTION_DUE`

```yaml
contract_id:
contract_version_id:
trigger_type: EXPIRY_ACTION
trigger_source: EXPLICIT_DATE | NOTICE_PERIOD
trigger_at:
```

These are idempotent operational alert facts, not lifecycle transitions. They
are emitted only for explicit version-bound Contract trigger configuration;
no global notice threshold is implied. Stable alert identity includes tenant,
Contract, ContractVersion, trigger type and trigger time. The scheduler/outbox
must not emit recurring duplicates. `CONTRACT.EXPIRED` remains independent
and is emitted when the Contract naturally expires even when no alert config
exists. `CONTRACT.RENEWAL_NOTICE_DUE` is used for an explicit renewal notice;
`CONTRACT.EXPIRY_ACTION_DUE` is used only when the explicit Contract terms
designate an expiry action. Do not infer an action type. Contract is the
producer. Due events contain references only, never Contract content.

## `COST_PROVENANCE.RECORDED`

```yaml
cost_provenance_id:
target_type: ASSET | LICENSE_ENTITLEMENT | LICENSE_POOL
target_id:
source_type: PURCHASE_ORDER | INVOICE | CREDIT_NOTE | CONTRACT | CONTRACT_VERSION
source_document_id:
source_document_version_ref:
source_line_id:
cost_basis: COMMITTED | ACTUAL | ADJUSTMENT
amount: # only when authorized and necessary for this consumer
currency: # only when authorized and necessary for this consumer
effective_from:
effective_to:
```

## `COST_ADJUSTMENT.RECORDED`

```yaml
cost_provenance_id:
target_type:
target_id:
source_type: CREDIT_NOTE | other explicit adjustment source
source_document_id:
source_document_version_ref:
source_line_id:
adjustment_direction: CREDIT | DEBIT
amount: # positive semantic amount; only when authorized and necessary
currency:
```

Cost events are emitted after the canonical provenance transaction commits.
They carry source references and only the minimum authorized financial
metadata; never embed invoices, contract contents or protected Supplier
financial/tax data. Consumers use inbox/idempotency and the immutable
provenance identity to prevent duplicate allocations or adjustments. The
Procurement-owned cost-provenance ledger is the producer for recorded
allocation/adjustment facts; Asset and License consumers update only their
own derived projections through application/event contracts.

## `CONTRACT.SLA_BREACH`

```yaml
contract_id:
supplier_id:
breach_type:
source_entity_type:
source_entity_id:
```

## `COMMERCIAL_DOCUMENT.ADDED`

```yaml
document_id:
document_version_id:
document_type:
linked_entity_type:
linked_entity_id:
content_hash:
```

## `COMMERCIAL_DOCUMENT.FINALIZED`

```yaml
document_id:
document_version_id:
linked_entity_type:
linked_entity_id:
content_hash:
signature_status:
```

## `COMMERCIAL_DOCUMENT.SUPERSEDED`

```yaml
document_id:
document_version_id:
replacement_document_version_id:
linked_entity_type:
linked_entity_id:
```

Commercial document events contain references and minimal metadata only.
Never embed raw document bytes or unnecessary sensitive commercial terms.

---

# 47. Document Event Catalog

## `DOCUMENT.CREATED`

```yaml
document_id:
document_type:
owner_user_id:
```

## `DOCUMENT.VERSION_CREATED`

```yaml
document_id:
document_version_id:
version:
checksum:
```

## `DOCUMENT.SIGNED`

```yaml
document_id:
document_version_id:
signed_by:
signature_method:
signed_at:
```

## `DOCUMENT.EXPIRING`

```yaml
document_id:
expiry_date:
days_remaining:
```

## `DOCUMENT.SUPERSEDED`

```yaml
document_id:
previous_version_id:
new_version_id:
```

---

# 48. Approval Event Catalog

## `APPROVAL.CREATED`

```yaml
approval_request_id:
source_type:
source_id:
policy_id:
policy_version:
due_at:
```

## `APPROVAL.STEP_STARTED`

```yaml
approval_request_id:
step_id:
step_no:
approver_ids:
routing_type:
```

## `APPROVAL.REMINDER`

```yaml
approval_request_id:
step_id:
reminder_sequence:
```

## `APPROVAL.ESCALATED`

```yaml
approval_request_id:
step_id:
from_approver:
to_approver:
reason:
```

## `APPROVAL.APPROVED`

```yaml
approval_request_id:
source_type:
source_id:
approved_at:
final_approvers:
```

## `APPROVAL.REJECTED`

```yaml
approval_request_id:
rejected_by:
reason:
```

## `APPROVAL.CHANGES_REQUESTED`

```yaml
approval_request_id:
requested_by:
change_request_summary:
```

## `APPROVAL.EXPIRED`

```yaml
approval_request_id:
expired_at:
policy_action:
```

---

# 49. SLA Event Catalog

## `SLA.STARTED`

```yaml
sla_instance_id:
object_type:
object_id:
target_name:
due_at:
policy_id:
policy_version:
```

## `SLA.PAUSED`

```yaml
sla_instance_id:
reason:
paused_at:
```

## `SLA.RESUMED`

```yaml
sla_instance_id:
resumed_at:
paused_duration_seconds:
```

## `SLA.WARNING`

```yaml
sla_instance_id:
consumed_percent:
remaining_seconds:
```

## `SLA.CRITICAL`

```yaml
sla_instance_id:
consumed_percent:
remaining_seconds:
```

## `SLA.BREACHED`

```yaml
sla_instance_id:
breached_at:
overdue_seconds:
```

## `SLA.MET`

```yaml
sla_instance_id:
completed_at:
elapsed_business_seconds:
```

---

# 50. Automation Event Catalog

The `RULE.MATCHED` and `AUTOMATION.ACTION_*`, retry, rollback and completion
events below describe execution-stage behavior owned by TASK-091 (or an
existing earlier safe-automation workflow). TASK-090 emits only the
rule-decision and Action Intent events defined in the following subsection;
an intent event never claims that the action ran.

## `RULE.MATCHED`

```yaml
rule_execution_id:
rule_id:
rule_version:
trigger_event_id:
target_type:
target_id:
```

## `AUTOMATION.STARTED`

```yaml
rule_execution_id:
safety_level:
```

## `AUTOMATION.ACTION_STARTED`

```yaml
rule_execution_id:
action_execution_id:
sequence:
action_type:
target_id:
```

## `AUTOMATION.ACTION_SUCCEEDED`

```yaml
execution_id:
command_id:
target_agent_id:
verification_evidence_reference:
new_runtime_reference:
completed_at:
```

## `AUTOMATION.ACTION_FAILED`

```yaml
execution_id:
command_id:
reason_code:
failure_evidence_reference:
work_item_id:
completed_at:
```

## `AUTOMATION.RETRY`

```yaml
action_execution_id:
attempt:
next_retry_at:
```

## `AUTOMATION.ROLLBACK_STARTED`

```yaml
rule_execution_id:
rollback_reason:
```

## `AUTOMATION.ROLLED_BACK`

```yaml
rule_execution_id:
result:
```

## `AUTOMATION.HUMAN_FALLBACK`

```yaml
rule_execution_id:
work_item_id:
reason:
```

## `AUTOMATION.COMPLETED`

```yaml
rule_execution_id:
result:
completed_at:
```

### TASK-090 rule-decision and Action Intent events

These events describe rule evaluation and intent lifecycle only. They do not
assert that an action executed. Event envelope carries the standard tenant,
aggregate version, actor/service principal, correlation, causation and
idempotency metadata. Payloads use canonical references and safe reason codes;
they exclude raw event bodies, credentials, secrets and unnecessary protected
business data.

## `AUTOMATION.RULE_CREATED`

```yaml
rule_id:
rule_version:
rule_state: DRAFT
owner_reference:
```

## `AUTOMATION.RULE_VERSION_PUBLISHED`

```yaml
rule_id:
rule_version:
version_content_hash:
published_at:
```

## `AUTOMATION.RULE_ACTIVATED`

```yaml
rule_id:
rule_version:
safety_level:
approval_reference: null  # present when required
```

## `AUTOMATION.RULE_DEACTIVATED`

```yaml
rule_id:
rule_version:
reason_code:
```

## `AUTOMATION.ACTION_POLICY_CREATED`

```yaml
action_policy_id:
tenant_id:
action_type:
target_type:
policy_version:
mode: DENY | ALLOW | REQUIRE_APPROVAL
actor_reference:
correlation_id:
```

## `AUTOMATION.ACTION_POLICY_UPDATED`

```yaml
action_policy_id:
tenant_id:
policy_version:
entity_version:
actor_reference:
correlation_id:
```

## `AUTOMATION.ACTION_POLICY_VERSION_PUBLISHED`

```yaml
action_policy_id:
tenant_id:
policy_version:
policy_content_hash:
published_at:
actor_reference:
correlation_id:
```

## `AUTOMATION.ACTION_POLICY_ACTIVATED`

```yaml
action_policy_id:
tenant_id:
policy_version:
effective_from:
actor_reference:
correlation_id:
```

## `AUTOMATION.ACTION_POLICY_DEACTIVATED`

```yaml
action_policy_id:
tenant_id:
policy_version:
reason_code:
actor_reference:
correlation_id:
```

These events report policy administration and must not carry resource
selectors, raw parameter constraints or sensitive policy contents. Principal
grant changes use the canonical Authorization domain's existing grant
audit/event contract; Automation is not a second grant system.

## `AUTOMATION.RULE_EVALUATED`

```yaml
evaluation_id:
mode: PRODUCTION | SIMULATION
source_event_id:
source_event_type:
rule_id:
rule_version:
match_result:
condition_evidence_reference:
policy_decision: ALLOW | DENY | REQUIRE_APPROVAL
policy_reason_code:
action_capability_reference:
action_capability_version:
action_policy_reference: null
action_policy_version: null
principal_reference:
authorization_permission:
authorization_scope_reference:
authorization_decision: ALLOW | DENY
authorization_reason_code:
kill_switch_decision:
conflict_decision:
approval_context_hash: null
intent_references: []
```

## `AUTOMATION.INTENT_CREATED`

```yaml
intent_id:
source_event_id:
target_type:
target_id:
action_domain:
action_type:
intent_state:
policy_decision:
action_policy_reference: null
action_policy_version: null
principal_reference:
authorization_permission:
authorization_scope_reference:
authorization_decision: ALLOW | DENY
authorization_reason_code:
approval_reference: null
contributor_references: []
```

## `AUTOMATION.INTENT_DEDUPLICATED`

```yaml
canonical_intent_id:
source_event_id:
contributor_references: []
deduplication_reference:
```

## `AUTOMATION.INTENT_READY`

```yaml
intent_id:
policy_decision:
action_policy_reference: null
action_policy_version: null
principal_reference:
authorization_decision: ALLOW | DENY
authorization_reason_code:
approval_reference: null
eligibility_context_hash:
```

## `AUTOMATION.INTENT_BLOCKED`

```yaml
intent_id:
policy_decision: DENY | REQUIRE_APPROVAL
reason_code:
kill_switch_blocked: false
approval_reference: null
action_policy_reference: null
action_policy_version: null
principal_reference:
authorization_decision: DENY
authorization_reason_code:
```

## `AUTOMATION.INTENT_CONFLICTED`

```yaml
conflict_reference:
conflict_scope_reference:
intent_references: []
contributor_references: []
human_fallback_reference:
```

## `AUTOMATION.INTENT_CONFLICT_RESOLVED`

```yaml
conflict_reference:
selected_intent_references: []
blocked_intent_references: []
resolved_by:
resolution_reason_code:
```

TASK-091 owns events that assert action start, success, failure, retry,
verification, rollback/compensation or execution completion. A
`READY` intent is an eligible request to attempt execution, not a completed
business fact.

---

### TASK-091 v1 execution event contract

TASK-091 v1 emits the following completed facts from the Automation outbox.
All events are tenant-scoped, schema-versioned, correlated and carry only
references/minimal evidence. They never contain Agent credentials, secrets,
arbitrary command content or raw protected payloads.

## `AUTOMATION.EXECUTION_CREATED`

```yaml
execution_id:
intent_id:
attempt_number:
attempt_kind: AUTOMATIC | MANUAL
action_type: RESTART_AGENT
target_agent_id:
correlation_id:
```

## `AUTOMATION.EXECUTION_CLAIMED`

```yaml
execution_id:
claim_reference:
lease_expires_at:
```

## `AUTOMATION.ACTION_DISPATCHED`

```yaml
execution_id:
command_id:
intent_id:
target_agent_id:
action_type: RESTART_AGENT
dispatched_at:
acceptance_deadline_at: # dispatched_at + 30 seconds for RESTART_AGENT v1
correlation_id:
```

## `AUTOMATION.ACTION_ACCEPTED`

```yaml
execution_id:
command_id:
target_agent_id:
accepted_at:
pre_execution_runtime_reference:
```

## `AUTOMATION.ACTION_VERIFYING`

```yaml
execution_id:
command_id:
verification_deadline_at:
baseline_reference:
```

## `AUTOMATION.ACTION_UNKNOWN`

```yaml
execution_id:
command_id:
reason_code:
work_item_id:
reconciliation_required: true
completed_at:
dispatched_at:
acceptance_deadline_at: # required for AGENT_ACCEPTANCE_TIMEOUT
```

## `AUTOMATION.ACTION_RECONCILIATION_EVIDENCE_RECORDED`

```yaml
execution_id:
intent_id:
target_agent_id:
command_id:
evidence_type: LATE_AGENT_ACCEPTED | LATE_RESTART_RUNTIME
evidence:
state: UNKNOWN
reason_code: LATE_EVIDENCE_AFTER_UNKNOWN
```

This event records late evidence without changing terminal `UNKNOWN` state.
Evidence is durably deduplicated by execution and evidence identity.

## `AUTOMATION.ACTION_CANCELLED`

```yaml
execution_id:
command_id:
cancelled_by:
reason_code:
completed_at:
```

Emit transition events only after the owning transaction commits. Repeated
processing cannot duplicate the effective outbox event. `ACTION_ACCEPTED` is
not success; only `ACTION_SUCCEEDED` carries positive post-restart evidence.
`ACTION_UNKNOWN` does not imply failure or authorize retry. `RESTART_AGENT`
v1 has a 30-second acceptance deadline from dispatch and an independent
five-minute verification deadline from `accepted_at`. Late acceptance/runtime
facts are retained as reconciliation evidence and do not rewrite `UNKNOWN`.
TASK-091 v1 has no automatic retry or compensation event because it has zero
automatic retries and no compensator.

---

# 51. Notification Event Catalog

## `NOTIFICATION.CREATED`

```yaml
notification_id:
source_event_id:
priority:
audience_type:
audience_id:
template_id:
```

## `NOTIFICATION.SENT`

```yaml
notification_id:
delivery_id:
channel:
recipient:
```

## `NOTIFICATION.DELIVERED`

```yaml
delivery_id:
delivered_at:
```

## `NOTIFICATION.FAILED`

```yaml
delivery_id:
error_code:
attempt_no:
```

## `NOTIFICATION.ACKNOWLEDGED`

```yaml
notification_id:
acknowledged_by:
channel:
acknowledged_at:
```

## `NOTIFICATION.SUPPRESSED`

```yaml
notification_id:
reason:
dedupe_key:
```

## `NOTIFICATION.ESCALATED`

```yaml
notification_id:
from_audience:
to_audience:
reason:
```

---

# 52. Channel Event Catalog

## `MESSAGE.RECEIVED`

```yaml
message_id:
channel:
external_message_id:
conversation_id:
sender_ref:
ticket_id:
received_at:
```

## `MESSAGE.SENT`

```yaml
message_id:
channel:
ticket_id:
recipient_ref:
sent_at:
```

## `MESSAGE.DELIVERY_FAILED`

```yaml
message_id:
channel:
error_code:
retryable:
```

## `CHANNEL.DEGRADED`

```yaml
channel_connection_id:
channel_type:
reason:
last_success_at:
```

## `CHANNEL.AUTH_EXPIRED`

```yaml
channel_connection_id:
channel_type:
expired_at:
```

## `CHANNEL.RECOVERED`

```yaml
channel_connection_id:
recovered_at:
```

---

# 53. Work Queue Event Catalog

## `WORK_ITEM.CREATED`

```yaml
work_item_id:
type:
primary_entity_type:
primary_entity_id:
severity:
owner_team_id:
due_at:
dedupe_key:
```

## `WORK_ITEM.ASSIGNED`

```yaml
work_item_id:
previous_assignee_id:
new_assignee_id:
```

## `WORK_ITEM.ESCALATED`

```yaml
work_item_id:
from_team_id:
to_team_id:
reason:
```

## `WORK_ITEM.OVERDUE`

```yaml
work_item_id:
due_at:
overdue_seconds:
```

## `WORK_ITEM.RESOLVED`

```yaml
work_item_id:
resolution:
resolved_at:
```

## `WORK_ITEM.REOPENED`

```yaml
work_item_id:
reason:
reopened_at:
```

---

# 54. Reporting Event Catalog

## `KPI.WARNING`

```yaml
metric_definition_id:
dimension:
value:
warning_threshold:
measured_at:
```

## `KPI.CRITICAL`

```yaml
metric_definition_id:
dimension:
value:
critical_threshold:
measured_at:
```

## `KPI.RECOVERED`

```yaml
metric_definition_id:
dimension:
value:
measured_at:
```

## `REPORT.GENERATED`

```yaml
report_id:
report_definition_id:
generated_at:
snapshot_at:
```

## `REPORT.FAILED`

```yaml
report_definition_id:
error_code:
scheduled_run_id:
```

---

# 55. Producer Ownership Matrix

| Event Family | Canonical Producer |
|---|---|
| USER / AUTH | identity-service |
| TICKET | helpdesk-service |
| INCIDENT | incident-service |
| MONITORING | monitoring-ingestion |
| AGENT | agent-control-service |
| ASSET / MOVEMENT | asset-service |
| GOODS / WAREHOUSE | warehouse-service |
| MAINTENANCE | maintenance-service |
| WARRANTY | maintenance/warranty service |
| AUDIT | audit-service |
| NETWORK | network-discovery-service |
| SOFTWARE | software-service |
| ARTIFACT | artifact-service |
| LICENSE | license-service |
| PROCUREMENT / PO | procurement-service |
| INVOICE | procurement/finance-integration |
| CONTRACT | contract-service |
| DOCUMENT | document-service |
| APPROVAL | approval-service |
| SLA | sla-service |
| AUTOMATION | automation-service |
| NOTIFICATION / MESSAGE | communication-service |
| WORK_ITEM | work-queue-service |
| KPI / REPORT | reporting-service |

Producer ownership must remain singular for canonical domain events.

---

# 56. Common Consumer Matrix

| Consumer | Typical Events |
|---|---|
| workflow-service | domain state events |
| notification-service | approval/SLA/incident/user-facing events |
| reporting-service | almost all business events |
| search-indexer | user/asset/ticket/incident/network observation/software/license entitlement |
| timeline-projector | asset/user/incident operational events |
| automation-service | trigger events |
| work-queue-service | actionable exceptions/failures |
| audit-service | sensitive state changes |
| integration-service | selected outbound events |

---

# 57. Event → Workflow Mapping Examples

```text
USER.TERMINATED
→ WF-JML03
→ Asset Return
→ License Reclaim
→ Access Revocation
```

```text
MONITORING.CRITICAL
→ WF-003
→ Correlation
→ Root Incident
```

```text
AUDIT.LOCATION_MISMATCH
→ WF-AUD04
→ Correction / Investigation
```

```text
LICENSE.OVERUSED
→ WF-L03
→ Reclaim / Procurement / Exception
```

---

# 58. Event Idempotency Strategy

Producer:

```text
event_id unique
```

Consumer:

```text
inbox(consumer,event_id)
```

Business action:

```text
idempotency_key
```

Example:

```text
ASSET.ASSIGNED event redelivered 3x
```

notification consumer:

```text
dedupe on event_id
```

document consumer:

```text
idempotency_key = assignment:{assignment_id}:handover
```

---

# 59. Event Causation Example

```text
MESSAGE.RECEIVED
  ↓
TICKET.CREATED
  ↓
TICKET.ENRICHED
  ↓
AUTOMATION.STARTED
  ↓
TICKET.RESOLVED
```

Each event:

```text
correlation_id = same
causation_id = immediate previous command/event
```

---

# 60. Cross-domain Saga Example — Offboarding

```text
OFFBOARDING.CREATED (INITIATED)
↓
OFFBOARDING.STARTED (IN_PROGRESS) + USER.TERMINATING
↓
ACCESS.REVOKE_REQUESTED
ASSET.RETURN_REQUESTED
LICENSE.RECLAIM_PENDING
OWNERSHIP.TRANSFER_REQUIRED
↓
partial failure → OFFBOARDING.BLOCKED → OFFBOARDING.RESUMED
↓
clearances verified → OFFBOARDING.READY_TO_CLOSE
↓
USER.TERMINATED → OFFBOARDING.COMPLETED
```

Cancellation from `INITIATED` emits `OFFBOARDING.CANCELLED` only when no
compensation is required. Later cancellation emits
`OFFBOARDING.CANCELLATION_REQUESTED`, runs recovery actions, and emits
`OFFBOARDING.CANCELLED` only after all required recovery succeeds or is
policy-authorized as waived/accepted exception. `OFFBOARDING.COMPLETE` races
`OFFBOARDING.REQUEST_CANCEL` on the case version; only one may commit.

Prefer choreography for simple flows.

Use orchestrator when:

```text
ordering
timeouts
compensation
multi-step dependencies
```

matter strongly.

---

# 61. Command vs Event Catalog Boundary

Examples:

```text
Command:
CreateMaintenanceOrder

Event:
MAINTENANCE.CREATED
```

```text
Command:
ReclaimLicense

Event:
LICENSE.RECLAIMED
```

Commands can fail.

Events describe committed fact.

---

# 62. Observation Event Semantics

Observation event should not imply canonical state change.

Example:

```text
NETWORK.VLAN_MISMATCH
```

means:

```text
observed != expected
```

not:

```text
Asset VLAN changed canonically
```

---

# 63. State Event Semantics

State-change event should only fire after canonical state commit.

Example:

```text
ASSET.ASSIGNED
```

only after:

```text
Assignment created
Asset current assignment updated
transaction committed
```

---

# 64. High-volume Event Handling

Do not publish every telemetry sample to general event bus if volume is high.

Use specialized stream/time-series pipeline for:

```text
CPU
memory
network metrics
heartbeats
```

Publish only significant events:

```text
threshold crossed
state changed
anomaly detected
```

---

# 65. Event Payload Size

Recommended:

```text
small
```

Avoid binary attachments.

Use:

```text
document_id
object_storage_key
report_id
```

instead.

---

# 66. Attachment/Event Reference

Example:

```yaml
evidence:
  document_id:
  checksum:
```

Do not embed base64 files in event payload.

---

# 67. Consumer Failure Classes

```text
TRANSIENT
DATA_INVALID
DEPENDENCY_UNAVAILABLE
BUSINESS_CONFLICT
UNSUPPORTED_VERSION
PERMISSION_DENIED
```

Retry only relevant classes.

---

# 68. Event Observability

Track:

```text
publish latency
consumer lag
retry count
DLQ count
processing duration
schema rejection count
```

---

# 69. Event Trace View

Operator/admin should be able to query:

```text
correlation_id
```

and see:

```text
event sequence
producer
consumer
status
duration
error
```

---

# 70. Event Security

Requirements:

```text
transport encryption
producer authentication
consumer authorization
topic ACL
payload classification
secret redaction
```

---

# 71. Tenant Isolation

Multi-tenant event:

```text
tenant_id
organization_id
```

Consumer must enforce tenant boundaries.

Do not route cross-tenant data unless explicit system workflow.

---

# 72. Event Replay Safety

Before replay:

```text
check consumer idempotency
check side effects
check downstream external integrations
```

Potentially use:

```text
replay_mode = true
```

for analytics/search consumers.

Do not replay destructive external actions blindly.

---

# 73. Rebuildable Consumers

Should be safe to rebuild from events:

```text
search index
reporting projections
timeline projections
operations read models
```

---

# 74. Non-rebuildable Side Effects

Examples:

```text
send email
reboot endpoint
charge payment
change switch config
```

Need explicit idempotency ledger.

---

# 75. Event Compatibility Contract

Producer team must not:

```text
remove field
change type
change meaning
```

within same schema version.

---

# 76. Consumer Contract Testing

Recommended:

```text
schema validation
sample event fixtures
compatibility test
```

before producer release.

---

# 77. Event Schema Registry

Recommended metadata:

```yaml
event_schema:
  event_type:
  version:
  owner:
  json_schema:
  compatibility:
  deprecated:
```

---

# 78. Event Deprecation

Process:

```text
announce
support old+new
migrate consumers
observe usage
retire old version
```

Never silently stop publishing a widely consumed event.

---

# 79. Event Naming Registry Rules

Before new event:

```text
search existing catalog
```

Avoid duplicates like:

```text
ASSET.RETURNED
ASSET.RETURN_COMPLETE
ASSET.RETURN_COMPLETED
```

Choose one canonical event.

---

# 80. Error Event Pattern

Not every failure needs domain event.

Publish failure event if:

```text
business-relevant
actionable
audit-relevant
cross-domain consumer needs it
```

Example:

```text
SOFTWARE.INSTALL_FAILED
```

Yes.

Internal retry loop exception:

```text
temporary DB timeout
```

No domain event required.

---

# 81. Domain Event vs Audit Event

Example:

```text
ASSET.ASSIGNED
```

Domain event informs system.

Audit event records compliance detail.

One business action may create both.

---

# 82. Domain Event vs Timeline Event

Timeline is projection.

Example:

```text
ASSET.ASSIGNED
```

can become:

```text
"Assigned to Nguyễn Văn An"
```

in Asset Timeline.

---

# 83. Event-to-Notification Rule

Notifications must not subscribe directly to every low-level event.

Use routing policy.

Example:

```text
AGENT.ONLINE
```

usually no notification.

```text
INCIDENT.MAJOR_DECLARED
```

yes.

---

# 84. Event-to-Work-Item Rule

Work Item only if:

```text
actionable
owned
non-duplicate
threshold met
```

Example:

```text
NETWORK.UNKNOWN_DEVICE
```

may create Work Item.

```text
DISCOVERY.JOB_COMPLETED
```

usually not.

---

# 85. Event-to-KPI Rule

Reporting consumer can update metric projections from:

```text
state changes
completed workflows
breaches
failures
```

Do not calculate KPI from notification events if canonical domain event exists.

---

# 86. Event Replay Ordering

Replay per aggregate should preserve:

```text
aggregate.version
```

If version gaps:

```text
pause stateful projection
request missing events
or rebuild aggregate projection
```

---

# 87. Event Time Semantics

Use:

```text
occurred_at = business event time
published_at = broker publication time
processed_at = consumer processing time
```

Do not conflate.

---

# 88. Clock Skew

For external events:

```text
source_occurred_at
received_at
```

may both be stored.

Canonical `occurred_at` policy should be explicit.

---

# 89. Integration Event Mapping

External event should first normalize.

Example:

```text
Zabbix trigger
→ external raw event
→ normalize
→ MONITORING.CRITICAL
```

Internal consumers should not depend on raw Zabbix schema.

---

# 90. External Webhook Mapping

Inbound:

```text
validate signature
↓
store raw reference
↓
normalize
↓
publish canonical event
```

---

# 91. External Outbound Event

For third parties:

```text
versioned integration event
```

Do not necessarily expose full internal event schema.

---

# 92. Critical Event Ordering Examples

Need ordering:

```text
ASSET.CREATED
before
ASSET.ASSIGNED
```

```text
APPROVAL.CREATED
before
APPROVAL.APPROVED
```

```text
SLA.STARTED
before
SLA.BREACHED
```

---

# 93. Event Compensation Example

If assignment workflow partially fails:

```text
Assignment created
but notification failed
```

Do not rollback assignment.

Notification retries independently.

If:

```text
license reserved
but software install permanently fails
```

workflow may issue compensation command:

```text
ReclaimLicense
```

leading to:

```text
LICENSE.RECLAIMED
```

---

# 94. Saga State

For orchestrated cross-domain flow:

```yaml
saga_instance:
  id:
  type:
  correlation_id:
  state:
  current_step:
  started_at:
  timeout_at:
```

Optional but useful for:

```text
Offboarding
Replacement
Procurement fulfillment
Major Incident recovery
```

---

# 95. Timeout Events

Workflow timeout may emit:

```text
WORKFLOW.TIMEOUT
```

Payload:

```yaml
workflow_instance_id:
workflow_type:
current_step:
timeout_at:
```

Then:

```text
human fallback
escalation
```

---

# 96. Event Contract Test Checklist

Before publishing new event:

```text
Name canonical?
Producer owner clear?
Envelope complete?
Payload minimal?
No secrets?
Schema registered?
Idempotency considered?
Ordering considered?
Consumers documented?
Retry/DLQ behavior defined?
Backward compatibility checked?
```

---

# 97. Event Definition Template

Use for every future event:

```markdown
## EVENT.TYPE

**Category:** DOMAIN_EVENT  
**Producer:** asset-service  
**Aggregate:** ASSET  
**Partition Key:** asset_id  
**Schema Version:** 1  

### Trigger
...

### Payload
```yaml
...
```

### Consumers
- ...

### Ordering
...

### Idempotency
...

### Retry / DLQ
...

### Security
...

### Downstream Effects
...
```

---

# 98. MVP Event Set

Minimum first implementation:

```text
USER.CREATED
USER.UPDATED
USER.TERMINATED

TICKET.CREATED
TICKET.ASSIGNED
TICKET.RESOLVED

INCIDENT.CREATED
INCIDENT.ROOT.CREATED
INCIDENT.RESOLVED

MONITORING.CRITICAL
MONITORING.RECOVERED

AGENT.OFFLINE_THRESHOLD
AGENT.ONLINE

ASSET.CREATED
ASSET.ASSIGNED
ASSET.RETURN_REQUESTED
ASSET.RETURNED
ASSET.STATE_CHANGED

MAINTENANCE.CREATED
MAINTENANCE.COMPLETED

APPROVAL.CREATED
APPROVAL.APPROVED
APPROVAL.REJECTED

SLA.WARNING
SLA.BREACHED

AUTOMATION.ACTION_FAILED
AUTOMATION.HUMAN_FALLBACK

WORK_ITEM.CREATED
WORK_ITEM.RESOLVED
```

---

# 99. Phase 2 Event Set

Add:

```text
Audit
Network
Software
Artifact
License
Warranty
Replacement
```

---

# 100. Phase 3 Event Set

Add:

```text
Procurement
Invoice
Contract
Advanced Reporting
External Integration Events
```

---

# 101. Implementation Recommendation

Recommended pipeline:

```text
PostgreSQL Transaction
↓
Outbox Table
↓
Publisher
↓
Kafka / NATS / RabbitMQ / equivalent
↓
Consumer
↓
Inbox Table
↓
Domain Handler / Projection
```

Broker choice is implementation-specific.

The contract in this document should remain broker-independent.

---

# 102. Guardrails

System must not:

1. Publish event before domain transaction commits.
2. Assume exactly-once delivery.
3. Let consumer create duplicate side effects on redelivery.
4. Put secrets into event payload.
5. Use external vendor schema as internal canonical event schema.
6. Break schema compatibility silently.
7. Assume global event ordering.
8. Treat observation event as canonical state change.
9. Embed large binary files into events.
10. Retry non-retryable schema errors forever.
11. Replay destructive side effects blindly.
12. Create multiple canonical names for same business fact.
13. Let multiple services publish the same canonical domain event family without ownership rule.
14. Depend on notification events for business state.
15. Lose correlation/causation metadata.
16. Use display code as aggregate identity.
17. Publish giant aggregate snapshots by default.

---

# 103. Definition of Done

Event Catalog đạt yêu cầu khi:

- Có canonical envelope.
- Event naming convention rõ.
- Producer ownership rõ.
- Partition/order strategy rõ.
- At-least-once semantics được giả định.
- Outbox/inbox pattern được chuẩn hóa.
- Retry/DLQ/replay policy rõ.
- Schema evolution/versioning rõ.
- Correlation/causation/idempotency rõ.
- Event families của mọi domain chính được định nghĩa.
- Payload examples không chứa secrets.
- Observation event và state event được phân biệt.
- Event → Workflow/Notification/Work Queue/Reporting relationship rõ.
- MVP event set được xác định.
- Broker implementation không làm thay đổi business contract.

## TASK-092 Advanced Incident Correlation Events

These events describe correlation decisions and relationship facts, never
remediation execution. Use the standard tenant, event ID, aggregate version,
occurred-at, actor, correlation and causation envelope. Payloads reference
canonical IDs and must not embed raw monitoring/topology payloads.

| Event | Required payload references |
|---|---|
| `INCIDENT.CORRELATION_EVALUATED` | subject Incident/event, decision ID, profile ID/version, outcome, candidate decision references, confidence, correlation ID |
| `INCIDENT.CORRELATION_REVIEW_REQUIRED` | subject Incident, decision ID, profile version, candidate Root IDs, reason codes, confidence, Work Item reference |
| `INCIDENT.LINKED_TO_ROOT` | child Incident, Root Incident, relationship ID, decision ID, automatic/manual origin, confidence, reason/evidence references |
| `INCIDENT.DETACHED_FROM_ROOT` | child Incident, Root Incident, relationship ID, actor, reason, suppression reference, correlation ID |
| `INCIDENT.CORRELATION_REJECTED` | subject Incident, decision ID, reviewer, reason, prior machine outcome/evidence reference |
| `ROOT_INCIDENT.CREATED_FROM_CORRELATION` | Root ID, deterministic cluster ID, source type/key reference, contributing Incident IDs, decision ID/profile version |

Decision and relationship records commit with their outbox facts. A redelivered
evaluation cannot duplicate effective link/root/work-item side effects.
Manual attach/reject/detach preserves the original machine decision.
`INCIDENT.CORRELATED` remains the legacy TASK-033 event and does not replace
these TASK-092 decision/history events.

---

## TASK-093 Knowledge Recommendation Events

| Event | Required references / minimal payload |
|---|---|
| `KNOWLEDGE.RECOMMENDATION_CREATED` | tenant, session ID, profile ID/version, outcome, correlation ID |
| `KNOWLEDGE.RECOMMENDATION_PRESENTED` | session ID, item IDs, Knowledge IDs and exact article versions, ranks/scores, presented timestamp |
| `KNOWLEDGE.RECOMMENDATION_SELECTED` | session/item IDs, Knowledge ID/version, actor reference, timestamp |
| `KNOWLEDGE.RECOMMENDATION_FEEDBACK` | session/item IDs, feedback value, actor reference, timestamp |
| `KNOWLEDGE.DEFLECTION_CONFIRMED` | session/item references, explicit `ISSUE_RESOLVED` evidence, deflection type, timestamp |
| `KNOWLEDGE.RECOMMENDATION_ESCALATED` | session ID, canonical Ticket reference, handoff outcome, correlation ID |
| `KNOWLEDGE.KNOWN_INCIDENT_DEFLECTION_CONFIRMED` | session ID, Root Incident reference, Knowledge/version references, confirmation evidence |

Events describe recommendation/session facts only. Use references and
minimum authorized metadata; never embed Knowledge body, protected support
payload, inaccessible candidates or secrets. Article views need not create
compliance audit events. Outbox publication follows committed session/item/
interaction evidence, and idempotent retries do not emit duplicate effective
facts.

## TASK-093-R2A Service Reference Events

The Service Reference owner may emit `SERVICE.CREATED`, `SERVICE.UPDATED`,
`SERVICE.DEACTIVATED`, `PLATFORM.CREATED`, `PLATFORM.UPDATED`,
`PLATFORM.DEACTIVATED`, `SERVICE_ENVIRONMENT.CREATED`,
`SERVICE_ENVIRONMENT.UPDATED` and `SERVICE_ENVIRONMENT.DEACTIVATED`.
Payloads contain canonical entity ID, tenant-safe reference metadata, state
and version only. They must not contain arbitrary observed OS payloads.

## TASK-093-R2 Knowledge Index and Handoff Events

Knowledge audience/applicability changes reuse `KNOWLEDGE.UPDATED` with
Knowledge ID/version and the changed typed metadata references only. The
Search indexer rereads canonical Knowledge and refreshes the existing
projection. Service, Platform, ServiceEnvironment, Software Product and
Problem state events may refresh linked Knowledge search documents. Events
must not contain the Knowledge body. `TICKET.CREATED` may include the typed
source-context reference; it contains no recommendation content or grants.

## TASK-094 Asset Assessment Events

Define/adapt the following reference-based event semantics:

- `ASSET.RISK_ASSESSED`: tenant, Asset ID, Risk assessment ID, profile ID /
  version, score, band, completeness, `as_of`, `valid_until`, correlation ID.
- `ASSET.RISK_BAND_CHANGED`: previous/current band and the new assessment ID;
  emit only when the projected current band changes.
- `ASSET.REPLACEMENT_ASSESSED`: Asset ID, Replacement assessment ID, profile
  ID/version, score, band, completeness, `as_of`, `valid_until`.
- `ASSET.REPLACEMENT_RECOMMENDED`: assessment reference, band and TASK-059
  candidate reference where one was created through the canonical command.

Useful-life policy versioning emits `ASSET.REPLACEMENT_POLICY_VERSIONED`;
verified acquisition evidence emits `ASSET.ACQUISITION_DATE_VERIFIED`.
Assessment events carry `as_of`, `valid_until`, profile/version and
reference-only evidence summaries, sufficient for idempotent downstream
refresh. Events
must not contain full histories, invoices, supplier/commercial documents or
protected Asset payloads. Events describe assessments, not approval or Asset
replacement execution.

## TASK-094-R3 Incident Asset and Warranty projection events

- `INCIDENT.ASSET_LINKED` and `INCIDENT.ASSET_UNLINKED` reference the Incident,
  Asset, link ID, source type/reference, actor, reason and correlation ID.
  They do not embed Incident or Monitoring payloads. Deterministic Monitoring
  links retain the event reference; manual links retain the operator reason.
- `ASSET.WARRANTY_STATE_PROJECTED` references Asset ID, canonical state,
  `WARRANTY_STATE_V1` version, UTC evaluation date, evidence reference and
  reason code. Emit only for a changed state/evidence/policy projection;
  refresh replay has no duplicate event. Warranty source mutations continue
using Maintenance-owned Warranty events.

TASK-095-R2 state-transition history is not a second event publisher. The
state-history trigger appends only domain evidence in the same transaction;
owning commands retain their existing outbox/audit responsibilities and one
command must not emit duplicate external events because history is enabled.
Transition records reference the entity version/sequence and effective time.

`SLA.TARGET_PURPOSE_CLASSIFIED` is emitted by the canonical authorized
classification command after its database transaction commits through the
outbox. It references the SLA target, prior and resulting typed purpose,
target version, reason, actor, correlation and idempotency context. It does not
contain SLA clocks or Ticket contents. The append-only target-purpose history
is persistence evidence and does not independently publish an event.

### TASK-096 recommendation projection events

Recommendation Layer may emit only recommendation-owned events equivalent to
`RECOMMENDATION.PROJECTED`, `RECOMMENDATION.SUPERSEDED`,
`RECOMMENDATION.SOURCE_RESOLVED` and `RECOMMENDATION.DISMISSED`. Payloads
reference recommendation/revision, family, source domain/type/ID and source
generation with minimal reason/evidence summary, tenant, actor where relevant,
correlation and causation. These events describe projection/interaction facts;
they are not Incident, Knowledge, Asset, Work Queue, Procurement or Automation
commands. Source events are consumed idempotently through the application
projection path; Recommendation events never invoke source mutations.

TASK-096 v1 uses periodic source reconciliation and does not publish a new Recommendation outbox event. A DISMISSED interaction is audited; source-domain events/audits remain authoritative for their workflows.
