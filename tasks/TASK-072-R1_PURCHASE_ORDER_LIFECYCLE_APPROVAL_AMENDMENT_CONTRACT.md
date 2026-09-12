# TASK-072-R1 — Purchase Order Lifecycle + Approval + Amendment Contract

## 1. Task Metadata

```yaml
task_id: TASK-072-R1
feature_id: F-041
workflow_id: WF-P03
phase: P4
priority: P0
readiness: SATISFIED
status: CODE_COMPLETE
owner_domain: procurement
depends_on: TASK-036, TASK-071
```

## 2. Objective

Resolve the normative Purchase Order lifecycle, receipt-state boundary,
conditional approval, immutable amendment, permission, event, data-model and
concurrency contracts before implementation of TASK-072.

## 3. Normative State Dimensions

PO has independent lifecycle and receipt dimensions. Approval is a control
gate, not a PO lifecycle state.

```text
Lifecycle: DRAFT | ISSUED | ON_HOLD | CLOSED | CANCELLED
Receipt:   NOT_RECEIVED | PARTIALLY_RECEIVED | FULLY_RECEIVED
```

`CLOSED` and `CANCELLED` are terminal lifecycle states. Receipt states must
not be modeled as lifecycle states. TASK-072 initializes `receipt_state` to
`NOT_RECEIVED`; TASK-073 owns receipt writes and progression:

```text
NOT_RECEIVED → PARTIALLY_RECEIVED → FULLY_RECEIVED
```

## 4. Normative Lifecycle Transitions

| From | Command | To | Guard / effect |
|---|---|---|---|
| none | `PO.CREATE` | `DRAFT` | Start `NOT_RECEIVED`. |
| `DRAFT` | `PO.UPDATE_DRAFT` | `DRAFT` | Change draft only; increment aggregate version. |
| `DRAFT` | `PO.ISSUE` | `ISSUED` | Validate Supplier/source/approval guards; freeze commercial version 1. |
| `DRAFT` | `PO.CANCEL` | `CANCELLED` | No committed receipt; reason required. |
| `ISSUED` | `PO.HOLD` | `ON_HOLD` | Reason required; fence new receipt posting. |
| `ON_HOLD` | `PO.RESUME` | `ISSUED` | Preserve receipt state. |
| `ISSUED`, `ON_HOLD` | `PO.CANCEL` | `CANCELLED` | Only if `NOT_RECEIVED` and no committed receipt; reason required. |
| `ISSUED`, `ON_HOLD` | `PO.CLOSE` | `CLOSED` | Requires `FULLY_RECEIVED`. |
| `ISSUED`, `ON_HOLD` | `PO.CLOSE_REMAINDER` | `CLOSED` | Requires `PARTIALLY_RECEIVED`; reason required; preserve received history. |

Any committed Goods Receipt forbids cancellation, even if a receipt-state
projection incorrectly says `NOT_RECEIVED`. Use `CANCELLED` for an
unfulfilled PO; use `CLOSED` for a fulfilled or intentionally short-closed PO.
Short close preserves `PARTIALLY_RECEIVED` and all received quantities/history.
No terminal lifecycle transition is allowed.

## 5. Supplier and Source Guards

`PO.ISSUE` requires Supplier state `APPROVED` or `PREFERRED`. If the PO
references an RFQ, the RFQ must be `AWARDED`, the PO Supplier must be the
winning Supplier, and the source quotation must be the accepted quotation for
that RFQ. Supplier cannot change after issue; changing Supplier requires
cancelling an unreceived PO and creating a new PO.

## 6. Conditional Approval

Approval remains separate from PO state and command permission. No approval is
required by default while an approval-policy selector is absent.

For issue, a null `issue_approval_request_id` allows `PO.ISSUE` subject to
other guards. When a current request is linked, it must be same-tenant, target
the current PO, have purpose/type `PO_ISSUE`, be `APPROVED`, and bind the
current aggregate version and canonical issue-context snapshot (including its
commercial snapshot hash). `PENDING`, `REJECTED`, `EXPIRED`, `CANCELLED`, or a
stale/mismatched context blocks issue. Approval for an older PO version cannot
authorize a newer modified draft. The Approval Engine owns setting/replacing
the current link through its application contract; superseded request history
is retained, and TASK-072 cannot clear a current link to bypass the gate.
TASK-072 does not auto-create approval requests.

For amendment, if a linked `PO_AMENDMENT` request exists, it must be
same-tenant, target the current PO, be `APPROVED`, and bind both the base PO
version and proposed change snapshot/context. Otherwise amendment is allowed
subject to its other guards. A material context change invalidates/requires
re-evaluation under Approval Engine context-snapshot rules. An old approval
cannot authorize a newer base version or different proposal.

## 7. Draft Update and Amendment Rules

`PO.UPDATE_DRAFT` is the only editing command while lifecycle is `DRAFT`.
It increments `aggregate_version` and is not an issued-PO amendment.

After issue, `PO.AMEND` is allowed only while lifecycle is `ISSUED` or
`ON_HOLD` and receipt state is `NOT_RECEIVED`. It requires a reason and creates
a new immutable commercial version; prior versions and lines are never
overwritten. Supplier is immutable after issue. Once partial or full receipt
exists, TASK-072 cannot amend supplier, quantity, unit price or any other
commercial term. Use `PO.CLOSE_REMAINDER` where an unreceived balance should
be intentionally short-closed. A future explicit workflow may extend
post-receipt amendment rules.

## 8. Permissions

| Command / read | Permission |
|---|---|
| `PO.CREATE` | `po.create` |
| `PO.UPDATE_DRAFT` | `po.update` |
| `PO.ISSUE` | `po.issue` |
| `PO.HOLD`, `PO.RESUME` | `po.hold` |
| `PO.CANCEL` | `po.cancel` |
| `PO.AMEND` | `po.amend` |
| `PO.CLOSE`, `PO.CLOSE_REMAINDER` | `po.close` |
| PO read | `po.read` |
| Approval decision | `approval.decide` |

Every command enforces tenant/resource scope. Approval decision permission is
not implied by any PO permission.

## 9. Events

Lifecycle events:

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

TASK-073 owns receipt-state events/projections:

```text
PO.PARTIALLY_RECEIVED
PO.FULLY_RECEIVED
```

Receipt events update only `receipt_state`, never PO lifecycle or commercial
version. All event payloads carry the applicable PO aggregate version,
correlation/causation envelope and tenant. Lifecycle payloads include before/
after lifecycle and receipt dimensions; amendment payloads identify base/new
commercial versions and approval reference; hold/cancel/amend/short-close
carry reason.

## 10. Immutable Data and History

Maintain independent `aggregate_version` and `current_commercial_version`.
The current commercial version is null in DRAFT and starts at 1 on issue.
`PO.AMEND` appends the next version. Each immutable version contains a
canonical snapshot/hash of Supplier and source references, currency, all
terms/delivery fields, and the complete line set. Version rows/lines are
append-only. PO lifecycle/receipt changes use append-only aggregate history
with before/after, states, versions, actor, reason and correlation. Goods
Receipt lines bind to the commercial version/line received; receipts do not
rewrite PO commercial history.

## 11. Concurrency and Ownership

- `PO.UPDATE_DRAFT` vs `PO.ISSUE`: serialize on PO aggregate/version; at most
  one command based on the same version commits.
- `PO.AMEND` vs `PO.CANCEL`: serialize on PO aggregate/version; the winner's
  committed state/version fences the competing command.
- `PO.HOLD` vs Goods Receipt and `PO.CANCEL` vs Goods Receipt: serialize on
  the PO identity. While `ON_HOLD` or `CANCELLED`, a receipt cannot commit; a
  committed receipt prevents cancellation. TASK-073 implements and tests the
  Goods Receipt races; TASK-072 implements the PO-side guards/fencing.

## 12. Specification-Only Completion

This remediation updates the procurement workflow, master state machine,
permission matrix, event catalog, data model, implementation traceability,
TASK-072 contract and task registry. It defines no PO runtime behavior and
does not implement TASK-072 or TASK-073.

Verification: cross-document state/command/permission/event/model consistency,
format check and `git diff --check`.
