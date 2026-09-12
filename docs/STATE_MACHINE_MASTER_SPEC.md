# STATE MACHINE MASTER SPEC
## IT Operations Hub — Canonical Lifecycle and Transition Standard

**Version:** 0.1  
**Status:** Foundation Draft  
**Parent:** `PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`  
**Depends on:**  
- `SYSTEM_WORKFLOW_INDEX_TRACEABILITY_MATRIX.md`
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `API_COMMAND_CONTRACT_SPEC.md`
- `APPROVAL_SLA_AUTOMATION_RULES_ENGINE_WORKFLOW.md`

**Purpose:** Define canonical state machines, allowed transitions, transition commands, preconditions, side effects, rollback/compensation rules, terminal states, invariants, transition authorization, event emission, and state-history requirements across all core domains.

---

# 1. Mục tiêu

Tài liệu này gom toàn bộ lifecycle/state rải rác trong các workflow thành một chuẩn duy nhất.

Mỗi state machine phải trả lời:

```text
Current State
→ Allowed Command
→ Preconditions
→ Authorization
→ Approval / Policy Gate
→ Next State
→ Side Effects
→ Domain Event
→ Verification
→ Rollback / Compensation
→ Terminal?
```

Mục tiêu:

- không có transition tùy tiện qua PATCH;
- state transition phải đi qua command cụ thể;
- invariant được kiểm tra trước và sau transition;
- approval/SLA/automation có thể bám vào transition;
- event phát sau commit;
- history đầy đủ;
- terminal state rõ;
- rollback không đồng nghĩa "quay ngược DB";
- state machine nhất quán giữa API, workflow, UI và data model.

---

# 2. State Machine Principle

## 2.1 State is Business Meaning

State phải biểu diễn business meaning, không chỉ technical flag.

Good:

```text
WAITING_VENDOR
PENDING_RETURN
VERIFYING
```

Bad:

```text
STATE_3
PROCESSING_2
ACTIVE_X
```

---

# 3. Transition Principle

Một transition hợp lệ có:

```text
from_state
command
preconditions
to_state
side_effects
events
```

Không cho:

```text
client writes state directly
```

---

# 4. Transition Contract

Canonical:

```yaml
transition:
  entity_type:
  from_state:
  command:
  to_state:
  preconditions:
  permissions:
  approval:
  sla_effect:
  side_effects:
  events:
  verification:
  compensation:
  terminal:
```

---

# 5. State History Contract

Mỗi transition lưu:

```yaml
state_history:
  entity_type:
  entity_id:
  dimension:
  previous_state:
  new_state:
  command_type:
  actor:
  reason:
  occurred_at:
  correlation_id:
  workflow_id:
  aggregate_version:
```

---

# 6. Generic Transition Guards

Mọi transition cần kiểm tra:

```text
Entity exists
Current state still matches
Expected version matches
Permission granted
Scope matches
Required approval complete
Required data present
No conflicting operation
No terminal-state violation
```

---

# 7. Transition Result Types

```text
SUCCESS
REJECTED
WAITING_APPROVAL
WAITING_DEPENDENCY
CONFLICT
FAILED
COMPENSATED
```

---

# 8. Rollback vs Compensation

## Rollback

Local transaction chưa commit:

```text
DB rollback
```

## Compensation

Business action đã commit:

```text
new command reverses/neutralizes prior effect
```

Example:

```text
License reserved
Software deployment fails
→ Reclaim License
```

Không xóa event cũ.

---

# 9. Terminal State Principle

Terminal state không nhất thiết immutable forever, nhưng reactivation phải explicit.

Examples:

```text
DISPOSED
TERMINATED
CLOSED
RETIRED
```

Reopen/reactivate:

```text
special command
policy
reason
audit
```

---

# 10. Multi-Dimensional State Principle

Một entity có thể có nhiều state dimensions độc lập.

Asset:

```text
Lifecycle
Operational
Health
Assignment
Warranty
Compliance
Risk
```

Không ép tất cả vào một state machine duy nhất.

---

# 11. Asset Lifecycle State Machine

States:

```text
PLANNED
PURCHASED
RECEIVED
AVAILABLE
RESERVED
ASSIGNED
IN_USE
REPAIR
RETURNED
RETIRED
DISPOSED
```

For an accepted Asset-tracked unit from a POSTED Goods Receipt, the Asset
aggregate may be created directly in `RECEIVED` only through the explicit
Asset-owned `ASSET.REGISTER_RECEIVED` command; this source-specific creation
does not bypass later validation/put-away before `AVAILABLE`.

---

# 12. Asset Lifecycle Allowed Transitions

```text
PLANNED
→ PURCHASED
→ RECEIVED
→ AVAILABLE
→ RESERVED
→ ASSIGNED
→ IN_USE
```

Receipt-backed registration path:

```text
none → ASSET.REGISTER_RECEIVED → RECEIVED
```

Operational alternatives:

```text
IN_USE
→ REPAIR
→ IN_USE

IN_USE
→ RETURNED
→ AVAILABLE

AVAILABLE
→ RETIRED
→ DISPOSED

REPAIR
→ AVAILABLE
→ IN_USE

RETURNED
→ REPAIR
→ AVAILABLE
→ RETIRED
```

---

# 13. Asset Invalid Direct Transitions

Disallow:

```text
PLANNED → DISPOSED
PURCHASED → IN_USE
IN_USE → DISPOSED
REPAIR → DISPOSED
```

unless dedicated exception/migration workflow explicitly permits.

---

# 14. Asset Lifecycle Transition Table

| From | Command | To | Preconditions | Main Side Effects |
|---|---|---|---|---|
| PLANNED | `ASSET.MARK_PURCHASED` | PURCHASED | PO/approval if required | Link procurement |
| none | `ASSET.REGISTER_RECEIVED` | RECEIVED | Accepted asset-tracked unit from a POSTED Goods Receipt; idempotent by received-unit identity | Create Asset-owned history/outbox; receiving location; assignment `UNASSIGNED` |
| PURCHASED | `ASSET.RECEIVE` | RECEIVED | Goods receipt | Serial verification |
| RECEIVED | `ASSET.MAKE_AVAILABLE` | AVAILABLE | Tagging + validation | Warehouse location |
| AVAILABLE | `ASSET.RESERVE` | RESERVED | Eligible + no conflict | Reservation |
| RESERVED | `ASSET.ASSIGN` | ASSIGNED | User eligible | Assignment |
| ASSIGNED | `ASSET.CONFIRM_HANDOVER` | IN_USE | Handover complete | Owner/location |
| IN_USE | `ASSET.SEND_TO_REPAIR` | REPAIR | Maintenance order | Maintenance |
| IN_USE | `ASSET.RETURN` | RETURNED | Physical receipt | Close assignment |
| RETURNED | `ASSET.MAKE_AVAILABLE` | AVAILABLE | Inspection pass | Warehouse |
| RETURNED | `ASSET.SEND_TO_REPAIR` | REPAIR | Inspection fail | Maintenance |
| AVAILABLE | `ASSET.RETIRE` | RETIRED | Approval | Cleanup |
| RETIRED | `ASSET.DISPOSE` | DISPOSED | Wipe + reclaim + approval | Disposal record |

---

# 15. Asset Lifecycle Invariants

Examples:

```text
IN_USE
→ active assignment required

DISPOSED
→ no active assignment
→ no active license bound to asset where reclaim required
→ data wipe complete if required

REPAIR
→ active maintenance order required

RESERVED
→ active reservation required
```

---

# 16. Asset Assignment State Machine

States:

```text
UNASSIGNED
RESERVED
ASSIGNED
PENDING_RETURN
IN_TRANSIT
TEMPORARY_LOAN
```

Transitions:

```text
UNASSIGNED → RESERVED
RESERVED → ASSIGNED
ASSIGNED → PENDING_RETURN
PENDING_RETURN → UNASSIGNED
ASSIGNED → IN_TRANSIT
IN_TRANSIT → ASSIGNED
UNASSIGNED → TEMPORARY_LOAN
TEMPORARY_LOAN → PENDING_RETURN
```

---

# 17. Asset Operational State Machine

States:

```text
UNKNOWN
ONLINE
OFFLINE
UNAVAILABLE
MAINTENANCE
```

Transitions driven by telemetry/operations.

Example:

```text
ONLINE → OFFLINE
OFFLINE → ONLINE
ONLINE → MAINTENANCE
MAINTENANCE → ONLINE
```

Operational state is not lifecycle.

---

# 18. Asset Health State Machine

States:

```text
UNKNOWN
HEALTHY
WARNING
CRITICAL
```

Transitions:

```text
UNKNOWN → HEALTHY/WARNING/CRITICAL
HEALTHY → WARNING
WARNING → CRITICAL
CRITICAL → WARNING/HEALTHY
```

Health transition should be evidence-based.

---

# 19. Ticket State Machine

States:

```text
NEW
TRIAGE
ASSIGNED
IN_PROGRESS
WAITING_USER
WAITING_VENDOR
WAITING_APPROVAL
WAITING_CHANGE
RESOLVED
CLOSED
REOPENED
CANCELLED
```

---

# 20. Ticket Allowed Transitions

```text
NEW → TRIAGE
TRIAGE → ASSIGNED
ASSIGNED → IN_PROGRESS
IN_PROGRESS → WAITING_USER
IN_PROGRESS → WAITING_VENDOR
IN_PROGRESS → WAITING_APPROVAL
IN_PROGRESS → WAITING_CHANGE
WAITING_* → IN_PROGRESS
IN_PROGRESS → RESOLVED
RESOLVED → CLOSED
RESOLVED → REOPENED
REOPENED → IN_PROGRESS
NEW/TRIAGE → CANCELLED
```

---

# 21. Ticket Invariants

```text
RESOLVED
→ resolution code required
→ resolved_at required

CLOSED
→ resolved_at required

WAITING_USER
→ waiting reason required

ASSIGNED / IN_PROGRESS
→ owner team required
```

---

# 22. Incident State Machine

States:

```text
DETECTED
INVESTIGATING
IDENTIFIED
MITIGATING
MONITORING_RECOVERY
RESTORED
RESOLVED
CLOSED
CANCELLED
```

---

# 23. Incident Transitions

```text
DETECTED → INVESTIGATING
INVESTIGATING → IDENTIFIED
IDENTIFIED → MITIGATING
MITIGATING → MONITORING_RECOVERY
MONITORING_RECOVERY → RESTORED
RESTORED → RESOLVED
RESOLVED → CLOSED
```

Alternative:

```text
INVESTIGATING → MITIGATING
MITIGATING → RESTORED
```

if root cause not yet identified.

---

# 24. Incident Major Flag

Major Incident should be:

```text
attribute / classification
```

not separate state machine.

Example:

```text
is_major = true
```

set via:

```text
INCIDENT.DECLARE_MAJOR
```

---

# 25. Incident Invariants

```text
RESTORED
→ service verification required

RESOLVED
→ restoration confirmed
→ resolution summary required

CLOSED
→ post-resolution checks complete
```

---

# 26. Root Incident Correlation State

Child incident relation states:

```text
CANDIDATE
LINKED
DETACHED
RESOLVED_BY_ROOT
```

---

# 27. Problem State Machine

States:

```text
NEW
UNDER_REVIEW
INVESTIGATING
WORKAROUND_AVAILABLE
KNOWN_ERROR
CHANGE_REQUIRED
VERIFYING_FIX
RESOLVED
CLOSED
CANCELLED
```

---

# 28. Problem Transitions

```text
NEW → UNDER_REVIEW
UNDER_REVIEW → INVESTIGATING
INVESTIGATING → WORKAROUND_AVAILABLE
INVESTIGATING → KNOWN_ERROR
INVESTIGATING → CHANGE_REQUIRED
CHANGE_REQUIRED → VERIFYING_FIX
VERIFYING_FIX → RESOLVED
RESOLVED → CLOSED
```

---

# 29. Problem Invariants

```text
KNOWN_ERROR
→ root cause known
→ workaround or documented known limitation

RESOLVED
→ permanent fix evidence
→ observation window complete
```

---

# 30. Change State Machine

States:

```text
DRAFT
ASSESSMENT
PENDING_APPROVAL
APPROVED
SCHEDULED
IMPLEMENTING
VERIFYING
SUCCESSFUL
FAILED
ROLLED_BACK
CLOSED
CANCELLED
```

---

# 31. Change Transitions

```text
DRAFT → ASSESSMENT
ASSESSMENT → PENDING_APPROVAL
PENDING_APPROVAL → APPROVED
APPROVED → SCHEDULED
SCHEDULED → IMPLEMENTING
IMPLEMENTING → VERIFYING
VERIFYING → SUCCESSFUL
SUCCESSFUL → CLOSED
```

Failure:

```text
IMPLEMENTING → FAILED
FAILED → ROLLED_BACK
ROLLED_BACK → CLOSED
```

---

# 32. Change Invariants

```text
PENDING_APPROVAL
→ risk/impact/plan complete

IMPLEMENTING
→ approved unless Emergency policy

VERIFYING
→ implementation tasks complete

SUCCESSFUL
→ verification pass
```

---

# 33. Maintenance Order State Machine

States:

```text
DRAFT
OPEN
DIAGNOSING
WAITING_APPROVAL
WAITING_PART
WAITING_VENDOR
IN_REPAIR
VERIFYING
COMPLETED
FAILED
CANCELLED
```

---

# 34. Maintenance Transitions

```text
DRAFT → OPEN
OPEN → DIAGNOSING
DIAGNOSING → WAITING_APPROVAL
DIAGNOSING → WAITING_PART
DIAGNOSING → WAITING_VENDOR
DIAGNOSING → IN_REPAIR
WAITING_* → IN_REPAIR
IN_REPAIR → VERIFYING
VERIFYING → COMPLETED
VERIFYING → IN_REPAIR
IN_REPAIR → FAILED
```

---

# 35. Maintenance Invariants

```text
COMPLETED
→ verification result required

WAITING_PART
→ required part reference

WAITING_VENDOR
→ vendor reference

IN_REPAIR
→ technician/vendor assigned
```

---

# 36. Warranty State Machine

States:

```text
UNKNOWN
VALID
EXPIRING
EXPIRED
CLAIM_OPEN
CLAIM_APPROVED
CLAIM_REJECTED
CLAIM_COMPLETED
```

---

# 37. Warranty Transitions

```text
VALID → EXPIRING
EXPIRING → EXPIRED
VALID/EXPIRING → CLAIM_OPEN
CLAIM_OPEN → CLAIM_APPROVED
CLAIM_OPEN → CLAIM_REJECTED
CLAIM_APPROVED → CLAIM_COMPLETED
```

---

# 38. Replacement State Machine

States:

```text
NONE
CANDIDATE
UNDER_REVIEW
APPROVED
PLANNED
PROCUREMENT
NEW_ASSET_READY
MIGRATING
REPLACED
CANCELLED
```

Review decisions `CONTINUE_USE`, `REPAIR_FIRST` and `EXTEND_WARRANTY` close
the replacement as `CANCELLED`; `DEFER` remains `UNDER_REVIEW` and requires a
review date and recorded risk acceptance. A failed or uncertain migration
remains actionable in `MIGRATING`; it never changes the old Asset lifecycle.
Successful completion requires explicit cutover verification and assignment
of the prepared Asset to the target user.

---

# 39. Replacement Transitions

```text
CANDIDATE → UNDER_REVIEW
UNDER_REVIEW → APPROVED
APPROVED → PLANNED
PLANNED → PROCUREMENT
PROCUREMENT → NEW_ASSET_READY
NEW_ASSET_READY → MIGRATING
MIGRATING → REPLACED
```

---

# 40. Retirement / Disposal State Machine

States:

```text
ACTIVE
RETIREMENT_CANDIDATE
APPROVED_FOR_RETIREMENT
RETIRED
DATA_WIPE_PENDING
DATA_WIPED
DISPOSAL_PENDING
DISPOSED
SOLD
RETURNED_TO_VENDOR
RECYCLED
DESTROYED
```

Note:

```text
DISPOSED / SOLD / RETURNED_TO_VENDOR / RECYCLED / DESTROYED
```

can be final disposition outcomes.

The retirement record passes through an approved decision before the Asset
transitions to `RETIRED`. A wipe job has its own `QUEUED → CLAIMED → COMPLETED
| FAILED` state and retains each report as append-only evidence. `FAILED` and
uncertain jobs block reuse and disposition until an independently approved
alternative method or physical destruction is recorded. Final non-reuse
disposition requires confirmed physical handover. `REUSE_INTERNAL` is not a
terminal disposition and may return only a `RETIRED` Asset to `AVAILABLE`
through `ASSET.REACTIVATE`, with separate approval and reconditioning evidence;
`DISPOSED` is never reactivated.

The retirement workflow record has an actionable `BLOCKED` state. A candidate
may be recorded while the Asset is assigned or on loan; the Asset lifecycle is
unchanged, the return blocker is persisted and queued, and
`RETIREMENT.BLOCKED` is emitted. After the Asset-owning return workflow clears
the assignment, an authorized retry re-evaluates all clearances using the
current Asset and retirement record versions. It becomes `RETIRED` only after
the approval and every applicable clearance pass.

---

# 41. Disposal Invariants

Final disposition requires:

```text
retirement approved
active assignments closed
licenses reclaimed
agent/access removed
data wipe pass if required
physical disposition confirmed
```

---

# 42. Audit State Machine

States:

```text
DRAFT
PLANNED
IN_PROGRESS
PAUSED
RECONCILING
COMPLETED
CANCELLED
```

---

# 43. Audit Transitions

```text
DRAFT → PLANNED
PLANNED → IN_PROGRESS
IN_PROGRESS → PAUSED
PAUSED → IN_PROGRESS
IN_PROGRESS → RECONCILING
RECONCILING → COMPLETED
```

---

# 44. Audit Exception State Machine

States:

```text
OPEN
INVESTIGATING
WAITING_CONFIRMATION
RESOLVED
ACCEPTED_EXCEPTION
FALSE_POSITIVE
```

---

# 45. Network Exception State Machine

States:

```text
OPEN
INVESTIGATING
WAITING_CHANGE
WAITING_USER
WAITING_NETWORK_TEAM
WAITING_APPROVAL
RESOLVED
ACCEPTED_EXCEPTION
FALSE_POSITIVE
```

---

# 46. Network Discovery Job State Machine

States:

```text
QUEUED
RUNNING
PARTIAL
COMPLETED
FAILED
CANCELLED
```

---

# 47. Software Request State Machine

States:

```text
REQUESTED
REVIEWING
WAITING_APPROVAL
WAITING_LICENSE
APPROVED
DEPLOYING
INSTALLED
FAILED
REJECTED
CANCELLED
```

---

# 48. Software Deployment State Machine

States:

```text
QUEUED
PRECHECK
DOWNLOADING
VERIFYING_ARTIFACT
INSTALLING
WAITING_REBOOT
POSTCHECK
SUCCESS
FAILED
CANCELLED
ROLLING_BACK
ROLLED_BACK
```

---

# 49. Software Deployment Transitions

```text
QUEUED → PRECHECK
PRECHECK → DOWNLOADING
DOWNLOADING → VERIFYING_ARTIFACT
VERIFYING_ARTIFACT → INSTALLING
INSTALLING → WAITING_REBOOT
INSTALLING → POSTCHECK
WAITING_REBOOT → POSTCHECK
POSTCHECK → SUCCESS
```

Failure:

```text
any execution state → FAILED
FAILED → ROLLING_BACK
ROLLING_BACK → ROLLED_BACK
```

---

# 50. Software Exception State Machine

States:

```text
OPEN
WAITING_APPROVAL
APPROVED_TEMPORARY
REMOVAL_PENDING
RESOLVED
FALSE_POSITIVE
```

Transitions and guards:

```text
OPEN → WAITING_APPROVAL → APPROVED_TEMPORARY
OPEN / WAITING_APPROVAL → FALSE_POSITIVE
OPEN / WAITING_APPROVAL → REMOVAL_PENDING
OPEN / WAITING_APPROVAL → RESOLVED (policy-authorized ignore)
REMOVAL_PENDING → RESOLVED only after complete inventory confirms absence
APPROVED_TEMPORARY → OPEN when its approval expires and the install remains
WAITING_APPROVAL → OPEN when its approval is rejected, expired, or cancelled
```

`FALSE_POSITIVE` and `RESOLVED` are terminal for that exception record. A new
installation occurrence creates a new exception generation and retains prior
history. Agent removal success alone does not resolve the exception.

---

# 51. Artifact State Machine

States:

```text
DRAFT
SCANNING
REVIEW
APPROVED
ACTIVE
DEPRECATED
REVOKED
RETIRED
```

---

# 52. Artifact Transitions

```text
DRAFT → SCANNING
SCANNING → REVIEW
REVIEW → APPROVED
APPROVED → ACTIVE
ACTIVE → DEPRECATED
DEPRECATED → RETIRED
ACTIVE/APPROVED → REVOKED
```

---

# 53. Artifact Invariants

```text
ACTIVE
→ scan passed or approved waiver
→ checksum present

REVOKED
→ no new deployments
```

---

# 54. License Assignment State Machine

States:

```text
RESERVED
ASSIGNED
ACTIVE
SUSPENDED
RECLAIM_PENDING
RECLAIMED
EXPIRED
CANCELLED
```

---

# 55. License Transitions

```text
RESERVED → ASSIGNED
ASSIGNED → ACTIVE
ASSIGNED → CANCELLED (explicit LICENSE.CANCEL_ASSIGNMENT before activation)
ACTIVE → SUSPENDED
ACTIVE/SUSPENDED → RECLAIM_PENDING
RECLAIM_PENDING → RECLAIMED
ACTIVE → EXPIRED
```

`CANCELLED` is terminal and does not consume license capacity. It is valid only
for an unactivated `ASSIGNED` record. `LICENSE.CANCEL_ASSIGNMENT` must reject
`ACTIVE` and `SUSPENDED`; those assignments use the reclaim flow. Cancellation
retains the assignment and append-only history. Concurrent cancellation and
activation serialize on the assignment version: exactly one transition may
commit, and a cancelled assignment can never be activated.

---

# 56. License Compliance State (Calculated Projection)

States:

```text
UNKNOWN
COMPLIANT
AT_RISK
OVERUSED
UNDERUSED
EXPIRED
```

This is calculated state, not manual workflow state.

This projection describes compliance and consumption findings; it is not the
contractual effectiveness of a License Entitlement. Entitlement effectiveness
is derived only from its validity window as specified in the License workflow.
Do not persist or expose this projection as an entitlement lifecycle state.

---

# 57. Procurement Request State Machine

States:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
WAITING_BUDGET
WAITING_RFQ
WAITING_APPROVAL
APPROVED
ORDERED
PARTIALLY_FULFILLED
FULFILLED
REJECTED
CANCELLED
```

---

# 58. Procurement Transitions

```text
DRAFT → SUBMITTED
SUBMITTED → UNDER_REVIEW
UNDER_REVIEW → WAITING_BUDGET
UNDER_REVIEW → WAITING_RFQ
UNDER_REVIEW → WAITING_APPROVAL
WAITING_* → APPROVED
APPROVED → ORDERED
ORDERED → PARTIALLY_FULFILLED
PARTIALLY_FULFILLED → FULFILLED
```

---

# 59. Purchase Order State Machines

Purchase Order has two independent state dimensions. Approval is a control
gate and is not a PO lifecycle state.

```text
Lifecycle: DRAFT | ISSUED | ON_HOLD | CLOSED | CANCELLED
Receipt:   NOT_RECEIVED | PARTIALLY_RECEIVED | FULLY_RECEIVED
```

`CLOSED` and `CANCELLED` are terminal lifecycle states. Receipt progression is
owned by the Goods Receipt workflow/TASK-073; receipt states must not be added
to PO lifecycle.

## 59.1 Lifecycle Transitions

| From | Command | To | Preconditions and effects |
|---|---|---|---|
| none | `PO.CREATE` | `DRAFT` | Set receipt state to `NOT_RECEIVED`; persist versioned draft/history. |
| `DRAFT` | `PO.UPDATE_DRAFT` | `DRAFT` | Update mutable draft and increment aggregate version. |
| `DRAFT` | `PO.ISSUE` | `ISSUED` | Check Supplier/RFQ/Quotation/approval guards; freeze commercial version 1. |
| `DRAFT` | `PO.CANCEL` | `CANCELLED` | Requires no committed Goods Receipt; reason required. |
| `ISSUED` | `PO.HOLD` | `ON_HOLD` | Reason required; fence Goods Receipt posting. |
| `ON_HOLD` | `PO.RESUME` | `ISSUED` | Preserve receipt state. |
| `ISSUED`, `ON_HOLD` | `PO.CANCEL` | `CANCELLED` | Only if receipt state is `NOT_RECEIVED` and no committed receipt exists; reason required. |
| `ISSUED`, `ON_HOLD` | `PO.CLOSE` | `CLOSED` | Requires `FULLY_RECEIVED`. |
| `ISSUED`, `ON_HOLD` | `PO.CLOSE_REMAINDER` | `CLOSED` | Requires `PARTIALLY_RECEIVED`; reason required; preserve received history. |

No other transition is valid. Once any receipt commits, cancellation is
forbidden even if an inconsistent receipt-state value says `NOT_RECEIVED`.
Use `CANCELLED` only for an unfulfilled order and `CLOSED` for a fulfilled or
intentionally short-closed order. `PO.CLOSE_REMAINDER` preserves the actual
partial receipt state and received quantities. A terminal lifecycle cannot
transition again.

## 59.2 Approval Gates

Approval request state is independent of PO lifecycle. No approval request is
required by default for issue or amendment. When the PO has a linked
`PO_ISSUE` request, it must be same-tenant, target the current PO, have
purpose/type `PO_ISSUE`, be `APPROVED`, and bind to the current aggregate
version and canonical issue-context snapshot. PENDING, REJECTED, EXPIRED,
CANCELLED or stale-context requests block issue. Approval for an older PO
version cannot authorize a newer version. TASK-072 does not invent an approval
selector or auto-create requests.

A linked `PO_AMENDMENT` request must be same-tenant, target the current PO,
have purpose/type `PO_AMENDMENT`, be `APPROVED`, and bind to the amendment's
base version and proposed-change context snapshot. A material context change
requires re-evaluation under the Approval Engine snapshot rules. No linked
amendment request means approval is not required.

## 59.3 Receipt State Machine

```text
NOT_RECEIVED → PARTIALLY_RECEIVED
NOT_RECEIVED → FULLY_RECEIVED
PARTIALLY_RECEIVED → PARTIALLY_RECEIVED
PARTIALLY_RECEIVED → FULLY_RECEIVED
```

TASK-073/Goods Receipt owns these transitions and emits the corresponding
`PO.PARTIALLY_RECEIVED` and `PO.FULLY_RECEIVED` facts/projections. Receipt
state changes only on `GOODS_RECEIPT.POST` and never changes PO lifecycle by
itself. A PO is eligible to receive only while `lifecycle_state=ISSUED`; a PO
in `DRAFT`, `ON_HOLD`, `CLOSED` or `CANCELLED` cannot receive goods.
`FULLY_RECEIVED` means accepted ordered quantities are complete; PO closure
remains an explicit `PO.CLOSE` command. `PO.CANCEL` additionally checks both
`NOT_RECEIVED` and absence of a committed Goods Receipt.

## 59.4 Goods Receipt Lifecycle

```text
none → GOODS_RECEIPT.CREATE → DRAFT
DRAFT → GOODS_RECEIPT.UPDATE_DRAFT → DRAFT
DRAFT → GOODS_RECEIPT.POST → POSTED
DRAFT → GOODS_RECEIPT.CANCEL → CANCELLED
```

`POSTED` and `CANCELLED` are terminal. POSTED is an immutable fact; it cannot
return to DRAFT or become CANCELLED. Goods Receipt records are never deleted.
A correction/reversal of a posted receipt requires a separate future
compensating workflow, out of scope for TASK-073. Draft update/cancel does not
change PO progress; cancellation requires a reason.

`GOODS_RECEIPT.POST` is allowed only for a PO in `ISSUED`, with matching
Supplier/context and receipt lines bound to lines of the issued commercial
version. It changes only the PO receipt dimension, never automatically the
PO lifecycle. Only accepted quantity counts. For each PO line,
`remaining_quantity = ordered_quantity - previously_accepted_quantity`, every
posted accepted line quantity is positive, and cumulative accepted quantity
must not exceed ordered quantity. Under-receipt is allowed. Over-receipt
fails atomically with `GOODS_RECEIPT_OVER_ORDERED_QUANTITY`; there is no
tolerance or approval exception in TASK-073.

Observed/received, accepted and rejected/damaged quantities remain distinct.
Rejected/damaged items do not count toward PO fulfillment. Blocking unresolved
exceptions about accepted quantity or item identity prevent POST. Serialized
Asset-tracked units require unit identity/serial facts before POST; duplicate
unit identity within a receipt blocks POST. Serial is not the global Asset
key; deterministic/ambiguous cross-receipt duplicates follow Asset duplicate
handling and are never silently merged.

POST atomically commits immutable receipt snapshot/lines/units, receipt state,
PO accepted counters and receipt summaries, PO receipt dimension/version/
history, audit and outbox. It uses expected version, idempotency, tenant and
resource scope. It serializes on the PO aggregate and enforces quantity
invariants in the database/transaction, including competing receipt posts.
Same key/same request replays the original result; same key/different request
returns `IDEMPOTENCY_KEY_CONFLICT`.

TASK-073 must serialize POST against `PO.CANCEL`, `PO.HOLD`,
`PO.CLOSE_REMAINDER` when relevant, and `PO.AMEND`, including the first
receipt. Two concurrent receipts cannot both consume the same final
remaining quantity. One operation wins the PO version/lock; the loser reloads
and fails if state or quantity guards no longer pass.

## 59.5 Asset Registration from Receipt

Procurement/Warehouse owns Goods Receipt and PO receipt progress; it must not
write Asset tables. After the receipt transaction commits,
`GOODS_RECEIPT.POSTED` drives asynchronous, idempotent Asset-owned
`ASSET.REGISTER_RECEIVED` commands for accepted Asset-tracked units. The stable
idempotency identity is immutable `received_unit_id` or equivalent receipt
unit ID, not free-form serial text. Asset registration creates Lifecycle
`RECEIVED`, receiving warehouse/location and Assignment `UNASSIGNED`; it
never creates `ASSIGNED`/`IN_USE`. Existing validation/put-away later moves
the Asset to `AVAILABLE`.

Assetization failure cannot unpost the receipt. Consumers use inbox and
command idempotency; bounded retry exhaustion creates actionable human work
and visible failure status. Ambiguous Asset match creates exception/human
review, not auto-merge. Normal successful receiving does not create Work
Queue work. Asset-owned event/timeline facts are emitted only after
registration actually succeeds.

## 60. Purchase Order Invariants and Versioning

- `PO.ISSUE` requires Supplier state `APPROVED` or `PREFERRED` and at least one
  valid line. If RFQ-linked, the RFQ must be `AWARDED`, the PO Supplier must
  equal the winning Supplier, and the source quotation must be the accepted
  quotation.
- DRAFT updates and lifecycle changes increment `aggregate_version` and use
  optimistic concurrency. DRAFT commercial values change only through
  `PO.UPDATE_DRAFT`.
- `PO.ISSUE` freezes immutable commercial version 1. `PO.AMEND` is allowed
  only from `ISSUED` or `ON_HOLD` while receipt state is `NOT_RECEIVED`; it
  creates a new immutable commercial version and preserves every prior version.
- Supplier cannot change after issue. To change Supplier, cancel the
  unreceived PO and create a new PO.
- No commercial amendment is allowed after partial or full receipt. Use
  `PO.CLOSE_REMAINDER` for an unreceived balance when appropriate.
- `PO.CLOSE` requires `FULLY_RECEIVED`; `PO.CLOSE_REMAINDER` requires
  `PARTIALLY_RECEIVED`. Neither rewrites receipt history.
- All state-changing commands use idempotency, tenant/resource authorization,
  correlation and audit/outbox as applicable; `expected_version` is mandatory
  for existing PO aggregates. Hold, cancel, amend and short-close require a
  reason.
- Serialize `PO.UPDATE_DRAFT` vs `PO.ISSUE` and `PO.AMEND` vs `PO.CANCEL` on
  the PO aggregate. At most one competing command based on the same version
  commits.
- Serialize `PO.HOLD` vs Goods Receipt posting and `PO.CANCEL` vs Goods Receipt
  posting, `PO.AMEND` vs first receipt, `PO.CLOSE_REMAINDER` vs receipt where
  relevant, and parallel receipts competing for remaining PO-line quantity
  on the PO identity/version. TASK-073 implements and verifies these races;
  receipt is allowed only while `ISSUED`, and the loser revalidates current
  lifecycle, version and quantity under the PO lock.

---

# 61. Invoice Lifecycle State Machine (TASK-074)

Invoice lifecycle is independent from match status and credit status.

```text
none → INVOICE.CREATE → DRAFT
DRAFT → INVOICE.UPDATE_DRAFT → DRAFT
DRAFT → INVOICE.SUBMIT → SUBMITTED
DRAFT → INVOICE.CANCEL → CANCELLED
SUBMITTED → INVOICE.APPROVE → APPROVED
SUBMITTED → INVOICE.REJECT → REJECTED
```

Terminal lifecycle states are `APPROVED`, `REJECTED` and `CANCELLED`.
`SUBMITTED` commercial snapshot is immutable. There is no transition from a
submitted or terminal invoice back to DRAFT. Approval does not represent
payment and TASK-074 has no `PAID` transition.
`INVOICE.CANCEL` is an explicit domain command valid only in `DRAFT`; it is
forbidden after `SUBMITTED` and cannot be represented by a generic status
update. Any future post-submission/post-approval cancellation or reversal is a
separate command and requires its own permission and compensating/reversal
contract.

## 61.1 Independent Invoice Match State

```text
NOT_EVALUATED
PENDING_RECEIPT
MATCHED
MISMATCHED
```

The match result is an independent dimension, and each evaluation is
append-only. `INVOICE.REEVALUATE_MATCH` may add an evaluation for a SUBMITTED
invoice without changing its immutable snapshot. `MISMATCHED` remains
`MISMATCHED` when an authorized `INVOICE_MATCH_EXCEPTION` permits invoice
approval; exception acceptance is separately recorded.

## 61.2 Credit Note Lifecycle and Credit Status

Credit Note lifecycle:

```text
none → CREDIT_NOTE.CREATE → DRAFT
DRAFT → CREDIT_NOTE.UPDATE_DRAFT → DRAFT
DRAFT → CREDIT_NOTE.SUBMIT → SUBMITTED
DRAFT → CREDIT_NOTE.CANCEL → CANCELLED
SUBMITTED → CREDIT_NOTE.APPLY → APPLIED
SUBMITTED → CREDIT_NOTE.REJECT → REJECTED
```

Terminal Credit Note states are `APPLIED`, `REJECTED` and `CANCELLED`.
Submitted Credit Note evidence is immutable. Credit Note application never
rewrites the original Invoice or its lifecycle. An Invoice's derived credit
status is independent: `NONE`, `PARTIALLY_CREDITED` or `FULLY_CREDITED`.
`CREDIT_NOTE.CANCEL` is an explicit domain command valid only in `DRAFT`; it
is forbidden after `SUBMITTED` and cannot be represented by a generic status
update. Any future post-submission/post-application cancellation or reversal
is a separate command and requires its own permission and
compensating/reversal contract.

---

## 61.3 Required Serialization

The owner must serialize duplicate `INVOICE.SUBMIT` attempts on normalized
document identity; competing Invoice allocations on PO-line invoiceable
quantity; `INVOICE.REEVALUATE_MATCH` against Goods Receipt POST/progress;
`INVOICE.APPROVE` against a new match evaluation or changed approval context;
replayed `CREDIT_NOTE.APPLY`; and competing Credit Note applications against
the same remaining creditable Invoice-line quantity/amount. Only one valid
serialized outcome may commit. Enforce durable uniqueness/quantity
invariants, not application pre-checks alone.

# 63. Contract State Machine

Contract legal/commercial lifecycle states:

```text
DRAFT
PENDING_SIGNATURE
EXECUTED
ACTIVE
EXPIRED
TERMINATED
CANCELLED
```

Terminal: `EXPIRED`, `TERMINATED`, `CANCELLED`. Contract usage is independent:
`ENABLED | ON_HOLD`. Approval is an independent Approval Engine state, not a
Contract lifecycle state. Expiring/notice context is derived, not a lifecycle
state. Signature/execution evidence is tracked separately from lifecycle.

---

# 64. Contract Transitions

```text
none → CONTRACT.CREATE → DRAFT
DRAFT → CONTRACT.UPDATE_DRAFT → DRAFT
DRAFT → CONTRACT.SUBMIT_FOR_SIGNATURE → PENDING_SIGNATURE
DRAFT → CONTRACT.CANCEL → CANCELLED
PENDING_SIGNATURE → CONTRACT.RECALL_SIGNATURE → DRAFT
PENDING_SIGNATURE → CONTRACT.RECORD_EXECUTION → EXECUTED
PENDING_SIGNATURE → CONTRACT.CANCEL → CANCELLED
EXECUTED → CONTRACT.ACTIVATE → ACTIVE
EXECUTED → CONTRACT.TERMINATE → TERMINATED
ACTIVE → CONTRACT.EXPIRE → EXPIRED
ACTIVE → CONTRACT.TERMINATE → TERMINATED
```

Forbidden: `EXECUTED/ACTIVE → CANCELLED`, `EXPIRED/TERMINATED → ACTIVE`,
`CANCELLED → DRAFT`. Amendment is an explicit version-creating command only
for EXECUTED/ACTIVE; it does not extend the term. HOLD/RESUME changes only
usage status. Expiration is idempotent at/after end time. Activation requires
EXECUTED, `effective_at <= now < end_at`, valid exact-version execution
evidence and an APPROVED/PREFERRED Supplier.

Contract usage transitions:

```text
ENABLED → CONTRACT.HOLD (reason required) → ON_HOLD
ON_HOLD → CONTRACT.RESUME → ENABLED
```

Renewal Case states are independent:

```text
OPEN
COMPLETED
NOT_RENEWED
CANCELLED
```

Terminal: COMPLETED, NOT_RENEWED, CANCELLED.

```text
none → RENEWAL.OPEN → OPEN
OPEN → RENEWAL.UPDATE_PROPOSAL → OPEN
OPEN → RENEWAL.COMPLETE → COMPLETED
OPEN → RENEWAL.MARK_NOT_RENEWED → NOT_RENEWED
OPEN → RENEWAL.CANCEL → CANCELLED
```

Renewal creates one DRAFT successor and does not mutate the predecessor.
Only one OPEN Case and one canonical successor are allowed per predecessor.
Completion requires successor EXECUTED or ACTIVE. Successor term starts at or
after the predecessor end unless a future explicit overlap policy is defined.

---

# 65. Document State Machine

Commercial Document governance status:

```text
DRAFT
FINAL
SUPERSEDED
VOID
```

Signature status is independent: `NONE | PENDING | PARTIALLY_SIGNED | SIGNED
| DECLINED` (adapted only to repository-equivalent names). A FINAL+SIGNED
document has two separate facts, not one combined status. Finalized content is
immutable; replacement is a new version. SUPERSEDED requires a replacement
reference. VOID is limited to erroneous pre-execution evidence where allowed;
executed evidence is retained and never erased by termination.

---

# 66. Document Invariants

```text
SIGNED
→ signature metadata present

FINAL
→ immutable content version

SUPERSEDED
→ replacement version reference required
```

ContractVersion is an immutable commercial snapshot with monotonically
versioned identity and actor/time/source/reason/evidence references. Submitted
or executed versions are never rewritten. A signature/execution reference must
bind the exact version executed.

---

# 67. User Lifecycle State Machine

States:

```text
PRE_HIRE
ACTIVE
SUSPENDED
LEAVE
TERMINATING
TERMINATED
ARCHIVED
```

---

# 68. User Lifecycle Transitions

```text
PRE_HIRE → ACTIVE
ACTIVE → SUSPENDED
SUSPENDED → ACTIVE
ACTIVE → LEAVE
LEAVE → ACTIVE
ACTIVE/SUSPENDED/LEAVE → TERMINATING
TERMINATING → TERMINATED
TERMINATED → ARCHIVED
```

After a valid Offboarding cancellation and authoritative termination-request
withdrawal, `TERMINATING` may transition back to the captured
`pre_offboarding_user_state` only through an explicit validated Identity
transition. This does not create a transition out of `TERMINATED`.

Rehire:

```text
ARCHIVED/TERMINATED
→ explicit REHIRE workflow
→ PRE_HIRE or ACTIVE
```

---

# 69. Offboarding Case State Machine

States:

```text
INITIATED
IN_PROGRESS
BLOCKED
READY_TO_CLOSE
CANCELLATION_PENDING
COMPLETED
CANCELLED
```

`COMPLETED` and `CANCELLED` are terminal states. Offboarding Case and User
Lifecycle are independent state machines; an Offboarding Case transition never
implicitly changes User Lifecycle.

Normal transitions:

```text
INITIATED → START → IN_PROGRESS
IN_PROGRESS → blocking failure → BLOCKED
BLOCKED → RESUME → IN_PROGRESS
IN_PROGRESS → MARK_READY → READY_TO_CLOSE
READY_TO_CLOSE → COMPLETE → COMPLETED
```

Cancellation transitions:

```text
INITIATED → OFFBOARDING.CANCEL → CANCELLED
  only when no side effect or compensation is required

IN_PROGRESS → OFFBOARDING.REQUEST_CANCEL → CANCELLATION_PENDING
BLOCKED → OFFBOARDING.REQUEST_CANCEL → CANCELLATION_PENDING
READY_TO_CLOSE → OFFBOARDING.REQUEST_CANCEL → CANCELLATION_PENDING
CANCELLATION_PENDING
  → OFFBOARDING.COMPLETE_CANCELLATION
  → CANCELLED
```

`OFFBOARDING.CANCEL` is valid only for `INITIATED` when no compensation is
required. It never restores a User in `TERMINATED`. Cancellation while User
Lifecycle is `TERMINATING` is permitted only after the
authoritative termination request is withdrawn or cancelled. The captured
`pre_offboarding_user_state` may be restored from `TERMINATING` only by an
explicit validated Identity transition. Cancellation never restores a User in
`TERMINATED`; use the separate `USER.REACTIVATE` / REHIRE workflow. The
`OFFBOARDING.CANCEL` operation must not perform that reactivation.

After side effects begin, cancellation requires compensating/recovery actions.
Historical actions are retained. `CANCELLATION_PENDING` can become `CANCELLED`
only after all required recovery actions succeed or are explicitly
policy-authorized as `WAIVED` / `ACCEPTED_EXCEPTION`. Irreversible actions such
as completed data wipe or disposal are not rolled back and require recovery or
manual exception work.

All state-changing commands enforce expected version, idempotency,
authorization, reason, audit, outbox and correlation ID where applicable.
`COMPLETE` and `OFFBOARDING.REQUEST_CANCEL` serialize on the Offboarding Case
version/aggregate lock; only one may win. A stale competing command fails with
a version conflict and cannot overwrite the successful transition. When a
command explicitly changes both the Offboarding Case and User Lifecycle, it
validates both aggregate versions and commits both explicit transitions
atomically; neither transition is inferred from the other.

---

# 70. Offboarding Invariants

```text
READY_TO_CLOSE
→ all mandatory tasks succeeded or policy-approved waived
→ no unresolved blockers
→ authoritative termination request remains valid
→ no cancellation is pending

COMPLETED
→ canonical User Lifecycle is TERMINATED (observed or produced by normative
  finalization)
→ login revoked
→ privileged access revoked
→ required asset return resolved/exception accepted
→ licenses reclaimed/exception accepted
→ ownership transferred where required

CANCELLED
→ all required recovery actions succeeded or policy-authorized waived/
  accepted exception
→ authoritative termination request is withdrawn/cancelled
→ historical actions remain unchanged

COMPLETED is terminal; COMPLETED → CANCELLED is forbidden.
User Lifecycle restoration is a separate explicit validated Identity
transition from TERMINATING to pre_offboarding_user_state. A TERMINATED User
is never restored by Offboarding cancellation.
```

---

# 71. Approval State Machine

States:

```text
PENDING
IN_PROGRESS
APPROVED
REJECTED
CHANGES_REQUESTED
EXPIRED
CANCELLED
```

---

# 72. Approval Step State Machine

States:

```text
PENDING
ACTIVE
APPROVED
REJECTED
SKIPPED
EXPIRED
```

---

# 73. SLA State Machine

States:

```text
RUNNING
PAUSED
WARNING
CRITICAL
BREACHED
MET
CANCELLED
```

---

# 74. SLA Transition Rules

```text
RUNNING → WARNING
WARNING → CRITICAL
CRITICAL → BREACHED
RUNNING/WARNING/CRITICAL → PAUSED
PAUSED → RUNNING
RUNNING/WARNING/CRITICAL → MET
```

`WARNING` and `CRITICAL` may be derived thresholds rather than persisted states depending implementation.

---

# 75. Automation Rule Lifecycle

States:

```text
DRAFT
REVIEW
ACTIVE
DISABLED
DEPRECATED
RETIRED
```

---

# 76. Automation Execution State Machine

States:

```text
QUEUED
RUNNING
WAITING_APPROVAL
WAITING_DEPENDENCY
RETRYING
ROLLING_BACK
SUCCEEDED
FAILED
COMPENSATED
CANCELLED
```

---

# 77. Work Item State Machine

States:

```text
NEW
ASSIGNED
IN_PROGRESS
WAITING_USER
WAITING_VENDOR
WAITING_APPROVAL
WAITING_CHANGE
ON_HOLD
RESOLVED
CLOSED
REOPENED
```

---

# 78. Notification Delivery State Machine

States:

```text
QUEUED
SENT
DELIVERED
READ
ACKNOWLEDGED
FAILED
BOUNCED
SUPPRESSED
```

Channel support varies.

---

# 79. Channel Connection State Machine

States:

```text
HEALTHY
DEGRADED
FAILED
AUTH_EXPIRED
DISABLED
```

---

# 80. Report Job State Machine

States:

```text
QUEUED
RUNNING
GENERATED
DELIVERED
FAILED
CANCELLED
```

---

# 81. Generic Transition Authorization

Each transition maps to permission.

Example:

```text
AVAILABLE → RESERVED
Command: ASSET.RESERVE
Permission: asset.reserve

RESERVED → ASSIGNED
Command: ASSET.ASSIGN
Permission: asset.assign

RETIRED → DISPOSED
Command: ASSET.DISPOSE
Permission: asset.dispose
```

---

# 82. Transition Approval Gate

Examples:

```text
Asset Dispose
→ Approval required

High Repair Cost
→ Approval required

PO Issue above threshold
→ Approval required

Privileged Access
→ Approval required
```

State transition waits in existing state or explicit waiting state.

---

# 83. Transition SLA Effects

Examples:

```text
Ticket IN_PROGRESS → WAITING_USER
→ resolution SLA pause if policy allows

Ticket WAITING_USER → IN_PROGRESS
→ resume SLA

Approval PENDING
→ approval SLA starts

Incident RESTORED
→ restoration SLA target met
```

---

# 84. Transition Automation Hooks

Before transition:

```text
pre-transition rule
```

After commit:

```text
post-transition event
```

Do not let automation silently alter state inside unrelated transaction unless same domain owns both.

---

# 85. Transition Side Effect Classification

## Strong transactional side effects

Must succeed atomically:

```text
create assignment
update asset owner
close reservation
create movement
```

## Async side effects

Can happen after commit:

```text
send notification
generate PDF
update search index
update report projection
```

---

# 86. Transition Verification

Some transitions require verification before final next state.

Example:

```text
IN_REPAIR → VERIFYING → COMPLETED
```

instead of:

```text
IN_REPAIR → COMPLETED
```

---

# 87. Transition Compensation Registry

Examples:

| Original Action | Failure | Compensation |
|---|---|---|
| License reserved | Install failed | Reclaim license |
| Asset assigned | Handover cancelled before use | End assignment + return to Available |
| VLAN changed | Verification failed | Restore previous VLAN |
| New software installed | Health degraded | Rollback software |
| Procurement reservation | Request cancelled | Release reservation |

---

# 88. State Invariant Validation

Validate:

```text
before transition
after transition
periodically via consistency checker
```

---

# 89. Consistency Checker

Scheduled rules:

```text
Disposed asset with active assignment
Closed ticket without resolution
Active license past entitlement expiry
Completed audit with critical unresolved exceptions
Terminated user with privileged role
```

Create Data/Control Exception.

---

# 90. State Transition Event Pattern

Every successful transition emits:

```text
specific domain event
```

and optionally generic:

```text
ENTITY.STATE_CHANGED
```

Specific event preferred for consumers.

---

# 91. Generic Event Example

```yaml
event_type: ASSET.STATE_CHANGED
payload:
  dimension: lifecycle
  previous_state: AVAILABLE
  current_state: RESERVED
  reason: USER_REQUEST
```

---

# 92. State Transition API Pattern

```text
POST /entity/{id}/commands/{action}
```

not:

```text
PATCH state
```

---

# 93. UI State Action Pattern

UI should display only:

```text
allowed transitions
```

based on:

```text
current state
permission
policy
preconditions
```

But backend remains authoritative.

---

# 94. State Transition Preview

For high-impact action:

```text
Current
→ Proposed
→ Side Effects
→ Approval
→ Warnings
```

Confirm re-checks state/version.

---

# 95. Illegal Transition Error

Canonical:

```text
409 INVALID_STATE_TRANSITION
```

Example:

```json
{
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "details": {
      "current_state": "DISPOSED",
      "command": "ASSET.ASSIGN"
    }
  }
}
```

---

# 96. Terminal State Error

```text
422 TERMINAL_STATE
```

unless special reactivate/reopen command exists.

---

# 97. State Migration

When new state model introduced:

```text
mapping
validation
migration script
backfill history where possible
```

Do not silently reinterpret old state semantics.

---

# 98. State Versioning

State enum changes should be versioned at contract/schema level.

Consumers must handle unknown future states safely.

---

# 99. Unknown State Handling

External integration receiving unsupported state should:

```text
preserve raw value
mark unsupported
alert integration owner
```

not map arbitrarily.

---

# 100. Bulk State Transitions

Bulk transition must evaluate each entity individually.

Example:

```text
Bulk retire 100 assets
```

Result:

```text
82 eligible
11 approval required
7 invalid state
```

No silent force transition.

---

# 101. Manual Override

Manual force transition should be rare.

Requirements:

```text
special permission
reason
approval if high-risk
before/after snapshot
audit event
```

---

# 102. State Transition Audit Events

Examples:

```text
STATE.TRANSITION_REJECTED
STATE.MANUAL_OVERRIDE_USED
STATE.INVARIANT_VIOLATION
STATE.COMPENSATION_EXECUTED
```

---

# 103. State Machine Registry Metadata

Each state machine should have:

```yaml
state_machine:
  id:
  entity_type:
  dimension:
  version:
  owner_domain:
  initial_state:
  terminal_states:
  transitions:
```

---

# 104. Initial State Registry

| Entity | Initial State |
|---|---|
| Asset Lifecycle | PLANNED or RECEIVED depending source |
| Ticket | NEW |
| Incident | DETECTED |
| Problem | NEW |
| Change | DRAFT |
| Maintenance | DRAFT |
| Audit | DRAFT |
| Deployment | QUEUED |
| Procurement Request | DRAFT |
| PO | DRAFT |
| Invoice | DRAFT |
| Credit Note | DRAFT |
| Contract | DRAFT |
| Approval | PENDING |
| Automation Execution | QUEUED |
| Work Item | NEW |

---

# 105. Terminal State Registry

| Entity | Terminal States |
|---|---|
| Ticket | CLOSED, CANCELLED |
| Incident | CLOSED, CANCELLED |
| Problem | CLOSED, CANCELLED |
| Change | CLOSED, CANCELLED |
| Asset Lifecycle | DISPOSED |
| Maintenance | COMPLETED, FAILED, CANCELLED |
| Audit | COMPLETED, CANCELLED |
| Deployment | SUCCESS, FAILED, CANCELLED, ROLLED_BACK |
| Procurement Request | FULFILLED, REJECTED, CANCELLED |
| PO | CLOSED, CANCELLED |
| Invoice | APPROVED, REJECTED, CANCELLED |
| Credit Note | APPLIED, REJECTED, CANCELLED |
| Contract | ARCHIVED |
| Approval | APPROVED, REJECTED, EXPIRED, CANCELLED |
| Offboarding | COMPLETED, CANCELLED |

---

# 106. Reopen / Reactivation Registry

Allowed special transitions:

```text
Ticket CLOSED → REOPENED
Incident RESOLVED → INVESTIGATING
Work Item RESOLVED → REOPENED
User TERMINATED → REHIRE workflow only
Contract EXPIRED/TERMINATED → create a successor Contract through an explicit
  Renewal workflow where eligible; never reactivate/resurrect historical lifecycle
```

---

# 107. Cross-Domain Transition Dependencies

Examples:

```text
Asset RETIRED → DISPOSED
depends on:
- Data Wipe
- License Reclaim
- Access Cleanup
- Approval

Software Request APPROVED → DEPLOYING
depends on:
- License availability
- Artifact approved
- Agent eligible

Offboarding READY_TO_CLOSE → COMPLETED
depends on:
- Access revoked
- Asset return
- License reclaim
- Ownership transfer
- all mandatory tasks succeeded or policy-approved waived
- no unresolved blockers or pending cancellation
- authoritative termination request remains valid
- User Lifecycle is TERMINATED (observed or produced by finalization)
```

Offboarding `COMPLETE` and `OFFBOARDING.REQUEST_CANCEL` compete on the same
case version; a stale command cannot overwrite the committed winner. An
Offboarding Case cancellation never reactivates a User.

---

# 108. Saga-aware State Transition

For cross-domain flow, local entity may enter:

```text
WAITING_DEPENDENCY
```

or domain-specific waiting state.

Do not hold distributed transaction open.

---

# 109. State Machine Ownership

| State Machine | Owner Domain |
|---|---|
| Asset Lifecycle | Asset |
| Assignment | Asset |
| Ticket | Helpdesk |
| Incident | Incident |
| Problem | Problem |
| Change | Change |
| Maintenance | Maintenance |
| Warranty | Warranty |
| Audit | Audit |
| Network Exception | Network |
| Software Request | Software |
| Deployment | Software/Artifact |
| License Assignment | License |
| Procurement | Procurement |
| Invoice | Procurement/Finance |
| Contract | Contract |
| User Lifecycle | Identity |
| Approval | Approval |
| SLA | SLA |
| Automation | Automation |
| Work Item | Operations |

---

# 110. State Query Contract

Resource responses should return:

```yaml
state:
current_state:
allowed_actions:
state_changed_at:
```

For multi-dimensional entity:

```yaml
states:
  lifecycle:
  operational:
  health:
  assignment:
  warranty:
  compliance:
  risk:
```

---

# 111. State History Query

API example:

```text
GET /assets/{id}/state-history
GET /tickets/{id}/state-history
```

Supports:

```text
dimension
time range
actor
reason
```

---

# 112. Metrics from State Transitions

Useful metrics derive from transition timestamps:

```text
Time in state
Lead time
Waiting time
Cycle time
Reopen count
Failure rate
Transition rejection count
```

---

# 113. Bottleneck Detection

Example:

```text
Maintenance WAITING_PART average = 4.2 days
```

State history is source.

---

# 114. State Transition Security

Sensitive transition requires:

```text
authorization
scope
high-risk controls
reason
approval
```

State machine alone is not authorization.

---

# 115. State Transition Idempotency

Same command replay:

```text
same idempotency key
```

returns original result.

If entity already reached desired state through same operation:

```text
idempotent success
```

where safe.

---

# 116. Duplicate Command Example

```text
ASSET.RETURN
```

sent twice.

Second call should not create:

```text
second return
second movement
second document
```

---

# 117. State Machine Test Requirements

For each transition test:

```text
valid transition succeeds
invalid from-state rejected
missing permission denied
missing approval waits/rejects
expected version conflict detected
invariants enforced
event emitted
side effects correct
idempotent retry safe
compensation path works
```

---

# 118. Contract Test Matrix

Example Asset Assignment:

```text
AVAILABLE + asset.assign → allowed
RESERVED + correct reservation + asset.assign → allowed
IN_USE + asset.assign → reject
DISPOSED + asset.assign → reject terminal
AVAILABLE + wrong site scope → deny
AVAILABLE + duplicate retry → idempotent success
```

---

# 119. Migration from Generic Status

If legacy model has:

```text
status = active
```

migration should split into domain dimensions.

Example:

```text
active + assigned user + agent online
```

becomes:

```text
Lifecycle = IN_USE
Assignment = ASSIGNED
Operational = ONLINE
Health = UNKNOWN
```

---

# 120. Guardrails

System must not:

1. Allow direct arbitrary state PATCH for protected entities.
2. Mix unrelated state dimensions into one generic status.
3. Skip invariant validation.
4. Emit transition event before commit.
5. Treat rollback as deletion of committed history.
6. Allow terminal-state mutation without explicit command.
7. Let UI-defined allowed action replace backend validation.
8. Let bulk action force invalid entities silently.
9. Close workflow without required verification.
10. Lose state history on correction.
11. Reuse one state name with contradictory meaning across domains without qualification.
12. Make cross-domain transition via distributed DB transaction.
13. Ignore optimistic concurrency on state-changing commands.
14. Auto-transition high-risk states without policy gate.
15. Complete disposal/offboarding without dependency checks.
16. Hide manual override usage from audit.
17. Use stale read model as final transition authority.

---

# 121. MVP State Machines

Implement first:

```text
Asset Lifecycle
Asset Assignment
Ticket
Incident
Maintenance
User Lifecycle
Approval
Work Item
SLA
```

---

# 122. Phase 2 State Machines

Add:

```text
Problem
Change
Audit
Network Exception
Software Request
Deployment
License Assignment
Warranty
Replacement
```

---

# 123. Phase 3 State Machines

Add:

```text
Procurement
PO
Invoice
Contract
Document
Automation Rule Lifecycle
Advanced Disposal
```

---

# 124. Recommended Next Spec

Sau State Machine Master, tài liệu tiếp theo nên là:

```text
ERROR + RETRY + IDEMPOTENCY STANDARD
```

để chuẩn hóa:

```text
error taxonomy
retryability
backoff
idempotency ledger
dedupe keys
consumer retry
API retry
workflow retry
compensation
DLQ
circuit breaker
```

---

# 125. Definition of Done

State Machine Master đạt yêu cầu khi:

- Mọi core entity có initial state rõ.
- Terminal states rõ.
- Allowed transitions rõ.
- Protected transitions đi qua commands.
- Preconditions/invariants được định nghĩa.
- Approval/SLA/authorization hooks rõ.
- Side effects được phân loại sync vs async.
- Verification states tồn tại nơi cần thiết.
- Rollback và compensation được phân biệt.
- State history contract chuẩn.
- Cross-domain dependencies rõ.
- Illegal transition/error behavior rõ.
- Bulk/manual override guardrails rõ.
- MVP → Phase 3 implementation path rõ.

# 126. Supplier Lifecycle State Machine

Supplier lifecycle is owned by Procurement. The canonical states are
`PROSPECT`, `APPROVED`, `PREFERRED`, `SUSPENDED`, `BLOCKED` and `INACTIVE`.
`INACTIVE` is reactivatable and is not terminal. Supplier records are never
hard-deleted because commercial records may reference them.

| From | Command | To | Permission |
|---|---|---|---|
| none | `SUPPLIER.CREATE` | `PROSPECT` | `supplier.create` |
| `PROSPECT` | `SUPPLIER.APPROVE` | `APPROVED` | `supplier.approve` |
| `APPROVED` | `SUPPLIER.MARK_PREFERRED` | `PREFERRED` | `supplier.approve` |
| `PREFERRED` | `SUPPLIER.REMOVE_PREFERRED` | `APPROVED` | `supplier.approve` |
| `APPROVED`, `PREFERRED` | `SUPPLIER.SUSPEND` | `SUSPENDED` | `supplier.status.change` |
| `SUSPENDED` | `SUPPLIER.RESUME` | `APPROVED` | `supplier.status.change` |
| `PROSPECT`, `APPROVED`, `PREFERRED`, `SUSPENDED` | `SUPPLIER.BLOCK` | `BLOCKED` | `supplier.block` |
| `BLOCKED` | `SUPPLIER.UNBLOCK` | `PROSPECT` | `supplier.block` |
| any non-`INACTIVE` state | `SUPPLIER.DEACTIVATE` | `INACTIVE` | `supplier.status.change` |
| `INACTIVE` | `SUPPLIER.REACTIVATE` | `PROSPECT` | `supplier.status.change` |

`SUPPLIER.UPDATE_PROFILE` uses `supplier.update` and cannot change state.
Explicitly invalid are `BLOCKED -> APPROVED`, `BLOCKED -> PREFERRED`,
`INACTIVE -> APPROVED`, and `INACTIVE -> PREFERRED`; these paths require
`PROSPECT` and re-qualification. `RESUME` always produces `APPROVED`, including
when the Supplier was previously `PREFERRED`.

Existing Supplier updates and all state transitions require
`expected_version`, durable idempotency, tenant/resource-scope authorization,
audit before/after, correlation and a transactional outbox fact. Every
Supplier write requires a non-empty reason. Concurrent transitions based on the same version
must be serialized by compare-and-swap/optimistic concurrency or an equivalent
database invariant. Only one can commit; the losing command returns
`VERSION_CONFLICT`. No duplicate transition history or event may be produced.
Creation starts at version 1. Profile updates may increment the same aggregate
version and therefore conflict with a concurrent lifecycle transition.

Changing Supplier state does not delete or rewrite RFQ, Quotation, Purchase
Order, Invoice or Contract history. Eligibility is checked against canonical
state when selecting an RFQ candidate (`PROSPECT`, `APPROVED`, `PREFERRED`) or
issuing a new PO (`APPROVED`, `PREFERRED`).

---

# 127. RFQ State Machine

Procurement owns RFQ state and state history. Terminal states are `AWARDED`,
`CLOSED_NO_AWARD` and `CANCELLED`.

| From | Command | To | Permission | Guard/effect | Event(s) |
|---|---|---|---|---|---|
| none | `RFQ.CREATE` | `DRAFT` | `rfq.create` | A linked Procurement Request must be in `WAITING_RFQ`; tenant-bound references only | `RFQ.CREATED` |
| `DRAFT` | `RFQ.UPDATE_DRAFT` | `DRAFT` | `rfq.update` | Terms/candidates editable only in draft | `RFQ.UPDATED` |
| `DRAFT` | `RFQ.ISSUE` | `OPEN` | `rfq.issue` | Revalidate candidate Supplier eligibility | `RFQ.ISSUED` |
| `DRAFT`, `OPEN`, `EVALUATING` | `RFQ.CANCEL` | `CANCELLED` | `rfq.cancel` | VOID associated DRAFT/SUBMITTED quotations | `RFQ.CANCELLED`, `QUOTATION.VOIDED` per changed quotation |
| `OPEN` | `RFQ.CLOSE_SUBMISSIONS` | `EVALUATING` | `rfq.close` | Fence subsequent quote submissions | `RFQ.SUBMISSIONS_CLOSED` |
| `EVALUATING` | `RFQ.AWARD` | `AWARDED` | `rfq.award` | Atomically validate and record award; accept selected SUBMITTED, reject other SUBMITTED and VOID remaining DRAFT quotations | `RFQ.AWARDED`, `QUOTATION.ACCEPTED`, `QUOTATION.REJECTED`, `QUOTATION.VOIDED` per changed quotation |
| `EVALUATING` | `RFQ.CLOSE_NO_AWARD` | `CLOSED_NO_AWARD` | `rfq.close` | Reject SUBMITTED and VOID remaining DRAFT quotations | `RFQ.CLOSED_NO_AWARD`, `QUOTATION.REJECTED`, `QUOTATION.VOIDED` per changed quotation |

No other RFQ transition is valid. Commercial terms are editable only in
`DRAFT`; material changes after issue require cancellation and a new RFQ. There
is no OPEN amendment command in TASK-071.

`RFQ.AWARD` requires an `EVALUATING` RFQ, a selected quotation in `SUBMITTED`,
and its Supplier currently `APPROVED` or `PREFERRED`. Approval is conditional:
if one or more same-tenant `RFQ_AWARD` approval requests target the RFQ, every
linked request must be `APPROVED`; with none linked, approval is not required.
TASK-071 does not create approval requests or infer a policy threshold. A
`PROSPECT` Supplier's submission may be evaluated but is not award-eligible.
`SUSPENDED`, `BLOCKED` and `INACTIVE` Suppliers cannot submit or be awarded.
Approval remains distinct from `rfq.award` permission.

The parent RFQ version is the concurrency fence for `QUOTATION.SUBMIT` versus
`RFQ.CLOSE_SUBMISSIONS`, and `RFQ.AWARD` versus `RFQ.CANCEL`. If close wins,
a later submit is rejected without transition effects; if submit wins, that
submission is visible to evaluation. Award and cancel are mutually exclusive;
exactly one may commit. Parallel submissions for the same tenant/RFQ/Supplier
are further constrained to at most one current `SUBMITTED` quotation.

Each command carries `expected_version` and durable idempotency where
applicable, tenant/resource-scope authorization and correlation context.
RFQ cancellation, quotation withdrawal/disqualification and award exceptions
require a reason. Audit, transition history and outbox events commit
atomically; failed competing commands emit no state change, history or event.

---

# 128. Quotation State Machine

Quotation terminal states are `WITHDRAWN`, `DISQUALIFIED`, `ACCEPTED`,
`REJECTED` and `VOID`. A `SUBMITTED` quotation is immutable.

| From | Command | To | Permission | Guard/effect | Event |
|---|---|---|---|---|---|
| none | `QUOTATION.CREATE` | `DRAFT` | `quotation.create` | Persist a tenant/RFQ/Supplier-bound draft | `QUOTATION.CREATED` |
| `DRAFT` | `QUOTATION.UPDATE_DRAFT` | `DRAFT` | `quotation.update` | Commercial fields remain editable only before submit | `QUOTATION.UPDATED` |
| `DRAFT` | `QUOTATION.SUBMIT` | `SUBMITTED` | `quotation.submit` | Parent RFQ is OPEN; Supplier is eligible; unique current submission | `QUOTATION.SUBMITTED` |
| `DRAFT`, `SUBMITTED` | `QUOTATION.WITHDRAW` | `WITHDRAWN` | `quotation.withdraw` | Requires reason | `QUOTATION.WITHDRAWN` |
| `SUBMITTED` | `QUOTATION.DISQUALIFY` | `DISQUALIFIED` | `quotation.evaluate` | Requires reason | `QUOTATION.DISQUALIFIED` |
| selected `SUBMITTED` | parent `RFQ.AWARD` | `ACCEPTED` | `rfq.award` | Selected Supplier is APPROVED/PREFERRED | `QUOTATION.ACCEPTED` |
| other active `SUBMITTED` | parent `RFQ.AWARD` | `REJECTED` | `rfq.award` | One RFQ transaction with award | `QUOTATION.REJECTED` |
| active `SUBMITTED` | parent `RFQ.CLOSE_NO_AWARD` | `REJECTED` | `rfq.close` | One RFQ transaction with close | `QUOTATION.REJECTED` |
| `DRAFT`, `SUBMITTED` | parent `RFQ.CANCEL` | `VOID` | `rfq.cancel` | Terminal quotation history is untouched | `QUOTATION.VOIDED` |
| remaining `DRAFT` | parent `RFQ.AWARD` | `VOID` | `rfq.award` | No non-terminal child remains when RFQ is terminal | `QUOTATION.VOIDED` |
| remaining `DRAFT` | parent `RFQ.CLOSE_NO_AWARD` | `VOID` | `rfq.close` | No non-terminal child remains when RFQ is terminal | `QUOTATION.VOIDED` |

To revise a submitted offer while the RFQ is OPEN, withdraw the old record,
create a new DRAFT quotation linked through `replaces_quotation_id` and a
revision reference, and submit that new record. Never overwrite submitted
commercial terms. Enforce a partial unique constraint for one
`SUBMITTED` quotation per `(tenant_id, rfq_id, supplier_id)`.

If supplier-facing principals are introduced, `quotation.create`,
`quotation.update`, `quotation.submit` and `quotation.withdraw` additionally
require scope to the principal's own Supplier. State-changing commands use
expected-version fencing, idempotency, authorization, audit, outbox and
correlation context where applicable.
