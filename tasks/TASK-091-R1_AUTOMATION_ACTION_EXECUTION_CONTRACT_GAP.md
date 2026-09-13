# TASK-091-R1 — Automation Action Execution + Verification Contract

**Status:** `CODE_COMPLETE` — normative/specification remediation only.

## Objective and scope

Resolve the TASK-091 execution `SPEC_GAP` before runtime implementation.
This remediation defines the first-version execution contract for the
existing Automation capability catalog. It does not implement runtime
TASK-091 and does not change TASK-090 code or behavior.

## Normative decision

TASK-091 v1 supports only `RESTART_AGENT` for a canonically registered Agent.
The executor maps the typed capability to one fixed allow-listed Agent
protocol operation; arbitrary shell, script, binary, process, URL or action
payload execution is forbidden.

TASK-091 consumes only canonically `READY` Action Intents. Immediately before
dispatch it rechecks intent readiness, capability, current tenant Action
Policy, tenant-bound `SYSTEM_AUTOMATION` permission and resource scope,
required approval, unresolved conflict/cancellation, kill switch, and
canonical Agent identity/tenant/resource scope. Any failed, unavailable,
stale or ambiguous check prevents dispatch and stores explicit reason
evidence. `READY` is not a permanent authorization token.

Execution is recorded in a distinct Action Execution aggregate; Action Intent
remains the decision/request record. Each execution has immutable
`execution_id` and `command_id` and references intent, tenant, target Agent,
action, correlation and issue time. Dispatch uses an authenticated enrolled
Agent channel; tenant and Agent identity are derived from the authenticated
principal. The Agent durably deduplicates the same command ID/content.
Dispatch, authenticated acceptance and successful verification are separate
facts. An ACK is not success.

Before dispatch, persist an immutable baseline including Agent/session,
`agent_runtime_id` or equivalent restart generation, last heartbeat,
canonical target context and policy/authorization evidence. The Agent
publishes authenticated `agent_runtime_id`, unique to its process/service
runtime and changed by restart but not ordinary reconnect. Success requires
a same-tenant/same-Agent authenticated heartbeat/reconnect after acceptance
with a new runtime marker relative to the baseline, observed within five
minutes from authoritative Agent acceptance. A generic heartbeat or wall
clock timestamp alone does not prove restart.

The execution lifecycle is `PENDING → CLAIMED → DISPATCHED → ACCEPTED →
VERIFYING`, with terminal outcomes `SUCCEEDED`, `FAILED`, `UNKNOWN` or
`CANCELLED`. Verification timeout, lost acknowledgement, ambiguous delivery
or incomplete evidence becomes `UNKNOWN`, not `FAILED`. The automatic
attempt count is one and automatic business retries are zero. Transport
redelivery reuses the same command ID and is not a second business attempt.
`RESTART_AGENT` has no automatic compensation. Restart success does not
assert global Agent health or resolve/close an Incident.

Cancellation is allowed only when durable evidence proves the Agent has not
accepted the command. After acceptance, cancellation is forbidden. Ambiguous
delivery is not safely cancellable and becomes `UNKNOWN`. Manual retry
requires explicit operator reconciliation that the prior attempt did not
successfully restart the Agent. It creates new execution/command IDs linked
to the prior execution and repeats all current security checks. Preserve all
prior execution evidence.

An atomic execution claim/lease prevents multiple workers from dispatching
the same automatic attempt. Worker crash before durable dispatch may resume
from durable state; after dispatch, recovery reconciles the same command and
must never blindly dispatch again. Unknown results create one actionable
Work Queue fallback. Audit is append-only; events publish after commit and
carry references/minimal data without Agent secrets.

## Normative documents updated

- `docs/APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`
- `docs/HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `tasks/TASK-091_CONTROLLED_SELF_HEALING_COMPENSATION.md`
- `tasks/CODEX_TASK_REGISTRY.md`
- `CURRENT_TASK.md`
- `IMPLEMENTATION_HANDOFF.md`

The older generic Agent example of 60-second timeout/two retries is explicitly
non-authoritative for TASK-091 v1. The action-specific five-minute,
zero-automatic-retry contract does not establish a global automation retry or
timeout policy.

## Verification and governance

Cross-document reconciliation confirms the command/state/evidence/permission
semantics are aligned. Markdown Prettier and `git diff --check` pass. Runtime
tests and migrations are not applicable because this remediation changes no
runtime code or database schema.

TASK-091 detailed implementation contract is generated from
`CODEX_TASK_TEMPLATE.md`, readiness is reconciled to `READY / NOT_STARTED`,
and runtime implementation remains unstarted. Stop at this planning/spec
boundary; TASK-091 requires a later explicit implementation instruction.
