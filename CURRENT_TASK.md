# Current Task

`TASK-090` — Advanced Rules Engine + Policy-Gated Automation — remains the
current task and is `IN_PROGRESS`.

Normative contract: [TASK-090](tasks/TASK-090_ADVANCED_RULES_ENGINE_POLICY_GATED_AUTOMATION.md)

The normative security contract is complete in
[TASK-090-R1](tasks/TASK-090-R1_AUTOMATION_ACTION_POLICY_SYSTEM_PRINCIPAL_AUTHORIZATION_CONTRACT.md).
The rule/version, evaluation and durable Action Intent implementation is in
place, but runtime Action Policy and scoped System Automation Principal
authorization are not implemented; the worker remains deny-by-default and no
production intent can become `READY`. See the
[implementation report](tasks/TASK-090_IMPLEMENTATION_REPORT.md). TASK-090
never executes remediation. TASK-091 owns action execution, self-healing,
retries, verification and compensation and remains blocked / not started.

The pre-existing `AGENTS.md` modification is outside TASK-090-R1 and must
remain uncommitted with this remediation.
