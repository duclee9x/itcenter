# Current Task

`TASK-091` — Controlled Self-Healing + Compensation — is
`CODE_COMPLETE`. The 30-second `RESTART_AGENT` acceptance deadline,
acceptance-timeout-to-UNKNOWN behavior, independent five-minute verification
window, timeout/acceptance concurrency and append-only late-evidence
reconciliation are implemented. See the
[implementation report](tasks/TASK-091_IMPLEMENTATION_REPORT.md) and
[normative contract](tasks/TASK-091_CONTROLLED_SELF_HEALING_COMPENSATION.md).

Next: `TASK-092` — Advanced Incident Correlation — is derived `READY /
NOT_STARTED` because declared dependencies TASK-033, TASK-051 and TASK-090
are `CODE_COMPLETE`. Its detailed task contract/runtime work has not started.
Stop here; do not begin TASK-092 without an explicit instruction.

Production Agent Gateway authentication remains fail-closed until the
deployment configures the existing enrolled-Agent `AuthenticationPort`.
The local `AGENTS.md` modification predates this completion and is excluded
from the TASK-091 commit.
