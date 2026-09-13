# Current Task

`TASK-090` — Advanced Rules Engine + Policy-Gated Automation — is
`CODE_COMPLETE`. See the [implementation report](tasks/TASK-090_IMPLEMENTATION_REPORT.md)
and [normative contract](tasks/TASK-090_ADVANCED_RULES_ENGINE_POLICY_GATED_AUTOMATION.md).

Current task: `TASK-091` — Controlled Self-Healing + Compensation,
`READY / IN_PROGRESS`. Its detailed contract is
[TASK-091](tasks/TASK-091_CONTROLLED_SELF_HEALING_COMPENSATION.md); normative
execution rules are recorded in [TASK-091-R1](tasks/TASK-091-R1_AUTOMATION_ACTION_EXECUTION_CONTRACT_GAP.md).
TASK-091 v1 supports only `RESTART_AGENT`, with authenticated Agent
acceptance, positive runtime-marker verification, one automatic attempt,
zero automatic retry and no compensation.

The runtime vertical slice is implemented and current test/type/lint/format
gates pass. TASK-091 remains `IN_PROGRESS` because the contract has no
deadline/trigger for an ambiguous `DISPATCHED` command that never receives
Agent `ACCEPTED`; the five-minute verification timer starts only after
acceptance. See [implementation report](tasks/TASK-091_IMPLEMENTATION_REPORT.md).
Do not start TASK-092 until this gap is resolved and TASK-091 is complete.

TASK-090 persists Action Intent eligibility only and never executes an
action. Tenant policy and canonical scoped `SYSTEM_AUTOMATION` grants must be
explicitly configured; missing policy or grant remains deny-by-default.

The pre-existing `AGENTS.md` modification is unrelated and remains outside the
TASK-091 commit.
