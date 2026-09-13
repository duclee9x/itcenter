# TASK-091-R1 — Automation Action Execution Contract Gap

**Status:** `IN_PROGRESS` — awaiting normative resolution before TASK-091
implementation.

## Purpose

Reconcile the TASK-091 planning state and identify the minimum missing
execution contract. This record does not authorize runtime implementation and
does not change TASK-090 behavior.

## Confirmed normative boundary

TASK-090 creates durable, policy-gated Action Intents and never executes
actions. TASK-091 may consume only eligible intents and must recheck current
kill switch, Action Policy, `SYSTEM_AUTOMATION` permission/resource scope,
approval, conflict/cancellation and target eligibility immediately before
execution. TASK-091 owns execution, retries, verification, timeout,
compensation and execution outcomes. A `READY` intent alone is not sufficient
execution authorization.

The existing TASK-090 capability catalog registers only `RESTART_AGENT` for
`AGENT`, with executor identifier `TASK091_AGENT_COMMAND`. No TASK-091
executor, agent command/claim/report protocol or restart verification flow is
implemented.

## SPEC_GAP / PLANNING_REQUIRED

TASK-091 is not implementation-ready until a detailed contract resolves:

1. The canonical execution state ownership and transitions across
   `action_intents`, `rule_executions` and `action_executions`, including
   atomic claim/lease and stale-worker recovery.
2. The authenticated dispatch and result-report protocol for
   `RESTART_AGENT`, including idempotency identity and duplicate delivery
   behavior.
3. The observable success condition and verification timeout for
   `RESTART_AGENT` (the workflow gives “heartbeat restored” as an example but
   defines neither freshness nor deadline).
4. The immutable source of per-action timeout/retry settings. The general
   retry standard requires `max_attempts`, `max_elapsed_time`, `backoff`,
   retryable and non-retryable errors; current TASK-090 rule versions do not
   persist these values. General workflow examples mention two retries while
   the generic background-job class permits up to five attempts; neither is
   assigned to this action.
5. The recovery behavior for unknown execution outcome and the point at which
   exhausted retries create a human Work Item.
6. Whether the initial supported action has a compensator. A restart is not
   itself reversible; the existing workflow says rollback is action-specific.
7. Execution operator/retry/cancel permissions, expected-version and
   idempotency requirements for manual retry or cancellation commands.

These gaps affect observable side effects and duplicate-execution safety;
implementation must not fill them by guessing.

## Proposed safe initial TASK-091 baseline — pending approval

To keep the first implementation bounded to the existing reviewed
capability, adopt this single baseline unless the owner revises it:

- TASK-091 executes only `RESTART_AGENT` v1; all other action types remain
  unsupported and fail closed.
- Dispatch is a tenant-bound, authenticated enrolled-Agent pull/claim command;
  each attempt has one durable `action_execution_id`, and agent acceptance
  and reports are idempotent by that identity.
- Verification succeeds only after an authenticated heartbeat from the same
  Agent is observed within five minutes after the Agent accepts the command.
  Timeout is measured from accepted dispatch. A timeout with uncertain action
  outcome is not retried automatically; it enters human reconciliation. No
  compensating action is defined for a restart.
- Persist the initial action execution policy immutably with the capability
  version: `max_attempts=1`, `max_elapsed_time=5 minutes`,
  `verification_timeout=5 minutes`, no automatic retry/backoff and no
  retryable execution errors. These values are proposed for TASK-091 v1 only;
  later changes require a new reviewed policy/capability version.
- Manual retry, if included, is an explicit authorized command using
  `execution.retry`, reason, expected version and idempotency, and it repeats
  the full security recheck. It does not override current policy, grant,
  approval, conflict, target or kill-switch denial. A retry is allowed only
  after the prior attempt's actual Agent state has been reconciled; the retry
  creates a new attempt record linked to the same intent.
- Execution cancellation is limited to a durable execution that has not yet
  been accepted by the Agent. Once accepted, cancellation cannot assert that
  the Agent action was stopped; reconciliation and human fallback are
  required. Cancellation permission is proposed as `execution.cancel`.
- Persist each attempt, dispatch/report evidence and verification separately
  from TASK-090 evaluation evidence. Never retry an outcome whose side effect
  is uncertain until canonical Agent state has been reconciled.

This proposal is not normative until approved and incorporated into the
workflow, state, data, API, permission, event, retry and TASK-091 contracts.

## Completion

After the execution contract is normative, generate the detailed TASK-091
contract from `CODEX_TASK_TEMPLATE.md`, mark TASK-091 `READY / NOT_STARTED`,
update `CURRENT_TASK.md` and `IMPLEMENTATION_HANDOFF.md`, and stop before
runtime implementation unless explicitly directed to implement TASK-091.
