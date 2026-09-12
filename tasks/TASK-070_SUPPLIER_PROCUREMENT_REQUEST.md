# TASK-070 — Supplier + Procurement Request

## 1. Task Metadata

```yaml
task_id: TASK-070
feature_id: F-039
workflow_id: WF-P01
phase: P4
priority: P0
readiness: SATISFIED
status: CODE_COMPLETE
owner_domain: procurement
depends_on: TASK-061, TASK-070-R1
```

## 2. Objective

Establish the Procurement-owned Supplier master and Procurement Request
foundation, with tenant-scoped records, authorized commands, idempotency,
concurrency, audit/outbox history and the request lifecycle needed by later
RFQ and purchasing tasks.

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
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`

## 4. In Scope

- Supplier master create/read/update through Procurement-owned application
  contracts and tenant-scoped persistence.
- Procurement Request and line creation, read, submission and the explicitly
  specified review transitions.
- Supplier status, legal/tax identity, preferred/risk fields, contacts and
  sensitive bank-information references, following the approved field access
  policy.
- Source links, requester, business reason, target date, cost center/project,
  estimated amount and currency where provided.
- Durable request codes, idempotency, expected-version checks, authorization,
  audit, outbox and applicable timeline/Work Queue references.
- Database-backed tests for tenant isolation, status/transition rules,
  duplicate retry, concurrency, permission denial and event/audit effects.

## 5. Out of Scope

- RFQ, quotation, comparison or supplier selection execution (TASK-071).
- Budget ledger/check execution, purchase orders, invoice, receipt, contract,
  payment or supplier portal.
- Automatic duplicate-request merging or stock reservation in Asset/Warehouse.
- Vendor-specific accounting, tax, banking or identity integrations.
- Persisting plaintext banking credentials or payment account secrets.

## 6. Current Repository Context

- Procurement has specifications and traceability rows but no owning module or
  migration yet.
- The canonical entities are described in the Procurement sections of the data
  model; Supplier and Procurement Request do not yet have storage tables.
- Shared authorization, UnitOfWork, idempotency, outbox/inbox, audit, timeline,
  approval, Work Queue and API command foundations exist.
- TASK-061 establishes cross-domain search only for implemented P3 sources;
  procurement records are outside that search set.

## 7. Domain Rules

- Supplier and Procurement Request canonical state belongs to Procurement.
- Tenant identity is checked before resource policy; source domains are never
  mutated directly.
- Procurement Request keeps requester, source type/id, reason, lines, target
  date, cost center/project and estimates when supplied.
- Supplier lifecycle follows the normative commands, transitions, permissions,
  events and eligibility rules in sections 10/13 and the referenced workflow,
  state-machine, permission and event specifications.
- `INACTIVE` is reactivatable; Supplier rows are never hard-deleted. Lifecycle
  changes do not cancel or rewrite existing RFQ, Quotation, PO, Invoice or
  Contract records.
- Retries with the same idempotency key and semantics replay the result;
  changed semantics conflict. Duplicate demand must not be silently merged.
- Sensitive banking data is represented only by a protected reference and is
  returned only under an explicitly authorized policy.

## 8. State Transition

Procurement Request transitions defined by the master state machine:

```text
DRAFT → SUBMITTED → UNDER_REVIEW
UNDER_REVIEW → WAITING_BUDGET | WAITING_RFQ | WAITING_APPROVAL
WAITING_* → APPROVED
APPROVED → ORDERED → PARTIALLY_FULFILLED → FULFILLED
```

`REJECTED` and `CANCELLED` are also enumerated states. Implement only
transitions with explicit command/precondition/authorization rules in the
normative specifications. TASK-070 implements `DRAFT → SUBMITTED`; it does not
infer a review command or budget outcome.

## 9. Preconditions

- Authenticated principal and tenant context.
- The applicable supplier/request permission and resource scope are resolved.
- Requester and any referenced source/resource are verified through their
  owning domain read/application contract.
- Request line quantities and supplied money/date fields validate before
  persistence.
- Protected writes carry `Idempotency-Key`; state changes carry
  `expected_version` and a reason where required.

## 10. Authorization

```yaml
permissions_from_spec:
  procurement_request: procurement.request.create, procurement.request.review
  supplier_read_select: supplier.read, supplier.select
  supplier_create: supplier.create
  supplier_profile_update: supplier.update
  supplier_qualification: supplier.approve
  supplier_status: supplier.status.change
  supplier_block: supplier.block
resource: tenant-scoped supplier or procurement request
scope: organization, business unit, cost center, project or tenant as policy allows
high_risk: conditional for supplier/payment-sensitive fields
reauth_required: as policy requires
mfa_required: as policy requires
approval_required: procurement approval remains separate from command permission
```

Supplier mutation permissions are action-specific and mapped exactly as
defined in the permission specification; `supplier.select` is not a Supplier
master write grant. Do not define or use `supplier.manage`. Tenant isolation
and resource scope apply to every Supplier command. Approval permission is
separate from any procurement approval gate.

## 11. Database / Data Model

- Procurement-owned tables for suppliers, supplier contacts/references,
  procurement requests, request lines and append-only transition history.
- Tenant-scoped unique codes and uniqueness constraints for applicable tax
  identifiers; preserve source references and currency/amount precision.
- Enforce request/line tenant consistency, positive quantities, valid Supplier
  and request states and optimistic versions. Supplier lifecycle/profile
  mutations share one monotonic Supplier `version`; never persist a duplicate
  `preferred` flag separate from `state = PREFERRED`.
- Do not hard-delete Supplier records or rewrite Supplier/commercial history.
- Store only `bank_info_reference`, never bank account credentials or raw
  payment secrets.
- Index tenant/state/requester/source and supplier lookup fields needed by
  bounded list/detail queries.

## 12. API

Use protected write routes from the API command contract:

```text
POST /api/v1/procurement-requests
POST /api/v1/procurement-requests/{id}/commands/submit
GET  /api/v1/procurement-requests/{id}
GET  /api/v1/procurement-requests
```

Supplier reads and writes use Procurement-owned APIs and explicit commands;
protected writes follow `POST /api/v1/suppliers/{id}/commands/{action}` (create
may use the collection command endpoint). Every Supplier mutation request
carries `Idempotency-Key`, a non-empty reason and `correlation_id`; existing-
record mutations also carry `expected_version`. DTOs must not expose
restricted banking references by default.

## 13. Commands / Events

- Implement these Procurement-owned Supplier commands:

  ```text
  SUPPLIER.CREATE
  SUPPLIER.UPDATE_PROFILE
  SUPPLIER.APPROVE
  SUPPLIER.MARK_PREFERRED
  SUPPLIER.REMOVE_PREFERRED
  SUPPLIER.SUSPEND
  SUPPLIER.RESUME
  SUPPLIER.BLOCK
  SUPPLIER.UNBLOCK
  SUPPLIER.DEACTIVATE
  SUPPLIER.REACTIVATE
  ```

- Create/update Supplier and execute each lifecycle command through
  Procurement application contracts.
- Create and submit Procurement Request through explicit commands.
- Emit all applicable Supplier master facts (`SUPPLIER.CREATED`,
  `SUPPLIER.UPDATED`, `SUPPLIER.APPROVED`, `SUPPLIER.PREFERRED`,
  `SUPPLIER.PREFERRED_REMOVED`, `SUPPLIER.SUSPENDED`, `SUPPLIER.RESUMED`,
  `SUPPLIER.BLOCKED`, `SUPPLIER.UNBLOCKED`, `SUPPLIER.DEACTIVATED`,
  `SUPPLIER.REACTIVATED`) and catalogued Procurement events only after commit
  through the transactional outbox.
- Emit `PROCUREMENT.REQUEST_CREATED` for the committed `DRAFT` creation and
  `PROCUREMENT.REQUESTED` when submission commits; payloads follow the event
  catalog.
- Project committed Supplier and Procurement Request events into the
  Operations timeline through its application contract; timeline reads require
  the same source-resource permission and scope.
- Commands use the owning Procurement module and never mutate Asset, License,
  Approval or Finance tables directly.

## 14. Idempotency and Concurrency

- Procurement Request create/submit and every Supplier mutation use durable
  idempotency with canonical semantic request hashes.
- Same key/same semantics returns the saved result; same key/different
  semantics returns `409 IDEMPOTENCY_KEY_CONFLICT`.
- Protected state changes require `expected_version`; stale versions return
  `409 VERSION_CONFLICT`.
- Supplier profile and lifecycle mutations share aggregate version fencing.
  Concurrent transitions/profile changes based on the same version cannot both
  commit. A failed competing transition emits no transition event and adds no
  second transition history record.
- Enforce duplicate-source protection in the database where a source type/id
  represents one active request; broader duplicate-demand detection only warns
  or links according to an explicit policy.

## 15. Transaction Boundary

Commit canonical Procurement writes, transition history, idempotency result,
required audit record and outbox event in one local transaction. External
budget, supplier, stock, approval or accounting calls stay outside that
transaction and use durable workflow/reconciliation boundaries.

## 16. Audit / Timeline / Notifications

- Audit actor, before/after, reason, source reference, expected version,
  correlation and outcome for protected mutations.
- Project catalogued events into Procurement timeline; keep audit immutable
  and separate from operator-readable timeline.
- Create actionable Work Queue items only for durable review/approval/failure
  work; do not create duplicate queue items on retry.
- Do not notify or contact suppliers as a side effect of merely creating a
  request or Supplier record.

## 17. Error and Failure Behavior

- Use canonical validation, permission, scope, version and idempotency errors.
- Do not transition a request to approved/ordered when budget or approval
  policy is unresolved.
- Persist actionable retry/reconciliation state for any later external work.
- Never leak Supplier tax/banking data through errors, logs, audit payloads or
  general list/search results.

## 18. Required Tests

- Unit/state-machine tests for every implemented Procurement Request
  transition and invalid state.
- PostgreSQL integration for tenant constraints, lines, source uniqueness,
  idempotency, expected-version races and immutable history.
- API tests for permission/scope denial, safe Supplier fields and error
  contracts.
- Event/audit contract tests for committed facts and rollback behavior.
- E2E request creation/submission with an owning source reference and preserved
  Work Queue/timeline behavior where applicable.
- Tests for every Supplier lifecycle transition and explicitly forbidden
  transition; command-to-permission mapping and tenant/resource-scope denial.
- RFQ candidate eligibility for `PROSPECT`, `APPROVED`, `PREFERRED`; PO issue
  eligibility only for `APPROVED`, `PREFERRED`.
- Concurrent competing Supplier state transitions (and profile-update versus
  lifecycle transition), stale-version rejection, idempotent retry without
  duplicate audit/history/outbox, and preservation of referenced commercial
  records.

## 19. Acceptance Criteria

1. Supplier and Procurement Request data are tenant-bound and owned by the
   Procurement module.
2. A Procurement Request retains validated requester/source/reason/line/date/
   cost context and uses the normative state machine.
3. Authorized create/submit operations are idempotent, versioned where
   state-changing, audited and emitted through the outbox.
4. Retries cannot create duplicate requests, lines, history, events or work
   items.
5. Supplier sensitive data is protected and returned only by an explicitly
   authorized response shape.
6. No procurement command directly writes Asset, License, Approval or Finance
   owned state.
7. All Supplier commands enforce the normative transition/permission matrix,
   tenant/resource scope, version, idempotency, audit and outbox contracts.
8. RFQ/PO supplier eligibility and preservation of historical commercial
   records match the procurement workflow.
9. Competing state commands cannot double-transition and produce one committed
   history/audit/outbox result; required Supplier events have contract tests.
10. Registry, implementation report, CURRENT_TASK and handoff reconcile after
   all verification gates pass.

## 20. Assumptions To Validate

- Cost center, project, budget and source-system references may be opaque IDs
  until their owning integrations exist; they must not create cross-domain
  foreign keys or mutations.
- Stock sufficiency is read through an Asset/Warehouse-owned query/contract;
  this task does not reserve or consume stock.
- The procurement policy may require approvals based on amount/category, but
  thresholds remain configurable and are not hard-coded by this task.

## 21. Blocker / Readiness

TASK-061 and TASK-070-R1 are `CODE_COMPLETE`. The Supplier lifecycle,
permission and event contracts are normative under TASK-070-R1. No unresolved
TASK-070 blocker or `SPEC_CONFLICT` remains. TASK-070 is `CODE_COMPLETE` after
all acceptance criteria and verification gates passed.

## 22. Completion Rule

The Supplier business rules are normative in the referenced specifications
and TASK-070-R1. Implementation report and verification evidence are recorded
below.

## 23. Implementation Report

- Added Procurement-owned Supplier and Procurement Request domain/application
  modules, PostgreSQL migration, tenant constraints, monotonic versions,
  append-only history, request line validation and duplicate-source protection.
- Added Supplier create/read/list/profile update and all normative lifecycle
  commands. Supplier DTO, audit, event and timeline snapshots omit tax and
  banking reference values; mutation reasons containing protected values are
  rejected. RFQ candidate and PO issue eligibility are derived from canonical
  Supplier state.
- Added Procurement Request create/read/list and `DRAFT → SUBMITTED`; no review
  or budget transition was inferred because no corresponding normative
  command/precondition contract exists.
- Added authenticated tenant-scoped APIs, granular permissions, durable
  idempotency, expected-version fencing, transactional audit/outbox writes and
  timeline projection/read authorization.
- Added `PROCUREMENT.REQUEST_CREATED` for persisted drafts and retained
  `PROCUREMENT.REQUESTED` for submission; updated event/workflow and traceability
  contracts accordingly.
- PostgreSQL E2E covers Supplier transitions and forbidden transitions,
  permission denial, safe sensitive-field handling, idempotency, stale version,
  concurrent transition, immutable history, request submission/replay,
  duplicate-source rejection, timeline and tenant isolation.
- Verification passed: `npm test` (81 tests: 27 unit/architecture, 2 contract,
  1 migration, 21 integration, 30 E2E), `npm run typecheck`, `npm run lint`,
  targeted Prettier check and `git diff --check`.
- Remaining boundary: source/cost-center/project references are tenant-scoped
  opaque IDs until their owning-domain integrations provide authoritative
  verification. Requester identity is verified through Identity.
