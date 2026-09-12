# TASK-070 — Supplier + Procurement Request

## 1. Task Metadata

```yaml
task_id: TASK-070
feature_id: F-039
workflow_id: WF-P01
phase: P4
priority: P0
readiness: BLOCKED
status: NOT_STARTED
owner_domain: procurement
depends_on: TASK-061
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
- Supplier statuses are the enumerated `PROSPECT`, `APPROVED`, `PREFERRED`,
  `SUSPENDED`, `BLOCKED` and `INACTIVE` values. A blocked/suspended/inactive
  Supplier must not be selected for a new purchase when policy prohibits it.
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
normative specifications. Do not infer Supplier status transitions or budget
outcomes.

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
resource: tenant-scoped supplier or procurement request
scope: organization, business unit, cost center, project or tenant as policy allows
high_risk: conditional for supplier/payment-sensitive fields
reauth_required: as policy requires
mfa_required: as policy requires
approval_required: procurement approval remains separate from command permission
```

**SPEC_CONFLICT — Supplier write policy is not normative:** the
permission catalog does not define Supplier create/update/status-change
permission codes, and the Supplier status transition matrix is not normative.
Do not substitute `supplier.select` or `procurement.request.review` for those
missing write permissions. The Procurement workflow enumerates statuses but
does not define allowed transitions or Supplier master events. This leaves the
Supplier write portion of TASK-070 without an authorized, auditable command
contract.

Smallest proposed resolution: add one `supplier.manage` permission for Supplier
create/update/status commands; require `expected_version`, reason, audit and
outbox for status changes; define the allowed transitions among the six
catalogued statuses and add `SUPPLIER.CREATED` / `SUPPLIER.STATUS_CHANGED`
payload contracts. Keep `supplier.read` and `supplier.select` separate from
Supplier mutation permission.

## 11. Database / Data Model

- Procurement-owned tables for suppliers, supplier contacts/references,
  procurement requests, request lines and append-only transition history.
- Tenant-scoped unique codes and uniqueness constraints for applicable tax
  identifiers; preserve source references and currency/amount precision.
- Enforce request/line tenant consistency, positive quantities, valid state and
  optimistic versions.
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

Supplier routes and write actions must be added only after the Supplier write
permission and status-transition gap in section 10 is resolved. DTOs must not
expose restricted banking references by default.

## 13. Commands / Events

- Create and submit Procurement Request through explicit commands.
- Emit catalogued Procurement events such as `PROCUREMENT.REQUESTED` and
  applicable state/approval events only after commit through the outbox.
- Add supplier master events only after their payload and state semantics are
  normative; do not fabricate events from database row changes.
- Commands use the owning Procurement module and never mutate Asset, License,
  Approval or Finance tables directly.

## 14. Idempotency and Concurrency

- Create/submit use durable idempotency with canonical semantic request hashes.
- Same key/same semantics returns the saved result; same key/different
  semantics returns `409 IDEMPOTENCY_KEY_CONFLICT`.
- Protected state changes require `expected_version`; stale versions return
  `409 VERSION_CONFLICT`.
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
- Supplier write tests only after its permission, event and transition gap has
  been resolved normatively.

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
7. Supplier write capabilities pass only after section 10's missing
   authorization and status-transition semantics are made normative.
8. Registry, implementation report, CURRENT_TASK and handoff reconcile after
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

TASK-061 is satisfied, but TASK-070 remains `BLOCKED` until the Supplier write
permission, allowed status transitions and event facts become normative. The
Procurement Request-only safe slice can be implemented separately only if the
user explicitly authorizes splitting the current task contract.

## 22. Completion Rule

This is a planning contract only. Implementation has not started. Resolve the
recorded SPEC_CONFLICT before implementing TASK-070; do not silently select a
permission or invent a transition matrix.
