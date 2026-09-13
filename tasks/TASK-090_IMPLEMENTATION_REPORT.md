# TASK-090 Implementation Report

**Status:** `CODE_COMPLETE`. TASK-090 now evaluates event-triggered rules,
applies deny-by-default Action Policy and scoped System Automation
authorization, and persists explainable Action Intents through a durable
`READY` / blocked decision. It never invokes an action executor. TASK-091
owns action execution and execution-time security rechecks.

## Implemented

- Preserved the existing Rule versioning, typed condition evaluation,
  simulation, event/inbox idempotency, Action Intent deduplication, semantic
  conflict handling, approval binding, kill switch, audit/outbox, timeline
  and Work Queue behavior.
- Added a code-reviewed Action Capability Catalog. The only currently
  executable capability is `RESTART_AGENT` for an `AGENT`, with fixed
  `agent.restart` permission, `SAFE_AUTOMATION` classification, typed empty
  parameters, explicit conflict group and a TASK-091 executor identifier.
  Unknown or altered catalog entries fail closed.
- Added tenant-scoped, versioned Action Policy persistence and commands to
  create, edit draft, activate and deactivate policy versions. Policy
  versions are immutable after activation; selectors and parameter
  constraints are evaluated against canonical target context. Missing policy
  defaults to `DENY`; there is no wildcard policy or bootstrap ALLOW.
- Added tenant-bound `SYSTEM_AUTOMATION` principal records. Resolution builds
  a service-principal authorization context and delegates permission/resource
  scope evaluation to Identity's canonical authorization evaluator through
  `AuthorizationPort`. Rule authors and human session permissions are not
  used as execution authority. Global/tenant/wildcard grants are prohibited
  for this principal type.
- Added fail-closed READY gates and immutable decision evidence for capability
  and version, policy/version/decision, principal, permission and matched
  scope, approval requirement/result, kill switch, conflict and reason code.
  Approval rechecks use the same policy, capability, target and authorization
  path and reject stale context.
- Added policy administration API routes with distinct policy permissions,
  tenant/resource scoping, expected versions, idempotency, audit, outbox and
  timeline. Policy publication and activation events are separately recorded;
  events omit resource selectors and raw parameter constraints.
- Added database constraints for READY evidence, policy/capability/principal
  references, immutable catalog and active policy versions, and scoped
  automation grants. The migrations are owned by Identity and Automation in
  their respective domains.
- Worker evaluation creates actionable review work for pending approvals and
  selected blocked security/target conditions. TASK-090 does not call agent,
  infrastructure, business mutation or remediation adapters.

## Security and task boundaries

An explicit tenant policy, supported capability, valid target, authorized
tenant-scoped `SYSTEM_AUTOMATION` grant, satisfied approval when required,
clear conflict state and permitted kill switch are all necessary for `READY`.
No policy, missing grant, wrong tenant, wrong resource scope, unsupported
action, stale approval, active kill switch or backend decision failure cannot
produce a READY intent. A fresh tenant remains deny-by-default until its
policy and grant are provisioned through the canonical control-plane data.

TASK-090 is event-trigger-only. It adds no scheduler, temporal/windowed rule,
delayed trigger or arbitrary code execution. Simulation creates no executable
intent. TASK-091 implementation was not started; no action executor was
invoked by TASK-090.

## Persistence and API

- `identity.automation_principals` records the tenant-bound service identity;
  existing `identity.role_bindings` remains the canonical permission/grant
  source.
- `automation.action_capabilities` stores the verified allow-listed catalog;
  `automation.action_policies` stores immutable tenant policy versions.
- `automation.rule_evaluations` and `automation.action_intents` retain the
  policy, principal, capability, authorization and eligibility evidence.
- Added `20260913_006_system_automation_principal.sql` and
  `20260913_002_action_policy_capability.sql`. Migration order applies Identity
  before Automation so the intent's principal foreign key is valid.
- Added `POST /api/v1/automation-action-policies`, tenant-scoped listing, and
  explicit `update-draft`, `activate` and `deactivate` command routes.

The capability catalog currently supports only the safe `RESTART_AGENT`
example. Other actions require reviewed catalog definitions and matching
permission/resource-scope contracts before they can become executable.

## Verification

The full PostgreSQL-backed `npm test` suite passed: 104 tests (36
unit/architecture, 2 contract, 1 migration, 21 integration and 44 E2E).
TASK-090 E2E coverage includes policy/grant positive and negative paths,
wrong tenant and site scope, absent policy, stale approval, kill switch,
unsupported action, simulation, duplicate delivery, concurrent grant
revocation, intent deduplication/contributor retention, conflict fallback,
policy management API idempotency/audit/outbox, and version publication
events. No unrelated VLAN test flakiness reproduced.

Also passed `npm run typecheck`, `npm run lint` (including boundary checks),
`npm run format:check`, and `git diff --check`. Migration tests applied all
migrations to a fresh PostgreSQL database and verified idempotent replay.

## Governance

TASK-090 is `CODE_COMPLETE`. Its declared dependencies are satisfied. TASK-091
is dependency-ready (`READY`) because TASK-031, TASK-053 and TASK-090 are
complete, but remains `NOT_STARTED`; no TASK-091 contract was generated or
runtime code started. TASK-092 was not reconciled as part of this explicitly
scoped TASK-091 readiness update.
