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

## 2.2 Goods Receipt Command API

TASK-073 uses explicit commands:

```text
POST /api/v1/goods-receipts
POST /api/v1/goods-receipts/{id}/commands/update-draft
POST /api/v1/goods-receipts/{id}/commands/post
POST /api/v1/goods-receipts/{id}/commands/cancel
```

Create/update payloads contain PO, Supplier/context, warehouse/location and
receipt-line observations. POST identifies the expected receipt aggregate
version; its transaction revalidates PO state, Supplier/PO-line references,
blocking receiving exceptions, accepted unit identity and cumulative
accepted quantities while serialized on the PO aggregate. Existing-receipt
commands require `expected_version` (or the API's equivalent `If-Match`) and
`Idempotency-Key`; all commands require authentication, their exact
`goods_receipt.*` permission, tenant/resource scope and correlation ID.
`GOODS_RECEIPT.CANCEL` requires a reason. Normal POST does not require a
free-form reason unless another explicit policy requires it.

POST returns the committed POSTED receipt and resulting PO receipt progress.
Same key/same semantic payload replays the original response; same key with
different payload returns `409 IDEMPOTENCY_KEY_CONFLICT`. A command conflict
from stale aggregate/version or concurrent receipt progress returns canonical
conflict/business error and does not partially commit. The HTTP request never
performs Asset creation synchronously; downstream Asset registration starts
from the committed `GOODS_RECEIPT.POSTED` outbox event.

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

The operational API exposes `GET /api/v1/search` with entity/filter/cursor
parameters and `GET /api/v1/search/autocomplete` as a bounded prefix-only query.
Search applies tenant filtering before querying and evaluates each candidate
using its owning-domain `*.read` permission and resource scope before returning
any display field. Result counts/facets are omitted unless separately
authorization-filtered. Cursor tokens bind the query, type/filter set, sort and
authenticated tenant/user context; authorization is rechecked on every page.

`POST /api/v1/search/reindex` is an idempotent, bounded projection-maintenance
command requiring `search.reindex`, `Idempotency-Key` and a reason. It accepts
one supported entity type and an optional UUID continuation cursor; it never
mutates canonical business records. Exact identifier lookup may fall back to
bounded canonical reads when the derived index is unavailable; fuzzy queries
do not.

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
GOODS_RECEIPT_OVER_ORDERED_QUANTITY
GOODS_RECEIPT_PO_NOT_RECEIVABLE
GOODS_RECEIPT_BLOCKING_EXCEPTION
GOODS_RECEIPT_UNIT_IDENTITY_DUPLICATE
INVOICE_DUPLICATE
INVOICE_APPROVAL_STALE
INVOICE_MATCH_EXCEPTION_REQUIRED
CREDIT_NOTE_OVER_CREDITABLE_AMOUNT
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

The command creates an Identity-owned case in `INITIATED` and captures the
User's current lifecycle state as `pre_offboarding_user_state`. Starting and
advancing the case use explicit commands:

```text
OFFBOARDING.START
OFFBOARDING.RESUME
OFFBOARDING.MARK_READY
OFFBOARDING.COMPLETE
OFFBOARDING.CANCEL
OFFBOARDING.REQUEST_CANCEL
OFFBOARDING.COMPLETE_CANCELLATION
```

Use `identity.offboard` for normal case commands and
`identity.offboard.cancel` for cancellation/recovery commands. Tenant
validation precedes resource-scope evaluation.

`OFFBOARDING.START` moves `INITIATED` to `IN_PROGRESS`; where termination is
effective it separately performs the validated User transition to
`TERMINATING`. Offboarding Case and User Lifecycle remain independent state
machines. `OFFBOARDING.REQUEST_CANCEL` must validate and persist the
authoritative termination request withdrawal reference before entering
`CANCELLATION_PENDING` when the User is `TERMINATING`. Cancellation of a
`TERMINATED` User never reactivates the User; use `USER.REACTIVATE` / REHIRE.
Every state-changing command carries an idempotency key, correlation ID, actor,
reason and target expected version, and requires authorization, audit and
transactional outbox behavior. The target version is the User version for
case creation and the Offboarding Case version for subsequent transitions.
`OFFBOARDING.COMPLETE` and `OFFBOARDING.REQUEST_CANCEL` must compare-and-set the
same case version so only one concurrent transition succeeds.
`OFFBOARDING.CANCEL` is permitted only from `INITIATED` if no compensation is
required; later cancellation uses `REQUEST_CANCEL` and
`COMPLETE_CANCELLATION`.
When a command changes both User Lifecycle and Offboarding Case, it validates
the expected version of each affected aggregate and commits both explicit
Identity transitions atomically. `OFFBOARDING.COMPLETE_CANCELLATION` performs
any permitted restoration only after recovery is complete and the termination
request withdrawal is validated; it never restores `TERMINATED`. Finalization
to `TERMINATED` follows the same explicit, versioned Identity lifecycle
transition before the case can complete.

The HTTP command routes are `POST /api/v1/users/{user_id}/offboarding-cases`,
`POST /api/v1/offboarding-cases/{case_id}/commands/{start|resume|mark-ready|complete|cancel|request-cancel|complete-cancellation|reconcile|resolve-recovery|resolve-clearance}`,
and the atomic immediate path `POST /api/v1/users/{user_id}/commands/start-offboarding`.
`start-offboarding` requires `expected_user_version`, a manually attested
`termination_request_id`, and `reason`. `request-cancel` requires
`expected_version`, `withdrawal_reference`, and `reason`; the reference is
persisted before the case enters `CANCELLATION_PENDING`.

The workflow issues owning-domain commands:

```text
ASSET.REQUEST_RETURN
LICENSE.CANCEL_ASSIGNMENT (ASSIGNED)
LICENSE.RECLAIM (ACTIVE / SUSPENDED)
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
GET  /software/inventory
GET  /software/exceptions
GET  /software/exceptions/{id}
POST /software/products/{id}/aliases
POST /software/products/{id}/uninstall-profiles
POST /software/uninstall-profiles/{id}/commands/approve
POST /software/inventory/{installation_id}/commands/review
POST /software/exceptions/{id}/commands/request-approval
POST /software/exceptions/{id}/commands/approve-temporary
POST /software/exceptions/{id}/commands/mark-false-positive
POST /software/exceptions/{id}/commands/investigate
POST /software/exceptions/{id}/commands/request-removal
POST /software/exceptions/{id}/commands/ignore-by-policy
POST /agent/software-removals/claim
POST /agent/software-removals/{id}/commands/report
```

---

Deployment campaign and target writes require `Idempotency-Key` and
`expected_version`. Campaign targets are tenant-scoped assets. Agent job claim
and result reporting use the authenticated Agent Gateway, short-lived leases,
and normalized results; signed artifact download grants are returned only to
the enrolled agent and are never persisted in audit, events, or idempotency
responses.

Software inventory reports use the existing Agent inventory API with
`Idempotency-Key`, `inventory_complete`, and a bounded normalized item array.
A complete report is the only evidence allowed to mark an installation absent.
Software exception mutations require `expected_version`, reason,
authorization, and idempotency. Temporary exceptions and automatic uninstall
profiles require a distinct approved Approval-domain request. Removal Agent
claims/reports are bound to the enrolled agent's asset and short lease; agent
success does not close an exception until a later complete inventory confirms
absence.

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
POST /license-assignments/{id}/commands/cancel
POST /license-assignments/{id}/commands/activate
POST /license-assignments/{id}/commands/suspend
POST /license-assignments/{id}/commands/complete-reclaim
GET  /license-assignments/{id}
GET  /license-entitlements/{id}/availability
GET  /license-compliance
POST /license-entitlements/{id}/commands/usage-observation
POST /license-exceptions/{id}/commands/approve
POST /license-renewals/{id}/commands/decide
```

Entitlement `effective_state` is derived from its validity window; the
compliance projection is separate. Renewal is idempotent and versioned, and
retains prior contractual terms in append-only history. `LICENSE.EXPIRED` is
keyed to a term version and does not mutate entitlement state.

`POST /license-assignments/{id}/commands/cancel` invokes
`LICENSE.CANCEL_ASSIGNMENT`. It requires `license.assign` authorization,
`Idempotency-Key`, `expected_version`, and a reason. Only an unactivated
`ASSIGNED` record may transition to `CANCELLED`; repeats of the same completed
business request return its result without another state change, capacity
release, audit event, or outbox event. `ACTIVE` and `SUSPENDED` assignments
must use `LICENSE.RECLAIM`.

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
POST /invoices/{id}/commands/update-draft
POST /invoices/{id}/commands/submit
POST /invoices/{id}/commands/reevaluate-match
POST /invoices/{id}/commands/approve
POST /invoices/{id}/commands/reject
POST /invoices/{id}/commands/cancel
POST /credit-notes
POST /credit-notes/{id}/commands/update-draft
POST /credit-notes/{id}/commands/submit
POST /credit-notes/{id}/commands/apply
POST /credit-notes/{id}/commands/reject
POST /credit-notes/{id}/commands/cancel
```

Invoice and Credit Note writes use explicit commands. State-changing requests
carry `Idempotency-Key`, `expected_version` where applicable, tenant/resource
scope authorization, actor and correlation context. `INVOICE.SUBMIT` atomically
freezes the commercial snapshot and reserves the durable duplicate identity.
`INVOICE.REEVALUATE_MATCH` evaluates only a SUBMITTED snapshot and writes a new
append-only evaluation. `CREDIT_NOTE.APPLY` atomically validates remaining
creditable line quantity/amount and writes its one-time application. It
releases invoiceable quantity only for explicitly credited quantity that had
consumed that capacity. These commands never mutate PO commercial history or a
POSTED Goods Receipt.
`INVOICE.CANCEL` and `CREDIT_NOTE.CANCEL` are explicit command endpoints,
allowed only while the respective document is `DRAFT`; they are forbidden
after submission and must not be implemented as generic status updates. Each
uses the normal command transaction and envelope, including
`expected_version`, idempotency, tenant/resource authorization, audit, outbox
and correlation context. Reason is required only if the existing command or
audit standard requires it. A future post-submission cancellation/reversal is
a distinct financial command requiring its own permission and compensation or
reversal contract.

Canonical outcomes include `INVOICE_DUPLICATE` (409),
`INVOICE_MATCH_EXCEPTION_REQUIRED` (409 when a MISMATCHED invoice is
approved without its linked approved exception), `INVOICE_APPROVAL_STALE`
(409), and `CREDIT_NOTE_OVER_CREDITABLE_AMOUNT` (422). Same-key/same-request
replays the original result; same key with a different semantic payload is
`IDEMPOTENCY_KEY_CONFLICT` (409). A different key for an already-reserved
supplier document identity returns `INVOICE_DUPLICATE`.

---

# 66. Contract Commands

```text
POST /api/v1/contracts
POST /api/v1/contracts/{id}/commands/update-draft
POST /api/v1/contracts/{id}/commands/submit-for-signature
POST /api/v1/contracts/{id}/commands/recall-signature
POST /api/v1/contracts/{id}/commands/record-execution
POST /api/v1/contracts/{id}/commands/activate
POST /api/v1/contracts/{id}/commands/hold
POST /api/v1/contracts/{id}/commands/resume
POST /api/v1/contracts/{id}/commands/amend
POST /api/v1/contracts/{id}/commands/expire
POST /api/v1/contracts/{id}/commands/terminate
POST /api/v1/contracts/{id}/commands/cancel

POST /api/v1/renewal-cases
POST /api/v1/renewal-cases/{id}/commands/update-proposal
POST /api/v1/renewal-cases/{id}/commands/complete
POST /api/v1/renewal-cases/{id}/commands/mark-not-renewed
POST /api/v1/renewal-cases/{id}/commands/cancel

POST /api/v1/commercial-documents
POST /api/v1/commercial-documents/{id}/versions
POST /api/v1/commercial-documents/{id}/commands/finalize
POST /api/v1/commercial-documents/{id}/commands/supersede
```

These are explicit command endpoints; lifecycle/status fields are not
generically PATCHed. State-changing requests use `expected_version`,
`Idempotency-Key`, tenant/resource authorization and `correlation_id` where
applicable. Commands that require a reason carry it in the command payload.
Document bytes use the existing governed object-storage upload/reference
flow; this API does not introduce a parallel file store.

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
POST /automation-rules/{id}/commands/update-draft
POST /automation-rules/{id}/commands/publish
POST /automation-rules/{id}/commands/activate
POST /automation-rules/{id}/commands/deactivate
POST /automation-rules/{id}/commands/simulate
GET  /action-intents/{id}
POST /automation-conflicts/{id}/commands/resolve
```

TASK-090 commands are `AUTOMATION.RULE.CREATE`,
`AUTOMATION.RULE.UPDATE_DRAFT`, `AUTOMATION.RULE.PUBLISH_VERSION`,
`AUTOMATION.ACTIVATE`, `AUTOMATION.DEACTIVATE`, `AUTOMATION.SIMULATE` and
`AUTOMATION.INTENT.RESOLVE_CONFLICT`. Event-consumer evaluation and approval
recheck are internal `AUTOMATION.EVENT.EVALUATE` and
`AUTOMATION.INTENT.RECHECK_APPROVAL` commands. A command carries tenant/resource scope,
expected version, idempotency key and correlation/causation identifiers where
applicable. Simulation is read-only with respect to target domains and cannot
create an executable Action Intent.

`AUTOMATION.RETRY_ACTION` and execution cancellation/retry routes are owned by
TASK-091, not TASK-090. Action Intent reads are scoped and do not expose raw
event payloads or protected context.

### TASK-090-R1 policy management surface

If exposed through the API, tenant Action Policy management uses explicit
commands and permissions; principal grants remain managed by canonical
Authorization administration:

```text
GET  /api/v1/automation-action-policies
POST /api/v1/automation-action-policies
POST /api/v1/automation-action-policies/{id}/commands/update-draft
POST /api/v1/automation-action-policies/{id}/commands/activate
POST /api/v1/automation-action-policies/{id}/commands/deactivate
```

Command intents are `AUTOMATION.ACTION_POLICY.CREATE`,
`AUTOMATION.ACTION_POLICY.UPDATE_DRAFT`, `AUTOMATION.ACTION_POLICY.ACTIVATE`
and `AUTOMATION.ACTION_POLICY.DEACTIVATE`. Mutations require tenant scope,
the corresponding `automation.policy.*` permission, expected version,
idempotency key, reason, audit and correlation metadata as applicable.
Published/active versions are immutable; updates produce a new version. No
API creates wildcard or implicit-ALLOW policy/grants. An explicit
`AUTOMATION.INTENT.REEVALUATE_POLICY` (or equivalent authorized command) is
required to reconsider a previously blocked intent after policy changes; no
silent background promotion is allowed. Exact route availability is an
implementation decision, but command semantics and authorization are
normative. See the TASK-090-R1 contract.

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

# 71. TASK-091 Action Execution API

Execution reads are tenant/resource scoped under `automation.intent.read`.
The Action Intent remains a decision/request; callers query the separate
Action Execution history for actual execution state.

Human operator routes:

```text
GET  /api/v1/automation/action-executions/{execution_id}
POST /api/v1/automation/action-executions/{execution_id}/commands/cancel
POST /api/v1/automation/action-executions/{execution_id}/commands/retry
```

`AUTOMATION.CANCEL_ACTION` requires `execution.cancel`, `expected_version`,
`Idempotency-Key`, reason and correlation metadata. It is allowed only when
durable state proves the Agent has not accepted the command. Ambiguous
delivery/acceptance cannot be cancelled and must become `UNKNOWN`.

`AUTOMATION.RETRY_ACTION` requires `execution.retry`, `expected_version`,
`Idempotency-Key`, reason and explicit reconciliation evidence that the
previous attempt did not successfully restart the Agent. It creates new
execution/command IDs linked to the prior attempt and repeats all security
checks. It cannot bypass current capability/policy, principal authorization,
resource scope, approval, conflict, target or kill switch. Same key/request
returns the original result; a changed payload returns
`IDEMPOTENCY_KEY_CONFLICT`.

Authenticated Agent routes use the existing Agent Gateway authentication
contract. Tenant and Agent IDs are derived from that principal, never trusted
from request parameters:

```text
POST /api/v1/agent/automation-actions/claim
POST /api/v1/agent/automation-actions/{command_id}/commands/accept
POST /api/v1/agent/automation-actions/{command_id}/commands/report
```

Claim returns only fixed typed `RESTART_AGENT`, with immutable
`execution_id`, `command_id`, `intent_id`, `tenant_id`, `target_agent_id`,
`action_type`, `correlation_id` and `issued_at`. No shell, script, binary,
process, URL or arbitrary payload field exists. The Agent durably deduplicates
`(tenant_id, agent_id, command_id)` and rejects same-ID/different-content
replay. Claim/dispatch is not acceptance; an authenticated exact-command
acknowledgement is required. Acceptance is not success.

Authenticated heartbeat/Agent evidence carries `agent_runtime_id`, generated
per process/service runtime and changed on actual restart, not ordinary
network reconnect. TASK-091 succeeds only on a same-Agent/same-tenant runtime
marker newer than the pre-dispatch baseline, observed after acceptance within
five minutes of `accepted_at`. An ordinary heartbeat or command ACK alone
cannot prove success. Ambiguous delivery or verification timeout is
`UNKNOWN`; v1 has one automatic attempt and no automatic retry.

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

## TASK-092 Incident Correlation Commands

Correlation evaluation is an Incident-domain workflow invoked from canonical
events/evidence; it is not an Action Intent and never dispatches TASK-091.
Expose decision/evidence through tenant- and resource-scoped read queries.

Explicit mutation intents are:

```text
INCIDENT.CORRELATION_ATTACH
INCIDENT.CORRELATION_DETACH
INCIDENT.CORRELATION_REJECT
```

Attach identifies child Incident and Root Incident. It requires the
`incident.correlation.review` permission for the human reviewer, same-tenant/resource scope,
`expected_version`, `Idempotency-Key`, a reason, correlation context, audit
and transactional outbox. It records a separate human decision and never
rewrites the machine evaluation. Detach targets the active relationship,
requires `incident.correlation.detach`, expected version, idempotency and
reason, and records a durable same-Root automatic-link suppression. Reject
records the reviewer/reason against the unresolved decision and leaves the
machine evidence immutable. Commands cannot close/reopen/delete Incidents or
rewrite Ticket/monitoring/topology history. Competing relationship commands
return canonical version/concurrency conflicts; clients reload canonical
state rather than silently reparenting.

---

## TASK-093 Knowledge Recommendation API Intents

Expose existing-convention routes equivalent to:

```text
POST /api/v1/knowledge/recommendation-sessions
GET  /api/v1/knowledge/recommendation-sessions/{session_id}
POST /api/v1/knowledge/recommendation-sessions/{session_id}/commands/select
POST /api/v1/knowledge/recommendation-sessions/{session_id}/commands/feedback
POST /api/v1/knowledge/recommendation-sessions/{session_id}/commands/confirm-resolution
POST /api/v1/knowledge/recommendation-sessions/{session_id}/commands/escalate
```

Command intents are `KNOWLEDGE.RECOMMEND`,
`KNOWLEDGE.RECOMMENDATION_SELECT`, `KNOWLEDGE.RECOMMENDATION_FEEDBACK`,
`KNOWLEDGE.DEFLECTION_CONFIRM` and `KNOWLEDGE.RECOMMENDATION_ESCALATE`.
Writes use `Idempotency-Key`, tenant/session and actor scope, correlation,
and expected version where the aggregate is versioned. Return only currently
eligible/authorized end-user-safe items (maximum three, TASK-093 profile).
Escalation calls canonical Helpdesk Ticket intake and links its result; it
does not mutate Ticket state directly. There is no automatic close/resolve
intent. Same key/different payload returns canonical idempotency conflict.

## TASK-093-R2A Reference Catalog Commands

The Service Reference owner exposes tenant-scoped commands for
`SERVICE.CREATE/UPDATE/DEACTIVATE`, `PLATFORM.CREATE/UPDATE/DEACTIVATE` and
`SERVICE_ENVIRONMENT.CREATE/UPDATE/DEACTIVATE`, plus ID detail queries.
Updates and deactivation require `expected_version`; all mutations require
`Idempotency-Key`, authorization and audit/outbox correlation. Deactivation
is explicit and records `INACTIVE`; there is no generic `SET_STATE` or hard
delete. Environment creation validates an active same-tenant canonical
Service. Incident writes may reference only a canonical same-tenant Service
ID; legacy references remain observational and unresolved.

## TASK-093-R2 Knowledge and Ticket Foundation Commands

`GET /api/v1/knowledge/{id}` returns only a canonical `PUBLISHED` article
after tenant-scoped audience/read authorization (`knowledge.read` for
`END_USER_SAFE`; `knowledge.read.operator` for `OPERATOR_ONLY`). Knowledge
managers use `POST /api/v1/knowledge/{id}/commands/set-audience` with
`expected_version`, audience and reason, or `.../set-applicability` with
`expected_version`, typed canonical target references and reason. Both use
`knowledge.manage`, `Idempotency-Key`, audit and `KNOWLEDGE.UPDATED` outbox.

`TICKET.CREATE` accepts optional typed
`source_context: {type: 'KNOWLEDGE_RECOMMENDATION', reference_id: UUID}`.
Omission preserves existing clients. The value is tenant-bound to the Ticket,
immutable after creation and authorization-neutral; it does not perform a
cross-domain write or require a RecommendationSession table/FK.

## TASK-094 Asset Scoring Commands and Queries

Expose tenant/resource-scoped queries for current Risk and Replacement
assessments and immutable assessment history. A current response includes
score, band, completeness, profile/version, `as_of`, freshness/`valid_until`
and explainable evidence references; it must not expose cost documents or
cross-tenant evidence.

Provide an explicit idempotent `ASSET.SCORING.RECALCULATE` command at
`POST /api/v1/assets/{id}/commands/recalculate-scoring`, guarded by
`asset.scoring.recalculate`, required `expected_version`, Idempotency-Key and
correlation context. Useful-life policy create/version operations use
`asset.scoring.manage_policy`, tenant/category scope, versioning, reason, audit
and idempotency. A verified acquisition-date command, if required by existing
Asset storage, requires source kind, actor/reason, expected version, audit and
idempotency. It must not accept a guessed timestamp from `created_at`.

Automated triggers enqueue scoring through the standard worker/event path;
queries never recalculate implicitly. `GET /api/v1/assets/{id}/assessments`
returns immutable history and marks latest projection freshness. Candidate
creation is delegated to the TASK-059 owning application command/port.
TASK-094 APIs do not approve a
candidate, create a PO, or mutate Asset lifecycle/assignment.

TASK-094-R2 prerequisite commands/ports:

- `MAINTENANCE.CREATE` requires typed classification; `UNKNOWN` is reserved
  for legacy/import paths. `MAINTENANCE.CLASSIFICATION_UPDATE` requires
  `maintenance.manage`, reason and expected version and is denied after a
  terminal order state. The Maintenance Asset History query is tenant-scoped,
  read-only and returns `AVAILABLE` with zero rows distinctly from query
  failure.
- TASK-059's `recommendReplacementCandidate` command requires
  `replacement.create_candidate` authorization for the tenant/Asset and
  assessment/profile evidence. It returns explicit recommendation outcomes,
  preserves active candidate human state and does not recreate after terminal
  disposition. Material create/update writes history, outbox/audit and the
  canonical review Work Item in the same unit of work.
- `OFFBOARDING.ASSET_RECOVERY_STATE` is a tenant/case/Asset-scoped,
  idempotent, expected-clearance-version command with reason. Operators may
  classify an unresolved request `UNRETURNED`/`MISSING`; restoration to
  `PENDING_RETURN` requires a canonical pending Asset return request.
  `RETURNED` is recorded only after Asset-domain completion is confirmed.

### TASK-094-R3 query and link contracts

- `INCIDENT.ASSET_LINK` requires `incident.asset_link`, same-tenant Asset
  resolution, an explicit reason, idempotency and append-only relationship
  history. The API accepts only a canonical `asset_id`; it does not infer an
  Asset from user assignment or text. The paired audited unlink command marks
  the active link DETACHED and preserves its history.
- Incident creation may preserve `asset_id` only when explicitly selected in
  intake. Monitoring-origin association is created only from an exact,
  same-tenant Monitoring event whose Asset reference was canonical-validated.
- `IncidentAssetHistoryQuery` and `MonitoringAssetReliabilityQuery` are
  owning-domain, tenant-scoped read contracts authorized through
  `AuthorizationPort`; successful empty results remain distinct from query
  failure. Monitoring source identity that cannot be resolved returns
  unavailable evidence.
- `WarrantyAssetQuery(tenant, asset_id, as_of)` requires `warranty.read` and
  returns minimum effective Warranty evidence plus `WARRANTY_STATE_V1`. A
failed query propagates unavailable/error; an empty successful query is
UNKNOWN / NO_WARRANTY. `ASSET.WARRANTY_STATE_PROJECTED` is an internal
worker-owned derived projection, not a Warranty lifecycle command.

### TASK-095 Reporting query contracts

Reporting exposes tenant-scoped read contracts for KPI catalog, current result,
UTC period/history, allowed dimensions, reauthorized drill-down and aggregate
CSV. Requests validate KPI/version, UTC `[start,end)`, controlled filters and
dimensions; unsupported dimensions are validation errors. No request accepts
SQL, executable expressions or arbitrary grouping. CSV uses the same result
authorization path, binds KPI/version/period/dimensions/revision/as-of, and
contains aggregates only. Reporting queries have no workflow side effects.

TASK-095-R2 adds internal owning-domain state-at query contracts. They return
`KNOWN_STATE`, `NOT_YET_CREATED`, `INSUFFICIENT_HISTORY` or an unavailable
result, plus aggregate coverage (`COMPLETE`/`PARTIAL`). Queries are tenant
scoped, use effective time with version/sequence tie-breaking, and never
substitute current state for missing pre-anchor history.

`POST /api/v1/sla-targets/{id}/commands/set-purpose` implements
`SLA.SET_TARGET_PURPOSE` for authorized legacy classification. It requires a
typed non-UNKNOWN purpose, `reason`, `expected_version`, and `Idempotency-Key`;
the operation is tenant scoped and writes classification history, audit and
outbox evidence atomically. New SLA target creation/configuration must supply
typed `target_purpose`. The internal `ResolutionSlaOutcomeQuery` accepts a UTC
`[start_at,end_at)` interval and reports `AVAILABLE`, `AVAILABLE_EMPTY`,
`AMBIGUOUS_TARGET_PURPOSE`, or finalization/query unavailability. Only
`RESOLUTION` outcomes are KPI-004 obligations.

Runtime routes are `GET /api/v1/kpis/catalog`, `GET
/api/v1/kpis/{id}/current`, `GET /api/v1/kpis/{id}/history`, `GET
/api/v1/kpis/{id}/drilldown` and `GET
/api/v1/kpis/{id}/export.csv`. Catalog results publish each version's
dimension allow-list. Unknown query parameters, arbitrary grouping and
unsupported dimensions are rejected. Drill-down candidates are returned only
after owning-domain authorization; aggregate access alone does not reveal
contributing IDs or metadata. CSV uses the same governed result/snapshot path
and writes a metadata-only export audit record before responding.

### TASK-096 recommendation discovery API

TASK-096 exposes tenant-scoped `GET /api/v1/recommendations`,
`GET /api/v1/recommendations/{id}`,
`GET /api/v1/recommendations/{id}/revisions`, and
`POST /api/v1/recommendations/{id}/commands/interact`. Feed filters are
allow-listed to v1 family, canonical context type and projection state;
pagination is bounded. Interactions accept only `VIEWED`, `DISMISSED` and
`OPENED_SOURCE` with `Idempotency-Key`. There is no generic accept/action
command. Responses include per-family `AVAILABLE_EMPTY` or
`SOURCE_UNAVAILABLE` status and typed server-defined source-workflow action
descriptors, never arbitrary persisted URLs. The actor must pass both
`recommendation.read` and the owning source's current read/presentation
authorization. No unauthorized source identity or explanation metadata is
returned.
