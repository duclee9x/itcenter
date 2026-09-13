# TASK-090 Implementation Report

**Status:** `BLOCKED` — the rule and Action Intent implementation is present,
but runtime policy and Automation Principal adapters are unavailable.

## Existing foundation

Before this change, Automation had a legacy `automation.rules` registration
table, `registerRule`, a per-rule kill-switch flag and an `automation.executions`
table. It had no immutable rule-version history, event evaluator, typed
condition engine, policy-gated Action Intent, conflict handling or durable
evaluation evidence. No production System Automation Principal authorization
adapter or action-policy evaluator exists in the repository.

## Implemented

- Added Automation rule draft/version lifecycle, immutable published versions,
  activation/deactivation, scoped kill switches, safe typed condition/action
  validation, simulation and event-trigger evaluation.
- Added durable evaluation, Action Intent, contributor, conflict and conflict
  membership records with tenant constraints, idempotency keys, immutable
  version enforcement, conflict-scope serialization and exact evaluation to
  intent references.
- Added authenticated, permissioned rule/intent/conflict command routes with
  idempotency, audit, outbox and timeline recording.
- Added worker consumers for canonical event evaluation, approval rechecks and
  idempotent conflict/review Work Queue projections. No action/remediation
  adapter is called by TASK-090.
- Corrected the platform outbox writer to persist the validated complete event
  envelope, including `published_at`, so inbox consumers can validate and
  process emitted events.
- Added the automation permission catalog and Operations source types for
  actionable conflict/review work.

## Blocker

`AutomationPolicyPort` and `ActionAuthorization` have explicit deny-all
defaults. The worker currently wires those defaults, and there is no existing
per-action policy implementation or System Automation Principal model that
can be safely used to authorize a target action. Consequently event
evaluations are retained and intents are blocked; production cannot create a
`READY` intent. The allow/approval paths are exercised through test adapters,
but wiring a real policy and principal would require an existing normative
policy source and a properly scoped principal authorization adapter. Inventing
either would weaken the documented security boundary.

**SCOPE_DEPENDENCY:** provide/configure the normative Automation Policy and
System Automation Principal authorization adapters.

**SECURITY_CONCERN:** do not replace the deny-all defaults or derive action
authority from the Rule author until those adapters enforce explicit tenant
and target scope.

**SPEC_CONFLICT:** none found. The blocker is missing runtime capability, not
conflicting business rules.

TASK-091 remains `BLOCKED` on TASK-090. No TASK-091 implementation was started.

## Files and persistence

- Added `automation.rule_versions`, `automation.kill_switches`,
  `automation.rule_evaluations`, `automation.action_intents`, contributor,
  conflict and conflict-member tables and immutable published-version guard.
- Extended Operations Work Queue source types for automation conflicts and
  reviews.
- Added authenticated rule create/update/publish/activate/deactivate/simulate,
  intent/conflict reads, conflict resolution and kill-switch endpoints.
- Updated Worker event/inbox processing and platform outbox envelope
  persistence.

## Verification

`npm test` passed all 103 tests: 36 unit/architecture, 2 contract, 1 migration,
21 integration and 43 E2E tests. The six TASK-090 PostgreSQL E2E tests cover
rule version immutability, active/inactive and event matching, policy and
authorization outcomes, simulation, deduplication and contributor history,
compatible and incompatible actions across different rule priorities, one
human fallback, approval binding and rule/global kill switches, and
authenticated API idempotency with audit/outbox. The migration runner applied
the new tables and constraints on a fresh database and passed replay checks.

`npm run typecheck`, `npm run lint`, `npm run format:check` and
`git diff --check` passed. A prior full-suite run had one unrelated
`network-vlan-change` timeline-order assertion failure; that test passed alone
and the subsequent full run passed all 103 tests. Runtime
policy/principal provisioning remains unverified because those adapters do
not exist.
