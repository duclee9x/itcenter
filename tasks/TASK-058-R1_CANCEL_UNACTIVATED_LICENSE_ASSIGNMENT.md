# TASK-058-R1 — Cancel Unactivated License Assignment

```yaml
task_id: TASK-058-R1
feature_id: F-035
workflow_id: WF-015
phase: P3
priority: P0
status: CODE_COMPLETE
owner_domain: license
```

## Objective

Implement the normative `LICENSE.CANCEL_ASSIGNMENT` command for a License
assignment that remains `ASSIGNED` and has never been activated. Retain the
assignment and history, release capacity exactly once, and publish the
`LICENSE.ASSIGNMENT_CANCELLED` fact transactionally.

## Official Business Rule

1. `ASSIGNED` consumes license capacity.
2. Only an unactivated `ASSIGNED` record can be explicitly cancelled.
3. The command is `LICENSE.CANCEL_ASSIGNMENT` and the transition is
   `ASSIGNED → CANCELLED`.
4. `CANCELLED` does not consume capacity; the LicenseAssignment row/history is
   retained.
5. `ACTIVE` and `SUSPENDED` cannot be cancelled; they use `LICENSE.RECLAIM`.
6. Cancellation requires `expected_version`, reason, `license.assign`
   authorization, idempotency, audit, and outbox.
7. Emit `LICENSE.ASSIGNMENT_CANCELLED` once for the committed transition.
   Replaying the same completed business command must not release capacity or
   emit duplicate effects.
8. Concurrent cancel/activate must be serialized and version-checked so one
   valid transition wins; a cancelled assignment cannot later activate.
9. Offboarding routes `ASSIGNED` to cancellation, `ACTIVE`/`SUSPENDED` to
   reclaim, and terminal/non-capacity states to no-op. Failed cancellation
   remains an actionable clearance failure; TASK-060 implements orchestration.

## Required Specifications

- `AGENTS.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md` (§§54–55)
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md` (§25.3)
- `docs/API_COMMAND_CONTRACT_SPEC.md` (§64)
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md` (License Admin)
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md` (License events)
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md` (§25)
- `docs/IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md` (§55)
- `docs/SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md` (§§46, 53)
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `tasks/TASK-058_LICENSE_ASSIGNMENT_RECLAIM_COMPLIANCE.md`

## In Scope

- License migration for `CANCELLED`, `cancelled_at`, immutable cancellation
  history, and database invariants that retain terminal cancellation and
  prevent activating it.
- Explicit, authorized, idempotent and versioned cancellation API/application
  command, with atomic audit and `LICENSE.ASSIGNMENT_CANCELLED` outbox event.
- Ensure capacity/compliance projections exclude `CANCELLED` and include
  `ASSIGNED`.
- Repeated cancellation returns the completed result without another state
  transition, capacity release, audit event, or outbox event.
- Concurrent cancel/activate integration tests proving exactly one legal
  transition commits and capacity is counted correctly.
- Update TASK-058 traceability/report, registry, current task and handoff.

## Out of Scope

- Implementing TASK-060 offboarding orchestration.
- Cancelling `ACTIVE`/`SUSPENDED`, deleting assignments/history, or introducing
  a second release ledger.

## Acceptance Criteria

1. `ASSIGNED → CANCELLED` succeeds only when `activated_at IS NULL` and the
   expected version matches.
2. `ACTIVE`/`SUSPENDED` cancellation is rejected without changing state,
   capacity, history, audit, or outbox.
3. `CANCELLED` is terminal, retained, excluded from capacity, and never
   reactivated; assignment history is append-only.
4. Same-key replay and repeated already-cancelled business requests do not
   repeat release or durable side effects.
5. Concurrent activation and cancellation serialize; only one legal state
   transition commits, with no double-release or duplicate event.
6. Permission denial, tenant isolation, idempotency conflict, stale version,
   audit/outbox atomicity, and database invariants are tested.
7. Normative specs, traceability, task report, registry, current task, and
   handoff match the committed implementation; all applicable checks pass.

## Completion Report

Implemented `LICENSE.CANCEL_ASSIGNMENT` at
`POST /api/v1/license-assignments/{id}/commands/cancel` under
`license.assign`. The command requires an expected version, idempotency key,
and reason; it performs only `ASSIGNED → CANCELLED`, stores `cancelled_at`,
retains the record/history, and releases capacity through the canonical state.
Retries of the same key replay, and a repeated cancellation with the same
reason returns a no-op result without a second history, audit, or outbox fact.

Migration `20260912_003_cancel_unactivated_assignment.sql` adds the terminal
state, cancellation timestamp constraints, history action, and a database
guard that prevents cancelling an activated assignment or reactivating a
cancelled one. Application row locking and expected-version checks serialize
concurrent activation/cancellation. The atomic outbox/audit fact is
`LICENSE.ASSIGNMENT_CANCELLED`.

Verification passed: migration and permission seed on local PostgreSQL;
`npm test` (58 tests: 22 unit, 2 contract, 1 migration, 18 integration,
15 E2E); `npm run typecheck`; `npm run lint`; `npm run format:check`; and
`git diff --check`. E2E covers active/suspended rejection, authorization denial,
idempotent replay/key conflict, capacity release, retained record/history,
terminal database guard, event/audit cardinality, and concurrent
cancel-versus-activate.
