# Current Task

`TASK-090` — Advanced Rules Engine + Policy-Gated Automation — is
`CODE_COMPLETE`. See the [implementation report](tasks/TASK-090_IMPLEMENTATION_REPORT.md)
and [normative contract](tasks/TASK-090_ADVANCED_RULES_ENGINE_POLICY_GATED_AUTOMATION.md).

`TASK-091` is dependency-ready (`READY`) because TASK-031, TASK-053 and
TASK-090 are complete. It remains `NOT_STARTED`; its detailed contract has
not been generated and no TASK-091 runtime work has begun. Do not begin TASK-091
without an explicit continuation instruction.

TASK-090 persists Action Intent eligibility only and never executes an
action. Tenant policy and canonical scoped `SYSTEM_AUTOMATION` grants must be
explicitly configured; missing policy or grant remains deny-by-default.

The pre-existing `AGENTS.md` modification is unrelated and remains outside the
TASK-090 commit.
