# ERROR + RETRY + IDEMPOTENCY STANDARD
## IT Operations Hub — Failure Handling, Resilience, and Duplicate-Safety Standard

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `STATE_MACHINE_MASTER_SPEC.md`  
**Depends on:**  
- `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `API_COMMAND_CONTRACT_SPEC.md`
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`

**Purpose:** Standardize error taxonomy, retryability, retry budgets, exponential backoff, idempotency ledgers, deduplication keys, duplicate command/event handling, workflow retries, consumer retries, dead-letter queues, circuit breakers, timeouts, compensating actions, partial failure handling, and operator recovery.

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa toàn bộ cách hệ thống xử lý lỗi.

Chuỗi nền tảng:

```text
Operation
→ Error
→ Classify
→ Retryable?
├─ YES
│   → Retry Budget
│   → Backoff
│   → Verify
│   → Success / Exhausted
└─ NO
    → Fail Fast
        ↓
Compensate / Human Fallback / DLQ
```

Song song:

```text
Command / Event / Webhook / Job
→ Idempotency Check
→ New?
├─ YES → Execute
└─ NO  → Return Previous Result / Ignore Duplicate
```

Mục tiêu:

- phân biệt lỗi transient và permanent;
- retry có giới hạn, không retry vô hạn;
- tránh retry storm;
- retry không tạo side effect trùng;
- mọi write operation quan trọng phải idempotent;
- lỗi cross-domain phải có compensation thay vì "rollback giả";
- consumer xử lý at-least-once delivery an toàn;
- async job có recovery path;
- operator nhìn được lỗi nào cần xử lý;
- mọi retry/failure đều traceable bằng correlation ID.

---

# 2. Core Concepts

```text
ERROR
FAILURE
RETRY
RETRY BUDGET
BACKOFF
TIMEOUT
IDEMPOTENCY
DEDUPLICATION
CIRCUIT BREAKER
DEAD LETTER QUEUE
COMPENSATION
PARTIAL FAILURE
HUMAN FALLBACK
RECOVERY
```

---

# 3. Error Taxonomy

Canonical categories:

```text
VALIDATION
AUTHENTICATION
AUTHORIZATION
CONFLICT
BUSINESS_RULE
DEPENDENCY
TRANSIENT_INFRASTRUCTURE
TIMEOUT
RATE_LIMIT
NOT_FOUND
DUPLICATE
UNSUPPORTED
DATA_INTEGRITY
SECURITY
EXTERNAL_PROVIDER
INTERNAL_BUG
UNKNOWN
```

---

# 4. Error Severity

```text
INFO
WARNING
ERROR
CRITICAL
```

Severity answers:

```text
How much operational attention is needed?
```

Retryability answers:

```text
Will retry likely help?
```

Hai khái niệm không giống nhau.

---

# 5. Retryability Classes

```text
RETRY_IMMEDIATE
RETRY_WITH_BACKOFF
RETRY_AFTER
DO_NOT_RETRY
RETRY_AFTER_HUMAN_ACTION
```

---

# 6. Canonical Error Object

```yaml
error:
  code:
  category:
  message:
  severity:
  retryability:
  retry_after:
  retry_budget_remaining:
  dependency:
  details:
  correlation_id:
  causation_id:
  occurred_at:
```

---

# 7. Error Code Convention

Pattern:

```text
DOMAIN_SPECIFIC_REASON
```

Examples:

```text
ASSET_ALREADY_ASSIGNED
ASSET_INVALID_STATE
LICENSE_POOL_EXHAUSTED
INVOICE_DUPLICATE
AGENT_OFFLINE
DEPENDENCY_TIMEOUT
NETWORK_CHANGE_VERIFICATION_FAILED
APPROVAL_REQUIRED
VERSION_CONFLICT
RATE_LIMITED
```

Avoid:

```text
ERR_001
FAILED
UNKNOWN_ERROR_2
```

Goods Receipt uses these canonical receiving failures:

| Code | Category | HTTP / retry behavior |
|---|---|---|
| `GOODS_RECEIPT_OVER_ORDERED_QUANTITY` | BUSINESS_RULE | 422; non-retryable until accepted quantity/request changes. No partial commit. |
| `GOODS_RECEIPT_PO_NOT_RECEIVABLE` | CONFLICT | 409; reload PO and issue a new command only if its state permits receiving. |
| `GOODS_RECEIPT_BLOCKING_EXCEPTION` | BUSINESS_RULE | 422; resolve the referenced receiving exception before a new POST. |
| `GOODS_RECEIPT_UNIT_IDENTITY_DUPLICATE` | DUPLICATE | 409; correct draft identity and submit a new request. |

TASK-074 Invoice/Credit Note failures use these durable outcomes:

| Code | Category | HTTP / retry behavior |
|---|---|---|
| `INVOICE_DUPLICATE` | DUPLICATE | 409; non-retryable for this submitted supplier document identity. A new corrected document must use its actual supplier-issued number. |
| `INVOICE_MATCH_EXCEPTION_REQUIRED` | CONFLICT | 409; do not retry approval until the current mismatch has a linked approved exception. |
| `INVOICE_APPROVAL_STALE` | CONFLICT | 409; obtain/re-evaluate approval against the current immutable invoice and match fingerprint. |
| `CREDIT_NOTE_OVER_CREDITABLE_AMOUNT` | BUSINESS_RULE | 422; reload remaining creditable line quantity/amount and submit a corrected command. |

Invoice document-number uniqueness is independent from request idempotency.
`INVOICE.SUBMIT` atomically inserts the normalized identity reservation
`(tenant_id, supplier_id, document_type, supplier_document_number_normalized)`;
a unique-index race maps to `INVOICE_DUPLICATE`, not a generic SQL error. The
reservation remains durable after submission, including terminal outcomes.
Exact command replay with the same idempotency key and semantic payload returns
the original result; same key with a different payload is
`IDEMPOTENCY_KEY_CONFLICT`. A different key cannot bypass document uniqueness.

Concurrent match allocation and Credit Note application are business
concurrency conflicts, not transient retries. Re-read authoritative
PO/receipt/allocation or remaining credit state and issue a new command only
after reevaluation. Never blind-retry an uncertain Credit Note application;
read its durable result first.

Same idempotency key with a different semantic command remains
`IDEMPOTENCY_KEY_CONFLICT` (409).

---

# 8. HTTP/API Error Mapping

| Error Category | HTTP |
|---|---:|
| Validation | 400 |
| Authentication | 401 |
| Authorization | 403 |
| Not Found | 404 |
| Version / Duplicate / State Conflict | 409 |
| Business Rule | 422 |
| Rate Limit | 429 |
| Dependency Unavailable | 503 |
| Timeout | 504 |
| Internal Bug | 500 |

---

# 9. Fail Fast Principle

Do not retry:

```text
invalid schema
permission denied
business rule violation
unsupported state
duplicate invoice
invalid signature
terminal state conflict
```

unless underlying state changes externally and a new command is issued.

---

# 10. Transient Error Examples

Usually retryable:

```text
temporary DB connection issue
broker unavailable
HTTP 503
HTTP 429
temporary DNS failure
network timeout
external API transient failure
temporary object storage issue
```

---

# 11. Permanent Error Examples

Usually not retryable:

```text
invalid credentials
permission denied
invalid payload
resource deleted
artifact signature invalid
invoice duplicate
invalid lifecycle transition
```

---

# 12. Retry Budget

Every retrying component must define:

```yaml
retry_policy:
  max_attempts:
  max_elapsed_time:
  backoff:
  retryable_errors:
  non_retryable_errors:
```

No component may retry indefinitely.

---

# 13. Default Retry Policy Classes

## Interactive API

```text
max attempts: 1 internal retry
total budget: < 3s additional
```

## Background Job

```text
max attempts: 5
budget: minutes
```

## External Integration

```text
max attempts: 8
budget: hours
```

## Critical Notification

```text
multiple channel attempts
with fallback
```

---

# 14. Backoff Strategies

Supported:

```text
FIXED
LINEAR
EXPONENTIAL
EXPONENTIAL_WITH_JITTER
```

Preferred default:

```text
EXPONENTIAL_WITH_JITTER
```

---

# 15. Example Backoff

```text
Attempt 1 → 5s
Attempt 2 → 15s
Attempt 3 → 45s
Attempt 4 → 2m
Attempt 5 → 5m
```

with jitter.

---

# 16. Jitter

Purpose:

```text
prevent thundering herd
```

Example:

```text
delay = base_delay ± random_jitter
```

---

# 17. Retry-After Support

If provider returns:

```http
Retry-After: 60
```

respect it within configured maximum.

---

# 18. Timeout Classes

```text
CONNECT_TIMEOUT
READ_TIMEOUT
COMMAND_TIMEOUT
JOB_TIMEOUT
WORKFLOW_TIMEOUT
APPROVAL_TIMEOUT
DEPENDENCY_TIMEOUT
```

---

# 19. Timeout Principle

Every remote dependency call must have:

```text
connect timeout
request timeout
total operation timeout
```

No unbounded wait.

---

# 20. Timeout Is Not Always Failure

Example:

```text
API client timed out
```

but backend may have committed successfully.

Therefore write retry must use:

```text
Idempotency-Key
```

---

# 21. Idempotency Principle

A command is idempotent when repeating it with the same intent does not create additional business side effects.

Example:

```text
Assign Asset
```

retry should not create:

```text
second Assignment
second Movement
second Handover
```

---

# 22. Idempotency Key Scope

Key uniqueness should include:

```text
principal
operation
business scope
```

Example:

```text
assign:asset-42:user-18:v1
```

---

# 23. Idempotency Ledger

```yaml
idempotency_records:
  id:
  idempotency_key:
  operation:
  principal_id:
  request_hash:
  state:
  result_reference:
  response_status:
  created_at:
  expires_at:
```

---

# 24. Idempotency States

```text
IN_PROGRESS
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
EXPIRED
```

---

# 25. Same Key, Same Payload

Behavior:

```text
return original result
```

if already completed.

If still running:

```text
409 OPERATION_IN_PROGRESS
```

or return operation resource.

---

# 26. Same Key, Different Payload

Return:

```text
409 IDEMPOTENCY_KEY_CONFLICT
```

Never silently execute.

---

# 27. Idempotency TTL

TTL depends on operation.

Examples:

```text
Ticket create: 24h+
Invoice import: long-lived
Payment callback: very long
Agent heartbeat: short
Bulk import chunk: medium
```

Financial/business identity keys may need durable retention.

---

# 28. Business Natural Key

Some operations also need domain duplicate constraints.

Example Invoice:

```text
tenant_id + supplier_id + document_type + supplier_document_number_normalized
```

even if Idempotency-Key differs.

Idempotency does not replace business uniqueness.

---

# 29. Event Consumer Idempotency

Consumer uses:

```text
consumer_name + event_id
```

Unique inbox record.

Redelivery:

```text
already processed
→ ACK safely
```

---

# 30. Event Handler Side Effect Idempotency

Example:

```text
ASSET.ASSIGNED
→ Generate handover document
```

Use derived key:

```text
handover:assignment_id
```

Not merely event delivery count.

## 30.1 Receipt-to-Asset Registration

`GOODS_RECEIPT.POSTED` consumption is at-least-once. The consumer uses its
durable inbox by event ID and invokes the Asset-owned
`ASSET.REGISTER_RECEIVED` command with stable `received_unit_id` as the
per-unit idempotency identity. Duplicate delivery or command retry returns
the original Asset registration result and cannot create a second Asset.

Asset registration is an asynchronous downstream effect. Failure never
changes/unposts the canonical POSTED receipt. Apply a bounded retry policy for
retryable dependency/technical errors; do not blindly retry validation,
duplicate-identity or business-rule failures. After retry exhaustion, retain
the failure and create actionable Work Queue/human fallback linked to the
receipt unit. Expose assetization status/failure for reconciliation. Inbox,
idempotency, outbox and work creation must prevent duplicate Assets or
duplicate actionable work on redelivery.

---

# 31. Webhook Deduplication

Inbound provider webhook:

```text
provider_event_id
```

Unique per connection/provider.

Fallback:

```text
payload hash + timestamp window
```

only if provider lacks ID.

---

# 32. Email Deduplication

Use:

```text
Message-ID
provider message ID
```

not subject.

---

# 33. Agent Job Idempotency

Agent jobs carry:

```text
job_id
idempotency_key
```

Agent stores completed job IDs.

Duplicate job delivery:

```text
return prior result
```

---

# 34. Deployment Idempotency

Software deploy key:

```text
asset_id + artifact_version_id + deployment_intent_version
```

Before reinstall:

```text
check actual installed state
```

---

# 35. License Assignment Idempotency

Do not create duplicate active assignment for same:

```text
entitlement
principal
license model
```

if policy forbids duplicates.

---

# 36. Asset Assignment Idempotency

Check:

```text
same asset
same active assignment
same target user
same business request
```

Return existing assignment when semantically same.

---

# 37. Movement Idempotency

Movement tied to:

```text
operation_id
```

One business operation should generate one movement.

---

# 38. Workflow Retry

Workflow step must declare:

```text
idempotent?
retryable?
compensation?
timeout?
```

---

# 39. Workflow Step Types

```text
PURE
IDEMPOTENT_WRITE
NON_IDEMPOTENT_EXTERNAL
COMPENSATABLE
HUMAN
```

---

# 40. Pure Step

Examples:

```text
calculate score
validate context
resolve policy
```

Safe to retry.

---

# 41. Idempotent Write Step

Examples:

```text
create work item with dedupe key
create reservation with request ID
```

Safe if idempotency enforced.

---

# 42. Non-idempotent External Step

Examples:

```text
legacy vendor API without idempotency
send physical shipment
financial charge
```

Requires special ledger/check-before-retry.

---

# 43. Human Step

Never auto-retry a human decision.

Examples:

```text
approval
manual confirmation
audit verification
```

Instead:

```text
remind
escalate
expire
```

---

# 44. Partial Failure

Example:

```text
Asset assignment committed
Notification failed
```

Result:

```text
assignment remains valid
notification retries independently
```

Do not rollback core business state for non-critical async failure.

---

# 45. Atomic vs Async Side Effects

## Atomic

Must all succeed locally:

```text
create assignment
close reservation
update asset current owner
create movement
write outbox
```

## Async

Can retry separately:

```text
send email
generate PDF
update search index
update metrics
```

---

# 46. Compensation Principle

If distributed step A succeeds and B fails permanently:

```text
issue compensating command
```

Example:

```text
License reserved
↓
Deployment permanently fails
↓
LICENSE.RECLAIM
```

---

# 47. Compensation Must Be Explicit

Compensation is not:

```text
DELETE original record
```

It is:

```text
new business action
new audit event
```

---

# 48. Compensation State

Saga may enter:

```text
COMPENSATING
COMPENSATED
COMPENSATION_FAILED
```

---

# 49. Compensation Failure

If compensation fails:

```text
create high-priority Work Item
```

with:

```text
original action
failed step
compensation attempts
current business risk
```

---

# 50. Circuit Breaker

Used around unstable dependencies.

States:

```text
CLOSED
OPEN
HALF_OPEN
```

---

# 51. Circuit Breaker Behavior

```text
CLOSED
→ normal traffic

Failure threshold reached
→ OPEN

OPEN
→ fail fast

Cooldown elapsed
→ HALF_OPEN

Test succeeds
→ CLOSED

Test fails
→ OPEN
```

---

# 52. Circuit Breaker Candidate Dependencies

```text
ERP
Email Provider
Teams/Slack
SaaS License API
Vendor Warranty API
External CMDB
Object Storage
External Identity Provider
```

---

# 53. Circuit Breaker Guardrail

Do not use circuit breaker to mask:

```text
internal business validation failure
```

---

# 54. Bulkhead Isolation

Separate resource pools for:

```text
notifications
report generation
network discovery
software deployment
external integrations
```

to avoid one failing subsystem exhausting all workers.

---

# 55. Concurrency Limit

Per dependency/job type:

```text
max concurrent requests
max jobs per site
max agent actions
max network scans
```

---

# 56. Rate Limit Handling

If internal limit reached:

```text
queue
```

if safe.

If external provider rate limits:

```text
respect Retry-After
```

---

# 57. Retry Storm Protection

Use:

```text
jitter
circuit breaker
retry budget
global concurrency limit
dependency-aware backpressure
```

---

# 58. Backpressure

If consumer lag too high:

```text
slow producers if possible
scale consumers
prioritize critical messages
shed non-critical workload
```

---

# 59. Dead Letter Queue Principle

DLQ only after retry budget exhausted or non-retryable processing error.

DLQ is not "trash".

---

# 60. DLQ Record

```yaml
dlq:
  id:
  source:
  event_id:
  consumer:
  payload_ref:
  error_code:
  attempts:
  first_failed_at:
  last_failed_at:
  correlation_id:
  state:
```

---

# 61. DLQ States

```text
OPEN
INVESTIGATING
READY_TO_REPLAY
REPLAYED
DISCARDED
```

---

# 62. DLQ Replay

Before replay:

```text
root cause fixed?
consumer idempotent?
side effect safe?
schema supported?
```

---

# 63. Replay Modes

```text
SAFE_REPLAY
PROJECTION_REBUILD
MANUAL_CONFIRM
```

---

# 64. Projection Replay

Safe candidates:

```text
search index
timeline
reporting metrics
operations read model
```

---

# 65. Destructive Replay

Never blindly replay:

```text
reboot
network change
data wipe
payment
external provisioning
```

---

# 66. Retry Ownership

Each layer owns its own retry.

Avoid:

```text
API retries 5x
+
service retries 5x
+
HTTP client retries 5x
```

causing 125 attempts.

---

# 67. Retry Budget Propagation

Request may carry:

```text
deadline
remaining retry budget
```

to downstream services.

---

# 68. Retry Layer Guidance

## Client

Retry only:

```text
safe GET
idempotent command
429
503
network timeout
```

## Service

Retry only direct transient dependency call.

## Workflow

Retry business step according to workflow policy.

## Broker Consumer

Retry message processing according to consumer policy.

---

# 69. API Retry Contract

Response error includes:

```yaml
retryable: true
retry_after_seconds: 30
```

where appropriate.

---

# 70. Dependency Error Mapping

External error:

```text
HTTP 503
```

normalize to internal:

```text
DEPENDENCY_UNAVAILABLE
```

Keep raw provider code in internal diagnostics.

---

# 71. External Provider Error Taxonomy

Normalize:

```text
PROVIDER_AUTH_FAILED
PROVIDER_RATE_LIMITED
PROVIDER_TIMEOUT
PROVIDER_UNAVAILABLE
PROVIDER_BAD_RESPONSE
PROVIDER_RESOURCE_NOT_FOUND
```

---

# 72. Database Errors

Retryable:

```text
deadlock
serialization failure
temporary connection interruption
```

Non-retryable:

```text
unique constraint violation
check constraint violation
foreign key violation
```

unless mapped to expected domain conflict.

---

# 73. Unique Constraint Handling

Example:

```text
invoice/credit-note normalized supplier-document identity unique violation
```

map to:

```text
INVOICE_DUPLICATE
```

not generic 500.

---

# 74. Version Conflict Handling

Optimistic concurrency conflict:

```text
VERSION_CONFLICT
```

Usually:

```text
DO_NOT_RETRY automatically
```

Client should reload and re-evaluate intent.

---

# 75. Deadlock Handling

DB deadlock:

```text
retry transaction
```

with short bounded retry.

---

# 76. Transaction Retry

Transaction must be deterministic and idempotent with respect to business intent.

---

# 77. Lock Timeout

Do not wait indefinitely.

Map to:

```text
RESOURCE_BUSY
```

or retryable conflict.

---

# 78. Resource Busy

Example:

```text
Asset currently being transferred
```

Return:

```text
409 OPERATION_IN_PROGRESS
```

with operation ID if known.

---

# 79. Dependency Freshness Failure

Example:

```text
network data stale
```

This is not necessarily infrastructure failure.

Return:

```text
CONTEXT_STALE
```

Policy determines:

```text
proceed
refresh
human review
```

---

# 80. Context Missing

Example:

```text
no owner
unknown warranty
missing location
```

Do not always retry.

May create:

```text
DATA_QUALITY_EXCEPTION
```

---

# 81. Human Fallback Standard

Create Work Item with:

```yaml
human_fallback:
  reason:
  failed_operation:
  current_state:
  attempts:
  last_error:
  recommended_actions:
  evidence:
  correlation_id:
```

---

# 82. Human Fallback Priority

Derived from:

```text
business impact
risk
SLA
failed automation criticality
```

---

# 83. Failed Automation

If safe automation fails:

```text
retry within budget
↓
verify
↓
human fallback
```

Do not loop indefinitely.

---

# 84. Failed Notification

Notification failure should not reopen business transaction.

Retry/fallback:

```text
Teams failed
→ Email fallback
```

---

# 85. Failed Document Generation

If core workflow succeeded:

```text
business state remains
```

Document job retries independently.

If document is required before completion:

```text
workflow waits in explicit state
```

---

# 86. Failed Search Index Update

Do not fail business command.

Queue retry / rebuild projection.

---

# 87. Failed Reporting Projection

Do not fail source domain transaction.

Mark report data stale.

---

# 88. Failed Audit Write

Audit write for high-risk mutation may be part of local transaction.

If audit persistence unavailable and policy requires it:

```text
fail command
```

---

# 89. Audit Failure Classification

For high-risk actions:

```text
AUDIT_UNAVAILABLE
→ DO_NOT_PROCEED
```

For low-risk read logs:

```text
best effort
```

if policy permits.

---

# 90. Saga Timeout

If orchestration waits too long:

```text
SAGA_TIMEOUT
```

Then:

```text
retry step
compensate
escalate
```

depending workflow.

---

# 91. Approval Timeout

Not a technical retry.

Outcome:

```text
EXPIRED
ESCALATED
AUTO_REJECT
```

per policy.

---

# 92. SLA Timer Failure

SLA engine outage should not lose timers.

Use durable persisted schedule/state.

On recovery:

```text
recalculate elapsed business time
emit missed threshold events if needed
```

---

# 93. Scheduled Job Recovery

Job runner restart:

```text
reclaim expired leases
resume safe jobs
detect abandoned RUNNING jobs
```

---

# 94. Job Lease

Long-running worker holds:

```text
lease_until
worker_id
heartbeat
```

If lease expires:

```text
job becomes recoverable
```

---

# 95. Job Ownership Transfer

New worker may take job only if:

```text
previous lease expired
```

and step is safe/idempotent.

---

# 96. Operation Recovery State

Operations may use:

```text
RECOVERING
```

for system restart recovery.

---

# 97. External Callback Deduplication

Callback key:

```text
provider_job_id + callback_type + sequence
```

---

# 98. Out-of-order Callback

Use:

```text
provider sequence
operation version
timestamp
```

Ignore stale callback if a newer terminal state already exists.

---

# 99. Duplicate Event Ordering

If version 18 processed before 17:

Policy:

```text
buffer
request replay
rebuild projection
```

for stateful consumers.

Stateless consumers may tolerate.

---

# 100. Poison Message

Message repeatedly crashes consumer due payload bug.

After limited attempts:

```text
DLQ
```

Do not block entire partition indefinitely if platform permits safe skip.

---

# 101. Error Observability

Track:

```text
error rate
retry count
retry success rate
DLQ count
circuit breaker openings
timeout rate
idempotency hits
duplicate prevented count
compensation count
human fallback count
```

---

# 102. Error Correlation

Every error log should include:

```text
request_id
correlation_id
causation_id
operation_id
entity_id
```

where available.

---

# 103. Structured Logging

Example:

```json
{
  "level": "ERROR",
  "error_code": "DEPENDENCY_TIMEOUT",
  "service": "license-service",
  "dependency": "vendor-api",
  "correlation_id": "corr-123",
  "retryable": true,
  "attempt": 3
}
```

---

# 104. Redaction

Never log:

```text
password
access token
refresh token
API secret
private key
full license key
sensitive document content
```

---

# 105. Alert Thresholds

Alert on:

```text
retry exhaustion spike
DLQ growth
circuit open
idempotency conflict spike
compensation failure
critical workflow timeout
```

---

# 106. Error Work Queue

Only actionable failures create Work Item.

Examples:

```text
Automation exhausted retries
DLQ business event
Compensation failed
Integration auth expired
Critical callback missing
```

---

# 107. Non-actionable Errors

Examples:

```text
single transient retry success
temporary 429 handled
duplicate event safely ignored
```

Should not spam Work Queue.

---

# 108. Retry Metrics by Domain

Examples:

```text
Agent action retry success
Software deployment retry rate
Webhook retry success
Network discovery retry rate
Invoice import duplicate rate
```

---

# 109. Idempotency Metrics

Track:

```text
idempotency hit count
payload conflict count
natural duplicate prevention count
duplicate webhook suppression
duplicate event suppression
```

---

# 110. Domain-Specific Retry Matrix

| Operation | Retry? | Notes |
|---|---|---|
| Ticket create | Yes, idempotent | Use Idempotency-Key |
| Asset assign | Yes, idempotent | Version + key |
| Asset dispose | No blind retry | Check operation state first |
| Agent restart | Limited | Cooldown |
| Software install | Limited | Verify actual installed state |
| VLAN change | No blind retry | Change + verification |
| License reclaim | Yes if idempotent | Check current assignment state |
| Invoice import | Yes | Natural key + idempotency |
| Email send | Yes | Delivery dedupe |
| Data wipe | No blind retry | Job state/evidence check |
| Report generation | Yes | Safe async |
| Search indexing | Yes | Projection rebuildable |

---

# 111. Compensation Matrix

| Workflow | Failure | Compensation |
|---|---|---|
| Asset Assignment | Handover cancelled | End assignment, release asset |
| Software Request | Install fails | Reclaim reserved license |
| Replacement | Migration fails | Keep old asset active |
| Procurement | PO cancelled | Release reservation/budget hold |
| VLAN Change | Verification fails | Restore previous VLAN |
| Offboarding | Asset return delayed | Keep case blocked, do not restore access |
| Deployment | New version unhealthy | Roll back version |

---

# 112. Error Response UX

User-facing:

```text
clear
actionable
non-technical
```

Operator-facing:

```text
error code
reason
retry status
context
recommended action
```

---

# 113. User-safe Error Example

Instead of:

```text
SQLSTATE 23505
```

show:

```text
"This invoice already exists."
```

Internal details retain DB constraint info.

---

# 114. Retry Button Policy

UI may show:

```text
Retry
```

only if:

```text
operation is safe to retry
```

Otherwise:

```text
Investigate
Open Work Item
Refresh State
```

---

# 115. Retry After State Refresh

For conflict:

```text
refresh
show changed state
ask user to confirm intent again
```

not silent retry.

---

# 116. Bulk Operation Partial Failure

Return:

```text
success count
failed count
skipped count
per-item reason
```

Retry only failed eligible items.

---

# 117. Bulk Retry Idempotency

Each item should have:

```text
item-level operation key
```

not just one batch key.

---

# 118. Import Job Deduplication

Use:

```text
import_batch_id
source_file_hash
row business key
```

---

# 119. CSV Import Error Handling

Rows:

```text
VALID
INVALID
DUPLICATE
CONFLICT
```

Do not reject entire file unless atomic import requested.

---

# 120. File Upload Retry

Use resumable upload if needed.

Finalization must verify:

```text
checksum
size
mime type
```

before creating document version.

---

# 121. Object Storage Error

Upload success uncertain?

Check:

```text
object key
checksum
```

before reupload.

---

# 122. Broker Publish Failure

Outbox remains unpublished.

Publisher retries.

Business transaction remains committed.

---

# 123. Consumer Processing Failure

Do not mark inbox processed until handler succeeds.

---

# 124. Outbox Poison Event

If serialization/publish repeatedly fails:

```text
Outbox Failure Queue
```

High priority if business event cannot leave service.

---

# 125. Idempotency and Concurrency Together

For write command:

```text
Idempotency-Key
+
expected_version
```

solve different problems.

Idempotency:

```text
same intent repeated
```

Concurrency:

```text
state changed by someone else
```

---

# 126. Retry and SLA

Retry time may consume SLA unless policy pauses for external dependency.

Must be explicit.

---

# 127. Retry and Approval

Retrying technical step must not create duplicate approval.

Approval key derived from:

```text
source entity + policy version + approval intent version
```

---

# 128. Retry and Notification

Notification dedupe key prevents repeated alerts from retry loops.

---

# 129. Retry and Automation Cooldown

Even if trigger repeats:

```text
cooldown
```

may suppress duplicate remediation.

---

# 130. Error Policy Object

```yaml
error_policy:
  operation_type:
  retryable_errors:
  max_attempts:
  max_elapsed_time:
  backoff:
  timeout:
  circuit_breaker:
  fallback:
  compensation:
```

---

# 131. Retry Policy Ownership

Owner must be domain/service team.

Do not leave retries as library defaults only.

---

# 132. Default Policy Prohibition

Library default:

```text
retry all exceptions 3 times
```

is forbidden for business writes.

Retries must be explicit.

---

# 133. Chaos / Failure Testing

Test:

```text
broker unavailable
DB deadlock
external 429
external timeout
duplicate webhook
duplicate command
consumer crash after side effect
worker crash mid-job
out-of-order callback
```

---

# 134. Idempotency Test Cases

For every critical command:

```text
same request 2x
same request 10x
timeout then retry
parallel duplicate requests
same key different payload
```

---

# 135. Compensation Test Cases

Test:

```text
step A commit
step B permanent fail
compensation succeeds
compensation fails
```

---

# 136. DLQ Operational Runbook

Operator steps:

```text
Identify error category
Check dependency/schema
Fix root cause
Assess replay safety
Replay selected
Verify downstream state
Close DLQ item
```

---

# 137. Circuit Breaker Runbook

When open:

```text
check dependency
check auth/token
check rate limit
check network
observe half-open recovery
manual reset only if policy allows
```

---

# 138. Retry Exhaustion Event

Canonical:

```text
OPERATION.RETRY_EXHAUSTED
```

Payload:

```yaml
operation_id:
operation_type:
target_type:
target_id:
attempts:
last_error_code:
human_fallback_work_item_id:
```

---

# 139. Compensation Events

```text
COMPENSATION.STARTED
COMPENSATION.COMPLETED
COMPENSATION.FAILED
```

---

# 140. DLQ Events

```text
DLQ.ITEM_CREATED
DLQ.ITEM_REPLAYED
DLQ.ITEM_DISCARDED
```

---

# 141. Circuit Events

```text
DEPENDENCY.CIRCUIT_OPENED
DEPENDENCY.CIRCUIT_HALF_OPEN
DEPENDENCY.CIRCUIT_CLOSED
```

---

# 142. Idempotency Events

Usually not domain events.

Operational metrics/logs are enough.

Security-relevant conflict spike may create:

```text
IDEMPOTENCY.CONFLICT_ANOMALY
```

---

# 143. State Recovery After Restart

Services must reconstruct:

```text
pending operations
retry schedules
workflow waits
circuit state if durable/needed
```

No in-memory-only critical state.

---

# 144. Durable Timers

For:

```text
retry schedule
approval timeout
SLA threshold
workflow timeout
```

use durable scheduler/state.

---

# 145. Clock Handling

Retry scheduling uses UTC.

Business-calendar SLA remains handled by SLA engine.

---

# 146. Error Retention

Keep operational error records according to:

```text
severity
audit relevance
domain
retention policy
```

---

# 147. Error Privacy

Error details must not expose:

```text
secret
PII beyond need
database credentials
internal stack trace to end user
```

---

# 148. Security Failure Retry

Examples:

```text
invalid signature
invalid token
permission denied
```

Do not retry automatically.

Repeated attempts may trigger Security event.

---

# 149. Credential Expiry

If integration credential expired:

```text
fail fast
open circuit
create actionable Work Item
```

Do not hammer provider.

---

# 150. Unknown Error

`UNKNOWN` should be temporary classification.

Track and reduce over time.

Repeated unknown error pattern should be assigned explicit code.

---

# 151. Error Code Registry Governance

Before adding new code:

```text
search existing registry
```

Avoid:

```text
DEPENDENCY_TIMEOUT
EXTERNAL_TIMEOUT
PROVIDER_TIMEOUT
REMOTE_TIMEOUT
```

with overlapping semantics unless scoped clearly.

---

# 152. Error Code Structure

Recommended:

```text
DOMAIN_REASON
```

or shared platform code:

```text
PLATFORM_DEPENDENCY_TIMEOUT
```

---

# 153. Retry Safety Decision Tree

```text
Did the operation mutate state?
├─ NO
│  → retry if transient
└─ YES / unknown
   ↓
Is there an idempotency key / operation ledger?
├─ YES
│  → check prior result, then retry safely
└─ NO
   → do not blind retry
      → reconcile first
```

---

# 154. Reconciliation Before Retry

Examples:

```text
Did supplier create PO?
Did agent already install software?
Did switch VLAN already change?
Did payment provider already process?
```

Query actual state before retry.

---

# 155. Human Reconciliation

If external provider lacks reliable query:

```text
manual confirmation
```

may be required before retrying irreversible operation.

---

# 156. Error Handling by UI

UI states:

```text
retryable failure
conflict
waiting dependency
approval required
final failure
```

Each should have distinct UX.

---

# 157. Retryable UI Failure

Show:

```text
Temporary issue
[Retry]
```

if safe.

---

# 158. Conflict UI

Show:

```text
State changed since you opened this record
[Refresh]
```

not Retry.

---

# 159. Final Failure UI

Show:

```text
Action could not be completed
Reference: correlation ID
Recommended next action
```

---

# 160. Operator Diagnostics

Operator should see:

```text
error code
attempts
last attempt
next retry
dependency
circuit state
operation ID
correlation ID
```

---

# 161. MVP Standard

Implement first:

```text
canonical error envelope
retryability flag
Idempotency-Key
idempotency ledger
expected_version
API retry policy
consumer inbox
outbox retry
DLQ
basic circuit breaker
human fallback
```

---

# 162. Phase 2

Add:

```text
saga compensation
job leasing
advanced retry budgets
bulk retry
external callback reconciliation
```

---

# 163. Phase 3

Add:

```text
adaptive backpressure
dependency health scoring
automated replay safety classification
advanced chaos testing
```

---

# 164. Guardrails

System must not:

1. Retry every exception by default.
2. Retry business validation failures.
3. Retry high-risk writes without idempotency/reconciliation.
4. Retry indefinitely.
5. Stack retries at every layer without shared budget.
6. Treat timeout as proof of failure.
7. Delete committed business history during compensation.
8. Create duplicate approval/ticket/document from retry.
9. Reprocess same event without inbox dedupe.
10. Use DLQ as permanent dumping ground.
11. Replay destructive actions blindly.
12. Ignore provider Retry-After.
13. Allow retry storms after dependency recovery.
14. Treat unique constraint violation as generic 500.
15. Hide compensation failure.
16. Put secrets in error messages/logs.
17. Use in-memory-only retry schedule for critical workflow.
18. Create Work Item for every transient retry success.
19. Let unknown errors remain unclassified indefinitely.
20. Conflate idempotency with optimistic concurrency.

---

# 165. Definition of Done

Error + Retry + Idempotency Standard đạt yêu cầu khi:

- Error taxonomy chuẩn hóa.
- Retryability rõ cho từng class.
- Retry budget/backoff/jitter được quy định.
- Timeout classes rõ.
- Idempotency-Key + ledger tồn tại.
- Business natural-key duplicate prevention được tách riêng.
- Event consumer inbox dedupe chuẩn hóa.
- Workflow step retry semantics rõ.
- Partial failure và async side effects được xử lý đúng.
- Compensation là explicit business action.
- Circuit breaker/bulkhead/backpressure có quy tắc.
- DLQ/replay runbook rõ.
- Agent/deployment/webhook/import retry an toàn.
- Version conflict không bị auto-retry mù.
- Human fallback có chuẩn context.
- Error observability và metrics đầy đủ.
- MVP → Phase 3 implementation path rõ.

---

# 166. Contract, Renewal and Commercial Document Concurrency

Contract, amendment, Renewal and commercial-document commands use the normal
durable idempotency ledger and `expected_version` concurrency contract. A
replay must not create an additional ContractVersion, Renewal Case, successor
Contract, document version or outbox event. A changed semantic payload under
the same key returns `IDEMPOTENCY_KEY_CONFLICT`.

Durably enforce at most one OPEN Renewal Case per predecessor and one
canonical successor per Renewal Case. Concurrent `RENEWAL.OPEN` must resolve
through a DB uniqueness/invariant failure mapped to a canonical domain
conflict; do not rely on SELECT-then-INSERT. Serialize conflicting versioned
commands (draft update/submit, signature recall/execution, activate/terminate,
amend/terminate, renewal complete/not-renewed and document finalize/version
replacement). On `VERSION_CONFLICT`, stale approval context or uniqueness
conflict, reload canonical state and re-evaluate intent; do not blindly retry
or reuse approval bound to another immutable version/snapshot.

---

# 167. TASK-090 Event Evaluation and Action Intent Idempotency

Production rule evaluation is idempotent by tenant + canonical source event
identity + rule id + immutable rule version. Inbox redelivery must return or
link the prior evaluation and must not create another effective intent,
outbox event or conflict fallback.

Canonical intent deduplication uses the relevant event/decision context,
target, action domain, action type and canonicalized parameters. Equivalent
intents from multiple rules link to one canonical intent while retaining all
contributing rule/version/evaluation references. A replay with changed
semantic action content is a distinct request and must not reuse the prior
idempotency result. Same idempotency key with changed request content returns
`IDEMPOTENCY_KEY_CONFLICT`.

Conflict identity includes tenant, target resource, action domain, declared
exclusivity group and relevant decision context. Concurrent incompatible
intents must serialize through durable constraints/locking so all affected
intents become non-executable and only one actionable fallback is created for
that conflict identity. Do not select a winner by rule priority. Kill-switch
state and linked approval context are rechecked in the transaction that
promotes an intent to READY; TASK-091 rechecks them again before execution.
Approval-event delivery and explicit human conflict resolution use durable
idempotency and expected-version checks. Closing a Work Item alone does not
change canonical conflict or intent state.

Simulation may retain diagnostic evidence but uses a distinct mode and
idempotency namespace. It cannot create an executable intent or be consumed by
TASK-091. Historical replay is not implicit; future replay requires an
explicit command, bounded policy and idempotent identity.

---

# 168. TASK-091 v1 Execution Idempotency and Retry

For `RESTART_AGENT` v1, automatic business execution attempts are exactly one
per Action Intent and automatic retry count is zero. This action-specific
rule overrides generic background-job retry classes and historical examples
that show two retries. It does not establish a global automation policy or a
retry policy for future capabilities.

Transport redelivery may resend only the same immutable `command_id` and
content. The Agent inbox durably deduplicates `(tenant_id, agent_id,
command_id)`; redelivery returns the prior receipt/result and never invokes
a second restart. A new command ID is a new logical execution and is
forbidden as automatic retry in v1.

The platform enforces one automatic Action Execution per
`(tenant_id, action_intent_id)`, unique execution and command IDs, and
idempotent event consumption/outbox transition records. Worker claim uses a
durable lease/compare-and-set. Lease expiry after durable dispatch is not
permission to dispatch again. Recovery reconciles the same command and
authenticated Agent evidence; uncertainty becomes terminal `UNKNOWN` with
one idempotent human fallback.

For `RESTART_AGENT` v1, a separate 30-second acceptance deadline begins at
durable `dispatched_at`. If the execution remains `DISPATCHED` at that
deadline, it becomes `UNKNOWN` with `AGENT_ACCEPTANCE_TIMEOUT`; this is not a
deterministic failure and never authorizes automatic redispatch. Authenticated
acceptance before that deadline starts the independent five-minute
verification deadline from `accepted_at`. Timeout without positive restart
evidence is also `UNKNOWN`, not retryable `FAILED`. Late acceptance/runtime
evidence is append-only reconciliation data and cannot restore an `UNKNOWN`
execution. No automatic retry, backoff or compensation applies to this
capability. Manual retry is a new explicit command after the operator records
reconciliation evidence that the prior restart did not succeed; it
creates new execution/command IDs, references the prior attempt, uses
`execution.retry`, expected version, reason and idempotency, and reruns every
security/policy/target check. Same key/same request returns the original
attempt; same key/different request yields `IDEMPOTENCY_KEY_CONFLICT`.

Cancellation is idempotent and allowed only when the platform proves the
Agent has not accepted the command. Ambiguous dispatch/acceptance must be
`UNKNOWN`, not `CANCELLED`. Cancellation after acceptance is forbidden.

## TASK-092 Correlation Evaluation Identity and Concurrency

Equivalent evaluation identity is tenant + subject Incident/event + stable
profile ID/version + material evidence fingerprint/generation. Redelivery of
that identity is idempotent and must not duplicate decisions, active Root
relations, deterministic Roots, Work Items, audit or outbox effects. A new
material evidence epoch or profile version may create a new immutable
decision; unrelated later evidence must not be collapsed into an earlier
dedupe identity.

Enforce one ACTIVE Root relation per child and one canonical active Root per
deterministic cluster using durable uniqueness/transaction semantics. Concurrent
attach to different Roots, auto-link vs manual detach, manual attach vs
auto-link, and concurrent cluster creation must serialize. A losing worker
reloads canonical state and records review/conflict evidence where needed; it
must never silently replace an active Root. Cluster uniqueness races reload
the canonical Root. In-memory locking and SELECT-before-INSERT alone are not
sufficient. Work Item creation for the same unresolved decision is idempotent.

The TASK-092 Incident Correlation event consumer uses a bounded component
policy: at most five total processing attempts per source event. Failures are
retried after 1, 2, 4 and 8 seconds (with a 30-second maximum backoff cap);
the fifth failed attempt exhausts the budget. Exhaustion is durable, blocks
further automatic processing and creates one actionable correlation review
Work Item with audit/timeline evidence. A successful retry marks the failure
ledger resolved. This retry ledger is independent of Incident and
CorrelationDecision state and never replays remediation actions.

## TASK-094 Assessment Idempotency and Concurrency

Scoring event/job redelivery is idempotent by tenant, Asset, assessment type,
profile version and evidence generation/`as_of` epoch. Durable uniqueness
prevents duplicate current assessments and duplicate candidate side effects.
Workers serialize concurrent recalculation and use expected versions or
equivalent database fencing. If source evidence or Asset eligibility changes
during collection, persist an exact consistent evidence generation or reject
and enqueue a fresh calculation; never silently present a mixed snapshot.

Assessment history is append-only. The latest projection may advance only
from a valid newer assessment. A CRITICAL Risk Work Item and TASK-059
candidate upsert are idempotent across recalculation/redelivery. Do not
automatically retry through a second business decision after an uncertain
candidate command; reconcile the canonical TASK-059 result first. 24-hour
expiry changes current freshness to STALE without rewriting history.

TASK-094-R2 Maintenance classification commands use idempotency and expected
order version; completed classification is immutable. TASK-059 recommendation
processing serializes on the tenant Asset row and retains the DB unique
constraint for one active candidate per Asset. Same assessment/profile replay
returns `ACTIVE_ALREADY_CURRENT`; it does not duplicate candidate history,
Work Queue, outbox or audit. Offboarding recovery commands fence clearance
state by expected version, and repeated command keys do not duplicate recovery
history or events. Legacy Risk normalization is an evidence-preserving
migration; ambiguous rows are not linked by guesswork.

TASK-094-R3 Incident–Asset mutations run in a local transaction with the
canonical idempotency ledger, row/unique protection and append-only history.
Repeated link or unlink requests do not duplicate audit, outbox or timeline
effects. Monitoring episode evaluation groups only stable validated
source/correlation identities; unresolved identity is reported unavailable,
not assigned a guessed key. Warranty projection refresh is serialized by the
Asset row and idempotent for the same state, evidence and policy version.
Periodic date refresh does not duplicate projection events; a time-boundary
state change updates the derived Asset version and emits one outbox event.
