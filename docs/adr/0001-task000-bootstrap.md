# ADR 0001 — TASK-000 bootstrap

Status: Implemented for TASK-000; production integrations deferred.

## Context and decision

The inspected repository contained specifications only, no existing stack, migration framework, or Git metadata. Use TypeScript, npm workspaces, Node HTTP/test libraries and the PostgreSQL driver. ESLint/TypeScript enforce dependencies; Prettier formats implementation files; AJV validates the canonical event envelope. No application framework, microservice, broker, cache, search engine or object-store server is introduced.

Use three composition roots. Identity owns its six tables and permission catalog persistence. Audit owns immutable evidence records. Platform owns technical operation, idempotency, inbox and outbox storage. Shared packages contain technical primitives and ports only. Public module exports include explicit composition factories/adapters; application code must depend on ports, not another module's adapter.

Migrations run in owner-qualified order with checksums, an advisory lock, and a transaction per migration. A separate `migration_meta` schema records applied versions. Production migrations should use a dedicated owner credential. Runtime grants must be scoped to application needs; bootstrap does not provision deployment roles or replace backend authorization with database ownership.

## Scope and precedence

TASK-000 provides the traceability identifiers FOUNDATION / PLATFORM-BOOTSTRAP. It requires identity and audit data foundations, so these are included even though the previous informal bootstrap plan deferred them.

TASK-000 and the API contract specify six operation states, including CANCELLED. The storage overview lists five illustrative states; use the task's six states. No operation transition API is implemented.

The API contract's `error` + `meta` envelope takes precedence over the error standard's alternate envelope. Compatible category/severity/retryability fields supplement it, while request/correlation IDs remain in `meta`.

The event contract requires `published_at` on delivered messages. Pending outbox records intentionally omit it; a future publisher sets it only at delivery. Storing an event is not publishing it.

The inbox processed marker is updated within the same local transaction as effects, and becomes visible only at commit. Broker acknowledgement must occur after that commit. This is the atomic interpretation of AGENTS.md §18's ordered flow and prevents duplicate effects after crashes.

## Explicit assumptions

- UUID internal IDs; tenant-scoped references and uniqueness where appropriate.
- Permission `operation.read` is a Platform bootstrap permission needed by the task's operation query. It grants nothing by default; full resource policy evaluation is deferred.
- Permission catalog registration is idempotent by stable code and rejects incompatible definitions. No roles or bindings are seeded.
- Idempotency scope is tenant + principal + operation + business scope + key. Canonical JSON hashes semantic request input. Callers must include target/version when those change intent. Successful responses remain replayable after the expiry timestamp until a domain-approved retention process is added; keys are never automatically reused.
- Operation enqueue is internal and must run inside the caller's idempotent transaction. No generic status setter exists.
- PostgreSQL 18 is the local/CI baseline; Node 22 is the CI baseline. Local verification also records the actual runtime version.

## Deferred integrations

OIDC verification, principal-to-canonical-user mapping, full RBAC/high-risk policies, broker publisher and delivery retry policy, production secret manager provisioning, object storage adapter, metrics export/OpenTelemetry, and production packaging/deployment are separate tasks. Worker readiness stays false while no delivery adapters are wired. No fake broker ACK, password system, admin shortcut, or business event is installed.

No unresolved business specification conflict was found for the implemented scope.
