# TASK-000_PHASE0_BOOTSTRAP.md
## Phase 0 — Backend Repository Bootstrap

```yaml
task_id: TASK-000
feature_id: FOUNDATION
workflow_id: PLATFORM-BOOTSTRAP
phase: P0
priority: P0
status: CODE_COMPLETE
owner_domain: Platform
```

---

# 1. Objective

Bootstrap the backend repository structure required to begin implementation of the IT Operations Hub.

This task is **foundation only**.

Do not implement Asset, Helpdesk, Incident, Network, Software, License, Procurement, or other business workflows.

The goal is to establish a clean, enforceable codebase skeleton that future feature tasks can extend without architectural drift.

---

# 2. Required Specifications

Read first:

```text
AGENTS.md
MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md
BACKEND_REPOSITORY_MODULE_STRUCTURE_SPEC.md
MVP_PHASED_IMPLEMENTATION_PLAN.md
```

Then consult as needed:

```text
API_COMMAND_CONTRACT_SPEC.md
EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md
ERROR_RETRY_IDEMPOTENCY_STANDARD.md
DATABASE_STORAGE_BOUNDARY_SPEC.md
AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md
PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md
```

---

# 3. Task Rule

Before creating files:

```text
1. Inspect the existing repository.
2. Detect language/framework/package manager already in use.
3. Preserve existing working conventions unless they violate the architecture.
4. Produce the proposed initial tree.
5. Produce the implementation plan.
6. Then implement.
```

Do not replace a viable existing stack merely because another stack is preferred.

---

# 4. In Scope

Establish the foundation for:

```text
apps/api
apps/worker
apps/agent-gateway

modules/identity
modules/audit

packages/shared-kernel
packages/api-contracts
packages/event-contracts
packages/auth
packages/config
packages/observability
packages/persistence
packages/messaging
packages/object-storage
packages/testing

database/migrations
database/seeds
database/fixtures

contracts/openapi
contracts/asyncapi
contracts/json-schema

tests/contract
tests/e2e

docs/adr
docs/runbooks
```

Directories may be adapted to the language/framework, but architectural roles must remain clear.

---

# 5. Out of Scope

Do **not** implement:

```text
Asset business workflows
Ticket business workflows
Incident workflows
Maintenance
Network discovery
Software deployment
License management
Procurement
Contracts
Advanced reporting
Advanced search
Automation rules
AI/intelligence
```

Do not create placeholder business implementations pretending these are complete.

---

# 6. Expected Initial Tree

Codex should adapt this to the actual stack:

```text
/
├─ AGENTS.md
├─ apps/
│  ├─ api/
│  ├─ worker/
│  └─ agent-gateway/
│
├─ modules/
│  ├─ identity/
│  │  ├─ domain/
│  │  ├─ application/
│  │  ├─ infrastructure/
│  │  ├─ interfaces/
│  │  └─ README.md
│  │
│  └─ audit/
│     ├─ domain/
│     ├─ application/
│     ├─ infrastructure/
│     ├─ interfaces/
│     └─ README.md
│
├─ packages/
│  ├─ shared-kernel/
│  ├─ api-contracts/
│  ├─ event-contracts/
│  ├─ auth/
│  ├─ config/
│  ├─ observability/
│  ├─ persistence/
│  ├─ messaging/
│  ├─ object-storage/
│  └─ testing/
│
├─ database/
│  ├─ migrations/
│  ├─ seeds/
│  └─ fixtures/
│
├─ contracts/
│  ├─ openapi/
│  ├─ asyncapi/
│  └─ json-schema/
│
├─ tests/
│  ├─ contract/
│  └─ e2e/
│
├─ docs/
│  ├─ adr/
│  └─ runbooks/
│
└─ infra/
```

Do not create empty directories with no useful skeleton if the chosen tooling does not track them. Add minimal READMEs or index files only where they help establish the boundary.

---

# 7. Foundation Architecture

Initial runtime processes:

```text
API
Worker
Agent Gateway
```

Initial persistence:

```text
PostgreSQL
```

Optional foundation dependencies if already part of project/environment:

```text
Redis/Valkey
Message Broker
S3-compatible Object Storage
```

Do not introduce infrastructure that is not required to validate the skeleton.

---

# 8. Required Foundation Interfaces

Create minimal purposeful abstractions for:

```text
Clock
IdGenerator
CorrelationContext
ActorContext
UnitOfWork
OutboxWriter
InboxStore
IdempotencyStore
AuthorizationPort
AuditPort
EventPublisher
```

Only implement abstractions actually needed to establish the foundation.

Do not over-abstract trivial code.

---

# 9. Configuration Foundation

Implement typed/validated configuration for applicable values:

```text
application environment
HTTP port
database connection
broker connection if enabled
object storage connection if enabled
logging level
service name
```

Production mode must reject unsafe defaults where practical.

Do not store actual secrets in the repo.

---

# 10. Correlation Foundation

Every inbound HTTP request should be capable of carrying/creating:

```text
request_id
correlation_id
```

Internal command/event context should preserve correlation.

If the chosen framework supports middleware/interceptors, use them.

---

# 11. Canonical Error Foundation

Implement the canonical response shape required by the API contract.

Minimum error classes to establish:

```text
VALIDATION_ERROR
AUTHENTICATION_REQUIRED
PERMISSION_DENIED
NOT_FOUND
VERSION_CONFLICT
IDEMPOTENCY_KEY_CONFLICT
BUSINESS_RULE_VIOLATION
DEPENDENCY_UNAVAILABLE
INTERNAL_ERROR
```

Do not expose raw stack traces in production responses.

---

# 12. Idempotency Foundation

Create durable schema/model/interface for:

```text
idempotency_records
```

Minimum fields:

```text
id
idempotency_key
operation
principal_id
request_hash
state
response_status
result_reference / response reference
created_at
expires_at
```

States:

```text
IN_PROGRESS
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
EXPIRED
```

Do not yet implement every business endpoint with it.

Provide foundation + tests.

---

# 13. Outbox Foundation

Create:

```text
outbox_events
```

Minimum fields aligned with event contract:

```text
id
event_id
event_type
schema_version
aggregate_type
aggregate_id
aggregate_version
payload
correlation_id
causation_id
occurred_at
published_at
attempt_count
status
```

Implement a minimal publisher path or worker skeleton.

Business transactions in later tasks must be able to write outbox atomically.

---

# 14. Inbox Foundation

Create durable inbox/dedupe support.

Minimum identity:

```text
consumer_name + event_id
```

Support:

```text
not processed
processed
failed
```

Consumer helper must make duplicate delivery safe.

---

# 15. Operation Registry Foundation

Create minimal operation tracking for future async commands/jobs:

```text
QUEUED
RUNNING
WAITING
SUCCEEDED
FAILED
CANCELLED
```

Minimum:

```text
operation_id
type
target
state
correlation_id
created_at
updated_at
error_code
```

---

# 16. Audit Foundation

Create append-only audit storage foundation.

Minimum:

```text
audit_events
audit_event_relations
audit_evidence_links
```

The foundation must support:

```text
actor
action
subject
correlation
reason
before
after
outcome
classification
```

Do not implement full timeline in this task.

---

# 17. Identity Module Foundation

Create the identity module boundary and minimal data model needed for later authentication/RBAC tasks.

Minimum conceptual entities:

```text
User
ExternalIdentity
Role
Permission
RoleBinding
```

Do not attempt full Joiner/Mover/Leaver workflows yet.

---

# 18. Baseline Permission Seed

Create baseline permission registration/seeding mechanism.

Do not seed every future permission if it creates maintenance noise.

At minimum establish a pattern and foundation permissions required for Phase 0 administration.

If the full catalog is generated from module declarations, establish that pattern instead.

---

# 19. Authentication Boundary

Provide integration boundary for OIDC-compatible authentication.

Do not build a custom password identity system unless explicitly required by the existing project.

If authentication provider configuration is unavailable, implement the adapter/contract and safe development stub only if the repository already supports development auth.

No production auth bypass.

---

# 20. Authorization Boundary

Create a minimal authorization service/port that accepts:

```text
principal
action
resource
scope/context
```

and returns:

```text
ALLOW / DENY
reason
```

Full RBAC matrix implementation may be a follow-up task if it materially expands scope.

If a minimal RBAC evaluator is straightforward and required for tests, implement only the core role-binding → permission → scope path.

---

# 21. Persistence Foundation

Create:

```text
DB connection/pool
transaction helper
migration runner integration
```

Do not create generic repositories for all future domains.

---

# 22. Migration Organization

Establish domain-owned migration layout.

At minimum:

```text
database/migrations/identity
database/migrations/platform
database/migrations/audit
```

If the chosen migration tool requires one linear folder, preserve logical ownership in naming conventions.

---

# 23. Observability Foundation

Implement:

```text
structured logging
basic metrics hook
trace/correlation hook if OpenTelemetry already fits stack
health/readiness endpoints
```

Minimum service metadata:

```text
service name
environment
request_id
correlation_id
```

---

# 24. Health Endpoints

API should expose minimal:

```text
live
ready
```

Readiness may check critical dependencies such as DB.

Do not make health checks execute heavy business queries.

---

# 25. Worker Foundation

Worker should be able to host:

```text
outbox publisher
event consumers
scheduled/background jobs
```

At least one test/skeleton path should demonstrate startup and graceful shutdown.

---

# 26. Agent Gateway Foundation

Establish process/module boundary only.

Minimum:

```text
health
auth boundary
versioned route namespace
```

Do not implement full heartbeat/inventory jobs in this task unless required to prove the boundary.

---

# 27. API Contract Foundation

Create or establish:

```text
OpenAPI source location
canonical response/error envelope
version prefix
```

Expected version prefix:

```text
/api/v1
```

---

# 28. Event Contract Foundation

Create or establish:

```text
event envelope schema
schema_version
actor
aggregate
correlation_id
causation_id
tenant/org fields
payload
```

Use a single source-of-truth where practical.

---

# 29. Static Dependency Rules

Add lint/build rules where tooling allows.

At minimum enforce conceptually:

```text
domain cannot import infrastructure
module A cannot import module B infrastructure
shared-kernel cannot import business domains
apps can compose modules
```

If automated enforcement is not practical in this bootstrap task, document the gap explicitly.

---

# 30. Local Development Foundation

If repository has no equivalent, provide a minimal local stack for required dependencies.

Prefer existing conventions.

Possible:

```text
PostgreSQL
Redis/Valkey if actually used
Broker if actually used
Object storage if actually used
```

Do not add the entire future production stack merely for completeness.

---

# 31. CI Skeleton

Establish pipeline stages appropriate to the stack:

```text
install
format/lint
typecheck or compile
unit tests
dependency checks
contract validation
migration test
build
```

Security/package scanning may be added if existing CI platform supports it cleanly.

---

# 32. Required Foundation Tests

Must include tests for applicable parts:

```text
configuration validation
canonical error mapping
correlation middleware/context
idempotency duplicate semantics
outbox persistence
inbox duplicate suppression
migration application
audit append-only write
authorization allow/deny skeleton
health endpoint
```

---

# 33. Migration Test

CI/test should prove:

```text
empty database
→ all Phase 0 migrations apply successfully
```

If supported, also test:

```text
rollback or clean rebuild
```

according to chosen migration strategy.

---

# 34. No Placeholder Completion

Do not create files containing only:

```text
TODO
Not implemented
```

and claim the foundation is ready.

Skeleton files are acceptable only if they establish a clear, compilable extension point.

---

# 35. Expected APIs

Minimum, if compatible with current repository:

```text
GET /api/v1/health/live
GET /api/v1/health/ready
GET /api/v1/me
GET /api/v1/operations/{id}
```

If `/me` cannot be implemented without a real identity provider, return a safely authenticated development principal only in non-production mode, or defer it with an explicit gap.

Do not implement an insecure production fallback.

---

# 36. Expected Database Foundation

Minimum logical data groups:

```text
identity:
  users
  external_identities
  roles
  permissions
  role_permissions
  role_bindings

platform:
  idempotency_records
  outbox_events
  inbox_events
  operations

audit:
  audit_events
  audit_event_relations
  audit_evidence_links
```

Names may adapt to project naming conventions.

---

# 37. Security Requirements

Must not:

```text
commit secrets
allow production auth bypass
trust client-provided role claims without validation
expose stack traces to clients
use a shared super-admin shortcut as foundation authorization
```

---

# 38. Acceptance Criteria

TASK-000 is accepted only when:

1. The repository has explicit boundaries for API, Worker and Agent Gateway.
2. Identity and Audit module boundaries exist.
3. Shared packages are focused and do not contain business-domain concepts.
4. PostgreSQL migration structure exists and applies successfully.
5. Idempotency foundation exists with durable storage.
6. Outbox foundation exists.
7. Inbox duplicate suppression foundation exists.
8. Operation registry foundation exists.
9. Canonical error response foundation exists.
10. Correlation/request context is propagated through inbound API handling.
11. Append-only audit write foundation exists.
12. Typed/validated configuration exists.
13. Basic structured observability exists.
14. API health/readiness endpoints work.
15. CI can lint/typecheck-or-compile/test/build according to the chosen stack.
16. Relevant foundation tests pass.
17. No business-domain feature beyond Phase 0 was implemented.
18. Codex reports remaining gaps accurately instead of hiding them.

---

# 39. Verification

Codex must discover the repository's real commands.

Run all applicable categories:

```text
format
lint
typecheck/compile
unit tests
integration tests
migration tests
contract validation
build
```

If infrastructure tests require local containers, state what was run and what could not run.

---

# 40. Completion Report

Codex must return:

```markdown
## TASK-000 Implementation Report

### Status
IMPLEMENTED / PARTIAL / BLOCKED

### Repository Tree Added/Changed
...

### Architecture Decisions
...

### Database / Migrations
...

### Foundation Interfaces
...

### APIs
...

### Event / Messaging Foundation
...

### Audit Foundation
...

### Security / Authorization Foundation
...

### CI / Local Development
...

### Tests Run
| Command | Result |
| ------- | ------ |

### Remaining Gaps
...

### SPEC_CONFLICT
none / ...

### SCOPE_DEPENDENCY
none / ...

### IMPLEMENTATION_ASSUMPTION
none / ...
```

---

# 41. Stop Conditions

Stop and report before materially proceeding if:

```text
the repository already has a conflicting architecture
the existing framework cannot support the requested layout without migration
the database/migration system is unclear
authentication architecture conflicts with the spec
a destructive repository restructure would be required
```

Do not perform a large destructive rewrite without approval.

---

# 42. Next Task After TASK-000

Recommended next task:

```text
TASK-001_IDENTITY_RBAC_FOUNDATION
```

Only after TASK-000 verification passes.

Do not automatically continue into TASK-001 unless explicitly instructed.
