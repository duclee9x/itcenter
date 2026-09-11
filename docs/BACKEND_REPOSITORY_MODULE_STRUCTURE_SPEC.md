# BACKEND REPOSITORY + MODULE STRUCTURE SPEC
## IT Operations Hub — Repository Layout, Module Boundaries, Dependency Rules, and Backend Implementation Standard

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`  
**Depends on:**  
- `MVP_PHASED_IMPLEMENTATION_PLAN.md`
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `API_COMMAND_CONTRACT_SPEC.md`
- `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `STATE_MACHINE_MASTER_SPEC.md`
- `ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`

**Purpose:** Define the backend repository layout, deployable applications, domain modules, dependency rules, application/domain/infrastructure boundaries, command/query/event handlers, persistence organization, migrations, shared libraries, worker architecture, testing structure, code ownership, configuration, observability, and extraction path from modular monolith to services.

---

# 1. Mục tiêu

Tài liệu này là cầu nối từ:

```text
Architecture / Workflow / Data Spec
```

sang:

```text
Actual Source Code
```

Nó phải trả lời:

```text
Code nằm ở đâu?
Module nào sở hữu entity nào?
Module nào được import module nào?
Command handler nằm ở đâu?
Event handler nằm ở đâu?
DB repository nằm ở đâu?
Migration tổ chức thế nào?
Shared library chứa gì?
Cái gì tuyệt đối không được để trong shared?
Worker chạy job ở đâu?
Khi nào tách module thành service riêng?
```

---

# 2. Recommended Initial Architecture

Khuyến nghị ban đầu:

```text
Modular Monolith
+
Specialized Workers
+
Strict Domain Boundaries
```

Deployable units:

```text
api
worker
agent-gateway
```

Optional later:

```text
monitoring-ingestion
network-discovery
notification-worker
search-indexer
reporting-worker
```

---

# 3. Why Modular Monolith First

Ưu điểm:

```text
faster delivery
simpler deployment
simpler transaction boundaries
easier debugging
lower infrastructure cost
easier schema migration
```

Nhưng vẫn phải giữ:

```text
logical service ownership
module boundaries
command/event contracts
no cross-domain repository writes
```

để có thể tách service sau này.

---

# 4. Recommended Repository Shape

```text
/
├─ apps/
│  ├─ api/
│  ├─ worker/
│  ├─ agent-gateway/
│  └─ cli/
│
├─ modules/
│  ├─ identity/
│  ├─ asset/
│  ├─ helpdesk/
│  ├─ incident/
│  ├─ problem/
│  ├─ change/
│  ├─ maintenance/
│  ├─ audit-ops/
│  ├─ network/
│  ├─ software/
│  ├─ artifact/
│  ├─ license/
│  ├─ procurement/
│  ├─ contract/
│  ├─ document/
│  ├─ approval/
│  ├─ sla/
│  ├─ automation/
│  ├─ communication/
│  ├─ operations/
│  ├─ search/
│  └─ reporting/
│
├─ packages/
│  ├─ shared-kernel/
│  ├─ api-contracts/
│  ├─ event-contracts/
│  ├─ auth/
│  ├─ observability/
│  ├─ persistence/
│  ├─ messaging/
│  ├─ object-storage/
│  ├─ config/
│  └─ testing/
│
├─ database/
│  ├─ migrations/
│  ├─ seeds/
│  ├─ fixtures/
│  └─ scripts/
│
├─ contracts/
│  ├─ openapi/
│  ├─ asyncapi/
│  └─ json-schema/
│
├─ infra/
│  ├─ docker/
│  ├─ helm/
│  ├─ terraform/
│  └─ observability/
│
├─ docs/
│  ├─ architecture/
│  ├─ adr/
│  └─ runbooks/
│
├─ scripts/
└─ tests/
   ├─ e2e/
   ├─ contract/
   └─ performance/
```

---

# 5. Deployable Applications

## `apps/api`

Responsibilities:

```text
HTTP API
Authentication integration
Authorization entry point
Command dispatch
Query dispatch
Request validation
Response formatting
Correlation IDs
Rate limiting
```

Must not contain:

```text
business rules
direct SQL
domain state transitions
```

---

# 6. `apps/worker`

Responsibilities:

```text
event consumers
background jobs
outbox publishing
notifications
timeline projection
search indexing
retry processing
scheduled tasks
```

The worker hosts handlers from modules.

---

# 7. `apps/agent-gateway`

Responsibilities:

```text
Agent authentication
Heartbeat intake
Inventory intake
Job polling
Job result submission
Rate limiting
Payload validation
```

Agent Gateway must not expose general admin APIs.

---

# 8. `apps/cli`

Useful for:

```text
migration
backfill
reindex
repair projection
audit verification
bootstrap admin
import
diagnostics
```

Every dangerous CLI command requires explicit environment + confirmation guard.

---

# 9. Domain Module Standard

Every domain module follows:

```text
module/
├─ domain/
├─ application/
├─ infrastructure/
├─ interfaces/
└─ index.*
```

---

# 10. Domain Layer

Example:

```text
modules/asset/domain/
├─ entities/
├─ value-objects/
├─ services/
├─ events/
├─ policies/
├─ repositories/
├─ errors/
└─ state-machines/
```

Domain layer contains:

```text
business rules
invariants
state transitions
entity behavior
value objects
domain policies
repository interfaces
domain events
```

Domain layer must not depend on:

```text
HTTP
ORM
Redis
Kafka/NATS/RabbitMQ
framework controllers
database driver
```

---

# 11. Application Layer

```text
modules/asset/application/
├─ commands/
├─ queries/
├─ handlers/
├─ dto/
├─ ports/
├─ workflows/
├─ mappers/
└─ services/
```

Responsibilities:

```text
orchestrate use case
load aggregates
authorize application action
call domain behavior
persist
write outbox
return result
```

---

# 12. Infrastructure Layer

```text
modules/asset/infrastructure/
├─ persistence/
├─ messaging/
├─ integrations/
├─ storage/
├─ cache/
└─ schedulers/
```

Responsibilities:

```text
repository implementation
ORM mapping
external API adapters
event broker adapters
cache adapter
object storage adapter
```

---

# 13. Interfaces Layer

```text
modules/asset/interfaces/
├─ http/
├─ events/
├─ jobs/
└─ cli/
```

Responsibilities:

```text
HTTP controllers
event consumers
job entry points
CLI handlers
```

Interfaces call application layer only.

---

# 14. Dependency Direction

Allowed:

```text
interfaces
    ↓
application
    ↓
domain
```

Infrastructure:

```text
infrastructure
→ implements application/domain ports
```

Domain never imports infrastructure.

---

# 15. Module-to-Module Dependency Rule

Forbidden:

```text
asset.infrastructure
→ helpdesk.infrastructure

helpdesk
→ asset repository directly
```

Allowed:

```text
Helpdesk
→ Asset Application Contract

Helpdesk
→ Asset Read Model

Helpdesk
← ASSET.ASSIGNED event
```

---

# 16. Cross-Domain Write Rule

A module must never directly mutate another module's tables.

Forbidden:

```text
Helpdesk handler
UPDATE asset.assets
```

Required:

```text
Issue command to Asset module
```

or trigger workflow/event.

---

# 17. Cross-Domain Read Rule

Preferred order:

```text
1. Local read projection
2. Application contract
3. Internal query API
4. Controlled shared read model
```

Direct cross-schema read may be tolerated during MVP only when explicitly documented.

---

# 18. Shared Kernel Principle

`shared-kernel` must stay small.

Allowed:

```text
EntityId
TenantId
Money
Clock
DateRange
Result
DomainError base
Pagination
CorrelationContext
ActorContext
Version
```

---

# 19. Shared Kernel Must Not Contain

Do not put:

```text
AssetStatus
TicketPriority
LicenseType
PurchaseOrderState
UserRoleNames
business services
repositories
```

These belong to owning domain.

---

# 20. API Contracts Package

`packages/api-contracts`

Contains:

```text
request/response DTO contracts
common error envelope
pagination contract
operation resource contract
```

Does not contain domain implementation.

---

# 21. Event Contracts Package

`packages/event-contracts`

Contains:

```text
event envelope
event schemas
schema version
common event metadata
generated validators/types
```

Each event owner remains domain-specific.

---

# 22. Auth Package

`packages/auth`

Contains:

```text
principal context
permission evaluator client/interface
scope resolver
middleware/helpers
reauth context
MFA context
```

Does not define business roles as hardcoded application logic.

---

# 23. Observability Package

`packages/observability`

Provides:

```text
structured logging
metrics
tracing
correlation propagation
error capture
```

No business logic.

---

# 24. Persistence Package

`packages/persistence`

Can provide:

```text
DB client
transaction abstraction
migration helpers
base pagination helper
outbox primitives
```

Must not become one giant generic repository framework.

---

# 25. Messaging Package

`packages/messaging`

Provides:

```text
publish
subscribe
retry metadata
DLQ helpers
inbox dedupe
outbox publisher
event serialization
```

Broker-specific implementation stays behind adapter.

---

# 26. Config Package

`packages/config`

Responsibilities:

```text
typed environment config
validation
secret references
feature flags
service URLs
timeouts
retry defaults
```

Startup should fail fast on invalid required configuration.

---

# 27. Testing Package

`packages/testing`

Provides:

```text
test DB helpers
fake clock
event collector
fixture builders
auth test principals
integration containers
API client
```

Avoid giant magical test framework hiding behavior.

---

# 28. Example Asset Module

```text
modules/asset/
├─ domain/
│  ├─ entities/
│  │  ├─ asset.*
│  │  ├─ assignment.*
│  │  └─ movement.*
│  ├─ value-objects/
│  ├─ state-machines/
│  ├─ repositories/
│  ├─ services/
│  ├─ events/
│  └─ errors/
│
├─ application/
│  ├─ commands/
│  │  ├─ assign-asset.command.*
│  │  ├─ transfer-asset.command.*
│  │  └─ return-asset.command.*
│  ├─ handlers/
│  ├─ queries/
│  ├─ ports/
│  └─ dto/
│
├─ infrastructure/
│  ├─ persistence/
│  │  ├─ asset.repository.*
│  │  ├─ assignment.repository.*
│  │  └─ mappings.*
│  ├─ messaging/
│  └─ integrations/
│
└─ interfaces/
   ├─ http/
   ├─ events/
   └─ jobs/
```

---

# 29. Command Object

Canonical code-level shape:

```text
command_id
command_type
actor
correlation_id
causation_id
idempotency_key
target
expected_version
payload
```

Application handlers receive validated command objects.

---

# 30. Command Handler Standard

Pseudo-flow:

```text
handle(command):
  authorize
  check idempotency
  load aggregate
  validate expected version
  execute domain behavior
  persist aggregate
  persist side effects
  write outbox
  write audit requirement
  commit
  return result
```

---

# 31. Command Handler Must Not

Do not:

```text
send email inside DB transaction
call vendor API inside long transaction
update search index directly
render PDF synchronously unless required
```

---

# 32. Query Handler Standard

```text
validate authorization scope
query read model/canonical source
apply tenant filters
return DTO
```

Query handler must not mutate business state.

---

# 33. CQRS Level

Use lightweight CQRS:

```text
commands for writes
queries for reads
```

Do not require separate databases/event sourcing.

---

# 34. Repository Interface

Repository belongs to domain/application boundary.

Example:

```text
AssetRepository
  getById()
  save()
  findActiveAssignment()
```

Avoid generic:

```text
Repository<T>.saveAnything()
```

for complex aggregates.

---

# 35. Repository Implementation

Infrastructure owns:

```text
SQL
ORM
query builder
mapping
locking
```

Domain must not know persistence details.

---

# 36. Aggregate Loading

Command handler loads:

```text
only aggregate data needed to enforce invariants
```

Avoid loading entire domain graph.

---

# 37. Unit of Work

A local command transaction may use:

```text
UnitOfWork
```

or framework transaction abstraction.

It must include:

```text
domain writes
outbox
required audit durability
```

where applicable.

---

# 38. Transaction Boundary

Do not place:

```text
external HTTP
broker publish
human wait
```

inside DB transaction.

Outbox solves broker publish reliability.

---

# 39. Outbox Placement

Each domain write transaction inserts:

```text
outbox event
```

in same database transaction.

Publisher worker handles actual broker delivery.

---

# 40. Inbox Placement

Each consumer owns its own inbox/dedupe table or namespace.

Do not use one giant shared handler state if avoidable.

---

# 41. Event Consumer Structure

Example:

```text
modules/operations/interfaces/events/
  on-ticket-created.handler
  on-agent-offline.handler
```

Consumer:

```text
validate schema
check inbox
invoke application use case
mark processed
```

---

# 42. Event Consumer Guardrail

Consumer must not directly bypass owning domain's application layer.

---

# 43. Event Handler Types

```text
DOMAIN_REACTION
PROJECTION
INTEGRATION
NOTIFICATION
WORKFLOW_SIGNAL
```

---

# 44. Projection Handler

Examples:

```text
Timeline Projector
Search Indexer
Operations Read Model
Reporting Projection
```

Projection is rebuildable.

---

# 45. Background Job Structure

```text
modules/<domain>/interfaces/jobs/
```

Examples:

```text
expire-reservations
warranty-expiry-scan
sla-threshold-check
license-reclaim-scan
```

---

# 46. Scheduler Rule

Scheduler should enqueue durable work.

Avoid:

```text
large business operation executed directly inside cron callback
```

---

# 47. Durable Job Contract

```text
job_id
job_type
target
state
attempt
lease_until
idempotency_key
correlation_id
```

---

# 48. Workflow Orchestration Structure

Cross-domain orchestrators live separately from domain aggregates.

Recommended:

```text
modules/operations/application/workflows/
```

or dedicated:

```text
modules/workflow/
```

later.

---

# 49. Workflow Orchestrator Responsibilities

```text
step sequencing
timeouts
wait states
compensation
cross-domain commands
correlation
```

Not:

```text
direct database writes across domains
```

---

# 50. Saga Persistence

Long workflows persist:

```text
workflow_instance
current_step
state
correlation_id
timeout_at
context reference
```

---

# 51. State Machine Code Location

Domain-specific state machines:

```text
modules/<domain>/domain/state-machines/
```

Transitions exposed through domain methods.

---

# 52. No Generic Status Mutator

Forbidden:

```text
entity.setStatus(input.status)
```

for protected state machines.

Preferred:

```text
asset.assign(...)
asset.return(...)
ticket.resolve(...)
```

---

# 53. Domain Error Location

Domain errors:

```text
modules/<domain>/domain/errors/
```

Examples:

```text
AssetAlreadyAssigned
InvalidAssetTransition
LicenseCapacityExceeded
```

Mapped to API error codes at interface/application boundary.

---

# 54. Error Translation

Layers:

```text
DB unique violation
→ infrastructure error
→ domain/application conflict
→ canonical API error
```

Never expose raw SQL errors.

---

# 55. DTO Boundary

API DTO != Domain Entity.

Input DTO:

```text
transport data
```

Command:

```text
application intent
```

Domain:

```text
business model
```

Output DTO:

```text
presentation contract
```

---

# 56. ORM Entity Boundary

If ORM is used:

```text
ORM model
!=
domain entity
```

Avoid decorating domain model with framework persistence annotations where possible.

---

# 57. Mapping Layer

Infrastructure mapper:

```text
DB row
↔ Domain aggregate
```

Application mapper:

```text
Domain/read model
→ API DTO
```

---

# 58. Database Migration Layout

Recommended:

```text
database/migrations/
├─ identity/
├─ asset/
├─ helpdesk/
├─ incident/
├─ maintenance/
├─ network/
├─ software/
├─ license/
├─ procurement/
├─ contract/
├─ control/
└─ platform/
```

---

# 59. Migration Naming

Example:

```text
20260911_001_create_asset_schema
20260911_002_create_assets
20260911_003_add_active_assignment_unique_index
```

---

# 60. Migration Ownership

Only owning domain creates/modifies its schema objects.

Cross-domain migration must be explicitly reviewed.

---

# 61. Migration Strategy

Use:

```text
expand
backfill
switch
contract
```

for breaking changes.

---

# 62. Seed Data

Seeds only for:

```text
default permissions
baseline roles
system policy templates
reference values
```

Do not seed production business records casually.

---

# 63. Permission Registration

Each module declares permission catalog.

Example:

```text
asset.read
asset.assign
asset.transfer
asset.dispose
```

Build/startup validation checks duplicates.

---

# 64. Event Registration

Each module declares:

```text
produced events
consumed events
schema versions
```

Generate registry/docs where possible.

---

# 65. Route Registration

Each module owns its routes.

Example:

```text
asset/http/routes
helpdesk/http/routes
```

`apps/api` composes routes.

---

# 66. Dependency Injection

Use explicit dependency wiring.

Avoid hidden global service locator.

Composition root:

```text
apps/api/bootstrap
apps/worker/bootstrap
```

---

# 67. Composition Root

Responsible for:

```text
DB
repositories
message broker
storage adapters
module services
controllers
event handlers
```

Business code should not read global singleton dependencies.

---

# 68. Configuration Ownership

Global technical config:

```text
packages/config
```

Domain policy:

```text
domain tables/policies
```

Do not put business thresholds only in environment variables.

---

# 69. Business Policy Storage

Examples:

```text
approval thresholds
SLA targets
automation rules
renewal thresholds
```

must be versioned domain/control-plane data.

---

# 70. Feature Flags

Technical rollout flags can live in:

```text
config/feature flag system
```

Business approval logic must not depend solely on feature flags.

---

# 71. Logging Standard

Every log includes where relevant:

```text
service
module
request_id
correlation_id
actor_id
entity_type
entity_id
operation_id
```

---

# 72. Logging Guardrail

Never log:

```text
password
token
private key
full secret
raw sensitive document
```

---

# 73. Metrics Naming

Recommended:

```text
http_request_duration
command_execution_duration
event_consumer_lag
event_handler_failure
idempotency_hit
workflow_duration
db_query_duration
```

Domain metrics can add:

```text
ticket_resolution
incident_mttr
asset_assignment
```

---

# 74. Tracing Boundary

Trace:

```text
HTTP
command handler
DB transaction
outbox
consumer
external integrations
```

Correlation ID should be attached.

---

# 75. Module Health

Each module can expose:

```text
dependency health
queue lag
scheduler health
projection freshness
```

but avoid one health endpoint doing expensive full business checks.

---

# 76. API Layer Layout

Example:

```text
apps/api/src/
├─ bootstrap/
├─ middleware/
├─ routes/
├─ health/
└─ main.*
```

Domain-specific controllers remain under modules.

---

# 77. Worker Layout

```text
apps/worker/src/
├─ bootstrap/
├─ consumers/
├─ schedulers/
├─ queues/
└─ main.*
```

Actual handlers imported from modules.

---

# 78. Agent Gateway Layout

```text
apps/agent-gateway/src/
├─ auth/
├─ heartbeat/
├─ inventory/
├─ jobs/
└─ main.*
```

---

# 79. Internal Contracts

Cross-module synchronous contracts may live in:

```text
modules/<owner>/application/contracts/
```

Consumer imports the interface/type, not infrastructure.

---

# 80. Example Asset Query Contract

```text
AssetContextReader
  getCurrentContext(assetId)
```

returns stable application projection.

Helpdesk may consume this contract.

---

# 81. Cross-Module Circular Dependency Rule

Circular module dependencies are forbidden.

If:

```text
Asset ↔ Helpdesk
```

both need each other, solve via:

```text
events
operations/read-model module
application contract inversion
```

---

# 82. Module Dependency Graph

Preferred core graph:

```text
Identity
  ↓
Asset
  ↓
Helpdesk / Incident / Maintenance
  ↓
Operations Read Models

Control Plane
  ← used by domains

Communication
  ← consumes events

Audit
  ← consumes durable records/events
```

Avoid dense all-to-all imports.

---

# 83. Operations Module

`operations` owns:

```text
Work Queue
Attention projections
Timeline projection
Workspace read models
Cross-domain operational workflows
```

It does not own:

```text
Asset state
Ticket state
Incident state
```

---

# 84. Audit Module

`audit` owns:

```text
immutable audit records
audit queries
redaction overlay
integrity verification
```

It does not own business entity lifecycle.

---

# 85. Search Module

`search` owns:

```text
search indexing
query abstraction
index freshness
reindex jobs
```

Search never mutates canonical domains.

---

# 86. Reporting Module

`reporting` owns:

```text
metric definitions
projections
scheduled reports
analytics exports
```

It does not become operational source-of-truth.

---

# 87. Communication Module

Owns:

```text
notifications
delivery
templates
channel connectors
message normalization
```

It does not own Ticket state.

---

# 88. Document Module

Owns:

```text
document metadata
document versions
object references
signatures
retention metadata
```

Business domain decides why document exists.

---

# 89. Control Plane Modules

```text
approval
sla
automation
```

May be separate modules under:

```text
modules/control/
```

or standalone top-level modules.

Keep contracts stable.

---

# 90. Integration Adapters

External systems live under owning context:

```text
identity/infrastructure/integrations/entra
monitoring/infrastructure/integrations/zabbix
procurement/infrastructure/integrations/erp
communication/infrastructure/integrations/email
```

---

# 91. Anti-Corruption Layer

External vendor models must be normalized.

Example:

```text
Zabbix trigger payload
→ MonitoringObservation
```

Internal domain must not depend on vendor schema.

---

# 92. External Client Wrapper

Every external client should define:

```text
timeout
retry policy
error mapping
circuit breaker
metrics
```

---

# 93. Secret Handling

External client accepts:

```text
secret_ref
```

Resolved by secret provider at runtime.

Never commit secrets.

---

# 94. File/Object Adapter

Document/artifact modules use common object-storage port.

Examples:

```text
put
get
head
delete-if-policy-allows
signed-url
checksum
```

---

# 95. Search Adapter

Search module exposes internal abstraction:

```text
indexEntity
removeEntity
search
reindex
```

Implementation can start with PostgreSQL then move to dedicated engine.

---

# 96. Time-Series Adapter

Monitoring/agent/network observations use:

```text
metrics writer/query port
```

Core domains receive summarized operational context.

---

# 97. Read Model Tables

Recommended under:

```text
operations/read-models
reporting/read-models
search/index
```

Naming makes derived nature explicit.

---

# 98. Projection Ownership

Each projection has:

```text
owner
source events
checkpoint
rebuild command
freshness metric
```

---

# 99. Generated Code

Generated:

```text
OpenAPI clients/types
JSON Schema validators
event types
protobuf if used
```

must live under clearly marked:

```text
generated/
```

Do not manually edit.

---

# 100. Contract Source-of-Truth

Choose one source per contract:

```text
OpenAPI
JSON Schema
Proto
```

Generate downstream types from it where practical.

Avoid maintaining five manual copies.

---

# 101. Validation

Transport input validation happens at interface layer.

Domain still enforces business invariants independently.

---

# 102. Validation Libraries

Framework/library choice is implementation detail.

Rules must not exist only inside request-validator decorators.

---

# 103. Testing Layout — Unit

Near source:

```text
modules/asset/domain/entities/asset.test.*
modules/helpdesk/application/handlers/resolve-ticket.test.*
```

---

# 104. Testing Layout — Integration

```text
modules/asset/tests/integration/
modules/helpdesk/tests/integration/
```

Use real DB/container where persistence semantics matter.

---

# 105. Testing Layout — Contract

```text
tests/contract/
```

Validate:

```text
OpenAPI
event schema
consumer compatibility
```

---

# 106. Testing Layout — E2E

```text
tests/e2e/
```

Vertical slices:

```text
ticket-to-resolution
asset-assignment
monitoring-root-incident
agent-auto-recovery
```

---

# 107. Test Fixture Strategy

Use builders:

```text
UserBuilder
AssetBuilder
TicketBuilder
```

Avoid giant static fixtures shared everywhere.

---

# 108. Fake Clock

Time-sensitive tests use injected clock.

Needed for:

```text
SLA
expiry
reservation
approval timeout
retry
```

---

# 109. Event Test Collector

Tests can capture emitted domain/outbox events and assert:

```text
type
payload
correlation
version
```

---

# 110. Repository Contract Tests

Every repository implementation tests:

```text
save/load
optimistic version
unique constraints
active assignment rule
transaction rollback
```

---

# 111. Migration Tests

CI should:

```text
create empty DB
apply all migrations
run schema checks
```

Optionally:

```text
upgrade previous release snapshot
```

---

# 112. Static Dependency Checks

CI should enforce:

```text
domain cannot import infrastructure
module A cannot import module B infrastructure
shared-kernel cannot import domains
```

Use lint/build dependency rules.

---

# 113. API Contract Gate

CI fails on unversioned breaking API contract.

---

# 114. Event Contract Gate

CI fails on:

```text
removed required field
changed field type
incompatible event semantics
```

without version bump.

---

# 115. Code Ownership

Recommended CODEOWNERS-style mapping:

```text
/modules/asset → Asset team
/modules/network → Network team
/modules/identity → Identity/Security
/packages/messaging → Platform
```

---

# 116. ADR Requirement

Create ADR when:

```text
service extraction
new database/storage tech
cross-domain shortcut
event contract break
major framework change
```

---

# 117. Module README

Every module has README:

```text
Purpose
Owner
Entities
Commands
Queries
Events Produced
Events Consumed
Permissions
Tables
Dependencies
Runbook links
```

---

# 118. Module Public API

Each module `index` exports only approved contracts.

Do not export internal repositories/entities indiscriminately.

---

# 119. Public vs Internal Types

Public module types:

```text
commands
query contracts
event contracts
read DTOs
```

Internal:

```text
repositories
ORM models
domain internals
private services
```

---

# 120. Naming Conventions

Examples:

```text
assign-asset.command
assign-asset.handler
asset-assigned.event
asset.repository
asset.controller
asset.mapper
```

Consistency matters more than exact suffix style.

---

# 121. Command Handler Naming

```text
AssignAssetHandler
ResolveTicketHandler
ApproveInvoiceExceptionHandler
```

---

# 122. Query Handler Naming

```text
GetAssetWorkspaceHandler
ListWorkItemsHandler
SearchAssetsHandler
```

---

# 123. Event Consumer Naming

```text
OnTicketCreatedCreateWorkItem
OnAssetAssignedProjectTimeline
OnUserTerminatedStartOffboarding
```

Name describes reaction, not just source event.

---

# 124. Domain Service Naming

Only use domain service when behavior does not naturally belong to one entity/value object.

Avoid generic:

```text
AssetService
TicketService
```

becoming god classes.

---

# 125. Application Service Guardrail

Avoid:

```text
ITSMService
CoreService
CommonService
```

with hundreds of methods.

---

# 126. Controller Guardrail

Controllers should remain thin:

```text
parse
validate
create command/query
dispatch
map response
```

---

# 127. Worker Guardrail

Worker entrypoint should not contain business logic.

It wires handlers and queue infrastructure.

---

# 128. Shared Utility Guardrail

Before adding to `shared` ask:

```text
Is this truly domain-neutral?
Is it used by multiple domains?
Will sharing create coupling?
```

If no:

```text
keep local
```

---

# 129. Common Package Smell

Bad:

```text
packages/common/
  everything.ts
```

Preferred small focused packages.

---

# 130. Monorepo Dependency Rules

Recommended:

```text
apps can import modules + packages
modules can import allowed packages
modules cannot import apps
packages cannot import apps
shared-kernel cannot import domain modules
```

---

# 131. Build Graph

Conceptually:

```text
shared packages
    ↓
domain modules
    ↓
apps
```

---

# 132. Runtime Process Separation

Even if code monorepo, run separately:

```text
API
Worker
Agent Gateway
```

to isolate workload.

---

# 133. Worker Queue Separation

Queues:

```text
notifications
timeline
search
automation
imports
reports
```

Critical workflows should not share one overloaded queue blindly.

---

# 134. Priority Queues

Example:

```text
critical incident notification
> normal email
> scheduled digest
```

---

# 135. Job Concurrency

Per job type configurable.

Examples:

```text
software deployment
network scan
report export
```

---

# 136. Backpressure

Worker queue system supports:

```text
concurrency limits
retry delays
dead letters
lag metrics
```

---

# 137. API BFF / Workspace Queries

Complex operator pages can use:

```text
GET /workspaces/assets/{id}
```

implemented in:

```text
operations read-model/query layer
```

not by browser calling 15 APIs.

---

# 138. Workspace Query Composition

Workspace read model may aggregate:

```text
Asset
Assignment
Health
Agent
Network
Tickets
Maintenance
Software
License
Timeline
```

No writes through generic workspace object.

---

# 139. Search Architecture Evolution

Phase 1:

```text
PostgreSQL query abstraction
```

Later:

```text
Dedicated search adapter
```

Application search contract remains stable.

---

# 140. Persistence Evolution

Phase 1:

```text
shared PostgreSQL cluster
schema-per-domain
```

Later:

```text
extract domain DB
```

if needed.

Module repository interfaces reduce migration impact.

---

# 141. Service Extraction Path

To extract `network`:

```text
1. Ensure no direct table consumers
2. Replace sync DB reads with contract/read model
3. Move schema
4. Move event consumers
5. Expose API/commands
6. Redirect messaging
7. Deploy independently
```

---

# 142. Extraction Readiness Checklist

Module is extractable when:

```text
no external direct writes
minimal cross-schema joins
stable event contracts
stable command/query contracts
own migrations
own observability
own tests
```

---

# 143. When Not to Extract

Do not extract solely because:

```text
module has many files
```

A large cohesive module may still belong together.

---

# 144. Initial Module Set for MVP

Implement first:

```text
identity
asset
helpdesk
operations
communication
document
audit
```

Platform packages:

```text
auth
persistence
messaging
observability
config
testing
```

---

# 145. Phase 2 Modules

Add:

```text
incident
maintenance
approval
sla
automation
agent
monitoring
```

---

# 146. Phase 3 Modules

Add:

```text
audit-ops
network
software
artifact
license
warranty
replacement
search
```

---

# 147. Phase 4 Modules

Add:

```text
procurement
contract
supplier
finance-integration
```

---

# 148. Phase 5 Modules

Expand:

```text
reporting
intelligence
advanced automation
```

---

# 149. First Vertical Slice Code Path

Ticket create:

```text
HTTP Controller
↓
CreateTicketCommand
↓
CreateTicketHandler
↓
Ticket Aggregate
↓
TicketRepository
↓
Outbox
↓
Commit
↓
TICKET.CREATED
↓
Worker Consumers
├─ Work Item projection
├─ Timeline
├─ Notification
└─ Search
```

---

# 150. Second Vertical Slice Code Path

Asset assign:

```text
HTTP Controller
↓
AssignAssetCommand
↓
AssignAssetHandler
↓
Asset + Assignment domain logic
↓
Transaction
├─ Assignment
├─ Movement
├─ Asset current state
├─ Outbox
└─ Audit durability
↓
ASSET.ASSIGNED
↓
Timeline / Handover / Notification / Search
```

---

# 151. Recommended Technical Interfaces

Core abstractions:

```text
Clock
IdGenerator
UnitOfWork
EventPublisher
OutboxWriter
InboxStore
AuthorizationService
AuditWriter
ObjectStore
SearchPort
MetricsRecorder
```

Keep abstractions purposeful.

---

# 152. Avoid Abstracting Everything

Do not create interfaces for trivial local functions just to follow a pattern.

Abstract:

```text
external boundaries
persistence
time
IDs
message broker
object storage
security
```

---

# 153. Framework Isolation

Framework-specific code should concentrate in:

```text
apps
interfaces
infrastructure
```

Domain/application should be mostly framework-neutral.

---

# 154. Database Query Strategy

For operational read-heavy screens:

```text
purpose-built SQL/read models
```

is preferred over forcing aggregate repository for all reads.

---

# 155. Write Model vs Read Model

Write:

```text
domain aggregate
```

Read:

```text
optimized projection/query
```

This is lightweight CQRS.

---

# 156. Reporting Boundary

Do not put heavy reporting joins into command services.

Reporting module reads from:

```text
read replica
materialized view
analytics store
```

as system grows.

---

# 157. Security Boundary

Sensitive modules:

```text
identity
rbac
audit
network execution
financial approval
```

may later require stronger deployment isolation.

---

# 158. Coding Guardrails

Must not:

1. Put business logic in controller.
2. Put SQL in controller.
3. Import another domain's repository.
4. Share ORM entity as API DTO.
5. Use one generic status setter.
6. Publish event before commit.
7. Call external provider inside long DB transaction.
8. Make worker queue state the source-of-truth.
9. Put domain enums into shared-kernel.
10. Build giant `common` package.
11. Hide authorization inside UI only.
12. Skip idempotency for retryable writes.
13. Let event consumer bypass application/domain rules.
14. Use read model for irreversible command validation.
15. Let projection failure rollback committed business transaction.
16. Add framework dependency into pure domain model without need.
17. Create circular domain dependencies.
18. Hardcode business policy into infrastructure config only.
19. Add background cron without durable recovery semantics for critical work.
20. Extract service before contracts/boundaries are stable.

---

# 159. Repository Initialization Order

Recommended:

```text
1. workspace/package manager
2. lint/format/typecheck
3. config package
4. observability package
5. persistence package
6. auth package
7. messaging package
8. shared-kernel
9. identity module
10. audit module
11. asset module
12. helpdesk module
13. operations module
14. api app
15. worker app
16. e2e test harness
```

---

# 160. CI Pipeline

Minimum stages:

```text
install
lint
typecheck
unit tests
dependency rules
contract validation
migration test
integration tests
build
security scan
package
```

---

# 161. CD Pipeline

Recommended:

```text
deploy migrations
deploy compatible app
health checks
smoke tests
enable feature flag
monitor
```

Do not run destructive migration before compatible code is ready.

---

# 162. Local Development

Provide:

```text
docker compose / equivalent
```

for:

```text
PostgreSQL
Redis
Broker
Object Storage
Observability minimal stack
```

---

# 163. Developer Bootstrap

One command should ideally:

```text
install deps
start infra
apply migrations
seed baseline roles
start API + worker
```

---

# 164. Local Test Data

Provide synthetic:

```text
users
assets
tickets
incidents
```

No copied production sensitive data.

---

# 165. Environment Separation

```text
local
test
staging
production
```

Different credentials/secrets.

---

# 166. Production Config Guardrail

Production startup should reject:

```text
default secret
debug auth bypass
unsafe migration mode
public object bucket
```

---

# 167. Module Documentation Automation

Generate registry from code where possible:

```text
routes
permissions
events
commands
```

Compare to traceability docs.

---

# 168. Traceability in Code

Recommended annotations/metadata:

```text
Feature ID
Workflow ID
```

at command/use-case level.

Example:

```text
Feature: F-006
Workflow: WF-006
```

Useful for tests and generated implementation reports.

---

# 169. PR Traceability

PR template requires:

```text
Feature ID
Workflow ID
Affected modules
Commands/events changed
Migration
Permission change
Audit impact
```

---

# 170. Definition of Ready — Module

Before creating new module:

```text
owner defined
aggregate defined
data ownership defined
commands defined
events defined
permissions defined
phase justified
```

---

# 171. Definition of Done — Module Foundation

Module foundation is done when:

```text
folder boundary exists
public contract exists
dependency rules enforced
schema/migration exists
basic repository exists
command/query example exists
event registration exists
tests exist
module README exists
```

---

# 172. Recommended Next Artifact

After this repository/module specification, the next direct implementation artifact should be:

```text
BACKEND BOOTSTRAP CHECKLIST + INITIAL FILE TREE
```

It should turn the architecture into concrete starter files for Phase 0/Phase 1:

```text
exact folders
initial packages
initial migration files
first interfaces
first commands
first events
first tests
CI skeleton
local docker stack
```

Optionally, after choosing the backend language/framework, this can become an actual generated repository skeleton.

---

# 173. Definition of Done

Backend Repository + Module Structure Spec đạt yêu cầu khi:

- Deployable app boundaries are defined.
- Domain/application/infrastructure/interfaces separation is defined.
- Cross-domain write rules are explicit.
- Shared-kernel scope is limited.
- Command/query/event handler locations are clear.
- Persistence/migration ownership is clear.
- Outbox/inbox/job/workflow placement is clear.
- Testing structure is defined.
- Static dependency rules are defined.
- Observability/config/security placement is defined.
- Modular monolith → service extraction path is defined.
- MVP module initialization order is defined.
- Coding anti-patterns and guardrails are explicit.
