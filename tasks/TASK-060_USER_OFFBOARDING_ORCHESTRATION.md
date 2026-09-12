# TASK-060 — User Offboarding Orchestration

```yaml
task_id: TASK-060
feature_id: F-004/OFFBOARDING
workflow_id: WF-ID04/WF-019
phase: P3
priority: P0
status: NOT_STARTED
owner_domain: identity
```

## Objective

Implement an Identity-owned offboarding case that coordinates access revocation,
asset return, and supported License reclaim while retaining user and audit
history. The case is the orchestration record; Asset and License remain owners
of their assignments and state transitions.

## Required Specifications

- `AGENTS.md`
- `docs/IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md` (§§50–63,
  §§82–84)
- `docs/STATE_MACHINE_MASTER_SPEC.md` (§§69–70)
- `tasks/TASK-060-R1_NORMATIVE_OFFBOARDING_STATE_MACHINE.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md` (Identity, Asset, License,
  offboarding and audit entities)
- `docs/API_COMMAND_CONTRACT_SPEC.md` (§§49–50)
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `tasks/TASK-003_AUTHORIZATION_SCOPES_PRIVILEGED_ACCESS.md`
- `tasks/TASK-015_ASSET_RETURN_HANDOVER_DOCUMENTS.md`
- `tasks/TASK-058_LICENSE_ASSIGNMENT_RECLAIM_COMPLIANCE.md`

## In Scope

- Identity-owned, tenant-scoped offboarding case, history, state transitions,
  expected versions, and idempotent explicit lifecycle commands.
- Immediate/manual termination initiation that makes the user
  `TERMINATING`, prevents new authentication/authorization, and revokes active
  sessions and temporary access through Identity-owned application logic.
- Tenant-scoped discovery of assigned assets and user License assignments
  through owning-domain application contracts.
- Create Asset return requests and initiate supported License reclaim through
  the Asset and License application boundaries; do not write their tables.
- Clearance tracking for access revocation, tracked asset returns, supported
  License reclaim, and explicit approved exceptions. Missing assets leave the
  case blocked unless the applicable exception is approved.
- Complete the case and set the user `TERMINATED` only when required clearances
  pass; preserve user records and immutable audit history.
- License cleanup routes `ASSIGNED` through `LICENSE.CANCEL_ASSIGNMENT`,
  `ACTIVE`/`SUSPENDED` through `LICENSE.RECLAIM`, and terminal/non-capacity
  states to no-op through the License application boundary.
- A failed cancellation or reclaim leaves License clearance incomplete and
  creates or retains actionable work for human resolution; the case cannot
  complete while that failure is unresolved.
- Transactional audit/outbox, stable permissions, tenant/scope checks,
  observability, migration, traceability, and focused E2E tests.

## Out of Scope

- HRIS/SCIM/LDAP synchronization, future-effective scheduling, notification
  delivery, VPN/SaaS/provider revocation, software uninstall, ownership transfer,
  work reassignment, archival/retention automation, and UI.
- Direct writes to Asset or License persistence, deleting users/history, or
  marking unreturned assets disposed.

## State and Safety Rules

Use only the specified case states and transitions:

```text
INITIATED, IN_PROGRESS, BLOCKED, READY_TO_CLOSE,
CANCELLATION_PENDING, COMPLETED, CANCELLED
```

- Offboarding Case and User Lifecycle are independent state machines. Enforce
  only the normative transitions and cancellation/recovery rules in
  `STATE_MACHINE_MASTER_SPEC.md` §69 and the Identity offboarding workflow.
- Persist immutable `pre_offboarding_user_state` before transitioning User
  Lifecycle to `TERMINATING`.
- A termination start is idempotent and versioned. Tenant validation precedes
  resource scope. An emergency reason is required where policy classifies the
  termination as critical.
- In this manual initiation path, an authorized operator supplies the
  authoritative termination request reference; the API persists and carries
  that reference through readiness and cancellation withdrawal. External HRIS
  validation remains out of scope.
- `TERMINATING` must stop interactive login and authorization immediately;
  session revocation and temporary access removal are recorded as Identity
  actions. No external HTTP call occurs inside the database transaction.
- Case completion must verify no active session, no privileged/temporary access,
  and no outstanding tracked Asset or supported License clearance, unless a
  specific approved exception is recorded.
- Cancellation from `INITIATED` is allowed only when no compensation is
  required, using `OFFBOARDING.CANCEL`. Cancellation from `IN_PROGRESS`,
  `BLOCKED`, or `READY_TO_CLOSE`
  enters `CANCELLATION_PENDING`; complete cancellation only after all required
  recovery actions succeed or are explicitly policy-authorized as waived or an
  accepted exception. Cancellation while User Lifecycle is `TERMINATING`
  requires the authoritative termination request withdrawal reference at
  `OFFBOARDING.REQUEST_CANCEL`, before entering `CANCELLATION_PENDING`.
  Restore the captured User state only through an explicit validated Identity
  transition. Cancellation must never restore a `TERMINATED` User; use
  `USER.REACTIVATE` / REHIRE. Preserve all historical actions and handle
  irreversible actions through recovery/manual exception work.
- `READY_TO_CLOSE` requires all mandatory tasks succeeded or policy-approved
  waived, no unresolved blockers, a still-valid termination request, and no
  pending cancellation. `COMPLETED` requires canonical User Lifecycle
  `TERMINATED`, observed or produced by the normative finalization flow.
- `OFFBOARDING.COMPLETE` and `OFFBOARDING.REQUEST_CANCEL` must serialize on the
  same case version/aggregate lock. A concurrent loser gets a version conflict;
  it cannot overwrite the committed winner. Commands that change both the case
  and User Lifecycle validate both aggregate versions and commit both explicit
  Identity transitions atomically.
- Asset and License state changes are explicit commands/use cases through the
  owning application contracts. Cross-domain partial failure leaves a durable
  blocked case that can be retried or reconciled; it must not imply rollback of
  already committed domain actions.
- A case may not mark an Asset disposed or silently release an uncertain
  License allocation.

## Acceptance Criteria

1. Identity owns a durable, tenant-scoped offboarding case and its state machine.
2. Immediate termination blocks new use of the account and records session and
   temporary-access revocations.
3. Asset return and License reclaim are requested through owning-domain
   application contracts, with partial failure/retry represented on the case.
4. Completion is blocked while required clearances remain unresolved; exceptions
   require explicit approval and evidence.
5. Commands enforce permission, tenant/scope, idempotency, expected versions,
   reason, audit, outbox and correlation contracts; user and audit records
   remain retained.
6. Cross-domain E2E tests cover successful close, missing Asset, partial failure
  and retry, duplicate start, authorization denial, cancellation of unactivated
  License assignments, reclaim of active/suspended assignments, cancellation
  recovery including the no-reactivation guard for `TERMINATED` Users, and actionable
  cleanup failure without false completion. A concurrency test races
  `OFFBOARDING.COMPLETE` against `OFFBOARDING.REQUEST_CANCEL` and proves exactly
  one wins while the losing stale command cannot rewrite case or User history.

## Completion Report

- Added an Identity-owned case, append-only case/lifecycle/recovery histories,
  durable clearance tasks, and reconciliation leases. The API exposes separate
  case creation and `OFFBOARDING.START` commands plus an atomic immediate-start
  command. Direct cancellation is available only from `INITIATED` with no side
  effects.
- Starting revokes active sessions, temporary grants, and user role bindings;
  `TERMINATING` blocks subsequent login and authorization. Final completion
  validates clearances and remaining Identity access, changes the canonical
  User to `TERMINATED`, and completes the case atomically.
- Asset return and cancellation run through Asset application commands.
  License cleanup routes `ASSIGNED` through cancel and `ACTIVE`/`SUSPENDED`
  through reclaim. Pending/failing cleanup stays visible on the case and in an
  actionable Operations work item; reconciliation can retry without repeating
  completed owner-domain effects. Cancellation requires a recorded request
  withdrawal and authorized recovery evidence; terminated users cannot be
  restored.
- Added tenant-scoped permissions, optimistic versions, durable idempotency,
  transactional audit/outbox events, an offboarding Work Queue source, and
  migrations for Identity cases, Asset return recovery, and Operations work.
  Case reconciliation leases serialize cross-domain cleanup against terminal
  and cancellation commands.
- Verification passed: `npm run typecheck`, `npm run lint`, migration tests,
  focused Offboarding E2E, and full `npm test` (62 tests: 22 unit/architecture,
  2 contract, 1 migration, 18 integration, 19 E2E). Formatting and
  `git diff --check` also passed.
- Implementation assumption: without an HRIS/termination-request provider,
  an authorized operator attests the termination request reference at creation
  and its withdrawal reference before `REQUEST_CANCEL`. External source
  validation remains outside TASK-060 scope.
