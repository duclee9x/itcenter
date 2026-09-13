# TASK-093-R2A — Canonical Service + Platform/Environment Reference Foundation

```yaml
task_id: TASK-093-R2A
parent_task: TASK-093-R2
work_type: REFERENCE_DATA_FOUNDATION
status: CODE_COMPLETE
owner_domain: Service Reference Data
runtime_scope: canonical_reference_management_and_query_only
```

## Objective and boundary

Provide tenant-owned canonical Service, Platform and ServiceEnvironment
references required by TASK-093-R2. Preserve TASK-037 Knowledge lifecycle,
reuse TASK-054 Software Product and TASK-037 Problem/Known Error identities,
and retain unresolved legacy Incident service values without guessing.
TASK-093-R2A does not implement Knowledge recommendation, recommendation
sessions, ranking/scoring, feedback, deflection, Search Knowledge indexing,
or recommendation APIs. After R2A passes, stop and return to TASK-093-R2.

## Canonical records

`Service`: `id`, `tenant_id`, unique `key`, `name`, optional `description`,
`state` (`ACTIVE`/`INACTIVE`), timestamps and optimistic `version`.

`Platform`: `id`, `tenant_id`, unique `key`, typed `family` (`WINDOWS`,
`MACOS`, `LINUX`, `IOS`, `ANDROID`, `OTHER`), `name`, optional
`major_version`, state (`ACTIVE`/`INACTIVE`), timestamps and version. No
large platform catalog is seeded.

`ServiceEnvironment`: tenant-owned key/name/state/version belonging to a
canonical Service; enforce `(tenant_id, service_id, key)` uniqueness and
same-tenant composite foreign keys. Environments are optional and are not
limited to a global hard-coded list.

Inactive records remain queryable and cannot be hard-deleted. New child or
Knowledge links to inactive targets are rejected. Their current matching
eligibility is false.

## Incident compatibility

Before migration, inspect Incident service references. Never synthesize
Service rows from historical UUIDs or display names. Preserve the existing
unowned `incident.service_id` values as `legacy_service_id`, introduce a new
composite-FK canonical `service_id`, and leave legacy values unresolved
unless a deterministic mapping is explicitly available. New Incident writes
with service context must validate and persist canonical Service ID.

## Platform resolution

Observed OS remains observational text. Resolve only by deterministic exact
normalized match to a configured canonical Platform key/name. If zero or more
than one active match exists, return `UNRESOLVED`; no fuzzy matching or
implicit inference. Preserve observation text separately.

## Commands, permissions and events

Commands: `SERVICE.CREATE/UPDATE/DEACTIVATE`,
`PLATFORM.CREATE/UPDATE/DEACTIVATE`,
`SERVICE_ENVIRONMENT.CREATE/UPDATE/DEACTIVATE`. No generic `SET_STATE`.
Writes use tenant scope, expected version where applicable, idempotency,
authorization, audit and outbox.

Permissions: `service.read/manage`, `platform.read/manage`,
`service_environment.read/manage`. Seed permission definitions without
granting them to existing roles. No `service.manage` is granted to ordinary
end users.

Events: `<TYPE>.CREATED`, `<TYPE>.UPDATED`, `<TYPE>.DEACTIVATED` for each
reference type; emit minimal metadata and canonical ID/version.

## Query boundary

Export tenant-scoped `ServiceQueryPort`, `PlatformQueryPort` and
`ServiceEnvironmentQueryPort` application contracts for ID lookup, state and
minimal display metadata. Platform resolution is an explicit application
query. Consumers must use these contracts rather than querying service-owned
tables. The Service module owns all three reference types.

## Required verification

- [x] Service create/read/update/deactivate; tenant key uniqueness and
      inactive history preservation.
- [x] Platform create/read/update/deactivate; typed family validation.
- [x] Exact deterministic observed-OS resolution; unresolved text never maps.
- [x] ServiceEnvironment create/read/update/deactivate; parent Service is
      canonical, ACTIVE and same tenant.
- [x] Cross-tenant references and unknown IDs fail.
- [x] Existing Software Product identity is reused; no duplicate catalog.
- [x] Existing Incident values are preserved as legacy/unresolved; no guessed
      Service rows; new writes use canonical Service IDs.
- [x] Consumer queries go through application query contracts.
- [x] Existing Ticket and recommendation runtime behavior is unchanged.
- [x] Migration, integration/E2E, typecheck, lint/boundaries, format and full
      test suite pass.

## Completion

Produce an implementation report, update R2A/R2/TASK-093 registry and
handoff, and commit R2A separately. TASK-093-R2 is now READY / NOT_STARTED
and is the current task; do not begin its runtime without explicit
instruction. TASK-093 remains BLOCKED / NOT_STARTED. See
`TASK-093-R2A_IMPLEMENTATION_REPORT.md`.
