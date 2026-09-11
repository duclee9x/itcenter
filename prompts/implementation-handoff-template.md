# IMPLEMENTATION HANDOFF

Use this file as the handoff format when pausing or transferring work.
Repository state and task acceptance criteria are authoritative.

## Active Task

Task: `<TASK-ID> — <TITLE>`

Feature: `<FEATURE-ID>`

Workflow: `<WORKFLOW-ID>`

Branch: `<BRANCH-NAME>`

Last verified commit: `<COMMIT OR UNCOMMITTED WORKSPACE>`

## Overall Status

`<NOT_STARTED | IN_PROGRESS | BLOCKED | CODE_COMPLETE>`

## Completed

Record implemented database, domain, application, interface, and test work.
Include file paths and the behavior verified.

## Remaining Work

List the exact acceptance criteria, integration work, tests, or documentation
updates that remain. State the next file or command to inspect.

## Current Failing Tests

For each failure, record the exact command, test, observed error, and whether
it blocks acceptance. Do not claim a test passed unless it was run.

## Exact Next Step

Describe one concrete next implementation or verification step. Do not begin
another task.

## Decisions and Assumptions

Record decisions already made and each `IMPLEMENTATION_ASSUMPTION` with its
reason. Record `SPEC_CONFLICT`, `SCOPE_DEPENDENCY`, `BLOCKER`,
`SECURITY_CONCERN`, or `MIGRATION_RISK` when relevant; write `None` when none
exists.

## Files Changed

List changed files and identify unfinished work. Preserve valid existing work.

## Verification State

Record commands under `PASS`, `FAIL`, or `NOT RUN`, including database and
integration prerequisites.

## Completion Condition

Set `CODE_COMPLETE` only after every acceptance criterion passes and the task
registry, current-task document, and this handoff are synchronized.
