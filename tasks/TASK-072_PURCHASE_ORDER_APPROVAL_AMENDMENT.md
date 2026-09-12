# TASK-072 — Purchase Order + Approval + Amendment

## 1. Task Metadata

```yaml
task_id: TASK-072
feature_id: F-041
workflow_id: WF-P03
phase: P4
priority: P0
readiness: READY
status: NOT_STARTED
owner_domain: procurement
depends_on: TASK-036, TASK-071, TASK-072-R1
```

## 2. Objective

Implement Procurement-owned Purchase Order draft, issue, hold/resume,
pre-receipt cancellation, conditional approval gates, immutable issued-PO
amendment, fulfilled close and partial close-remainder using the normative
contract in TASK-072-R1.

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
- `docs/APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`
- `tasks/TASK-072-R1_PURCHASE_ORDER_LIFECYCLE_APPROVAL_AMENDMENT_CONTRACT.md`

## 4. In Scope

- Procurement-owned PO persistence with independent lifecycle and receipt
  dimensions, aggregate version, commercial version, tenant-bound source
  references, lines and append-only history.
- Commands: `PO.CREATE`, `PO.UPDATE_DRAFT`, `PO.ISSUE`, `PO.HOLD`,
  `PO.RESUME`, `PO.AMEND`, `PO.CANCEL`, `PO.CLOSE` and
  `PO.CLOSE_REMAINDER`.
- Supplier eligibility and awarded RFQ/accepted quotation guard at issue.
- Optional linked `PO_ISSUE` and `PO_AMENDMENT` approval validation against
  current versions and canonical context snapshots. Do not create approval
  requests or require approval when none is linked.
- Immutable issued commercial version 1 and append-only pre-receipt amendment
  versions; approval snapshot binding and stale-approval rejection.
- Permission/scope, expected version, idempotency, reasons, audit, outbox and
  Operations timeline projection.
- DB/API/integration tests for lifecycle, terminality, invariants and
  TASK-072-owned concurrency cases.

## 5. Out of Scope

- Goods Receipt creation/approval, receipt quantity ledger and
  `receipt_state` progression. TASK-073 owns these writes and receipt-state
  events.
- Goods Receipt concurrency test implementation for `PO.HOLD` vs receipt and
  `PO.CANCEL` vs receipt. TASK-073 owns those end-to-end races; TASK-072 must
  expose PO-side serialization and fail-closed guards.
- Amendments after any partial/full receipt.
- Automatic approval request creation, an approval-policy selector, or a
  blanket PO approval requirement.
- Supplier change after issue; cancel an unreceived PO and create a new one.
- Goods Receipt, invoice, payment, contract or external supplier portal
  execution.

## 6. Current Repository Context

- Procurement owns Supplier, Procurement Request, RFQ and Quotation.
- Platform command, idempotency, outbox, audit and timeline foundations exist.
- TASK-072-R1 defines the PO contract; PO runtime persistence and commands are
  not implemented.
- TASK-073 owns receipt creation and receipt-state progression.

## 7. Domain Rules

- Lifecycle and receipt state are independent:
  `DRAFT | ISSUED | ON_HOLD | CLOSED | CANCELLED`; and
  `NOT_RECEIVED | PARTIALLY_RECEIVED | FULLY_RECEIVED`.
- `CLOSED` and `CANCELLED` are terminal. Receipt states are never lifecycle
  states. A new PO begins `DRAFT/NOT_RECEIVED`.
- Issue requires Supplier `APPROVED` or `PREFERRED`. If RFQ-linked, require
  RFQ `AWARDED`, PO Supplier equal to winning Supplier, and source quotation
  equal to accepted quotation.
- A linked `PO_ISSUE` approval must be same-tenant, target the current PO, have
  the correct type, be `APPROVED`, and bind current aggregate/commercial
  context. No link means no approval requirement. Do not auto-create it.
- Draft edits use `PO.UPDATE_DRAFT`; post-issue changes use `PO.AMEND` only
  while `ISSUED` or `ON_HOLD` and `NOT_RECEIVED`.
- Each issue/amendment commercial snapshot/version is immutable. Supplier
  cannot change after issue. Received commercial terms are immutable under
  TASK-072.
- Cancellation after any committed Goods Receipt is forbidden even if a
  receipt projection says `NOT_RECEIVED`.
- `PO.CLOSE` requires `FULLY_RECEIVED`; `PO.CLOSE_REMAINDER` requires
  `PARTIALLY_RECEIVED`, reason and preserves all received quantities/history.
- A linked amendment approval must bind the current base version and proposed
  snapshot. Material changes invalidate/re-evaluate approval context.

## 8. State Transitions

Lifecycle:

```text
none → PO.CREATE → DRAFT
DRAFT → PO.UPDATE_DRAFT → DRAFT
DRAFT → PO.ISSUE → ISSUED
DRAFT → PO.CANCEL → CANCELLED
ISSUED → PO.HOLD → ON_HOLD
ON_HOLD → PO.RESUME → ISSUED
ISSUED | ON_HOLD → PO.CANCEL → CANCELLED (NOT_RECEIVED and no receipt)
ISSUED | ON_HOLD → PO.CLOSE → CLOSED (FULLY_RECEIVED)
ISSUED | ON_HOLD → PO.CLOSE_REMAINDER → CLOSED (PARTIALLY_RECEIVED)
```

Receipt dimension, written by TASK-073:

```text
NOT_RECEIVED → PARTIALLY_RECEIVED → FULLY_RECEIVED
```

## 9. Preconditions

- Existing PO exists in the exact source state and `expected_version` matches.
- Actor has mapped permission and tenant/resource scope.
- Issue Supplier, RFQ and accepted quotation satisfy canonical guards.
- A current linked approval request, if any, matches tenant, PO, purpose,
  state and exact version/context snapshot.
- Amendment lifecycle is `ISSUED` or `ON_HOLD`, receipt state is
  `NOT_RECEIVED`, Supplier is unchanged, and proposal binds to current base
  version. Any linked approval must approve the exact proposal snapshot.
- Cancel checks both `receipt_state=NOT_RECEIVED` and absence of a committed
  Goods Receipt.
- Hold/resume/cancel/amend/close-remainder require non-empty reason.

## 10. Authorization

```yaml
permissions:
  PO.CREATE: po.create
  PO.UPDATE_DRAFT: po.update
  PO.ISSUE: po.issue
  PO.HOLD: po.hold
  PO.RESUME: po.hold
  PO.CANCEL: po.cancel
  PO.AMEND: po.amend
  PO.CLOSE: po.close
  PO.CLOSE_REMAINDER: po.close
  read: po.read
approval_decisions: approval.decide
resource_scope: tenant and PO/source-resource scope
approval_required: conditional on current linked request
```

Approval-decision authority is separate from PO permissions. Approval does not
grant command permission.

## 11. Database / Data Model

- `procurement.purchase_orders`: lifecycle, receipt state, aggregate version,
  current commercial version, RFQ/accepted quotation links and current issue
  approval reference.
- `procurement.purchase_order_lines`: mutable DRAFT working lines and
  version-bound issued lines.
- `procurement.purchase_order_versions`: immutable normalized commercial
  snapshots/hash, base version, reason, actor, correlation and approval
  reference.
- Append-only PO aggregate history for lifecycle/receipt transitions and
  before/after snapshots.
- Tenant-bound FKs and source relationship invariants; immutable version and
  history constraints/triggers; receipt existence checked against canonical
  Goods Receipt records owned by TASK-073.
- Receipt/invoice quantities do not mutate commercial version lines.

## 12. API

Protected commands follow the API command contract:

```text
POST /api/v1/purchase-orders
POST /api/v1/purchase-orders/{id}/commands/update-draft
POST /api/v1/purchase-orders/{id}/commands/issue
POST /api/v1/purchase-orders/{id}/commands/hold
POST /api/v1/purchase-orders/{id}/commands/resume
POST /api/v1/purchase-orders/{id}/commands/amend
POST /api/v1/purchase-orders/{id}/commands/cancel
POST /api/v1/purchase-orders/{id}/commands/close
POST /api/v1/purchase-orders/{id}/commands/close-remainder
```

Every retryable write requires `Idempotency-Key`; existing aggregate writes
require `expected_version` and correlation ID. Hold, cancel, amend and
close-remainder require reason. Amendment may carry an optional linked
`approval_request_id` for validation and audit.

## 13. Commands / Events Produced

Commands:

```text
PO.CREATE
PO.UPDATE_DRAFT
PO.ISSUE
PO.HOLD
PO.RESUME
PO.AMEND
PO.CANCEL
PO.CLOSE
PO.CLOSE_REMAINDER
```

Events:

```text
PO.CREATED
PO.UPDATED
PO.ISSUED
PO.HELD
PO.RESUMED
PO.AMENDED
PO.CANCELLED
PO.CLOSED
PO.REMAINDER_CLOSED
```

TASK-072 does not emit receipt progression events. TASK-073 owns
`PO.PARTIALLY_RECEIVED` and `PO.FULLY_RECEIVED`.

## 14. Events Consumed

- Approval Engine/application contract for current `PO_ISSUE` and
  `PO_AMENDMENT` approval references and context snapshots.
- Do not make direct cross-domain writes to Approval or Goods Receipt tables.

## 15. Idempotency

- Key source: `Idempotency-Key`, scoped to tenant/actor/command/resource.
- Same key and semantic request replays the prior result.
- Same key with different semantic request returns
  `IDEMPOTENCY_KEY_CONFLICT`.
- No second version, history, audit or event on replay.

## 16. Concurrency

- Use `aggregate_version`/`expected_version` for all existing PO commands.
- Serialize `PO.UPDATE_DRAFT` vs `PO.ISSUE`; exactly one command based on the
  same DRAFT version commits.
- Serialize `PO.AMEND` vs `PO.CANCEL`; losing stale command has no effects.
- Provide a PO aggregate lock/invariant consumed by TASK-073 so hold/cancel
  serialize against receipt posting. TASK-073 owns end-to-end tests for both
  receipt races.
- Do not rely only on application prechecks for receipt absence or version
  validity.

## 17. Transaction Boundary

Atomically commit canonical PO changes, immutable commercial version/lines,
aggregate history, idempotency result, required durable audit reference and
outbox event. No approval wait, external call, notification or Goods Receipt
workflow runs inside the transaction.

## 18. Async Side Effects

- Timeline/read projections update from committed outbox facts.
- Approval creation/decision and supplier notification remain outside the PO
  transaction.
- Goods Receipt posting remains in TASK-073.

## 19. Audit Requirements

Record actor, PO subject, before/after lifecycle and receipt dimensions,
aggregate/commercial versions, reason, approval reference/context hash,
correlation, related procurement request/RFQ/quotation and outcome. Do not
rewrite prior audit or commercial-version history.

## 20. Timeline Requirements

Project committed PO lifecycle events to the Operations timeline under
existing tenant/resource visibility. Idempotent replay must not duplicate
timeline entries. Receipt timeline events remain owned by TASK-073.

## 21. Notification Requirements

No new external notification provider/channel. Any existing PO notice is
asynchronous from committed events and outside the transaction.

## 22. Search / Projection Impact

PO detail and list reads use canonical Procurement state and enforce scope.
Update existing PO projections from lifecycle events; do not make search the
authority for issue, amendment, cancellation or close guards. Receipt
projection updates are TASK-073-owned.

## 23. Error Codes

Map invalid lifecycle/receipt state, ineligible Supplier, invalid RFQ or
quotation source, stale/missing approval, stale amendment context, receipt
exists, permission/scope denial, `VERSION_CONFLICT` and
`IDEMPOTENCY_KEY_CONFLICT` to canonical errors. Do not expose SQL details.

## 24. Retry / Compensation

Idempotent replay returns the committed result. Version, lifecycle, receipt
and approval-context conflicts are not blindly retried. Cancellation,
amendment and short-close are explicit auditable commands; never delete
historical versions or compensate by rewriting them.

## 25. Observability

Carry request/correlation/causation, actor, PO ID, lifecycle/receipt state,
aggregate/commercial version and approval reference/hash in structured logs
and relevant metrics. Never log sensitive commercial payloads unnecessarily.

## 26. Required Tests

### Unit / Domain State

- Every normative lifecycle transition succeeds from valid state and fails
  from invalid/terminal state.
- Independent lifecycle and receipt dimensions; no receipt state appears in
  lifecycle enum.
- Supplier, RFQ and accepted quotation guards.
- Optional approval with no link; linked approved; PENDING/REJECTED/EXPIRED/
  CANCELLED; wrong tenant/target/type; stale aggregate/context snapshot.
- Draft update and immutable commercial amendment/version/hash behavior.
- Amendment blocked after partial/full receipt and for Supplier change.
- Cancel denied after any committed receipt; full close and partial remainder
  close preserve receipt history and reason.

### Repository / API / Event / E2E

- Tenant/resource permission and denial for every command; reason validation.
- Idempotency replay/conflict, expected-version conflict, audit/outbox and
  timeline atomicity.
- DB immutability/append-only invariants for issued versions and history.
- `PO.UPDATE_DRAFT` vs `PO.ISSUE` concurrency.
- `PO.AMEND` vs `PO.CANCEL` concurrency.
- Correct event payloads for all lifecycle events; TASK-073 receipt event
  contract remains separate.

## 27. Acceptance Criteria

1. PO lifecycle and receipt state are separate dimensions with the exact
   TASK-072-R1 transitions and terminal states.
2. Issue enforces Supplier and RFQ/accepted quotation guards.
3. Optional linked approvals validate target, tenant, purpose, state and
   current version/context; no blanket approval rule or auto-created request.
4. Draft updates and issued amendments use distinct commands; issued versions
   are immutable and amendments are blocked after any receipt.
5. Cancellation checks both NOT_RECEIVED and no committed receipt; hold blocks
   new receipt; close and close-remainder enforce their receipt guards and
   preserve history.
6. Permission mapping, scope, idempotency, concurrency, audit, outbox and
   timeline meet normative contracts.
7. TASK-072-owned races pass; TASK-073 receipt races remain assigned to
   TASK-073 and are not claimed complete by this task.
8. Required verification gates pass and registry/current task/handoff are
   reconciled. TASK-073 and later procurement tasks are not implemented here.

## 28. Blockers / Readiness

TASK-072-R1 resolves the PO lifecycle/approval/amendment `SPEC_CONFLICT`.
Dependencies TASK-036 and TASK-071 are `CODE_COMPLETE`; this implementation
task is derived `READY` and remains `NOT_STARTED` until explicitly authorized.
