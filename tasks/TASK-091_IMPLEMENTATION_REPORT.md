# TASK-091 Implementation Report

**Status:** `CODE_COMPLETE` for the TASK-091 v1 runtime contract. Production
Agent authentication adapter configuration remains an environment capability.

## Implemented

- The Automation domain stores a separate immutable Action Execution attempt
  for `RESTART_AGENT`; the Agent Gateway uses the existing fail-closed
  `AuthenticationPort`, canonical Agent identity and tenant ownership, typed
  command envelope, stable command ID and durable Agent-side delivery receipt.
- Dispatch now persists `acceptance_deadline_at = dispatched_at + 30 seconds`.
  Authenticated acceptance before that deadline moves execution to
  `VERIFYING` and starts the independent five-minute verification deadline
  from `accepted_at`. No acceptance by the first deadline transitions to
  `UNKNOWN / AGENT_ACCEPTANCE_TIMEOUT`; the verification timer does not start.
- Timeout processing is durable and idempotent. The accepted-vs-timeout race
  serializes on the execution row/version. A timeout winner cannot be
  resurrected by late acceptance or a later runtime marker; those facts are
  retained in the append-only reconciliation evidence table and update the
  same actionable Work Item context. A timed-out command is not redispatched.
- Pre-dispatch security rechecks, one automatic attempt, no automatic business
  retry/compensation, safe cancellation, explicit reconciled manual retry,
  audit/outbox/timeline projection and one UNKNOWN/FAILED human fallback
  remain in force.
- Added immutable acceptance-deadline and reconciliation-evidence database
  structures, plus structured Work Queue context for execution reconciliation.

## API and events

The operator API remains:

```text
GET  /api/v1/automation/action-executions/{execution_id}
POST /api/v1/automation/action-executions/{execution_id}/commands/cancel
POST /api/v1/automation/action-executions/{execution_id}/commands/retry
```

The authenticated Agent Gateway remains:

```text
POST /api/v1/agent/automation-actions/claim
POST /api/v1/agent/automation-actions/{command_id}/commands/accept
POST /api/v1/agent/automation-actions/{command_id}/commands/report
```

`AUTOMATION.ACTION_UNKNOWN` now carries dispatch and acceptance-deadline
context. `AUTOMATION.ACTION_RECONCILIATION_EVIDENCE_RECORDED` records late
authenticated acceptance/runtime evidence without changing the terminal
execution. Agent credentials are excluded.

## Verification

- TASK-091 PostgreSQL E2E: 8 tests pass, including 30-second deadline
  persistence, the separate accepted-at verification clock, timeout to
  UNKNOWN, no redispatch, one Work Item, late acceptance/runtime evidence,
  idempotent timeout processing and accepted-vs-timeout serialization.
- Full repository gates: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run format:check`, migration tests and `git diff --check` passed.

## Deployment capability

`apps/agent-gateway/src/main.ts` continues to use
`unavailableAuthentication`, which is deliberately fail-closed. A production
deployment must configure an enrolled-Agent `AuthenticationPort` adapter
compatible with the existing Agent authentication/channel contract. Automated
tests use a controlled authenticated fake; this does not assert that
production credentials or adapter configuration exist.

## Governance

TASK-091 is `CODE_COMPLETE`. TASK-092's declared dependencies TASK-033,
TASK-051 and TASK-090 are all `CODE_COMPLETE`; its derived registry readiness
is reconciled to `READY / NOT_STARTED`. No TASK-092 contract or runtime work
was started. The pre-existing `AGENTS.md` change is excluded from the
TASK-091 commit.
