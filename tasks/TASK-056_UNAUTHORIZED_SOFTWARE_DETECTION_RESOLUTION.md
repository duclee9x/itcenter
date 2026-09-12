# TASK-056 — Unauthorized Software Detection + Resolution

```yaml
task_id: TASK-056
feature_id: F-033
workflow_id: WF-013
phase: P3
priority: P1
status: CODE_COMPLETE
owner_domain: software
```

## Objective

Ingest endpoint software inventory into a tenant-scoped normalized Software
projection, detect unauthorized installations, and drive auditable exception
resolution including safe removal dispatch and human work where automation is
not approved.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`

## In Scope

- Normalize agent inventory entries using explicit product identifiers and
  exact catalog name/alias matching; retain source observations and current
  normalized installation projection.
- Detect PROHIBITED immediately, RESTRICTED without a currently valid
  exception, and UNKNOWN only after a documented grace period or explicit
  review (implementation default: 72 hours). Deduplicate recurring observations into the same actionable
  exception.
- Implement the Software Exception state machine and versioned commands for
  temporary exception, false positive, investigation, removal request, policy
  ignore, and verified resolution. Temporary exceptions require owner,
  reason, approval evidence, and expiry.
- Create and resolve one Software-owned actionable Work Queue item per active
  exception. Work Item remains a projection/reference, not the source of truth.
- Permit automatic removal dispatch only for PROHIBITED software when an
  explicitly approved uninstall profile allows automation, the profile has a
  supported symbolic method, and the target is classified low operational
  risk. Unknown, restricted, high-risk, or unconfigured software must never be
  automatically removed.
- Authenticate removal claim/report at the enrolled Agent boundary; do not
  accept an agent report as proof of removal until a later inventory snapshot
  confirms absence.
- Add permissioned tenant-scoped APIs, idempotency, optimistic concurrency,
  audit/outbox, events, migrations and meaningful integration/E2E coverage.

## Out of Scope

- OS-specific package-manager/uninstaller implementation. The Agent consumes a
  symbolic approved profile through an adapter and fails closed when that
  adapter is unavailable.
- Fuzzy matching that could silently equate distinct products; external
  vulnerability feeds, SaaS inventory, licensing/usage optimization, and UI.
- Cross-domain direct writes. Inventory, exception, installation and removal
  job state are Software-owned; Work Queue APIs own their projection.

## Domain Rules and State

```text
UNKNOWN after grace/review; RESTRICTED without active exception; PROHIBITED
  → SOFTWARE.UNAUTHORIZED_DETECTED → OPEN
OPEN → request approval/investigation → WAITING_APPROVAL
OPEN / WAITING_APPROVAL → approved temporary exception → APPROVED_TEMPORARY
OPEN → approved safe removal → REMOVAL_PENDING
OPEN / WAITING_APPROVAL → confirmed false positive → FALSE_POSITIVE
OPEN → policy-authorized ignore → RESOLVED
REMOVAL_PENDING → later inventory confirms absent → RESOLVED
APPROVED_TEMPORARY → expires while still installed → OPEN (re-evaluate)
```

- `FALSE_POSITIVE` and `RESOLVED` are terminal for an exception record; a new
  later detection creates a new record linked to the same installation key.
- Preserve immutable inventory snapshots, decision history and removal
  attempts. A successful agent command alone does not resolve an exception.
- Same tenant/asset/normalized product/version/package/scope maps to one
  current installation. Do not infer absence from a partial or invalid report.
- Catalog matching is deterministic and exact after normalization. Unknown
  entries remain UNKNOWN; no fuzzy auto-approval/removal.
- Auto-removal requires a prohibited classification, explicitly approved
  profile and policy flag, supported symbolic method, low-risk target asset,
  no declared business dependency, current inventory evidence, authorization,
  idempotency and audit. All other removal decisions create human work.
- Agent output is bounded and sanitized. Never accept arbitrary shell command,
  URL, path, secrets, or license keys from inventory or API input.

## API / Commands

```text
GET  /api/v1/software/inventory
GET  /api/v1/software/exceptions
GET  /api/v1/software/exceptions/{id}
POST /api/v1/software/products/{id}/uninstall-profiles
POST /api/v1/software/inventory/{installation_id}/commands/review
POST /api/v1/software/exceptions/{id}/commands/request-approval
POST /api/v1/software/exceptions/{id}/commands/approve-temporary
POST /api/v1/software/exceptions/{id}/commands/mark-false-positive
POST /api/v1/software/exceptions/{id}/commands/request-removal
POST /api/v1/software/exceptions/{id}/commands/ignore-by-policy
POST /api/v1/agent/software-removals/claim
POST /api/v1/agent/software-removals/{id}/commands/report
POST /api/v1/agent/inventory                 # existing route, normalized
```

All state-changing user commands require `Idempotency-Key`, `expected_version`,
reason and relevant authorization/approval evidence. Agent claims and reports
require an enrolled agent, asset binding, lease and idempotency key.

## Permissions

```text
software.inventory.read
software.exception.read
software.exception.manage
software.exception.approve
software.removal.manage
```

Agent claim/report is restricted to authenticated AGENT principal and its
bound asset. Approval cannot be inferred from permission alone; temporary
exception approval must reference a distinct authorized approval decision.

## Persistence and Atomic Effects

- Software-owned current inventory, append-only snapshots, aliases, exception
  aggregate/history, approved uninstall profiles, removal jobs/attempts.
- Tenant foreign keys, unique current installation identity, optimistic
  versions, append-only evidence, one active exception/work item per detection
  identity, claim lease invariants.
- Each exception command commits state/history, outbox and durable audit in one
  transaction. Inventory commits source snapshot, normalized projection,
  detection/exception state and events atomically. Agent execution is outside
  the transaction.
- Events include `SOFTWARE.INVENTORY_NORMALIZED`,
  `SOFTWARE.UNAUTHORIZED_DETECTED`, `SOFTWARE.EXCEPTION_UPDATED`,
  `SOFTWARE.REMOVAL_REQUESTED`, `SOFTWARE.REMOVAL_JOB_CLAIMED`, and
  `SOFTWARE.REMOVED` with tenant, aggregate/version, asset/product identifiers,
  actor, correlation and causation metadata. Do not emit inventory item names
  containing unbounded raw payloads.

## Acceptance Criteria

1. Authenticated agent inventory is validated, normalized deterministically,
   stored as immutable observation plus current Software projection, and
   cannot write across tenant/asset boundaries.
2. Prohibited and unauthorized restricted installs produce one durable
   exception and actionable Work Item; duplicates update last-seen evidence
   without duplicate records/events/work.
3. Unknown software is not auto-removed and does not alert before its grace
   period unless explicitly reviewed.
4. Temporary approval has a distinct approval reference, owner, reason and
   future expiry; expiry reopens/re-evaluates an installation that remains.
5. False-positive and policy-ignore decisions require permission, reason,
   evidence and audit; terminal history is retained.
6. Removal cannot dispatch for unknown/restricted, high-risk, dependency-marked,
   or unconfigured installations. Eligible prohibited software produces a
   leased symbolic removal job; unavailable agent adapter fails closed.
7. Removal resolves only after a subsequent complete inventory report proves
   that the installation is absent; failed/stale reports leave actionable work.
8. Same-key retries replay; changed request conflicts; stale versions conflict;
   concurrent decisions/removal claims cannot create duplicate side effects.
9. Outbox, audit, state history and owner-domain data are tenant-scoped and
   committed atomically; required event payload contracts are validated.
10. Typecheck, lint, format, migrations, unit/contract/integration/E2E checks
    pass, registry is updated, and CURRENT_TASK/HANDOFF point to the derived
    next task without starting it.

## Completion Report

Status: `CODE_COMPLETE`.

- Added tenant-scoped software inventory observations/current projection,
  deterministic catalog and alias matching, prohibited/restricted detection,
  and the documented 72-hour UNKNOWN review grace.
- Added versioned software exceptions, temporary approval, false-positive,
  investigation, policy ignore, removal request, expiry/recovery and verified
  resolution. Work Queue records remain references to Software-owned state.
- Added approved symbolic uninstall profiles and agent-bound leased removal
  jobs. Dispatch fails closed for risky targets or unsupported conditions;
  retries require an explicit retryable result and stop after three attempts.
  A removal report resolves only after a later complete inventory confirms
  absence.
- Added migrations, API and agent routes, authorization, idempotency,
  optimistic concurrency, audit/outbox events, event payload alignment,
  traceability/spec updates and database-backed E2E coverage.
- Verification passed: `npm test` (65 tests: 22 unit/architecture, 2
  contract, 1 migration, 18 integration, 22 E2E), `npm run typecheck`,
  `npm run lint`, `npm run format:check`, and `git diff --check`.
- Assumption: UNKNOWN grace is 72 hours by default; operating-system-specific
  uninstall adapters remain outside scope and unsupported adapters fail closed.
- Next registry item TASK-059 remains `BLOCKED`; TASK-061 remains blocked on
  TASK-059. No downstream implementation was started.
