# TASK-053 — Controlled Network Change + Verification + Rollback

```yaml
task_id: TASK-053
feature_id: NETWORK-CHANGE
workflow_id: WF-012
phase: P3
priority: P1
status: CODE_COMPLETE
owner_domain: network
```

Implement a tenant-scoped, auditable VLAN change operation linked to the
existing Change Management record. A change may start only when the owning
Change is approved, scheduled, and then transitioned to IMPLEMENTING through
the Change domain. Record implementation, verification, and rollback evidence
without invoking a device connector.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/AUDIT_NETWORK_DISCOVERY_VLAN_TOPOLOGY_WORKFLOW.md`
- `docs/PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`

## In Scope

- Persist a Network-owned VLAN change operation linked by reference to a
  tenant-owned Change, with target device/port, previous and desired VLAN,
  reason, rollback plan, state, version, and append-only phase evidence.
- Require the referenced Change to be `SCHEDULED` before the Network operator
  starts; require its approval request to be `APPROVED`; require the Change
  owner to transition it to `IMPLEMENTING` through its existing command.
- Add explicit network VLAN-change permission enforcement, idempotency,
  optimistic concurrency, audit, outbox, tenant isolation, and canonical errors.
- Record implementation result, technical/service/monitoring verification, and
  rollback trigger/steps/result/verification as distinct commands.
- Persist only opaque evidence references and optional SHA-256 checksums; raw
  device logs or secrets stay outside the API/audit payload.
- A failed verification must require rollback before terminal failure; a
  successful verification is the only route to operation `COMPLETED`.
- Never retry device writes automatically. No device configuration occurs in
  this task; no connector or credentials are currently wired.

## Out of Scope

- Live switch/controller configuration, re-auth/MFA credential capture, VLAN
  policy inference, change window scheduling engine, and automatic rediscovery.
- Mutating the Problem/Change tables from the Network module.

## State Flow

```text
PLANNED → IMPLEMENTING → VERIFYING → COMPLETED
                              └────→ ROLLBACK_REQUIRED → ROLLED_BACK | FAILED
```

## API Commands

```text
POST /api/v1/network/vlan-changes
POST /api/v1/network/vlan-changes/{id}/commands/start
POST /api/v1/network/vlan-changes/{id}/commands/record-implementation
POST /api/v1/network/vlan-changes/{id}/commands/verify
POST /api/v1/network/vlan-changes/{id}/commands/rollback
```

Every mutation requires `Idempotency-Key`; stateful commands require
`expected_version` and a non-empty reason. Start requires the linked Change to
be scheduled, its approval to be approved, and the Change state to be
`IMPLEMENTING`.

## Acceptance Criteria

1. Creating an operation requires a valid tenant Change, distinct old/new VLAN
   values, and non-empty reason and rollback plan.
2. Start rejects missing/unapproved/unscheduled changes and does not invoke an
   external device action.
3. Implementation evidence transitions to verification; verification reaches
   `COMPLETED` only when all required checks pass, otherwise
   `ROLLBACK_REQUIRED`.
4. Rollback records trigger, steps, actual result, and verification; only
   confirmed restoration reaches `ROLLED_BACK`, otherwise `FAILED`.
5. Commands enforce permission, tenant boundary, idempotency, version checks,
   audit and outbox effects; same-key retry does not duplicate effects.
6. Tests cover valid lifecycle, invalid approval/state, failed verification,
   rollback outcome, tenant isolation, permission denial, conflict/replay, and
   database constraints.
7. Applicable repository verification passes; `CURRENT_TASK.md` and
   `IMPLEMENTATION_HANDOFF.md` describe TASK-053 and the next task accurately.

## Scope Dependency

Live device application and rediscovery require a connector, scoped credentials,
and execution worker. Keep this task fail-closed and evidence-oriented until
that dependency is implemented.
