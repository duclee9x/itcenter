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
CONTRACT.RENEWAL.STARTED
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
```

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
risk_state:
investigation_id:
```

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

```yaml
goods_receipt_id:
purchase_order_id:
accepted_quantity:
rejected_quantity:
```

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
```

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
```

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
software_product_id:
detected_version:
classification:
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
grace_until:
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
supplier_ids:
due_at:
```

## `QUOTATION.RECEIVED`

```yaml
quotation_id:
rfq_id:
supplier_id:
quote_number:
total:
currency:
valid_until:
```

## `SUPPLIER.SELECTED`

```yaml
procurement_request_id:
supplier_id:
quotation_id:
selection_reason:
```

## `PO.CREATED`

```yaml
purchase_order_id:
po_code:
supplier_id:
procurement_request_id:
version:
```

## `PO.ISSUED`

```yaml
purchase_order_id:
version:
issued_at:
expected_delivery:
```

## `PO.AMENDED`

```yaml
purchase_order_id:
previous_version:
new_version:
material_changes:
```

## `PO.PARTIALLY_RECEIVED`

```yaml
purchase_order_id:
goods_receipt_id:
received_summary:
remaining_summary:
```

## `PO.FULLY_RECEIVED`

```yaml
purchase_order_id:
completed_at:
```

## `PO.DELIVERY_OVERDUE`

```yaml
purchase_order_id:
expected_delivery:
remaining_lines:
days_overdue:
```

---

# 45. Invoice Event Catalog

## `INVOICE.RECEIVED`

```yaml
invoice_id:
supplier_id:
invoice_number:
purchase_order_id:
gross_amount:
currency:
```

## `INVOICE.DUPLICATE_DETECTED`

```yaml
invoice_id:
existing_invoice_id:
supplier_id:
invoice_number:
```

## `INVOICE.MATCH_STARTED`

```yaml
invoice_id:
purchase_order_id:
```

## `INVOICE.MATCHED`

```yaml
invoice_id:
match_result_id:
result:
tolerance_used:
```

## `INVOICE.MISMATCH`

```yaml
invoice_id:
match_result_id:
mismatch_types:
variance_summary:
```

## `INVOICE.APPROVED`

```yaml
invoice_id:
approved_by:
approval_request_id:
```

## `INVOICE.PAID`

```yaml
invoice_id:
payment_reference:
paid_at:
```

---

# 46. Contract Event Catalog

## `CONTRACT.CREATED`

```yaml
contract_id:
contract_code:
supplier_id:
contract_type:
effective_from:
effective_to:
```

## `CONTRACT.ACTIVE`

```yaml
contract_id:
activated_at:
```

## `CONTRACT.EXPIRING`

```yaml
contract_id:
effective_to:
days_remaining:
notice_deadline:
```

## `CONTRACT.RENEWAL_STARTED`

```yaml
contract_id:
renewal_id:
target_end_date:
```

## `CONTRACT.RENEWED`

```yaml
contract_id:
previous_end_date:
new_end_date:
new_value:
currency:
```

## `CONTRACT.SLA_BREACH`

```yaml
contract_id:
supplier_id:
breach_type:
source_entity_type:
source_entity_id:
```

## `CONTRACT.TERMINATED`

```yaml
contract_id:
terminated_at:
reason:
```

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
action_execution_id:
verification_result:
duration_ms:
```

## `AUTOMATION.ACTION_FAILED`

```yaml
action_execution_id:
error_code:
retryable:
attempt:
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
| search-indexer | user/asset/ticket/incident/software |
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
USER.TERMINATING
↓
ACCESS.REVOKE_REQUESTED
ASSET.RETURN_REQUESTED
LICENSE.RECLAIM_PENDING
OWNERSHIP.TRANSFER_REQUIRED
↓
responses/events
↓
OFFBOARDING.COMPLETED
```

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
