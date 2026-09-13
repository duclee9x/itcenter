# Current Task

`TASK-090` — Advanced Rules Engine + Policy-Gated Automation — remains the
current task and is `BLOCKED`.

Normative contract: [TASK-090](tasks/TASK-090_ADVANCED_RULES_ENGINE_POLICY_GATED_AUTOMATION.md)

The rule/version, evaluation and durable Action Intent implementation is in
place, but the worker's policy and Automation Principal adapters are absent
and default to deny-all. No production intent can become `READY`; see the
[implementation report](tasks/TASK-090_IMPLEMENTATION_REPORT.md). TASK-090
cannot pass its completion gate until those normative adapters are available.
TASK-090 never executes remediation. TASK-091 owns action execution,
self-healing, retries, verification and compensation and remains blocked; it
has not been started.

The pre-existing `AGENTS.md` modification is outside the TASK-090 change and
must remain uncommitted with this task.
