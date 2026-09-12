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
PLANNED, IN_PROGRESS, BLOCKED, WAITING_ASSET_RETURN,
WAITING_OWNER_TRANSFER, READY_TO_CLOSE, COMPLETED, CANCELLED
```

- Enforce transition rules from the normative offboarding state machine; do not
  infer additional transitions from this state list.
- A termination start is idempotent and versioned. Tenant validation precedes
  resource scope. An emergency reason is required where policy classifies the
  termination as critical.
- `TERMINATING` must stop interactive login and authorization immediately;
  session revocation and temporary access removal are recorded as Identity
  actions. No external HTTP call occurs inside the database transaction.
- Case completion must verify no active session, no privileged/temporary access,
  and no outstanding tracked Asset or supported License clearance, unless a
  specific approved exception is recorded.
- Asset and License state changes are explicit commands/use cases through the
  owning application contracts. Cross-domain partial failure leaves a durable
  blocked case that can be retried or reconciled; it must not imply rollback of
  already committed domain actions.
- A case may not mark an Asset disposed or silently release an uncertain
  License allocation.

## SPEC_CONFLICT — License Assignment State

TASK-058 only permits reclaim from `ACTIVE` or `SUSPENDED` assignments, while
offboarding requires reclaim/release of the user's License allocations and the
assignment model also contains `ASSIGNED` (not yet activated). Completing
offboarding with an `ASSIGNED` allocation would either leave capacity held or
require an unapproved lifecycle transition.

Safe implementation boundary: keep the offboarding case blocked and report the
unactivated assignment as unresolved. Smallest proposed resolution: define an
explicit, audited License command for cancelling an unactivated `ASSIGNED`
allocation (with expected version and reason), then use it from offboarding.
Do not add this transition or treat the assignment as reclaimed until the
specification owner resolves the conflict.

## Acceptance Criteria

1. Identity owns a durable, tenant-scoped offboarding case and its state machine.
2. Immediate termination blocks new use of the account and records session and
   temporary-access revocations.
3. Asset return and License reclaim are requested through owning-domain
   application contracts, with partial failure/retry represented on the case.
4. Completion is blocked while required clearances remain unresolved; exceptions
   require explicit approval and evidence.
5. Commands enforce permission, tenant/scope, idempotency, versions, audit, and
   outbox contracts; user and audit records remain retained.
6. Cross-domain E2E tests cover successful close, missing Asset, partial failure
   and retry, duplicate start, authorization denial, and the unresolved
   `ASSIGNED` License conflict.

## Completion Report

To be filled after implementation and verification.
