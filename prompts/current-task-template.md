# CURRENT TASK

Task:

<TASK-ID>

Task specification:

tasks/<TASK-FILE>.md

Status:

<NOT_STARTED | IN_PROGRESS | BLOCKED | CODE_COMPLETE>

Branch:

<BRANCH-NAME>

Before modifying code, reconcile this task against the repository, Git state,
the task specification, and the implementation handoff. Do not start another
task until this task passes every applicable acceptance criterion.

## Acceptance Criteria

Copy the authoritative acceptance criteria from the task specification here.

## Current Constraints

- Implement only the current task.
- Preserve domain ownership, authorization, state transitions, auditability,
  idempotency, and concurrency rules from AGENTS.md.
- Report `SPEC_CONFLICT`, `SCOPE_DEPENDENCY`, `IMPLEMENTATION_ASSUMPTION`, or
  `BLOCKER` when applicable.
