# TASK-073 — Goods Receipt + Asset Registration + Partial Receipt

## 1. Task Metadata

```yaml
task_id: TASK-073
feature_id: F-042
workflow_id: WF-005
phase: P4
priority: P0
readiness: READY
status: CODE_COMPLETE
owner_domain: procurement
depends_on: TASK-012, TASK-072, TASK-073-R1
```

## 2. Objective

Implement the normative physical Goods Receipt lifecycle, accepted-quantity
progress on issued Purchase Orders, and asynchronous Asset registration for
accepted Asset-tracked units. A posted Goods Receipt is an immutable physical
receiving fact; Asset registration is an independent downstream workflow.

## 3. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `tasks/TASK-072_PURCHASE_ORDER_APPROVAL_AMENDMENT.md`
- `tasks/TASK-073-R1_GOODS_RECEIPT_PARTIAL_RECEIPT_PO_INTEGRATION_CONTRACT.md`

## 4. In Scope

- Procurement/Warehouse-owned Goods Receipt DRAFT, POSTED and CANCELLED lifecycle.
- Goods Receipt draft create/update, atomic post, and draft cancellation.
- Immutable posted receipt snapshot, lines, accepted physical units and evidence references.
- PO accepted-quantity counters/summaries and receipt-state progress.
- PO locking/versioning and required competing-command/concurrent-receipt races.
- Goods Receipt command permissions, tenant/resource authorization, idempotency, audit, outbox and timeline.
- Asynchronous, idempotent Asset registration for accepted Asset-tracked units through the Asset-owned `ASSET.REGISTER_RECEIVED` command.
- Actionable human fallback for blocking receiving exceptions and exhausted Asset-registration retries.
- POSTED-only Goods Receipt evidence for downstream TASK-074 3-Way Match.

## 5. Out of Scope

- Runtime implementation of TASK-074 or invoice matching.
- Service receipt/acceptance.
- Posted-receipt edit, deletion, reversal or correction workflow.
- Over-receipt tolerance, approval or acceptance.
- Full quarantine/disposition resolution workflow.
- Automatic merging of duplicate Assets.
- Synchronous Asset writes in the Procurement Goods Receipt transaction.

## 6. Current Repository Context

TASK-072 supplies PO lifecycle/receipt dimensions, `committed_receipt_count`,
received/remaining quantity summaries, aggregate version/history and PO-side
database fences. The existing Asset lifecycle includes `RECEIVED → AVAILABLE`
through its validation/put-away workflow. No Goods Receipt runtime module is
part of this task contract; inspect current migrations and application
contracts before implementation.

## 7. Domain Rules

- Goods Receipt states are `DRAFT`, `POSTED`, `CANCELLED`; POSTED and CANCELLED are terminal.
- Do not delete Goods Receipt records. POSTED facts are immutable. Reversal/correction is a separate future workflow.
- PO lifecycle and PO receipt state are independent. Only `GOODS_RECEIPT.POST` advances receipt state; it never closes the PO.
- POST is allowed only while PO lifecycle is `ISSUED`; DRAFT, ON_HOLD, CLOSED and CANCELLED are ineligible.
- Supplier/context must match the PO. Every receipt line references a line in the current issued commercial version.
- For each PO line, remaining is ordered quantity minus prior accepted quantity. Every posted accepted line has `accepted_quantity > 0`; cumulative accepted quantity never exceeds ordered quantity.
- Under-receipt is allowed. Over-receipt fails atomically with `GOODS_RECEIPT_OVER_ORDERED_QUANTITY`; there is no tolerance/approval path.
- Observed, accepted and rejected/damaged quantities are distinct. Only accepted quantity advances PO progress. Blocking uncertainty in quantity or item identity prevents POST.
- Serialized/Asset-tracked accepted units require immutable received-unit and serial identity before POST. Duplicate identity within one receipt blocks POST. Serial is not a global Asset key.
- Deterministic/ambiguous existing Asset matches never silently create duplicates or auto-merge. Ambiguity produces exception/human review.
- Procurement must not write Asset tables. After receipt commit, the event workflow invokes Asset-owned `ASSET.REGISTER_RECEIVED` idempotently per `received_unit_id`.
- New Assets start at lifecycle `RECEIVED`, receiving location, assignment `UNASSIGNED`; never `ASSIGNED` or `IN_USE`. `AVAILABLE` requires the existing validation/put-away workflow.
- Assetization failure never unposts receipt; retries are bounded, and exhausted retries create actionable human fallback.
- Only POSTED receipts and accepted quantities count as TASK-074 3-Way Match receiving evidence. DRAFT/CANCELLED do not count.

## 8. State Transitions

```text
none → GOODS_RECEIPT.CREATE → DRAFT
DRAFT → GOODS_RECEIPT.UPDATE_DRAFT → DRAFT
DRAFT → GOODS_RECEIPT.POST → POSTED
DRAFT → GOODS_RECEIPT.CANCEL → CANCELLED
```

PO receipt dimension, changed only by POST:

```text
NOT_RECEIVED → PARTIALLY_RECEIVED
NOT_RECEIVED → FULLY_RECEIVED
PARTIALLY_RECEIVED → PARTIALLY_RECEIVED
PARTIALLY_RECEIVED → FULLY_RECEIVED
```

PO lifecycle is unchanged by receipt posting. Asset registration is a separate
Asset-owned command after commit.

## 9. Preconditions

- Receipt exists in the actor tenant and its expected version matches.
- PO exists in the same tenant, is `ISSUED`, and current aggregate/commercial version matches the receipt references.
- Supplier identity/context matches the PO.
- Each receipt line references a valid PO line in the current issued commercial version.
- Accepted quantities are positive and cumulative accepted quantity stays at or below ordered quantity.
- Serialized/Asset-tracked accepted units have unique-in-receipt stable identity/serial facts.
- No unresolved blocking receiving exception makes accepted quantity/item identity uncertain.
- Caller has exact command permission and tenant/resource scope.

## 10. Authorization

```yaml
permissions:
  read: goods_receipt.read
  create: goods_receipt.create
  update_draft: goods_receipt.update
  post: goods_receipt.post
  cancel: goods_receipt.cancel
scope: tenant and resource scope on every command
reason_required: [GOODS_RECEIPT.CANCEL, implemented exception/manual override]
post_reason_required: false
```

Do not add broad `procurement.manage`. Downstream Asset registration goes
through Asset's application command and internal service authorization; a
Goods Receipt permission does not grant Asset mutation.

## 11. Database / Data Model

Implement owning-domain tables consistent with the canonical model:

```text
procurement.goods_receipts
procurement.goods_receipt_lines
procurement.goods_receipt_units
procurement.receiving_exceptions
```

Persist tenant-bound PO/Supplier/warehouse references, PO code and commercial
version snapshot, supplier display reference, ordered quantity context,
observed/accepted/rejected quantities, PO line links, actor/timestamps,
evidence references, immutable posted snapshot, and stable received-unit IDs.
Append-only receipt/PO state history and constraints must prevent deletion or
mutation after POSTED, invalid state transitions, duplicate unit identity
within a receipt, and cumulative accepted quantity over ordered quantity.
PO progress updates use TASK-072's committed receipt counter, quantity
summaries, version and history boundary.

## 12. API

```text
POST /api/v1/goods-receipts
POST /api/v1/goods-receipts/{id}/commands/update-draft
POST /api/v1/goods-receipts/{id}/commands/post
POST /api/v1/goods-receipts/{id}/commands/cancel
```

Use repository API conventions. Existing-receipt commands require
`expected_version`/`If-Match` and `Idempotency-Key`. POST returns the
committed receipt and resulting PO receipt progress. No synchronous Asset
registration is part of the HTTP command.

## 13. Commands

```yaml
GOODS_RECEIPT.CREATE:
  target: procurement.goods_receipts
GOODS_RECEIPT.UPDATE_DRAFT:
  target: DRAFT receipt
GOODS_RECEIPT.POST:
  target: DRAFT receipt + ISSUED PO aggregate
GOODS_RECEIPT.CANCEL:
  target: DRAFT receipt
  reason: required
ASSET.REGISTER_RECEIVED:
  owner: Asset
  source_identity: received_unit_id
  source_event: GOODS_RECEIPT.POSTED
```

## 14. Events Produced

Goods Receipt owner emits `GOODS_RECEIPT.CREATED`, `.UPDATED`, `.POSTED`,
`.CANCELLED`. PO receipt events are `PO.PARTIALLY_RECEIVED` and
`PO.FULLY_RECEIVED`. POSTED payload references receipt, PO commercial version,
Supplier display reference, receiving location, accepted line references,
stable received-unit IDs and evidence references; it excludes full document
content and protected Supplier financial/tax data.

Emit `PO.PARTIALLY_RECEIVED` for every committed receipt that leaves PO
fulfillment incomplete, including partial-to-partial. Emit
`PO.FULLY_RECEIVED` only on transition into full. Replay cannot duplicate
effects. Asset-owned registration events are emitted only after actual Asset
creation.

## 15. Events Consumed

- `GOODS_RECEIPT.POSTED` by the asynchronous Asset registration workflow.

The consumer uses durable inbox/deduplication and invokes Asset application
commands. It does not write Asset persistence directly.

## 16. Idempotency

Goods Receipt command key scope includes principal, operation and receipt/PO
business scope. Same key plus same semantic payload returns the original
result; same key plus different payload returns `IDEMPOTENCY_KEY_CONFLICT`.
POST replay cannot increment accepted counters or append duplicate audit/
outbox/timeline effects. Asset command idempotency is independently enforced
by tenant plus immutable `received_unit_id`; do not use serial alone.

## 17. Concurrency

- Use expected aggregate versions and serialize receipt POST on the PO row/aggregate.
- Validate remaining line quantity under the same lock/transaction; DB/business invariants prevent over-receipt.
- Required races: last remaining quantity across two receipts; POST vs PO.CANCEL; POST vs PO.HOLD; POST vs PO.AMEND including first receipt; POST vs PO.CLOSE_REMAINDER where relevant.
- Only one conflicting operation may commit. The loser reloads and fails against the current PO lifecycle/version/remaining quantity.
- No outcome may leave a cancelled PO with a competing accepted receipt, a held PO with a stale unvalidated receipt, or both receipts accepted beyond ordered quantity.

## 18. Transaction Boundary

One Procurement/Warehouse transaction atomically commits:

- receipt DRAFT → POSTED;
- immutable receipt snapshot, lines and accepted units;
- PO accepted counters and received/remaining summaries;
- PO receipt state, aggregate version and append-only history;
- durable audit requirement and outbox events.

Any blocking validation/over-receipt failure commits none of these. No Asset
write, notification, document generation or external call occurs in this
transaction.

## 19. Async Side Effects

After commit, `GOODS_RECEIPT.POSTED` drives Asset-owned
`ASSET.REGISTER_RECEIVED` per accepted Asset-tracked unit. Apply inbox and
per-unit idempotency. A downstream failure leaves receipt POSTED and is
retried within a bounded budget; exhaustion creates actionable human work and
visible assetization failure. Successful registration starts lifecycle
RECEIVED/location/UNASSIGNED; put-away/validation may later transition it to
AVAILABLE. Normal successful receiving creates no Work Item.

## 20. Audit Requirements

POST audit includes actor, PO and receipt IDs, receipt state before/after,
PO receipt progress before/after, accepted quantities, correlation ID and
evidence references. Exclude protected financial/bank/tax values. Cancel
records actor, reason and immutable before/after evidence.

## 21. Timeline Requirements

Goods Receipt/PO timeline entries are operator-readable, e.g. “Goods Receipt
GR-xxx posted: 7/10 units accepted” and “PO PO-xxx is now partially
received/fully received”. Asset timeline records its own event only after
Asset registration succeeds. Timeline is not canonical receipt/audit state.

## 22. Notification Requirements

No notification is required for normal receipt POST. Any notification on
receiving exception or exhausted Assetization retry must be driven by its
actionable workflow/policy and remain outside the receipt transaction.

## 23. Search / Projection Impact

No search index is canonical for POST validation. Update authorized receipt/PO
read projections from canonical state. Expose assetization failure/status as
an operational projection without changing the posted receipt fact.

## 24. Error Codes

```text
GOODS_RECEIPT_OVER_ORDERED_QUANTITY
GOODS_RECEIPT_PO_NOT_RECEIVABLE
GOODS_RECEIPT_BLOCKING_EXCEPTION
GOODS_RECEIPT_UNIT_IDENTITY_DUPLICATE
VERSION_CONFLICT
IDEMPOTENCY_KEY_CONFLICT
PERMISSION_DENIED
```

Over-receipt is non-retryable until request/accepted quantity changes and maps
to a canonical business-rule error. Stale PO/receipt versions fail closed.

## 25. Retry / Compensation

Retry only classified transient infrastructure/dependency failures, with
bounded attempts, elapsed time and backoff. Asset registration is idempotent
by received unit. Retry exhaustion creates actionable human fallback; it
never unposts/edits the physical receipt. Receipt reversal/correction is out
of scope and cannot be simulated by deleting history.

## 26. Observability

Carry request/correlation/causation/operation IDs, actor, receipt, PO and
received-unit references. Measure receipt POST success/failure, over-receipt,
version conflict, partial/full progression, duplicate suppression,
assetization retry/exhaustion and actionable fallback creation. Do not log
full documents or protected Supplier values.

## 27. Required Tests

### Unit / Domain / Repository / API / E2E

- [x] Create DRAFT receipt and update DRAFT.
- [x] Post full receipt; post partial receipt; a second partial receipt reaches FULLY_RECEIVED.
- [x] Reject receipt processing for DRAFT, ON_HOLD, CLOSED and CANCELLED PO lifecycle.
- [x] Reject cumulative over-receipt atomically; verify no receipt state, PO quantity, audit or outbox partial commit.
- [x] Same-key/same-payload POST replays once; same-key/different-payload conflicts.
- [x] POSTED receipt is immutable and cannot be cancelled/deleted; DRAFT cancellation requires reason.
- [x] Observed/rejected/damaged quantities do not advance fulfillment; blocking exceptions prevent POST and create actionable Work Queue references.
- [x] Duplicate serialized unit within one receipt blocks creation; existing Asset duplicate does not silently duplicate/merge.
- [x] Asset event redelivery and command retry create no duplicate Asset; Asset failure does not unpost receipt and creates visible fallback work.
- [x] Partial receipt last-quantity concurrency race: ordered 10, accepted 8, concurrent A=2/B=2 yields one success and one failure.
- [x] GOODS_RECEIPT.POST vs PO.CANCEL; vs PO.HOLD; vs PO.AMEND (first receipt); and vs PO.CLOSE_REMAINDER.
- [x] Only POSTED accepted quantities are returned by the Procurement 3-Way Match evidence query; DRAFT/CANCELLED are excluded.
- [x] Tenant/resource scope and each exact `goods_receipt.*` permission are enforced.
- [x] Receipt/PO audit, timeline and event payloads preserve required references without sensitive Supplier/document content.

## 28. Acceptance Criteria

1. Goods Receipt lifecycle and PO receipt dimension match the normative state machines.
2. POST commits immutable receipt facts and PO accepted progress atomically, only for an ISSUED PO and only within ordered quantities.
3. Required expected-version, idempotency, tenant/resource authorization, audit and outbox behavior pass.
4. All required receipt-vs-PO and parallel receipt races serialize safely.
5. Asset registration is asynchronous, Asset-owned, idempotent per received unit, starts RECEIVED/UNASSIGNED at receiving location, and cannot roll back the posted receipt.
6. POSTED alone is authoritative for downstream 3-Way Match.
7. Required tests in section 27 pass; no TASK-074/service-receipt scope is implemented.

## 29. Verification Commands

Discover and run repository `format`, `lint`, `typecheck`, unit, contract,
migration, integration and E2E suites applicable to the implementation.

## 30. Codex Execution Protocol

Implement only TASK-073 runtime scope after explicit user authorization. Follow
the repository task execution protocol and stop on any normative conflict.

## 31. Required Completion Report

### Implementation Report — 2026-09-12

Status: `CODE_COMPLETE`.

- Added Procurement-owned Goods Receipt create, draft update, post and cancel
  commands with tenant-scoped APIs, durable idempotency, expected versions,
  audit, outbox and timeline entries.
- Added receipt/header/line/unit/exception/history persistence and database
  fences for terminal immutability, PO/Supplier/line/version references,
  serialized identity uniqueness, positive accepted quantities and cumulative
  quantity caps.
- POST locks receipt and PO in one transaction, advances accepted PO quantity
  and receipt state only, increments PO aggregate version/history, and emits
  receipt and PO progress events atomically. Over-receipt leaves receipt, PO,
  audit and outbox unchanged.
- Added a Procurement-owned POSTED-only accepted-quantity query for the future
  TASK-074 3-Way Match flow.
- Added asynchronous Asset-owned `ASSET.REGISTER_RECEIVED` processing through
  inbox dedupe and the `asset.receive` service authorization. Registration is
  keyed by immutable `received_unit_id`; new Assets start `RECEIVED`/
  `UNASSIGNED` at the receiving location. Duplicate candidates fail closed;
  permanent/exhausted failures create actionable Work Queue items and appear
  in the receipt read model.
- Verification passed: `npm test` (84 tests), `npm run typecheck`,
  `npm run lint`, targeted Goods Receipt PostgreSQL E2E, and `git diff --check`.
  E2E coverage includes partial/full progression, idempotency, over-receipt
  atomicity, PO-command races, last-quantity receipt races, exception work,
  Asset redelivery and duplicate fallback.

No TASK-074 invoice matching or service-receipt runtime behavior was added.

Report implementation status, files/database/API/commands/events/permissions,
audit/timeline, tests and outcomes, remaining gaps, spec conflicts and
assumptions. Do not claim receipt races, Assetization or 3-Way Match complete
without their respective acceptance evidence.
