# API + COMMAND CONTRACT SPEC
## IT Operations Hub — Application/API Interaction Standard

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`  
**Depends on:**  
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `SYSTEM_WORKFLOW_INDEX_TRACEABILITY_MATRIX.md`
- `APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`

**Purpose:** Define canonical API and command patterns for UI, workflow engine, automation, integrations, and internal services. Standardize authorization, validation, idempotency, concurrency, error handling, command processing, response models, async operations, pagination, filtering, bulk operations, and domain event emission.

---

# 1. Mục tiêu

Tài liệu này chuẩn hóa cách client và service yêu cầu hệ thống thực hiện hành động.

Chuỗi chuẩn:

```text
Client / Workflow / Integration
→ API Request
→ Authentication
→ Authorization
→ Request Validation
→ Command Construction
→ Business Validation
→ Idempotency Check
→ Transaction
→ Domain State Change
→ Outbox Event
→ Response
```

Mục tiêu:

- UI không thao tác trực tiếp database;
- API không bypass domain rules;
- command có intent rõ;
- retry không tạo duplicate side effect;
- high-risk action có approval/policy gate;
- optimistic concurrency chống lost update;
- sync vs async operation rõ ràng;
- error response nhất quán;
- query API và command API tách semantics;
- cross-domain write đi qua command/API, không sửa table trực tiếp;
- API contract ổn định và versionable.

---

# 2. API Design Principles

## 2.1 Resource Query + Intent Command

Read API:

```text
GET /assets/{id}
GET /tickets
GET /work-items
```

Mutation đơn giản có thể dùng resource semantics:

```text
PATCH /users/{id}
```

Nhưng business operation quan trọng nên thể hiện intent:

```text
POST /assets/{id}/commands/assign
POST /assets/{id}/commands/return
POST /incidents/{id}/commands/declare-major
POST /licenses/{id}/commands/reclaim
```

Không dùng generic:

```text
PATCH /assets/{id}
{
  "status": "disposed"
}
```

để bypass workflow.

---

# 3. API Layers

Recommended:

```text
Public/API Gateway
↓
Application API
↓
Command/Query Handler
↓
Domain Service
↓
Repository
↓
Outbox
```

Không expose repository trực tiếp.

---

# 4. API Consumer Types

```text
WEB_UI
MOBILE_APP
WORKFLOW_ENGINE
AUTOMATION_ENGINE
INTERNAL_SERVICE
EXTERNAL_INTEGRATION
AGENT
CLI
```

Mỗi consumer có scope/permission riêng.

---

# 5. Authentication

Supported depending deployment:

```text
OIDC Access Token
Service Account Token
mTLS
API Key for limited integrations
Signed Webhook
```

Preferred:

```text
OIDC/OAuth2 for users
mTLS or workload identity for services
```

---

# 6. Authorization

Authorization must check:

```text
principal
action
resource
scope
context
```

Example:

```text
Permission: asset.assign
Resource: AST-0042
Scope: Hanoi Site
```

Not enough:

```text
is_admin = true
```

---

# 7. Authorization Decision Contract

```yaml
authorization:
  principal_id:
  action:
  resource_type:
  resource_id:
  scope:
  result:
  policy_id:
  reason:
```

High-risk actions may also require:

```text
approval
reauthentication
MFA
```

---

# 8. API Versioning

Recommended external API:

```text
/api/v1/...
```

Breaking change:

```text
/api/v2/...
```

Internal service contracts can evolve separately but must maintain compatibility guarantees.

---

# 9. Request Correlation

Every request should support:

```http
X-Correlation-Id
```

If absent:

```text
gateway/service generates one
```

Response returns same ID.

---

# 10. Request ID

Each HTTP request has:

```http
X-Request-Id
```

Difference:

```text
Request ID = one transport request
Correlation ID = whole business flow
```

---

# 11. Idempotency Header

For side-effect commands:

```http
Idempotency-Key: <client-generated-key>
```

Required for:

```text
Create Ticket
Assign Asset
Create Procurement Request
Create Invoice
Reclaim License
Start Deployment
Create Approval
```

---

# 12. Idempotency Behavior

First request:

```text
process
store result
```

Retry same key + same semantic payload:

```text
return original result
```

Same key + different payload:

```text
409 IDEMPOTENCY_KEY_CONFLICT
```

---

# 13. Idempotency Record

```yaml
idempotency_record:
  key:
  principal_id:
  operation:
  request_hash:
  response_status:
  response_body_ref:
  created_at:
  expires_at:
```

---

# 14. Command Contract

Canonical internal command envelope:

```yaml
command:
  command_id:
  command_type:
  schema_version:
  requested_at:
  actor:
    type:
    id:
  correlation_id:
  causation_id:
  idempotency_key:
  target:
    type:
    id:
  expected_version:
  payload:
```

---

# 15. Command Example — Assign Asset

```json
{
  "command_id": "cmd-8f811",
  "command_type": "ASSET.ASSIGN",
  "schema_version": 1,
  "requested_at": "2026-09-11T03:00:00Z",
  "actor": {
    "type": "USER",
    "id": "usr-001"
  },
  "correlation_id": "corr-10001",
  "causation_id": "req-9001",
  "idempotency_key": "assign-AST-0042-user-18-v1",
  "target": {
    "type": "ASSET",
    "id": "ast-0042"
  },
  "expected_version": 17,
  "payload": {
    "user_id": "usr-018",
    "location_id": "loc-hn-floor4",
    "assignment_type": "PRIMARY",
    "effective_at": "2026-09-11T03:00:00Z"
  }
}
```

---

# 16. Command Naming

Pattern:

```text
DOMAIN.ACTION
```

Examples:

```text
ASSET.ASSIGN
ASSET.RETURN
ASSET.TRANSFER
ASSET.RETIRE

TICKET.ASSIGN
TICKET.RESOLVE

INCIDENT.DECLARE_MAJOR
INCIDENT.RESOLVE

LICENSE.ASSIGN
LICENSE.RECLAIM

CHANGE.APPROVE
CHANGE.IMPLEMENT

AUTOMATION.RETRY_ACTION
```

Commands use imperative semantics.

Events use completed-fact semantics.

---

# 17. Command Validation Layers

Validation order:

```text
1. Transport/schema
2. Authentication
3. Authorization
4. Idempotency
5. Entity existence
6. Concurrency
7. Business preconditions
8. Policy/approval gate
9. Domain mutation
```

---

# 18. Schema Validation

Validate:

```text
required fields
types
formats
enum values
length
numeric bounds
```

Return:

```text
400 VALIDATION_ERROR
```

before domain execution.

---

# 19. Business Validation

Examples:

```text
Cannot assign disposed asset
Cannot reclaim already reclaimed license
Cannot resolve incident without required verification
Cannot create duplicate invoice
```

Return:

```text
422 BUSINESS_RULE_VIOLATION
```

---

# 20. Optimistic Concurrency

Command may include:

```text
expected_version
```

If current aggregate version differs:

```text
409 VERSION_CONFLICT
```

Client should refresh and re-evaluate.

---

# 21. HTTP ETag Support

For resource updates:

```http
ETag: "17"
If-Match: "17"
```

Equivalent to expected version.

---

# 22. Command Response

Successful synchronous command:

```json
{
  "data": {
    "operation_id": "op-1002",
    "entity": {
      "type": "ASSET",
      "id": "ast-0042",
      "version": 18
    },
    "result": {
      "assignment_id": "asn-9001"
    }
  },
  "meta": {
    "request_id": "req-9001",
    "correlation_id": "corr-10001"
  }
}
```

---

# 23. Command Side Effects

Response may include:

```text
primary state change
created related records
follow-up async tasks
```

Example:

```json
{
  "side_effects": [
    {
      "type": "MOVEMENT",
      "id": "mov-21"
    },
    {
      "type": "DOCUMENT_JOB",
      "id": "docjob-4",
      "state": "QUEUED"
    }
  ]
}
```

---

# 24. Sync vs Async Command

## Synchronous

Use when:

```text
short
deterministic
local transaction
```

Examples:

```text
Assign ticket
Approve request
Reserve asset
```

## Asynchronous

Use when:

```text
long-running
external system
agent execution
bulk operation
scan
deployment
```

Examples:

```text
Software Deployment
Network Discovery
Data Wipe
Bulk Import
Large Report
```

---

# 25. Async Operation Pattern

Request:

```http
POST /assets/{id}/commands/wipe
```

Response:

```text
202 Accepted
```

```json
{
  "data": {
    "operation_id": "op-wipe-101",
    "state": "QUEUED"
  }
}
```

Query:

```text
GET /operations/op-wipe-101
```

---

# 26. Operation Resource

```yaml
operation:
  id:
  type:
  target_type:
  target_id:
  state:
  progress:
  started_at:
  completed_at:
  result:
  error:
```

States:

```text
QUEUED
RUNNING
WAITING
SUCCEEDED
FAILED
CANCELLED
```

---

# 27. Cancellation

Async operation may support:

```text
POST /operations/{id}/commands/cancel
```

Only if operation is safely cancellable.

---

# 28. Query API Principle

Queries must not cause business side effects.

GET should be safe/idempotent.

Do not:

```text
GET /tickets/1/close
```

---

# 29. Resource Response Envelope

Recommended:

```json
{
  "data": {},
  "meta": {
    "request_id": "...",
    "correlation_id": "..."
  }
}
```

Lists:

```json
{
  "data": [],
  "meta": {
    "page": {},
    "filters": {}
  }
}
```

---

# 30. Pagination

Prefer cursor pagination for large operational lists:

```text
?limit=50&cursor=...
```

Response:

```json
{
  "meta": {
    "next_cursor": "...",
    "has_more": true
  }
}
```

Offset pagination acceptable for small/static datasets.

---

# 31. Filtering

Pattern:

```text
GET /work-items?state=OPEN&severity=CRITICAL&team_id=netops
```

Avoid arbitrary SQL-like filter syntax initially.

---

# 32. Sorting

```text
?sort=-priority_score,due_at
```

Allow only whitelisted fields.

---

# 33. Field Selection

Optional:

```text
?fields=id,asset_code,lifecycle_state
```

Useful for integrations/read efficiency.

---

# 34. Expansion

Controlled relation expansion:

```text
?include=current_assignment,current_location
```

Avoid unbounded nested graph expansion.

---

# 35. Search API

Global:

```text
GET /search?q=AST-0042
```

Returns typed results:

```text
ASSET
USER
TICKET
INCIDENT
PO
INVOICE
SOFTWARE
IP
MAC
```

---

# 36. Error Envelope

Canonical:

```json
{
  "error": {
    "code": "ASSET_NOT_ASSIGNABLE",
    "message": "Asset cannot be assigned in its current lifecycle state.",
    "details": {
      "asset_id": "ast-0042",
      "lifecycle_state": "DISPOSED"
    },
    "retryable": false
  },
  "meta": {
    "request_id": "req-100",
    "correlation_id": "corr-100"
  }
}
```

---

# 37. Error Classes

```text
VALIDATION_ERROR
AUTHENTICATION_REQUIRED
PERMISSION_DENIED
NOT_FOUND
VERSION_CONFLICT
IDEMPOTENCY_KEY_CONFLICT
BUSINESS_RULE_VIOLATION
APPROVAL_REQUIRED
DEPENDENCY_UNAVAILABLE
RATE_LIMITED
OPERATION_IN_PROGRESS
INTERNAL_ERROR
```

---

# 38. HTTP Status Mapping

| Status | Usage |
|---|---|
| 200 | Query / successful operation |
| 201 | Resource created |
| 202 | Async accepted |
| 204 | Successful no body |
| 400 | Invalid request/schema |
| 401 | Authentication required |
| 403 | Permission denied |
| 404 | Resource not found |
| 409 | Version/idempotency/conflict |
| 422 | Business rule violation |
| 429 | Rate limit |
| 503 | Dependency unavailable |

---

# 39. Approval Required Response

If action cannot continue without approval:

Option A:

```text
command creates approval automatically
```

Response:

```json
{
  "data": {
    "state": "WAITING_APPROVAL",
    "approval_request_id": "app-1002"
  }
}
```

Option B:

```text
return 422 APPROVAL_REQUIRED
```

depending workflow semantics.

Preferred for business workflow:

```text
create approval as part of command
```

if policy is deterministic.

---

# 40. Policy Preflight API

Useful for UI:

```text
POST /policy/preflight
```

Example:

```json
{
  "action": "asset.transfer",
  "resource": {
    "type": "ASSET",
    "id": "ast-0042"
  },
  "proposed": {
    "to_location_id": "loc-hcm"
  }
}
```

Response:

```json
{
  "allowed": true,
  "approval_required": true,
  "estimated_side_effects": [
    "MOVEMENT_CREATE",
    "ASSIGNMENT_UPDATE"
  ],
  "warnings": []
}
```

Preflight is advisory.

Final command must re-check everything.

---

# 41. Side-effect Preview

For contextual drawer:

```text
GET/POST preview
```

Example:

```text
POST /assets/{id}/commands/transfer:preview
```

Response:

```text
Current
→ After
→ Automatic side effects
→ Approval requirement
→ Warnings
```

---

# 42. Preview Guardrail

Never trust preview as authorization.

Between preview and confirm:

```text
state may change
```

Confirm command revalidates.

---

# 43. Bulk Command Pattern

Example:

```http
POST /assets/commands/bulk-assign-team
```

Payload:

```json
{
  "items": [
    {
      "asset_id": "ast-1",
      "expected_version": 3
    },
    {
      "asset_id": "ast-2",
      "expected_version": 8
    }
  ],
  "team_id": "team-ops"
}
```

---

# 44. Bulk Result

Return per item:

```json
{
  "data": {
    "results": [
      {
        "target_id": "ast-1",
        "status": "SUCCEEDED"
      },
      {
        "target_id": "ast-2",
        "status": "SKIPPED",
        "error": {
          "code": "VERSION_CONFLICT"
        }
      }
    ]
  }
}
```

Avoid all-or-nothing unless business operation requires it.

---

# 45. Bulk Atomicity

Supported modes:

```text
BEST_EFFORT
ALL_OR_NOTHING
```

Must be explicit.

Default operational bulk:

```text
BEST_EFFORT
```

---

# 46. Command Audit Metadata

Sensitive command should capture:

```text
actor
source_ip
channel
reason
ticket/change reference
device/session context
```

depending security policy.

---

# 47. Reason Requirement

Require `reason` for:

```text
manual override
high-risk state change
exception approval
role grant
asset disposal
manual inventory correction
```

---

# 48. Comment vs Reason

`reason`:

```text
structured audit justification
```

`comment`:

```text
optional human note
```

Do not rely on comment as machine policy input.

---

# 49. Cross-domain Commands

Do not directly mutate another domain.

Example offboarding command:

```text
IDENTITY.START_OFFBOARDING
```

then workflow issues:

```text
ASSET.REQUEST_RETURN
LICENSE.RECLAIM
ACCESS.REVOKE
```

---

# 50. Internal Service Command

Internal service-to-service command should use same semantics as public API:

```text
authorization
idempotency
correlation
version
```

May use gRPC/message transport.

Business contract remains same.

---

# 51. Command Bus

Optional internal command bus:

```text
Command
→ Handler
→ Domain
```

Useful for:

```text
workflow orchestration
automation
internal decoupling
```

Command bus is not event bus.

---

# 52. Command Ownership

Only owning domain handles command.

Examples:

```text
ASSET.ASSIGN → asset-service
LICENSE.RECLAIM → license-service
CHANGE.IMPLEMENT → change-service
```

---

# 53. Read Ownership

Cross-domain UI can use:

```text
read model / BFF
```

instead of orchestrating 15 service calls from browser.

---

# 54. BFF / Aggregation API

Recommended for complex workspaces:

```text
GET /workspaces/assets/{id}
```

Response combines:

```text
asset
assignment
location
health
agent
network
tickets
maintenance
software
license
timeline
```

This is a read projection.

Do not allow writes through generic workspace payload.

---

# 55. Asset Commands

Recommended:

```text
POST /assets/{id}/commands/reserve
POST /assets/{id}/commands/assign
POST /assets/{id}/commands/transfer
POST /assets/{id}/commands/request-return
POST /assets/{id}/commands/receive-return
POST /assets/{id}/commands/send-to-repair
POST /assets/{id}/commands/retire
POST /assets/{id}/commands/dispose
```

---

# 56. Ticket Commands

```text
POST /tickets/{id}/commands/assign
POST /tickets/{id}/commands/change-priority
POST /tickets/{id}/commands/request-info
POST /tickets/{id}/commands/resolve
POST /tickets/{id}/commands/reopen
POST /tickets/{id}/commands/link-incident
```

---

# 57. Incident Commands

```text
POST /incidents/{id}/commands/acknowledge
POST /incidents/{id}/commands/declare-major
POST /incidents/{id}/commands/add-affected-entity
POST /incidents/{id}/commands/start-mitigation
POST /incidents/{id}/commands/mark-restored
POST /incidents/{id}/commands/resolve
```

---

# 58. Problem Commands

```text
POST /problems/{id}/commands/publish-workaround
POST /problems/{id}/commands/mark-known-error
POST /problems/{id}/commands/request-change
POST /problems/{id}/commands/resolve
```

---

# 59. Change Commands

```text
POST /changes/{id}/commands/submit
POST /changes/{id}/commands/approve
POST /changes/{id}/commands/schedule
POST /changes/{id}/commands/start
POST /changes/{id}/commands/verify
POST /changes/{id}/commands/rollback
POST /changes/{id}/commands/close
```

Approval decision itself may go through Approval Engine endpoint.

---

# 60. Maintenance Commands

```text
POST /maintenance-orders/{id}/commands/start-diagnosis
POST /maintenance-orders/{id}/commands/request-part
POST /maintenance-orders/{id}/commands/send-vendor
POST /maintenance-orders/{id}/commands/start-repair
POST /maintenance-orders/{id}/commands/verify
POST /maintenance-orders/{id}/commands/complete
```

---

# 61. Audit Commands

```text
POST /audits/{id}/commands/start
POST /audits/{id}/commands/record-observation
POST /audit-exceptions/{id}/commands/resolve
POST /audits/{id}/commands/complete
```

---

# 62. Network Commands

```text
POST /discovery-jobs
POST /network-exceptions/{id}/commands/link-asset
POST /network-exceptions/{id}/commands/accept-exception
POST /network-exceptions/{id}/commands/request-change
```

High-risk switch/VLAN execution should be Change-driven.

---

# 63. Software Commands

```text
POST /software-requests
POST /deployments
POST /deployments/{id}/commands/retry
POST /software/deployment-campaigns
POST /software/deployment-campaigns/{id}/commands/start
POST /software/deployment-campaigns/{id}/commands/pause
POST /software/deployment-campaigns/{id}/commands/resume
POST /software/deployment-campaigns/{id}/commands/advance
POST /software/deployment-campaigns/{id}/commands/cancel
GET  /software/deployment-campaigns/{id}
GET  /software/deployment-campaigns/{id}/targets
POST /software/deployment-targets/{id}/commands/retry
POST /software-exceptions/{id}/commands/approve
POST /software-exceptions/{id}/commands/remove
```

---

Deployment campaign and target writes require `Idempotency-Key` and
`expected_version`. Campaign targets are tenant-scoped assets. Agent job claim
and result reporting use the authenticated Agent Gateway, short-lived leases,
and normalized results; signed artifact download grants are returned only to
the enrolled agent and are never persisted in audit, events, or idempotency
responses.

# 64. License Commands

```text
POST /license-entitlements
GET  /license-entitlements
GET  /license-entitlements/{id}
POST /license-entitlements/{id}/commands/update
POST /license-entitlements/{id}/commands/renew
POST /license-pools
GET  /license-pools
GET  /license-pools/{id}
POST /license-pools/{id}/commands/update
POST /licenses/{id}/commands/assign
POST /license-assignments/{id}/commands/reclaim
POST /license-exceptions/{id}/commands/approve
POST /license-renewals/{id}/commands/decide
```

Entitlement `effective_state` is derived from its validity window; the
compliance projection is separate. Renewal is idempotent and versioned, and
retains prior contractual terms in append-only history. `LICENSE.EXPIRED` is
keyed to a term version and does not mutate entitlement state.

---

# 65. Procurement Commands

```text
POST /procurement-requests
POST /procurement-requests/{id}/commands/submit
POST /rfqs
POST /purchase-orders
POST /purchase-orders/{id}/commands/issue
POST /purchase-orders/{id}/commands/amend
POST /goods-receipts
POST /invoices
POST /invoices/{id}/commands/approve-exception
```

---

# 66. Contract Commands

```text
POST /contracts
POST /contracts/{id}/commands/activate
POST /contracts/{id}/commands/start-renewal
POST /contracts/{id}/commands/renew
POST /contracts/{id}/commands/terminate
```

---

# 67. Approval API

```text
GET  /approvals
GET  /approvals/{id}
POST /approvals/{id}/commands/approve
POST /approvals/{id}/commands/reject
POST /approvals/{id}/commands/request-changes
POST /approvals/{id}/commands/delegate
```

---

# 68. SLA Query API

Read-only operational:

```text
GET /sla-instances
GET /sla-instances/{id}
GET /objects/{type}/{id}/sla
```

SLA state should usually be engine-managed, not manually patched.

---

# 69. Automation API

```text
GET  /automation-rules
POST /automation-rules
POST /automation-rules/{id}/commands/activate
POST /automation-rules/{id}/commands/disable
POST /automation-rules/{id}/commands/simulate
POST /rule-executions/{id}/commands/retry
POST /rule-executions/{id}/commands/cancel
```

---

# 70. Work Queue API

```text
GET /work-items
POST /work-items/{id}/commands/assign
POST /work-items/{id}/commands/acknowledge
POST /work-items/{id}/commands/start
POST /work-items/{id}/commands/resolve
POST /work-items/{id}/commands/reopen
```

---

# 71. Document API

```text
GET  /documents/{id}
POST /documents
POST /documents/{id}/versions
POST /documents/{id}/commands/sign
POST /documents/{id}/commands/supersede
```

Binary upload may use pre-signed object storage URL.

---

# 72. File Upload Flow

Recommended:

```text
Client
→ Request Upload Session
→ Upload directly to Object Storage
→ Confirm Upload
→ Create Document Version
```

Avoid routing large file bodies through core service if unnecessary.

---

# 73. Upload Session

```yaml
upload_session:
  id:
  purpose:
  mime_type:
  max_size:
  object_key:
  expires_at:
  state:
```

---

# 74. Agent API

Agent endpoints should be separate/scoped.

Examples:

```text
POST /agent/v1/heartbeat
POST /agent/v1/inventory
GET  /agent/v1/jobs
POST /agent/v1/jobs/{id}/result
```

Agent cannot call administrative business commands.

---

# 75. Agent Job Contract

```yaml
agent_job:
  id:
  type:
  target_asset_id:
  artifact_ref:
  command:
  timeout:
  verification:
  idempotency_key:
```

---

# 76. Agent Result Contract

```yaml
agent_job_result:
  job_id:
  state:
  started_at:
  completed_at:
  exit_code:
  output_summary:
  verification:
  error_code:
```

No secrets in output.

---

# 77. Integration API

External integrations should use dedicated scopes.

Example:

```text
asset.read
ticket.create
ticket.update
monitoring.event.write
invoice.import
```

---

# 78. Webhook API

Inbound webhook endpoint pattern:

```text
POST /webhooks/{provider}/{connection_id}
```

Requirements:

```text
signature validation
timestamp
replay protection
provider event ID
```

---

# 79. Rate Limiting

Apply by:

```text
principal
API client
endpoint
tenant
```

Different limits:

```text
interactive UI
agent
bulk import
external integration
```

---

# 80. Rate Limit Response

```text
429
Retry-After
```

Payload includes:

```text
RATE_LIMITED
```

---

# 81. Long Poll / Push

For real-time UI:

Preferred:

```text
WebSocket / SSE
```

for:

```text
work queue updates
incident updates
operation progress
```

Business state still queried from canonical API.

---

# 82. Event Subscription API

Optional:

```text
POST /subscriptions
```

for external systems.

Fields:

```text
event types
endpoint
secret_ref
filters
```

---

# 83. Webhook Delivery Contract

Outbound:

```yaml
delivery:
  event_id:
  event_type:
  schema_version:
  delivery_id:
  occurred_at:
  payload:
```

Signed.

---

# 84. Query Consistency

Some read models are eventual.

Response can include:

```text
data_as_of
freshness
```

Example:

```json
{
  "meta": {
    "data_as_of": "2026-09-11T03:00:01Z",
    "freshness": "CURRENT"
  }
}
```

---

# 85. Stale Read Handling

UI should distinguish:

```text
CURRENT
STALE
DEGRADED
```

especially for:

```text
network
agent
license sync
directory
```

---

# 86. Strong Read

For critical action confirmation, command handler reads canonical state directly.

Do not rely on stale projection for:

```text
assignment eligibility
license availability
invoice duplicate check
approval state
```

---

# 87. API Field Naming

Use:

```text
snake_case
```

or:

```text
camelCase
```

Choose one consistently.

This spec examples use:

```text
snake_case
```

---

# 88. Date/Time Format

Use ISO 8601:

```text
2026-09-11T03:00:00Z
```

Store UTC.

---

# 89. Money Contract

```yaml
money:
  amount: "15000000.00"
  currency: "VND"
```

Amount as decimal string in JSON to avoid floating-point ambiguity.

---

# 90. Enum Contract

Stable string values:

```text
IN_PROGRESS
WAITING_VENDOR
COMPLETED
```

Never ordinal integer enums in public API.

---

# 91. Null vs Unknown

Prefer explicit semantic states where needed:

```text
UNKNOWN
NOT_APPLICABLE
STALE
```

instead of relying on null.

---

# 92. Patch Semantics

For simple profile/master data:

```text
PATCH
```

Prefer JSON Merge Patch or explicit partial update schema.

Do not allow PATCH to mutate protected workflow fields.

---

# 93. Protected Fields

Examples:

```text
asset.lifecycle_state
ticket.state
invoice.state
approval.state
```

must change through command, not generic patch.

---

# 94. Query Expansion Limits

Limit:

```text
max include depth
max page size
max sort fields
```

to prevent expensive requests.

---

# 95. API Timeout

Interactive requests:

```text
short timeout
```

Long task:

```text
202 + operation
```

Do not hold HTTP connection for minutes.

---

# 96. Dependency Timeout

Internal calls need:

```text
connect timeout
request timeout
retry policy
circuit breaker
```

No uncontrolled cascading retry.

---

# 97. Circuit Breaker

Use for:

```text
external SaaS
email provider
vendor API
ERP
```

Return:

```text
DEPENDENCY_UNAVAILABLE
```

or queue async job.

---

# 98. Retry Safety

Client can retry:

```text
GET
idempotent commands with Idempotency-Key
```

Client should not blindly retry high-risk POST without idempotency key.

---

# 99. Operation Polling

Recommended:

```text
GET /operations/{id}
```

with optional:

```text
Retry-After
```

---

# 100. Callback Completion

External integration may provide callback/webhook for async job.

Must include:

```text
operation_id
provider_job_id
signature
state
```

---

# 101. Command Handler Template

```text
1. Authenticate
2. Authorize
3. Validate schema
4. Check idempotency
5. Load aggregate
6. Check expected version
7. Resolve policy/context
8. Validate business rules
9. Apply domain operation
10. Persist
11. Write outbox
12. Commit
13. Store idempotency result
14. Return
```

---

# 102. Query Handler Template

```text
1. Authenticate
2. Authorize scope
3. Validate query
4. Execute canonical/read-model query
5. Apply tenant/RBAC filters
6. Return freshness metadata
```

---

# 103. Create Resource vs Execute Command

Create resource when entity itself is the request:

```text
POST /tickets
POST /procurement-requests
POST /documents
```

Use command when modifying business lifecycle:

```text
POST /tickets/{id}/commands/resolve
```

---

# 104. Command Result Events

Every successful business command should generally produce at least one canonical domain event.

Not all query/API calls produce events.

---

# 105. Validation Error Detail

Example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "fields": [
      {
        "field": "payload.user_id",
        "code": "REQUIRED"
      }
    ]
  }
}
```

---

# 106. Business Conflict Detail

Example:

```json
{
  "error": {
    "code": "ASSET_ALREADY_ASSIGNED",
    "details": {
      "assignment_id": "asn-100",
      "user_id": "usr-100"
    }
  }
}
```

---

# 107. Permission Denied Detail

Keep user-facing message concise.

Internal audit can log:

```text
required_permission
evaluated_scope
policy
```

Do not leak unnecessary security internals to untrusted callers.

---

# 108. API Audit Trail

Sensitive request log should include:

```text
request_id
correlation_id
principal
operation
resource
result
status
duration
```

Do not log full sensitive payload blindly.

---

# 109. Payload Redaction

Redact:

```text
password
token
secret
private key
license key
credential
```

---

# 110. API Observability

Metrics:

```text
request count
latency p50/p95/p99
error rate
status code
rate-limit count
command failure
version conflict
idempotency hit
dependency latency
```

---

# 111. Distributed Tracing

Trace:

```text
gateway
→ application service
→ domain service
→ DB
→ outbox
```

Correlation ID should also be available in trace attributes.

---

# 112. API Documentation

Recommended:

```text
OpenAPI
```

for HTTP APIs.

Command/event schema:

```text
JSON Schema / AsyncAPI where useful
```

---

# 113. Contract Testing

Before release:

```text
schema compatibility
permission behavior
idempotency
version conflict
error codes
event emission
```

---

# 114. API Deprecation

Process:

```text
mark deprecated
announce
support overlap period
measure usage
retire
```

Response header optional:

```text
Deprecation
Sunset
```

---

# 115. Public vs Internal API

Public:

```text
stable
documented
strict compatibility
```

Internal:

```text
can evolve faster
```

but business command semantics should remain canonical.

---

# 116. Example E2E — Asset Assignment

```text
UI
↓
POST /assets/ast-0042/commands/assign
Idempotency-Key: assign-0042-u18
If-Match: "17"
↓
Auth
↓
asset.assign permission
↓
Asset canonical read
↓
Check Available
↓
Check user
↓
Check reservation
↓
Check approval policy
↓
Transaction:
- create Assignment
- create Movement
- update current owner
- update state
- outbox ASSET.ASSIGNED
↓
Commit
↓
201/200 response
↓
Async:
- document generation
- notification
- timeline
- reporting
```

---

# 117. Example E2E — Software Deployment

```text
UI / Workflow
↓
POST /deployments
↓
Validation
↓
Policy + License Check
↓
Deployment record created
↓
202 Accepted
operation_id
↓
Agent Job queued
↓
Agent executes
↓
Result callback
↓
Verification
↓
SOFTWARE.INSTALLED
or
SOFTWARE.INSTALL_FAILED
```

---

# 118. Example E2E — Approval

```text
Approver opens notification
↓
GET /approvals/app-10
↓
POST /approvals/app-10/commands/approve
Idempotency-Key: app-10-user-7
↓
Authorization
↓
Check pending step
↓
Check approver identity
↓
Commit decision
↓
APPROVAL.APPROVED
↓
Workflow resumes
```

---

# 119. Example E2E — Version Conflict

```text
User A opens Asset v17
User B transfers Asset
Asset now v18
User A confirms old form
↓
If-Match: "17"
↓
409 VERSION_CONFLICT
↓
UI refreshes
↓
shows changed current state
↓
user decides again
```

---

# 120. Example E2E — Idempotent Invoice Import

```text
ERP connector
↓
POST /invoices
Idempotency-Key: supplier12-inv998
↓
Connection timeout after commit
↓
Connector retries same request/key
↓
Server returns original invoice result
↓
No duplicate invoice
```

---

# 121. Guardrails

System must not:

1. Allow generic PATCH to bypass business lifecycle commands.
2. Mutate another domain's tables directly.
3. Process high-risk POST retry without idempotency safeguards.
4. Trust preview as final authorization.
5. Ignore optimistic concurrency on critical aggregates.
6. Return raw internal exceptions to clients.
7. Put secrets into logs/responses.
8. Let GET produce business mutations.
9. Hold interactive HTTP request for long-running operations.
10. Allow bulk command to silently skip failed items without result detail.
11. Let read-model staleness drive irreversible command validation.
12. Use integer ordinal enums in external APIs.
13. Use floating point for money.
14. Expose unrestricted generic query language.
15. Give Agent administrative API scopes.
16. Let public API break without version/deprecation path.
17. Emit business event before transaction commit.
18. Return success before local transactional state is committed.

---

# 122. MVP API Surface

Minimum:

```text
/auth/session
/users/{id}

assets
assets/{id}
assets/{id}/commands/assign
assets/{id}/commands/request-return
assets/{id}/commands/receive-return

tickets
tickets/{id}
tickets/{id}/commands/assign
tickets/{id}/commands/resolve

incidents
incidents/{id}
incidents/{id}/commands/declare-major
incidents/{id}/commands/resolve

maintenance-orders
maintenance-orders/{id}

approvals
approvals/{id}/commands/approve
approvals/{id}/commands/reject

work-items
work-items/{id}/commands/assign
work-items/{id}/commands/resolve

operations/{id}

workspaces/assets/{id}
```

---

# 123. Phase 2 API Surface

Add:

```text
audit
network discovery
software
artifact
license
warranty
replacement
automation
SLA
```

---

# 124. Phase 3 API Surface

Add:

```text
procurement
supplier
PO
invoice
contract
reporting
external integration management
```

---

# 125. Definition of Done

API + Command Contract đạt yêu cầu khi:

- Query và command semantics tách rõ.
- High-value business action có intent-specific command.
- Authentication/authorization/resource scope rõ.
- Idempotency-Key chuẩn hóa.
- Optimistic concurrency có expected version / ETag.
- Command envelope chuẩn.
- Error envelope chuẩn.
- HTTP status mapping rõ.
- Async operation dùng 202 + operation resource.
- Bulk command có per-item result.
- Preview/preflight không bypass final validation.
- Domain owner xử lý command của chính domain.
- Cross-domain write đi qua command/event.
- Agent API bị giới hạn scope.
- Public/internal API boundary rõ.
- API audit, redaction, observability và tracing đầy đủ.
- Successful business command phát domain event sau commit.
- MVP API surface được xác định.
