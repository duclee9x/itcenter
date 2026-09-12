# TASK-071 — RFQ + Quotation + Supplier Selection

## 1. Task Metadata

```yaml
task_id: TASK-071
feature_id: F-040
workflow_id: WF-P02
phase: P4
priority: P1
readiness: SATISFIED
status: CODE_COMPLETE
owner_domain: procurement
depends_on: TASK-070, TASK-071-R1
```

## 2. Objective

Implement Procurement-owned RFQ and Quotation creation, draft editing,
submission, evaluation, supplier selection, award, no-award close and
cancellation using the normative contracts in TASK-071-R1 and the referenced
specifications.

## 3. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `tasks/TASK-071-R1_RFQ_QUOTATION_LIFECYCLE_CONTRACT.md`

## 4. In Scope

- RFQ canonical data, tenant isolation, versions and append-only history.
- All RFQ commands and transitions in section 8.
- Quotation canonical data, immutable submitted values, revisions and
  append-only history.
- All Quotation commands and parent-RFQ-driven terminal transitions in section
  8.
- Supplier participation/submission/award eligibility using canonical
  Supplier state.
- Atomic `RFQ.AWARD`, `RFQ.CLOSE_NO_AWARD` and `RFQ.CANCEL` effects on child
  quotations.
- Required approval-policy validation for award, without conflating approval
  with `rfq.award` permission.
- Tenant/resource/supplier scope authorization, idempotency,
  expected-version concurrency, audit, outbox and required timeline projection.
- Database and API tests for lifecycle rules, uniqueness and named concurrency
  races.

## 5. Out of Scope

- RFQ amendment after issue; material change requires cancel and a new RFQ.
- Procurement Request review, budget and approval lifecycle implementation.
- Purchase Order, goods receipt, invoice, contract and payment execution.
- Supplier portal or supplier-facing authentication; if such principals are
  introduced, apply the own-`supplier_id` scope defined in the normative
  contract.
- External email/provider delivery inside the business transaction.

## 6. Current Repository Context

- Procurement owns Supplier and Procurement Request through TASK-070.
- The database migration runner, UnitOfWork, durable idempotency, outbox,
  audit and Operations timeline foundations exist.
- RFQ/Quotation tables and runtime commands are not implemented.
- `RFQ.CREATED`, `QUOTATION.RECEIVED` and `SUPPLIER.SELECTED` were preliminary
  event names; TASK-071 uses the canonical events in TASK-071-R1.

## 7. Domain Rules

- RFQ terminal states: `AWARDED`, `CLOSED_NO_AWARD`, `CANCELLED`.
- Quotation terminal states: `WITHDRAWN`, `DISQUALIFIED`, `ACCEPTED`,
  `REJECTED`, `VOID`.
- Only DRAFT RFQs and DRAFT quotations have editable commercial terms.
- `SUBMITTED` quotation data is immutable. Revisions create a linked record;
  historical submitted values remain unchanged.
- At most one current `SUBMITTED` quotation exists for a tenant/RFQ/Supplier.
- `PROSPECT`, `APPROVED`, `PREFERRED` suppliers can participate and submit.
  Only `APPROVED` and `PREFERRED` suppliers can be awarded.
- `SUSPENDED`, `BLOCKED`, `INACTIVE` suppliers cannot submit new quotations
  or be awarded.
- Supplier eligibility is rechecked at RFQ issue, quotation submission and
  award. A Prospect quotation can be evaluated, then awarded only after the
  supplier becomes APPROVED/PREFERRED.
- RFQ cancellation VOID-transitions only DRAFT/SUBMITTED quotations and never
  rewrites terminal quotation history. Award and close-no-award reject all
  SUBMITTED offers and VOID remaining DRAFT quotations; every quotation is
  terminal when the RFQ becomes terminal.
- RFQ award approval is conditional. When same-tenant `RFQ_AWARD` requests
  target the current RFQ, every linked request must be APPROVED. No linked
  request means no approval is required; TASK-071 does not create one.
- Parent RFQ commands commit RFQ and affected quotation changes atomically.

## 8. State Transition

RFQ:

```text
none → RFQ.CREATE → DRAFT
DRAFT → RFQ.UPDATE_DRAFT → DRAFT
DRAFT → RFQ.ISSUE → OPEN
DRAFT | OPEN | EVALUATING → RFQ.CANCEL → CANCELLED
OPEN → RFQ.CLOSE_SUBMISSIONS → EVALUATING
EVALUATING → RFQ.AWARD → AWARDED
EVALUATING → RFQ.CLOSE_NO_AWARD → CLOSED_NO_AWARD
```

Quotation:

```text
none → QUOTATION.CREATE → DRAFT
DRAFT → QUOTATION.UPDATE_DRAFT → DRAFT
DRAFT → QUOTATION.SUBMIT → SUBMITTED
DRAFT | SUBMITTED → QUOTATION.WITHDRAW → WITHDRAWN
SUBMITTED → QUOTATION.DISQUALIFY → DISQUALIFIED
selected SUBMITTED → parent RFQ.AWARD → ACCEPTED
other active SUBMITTED → parent RFQ.AWARD → REJECTED
active SUBMITTED → parent RFQ.CLOSE_NO_AWARD → REJECTED
remaining DRAFT → parent RFQ.AWARD → VOID
remaining DRAFT → parent RFQ.CLOSE_NO_AWARD → VOID
DRAFT | SUBMITTED → parent RFQ.CANCEL → VOID
```

See TASK-071-R1 for exact terminality, commands, permission mapping, atomic
effects and concurrency rules.

## 9. Preconditions

- RFQ exists in the exact command source state and its expected version
  matches.
- Quotation belongs to the tenant, RFQ and Supplier in the command.
- Submission requires an OPEN RFQ and an eligible Supplier.
- Award requires an EVALUATING RFQ, selected SUBMITTED quotation and current
  APPROVED/PREFERRED Supplier. If linked same-tenant `RFQ_AWARD` approval
  requests target the RFQ, every one must be APPROVED; PENDING, REJECTED,
  EXPIRED or CANCELLED blocks award. Do not create approval requests.
- Request/source references are verified through their owning contract; do
  not mutate another domain's tables. A linked Procurement Request must be in
  `WAITING_RFQ`.
- `expected_version`, idempotency, reason, and authorization are enforced
  where the command contract requires them.

## 10. Authorization

Permissions and command mapping are specified in section 13 and
`PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`. Every command enforces
tenant/resource scope. If supplier-facing principals are introduced,
Quotation create/update/submit/withdraw are scoped to that principal's own
`supplier_id`. Award approval is a separate policy decision.

## 11. Database / Data Model

- Procurement-owned `rfqs`, tenant-bound `rfq_suppliers`, `rfq_history`,
  `quotations` and `quotation_history` tables.
- Positive aggregate versions and append-only history.
- RFQ tenant-bound request relationship and tenant-bound Supplier/RFQ
  quotation references.
- `replaces_quotation_id` plus `revision_number` constrained to the same
  tenant/RFQ/Supplier; revision number unique within that identity.
- Partial unique constraint on `(tenant_id, rfq_id, supplier_id)` for current
  `SUBMITTED` quotations.
- Immutable submitted quotation commercial fields; state may transition only
  through explicit commands.
- Award/cancel/close transaction updates all affected row versions and history
  atomically.

## 12. API

Protected writes use explicit command endpoints under `/api/v1/rfqs` and
`/api/v1/quotations`, following `API_COMMAND_CONTRACT_SPEC.md`; do not use
generic state-changing PATCH.

```text
GET /api/v1/rfqs
GET /api/v1/rfqs/{id}
POST /api/v1/rfqs
POST /api/v1/rfqs/{id}/commands/update-draft
POST /api/v1/rfqs/{id}/commands/issue
POST /api/v1/rfqs/{id}/commands/close-submissions
POST /api/v1/rfqs/{id}/commands/award
POST /api/v1/rfqs/{id}/commands/close-no-award
POST /api/v1/rfqs/{id}/commands/cancel
GET /api/v1/quotations
GET /api/v1/quotations/{id}
POST /api/v1/quotations
POST /api/v1/quotations/{id}/commands/update-draft
POST /api/v1/quotations/{id}/commands/submit
POST /api/v1/quotations/{id}/commands/withdraw
POST /api/v1/quotations/{id}/commands/disqualify
```

Every retryable write requires `Idempotency-Key`; protected state changes
carry `expected_version` and a correlation ID. Command payloads and responses
follow the canonical event/data contracts and enforce supplier scope when
applicable.

## 13. Commands / Events

Implement these exact command names:

```text
RFQ.CREATE
RFQ.UPDATE_DRAFT
RFQ.ISSUE
RFQ.CLOSE_SUBMISSIONS
RFQ.AWARD
RFQ.CLOSE_NO_AWARD
RFQ.CANCEL
QUOTATION.CREATE
QUOTATION.UPDATE_DRAFT
QUOTATION.SUBMIT
QUOTATION.WITHDRAW
QUOTATION.DISQUALIFY
```

Emit the canonical events and payloads from TASK-071-R1:

```text
RFQ.CREATED
RFQ.UPDATED
RFQ.ISSUED
RFQ.SUBMISSIONS_CLOSED
RFQ.CANCELLED
RFQ.AWARDED
RFQ.CLOSED_NO_AWARD
QUOTATION.CREATED
QUOTATION.UPDATED
QUOTATION.SUBMITTED
QUOTATION.WITHDRAWN
QUOTATION.DISQUALIFIED
QUOTATION.ACCEPTED
QUOTATION.REJECTED
QUOTATION.VOIDED
```

`RFQ.AWARD`, `RFQ.CLOSE_NO_AWARD` and `RFQ.CANCEL` may emit child quotation
facts. Write all facts through the outbox in the same transaction as canonical
state, history and required audit. Do not emit the preliminary names
`RFQ.SENT`, `QUOTATION.RECEIVED` or `SUPPLIER.SELECTED`.

## 14. Idempotency and Concurrency

- Same key and semantic request replays the prior result; changed semantics
  return `409 IDEMPOTENCY_KEY_CONFLICT`.
- All relevant aggregate changes use `expected_version` and return
  `409 VERSION_CONFLICT` on a stale value.
- Serialize quotation submit against RFQ close-submissions; submit either
  commits before close and is included in evaluation, or loses with no event.
- Serialize RFQ award against RFQ cancel; exactly one can commit.
- Parallel same-supplier/RFQ submissions result in one current SUBMITTED row;
  enforce with both locking and database uniqueness.
- Parent RFQ decision commands lock the parent and affected quotations in a
  deterministic order and increment versions for every changed quotation.

## 15. Transaction Boundary

Atomically commit RFQ/Quotation canonical changes, histories, idempotency
result, audit records and outbox events. No external provider call or message
delivery may keep the database transaction open.

## 16. Audit / Timeline / Notifications

Audit command actor, subject, before/after, version, correlation and outcome.
Require reason for RFQ cancel, quotation withdraw/disqualify, and award
exceptions. Maintain operator timeline projections from committed events
through the existing Operations application contract. External supplier
notifications are asynchronous and are not a direct side effect in the
business transaction.

## 17. Error and Failure Behavior

- Map invalid state, ineligible supplier, missing approval, duplicate current
  submission, permission/scope denial, version conflict and idempotency
  conflict to canonical errors.
- Failed atomic award/close/cancel commits no partial RFQ or quotation state,
  history, audit or outbox changes.
- A concurrent loser must reread canonical state; never blindly retry an
  irreversible award/cancel.

## 18. Required Tests

- Every RFQ and Quotation transition succeeds from valid source state and is
  rejected from invalid/terminal states.
- Submitted quotation update is rejected; revision withdraw/create/link/
  submit retains prior commercial values.
- Supplier eligibility for participation, submission and award uses current
  canonical Supplier state, including Prospect evaluation without award.
- Award atomically accepts selected, rejects other SUBMITTED offers, VOID
  transitions remaining DRAFT quotations and records linked approval evidence.
- Close-no-award rejects remaining SUBMITTED quotations and VOID transitions
  remaining DRAFT quotations; cancel voids DRAFT/SUBMITTED. All preserve
  terminal history and no terminal RFQ retains a non-terminal quotation.
- Tenant/resource/supplier scope, permission denial, reason, audit/outbox,
  idempotency replay and conflict, expected-version failure and DB unique
  constraint behavior.
- Concurrency: quotation submit vs RFQ close, RFQ award vs cancel, and
  duplicate/parallel same-supplier quotation submit.

## 19. Acceptance Criteria

1. The RFQ and Quotation state machines exactly match TASK-071-R1.
2. RFQ commercial terms cannot change after ISSUE; no open amendment path is
   introduced.
3. Submitted commercial quotation data is immutable; revision uses a linked
   new record.
4. At most one current SUBMITTED quotation exists per tenant/RFQ/Supplier.
5. Supplier eligibility and conditional linked `RFQ_AWARD` approval are
   enforced at command execution against canonical state.
6. Award, close-no-award and cancel update RFQ and child quotations atomically
   with histories, audit and outbox.
7. All commands enforce the normative permission, tenant/resource scope,
   idempotency, expected-version and reason requirements.
8. Named concurrency tests prove no invalid double transition or duplicate
   submission.
9. All verification gates pass and registry/current task/handoff are
   reconciled.

## 20. Blockers / Readiness

No unresolved TASK-071 `SPEC_CONFLICT` or implementation blocker remains.
TASK-070 and TASK-071-R1 are `CODE_COMPLETE`; the user-confirmed terminal
quotation and conditional award-approval clarifications are normative in the
workflow, state-machine, event and task contracts. TASK-071 is
`CODE_COMPLETE`.

## 21. Timeline Requirements

Project committed RFQ and Quotation facts to Operations timelines through the
existing application contract. Timeline reads enforce the same tenant/resource
scope as RFQ/Quotation reads. Do not create a second source of truth or
duplicate timeline entries on idempotent replay.

## 22. Notification Requirements

Any Supplier-facing notification triggered by RFQ issue or an award decision
is asynchronous from committed outbox facts. Keep provider delivery outside
the RFQ/Quotation transaction; do not add a supplier channel/provider beyond
existing notification policy.

## 23. Search / Projection Impact

RFQ and Quotation detail/list reads use canonical Procurement data. Update the
Operations timeline projection where required. Do not make a search index
authoritative for award or other irreversible decisions; any future indexing
uses committed outbox events and is a derived read model.

## 24. Error Codes

Use canonical errors for validation, permission/scope denial, missing RFQ or
Quotation, invalid state/eligibility, missing approval, duplicate current
submission, `VERSION_CONFLICT` and `IDEMPOTENCY_KEY_CONFLICT`. Do not expose
database/provider internals.

## 25. Retry / Compensation

Durable idempotency replays the committed result. Version, state, approval and
uniqueness conflicts are not blindly retried. Local RFQ/Quotation effects are
atomic; if the transaction fails, no partial state/history/audit/outbox effect
remains. External notifications are retried only by their existing bounded
delivery policy.

## 26. Observability

Carry `request_id`, `correlation_id`, `causation_id`, actor, entity type/id and
aggregate version through command handling, audit, outbox and relevant logs.
Do not log full sensitive supplier or quotation data unnecessarily.

## 27. Completion Report

Implemented Procurement-owned, tenant-scoped RFQ and Quotation persistence,
versioned append-only histories, lifecycle commands, scoped API routes,
permissions, durable idempotency, audit, outbox and Operations timeline facts.
The migration enforces tenant-bound references, submitted-quotation
immutability, one current `SUBMITTED` quotation per supplier/RFQ, and terminal
RFQ child-state invariants. RFQ creation validates a linked Procurement
Request in `WAITING_RFQ`; supplier eligibility is rechecked from canonical
state at issue, submit and award.

The explicit clarifications are enforced: award/no-award reject submitted
quotations and void remaining drafts; cancellation voids draft/submitted
quotations; terminal quotations retain their history. Award approval is
conditional on linked same-tenant requests targeting this RFQ with purpose
`RFQ_AWARD`; if any are linked, each must be `APPROVED`. The command neither
requires an unlinked approval nor creates one.

Database-backed E2E coverage verifies command guards, permissions and tenant
scope, idempotency, audit/outbox/timeline, quotation revision and immutability,
terminal child effects, supplier/approval eligibility, and submit-vs-close,
award-vs-cancel and parallel same-supplier submission races. Verification
passed: `npm test` (82 tests), `npm run typecheck`, `npm run lint`,
`npm run format:check` and `git diff --check`. TASK-072 was not implemented.

Final review also verified RFQ history snapshots preserve the candidate Supplier
IDs on creation and draft updates. The submit-vs-close test races an actual
`QUOTATION.SUBMIT` against `RFQ.CLOSE_SUBMISSIONS` and checks that a losing
submission leaves the quotation in `DRAFT` with no submit outbox event.
