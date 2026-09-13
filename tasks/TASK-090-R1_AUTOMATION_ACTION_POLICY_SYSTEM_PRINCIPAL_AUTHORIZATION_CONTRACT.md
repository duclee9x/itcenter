# TASK-090-R1 — Automation Action Policy + System Principal Authorization Contract

```yaml
task_id: TASK-090-R1
feature_id: F-049
workflow_id: WF-AUT02
phase: P5
priority: P0
status: CODE_COMPLETE
readiness: SATISFIED
implementation_status: CODE_COMPLETE
owner_domain: Automation / Authorization
depends_on: none
deliverable: normative security/specification remediation only
runtime_implementation: prohibited
```

## 1. Objective

Close the normative security gap in TASK-090 by defining tenant Action Policy,
Action Capability, and explicit System Automation Principal authorization
contracts. Preserve deny-by-default behavior. This remediation changes
specifications and planning records only; it does not implement runtime
policy management, authorization adapters, or TASK-091.

## 2. Required Specifications

- `AGENTS.md`
- `docs/APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `tasks/TASK-090_ADVANCED_RULES_ENGINE_POLICY_GATED_AUTOMATION.md`
- `tasks/TASK-090_IMPLEMENTATION_REPORT.md`
- `tasks/CODEX_TASK_REGISTRY.md`

## 3. Scope and Boundary

This is a normative/specification remediation. It may update the listed
Markdown contracts, the TASK-090 report/status, registry, current task and
handoff. It MUST NOT change runtime code, add migrations, configure a
production ALLOW policy/grant, or implement TASK-091.

TASK-090 owns Rule definition/versioning, event evaluation, condition and
Action Policy evaluation, System Automation Principal resolution and
authorization checks needed to decide READY/BLOCKED, Action Intent persistence,
conflict handling and decision evidence. It never executes the remediation.

```text
Event → Rule/condition evaluation → Action Policy → principal authorization
      → approval/conflict/kill-switch gates → durable Action Intent
      → TASK-091 rechecks eligibility → action execution
```

TASK-091 owns consumption, immediate execution-time eligibility rechecks,
execution, retry, verification, timeout, compensation, execution results and
escalation. A READY intent alone is never sufficient authorization to execute.

## 4. Normative Security Rules

### 4.1 Deny by default and separation of duties

- A Rule match does not grant action authority.
- Rule authoring, editing, publication and activation permissions never
  authorize the Rule's action.
- Never execute with the privileges of the Rule author or an administrator
  impersonation.
- Missing/invalid policy, grant, principal, tenant, target or scope; unsupported
  action; and policy or authorization backend failure all fail closed.
- Fresh tenants have no implicit ALLOW policy. No wildcard, admin, superuser,
  all-tenant or all-resource System Automation grant exists by default.

### 4.2 Action Capability Catalog

Use a canonical allow-listed catalog. Each supported capability declares:

- `action_type` and `target_type`;
- required execution permission/capability;
- safety class: `SAFE_AUTOMATION`, `CONTROLLED`, `HIGH_RISK` or `PROHIBITED`;
- whether automatic execution is supported;
- whether approval is allowed/required;
- conflict/exclusivity group;
- typed, bounded parameter schema;
- supported executor type.

Arbitrary strings, unsupported executors, invalid parameters and missing
conflict semantics cannot become executable. `PROHIBITED` always denies.
`HIGH_RISK` cannot become automatically executable without explicit
applicable policy and every required approval/security control. Rule priority
never affects safety or authorization.

### 4.3 Tenant Action Policy

Action Policy is distinct from capability support and principal
authorization. It is tenant-scoped and versioned, and identifies action and
target types, mode (`DENY`, `ALLOW`, `REQUIRE_APPROVAL`), resource selector,
parameter constraints, approval requirement, active/effective interval,
version, actor, reason and audit reference. No applicable policy means
`DENY`.

Policy selection must be deterministic and unambiguous for tenant, action,
target and effective time. Overlapping equally applicable policies are a
configuration-integrity failure and fail closed; never select the more
permissive policy by accident.

Published/active versions are immutable; change creates a new version.
Historical evaluations retain policy ID/version and decision. A more
permissive later policy never silently promotes an old blocked intent. Any
re-evaluation requires an explicit authorized, idempotent and audited
operation.

### 4.4 System Automation Principal and scoped grants

Resolve an explicit `SYSTEM_AUTOMATION` service principal bound to tenant,
action, target/resource scope and correlation context. It is not a human,
tenantless superuser, administrator impersonation or Rule author. Derive
tenant from canonical event/target context and validate it against the
canonical resource; never trust tenant data solely from Rule parameters.
Cross-tenant automation is denied.

The resolver returns canonical `ActorContext` and fabricates no privilege.
The existing `AuthorizationPort` and canonical grant data determine
permission and resource scope. A grant includes tenant, service identity,
permission/capability, target/resource scope, active/validity and audit
metadata. Permission without matching scope is insufficient. Do not create a
second unrelated scope evaluator.

### 4.5 Evaluation order and READY invariant

Evaluate in this order:

1. Action exists in the supported capability catalog.
2. Applicable tenant Action Policy exists.
3. Policy is active and effective.
4. Target and normalized parameters satisfy policy constraints.
5. The System Automation Principal has the required permission and resource
   scope for the canonical tenant/target.
6. Kill switch permits automation.
7. No unresolved semantic conflict exists.
8. Any required approval is valid and satisfied.

Every check must pass before READY. Policy outcomes are explicit `ALLOW`,
`DENY` or `REQUIRE_APPROVAL`; REQUIRE_APPROVAL stays non-executable until an
APPROVED request binds to the exact intent, action, target, normalized
parameters/context hash, tenant and policy/Rule context. Changed context makes
approval stale. Approval cannot bypass authorization, scope, conflict or
kill switch.

Each evaluation preserves capability and policy IDs/versions, principal,
permission and scope evaluated, policy and authorization decisions, approval
context, kill-switch and conflict decisions, and safe reason codes. Later
policy/grant changes append evidence and do not rewrite prior decisions.

### 4.6 TASK-091 execution-time check

Immediately before action execution TASK-091 rechecks current kill switch,
Action Policy, principal authorization/resource scope, approval validity,
conflict/cancellation state and target eligibility. A revoked policy or grant
blocks execution and records a reason. TASK-091 must not treat READY as a
permanent token.

## 5. Management Permissions and Commands

Policy management is separate from Rule management and action execution.
Define tenant-scoped permissions:

```text
automation.policy.read
automation.policy.create
automation.policy.update
automation.policy.activate
```

Policy activation/change requires expected version, idempotency, reason,
authorization, audit and correlation metadata as applicable. Use immutable
policy revisions. Principal grants remain in canonical Authorization
administration, with its own permissions and audit. Policy management does
not grant rule management or execution capability.

The explicit blocked-intent policy re-evaluation command is
`AUTOMATION.INTENT.REEVALUATE_POLICY` (or equivalent repository command). It
must be explicitly invoked, authorized, tenant-scoped, idempotent and audited;
there is no background resurrection. Policy API route shapes are
implementation-adaptable and do not require runtime exposure in this
remediation.

## 6. Decision, Audit and Event Evidence

Preserve exact Rule/version, event/evaluation, capability/version, tenant
policy/version, principal, required permission, resource-scope reference,
policy/authorization decision, approval binding, conflict and kill-switch
outcomes, safe reason and correlation. Avoid unnecessary raw event content,
secrets, full policy selectors or protected parameters in broad events,
audit and timeline.

Policy lifecycle events are `AUTOMATION.ACTION_POLICY_CREATED`,
`AUTOMATION.ACTION_POLICY_UPDATED` for a draft edit,
`AUTOMATION.ACTION_POLICY_VERSION_PUBLISHED`,
`AUTOMATION.ACTION_POLICY_ACTIVATED` and
`AUTOMATION.ACTION_POLICY_DEACTIVATED` (or semantically equivalent repository
names). Principal grant changes use the canonical Authorization domain event
and audit contract. TASK-090 events describe decisions/intents only.

Create human fallback for unsupported action/target, invalid or unavailable
policy/authorization/principal, ambiguous tenant/scope or unresolved
conflict. Fallback is idempotent and does not become canonical intent state.

## 7. Initial Positive Test Configuration

An automated positive case may use an already-supported `RESTART_AGENT`
capability only if the existing catalog/module supports it. The fixture must
explicitly configure a test-tenant ALLOW policy and a `SYSTEM_AUTOMATION`
grant for `agent.restart` scoped to a specific test resource/site. Production
defaults remain deny-by-default. Verify no policy, missing grant, wrong
tenant, wrong resource scope and backend failure all remain non-executable.

## 8. Required Security and Contract Tests

- No Action Policy → not READY.
- Explicit DENY → not READY.
- ALLOW + missing principal grant → not READY.
- ALLOW + wrong tenant → not READY.
- ALLOW + wrong resource scope → not READY.
- ALLOW + valid tenant/resource-scoped grant → READY.
- REQUIRE_APPROVAL without valid approval → not READY.
- Valid bound approval plus grant permits eligibility; stale approval does
  not.
- Kill switch, unsupported action or invalid target → not READY.
- Policy-store, authorization-store and principal-resolver failures fail
  closed.
- Policy/capability version and principal/scope evidence are preserved.
- Grant/policy revocation is detectable by TASK-091's execution recheck.
- Rule author permissions do not imply action execution permissions.
- No wildcard System Automation Principal is provisioned by default.
- Policy changes do not rewrite old evidence or silently resurrect blocked
  intents.
- Concurrent policy/grant/eligibility changes cannot bypass the READY guard.
- TASK-090 never calls a remediation/action execution adapter.

## 9. Acceptance Criteria

1. All policy, capability and principal authorization requirements above are
   normative in the listed specifications and traceability records.
2. Deny-by-default is preserved; no wildcard grant or bootstrap ALLOW is
   introduced.
3. The TASK-090/TASK-091 ownership boundary and TASK-091 recheck are explicit.
4. TASK-090 is returned to `IN_PROGRESS`; TASK-091 remains blocked and
   unstarted.
5. Only specification/planning files are committed for TASK-090-R1.

## 10. Out of Scope

- Runtime policy/grant persistence, migrations, API implementation or adapter
  wiring.
- Changing TASK-090 runtime deny-all behavior.
- Any TASK-091 implementation.
- Wildcard/default ALLOW policy or broad System Automation grant.
- Scheduler, temporal/windowed triggers or action execution.

## 11. Completion Record

This remediation records the normative security contract and returns TASK-090
to `IN_PROGRESS`. The existing runtime remains deny-by-default until its
policy and authorization path is implemented. TASK-091 remains `BLOCKED` on
TASK-090 and is not started.
