# TASK-057 — License Entitlement + Pool Model

```yaml
task_id: TASK-057
feature_id: F-034
workflow_id: WF-L01
phase: P3
priority: P0
status: NOT_STARTED
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
  supported license type and lifecycle state, tenant-safe references, and
  uniqueness needed for idempotent administration.
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
- An entitlement may optionally refer to an existing contract, supplier, or
  pool only when that reference is tenant-safe and its domain contract exists.
  Do not invent cross-domain foreign keys to tables that are not implemented.
- Quantity is a positive integer. Expiry and validity boundaries are explicit;
  an expired entitlement cannot be renewed by silently changing its history.
- Entitlement corrections and renewal create auditable state/history rather
  than deleting or rewriting immutable evidence.
- Pool membership provides organizational attribution; it does not create
  additional entitlement quantity or grant a license assignment.
- A pool-scoped entitlement must not be counted twice in aggregate reads.

## State and Commands

Entitlement lifecycle must align with the canonical License state in the state
machine specification. At minimum, reject use outside its validity window and
preserve an auditable transition to expired or renewed status. Do not introduce
assignment states from WF-L01 into the entitlement entity.

Required commands:

```text
LICENSE.ENTITLEMENT_CREATE
LICENSE.ENTITLEMENT_UPDATE
LICENSE.ENTITLEMENT_RENEW
LICENSE.ENTITLEMENT_EXPIRE (system/scheduled transition if required)
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
  lifecycle state, actor, version, and timestamps.
- `license.license_pools`: name, pool type, optional organizational and
  contract references, state, version, and timestamps.
- Any minimal append-only entitlement history needed to audit updates, renewal,
  and expiry. Do not add assignment, installation, or usage tables in this task.

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
LICENSE.ENTITLEMENT_RENEWED
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

To be filled after implementation and verification.
