# CODEX_TASK_TEMPLATE.md
## IT Operations Hub — Standard Codex Task Contract

Copy this file for each implementation task.

Recommended naming:

```text
TASK-<number>_<short-name>.md
```

Example:

```text
TASK-006_ASSET_ASSIGNMENT.md
```

---

# 1. Task Metadata

```yaml
task_id:
feature_id:
workflow_id:
phase:
priority:
status: NOT_STARTED
owner_domain:
```

---

# 2. Objective

Describe exactly one implementation objective.

Example:

```text
Implement Asset Assignment from AVAILABLE/RESERVED to ASSIGNED/IN_USE.
```

Avoid objectives such as:

```text
Implement the Asset module.
Build all Helpdesk features.
Finish Phase 1.
```

---

# 3. Required Specifications

Codex must read:

```text
AGENTS.md
MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md
```

Then list only the additional specs needed for this task:

```text
- <domain workflow spec>
- DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md
- STATE_MACHINE_MASTER_SPEC.md
- API_COMMAND_CONTRACT_SPEC.md
...
```

Do not force Codex to reread every document for every small task.

---

# 4. In Scope

List explicit deliverables.

Example:

```text
- ASSET.ASSIGN command
- asset.assign permission enforcement
- Assignment persistence
- Movement persistence
- lifecycle/assignment state transition
- Idempotency-Key
- expected_version
- ASSET.ASSIGNED outbox event
- audit record
- timeline projection
- tests
```

---

# 5. Out of Scope

Be explicit.

Example:

```text
- Asset transfer
- Asset return
- Temporary loan
- Disposal
- Procurement receiving
- UI implementation
```

Codex must not expand scope without reporting `SCOPE_DEPENDENCY`.

---

# 6. Current Repository Context

Fill only what is known:

```text
Existing modules:
Existing tables:
Existing commands:
Existing event infrastructure:
Existing test framework:
```

If unknown, Codex must inspect before editing.

---

# 7. Domain Rules

List the business invariants relevant to this task.

Example:

```text
- An asset can have at most one active primary assignment.
- A DISPOSED asset cannot be assigned.
- Target user must be active.
- Assignment must be within actor scope.
```

---

# 8. State Transition

```text
FROM:
COMMAND:
TO:
```

Example:

```text
AVAILABLE / RESERVED
→ ASSET.ASSIGN
→ ASSIGNED / IN_USE
```

If multiple dimensions are involved, list them independently.

---

# 9. Preconditions

Example:

```text
- Asset exists.
- Asset current version matches expected_version.
- Actor has asset.assign.
- Actor scope covers asset.
- Target user exists and is ACTIVE.
- No conflicting active assignment.
```

---

# 10. Authorization

```yaml
permission:
resource:
scope:
high_risk: false
reauth_required: false
mfa_required: false
approval_required: false
```

If approval/high-risk is conditional, describe the condition.

---

# 11. Database / Data Model

Specify:

```text
Tables created/changed:
Constraints:
Indexes:
History:
```

Example:

```text
assignments
movements
assets.current_owner_user_id

Partial unique constraint:
one active PRIMARY assignment per asset
```

---

# 12. API

Specify intended endpoint(s).

Example:

```text
POST /api/v1/assets/{id}/commands/assign
```

Input:

```yaml
target_user_id:
expected_version:
reason:
```

Headers:

```text
Idempotency-Key
If-Match or equivalent expected version
```

---

# 13. Command

```yaml
command_type:
target:
payload:
```

Example:

```yaml
command_type: ASSET.ASSIGN
target: ASSET
payload:
  target_user_id:
  reason:
```

---

# 14. Events Produced

Example:

```text
ASSET.ASSIGNED
ASSET.STATE_CHANGED   # only if generic state event is part of existing architecture
```

For each event define:

```text
aggregate
minimum payload
correlation_id
causation_id
schema_version
```

---

# 15. Events Consumed

List only if this task implements consumers.

```text
- none
```

or:

```text
USER.TERMINATED
```

---

# 16. Idempotency

Define:

```text
Key source:
Request hash:
Ledger behavior:
Duplicate behavior:
```

Example:

```text
same key + same request → previous result
same key + different request → 409 IDEMPOTENCY_KEY_CONFLICT
```

---

# 17. Concurrency

Define:

```text
expected_version / ETag
DB constraints
locking if any
```

Do not rely only on application prechecks.

---

# 18. Transaction Boundary

List what must commit atomically.

Example:

```text
- Assignment
- Movement
- Asset current owner/state
- Outbox event
- required audit durability record
```

List async side effects separately.

---

# 19. Async Side Effects

Example:

```text
- Generate handover document
- Notification
- Timeline projection
- Search index update
```

These must not keep the core DB transaction open.

---

# 20. Audit Requirements

Specify:

```text
actor
subject
before
after
reason
correlation
related entities
```

---

# 21. Timeline Requirements

Specify:

```text
Primary timeline:
Secondary timelines:
Template intent:
Visibility:
Importance:
```

---

# 22. Notification Requirements

Specify:

```text
recipient
channel
template
when
```

or:

```text
none
```

---

# 23. Search / Projection Impact

Specify:

```text
search fields affected
read-model projection updates
workspace updates
```

---

# 24. Error Codes

List expected canonical errors.

Example:

```text
ASSET_NOT_FOUND
ASSET_INVALID_STATE
ASSET_ALREADY_ASSIGNED
USER_NOT_ACTIVE
PERMISSION_DENIED
VERSION_CONFLICT
IDEMPOTENCY_KEY_CONFLICT
```

---

# 25. Retry / Compensation

Specify:

```text
Retryable:
Non-retryable:
Compensation:
```

---

# 26. Observability

Required logs/metrics/traces.

Example:

```text
command duration
assignment success/failure count
version conflict count
idempotency hit count
```

---

# 27. Required Tests

## Unit

```text
[ ]
```

## Domain State

```text
[ ]
```

## Repository Integration

```text
[ ]
```

## API

```text
[ ]
```

## Event Contract

```text
[ ]
```

## E2E

```text
[ ]
```

## Failure Cases

```text
[ ]
```

---

# 28. Acceptance Criteria

Use observable pass/fail conditions.

Example:

```text
1. Valid assignment succeeds.
2. Parallel assignment attempts cannot create two active primary assignments.
3. Duplicate request with same Idempotency-Key does not duplicate side effects.
4. Invalid lifecycle state returns canonical state-transition error.
5. Wrong scope returns permission denial.
6. Version conflict returns 409.
7. ASSET.ASSIGNED is written to outbox in the same transaction.
8. Audit record is present.
9. All relevant tests pass.
```

---

# 29. Verification Commands

Codex should discover project-specific commands.

Expected categories:

```text
format
lint
typecheck
unit test
integration test
migration test
contract test
E2E
```

Do not invent command names if the repository already defines them.

---

# 30. Codex Execution Protocol

Codex must follow:

```text
1. Inspect repo.
2. Read AGENTS.md.
3. Read task specs.
4. Report concise implementation plan.
5. Implement only this scope.
6. Run verification.
7. Fix regressions introduced by the task.
8. Return implementation report.
```

---

# 31. Required Completion Report

Codex must end with:

```markdown
## Implementation Report

### Status
IMPLEMENTED / PARTIAL / BLOCKED

### Files Changed
- ...

### Database Changes
- ...

### APIs / Commands
- ...

### Events
- ...

### Permissions
- ...

### Audit / Timeline
- ...

### Tests Run
- command: result

### Remaining Gaps
- ...

### Spec Conflicts
- none / ...

### Assumptions
- none / ...
```

---

# 32. Scope Expansion Rule

If Codex discovers a missing dependency that materially expands scope:

```text
STOP before implementing that expansion.
```

Report:

```text
SCOPE_DEPENDENCY:
```

and explain the minimum dependency required.

Small compile/test support changes that do not alter product scope are allowed.

---

# 33. Spec Conflict Rule

If implementation cannot satisfy two specs simultaneously:

```text
SPEC_CONFLICT:
```

Report:

```text
documents
conflicting statements
impact
smallest proposed resolution
```

Do not silently choose.

---

# 34. Completion Rule

A task is not complete merely because:

```text
code compiles
endpoint returns 200
```

Applicable Definition of Done from `AGENTS.md` must be satisfied.
