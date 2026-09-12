# TASK-057 — License Entitlement + Pool Model

```yaml
task_id: TASK-057
feature_id: F-034
workflow_id: WF-L01
phase: P3
priority: P0
status: CODE_COMPLETE
owner_domain: license
```

## Objective

Implement the License-owned entitlement and pool foundation: record how many
licenses the organization owns, the applicable license terms, and optional
organizational pools. Keep entitlement separate from assignment, installation,
and usage. This task prepares canonical data for TASK-058 and must not implement
individual license assignment or reclaim flows.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md` (§§41–48)
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md` (§§25–26)
- `docs/STATE_MACHINE_MASTER_SPEC.md` (§56)
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md` (§43)
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`

## In Scope

- A `license` domain module and License-owned tenant-scoped entitlement and
  pool persistence.
- Entitlement create, read/list, and controlled update/renew/expire transitions
  through explicit commands.
- License type, quantity, validity window, software product, optional contract
  and supplier references, cost/currency, renewal metadata, and restrictions.
- Optional pools grouped by department, country, business unit, project, or
  contract; an entitlement may be associated with a pool under tenant scope.
- Database validation for positive quantity, validity windows, money/currency,
  supported license type, tenant-safe references, and uniqueness needed for
  idempotent administration; derive effectiveness from dates rather than a
  mutable lifecycle field.
- Permissions, authorization, idempotency, expected version, audit, outbox,
  canonical errors, event contracts, traceability, and tests.
- Reads that clearly report entitlement and pool quantities without treating
  installations, assignments, or observed usage as equivalent consumption.

## Out of Scope

- License assignments, reservations, activation, suspension, reclaim, and
  principal/asset linking (TASK-058).
- Compliance calculation, overuse findings, usage snapshots, and remediation.
- Procurement/contract authoring or supplier onboarding.
- Software deployment orchestration (TASK-055); License reservation becomes
  available to deployment only through a later approved application contract.
- External vendor licensing APIs and renewal-provider integrations.

## Domain Rules

- Entitlement is the organization's contractual right to use a quantity of a
  software product. It is not an installation, assignment, active session, or
  usage count.
- Support Per User, Per Device, Concurrent, Subscription, Perpetual, Site,
  Enterprise Agreement, Named User, Floating, Core/CPU based, and Server
  Instance license types as distinct codes. Do not apply one consumption
  formula to all types.
- Entitlement belongs to one tenant and one canonical Software product.
- An entitlement may optionally refer to an active pool. Contract/supplier
  references remain display identifiers until their owning canonical domains
  exist; they grant no authority and are not foreign keys.
- Quantity is a positive integer. Expiry and validity boundaries are explicit;
  an expired entitlement cannot be renewed by silently changing its history.
- Entitlement corrections and renewal create auditable state/history rather
  than deleting or rewriting immutable evidence.
- Pool membership provides organizational attribution; it does not create
  additional entitlement quantity or grant a license assignment.
- A pool-scoped entitlement must not be counted twice in aggregate reads.

## State and Commands

Entitlement has no manually mutable lifecycle state. Derive `effective_state`
from its UTC validity interval `[valid_from, valid_until)`: `NOT_YET_VALID`,
`ACTIVE`, or `EXPIRED` (a null `valid_until` has no expiry). Keep this distinct
from assignment state and the compliance projection in State Machine §56.
Renewal is an explicit, versioned term change with previous and new terms
retained in append-only history. `LICENSE.EXPIRED` is an idempotent fact keyed
by entitlement term/version, not a state mutation.

Required commands:

```text
LICENSE.ENTITLEMENT_CREATE
LICENSE.ENTITLEMENT_UPDATE
LICENSE.ENTITLEMENT_RENEW
LICENSE.POOL_CREATE
LICENSE.POOL_UPDATE
```

Protected writes must use command routes and expected versions; no generic
status patch endpoint.

## Authorization

```yaml
permissions:
  - license.read
  - license.entitlement.manage
  - license.pool.manage
resources:
  - license_entitlement
  - license_pool
scope: tenant plus applicable organization/business-unit/department scope
high_risk: false
approval_required: false
```

Do not add broad role grants. Tenant boundary is checked before resource scope.

## Database / Data Model

Implement License-owned structures corresponding to:

- `license.license_entitlements`: product, optional contract/pool, license
  type, quantity, validity, purchase/renewal, cost/currency, restrictions,
  actor, version, and timestamps. Do not store a manually mutable generic state.
- Contract/supplier strings are external business references only until their
  owning canonical domains exist; do not treat them as tenant-scoped entity IDs.
- `license.license_pools`: name, pool type, optional organizational and
  contract references, state, version, and timestamps.
- Any minimal append-only entitlement history needed to audit updates, renewal,
  and expiry. Do not add assignment, installation, or usage tables in this task.
- Expose `effective_state` as a derived read field from the validity interval;
  do not persist the compliance projection described in State Machine §56 as
  entitlement lifecycle.

Enforce tenant-safe foreign keys to `software.software_products`. Add checks
for positive quantities, supported enum values, non-inverted validity, valid
currency/cost, and valid state. Use explicit optional-reference behavior for
contract/supplier entities if their owning domain has no canonical table yet.

## API

Proposed resource routes; align names with existing API conventions during
implementation:

```text
POST /api/v1/license/entitlements
GET  /api/v1/license/entitlements
GET  /api/v1/license/entitlements/{id}
POST /api/v1/license/entitlements/{id}/commands/update
POST /api/v1/license/entitlements/{id}/commands/renew
POST /api/v1/license/pools
GET  /api/v1/license/pools
GET  /api/v1/license/pools/{id}
POST /api/v1/license/pools/{id}/commands/update
```

Every mutation requires `Idempotency-Key`; mutable records require
`expected_version` and a reason. Allowlist request fields. Queries remain
read-only and tenant/scope filtered.

## Events

Define payload contracts before emission. At minimum:

```text
LICENSE.ENTITLEMENT_CREATED
LICENSE.ENTITLEMENT_UPDATED
LICENSE.RENEWED
LICENSE.EXPIRING
LICENSE.EXPIRED
LICENSE.POOL_CREATED
LICENSE.POOL_UPDATED
```

Outbox facts commit atomically with entitlement/pool state. Include tenant,
aggregate identity/version, actor, correlation, causation, and idempotency
metadata. Never place license keys, credentials, or unrestricted contract
documents in event payloads.

## Idempotency, Concurrency, and Audit

- Same key and payload replays the original result; changed payload returns
  `409 IDEMPOTENCY_KEY_CONFLICT`.
- Update/renew operations require matching `expected_version`; conflicts return
  `409 VERSION_CONFLICT`.
- Entitlement, history, audit, and outbox changes commit in one transaction.
- Expiry facts are emitted at most once per entitlement term version; their
  idempotency identity includes the term version.
- Audit records identify actor, entitlement/pool, before/after, reason, and
  correlation. Do not store license keys or secrets in audit evidence.
- No timeline projection is required unless an existing traceability row
  explicitly requires it.

## Required Tests

- Create/read/list entitlement and pools under tenant and scope boundaries.
- Invalid quantity, validity range, currency, license type, state, and
  cross-tenant product/pool references are rejected.
- Idempotent create/update/renew replay and changed-request conflict.
- Expected-version conflict and invalid lifecycle transitions.
- Renewal preserves auditable prior validity; expiry cannot be bypassed by a
  direct state edit.
- Pool association does not duplicate entitlement quantity in aggregate reads.
- Audit/outbox atomicity, immutable history where implemented, and redaction of
  license-key/secret-like data.
- Migration applies to an empty database and is idempotent.

## Acceptance Criteria

1. License owns tenant-scoped canonical entitlement and pool records.
2. Entitlement fields preserve license type, quantity, validity, and commercial
   terms without conflating assignment, installation, or usage.
3. Pool organization never inflates entitlement totals or crosses tenant
   boundaries.
4. Lifecycle changes are explicit, versioned, idempotent, authorized, audited,
   and written to the outbox transactionally.
5. No assignment/reclaim/reservation or compliance calculation is implemented.
6. Contracted events, permissions, traceability, migration, and tests pass.
7. `CURRENT_TASK.md`, handoff, task registry, and this task report are updated.

## Scope Dependencies

- TASK-054 provides canonical Software products for entitlement references.
- TASK-058 owns assignment, reservation, activation, reclaim, and compliance
  behavior; do not create a parallel implementation here.

## Completion Report

Implemented the License-owned tenant-scoped entitlement and pool foundation.
The migration adds entitlements, versioned validity terms, append-only history,
and deduplicated expiry/renewal-warning facts. The module derives effective
state from the validity window. Authenticated API commands enforce permission,
idempotency, expected version, tenant scope, audit, and outbox behavior. The
worker emits `LICENSE.EXPIRING` inside an entitlement's configured renewal
notice window and `LICENSE.EXPIRED` once per expired term version.

Added permissions `license.read`, `license.entitlement.manage`, and
`license.pool.manage`, plus event contracts, traceability, and migration order.
Applied the migration and permission seed to the local PostgreSQL container.

Verification passed: `npm run typecheck`, `npm run lint`,
`npm run format:check`, `git diff --check`, and `npm test` (22 unit, 2
contract, 1 migration, 18 integration, and 15 E2E tests). The focused E2E test
covers authorization denial, tenant isolation, idempotency replay/conflict,
version conflict, term renewal/history, pool totals, secret rejection, and
atomic expiry/warning audit/outbox facts.

Remaining scope boundaries: assignment/reservation, compliance/usage
calculation, and dispatch integration belong to TASK-058. Contract and supplier
references remain display identifiers; no procurement or vendor integration
was introduced. Warning delivery currently records the configured per-term
notice fact; notification delivery and the broader renewal decision workflow
remain outside this task. Resource authorization carries department,
business-unit, and project pool scope into the policy evaluator. Country and
contract pool labels have no matching scope type in the current RBAC policy and
therefore require tenant-level permission; they are not silently mapped to a
different scope type.
