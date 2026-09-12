# TASK-058 — License Assignment + Reclaim + Compliance

```yaml
task_id: TASK-058
feature_id: F-035/F-036
workflow_id: WF-015
phase: P3
priority: P0
status: NOT_STARTED
owner_domain: license
```

## Objective

Implement License-owned reservations, assignments, activation, reclaim, and a
tenant-scoped compliance projection on top of TASK-057 entitlements. Integrate
the License reservation application contract with Software deployment so a
license-required deployment cannot dispatch without an authoritative
reservation. Keep assignment, installation evidence, observed usage, and
entitlement quantity as separate facts.

## Readiness and Dependencies

- TASK-031 is `CODE_COMPLETE`: authenticated agent-to-asset context exists.
- TASK-054 provides canonical software products and license-required catalog
  metadata.
- TASK-055 provides deployment lifecycle and currently fails closed for
  license-required software because no reservation contract exists.
- TASK-057 is `CODE_COMPLETE`: tenant-scoped entitlements, pools, terms, and
  permissions are available.
- No physical switch, vendor licensing API, external IdP, or production
  credential is required; this task uses the repository's generic internal
  interfaces.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md` (License traceability)
- `docs/SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md` (§§45–53,
  §§63, 85–87)
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md` (§§25, 72, 91)
- `docs/STATE_MACHINE_MASTER_SPEC.md` (§§54–56)
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md` (§43)
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `tasks/TASK-031_AGENT_ENROLLMENT_STATUS.md`
- `tasks/TASK-054_SOFTWARE_CATALOG_ARTIFACT_REPOSITORY.md`
- `tasks/TASK-055_SOFTWARE_DEPLOYMENT_VERIFICATION.md`
- `tasks/TASK-057_LICENSE_ENTITLEMENT_POOL_MODEL.md`

## In Scope

- License-owned tenant-scoped reservation and assignment records, history,
  state transitions, expected versions, and database invariants.
- User and asset principals, with same-tenant validation through the owning
  Identity/Asset application boundary. Do not mutate their tables.
- Reserve, assign, activate, suspend, request reclaim, complete reclaim, and
  release/cancel an unconsumed reservation through explicit commands.
- A License application contract that Software calls before dispatch and
  compensates when a job is safely cancelled before activation. A committed
  uncertain deployment must be reconciled before releasing its reservation.
- Pool-aware availability checks that count canonical reservations and
  assignments once, without counting installation observations as assignments.
- Compliance reads for `UNKNOWN`, `COMPLIANT`, `AT_RISK`, `OVERUSED`,
  `UNDERUSED`, and `EXPIRED`, with explanation and evidence timestamps. Emit
  overuse/underuse facts only when the applicable consumption rule and
  authoritative evidence exist.
- Audit, outbox, idempotency, tenant/scope authorization, stable permissions,
  event contracts, traceability, metrics, and focused tests.

## Out of Scope

- Procurement, contract authoring, supplier or SaaS vendor API integration.
- Automatic software uninstall or asset/user offboarding orchestration.
- Inventing a universal seat-consumption formula across license types.
- Treating installation inventory as proof of assignment, or assignment as
  proof of active usage.
- Automatically approving overuse, bypassing deployment security controls, or
  releasing a reservation after an uncertain execution result.

## Domain Rules and Safe Consumption Boundary

- One active assignment per entitlement/principal/model unless an explicit
  license model permits otherwise. Prevent duplicate active assignments with
  database constraints and idempotency.
- Assignments reference one tenant's entitlement and a typed principal. The
  principal is an identity user or asset, validated through its owning
  application contract; it is never a cross-domain mutation.
- Reserve and assignment operations are concurrency-safe. Lock the owning
  entitlement/pool rows or use an equivalent serializable invariant so two
  concurrent requests cannot allocate beyond supported quantity.
- Count only explicit, countable reservations/assignments toward seat
  availability. Never assume `CONCURRENT`, `SITE`, `ENTERPRISE_AGREEMENT`,
  `CORE_CPU`, or other non-seat models consume one seat per principal. If a
  consumption policy or observation source is absent, report compliance as
  `UNKNOWN` and do not emit a definitive overuse finding.
- `UNDERUSED` requires a configured inactivity threshold plus authoritative
  usage evidence. Lack of telemetry alone is not evidence of non-use.
- Reservation compensation is an auditable command. Do not delete assignment
  history or blindly reclaim on timeout, worker retry, or unknown deployment
  result.
- Reclaim follows `ACTIVE/SUSPENDED → RECLAIM_PENDING → RECLAIMED`; completing
  reclaim releases capacity only after the required verification is recorded.
- Compliance is a calculated read projection; never persist it as entitlement
  or assignment lifecycle state.

## API and Application Contracts

Use protected command routes following repository conventions, including:

```text
POST /api/v1/license-entitlements/{id}/commands/reserve
POST /api/v1/license-assignments/{id}/commands/assign
POST /api/v1/license-assignments/{id}/commands/activate
POST /api/v1/license-assignments/{id}/commands/suspend
POST /api/v1/license-assignments/{id}/commands/reclaim
POST /api/v1/license-assignments/{id}/commands/complete-reclaim
GET  /api/v1/license-entitlements/{id}/availability
GET  /api/v1/license-compliance
```

Exact resource paths may follow the existing API style, but commands must
remain explicit. Every retryable mutation requires `Idempotency-Key`; every
mutable aggregate requires `expected_version` and a reason. Reads are
tenant/scope filtered and expose evidence age and unknown inputs.

Define a narrow application port for Software, such as reserve-for-deployment,
confirm activation, and release-before-execution. The port carries tenant,
product, asset/principal, deployment operation, and idempotency identity. It
must not expose License tables or become a generic cross-domain write API.
Software remains fail-closed when the port is missing, capacity is unavailable,
or the result is uncertain.

## Permissions

Use stable permissions already specified by policy:

```text
license.read
license.assign
license.reclaim
license.compliance.resolve
```

Assignment and reclaim decisions enforce tenant before resource scope.
Permission to assign does not grant permission to resolve a compliance
exception. Do not grant these permissions broadly through role defaults.

## Events

Define or extend payload contracts before emission:

```text
LICENSE.ASSIGNED
LICENSE.ACTIVATED
LICENSE.RECLAIM_PENDING
LICENSE.RECLAIMED
LICENSE.OVERUSED
LICENSE.UNDERUSED
SOFTWARE.DEPLOYMENT_LICENSE_RESERVED
SOFTWARE.DEPLOYMENT_LICENSE_RELEASED
```

If repository event naming or task precedence shows deployment reservation
events should be License-owned instead, preserve one canonical fact and report
the smallest contract adjustment before adding duplicate events. State changes,
history, outbox, and required audit evidence commit atomically. External agent
execution, inventory polling, and notifications remain outside the DB
transaction.

## Required Tests

- Same-tenant user/asset assignment, cross-tenant/missing principal denial,
  duplicate assignment rejection, permission/scope denial, and idempotent
  retries with changed-payload conflict.
- Reservation capacity, per-user/per-device behavior, no over-allocation under
  concurrent requests, and release only for safe pre-execution cancellation.
- Valid and invalid state transitions, stale version conflict, reclaim
  verification, and append-only history.
- Deployment is blocked without a reservation; authorized dispatch reserves
  before execution; safe failure compensates; uncertain outcome retains
  capacity pending reconciliation.
- Compliance states for known countable data, overuse, underuse with evidence,
  expired entitlement, and `UNKNOWN` for unsupported models or stale/missing
  usage data.
- Outbox/audit atomicity, no cross-domain table mutation, no secrets in events,
  tenant-filtered reads, and migration idempotency.

## Acceptance Criteria

1. License owns assignment, reservation, reclaim, and compliance behavior.
2. Capacity invariants hold under parallel commands and tenant isolation.
3. Deployment calls the narrow reservation contract and fails closed when it
   cannot obtain a durable reservation.
4. Assignment, installation, usage, and entitlement remain distinct facts.
5. Unsupported consumption semantics produce `UNKNOWN`, not invented counts.
6. Commands are authorized, idempotent, versioned, audited, and outboxed.
7. Traceability, migration, task report, `CURRENT_TASK.md`, and handoff are
   updated; applicable tests pass.

## Scope Dependencies

- TASK-031 agent-to-asset context is available.
- TASK-054 software product identity and license-required flag are available.
- TASK-055 deployment lifecycle integrates through the reservation application
  port; it may not write License tables.
- TASK-057 entitlement and pool records are available.

## Completion Report

To be filled after implementation and verification.
