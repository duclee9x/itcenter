# TASK-059 — Replacement + Retirement + Disposal + Data Wipe

## 1. Task Metadata

```yaml
task_id: TASK-059
feature_id: F-037/F-038
workflow_id: WF-017/WF-018
phase: P3
priority: P1
readiness: SATISFIED
status: CODE_COMPLETE
owner_domain: asset
depends_on: TASK-015, TASK-036, TASK-038
```

## 2. Objective

Implement the Asset-owned replacement, retirement, data-wipe and final
disposition workflows. Keep the old asset usable until its replacement is
verified, enforce approval and cleanup gates before retirement/disposal, and
preserve an auditable Asset record after final disposition.

## 3. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/MAINTENANCE_WARRANTY_REPLACEMENT_DISPOSAL_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`
- `tasks/TASK-015_ASSET_RETURN_HANDOVER_DOCUMENTS.md`
- `tasks/TASK-036_APPROVAL_ENGINE.md`
- `tasks/TASK-038_MAINTENANCE_WARRANTY.md`

## 4. In Scope

- Create explainable replacement candidates with the asset/user/service,
  health, warranty, repair/incident, cost-estimate and business-impact context
  available through owning-domain read contracts. Preserve supplied score and
  reason evidence; do not invent or silently apply scoring weights.
- Record review decisions (`APPROVE_REPLACEMENT`, `CONTINUE_USE`,
  `REPAIR_FIRST`, `EXTEND_WARRANTY`, `DEFER`), including reason, approver and
  any required review date/risk acceptance. Create and version replacement
  plans with target user/model, budget, procurement/migration flags and date.
- Support the replacement path using an eligible existing asset: prepare the
  new asset, verify required software/license/network/user readiness, migrate,
  verify user cutover, and complete assignment through the Asset-owning
  commands. Keep the old asset active until cutover succeeds. Request/record
  physical return through TASK-015 before retiring an old device.
- Extend the existing `ASSET.RETIRE` path with a durable retirement record,
  retirement review, approval evidence and blocking clearances. Cover active
  assignment/loan, license, incident, maintenance, legal-hold, retention and
  financial checks; unresolved required checks remain actionable blockers.
- Add versioned data-wipe jobs and the asynchronous operation/agent boundary
  for supported symbolic methods selected from storage type, data
  classification, policy and intended disposition. Persist operator/method,
  start/end, result, verification and evidence-document reference/checksum.
- Add approved disposal decisions and durable disposal records for
  `REUSE_INTERNAL`, `SELL`, `RECYCLE`, `RETURN_VENDOR`, `DONATE` and `DESTROY`.
  Finalize only after approval, required wipe, required license/access cleanup
  and confirmed physical disposition.
- Provide explicit, policy-checked Asset reactivation for approved internal
  reuse after reconditioning. Preserve prior retirement/wipe history and never
  rewrite it. A `DISPOSED` asset cannot be reactivated.
- Keep one actionable Work Queue reference for each unresolved replacement,
  retirement, wipe or disposal blocker where the source aggregate remains
  actionable; resolve it only when the owning workflow reaches an allowed
  terminal/cleared state.
- Add tenant-scoped APIs, migrations/constraints, permissions and approval
  integration, idempotency, optimistic concurrency, audit, outbox events,
  Asset timeline projection and notifications required by the workflow.
- Complete `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md` for workflow-required
  events currently listed by name but missing a payload schema, including
  `REPLACEMENT.PLAN_CREATED`, `REPLACEMENT.MIGRATION_STARTED`,
  `RETIREMENT.CANDIDATE_CREATED`, `RETIREMENT.APPROVED` and
  `DISPOSAL.APPROVED`, using the documented owning aggregate and data model.
- Add the explicit `asset.reactivate` permission to the permission catalog for
  approved internal reuse; do not reuse generic master-data permission for a
  protected terminal-state reactivation.
- Keep all cross-domain changes behind the owning domain's application
  command/query contract. The Asset module may read Maintenance/Warranty and
  other clearance projections but must not mutate their tables.

## 5. Out of Scope

- Procurement requests, RFQ, purchase orders, receipt and invoice execution
  (Phase 4). A plan that requires procurement may remain in `PROCUREMENT` with
  an actionable reference until a procurement-owned workflow is available.
- Advanced replacement/risk scoring from TASK-094. This task records
  explainable assessment inputs/results; it does not invent weights.
- A vendor-specific or OS-specific secure-wipe implementation. Use a
  provider-neutral symbolic method and authenticated adapter boundary; do not
  accept arbitrary shell commands, paths or executable payloads.
- Object-storage provider implementation, electronic signatures, external
  buyer/recycler/vendor portals, sale invoicing, or procurement finance.
- Maintenance/Warranty implementation already owned by TASK-038.
- UI implementation or bulk replacement campaigns.

## 6. Current Repository Context

```text
Existing Asset code:
  modules/asset/application/lifecycle.ts
  apps/api/src/server.ts
Existing command:
  ASSET.RETIRE → asset.assets.lifecycle_state=RETIRED
Existing Asset state evidence:
  asset.lifecycle_transitions
Existing Maintenance code:
  modules/maintenance/application/maintenance.ts
Existing Approval code:
  modules/control-plane/application/approval.ts
Existing return workflow:
  TASK-015 / ASSET.REQUEST_RETURN / ASSET.RECEIVE_RETURN
Existing event/audit/idempotency infrastructure:
  platform outbox, PostgresAudit, PostgresIdempotencyStore
Existing evidence storage boundary:
  modules/artifact/application/ports.ts
Existing tests:
  tests/e2e/http.test.ts, tests/e2e/offboarding.test.ts,
  tests/e2e/software-compliance.test.ts
```

The current synchronous `ASSET.RETIRE` endpoint changes lifecycle and writes
audit/outbox, but does not yet persist the required retirement approval,
clearance, wipe or disposal aggregates. Extend that use case; do not create a
second retirement endpoint or bypass it with direct lifecycle writes.

Historical dependency handoffs recorded a local database migration checksum
mismatch. Add forward-only migrations, verify them on disposable databases and
do not rewrite applied migration history or reset the local database volume.

## 7. Domain Rules

- Replacement process state, retirement/disposal process state, wipe-job state
  and canonical Asset lifecycle are separate state dimensions.
- A replacement candidate retains its triggering facts and human-readable
  reasons. Review and plan changes are versioned and append their history.
- Keep the old asset active until the new asset passes post-cutover
  verification. A failed/uncertain migration leaves the old asset active and
  actionable; do not infer successful cutover from a command response alone.
- Do not retire an assigned device while it remains with the user. Complete
  physical return/handover through TASK-015 before retirement. A retirement
  candidate may be created while the device remains assigned; persist
  `BLOCKED`, retain the active Asset state, and create actionable work until
  the return is received.
- Retirement review must check the workflow's listed blockers. Do not retire
  while a required assignment, loan, incident, maintenance, legal-hold,
  retention or financial clearance is unresolved.
- License reclaim, agent retirement, access revocation and other cross-domain
  cleanup use the owning domain's command or recorded authoritative clearance.
  Failure remains actionable and cannot satisfy disposal readiness.
- `RETIRED` is not `DISPOSED`. The asset is not disposed until retirement is
  approved, required wipe is complete, required licenses/access are reclaimed
  and physical disposition is confirmed.
- Wipe `FAIL` or uncertain outcome blocks sale, reuse and release. Reconcile
  job/evidence first; only an explicitly approved alternative method or
  physical destruction path can proceed. Do not blindly retry an irreversible
  wipe.
- A data-bearing asset requires policy-selected wipe and verification before
  disposition, except where policy requires physical destruction instead.
  `NOT_APPLICABLE` requires an explicit policy/evidence basis.
- `REUSE_INTERNAL` is not a disposed outcome. Recondition and reclassify it
  through an explicit authorized reactivation command with policy, reason,
  expected version and audit. Retain the prior retirement review and wipe
  evidence. Never reactivate `DISPOSED`.
- Preserve Asset identity, purchase, assignment, maintenance, warranty,
  retirement, wipe, disposal and audit history. Never delete an Asset record.
- All asynchronous agent/external actions execute outside the database
  transaction. Commit command state, history, outbox and required audit
  durability atomically.

## 8. State Transitions

Replacement workflow state (separate from Asset lifecycle):

```text
CANDIDATE → UNDER_REVIEW → APPROVED → PLANNED
PLANNED → PROCUREMENT → NEW_ASSET_READY → MIGRATING → REPLACED
non-approved terminal decision → CANCELLED
DEFER → remain UNDER_REVIEW with review_date and risk acceptance
```

Retirement/disposal workflow state:

```text
ACTIVE → RETIREMENT_CANDIDATE → APPROVED_FOR_RETIREMENT → RETIRED
RETIREMENT_CANDIDATE → BLOCKED → (re-evaluate after owner cleanup)
BLOCKED → APPROVED_FOR_RETIREMENT → RETIRED
RETIRED → DATA_WIPE_PENDING → DATA_WIPED → DISPOSAL_PENDING
DISPOSAL_PENDING → DISPOSED | SOLD | RETURNED_TO_VENDOR | RECYCLED | DESTROYED
```

Wipe outcome is separately `PASS`, `FAIL`, `NOT_APPLICABLE`, or
`PHYSICAL_DESTRUCTION_REQUIRED`. Canonical Asset lifecycle transitions remain:

```text
AVAILABLE or physically RETURNED
  → ASSET.RETIRE
  → RETIRED
RETIRED
  → ASSET.DISPOSE
  → DISPOSED
```

An approved internal reuse path may reactivate only a non-disposed RETIRED
asset through the explicit special command described above. It must not alter
prior history.

## 9. Preconditions

- Tenant-scoped Asset, replacement plan/retirement record and expected version
  exist.
- Actor is authenticated, authorized for the exact resource and scope, and
  has completed required re-authentication/MFA step-up.
- Required approval is bound to this source record and is approved by an
  authorized actor distinct from the requester where separation of duties
  applies.
- Replacement target is eligible and not disposed; old asset remains active
  until the verified cutover and is physically returned before retirement.
- Retirement blockers and domain-owned cleanup clearances are authoritative
  and complete before the protected transition.
- Wipe method is policy-allowed for data classification/storage/disposition;
  agent is enrolled, bound to the asset, online and supports the symbolic
  method before job dispatch.
- Disposal method, approvals, wipe outcome/evidence, cleanup and physical
  handover confirmation satisfy policy.

## 10. Authorization

```yaml
permissions:
  - replacement.create_candidate
  - replacement.review
  - asset.retire
  - asset.dispose
  - asset.reactivate
  - data_wipe.execute
scope: tenant plus authoritative asset/site/department scope
asset_retire: approval_required_by_policy
asset_dispose: reauth_required, approval_required, reason_required
asset_reactivate: explicit_terminal_reactivation_policy, reason_required, audit_required
data_wipe_execute: reauth_required, mfa_required, approval_required, reason_required
approval: distinct authorized approver; approval never substitutes for command permission
```

Enforce permission, scope, step-up and approval in the command path. Hiding a
button or possession of an approval reference is not authorization.

## 11. Database / Data Model

Use Asset-owned tenant-scoped aggregates aligned with the data model:

```text
replacement_plans
retirement_records
data_wipe_jobs
disposal_records
```

Add append-only decision/transition/evidence history where needed. Keep wipe
binary evidence in object storage behind the approved storage port; relational
records retain document ID, checksum, method, verification and metadata only.

Required constraints/indexes:

- tenant-scoped foreign keys to canonical Asset and linked records;
- one active replacement/retirement/disposal process per relevant source asset
  where policy disallows duplicates;
- unique idempotency/business references for wipe operation and agent report;
- positive versions, allowed state transitions and immutable terminal
  disposition/history invariants;
- no final disposal while required clearance/wipe evidence is absent;
- indexes for tenant/state/asset, active queue, due review and wipe job lease.

No cross-domain table mutation. Persist references to authoritative clearance
commands/evidence instead.

## 12. API

Protected commands use the existing versioned API convention:

```text
POST /api/v1/replacements
POST /api/v1/replacements/{id}/commands/review
POST /api/v1/replacements/{id}/commands/plan
POST /api/v1/replacements/{id}/commands/mark-new-asset-ready
POST /api/v1/replacements/{id}/commands/start-migration
POST /api/v1/replacements/{id}/commands/complete-migration
POST /api/v1/assets/{id}/commands/retire              # extend existing route
POST /api/v1/assets/{id}/commands/wipe                # async 202 + operation_id
POST /api/v1/agent/data-wipes/claim
POST /api/v1/agent/data-wipes/{id}/commands/report
POST /api/v1/assets/{id}/commands/dispose
POST /api/v1/assets/{id}/commands/reactivate           # approved internal reuse only
```

Commands accept `Idempotency-Key`, `expected_version`, reason and only the
explicitly supported command fields. Wipe/disposal responses expose operation
or aggregate references, never executable content or raw secrets. Reads are
tenant/scope-filtered and never make decisions from a derived search index.

## 13. Commands

```yaml
replacement:
  - REPLACEMENT.CREATE_CANDIDATE
  - REPLACEMENT.REVIEW
  - REPLACEMENT.CREATE_PLAN
  - REPLACEMENT.MARK_NEW_ASSET_READY
  - REPLACEMENT.START_MIGRATION
  - REPLACEMENT.COMPLETE_MIGRATION
asset:
  - ASSET.RETIRE
  - ASSET.DISPOSE
  - ASSET.REACTIVATE   # only authorized internal reuse; never from DISPOSED
data_wipe:
  - DATA_WIPE.START    # asynchronous, policy- and approval-gated
  - DATA_WIPE.REPORT   # authenticated agent/evidence boundary
```

Each command validates source state and all cross-domain clearances through
owning APIs before committing its local state transition.

## 14. Events Produced

Use the normative event names and payloads in the catalog:

```text
REPLACEMENT.CANDIDATE_CREATED
REPLACEMENT.APPROVED
REPLACEMENT.PLAN_CREATED
REPLACEMENT.NEW_ASSET_READY
REPLACEMENT.MIGRATION_STARTED
REPLACEMENT.COMPLETED
RETIREMENT.CANDIDATE_CREATED
RETIREMENT.APPROVED
ASSET.RETIRED
DATA_WIPE.STARTED
DATA_WIPE.COMPLETED
DATA_WIPE.FAILED
DISPOSAL.APPROVED
DISPOSAL.COMPLETED
ASSET.DISPOSED
```

Events use the correct owning aggregate/version, actor, tenant, correlation and
causation metadata, schema version and minimum payload from
`EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`; write them to outbox in the same
transaction as the domain change.

## 15. Events Consumed

No new consumer is required unless the chosen existing owning-domain contract
is event-driven. If consumers are added, use inbox/deduplication and invoke the
Asset/Maintenance/License/Agent application contracts; never mutate their
canonical tables directly.

## 16. Idempotency

- Key source: required `Idempotency-Key` for every retryable command and
  authenticated agent report.
- Hash: canonical semantic request plus actor, tenant, command and business
  scope.
- Same key and same request replays the stored response without repeating
  approvals, transitions, reservations, job execution or events.
- Same key with changed request returns `409 IDEMPOTENCY_KEY_CONFLICT`.
- Wipe retry first reconciles authoritative operation/job state and evidence;
  it never starts another destructive attempt merely because a response was
  lost.

## 17. Concurrency

- Require `expected_version` for each state-changing aggregate.
- Lock the authoritative row and enforce version/state transition in the same
  transaction; return `409 VERSION_CONFLICT` on stale version.
- Enforce active-plan/job/disposal uniqueness and final-disposal invariants in
  the database as well as application validation.
- Serialize disposal against wipe result and cleanup-clearance completion so
  disposal cannot pass on stale evidence.
- Serialize replacement completion against cancellation/plan changes; a late
  migration report cannot complete a cancelled/replaced plan.

## 18. Transaction Boundary

Atomically commit:

```text
Asset-owned canonical aggregate and state/version
replacement/retirement/wipe/disposal history and evidence references
domain outbox event(s)
required durable audit record(s)
operation/idempotency result
Work Queue reference updates owned by Operations API
```

Do not hold a database transaction open for agent execution, wipe verification,
storage calls, human approval, procurement, email or physical handover.

## 19. Async Side Effects

- Agent/provider wipe execution, verification and evidence upload.
- Domain-owned license/access/agent cleanup and clearance collection.
- Replacement preparation, migration, cutover verification and physical return.
- Procurement handoff when flagged; do not create Purchase Orders in this task.
- Timeline/search projection and notification delivery after commit.

Failure or timeout leaves a durable actionable operation/blocker. Reconcile
actual wipe state before any retry.

## 20. Audit Requirements

Append immutable audit for candidate creation/review, approval, plan changes,
replacement readiness/migration/completion, retirement decision and transition,
wipe start/result/evidence, cleanup clearances, disposal approval/finalization
and explicit internal reactivation. Capture actor/system, subject and related
Asset/plan/job/document IDs, before/after state and version, reason, policy and
approval references, timestamp, channel, correlation/causation, evidence and
outcome. Never store credentials, wipe secrets or raw executable commands.

## 21. Timeline Requirements

- Primary: Asset timeline for old/new assets, with links to replacement plan,
  return, retirement, wipe and disposal evidence.
- Secondary: target user's replacement/cutover timeline where the existing
  timeline contract permits.
- Project operator-readable summaries from committed domain events; timeline
  remains a projection and never replaces immutable audit.
- Include replacement approved/new asset ready/migration complete, old asset
  physically returned, retired, wipe completed/failed and final disposition.
- Respect tenant, resource scope and evidence visibility.

## 22. Notification Requirements

Use the existing notification/outbox flow after commit:

- notify required approvers when replacement/retirement/disposal approval is
  needed;
- notify assigned user/operator when replacement asset is ready, migration is
  scheduled, or old-asset return is due;
- notify only relevant operators/approvers for wipe failure, unresolved
  clearance, disposal handover or evidence exception;
- deduplicate delivery and do not disclose low-level wipe evidence to users
  unless policy permits.

## 23. Search / Projection Impact

Update the existing Asset/workspace/timeline projections with replacement,
retirement, wipe and final-disposition status, due dates and actionable
blockers. Search remains derived and cannot authorize retire/dispose decisions.
Do not add a separate authoritative replacement search store.

## 24. Error Codes

Map to the canonical taxonomy; at minimum cover:

```text
NOT_FOUND
VALIDATION_ERROR
PERMISSION_DENIED
REAUTH_REQUIRED
STEP_UP_REQUIRED
APPROVAL_REQUIRED
BUSINESS_RULE_VIOLATION
VERSION_CONFLICT
IDEMPOTENCY_KEY_CONFLICT
OPERATION_IN_PROGRESS
```

Return actionable blocker references without exposing raw SQL, provider
secrets, stack traces or agent payloads.

## 25. Retry / Compensation

```text
Retryable:
  idempotent reads and explicitly safe metadata/notification operations
  replacement preparation only after actual state reconciliation
Non-retryable without reconciliation:
  data wipe, physical destruction, sale/handover, final disposal,
  asset reactivation, replacement cutover
Compensation:
  migration failure keeps old asset active; recover/cancel plan through an
  explicit command. Never undo wipe/disposal by deleting history. A failed wipe
  requires reconciliation, an approved alternative method, or physical
  destruction.
```

## 26. Observability

Carry request/correlation/causation/operation/actor/asset/aggregate IDs. Record
structured outcomes and metrics for replacement decisions, approval wait,
retirement blockers, wipe queued/pass/fail/stale report, clearance latency,
disposal completion, version conflicts and idempotency replays. Avoid logging
raw wipe output or secrets.

## 27. Required Tests

### Unit

- [ ] replacement/retirement/disposal transition rules and separate lifecycle
  dimensions
- [ ] policy method selection, risk/clearance evaluation and explicit
  reactivation rules

### Domain State

- [ ] all allowed transitions, denied transitions, terminal immutability and
  expected-version conflicts

### Repository Integration

- [ ] tenant keys, active aggregate uniqueness, evidence/history immutability,
  wipe/job leases and database disposal invariant

### API

- [ ] permission/scope, approval and requester/approver separation,
  re-auth/MFA, idempotency replay/conflict and operation response

### Event Contract

- [ ] each emitted replacement/retirement/wipe/disposal payload validates
  against catalog and is committed atomically with audit

### E2E

- [ ] replacement using available asset through verified migration and old
  asset return
- [ ] retirement → wipe → disposal with approvals, owner clearances and
  evidence
- [ ] authorized internal reuse retains prior history

### Failure Cases

- [ ] migration failure keeps old asset active
- [ ] active assignment/loan/license/incident/maintenance/legal hold blocks
  retirement or disposal as applicable
- [ ] wipe failure/stale report/missing evidence blocks disposition and remains
  actionable; retry reconciles first
- [ ] duplicate and concurrent approval/retire/dispose/wipe-result commands
  cannot double-transition or bypass clearances
- [ ] tenant-crossing resource/evidence and unauthorized step-up attempts fail

## 28. Acceptance Criteria

1. A candidate retains trigger, score and explainable reason evidence; a review
   decision is authorized, approved where required and versioned.
2. Replacement plans record target user/model, budget, target date,
   procurement/migration needs and current state. Procurement-required plans
   remain actionable without writing Procurement-owned data.
3. The old asset remains active if new-device preparation, migration, cutover
   or verification fails; successful cutover is explicit and idempotent.
4. An assigned old asset is physically returned through the Asset return
   workflow before it can be retired.
5. Retirement checks all applicable active assignment/loan, license, incident,
   maintenance, legal-hold, retention and financial blockers. Failed owner
   commands/clearances cannot be treated as complete.
6. Retirement approval, `ASSET.RETIRE`, version check, retirement record,
   audit and `ASSET.RETIRED` outbox fact commit atomically.
7. Wipe execution is asynchronous, authenticated, asset-bound, policy-approved
   and restricted to supported symbolic methods; no arbitrary commands enter
   the agent boundary.
8. Wipe pass/fail/not-applicable/destruction outcomes and evidence are
   versioned, audited and retained. Failed or uncertain wipe blocks reuse/sale
   and final disposition; no blind retry occurs.
9. Final disposal is impossible until required retirement approval, wipe,
   license/access clearance and physical disposition evidence are complete.
10. Final disposition method and evidence are retained, and the Asset record
    remains readable but non-assignable/non-monitorable per policy.
11. Internal reuse requires explicit policy, authorization, reason, approval
    where required and audit; prior retirement/wipe history remains immutable;
    DISPOSED cannot be reactivated.
12. Same-key retries replay; changed requests conflict; stale versions,
    concurrent commands and tenant-boundary attempts cannot duplicate or
    bypass effects.
13. Events, audit, source records and Work Queue references are tenant-scoped
    and transactionally consistent; notifications/projections run after
    commit.
14. Applicable typecheck, lint, format, unit, contract, migration, integration
    and E2E gates pass; registry, CURRENT_TASK and HANDOFF are reconciled.

## 29. Verification Commands

Discover and run the project commands, including:

```text
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:migration
npm run test:integration
npm run test:e2e
npm test
git diff --check
```

Database tests use `TEST_DATABASE_URL` pointed at the local PostgreSQL
container, following existing test helpers.

## 30. Codex Execution Protocol

When explicitly asked to implement TASK-059:

1. Inspect current repository, dependency reports and relevant migrations.
2. Re-read the listed task specifications and this contract.
3. Map each deliverable to Asset ownership or an owning-domain contract.
4. Report any real `SPEC_CONFLICT` or `SCOPE_DEPENDENCY` before expanding
   scope.
5. Implement only the TASK-059 vertical slice, verify it, update registry,
   CURRENT_TASK and HANDOFF, and commit separately.

## 31. Required Completion Report

After implementation, replace this planning record with:

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

### Database Changes

- Added Asset-owned replacement plans and version history, retirement
  decisions, versioned wipe jobs, disposal records and immutable lifecycle
  evidence history, including tenant references, state/checksum constraints
  and append-only enforcement.
- Added `ASSET_LIFECYCLE` as an actionable Operations work source.
- Serialized Asset eligibility checks for License assignment and Maintenance
  creation against retirement using row locks.

### APIs / Commands

- Added tenant-scoped replacement candidate/review/plan, replacement
  preparation, migration and verified cutover endpoints. Cutover uses the
  Asset owning commands to reserve and assign the replacement; the old Asset
  remains assigned and in service until successful cutover.
- Extended retirement with independently approved review, versioned
  clearances and a durable actionable BLOCKED path. Assigned/in-use Assets can
  have a retirement candidate recorded without changing their lifecycle; the
  Work Queue records the return blocker until TASK-015 return is received.
- Added approved, versioned data-wipe dispatch and agent claim/report routes
  with capability-scoped methods, locking, evidence verification and bounded
  retry behavior.
- Added approved disposal finalization and explicit, evidence-backed internal
  reactivation; disposed Assets remain terminal.
- Routed approval notices only to active users authorized for
  `approval.decide`; failed or unresolved routing leaves an actionable
  Approval Work Queue item.

### Events

- Added payload contracts for the missing replacement, retirement, disposal
  and reactivation events and included disposal evidence references/checksum.
- Lifecycle commands persist outbox events transactionally, with corresponding
  Asset timeline history and requester/approver notifications where required.

### Permissions

- Added explicit `asset.dispose`, `asset.reactivate`, replacement
  create/review and `data_wipe.execute` permissions to the permission catalog.

### Audit / Timeline

- State changes preserve actor, reason, expected version, before/after facts,
  evidence references and correlation metadata in durable audit and
  append-only lifecycle history. Candidate and unresolved blocker work remains
  actionable until its source workflow clears.

### Tests Run

- `npm test`: 70 tests passed across unit, contract, migration, integration
  and E2E suites, including five new TASK-059 database-backed E2E scenarios.
- `npm run format:check`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed, including dependency boundary checks.
- `git diff --check`: passed.

### Remaining Gaps

- No TASK-059 acceptance blocker remains. A production wipe provider and
  evidence-storage adapter must be configured separately; unavailable adapters
  fail closed as specified. Procurement execution remains outside TASK-059.

### Spec Conflicts

- None.

### Assumptions

- Replacement evaluation records explicit score/reason evidence and introduces
  no undocumented scoring weights. Procurement is deferred to Phase 4.
- Required legal-hold, retention, financial, incident and physical-disposition
  clearances are explicit authorized operator attestations until their
  authoritative external systems are integrated.
- Symbolic wipe methods and evidence storage are adapter boundaries; an
  unavailable provider fails closed. Reuse of a RETIRED Asset requires a
  separate approved reactivation with reconditioning evidence; DISPOSED cannot
  be reactivated.

## 32. Scope Expansion Rule

Do not implement Purchase Orders, advanced replacement scoring, new
microservices, a vendor-specific wipe provider or unrelated maintenance.
Report `SCOPE_DEPENDENCY` before materially expanding this contract.

## 33. Spec Conflict Rule

If implementation finds two normative requirements that cannot both be
satisfied, stop that portion and record the exact statements, impact and
smallest proposed resolution. Do not silently alter lifecycle, wipe or
disposal semantics.

## 34. Completion Rule

TASK-059 has reached `CODE_COMPLETE`: all applicable acceptance criteria and
verification gates pass, this implementation report is recorded, and its
implementation is committed separately. Reconcile downstream readiness from
the live dependency statuses; do not begin a downstream task without an
explicit implementation request.
