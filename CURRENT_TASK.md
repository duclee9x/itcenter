# Current Task

`TASK-090` — Advanced Rules Engine + Policy-Gated Automation — is the current
planned task and is `READY / NOT_STARTED`.

Normative contract: [TASK-090](tasks/TASK-090_ADVANCED_RULES_ENGINE_POLICY_GATED_AUTOMATION.md)

The contract/planning reconciliation is complete. Runtime implementation has
not started. TASK-090 owns event-triggered rule versioning, simulation,
condition/policy evaluation, conflict handling and durable Action Intent
creation. TASK-091 owns action execution, self-healing, retries, verification
and compensation. Do not implement TASK-090 runtime until explicitly asked to
continue.

The separate `AGENTS.md` modification predates this planning update and is
outside the TASK-090 change.
