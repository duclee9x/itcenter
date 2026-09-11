Resume the currently active implementation task.

Do not assume the previous model's explanation is correct or complete.

Recover the current state from the repository first.

Read in this order:

1. AGENTS.md
2. CODEX_TASK_REGISTRY.md
3. CURRENT_TASK.md
4. IMPLEMENTATION_HANDOFF.md
5. git status
6. git diff
7. recent commits
8. files changed by the current task
9. specs referenced by CURRENT_TASK.md

Then reconcile:

HANDOFF
vs
actual code
vs
current task acceptance criteria.

Report:

CURRENT TASK:
CURRENT STATUS:
ALREADY COMPLETE:
PARTIALLY COMPLETE:
NOT STARTED:
KNOWN FAILURES:
NEXT EXACT STEP:
SPEC CONFLICTS:
REPOSITORY/HANDOFF MISMATCH:

Do not modify anything until this reconciliation is complete.

After reconciliation, continue from the smallest incomplete step.

Do not:

- restart the task from scratch,
- replace working implementations simply because you prefer another approach,
- implement future tasks,
- silently reinterpret architecture.

Before ending the session, update IMPLEMENTATION_HANDOFF.md.
