# TASK-060-R1 — Define Normative Offboarding State Machine

```yaml
task_id: TASK-060-R1
parent_task_id: TASK-060
feature_id: F-004/OFFBOARDING
workflow_id: WF-ID04/WF-019
phase: P3
priority: P0
status: CODE_COMPLETE
owner_domain: identity
task_type: SPEC_REMEDIATION
```

## Objective

Resolve the TASK-060 `SPEC_CONFLICT` by making the approved Offboarding Case
state machine, cancellation and recovery rules normative before implementation.
This task changes specifications and traceability only; it does not implement
TASK-060 application code.

## Normative Business Rules

1. Offboarding Case and User Lifecycle are independent state machines. Their
   transitions are coordinated by Identity commands but neither state machine
   implicitly changes the other.
2. Offboarding Case states are exactly:

   ```text
   INITIATED, IN_PROGRESS, BLOCKED, READY_TO_CLOSE,
   CANCELLATION_PENDING, COMPLETED, CANCELLED
   ```

   `COMPLETED` and `CANCELLED` are terminal.
3. Normal transitions are exactly:

   ```text
   INITIATED --START--> IN_PROGRESS
   IN_PROGRESS --blocking failure--> BLOCKED
   BLOCKED --RESUME--> IN_PROGRESS
   IN_PROGRESS --MARK_READY--> READY_TO_CLOSE
   READY_TO_CLOSE --COMPLETE--> COMPLETED
   ```
4. Cancellation transitions are:

   ```text
   INITIATED --OFFBOARDING.CANCEL with no required compensation--> CANCELLED
   IN_PROGRESS --OFFBOARDING.REQUEST_CANCEL--> CANCELLATION_PENDING
   BLOCKED --OFFBOARDING.REQUEST_CANCEL--> CANCELLATION_PENDING
   READY_TO_CLOSE --OFFBOARDING.REQUEST_CANCEL--> CANCELLATION_PENDING
   CANCELLATION_PENDING --OFFBOARDING.COMPLETE_CANCELLATION--> CANCELLED
   ```
5. Cancellation while the User is `TERMINATING` is allowed only after the
   authoritative termination request has been withdrawn or cancelled.
6. Persist `pre_offboarding_user_state` before changing the User to
   `TERMINATING`. A successful cancellation may restore `TERMINATING` to that
   captured state only through an explicit, validated Identity transition.
7. `OFFBOARDING.CANCEL` is valid only from `INITIATED` when no compensation is
   required. It and all cancellation commands never restore a User in
   `TERMINATED`. A terminated User requires the separate `USER.REACTIVATE` /
   REHIRE workflow.
8. Cancellation after side effects begin requires compensating or recovery
   actions. Historical actions are retained and never deleted or rewritten.
9. `CANCELLATION_PENDING` may become `CANCELLED` only after every required
   recovery action is `SUCCEEDED` or has an explicit policy-authorized
   `WAIVED` / `ACCEPTED_EXCEPTION` disposition. Irreversible data wipe or
   disposal is not rolled back; it requires recovery/manual exception work.
10. `READY_TO_CLOSE` requires every mandatory task to have succeeded or to be
    policy-approved as waived, no unresolved blockers, a still-valid
    termination request, and no pending cancellation.
11. `COMPLETED` requires canonical User lifecycle `TERMINATED`, either already
    observed or produced by the normative finalization flow.
12. There is no `COMPLETED -> CANCELLED` transition and no historical rewrite.
13. State-changing commands enforce `expected_version`, idempotency,
    authorization, reason, audit, outbox and `correlation_id` where applicable.
14. `COMPLETE` and `REQUEST_CANCEL` compete on the same case version/aggregate
   lock. Exactly one transition may win; the loser receives a version conflict
   and must reload current state. Neither command may overwrite the winner. If a
   command changes both User Lifecycle and Offboarding Case, it validates both
   aggregate versions and commits both explicit transitions atomically.
15. Required events are `OFFBOARDING.STARTED`, `OFFBOARDING.BLOCKED`,
    `OFFBOARDING.RESUMED`, `OFFBOARDING.READY_TO_CLOSE`,
    `OFFBOARDING.CANCELLATION_REQUESTED`, `OFFBOARDING.CANCELLED`, and
    `OFFBOARDING.COMPLETED`.

## In Scope

- Update the normative state machine, Identity offboarding workflow, data model,
  API command guidance, permission catalog, event payload contracts,
  traceability and TASK-060 contract to match these rules.
- Require TASK-060 implementation to test concurrent `COMPLETE` versus
  `OFFBOARDING.REQUEST_CANCEL`.
- Update task registry and handoff so TASK-060 is `READY` / `NOT_STARTED` once
  this remediation is complete.

## Out of Scope

- Implementing any TASK-060 runtime behavior, migration, endpoint, command
  handler or application test.
- Implementing User REACTIVATE / REHIRE.

## Acceptance Criteria

1. The normative documents define the independent state machines and exact
   transitions, including cancellation and terminal-state behavior.
2. The pre-offboarding User state, authoritative termination withdrawal,
   compensation/recovery, irreversible actions, and finalization invariants
   are traceable in the data model and workflow.
3. All seven required events have payload contracts and appear in the workflow
   event catalog.
4. TASK-060 explicitly requires a race test for `COMPLETE` versus
   `OFFBOARDING.REQUEST_CANCEL` and cannot complete on stale state.
5. Registry, CURRENT_TASK and IMPLEMENTATION_HANDOFF mark TASK-060 `READY` and
   `NOT_STARTED`, while stating that implementation awaits a separate explicit
   user instruction.
6. This remediation is committed separately from any TASK-060 implementation.

## Completion Report

- Updated the normative state machine and Identity offboarding workflow with
  the approved transitions and cancellation/recovery invariants.
- Added the Identity data-model field for the captured pre-offboarding User
  state and relevant command, permission, event and traceability contracts.
- Updated TASK-060 acceptance criteria and registry readiness. No TASK-060 code
  was implemented.
- Verification: documentation consistency review, Prettier check, and
  `git diff --check` passed. Runtime tests were not applicable to this
  specification-only remediation.
