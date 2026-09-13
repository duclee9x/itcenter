# TASK-090 — Advanced Rules Engine + Policy-Gated Automation

```yaml
task_id: TASK-090
feature_id: F-049
workflow_id: WF-AUT02
phase: P5
priority: P1
status: IN_PROGRESS
readiness: IN_PROGRESS
implementation_status: IN_PROGRESS
owner_domain: Automation / Control Plane
depends_on: TASK-039, TASK-061, TASK-076, TASK-090-R1
```

## 1. Objective

Implement versioned, event-triggered automation rule management, validation,
simulation, deterministic condition evaluation, policy/safety gates and
durable Action Intent creation. TASK-090 records a request for a possible
future action; it never performs the requested business or remediation action.

## Current implementation status

The event-driven Rule and Action Intent vertical slice is implemented. The
normative Action Policy and System Automation Principal contract is defined by
[`TASK-090-R1`](TASK-090-R1_AUTOMATION_ACTION_POLICY_SYSTEM_PRINCIPAL_AUTHORIZATION_CONTRACT.md).
Runtime policy/grant persistence and authorization wiring remain to be
implemented; the worker continues to deny by default until then. TASK-090 is
`IN_PROGRESS`, not complete. Keep TASK-091 blocked until TASK-090 passes its
completion gate.

## 2. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`
- `tasks/CODEX_TASK_REGISTRY.md`
- `tasks/TASK-039_PHASE2_GATE.md`
- `tasks/TASK-061_ADVANCED_SEARCH_PHASE3_INTEGRATION_GATE.md`
- `tasks/TASK-076_IMPLEMENTATION_REPORT.md`

## 3. Domain Boundary

TASK-090 owns rule definition/versioning, validation, publication and
activation/deactivation, simulation, event-trigger matching, condition
evaluation, policy/safety decisions, durable Action Intent creation,
deduplication/conflict detection, conflict human fallback, kill-switch checks,
and evaluation audit/outbox/timeline/observability.

TASK-090 MUST NOT call domain or infrastructure mutation adapters to execute
an Action Intent. It does not perform remediation, business mutations, agent
commands, scripts or webhooks.

TASK-091 owns consumption of eligible intents, action execution, self-healing,
execution retry, verification, timeout, compensation/rollback, execution
concurrency, execution-result state and execution-failure escalation. Before
acting, TASK-091 rechecks READY status, policy allow, required approval,
absence of unresolved conflict and current kill-switch state; it also rechecks
other execution-critical target conditions required by the owning action.

```text
Event → TASK-090 evaluation → policy gate → durable Action Intent
       → TASK-091 execution → verification / compensation
```

## 4. Scope

In scope:

- Event triggers only.
- Rule create, draft update, validation, immutable version publication,
  activation/deactivation and kill-switch enforcement.
- Pure simulation using the same evaluator and policy semantics as production.
- Boolean compound conditions and ordinary comparisons against event and
  explicitly supplied normalized context fields.
- Policy decisions `ALLOW`, `DENY` and `REQUIRE_APPROVAL`.
- Durable, tenant-scoped intent and evaluation evidence with idempotency.
- Semantically identical intent deduplication and incompatible-intent
  conflict handling with one actionable human fallback.
- Outbox events and audit/timeline references for rule decisions and intents.

Out of scope:

- Any action execution or direct domain mutation.
- Self-healing, retry, verification, timeout, rollback or compensation.
- Cron/scheduled, recurring, delayed or absence-of-event triggers.
- Temporal windows, `changed` history predicates, sustained conditions, or
  occurrence-count predicates such as “N events in X minutes”.
- Historical replay or implicit re-evaluation after a rule version changes.
- Any assumption that rule priority resolves action conflicts.

## 5. Rule and Version Semantics

- A rule has tenant-scoped logical identity, owner, purpose, team and review
  date, a lifecycle state, a published-version reference and optionally a
  separate draft version.
- Lifecycle states are `DRAFT`, `ACTIVE`, `INACTIVE` (or equivalent).
- Only an immutable published version may be activated. Editing a published
  definition creates a new draft version; it never changes published bytes.
- A rule can remain active on its existing version while a newer draft is
  prepared. Explicit publication and activation select the new version.
- Evaluation records exact `rule_id` and `rule_version`. A later version,
  deactivation or kill switch never rewrites prior evaluations or intents.
- Only the currently active published version may produce production intents.
- Every rule must have an owner, team, purpose and review date.
- High-risk activation requires an approved request in the same tenant that
  targets the rule and exact published version, has purpose
  `AUTOMATION_RULE_ACTIVATION`, and binds to its immutable content/context. A
  changed version cannot reuse that approval.

## 6. Trigger and Condition Contract

- Trigger type is `EVENT`; matching uses canonical event type and supported
  event attributes. Duplicate delivery is safe.
- Conditions use an explicit JSON expression tree with `AND`, `OR`, `NOT`
  and typed predicates. Supported predicates include `equals`, `not_equals`,
  `contains`, `in`, `not_in`, `exists`, `greater_than`, `greater_than_or_equal`,
  `less_than`, `less_than_or_equal`, and bounded `matches_regex` where the
  implementation can enforce safe evaluation limits.
- Numeric comparisons support ordinary threshold rules against current event
  or supplied normalized context values. These are not temporal windows.
- Time-window, historical-change, sustained-duration and occurrence-count
  predicates are rejected as unsupported for TASK-090.
- Rule paths resolve only against the canonical event payload and explicitly
  supplied normalized context; rule definitions cannot issue arbitrary SQL,
  network calls or unbounded context lookups.
- TASK-090 rule-evaluation and Action-Intent events are not eligible input
  triggers for TASK-090 itself; this prevents unbounded self-trigger loops.
  Any future opt-in to automation-control events requires an explicit
  recursion/cycle policy.
- Missing or invalid referenced context is an evaluation-integrity failure:
  do not treat it as a successful match; preserve evidence and create an
  actionable human fallback where operator action is required.
- Store condition-level results and safe references/hashes, not unnecessary
  raw or sensitive event payloads.

## 7. Simulation

Simulation accepts a rule version (including a draft) and a supplied event
fixture/context. It runs the same matching, condition and policy evaluators
where practical and returns match outcome, condition results, policy decision,
proposed normalized intents, and deduplication/conflict assessment.

Simulation is diagnostic only: it MUST NOT create an executable Action Intent,
call an action adapter, mutate a target domain, or publish production intent
events. Any retained evidence is marked `SIMULATION` and cannot be consumed by
TASK-091 as executable work.

## 8. Policy Gate and Kill Switch

Every proposed action receives an explicit policy result:

- `ALLOW`: may become `READY` only if authorization, deduplication, conflict,
  target and kill-switch checks pass.
- `DENY`: becomes non-executable `BLOCKED`, with a canonical reason.
- `REQUIRE_APPROVAL`: remains non-executable until a linked, same-tenant,
  correctly scoped approval with purpose `AUTOMATION_ACTION_INTENT` for the
  immutable intent context is `APPROVED`.

Approval decisions remain owned by the Approval Engine. A missing required
approval, stale context hash, or non-approved request keeps the intent
non-executable. TASK-090 does not invent an approval policy or grant action
permission through a rule. Action permission is evaluated against the
explicitly authorized Automation Principal and tenant/resource scope. An
unknown action classification or unsupported action type is denied and sent
to human fallback rather than made executable.

The global/category/rule kill switch overrides an otherwise allowed result.
Evaluation evidence is retained, but the intent is `BLOCKED` and cannot be
consumed as executable work. TASK-091 independently rechecks kill switches
immediately before action execution.

Existing safety levels remain `SAFE`, `LOW_RISK`, `CONTROLLED`, `HIGH_RISK`
and `PROHIBITED_AUTO`. Existing policy determines their decision; TASK-090
does not infer missing per-action policy. `PROHIBITED_AUTO` cannot become an
executable intent. High-risk rule activation follows the existing approval
requirement. A matched rule alone never authorizes an action.

The more specific deny-by-default Action Capability, tenant Action Policy and
`SYSTEM_AUTOMATION` principal authorization contract is defined by
[`TASK-090-R1`](TASK-090-R1_AUTOMATION_ACTION_POLICY_SYSTEM_PRINCIPAL_AUTHORIZATION_CONTRACT.md)
and the normative workflow section. It governs READY eligibility: supported
catalog entry, applicable active tenant policy, policy constraints, canonical
scoped AuthorizationPort grant, kill switch, conflict and required approval
must all pass. Missing policy defaults to DENY. Do not wire a default ALLOW or
wildcard principal grant. Preserve policy/capability versions,
principal/permission/scope and decisions in evidence. TASK-091 rechecks current
policy and authorization immediately before execution.

## 9. Action Intent, Deduplication and Conflict

An Action Intent is a durable request, not proof that an action occurred. It
stores tenant, source event, target, action type, normalized parameters or
protected references, rule/version contributors, condition-evaluation
evidence, policy result, approval reference/context hash, deduplication and
conflict identity, creation time, correlation reference and status.

TASK-090 may set intents to `READY`, `BLOCKED`, `CONFLICTED`, or an equivalent
non-executable pending-approval state. TASK-091 owns all execution-result
transitions after it claims an eligible intent. It must not consume simulation,
blocked, conflicted or stale intents.

Idempotency identity includes tenant + canonical source event identity + rule
id + immutable rule version for evaluation. Redelivery cannot create another
effective outcome.
Semantically identical normalized actions for the same target and decision
context are one canonical intent; all contributing rule/version/evaluation
references remain queryable. Policy aggregation is conservative: `DENY` takes
precedence over `REQUIRE_APPROVAL`, which takes precedence over `ALLOW`.

Same-target intents are not automatically conflicts. Conflict is assessed
within a deterministic decision scope including tenant, target resource,
action domain, declared exclusivity group and relevant event/decision context.
The action descriptor supplies its exclusivity group and desired-state
semantics. Compatible actions coexist; identical actions deduplicate. Missing
conflict semantics for a mutating action is unsupported and cannot become
READY.

When different intents in the same scope are mutually incompatible:

- no rule wins automatically, regardless of priority;
- every affected intent is marked non-executable `CONFLICTED`/`BLOCKED`;
- one idempotently keyed actionable human fallback is created for the
  conflict;
- all target, action, rule/version, event and correlation references are
  preserved;
- TASK-091 must refuse those intents until explicit resolution.

For one source event/decision context, evaluate all matching active rule
versions and stage their normalized candidate intents before any candidate
becomes READY. Deduplicate and detect conflicts across that complete candidate
set in the same durable decision transaction. Concurrent producers for the
same conflict scope serialize on the durable conflict identity; no candidate
from an unresolved conflict may be visible to TASK-091 as READY.

Resolution is an explicit authorized command, never an automatic consequence
of changing rule priority or closing a Work Item. The resolver records a
reason and selects the compatible intent set to retain. It may promote a
selected intent only after rechecking policy, approval, target scope and kill
switch; DENY cannot be overridden. Unselected intents remain blocked with
resolution evidence. Resolving the Work Item alone does not resolve the
canonical conflict.

## 10. Commands, API and Authorization

Commands:

```text
AUTOMATION.RULE.CREATE
AUTOMATION.RULE.UPDATE_DRAFT
AUTOMATION.RULE.PUBLISH_VERSION
AUTOMATION.ACTIVATE
AUTOMATION.DEACTIVATE
AUTOMATION.SIMULATE
AUTOMATION.EVENT.EVALUATE  # internal event-consumer command
AUTOMATION.INTENT.RECHECK_APPROVAL  # internal Approval Engine event consumer
AUTOMATION.INTENT.RESOLVE_CONFLICT  # explicit authorized human resolution
```

Expected API shape, adapted to repository route conventions:

```text
GET  /api/v1/automation-rules
POST /api/v1/automation-rules
POST /api/v1/automation-rules/{id}/commands/update-draft
POST /api/v1/automation-rules/{id}/commands/publish
POST /api/v1/automation-rules/{id}/commands/activate
POST /api/v1/automation-rules/{id}/commands/deactivate
POST /api/v1/automation-rules/{id}/commands/simulate
GET  /api/v1/action-intents/{id}
POST /api/v1/automation-conflicts/{id}/commands/resolve
```

Create/update payloads contain rule name/code, owner/team, purpose, review
date, event trigger, condition expression, typed action descriptors, safety
classification and approval requirement. Update/publish/activate/deactivate
carry `expected_version`; activation includes the linked approval reference
when required. Simulation carries the selected draft/published version and
supplied event fixture/context and returns diagnostic results only. Internal
event evaluation uses the canonical event envelope and immutable active rule
version; it is not a public arbitrary-action execution endpoint.

State-changing commands use tenant/resource scope, expected version,
idempotency, audit and correlation identifiers. The existing rule-management
permissions apply: `automation.rule.create`, `automation.rule.edit`,
`automation.simulate`, `automation.activate_low_risk`,
`automation.activate_high_risk`, `automation.disable`. High-risk activation
requires the same-tenant, published-version-bound approval. Reading intents
requires `automation.intent.read`; explicit human conflict resolution
requires `automation.intent.resolve`, reason, expected version and
idempotency. The resolver explicitly selects the compatible intent set to
retain; it cannot override policy DENY, kill switch, stale approval or
action-domain authorization. Action-domain permissions are checked for the
Automation Principal; no rule bypasses RBAC or resource scope.

On an Approval Engine decision event, internal
`AUTOMATION.INTENT.RECHECK_APPROVAL` revalidates tenant, target, approval
purpose `AUTOMATION_ACTION_INTENT`, immutable intent/context hash and current kill-switch/conflict state.
An approved valid request may promote the intent to READY. Rejected, expired,
cancelled, stale or mismatched requests remain non-executable and are audited.

## 11. Persistence and Event Contract

Persist immutable rule versions, evaluations, Action Intents, contributor
references and durable deduplication/conflict identities in the Automation
domain. Durable constraints, not only application prechecks, protect:

- one effective evaluation per tenant + event + rule id + rule version;
- one canonical identical intent per event/decision context;
- one conflict fallback item per conflict identity;
- one durable open conflict per conflict scope/decision context;
- published-version immutability and tenant-scoped rule identity.

For a command Idempotency-Key, same key + same semantic request returns the
original result without duplicate versions, evaluations, intents, fallback or
outbox events; same key + changed request returns
`IDEMPOTENCY_KEY_CONFLICT`.

The rule/evaluation/intent state change, required audit reference and outbox
events commit atomically in the Automation-owned transaction. Do not call
approval, Work Queue, notification, or target-domain remote adapters while
holding that transaction; use existing application commands/events or durable
references.

Events describe decisions and intents only:

```text
AUTOMATION.RULE_CREATED
AUTOMATION.RULE_VERSION_PUBLISHED
AUTOMATION.RULE_ACTIVATED
AUTOMATION.RULE_DEACTIVATED
AUTOMATION.RULE_EVALUATED
AUTOMATION.INTENT_CREATED
AUTOMATION.INTENT_READY
AUTOMATION.INTENT_DEDUPLICATED
AUTOMATION.INTENT_BLOCKED
AUTOMATION.INTENT_CONFLICTED
AUTOMATION.INTENT_CONFLICT_RESOLVED
```

Payloads carry tenant-safe entity references, event id, rule/version,
evaluation/intent ids, decision, safe reason codes, conflict/dedupe reference
and correlation metadata. Do not embed raw sensitive event payloads or
secrets. Actual action-started/succeeded/failed/retry/rollback/completion
events belong to TASK-091.

## 12. Audit, Timeline, Work Queue and Observability

Audit rule definition changes, publication, activation/deactivation,
simulation classification, production evaluation, policy decision, kill-switch
block, intent creation/deduplication/conflict and human fallback. Preserve
actor/service principal, tenant, rule/version, event reference, decision,
safe condition evidence, before/after, reason codes and correlation id.
Audit is append-only.

Timeline is operator-facing derived history and records rule activation and
material evaluation/intent milestones by reference; it is not the audit
source. Do not create a Work Item for normal successful matching. Create one
actionable Automation conflict/review Work Item for unresolved conflict,
missing required approval/policy, unsupported action/target or evaluation
integrity failure requiring a person. Work Queue remains a projection and
never becomes canonical intent state.

Measure evaluations, match/no-match counts, policy decisions, deduplications,
conflicts, kill-switch blocks, fallback creation, processing latency and
idempotency hits using bounded labels; never use raw event/target data as
metric labels.

## 13. Concurrency and Failure Requirements

- Rule edits use expected version; concurrent draft update/publication or
  activation/deactivation cannot mutate a published version or activate a
  stale proposal.
- Event-consumer inbox/durable uniqueness serializes duplicate deliveries.
- Concurrent identical intent insertions converge to one canonical intent
  with all contributors preserved.
- Concurrent incompatible intent creation serializes conflict marking and
  single fallback creation; no affected intent remains executable.
- All rule candidates from one event/decision context are conflict-checked
  before any of them can become READY.
- Kill-switch changes racing with intent promotion must serialize so an intent
  cannot become READY based on stale enabled state.
- Approval state/context must be rechecked before an intent becomes READY;
  changed intent parameters invalidate the prior approval binding.
- Approval decision delivery and explicit conflict resolution are idempotent;
  neither may bypass policy, kill-switch, target-scope or version checks.
- Fail closed on untrusted/malformed event, unsupported action, invalid
  context, authorization denial or policy evaluation error; preserve bounded
  diagnostic evidence and create human fallback when operator action is
  needed.
- Event replay is out of scope. If later added, it must be explicit and
  idempotent and cannot silently create duplicate actionable intents.

## 14. Canonical Errors

Canonical errors include `AUTOMATION_RULE_INVALID`,
`AUTOMATION_RULE_VERSION_CONFLICT`, `AUTOMATION_POLICY_DENIED`,
`AUTOMATION_ACTION_UNSUPPORTED`, `ACTION_INTENT_CONFLICT`,
`APPROVAL_CONTEXT_STALE`, `VERSION_CONFLICT`,
`IDEMPOTENCY_KEY_CONFLICT`, `PERMISSION_DENIED` and `NOT_FOUND`.

## 15. Required Tests

- Create and validate a draft rule; update it with expected-version checks.
- Publish a version; prove published version is immutable.
- Edit a published rule and prove a new version is created.
- Activate/deactivate only a published version; preserve the exact version in
  evaluation evidence.
- Inactive rules do not create production intents.
- Matching and non-matching event paths, compound predicates, numeric
  thresholds, string and set-membership predicates.
- Reject temporal/windowed predicates and unsafe/unbounded expressions.
- Simulation evaluates a draft with production semantics but creates no
  executable intent, outbox intent event or target mutation.
- `ALLOW` can create READY only after all guards; `DENY` stays blocked;
  `REQUIRE_APPROVAL` remains non-executable until a correctly bound approval
  is approved; stale approval is rejected.
- A valid approved decision can promote the bound intent only after all gates
  are rechecked; a stale/rejected approval never promotes it.
- Kill switch prevents executable intent and records why; TASK-091 eligibility
  gate sees the block.
- Duplicate event delivery produces one effective evaluation/intent.
- Identical intents deduplicate and preserve all rule contributors.
- Compatible same-target actions coexist.
- Incompatible same-scope actions conflict, create exactly one fallback, and
  are not selected by rule priority.
- A conflicting candidate batch never exposes an early READY intent before
  all matching rules for that decision context are evaluated.
- Explicit authorized conflict resolution records the human selection and
  reason; it promotes only eligible selected intents and cannot override DENY.
- Invalid target, unsupported action, policy failure and evaluation failure
  produce safe blocked evidence and actionable fallback where required.
- No action/remediation/domain mutation adapter is called by TASK-090.
- Audit/outbox/timeline references and tenant isolation are verified.
- Concurrent duplicate/conflict/kill-switch races preserve DB invariants.

## 16. Acceptance Criteria

1. The rules engine processes event triggers only and evaluates conditions
   deterministically against allowed current context.
2. Published versions and historical evaluation/intent evidence are immutable.
3. Simulation has no executable side effects.
4. Every proposed action receives an explicit policy decision; only a valid
   `ALLOW` result with all current guards satisfied becomes READY.
5. Approval, kill switch, permission, target and conflict guards cannot be
   bypassed by rule configuration or event redelivery.
6. Identical actions deduplicate with contributor evidence; incompatible
   actions block with one actionable human fallback and no automatic winner.
7. No action executes in TASK-090; only TASK-091 can advance eligible intents
   into execution.
8. Tenant isolation, audit, outbox, idempotency, concurrency and required
   observability checks pass.
9. Applicable tests, migration checks, typecheck, lint and formatting pass.

## 17. Verification and Status

Implementation verification commands are the repository scripts: `npm test`,
`npm run typecheck`, `npm run lint`, `npm run format:check`, and
`git diff --check`, plus PostgreSQL integration tests for durable uniqueness
and concurrency. This file completes planning only. Runtime implementation
has not started.
