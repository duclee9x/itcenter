# TASK-091 — Controlled Self-Healing + Compensation (v1)

```yaml
task_id: TASK-091
feature_id: F-049
workflow_id: WF-AUT02
phase: P5
priority: P1
status: CODE_COMPLETE
readiness: READY
implementation_status: CODE_COMPLETE
owner_domain: Automation / Agent
depends_on: TASK-031, TASK-053, TASK-090, TASK-091-R1
```

## 1. Objective

Implement the TASK-091 execution boundary for the single reviewed v1 action
`RESTART_AGENT`: consume eligible Action Intents, recheck current security
controls, issue one authenticated/idempotent Agent command, verify the
result, preserve execution history and escalate uncertain/failing outcomes.

This task does not change TASK-090 rule evaluation or Action Intent policy
evidence. It does not close Incidents based on Agent restart success.

## 2. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`
- `docs/HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`
- `tasks/TASK-090_ADVANCED_RULES_ENGINE_POLICY_GATED_AUTOMATION.md`
- `tasks/TASK-090-R1_AUTOMATION_ACTION_POLICY_SYSTEM_PRINCIPAL_AUTHORIZATION_CONTRACT.md`
- `tasks/TASK-090_IMPLEMENTATION_REPORT.md`
- `tasks/TASK-091-R1_AUTOMATION_ACTION_EXECUTION_CONTRACT_GAP.md`
- `tasks/CODEX_TASK_REGISTRY.md`

## 3. Domain Boundary

TASK-090 owns Rule evaluation and the durable Action Intent decision/request.
TASK-091 owns a separate Action Execution aggregate, Agent command dispatch,
verification, execution outcomes and human fallback. Do not rewrite or
overload Action Intent decision evidence with transport/execution states.

TASK-091 v1 MUST support only the registered `RESTART_AGENT` action for a
canonically registered `AGENT`. It MUST NOT add another action or expose
arbitrary shell, scripts, binaries, process commands, URLs or caller-supplied
command payloads. A typed capability maps to one fixed allow-listed Agent
protocol operation.

## 4. In Scope

- Separate durable Action Execution/attempt history and atomic worker claim.
- All execution-time policy/authorization/approval/conflict/kill-switch/
  target rechecks.
- Authenticated enrolled-Agent claim, acceptance and report protocol for
  `RESTART_AGENT` only.
- Stable execution and command identity plus Agent-side durable deduplication.
- Immutable pre-execution Agent runtime baseline and positive restart
  verification.
- `SUCCEEDED`, `FAILED`, `UNKNOWN` outcomes, safe pre-acceptance cancellation,
  explicit reconciled manual retry, audit/outbox/timeline and Work Queue.
- Agent `agent_runtime_id` evidence in authenticated heartbeat/command
  messages, owned by the Agent domain.

## 5. Out of Scope

- Any action other than `RESTART_AGENT`.
- Arbitrary command/script execution, shell access, URLs, binaries or
  unrestricted process control.
- Automatic business retry, backoff, rollback or compensation.
- Claiming that Agent restart proves Agent health, resolves an Incident or
  fixes root cause.
- Automatically closing or mutating Incidents.
- Changes to TASK-090 Rule/policy authoring or Action Intent evaluation.

## 6. Existing Repository Context

- TASK-090 persists canonical `READY` Action Intents, the allow-listed
  `RESTART_AGENT` capability and tenant Action Policy/System Automation
  authorization evidence.
- Existing Agent Gateway defines authenticated enrolled-Agent identity as a
  precondition and handles heartbeat/inventory plus typed claim/report
  workflows. It does not normatively choose the production credential,
  enrollment trust, credential lifecycle or channel/replay profile; those
  security decisions are tracked by RELEASE-002-R1. The runtime remains
  fail-closed until RELEASE-002 implements an approved profile.
- No TASK-091 execution aggregate, restart command protocol, runtime marker
  or restart verification implementation exists before this task.
- PostgreSQL migrations are owned by Automation for execution history and by
  Agent for command inbox/runtime marker data.

## 7. Normative Rules and State Transition

Action Execution lifecycle:

```text
PENDING → CLAIMED → DISPATCHED → ACCEPTED → VERIFYING → SUCCEEDED
           │            │           │             ├→ FAILED
           │            │           │             └→ UNKNOWN
           │            ├→ FAILED   └→ UNKNOWN
           ├→ FAILED
           └→ CANCELLED (only when non-acceptance is proven)
```

`DISPATCHED` persists `acceptance_deadline_at = dispatched_at + 30 seconds`
for `RESTART_AGENT` v1. An exact authenticated Agent acknowledgement with
`accepted_at < acceptance_deadline_at` transitions to `ACCEPTED`; only then
does the independent five-minute verification deadline begin. If the row is
still `DISPATCHED` when the acceptance deadline is due, it transitions to
`UNKNOWN` with `AGENT_ACCEPTANCE_TIMEOUT`. This 30-second value is specific
to this capability/version and is not a global automation timeout.

If timeout wins the serialized race, late acceptance or a later new-runtime
heartbeat is stored as append-only reconciliation evidence. Neither evidence
may transition `UNKNOWN` back to `ACCEPTED`, `VERIFYING` or `SUCCEEDED`.
Create/update the existing actionable Work Item with execution, intent,
Agent, command, dispatch/deadline, reason and latest non-secret Agent/session
evidence for human reconciliation.

Terminal states are `SUCCEEDED`, `FAILED`, `UNKNOWN`, `CANCELLED`. A
pre-dispatch security failure becomes `FAILED` with reason evidence and no
dispatch. If delivery/acceptance is ambiguous, cancellation is forbidden and
the outcome is `UNKNOWN`. Cancellation after Agent acceptance is forbidden.

One Action Intent may retain multiple linked execution attempts over time.
TASK-091 creates at most one automatic attempt (`attempt_number=1`); manual
retry creates a new row with the next attempt number, new `execution_id` and
`command_id`, references its predecessor and preserves all prior evidence.
The Action Intent remains the decision/request record; its lifecycle is not
changed to mirror transport progress.

## 8. Preconditions and Security Rechecks

Only a canonically `READY` intent can be claimed. Immediately before
dispatch, recheck all of:

- intent remains `READY`;
- capability supports automatic `RESTART_AGENT` execution;
- tenant Action Policy currently allows it;
- tenant-bound `SYSTEM_AUTOMATION` principal currently has `agent.restart`
  for the canonical target/resource scope;
- linked required approval remains valid and context-bound;
- no unresolved conflict, cancellation or superseding attempt exists;
- kill switch permits execution; and
- target Agent resolves in the same tenant/resource scope as the intent.

Any false, unavailable, stale or ambiguous check prevents dispatch and
persists explicit failure/block reason evidence. Do not execute as Rule
author, current human, administrator or wildcard principal. Never trust
tenant/Agent identity from Rule parameters.

## 9. Authorization

```yaml
execution_read_permission: automation.intent.read
manual_retry_permission: execution.retry
manual_cancel_permission: execution.cancel
target_action_permission: agent.restart # rechecked for SYSTEM_AUTOMATION
resource_scope: same tenant and canonical Agent/resource scope
approval_required: only when current Action Policy/capability requires it
```

Manual retry also requires actor/reason and explicit reconciliation evidence
that the prior attempt did not successfully restart the Agent. Manual cancel
is allowed only before authenticated Agent acceptance is proven. Neither
permission bypasses policy, target permission/scope, approval, conflict or
kill switch.

## 10. Database / Data Model

Automation owns `action_executions` containing at minimum:

- tenant, execution ID, Action Intent ID, rule/version reference and
  `attempt_number` / `attempt_kind`;
- prior execution reference for manual retries;
- stable command ID, typed action and canonical target Agent;
- execution state, claim owner/lease, entity version and idempotency key;
- preflight policy/authorization/approval/conflict/kill-switch evidence;
- immutable pre-execution baseline and fixed command snapshot;
- dispatch, acceptance, verification-deadline and completion timestamps;
- immutable `acceptance_deadline_at = dispatched_at + 30 seconds`;
- append-only late acceptance/runtime reconciliation evidence;
- verification/result evidence, canonical reason code and Work Item reference;
- actor/reason and correlation identifiers for manual operations.

Agent owns a durable command inbox/receipt keyed by
`tenant_id + agent_id + command_id`, including command content hash, receipt
state, authenticated acceptance and redacted result. Agent heartbeat and
command evidence include `agent_runtime_id`, unique per Agent process/service
runtime, changed by restart but not ordinary network reconnect.

Durable invariants: one automatic execution per tenant/intent; unique command
ID per tenant; unique attempt number per intent; same command ID/content is
deduplicated; same command ID with changed content conflicts; only one active
worker claim per execution; one fallback Work Item per terminal execution
identity. A lease expiring after dispatch MUST NOT enable redispatch.

## 11. API

Operator API:

```text
GET  /api/v1/automation/action-executions/{execution_id}
POST /api/v1/automation/action-executions/{execution_id}/commands/cancel
POST /api/v1/automation/action-executions/{execution_id}/commands/retry
```

Agent API (authenticated enrolled-Agent principal derives tenant and Agent):

```text
POST /api/v1/agent/automation-actions/claim
POST /api/v1/agent/automation-actions/{command_id}/commands/accept
POST /api/v1/agent/automation-actions/{command_id}/commands/report
```

Agent protocol only accepts the fixed typed `RESTART_AGENT` operation and
has no arbitrary command body.

## 12. Commands

```yaml
AUTOMATION.EXECUTION.CLAIM:
  internal_worker_command
  eligible: intent READY; unique automatic attempt absent

AUTOMATION.CANCEL_ACTION:
  permission: execution.cancel
  requires: expected_version, idempotency_key, reason
  allowed: proven not accepted by Agent

AUTOMATION.RETRY_ACTION:
  permission: execution.retry
  requires: expected_version, idempotency_key, reason, reconciliation_evidence
  effect: new linked execution and command IDs; fresh security rechecks

AGENT.AUTOMATION_ACTION.CLAIM:
  principal: authenticated enrolled Agent
  action_allowlist: [RESTART_AGENT]

AGENT.AUTOMATION_ACTION.ACCEPT:
  requires: exact command_id and authenticated matching Agent/tenant

AGENT.AUTOMATION_ACTION.REPORT:
  requires: exact command_id and authenticated matching Agent/tenant
```

## 13. Events Produced / Consumed

Produce after owning transaction commit:

```text
AUTOMATION.EXECUTION_CREATED
AUTOMATION.EXECUTION_CLAIMED
AUTOMATION.ACTION_DISPATCHED
AUTOMATION.ACTION_ACCEPTED
AUTOMATION.ACTION_VERIFYING
AUTOMATION.ACTION_SUCCEEDED
AUTOMATION.ACTION_FAILED
AUTOMATION.ACTION_UNKNOWN
AUTOMATION.ACTION_CANCELLED
AUTOMATION.ACTION_RECONCILIATION_EVIDENCE_RECORDED
```

Consume `AUTOMATION.INTENT_READY` and canonical authenticated Agent
acceptance/result/`AGENT.ONLINE` heartbeat evidence. Consumers are idempotent
and preserve correlation/causation. Agent event payloads carry references and
runtime identity only; never credentials or secrets.

## 14. Idempotency

- Automatic attempt identity is unique per tenant + intent.
- `execution_id` and `command_id` are immutable and unique.
- Same `command_id` and same command hash returns prior Agent receipt without
  restarting again; changed content conflicts.
- Broker/worker redelivery never creates another automatic execution.
- Same operator key/request returns original cancel/retry result; changed
  request returns `IDEMPOTENCY_KEY_CONFLICT`.
- Manual retry has a new key, execution ID and command ID and links the prior
  attempt.

## 15. Concurrency

- Competing workers atomically claim at most one execution.
- Worker claim/recovery cannot create a second automatic attempt.
- Policy/grant/approval/kill-switch/target changes before dispatch are
  serialized/rechecked at the dispatch decision boundary; failed evidence
  prevents command outbox creation.
- Cancellation races with command dispatch/Agent acceptance: cancel only
  wins if the system proves the command was not accepted; ambiguity becomes
  UNKNOWN.
- Duplicate command delivery/reports are serialized by the Agent inbox and
  command ID.
- Worker crash after dispatch never blindly redispatches; reconcile the same
  command, otherwise UNKNOWN.
- Verification heartbeat vs deadline transition is serialized so only the
  canonical result wins.

## 16. Transaction Boundary

Atomically persist the Action Execution state transition, immutable evidence,
required audit reference and outbox fact for each local transition. Persist
the fixed Agent command/outbox before external delivery. Do not hold a
database transaction open across Agent network calls. Agent inbox receipt and
restart acceptance are committed in Agent-owned processing.

## 17. Async Side Effects

- Authenticated Agent pull/claim and exact-command accept/report.
- Consume post-acceptance Agent heartbeat/runtime marker for verification.
- Create/reuse one actionable Work Item for UNKNOWN or intervention-required
  failure.
- Append timeline projection from execution events.

No Incident state is changed or closed by restart success.

## 18. Audit Requirements

Append-only evidence preserves intent, rule/version, execution/command IDs,
capability, target, Automation principal, policy version/decision,
permission/scope result, approval, kill-switch/conflict decisions, claim,
dispatch/acceptance, pre-execution baseline, verification, terminal result,
reason, actor, correlation and Work Item reference. Redact Agent secrets.

## 19. Timeline Requirements

Show operator-friendly dispatched, accepted, verified restart, deterministic
failure, unknown/reconciliation, pre-acceptance cancellation and manual retry
entries. Acceptance alone must never render as success. Timeline is derived,
not execution truth.

## 20. Notification Requirements

No notification is required for normal successful restart. Use existing
Work Queue/notification policy for `UNKNOWN` and actionable failure; do not
notify on every transport transition.

## 21. Search / Projection Impact

No search index change. Execution read views and timeline are scoped by
tenant/resource and reference the canonical Action Execution.

## 22. Error Codes

At minimum map:

```text
AUTOMATION_INTENT_NOT_READY
AUTOMATION_ACTION_UNSUPPORTED
AUTOMATION_POLICY_DENIED
AUTOMATION_AUTHORIZATION_DENIED
AUTOMATION_TARGET_SCOPE_DENIED
AUTOMATION_APPROVAL_STALE
AUTOMATION_CONFLICT_OPEN
AUTOMATION_KILL_SWITCH_ACTIVE
AUTOMATION_EXECUTION_ALREADY_CLAIMED
AUTOMATION_EXECUTION_OUTCOME_UNKNOWN
AUTOMATION_ACTION_CANCEL_FORBIDDEN
AUTOMATION_RECONCILIATION_REQUIRED
AGENT_COMMAND_ID_CONFLICT
AGENT_COMMAND_REJECTED
VERSION_CONFLICT
IDEMPOTENCY_KEY_CONFLICT
PERMISSION_DENIED
```

## 23. Retry / Compensation

For `RESTART_AGENT` v1: one automatic attempt, zero automatic business
retries, no backoff, no compensation. Transport redelivery reuses the same
command ID and is Agent-deduplicated. A separate 30-second acceptance
deadline begins at durable dispatch; no authenticated acceptance by that
deadline becomes `UNKNOWN` with `AGENT_ACCEPTANCE_TIMEOUT`, without creating
another command. Only authenticated acceptance starts the independent
five-minute verification deadline. Late acceptance/runtime evidence remains
append-only and does not resurrect `UNKNOWN`. Each `UNKNOWN` outcome creates
one human fallback. Manual retry requires explicit reconciliation and
creates a new linked attempt; it repeats all security checks.

## 24. Observability

Record structured execution/command/intent IDs, tenant, target reference,
correlation, attempt, state transition, policy/security decision codes,
dispatch/acceptance/verification latency, result and Work Item reference.
Metrics include claims, dispatches, acceptances, verified restart success,
FAILED/UNKNOWN outcomes, cancellation, manual retry and duplicate delivery.
Never log Agent credentials or arbitrary command payloads.

## 25. Required Tests

### Unit / domain

- only READY intent and registered RESTART_AGENT can execute;
- exact transitions and terminal invariants;
- no arbitrary command fields or unsupported action.

### Repository / concurrency

- one worker claim and no duplicate automatic attempt;
- policy/grant/scope/approval/kill-switch/target rechecks block dispatch;
- unique execution/command identity and durable Agent inbox dedupe;
- worker crash after dispatch does not redispatch;
- cancel/accept race permits cancel only when non-acceptance is proven;
- verification event/deadline race has one terminal outcome;
- acceptance-timeout/Agent-acceptance race has one serialized winner;
- one Work Item per UNKNOWN execution.

### Agent/API/event E2E

- authenticated correct-tenant Agent claims, accepts and reports typed restart;
- wrong Agent/tenant cannot claim, acknowledge or report;
- Agent ACK alone does not succeed;
- old-session heartbeat does not verify; new runtime ID after acceptance
  does verify within five minutes;
- verification timeout and lost ACK become UNKNOWN;
- no acceptance by 30 seconds after dispatch becomes UNKNOWN;
- verification timer starts from `accepted_at`, never from dispatch;
- timeout processing is idempotent and produces one human fallback;
- late acceptance/runtime evidence is retained without state resurrection;
- timeout never creates another command or automatic attempt;
- explicit Agent rejection becomes FAILED;
- command redelivery with same ID never restarts twice; changed payload
  conflicts;
- no automatic retry or compensation;
- cancel before proven acceptance succeeds; after acceptance/ambiguous
  delivery is forbidden;
- reconciled manual retry creates new linked IDs and repeats security checks;
- successful restart does not close or mutate an Incident;
- outbox/audit/timeline contain no Agent secrets and preserve history.

## 26. Completion Criteria

- All security rechecks and tenant/resource boundaries pass.
- Only RESTART_AGENT v1 reaches the fixed authenticated Agent protocol.
- Execution/Agent dedupe, claim, crash recovery and UNKNOWN handling are
  durable and concurrency-safe.
- Restart success requires positive new-runtime evidence within five minutes
  of acceptance.
- No automatic business retry or compensation exists in v1.
- Audit/outbox/events/timeline/Work Queue are integrated and idempotent.
- Full repository test, typecheck, lint/boundary, format, migration and diff
  checks pass.
- Update implementation report, registry/current/handoff and commit TASK-091
  runtime changes separately. Do not begin TASK-092 automatically.
