You are replacing another implementation agent because its session ended.

Your first responsibility is STATE RECOVERY, not coding.

Read:

- AGENTS.md
- CODEX_TASK_REGISTRY.md
- CURRENT_TASK.md
- IMPLEMENTATION_HANDOFF.md

Then inspect:

- git status
- git diff
- recent commits
- files referenced by the handoff
- tests relevant to CURRENT_TASK

Treat the repository as authoritative.

Reconcile the handoff against the actual implementation and the task's
Acceptance Criteria.

Return this checkpoint before editing:

TASK:
BRANCH:
REPOSITORY STATE:
COMPLETED ACCEPTANCE CRITERIA:
INCOMPLETE ACCEPTANCE CRITERIA:
CURRENT FAILURES:
NEXT EXACT STEP:
HANDOFF/REPOSITORY MISMATCH:
SPEC_CONFLICT:
SCOPE_DEPENDENCY:

Then continue the current task from the smallest incomplete step.

Do not restart completed work.
Do not refactor unrelated code.
Do not start another task.
Do not alter architecture unless the current task explicitly requires it.

When you stop for any reason, update IMPLEMENTATION_HANDOFF.md so another
model can resume without conversation history.
