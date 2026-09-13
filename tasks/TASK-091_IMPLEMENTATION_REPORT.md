# TASK-091 Implementation Report

**Status:** `IN_PROGRESS`. The TASK-091 execution vertical slice is
implemented and its current checks pass. Completion is held on one unresolved
normative detail: when to classify a dispatched command with no authenticated
Agent acceptance as `UNKNOWN`. The five-minute verification window starts
only after acceptance; no pre-acceptance deadline or trigger is defined.
TASK-091 remains open until that behavior is settled and implemented.

## Implemented

- Added a separate Automation `action_executions` aggregate with immutable
  execution identity, command snapshot, attempts, state transitions, preflight
  evidence, verification baseline/result and append-only task audit.
- Automatic execution creation consumes only a tenant-scoped `READY` intent
  for the allow-listed `RESTART_AGENT` capability. The authenticated Agent
  pull route rechecks capability, current tenant policy, scoped
  `SYSTEM_AUTOMATION` authorization, approval, conflict, kill switch, target
  identity and runtime baseline before dispatch.
- Added an Agent-owned durable command receipt keyed by tenant, Agent and
  command ID. Re-delivery returns the same command after verifying its
  content hash. Acceptance and typed rejection are authenticated, scoped and
  emitted as outbox facts. The Agent module owns receipt and runtime-baseline
  reads; Automation owns execution state.
- Added positive restart verification from a later authenticated heartbeat
  with a new `agent_runtime_id`. A normal heartbeat, old runtime marker or
  command acceptance cannot mark execution successful. An accepted execution
  whose five-minute verification period expires becomes `UNKNOWN`.
- Added tenant/resource-authorized execution reads, expected-version and
  idempotent cancellation before dispatch, and reconciled manual retry with
  new execution/command IDs. No automatic retry or compensation is present.
- Added idempotent timeline/audit projection and one `AUTOMATION_EXECUTION`
  Work Queue item for terminal `FAILED`/`UNKNOWN` outcomes.
- Added task-specific Agent/Automation/Operations migrations, API routes,
  worker wiring, permission codes, canonical errors and Agent event contracts.

## API and events

Operator API:

```text
GET  /api/v1/automation/action-executions/{execution_id}
POST /api/v1/automation/action-executions/{execution_id}/commands/cancel
POST /api/v1/automation/action-executions/{execution_id}/commands/retry
```

Authenticated Agent Gateway API:

```text
POST /api/v1/agent/automation-actions/claim
POST /api/v1/agent/automation-actions/{command_id}/commands/accept
POST /api/v1/agent/automation-actions/{command_id}/commands/report
```

Added Agent facts `AGENT.AUTOMATION_ACTION_ACCEPTED` and
`AGENT.AUTOMATION_ACTION_REJECTED`; execution-state events use the existing
TASK-091 `AUTOMATION.*` contract.

## Verification

- `npm test`: passed, 110 tests (36 unit/architecture, 2 contract, 1
  migration, 21 integration, 50 E2E).
- `npm run typecheck`: passed.
- `npm run lint`: passed, including module-boundary checks.
- `npm run format:check`: passed.
- `git diff --check`: passed.
- TASK-091 PostgreSQL E2E: 6 tests pass for authenticated dispatch and
  idempotent redelivery, positive restart evidence, tenant and kill-switch
  denial, grant/scope/policy rechecks, cancellation, `UNKNOWN` verification
  timeout/Work Queue fallback and reconciled manual retry.

## Remaining blocker and deployment constraint

`SPEC_GAP`: TASK-091-R1 requires ambiguous delivery without proven Agent
acceptance to resolve as `UNKNOWN`, but defines no deadline or event that
distinguishes normal waiting from an acceptance acknowledgement that will
never arrive. The five-minute deadline is explicitly anchored to the
authoritative `ACCEPTED` timestamp and cannot be reused before acceptance.
The current implementation therefore safely forbids cancellation after
`DISPATCHED` but cannot autonomously resolve a permanently unacknowledged
dispatch. No timeout has been invented.

The checked-in Agent Gateway entry point is wired to
`unavailableAuthentication`, which remains fail-closed. Deployment must
provide the existing enrolled-Agent `AuthenticationPort` adapter; tests use
an isolated authenticated Agent adapter. No Agent credentials or permissive
fallback were added.

## Governance

TASK-091 remains `IN_PROGRESS`, not `CODE_COMPLETE`. TASK-092 was not started
or reconciled. The pre-existing `AGENTS.md` working-tree change is excluded
from TASK-091 changes and commit.
