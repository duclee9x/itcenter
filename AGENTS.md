# AGENTS.md
## IT Operations Hub — Codex Implementation Rules

**Version:** 0.1  
**Status:** Active Implementation Contract  
**Audience:** Codex / coding agents / maintainers  
**Purpose:** Define the non-negotiable implementation rules for this repository.

---

# 1. Mission

You are implementing the **IT Operations Hub** from the project Markdown specifications.

The specifications are the source of truth.

Your job is to:

```text
Read the assigned feature/task
→ inspect the existing repository
→ identify the relevant specs
→ make the smallest complete implementation
→ verify it
→ report exactly what changed
```

Do **not** redesign the system for convenience.

Do **not** implement the whole product from one task.

---

# 2. Product Architecture Principle

The product is an:

```text
IT Operations Hub
```

not a collection of disconnected modules.

Operational flow:

```text
SIGNAL / REQUEST
→ IDENTIFY
→ ENRICH
→ CORRELATE
→ DECIDE
→ EXECUTE
→ UPDATE
→ AUDIT / TIMELINE / KPI
```

Operator UX is:

```text
Operations Overview
→ Attention Center
→ Work Queue
→ Context
→ Action
```

The backend must preserve this model.

---

# 3. Specification Precedence

When specifications overlap, use this precedence:

```text
1. Current task acceptance criteria
2. MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md
3. Domain/workflow specification relevant to the feature
4. STATE_MACHINE_MASTER_SPEC.md
5. DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md
6. API_COMMAND_CONTRACT_SPEC.md
7. EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md
8. PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md
9. ERROR_RETRY_IDEMPOTENCY_STANDARD.md
10. DATABASE_STORAGE_BOUNDARY_SPEC.md
11. SEARCH_INDEXING_SPEC.md
12. AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md
13. BACKEND_REPOSITORY_MODULE_STRUCTURE_SPEC.md
14. MVP_PHASED_IMPLEMENTATION_PLAN.md
```

If two normative specs materially conflict:

```text
DO NOT silently invent a business rule.
```

Instead:

1. identify the conflict;
2. implement only the safe unambiguous portion;
3. report a `SPEC_CONFLICT`;
4. propose the smallest resolution.

---

# 4. Architecture Style

Initial architecture:

```text
Modular Monolith
+
Specialized Workers
+
Strict Domain Boundaries
```

Initial deployable applications:

```text
apps/api
apps/worker
apps/agent-gateway
```

Do not introduce a new deployable service unless:

- the task explicitly requires it; or
- an approved architecture decision exists.

---

# 5. Domain Module Layout

Each business module should follow:

```text
modules/<domain>/
├─ domain/
├─ application/
├─ infrastructure/
├─ interfaces/
└─ README.md
```

Direction:

```text
interfaces
    ↓
application
    ↓
domain
```

Infrastructure implements ports defined by domain/application.

The domain layer must remain framework-neutral where practical.

---

# 6. Domain Ownership Rule

Each canonical entity has exactly one owning domain.

A module must never directly mutate another module's tables.

Forbidden:

```text
helpdesk handler
→ UPDATE asset.assets
```

Required patterns:

```text
application contract
command
domain event
workflow
read projection
```

A cross-domain shortcut is not acceptable merely because the database is shared.

---

# 7. Shared Kernel Rule

`shared-kernel` must remain small.

Allowed examples:

```text
EntityId
TenantId
Money
Clock
DateRange
Result
DomainError
Pagination
CorrelationContext
ActorContext
Version
```

Forbidden examples:

```text
AssetStatus
TicketPriority
LicenseType
PurchaseOrderState
AssetService
TicketService
```

Domain concepts belong to their domain.

Do not create a generic `common` dumping-ground package.

---

# 8. Commands vs Queries

Writes use commands.

Reads use queries.

Examples:

```text
ASSET.ASSIGN
TICKET.RESOLVE
INCIDENT.DECLARE_MAJOR
```

Do not use generic write endpoints such as:

```text
PATCH /assets/{id}
{
  "status": "IN_USE"
}
```

for protected lifecycle changes.

---

# 9. Protected State Changes

State transitions must happen through explicit domain actions.

Preferred:

```text
asset.assign(...)
asset.return(...)
ticket.resolve(...)
change.approve(...)
```

Forbidden:

```text
entity.setStatus(...)
```

for protected state machines.

The backend is authoritative for valid transitions.

---

# 10. Multi-Dimensional Asset State

Never collapse Asset state into one generic `status`.

Independent dimensions include:

```text
Lifecycle
Operational
Health
Assignment
Warranty
Compliance
Risk
```

A change to one dimension must not implicitly overwrite another.

---

# 11. API Contract Rules

Canonical write flow:

```text
Request
→ Authentication
→ Authorization
→ Validation
→ Command
→ Idempotency
→ Concurrency Check
→ Domain Rules
→ Transaction
→ Outbox
→ Response
```

Protected write endpoints should follow:

```text
POST /<entity>/{id}/commands/<action>
```

Queries must not have side effects.

---

# 12. Authentication, Authorization, Approval

These are separate:

```text
Authenticated identity
→ Authorization decision
→ Optional approval policy
→ Command execution
```

Having approval does not automatically grant command permission.

Having a role does not automatically bypass scope.

UI visibility is not authorization enforcement.

---

# 13. Permission Rules

Use stable permission codes:

```text
resource.action
```

Examples:

```text
asset.assign
ticket.resolve
network.vlan.change
approval.decide
automation.activate
```

Avoid application logic like:

```text
if user.is_admin:
```

unless the permission evaluator explicitly resolves such a policy.

---

# 14. Tenant and Scope Rules

Tenant boundary is evaluated before business resource scope.

Resource scopes can include:

```text
SELF
OWNED
TEAM
DEPARTMENT
SITE
LOCATION_TREE
SERVICE
BUSINESS_UNIT
ORGANIZATION
TENANT
```

Search, counts, autocomplete, reports and exports must respect authorization scope.

---

# 15. High-Risk Actions

High-risk actions may require:

```text
reason
re-authentication
MFA
approval
change request
verification
rollback plan
```

Examples:

```text
asset.dispose
data_wipe.execute
network.vlan.change
role_binding.privileged_grant
artifact.revoke
contract.terminate
sensitive export
```

Do not silently lower controls to simplify implementation.

---

# 16. Transactions

A local transaction may include:

```text
canonical domain writes
state history
local invariant updates
outbox event
required durable audit reference
```

Do not keep a DB transaction open around:

```text
external HTTP calls
message broker publish
email delivery
PDF generation
human approval
agent execution
network changes
```

---

# 17. Event Rules

Domain events are completed facts.

Examples:

```text
ASSET.ASSIGNED
TICKET.RESOLVED
INCIDENT.RESTORED
```

Do not emit events before commit.

Use the outbox pattern:

```text
business transaction
+
outbox write
→ commit
→ publisher
→ broker
```

Assume at-least-once delivery.

Consumers must be idempotent.

---

# 18. Event Consumer Rules

Consumer flow:

```text
validate schema
→ inbox/dedupe check
→ invoke application use case
→ commit
→ mark processed
```

An event consumer must not bypass domain/application logic.

Projection consumers may write only their owned projection.

---

# 19. Idempotency

Retryable business writes require an explicit idempotency strategy.

Use:

```text
Idempotency-Key
```

plus a durable ledger where required.

Same key + same request:

```text
return previous result
```

Same key + different request:

```text
409 IDEMPOTENCY_KEY_CONFLICT
```

Idempotency and optimistic concurrency solve different problems.

---

# 20. Optimistic Concurrency

Protected commands should use:

```text
expected_version
```

or equivalent `If-Match`.

On mismatch:

```text
409 VERSION_CONFLICT
```

Do not blindly auto-retry business conflicts.

---

# 21. Error Handling

Use the canonical error taxonomy.

Do not return raw:

```text
SQL errors
stack traces
provider secrets
internal exception dumps
```

Map low-level failures to canonical error codes.

Retry only errors explicitly classified retryable.

---

# 22. Retry Rules

Do not implement:

```text
retry every exception 3 times
```

Retry policy must define:

```text
retryable errors
max attempts
max elapsed time
backoff
timeout
fallback
```

High-risk writes must not be blindly retried.

Reconcile actual state first when outcome is uncertain.

---

# 23. Compensation

Committed distributed actions are not undone by deleting history.

Use compensating commands.

Example:

```text
license reserved
→ deployment fails permanently
→ LICENSE.RECLAIM
```

Compensation must be auditable.

---

# 24. Audit vs Timeline

These are separate.

Audit:

```text
immutable
compliance/security evidence
actor
before/after
reason
correlation
```

Timeline:

```text
operator-friendly
readable
filtered
grouped
derived
```

Do not use timeline as compliance audit.

Do not dump raw audit events into user-facing timeline.

---

# 25. Audit Rules

High-risk mutations must be auditable.

Audit records are append-only.

Corrections create new records.

Never audit secrets such as:

```text
password
access token
private key
raw API secret
full license key
```

---

# 26. Search Rules

Search is a derived read model.

Never use search index as authoritative input for irreversible commands.

Priority:

```text
Exact identifier
> Prefix
> Fuzzy
> Full-text
```

Structured identifiers include:

```text
asset code
asset tag
serial
IP
MAC
ticket code
invoice number
```

---

# 27. Storage Rules

Canonical business state:

```text
Relational OLTP
```

Binary evidence/artifacts:

```text
Object Storage
```

High-volume telemetry:

```text
Time-Series / observation store
```

Search:

```text
Derived search index
```

Cache:

```text
Non-authoritative
```

Do not place high-frequency telemetry in the core OLTP by default.

---

# 28. Work Queue Rule

Work Queue contains actionable work.

It is a projection/reference.

It must not become duplicate source-of-truth for:

```text
Ticket
Incident
Maintenance
Approval
Asset
```

Resolving a Work Item still requires authorization on the source resource.

---

# 29. Operator Workspace Rule

Complex read endpoints such as:

```text
GET /workspaces/assets/{id}
```

may aggregate multiple domains.

They are read-only projections.

Writes still go through owning domain commands.

---

# 30. Controllers

Controllers stay thin.

Allowed:

```text
parse
validate transport
construct command/query
dispatch
map result
```

Forbidden:

```text
business rules
SQL
state-machine logic
cross-domain orchestration
```

---

# 31. Workers

Worker entrypoints contain wiring, not business logic.

Actual behavior lives in:

```text
application handlers
domain logic
projection handlers
workflow handlers
```

---

# 32. ORM Boundary

ORM model is not the domain entity.

API DTO is not the domain entity.

Do not expose persistence structures as public API contracts.

---

# 33. External Integration Rule

External payloads must pass through an anti-corruption/normalization layer.

Example:

```text
Zabbix payload
→ normalized Monitoring event
```

Internal domain code must not depend on a vendor-specific payload structure.

---

# 34. Secrets

Secrets must be obtained via:

```text
Secret Manager / Vault / KMS-backed mechanism
```

Code/config may store:

```text
secret_ref
```

Never commit real secrets.

---

# 35. Observability

Relevant operations should carry:

```text
request_id
correlation_id
causation_id
operation_id
actor_id
entity_type
entity_id
```

where applicable.

Use structured logs.

Add metrics for important domain/technical outcomes.

---

# 36. Testing Requirements

For critical business commands, test:

```text
success
invalid state
permission denied
scope denied
approval required if applicable
version conflict
duplicate retry
DB invariant
event emitted
audit created
failure path
```

---

# 37. Required Test Layers

Use as applicable:

```text
unit
domain state-machine
repository integration
API contract
event contract
workflow integration
end-to-end
failure/chaos
```

---

# 38. Migration Rules

Migrations belong to owning domain.

Breaking changes use:

```text
expand
→ compatible code
→ backfill
→ switch
→ contract
```

Do not perform destructive migration before compatible code is deployed.

---

# 39. Repository Dependency Rules

Allowed:

```text
apps → modules
apps → packages
modules → approved packages
```

Forbidden:

```text
modules → apps
shared-kernel → domain module
module A → module B infrastructure
```

Circular domain dependencies are forbidden.

---

# 40. Phase Discipline

Do not implement a later-phase capability unless:

- the assigned task requires it as a minimal dependency; or
- the user explicitly expands the scope.

If a dependency is missing, report:

```text
SCOPE_DEPENDENCY
```

before expanding materially.

---

# 41. Working Method for Every Task

## Step A — Inspect

Before editing:

```text
inspect repo
inspect relevant specs
inspect existing code paths
```

Do not assume the repository is empty.

## Step B — Map

Identify:

```text
Feature ID
Workflow ID
Domain owner
Phase
```

## Step C — Plan

Produce a concise plan containing:

```text
modules affected
files affected
tables/migrations
commands
queries
state transitions
permissions
events
audit/timeline
idempotency
concurrency
tests
```

## Step D — Implement

Implement the smallest complete vertical slice.

Do not build speculative future abstractions.

## Step E — Verify

Run all applicable:

```text
format
lint
typecheck
unit tests
integration tests
migration tests
contract tests
E2E
```

Fix regressions introduced by the change.

## Step F — Report

Report:

```text
files changed
DB changes
APIs/commands
events
permissions
tests run
test results
remaining gaps
spec conflicts
assumptions
```

---

# 42. Definition of Done

A business feature is not complete merely because the endpoint responds.

Where applicable it must include:

```text
Data Model
+ Constraints
+ Command
+ State Validation
+ Authorization
+ Idempotency / Concurrency
+ Domain Event / Outbox
+ Audit
+ Error Mapping
+ Tests
+ Observability
+ Traceability
```

Timeline/Search/Notification must also be implemented when required by the feature traceability row.

---

# 43. Completion Language

Do not say:

```text
Done
Complete
Fully implemented
```

unless all acceptance criteria and applicable verification gates passed.

Prefer exact status:

```text
Implemented and tests pass
Implemented with remaining gap X
Blocked by Y
Spec conflict requires decision
```

---

# 44. Mandatory Reporting Markers

Use these markers when relevant:

```text
SPEC_CONFLICT:
SCOPE_DEPENDENCY:
IMPLEMENTATION_ASSUMPTION:
BLOCKER:
SECURITY_CONCERN:
MIGRATION_RISK:
```

---

# 45. Prohibited Behaviors

You must not:

1. redesign the product without instruction;
2. implement the entire roadmap in one task;
3. add microservices for architectural aesthetics;
4. perform direct cross-domain writes;
5. bypass permission checks;
6. bypass state machines;
7. use search/read projection as canonical write authority;
8. publish business events before commit;
9. retry irreversible writes blindly;
10. hide failed tests;
11. weaken database invariants for convenience;
12. silently change public/event contracts;
13. update immutable audit history in place;
14. add production secrets;
15. create duplicate implementation paths for the same use case;
16. introduce a framework/library without a concrete need;
17. silently expand task scope;
18. modify specification semantics merely to match code.

---

# 46. Traceability Header

For major command/use-case files, include traceability metadata where appropriate:

```text
Feature: F-xxx
Workflow: WF-xxx
```

Do not clutter trivial helper files.

---

# 47. First Implementation Order

Unless a later task explicitly changes the order:

```text
1. Repository bootstrap
2. Identity / RBAC
3. Platform command + error + idempotency framework
4. Outbox / Inbox
5. Audit foundation
6. Asset core
7. Helpdesk core
8. Work Queue
9. Timeline
10. Notification
11. Basic Search
12. Monitoring / Agent
13. Incident
14. Maintenance / SLA
```

---

# 48. Final Rule

When uncertain:

```text
preserve business integrity
preserve domain ownership
preserve auditability
implement less, not more
report the ambiguity
```
