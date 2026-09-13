# Current Task

`TASK-090` — Advanced Rules Engine + Policy-Gated Automation — is
`CODE_COMPLETE`. See the [implementation report](tasks/TASK-090_IMPLEMENTATION_REPORT.md)
and [normative contract](tasks/TASK-090_ADVANCED_RULES_ENGINE_POLICY_GATED_AUTOMATION.md).

Current planning task: `TASK-091-R1` — Automation Action Execution +
Verification Contract. TASK-091's runtime dependencies are satisfied, but it
is not implementation-ready because the execution protocol for the currently
registered `RESTART_AGENT` capability, verification timeout, retry limits,
unknown-outcome recovery and compensation behavior are not fully specified.
See [TASK-091-R1](tasks/TASK-091-R1_AUTOMATION_ACTION_EXECUTION_CONTRACT_GAP.md).

No TASK-091 runtime code has been started. The proposed safe initial contract
is pending normative approval; do not implement TASK-091 until that contract
is resolved and its detailed task contract is generated.

TASK-090 persists Action Intent eligibility only and never executes an
action. Tenant policy and canonical scoped `SYSTEM_AUTOMATION` grants must be
explicitly configured; missing policy or grant remains deny-by-default.

The pre-existing `AGENTS.md` modification is unrelated and remains outside the
TASK-090 commit.
