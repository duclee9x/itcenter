# TASK-070-R1 — Supplier Lifecycle + Permission Contract

```yaml
task_id: TASK-070-R1
parent_task_id: TASK-070
feature_id: F-039
workflow_id: WF-P01
phase: P4
priority: P0
status: CODE_COMPLETE
owner_domain: procurement
task_type: SPEC_REMEDIATION
```

## 1. Objective

Resolve TASK-070's Supplier lifecycle/authorization `SPEC_CONFLICT` by making
the approved Supplier transitions, granular permissions, commercial
eligibility, events, concurrency and history rules normative. This is a
specification and planning-state task only; it does not implement TASK-070.

## 2. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `tasks/TASK-070_SUPPLIER_PROCUREMENT_REQUEST.md`
- `tasks/CODEX_TASK_REGISTRY.md`

## 3. Normative Supplier States and Invariants

States are `PROSPECT`, `APPROVED`, `PREFERRED`, `SUSPENDED`, `BLOCKED` and
`INACTIVE`. `INACTIVE` is not terminal. Supplier records must not be
hard-deleted because RFQ, Quotation, PO, Invoice or Contract records may refer
to them. Supplier lifecycle changes never delete or rewrite those commercial
records and do not automatically cancel them.

## 4. Normative Transitions

| Command | From | To |
|---|---|---|
| `SUPPLIER.CREATE` | none | `PROSPECT` |
| `SUPPLIER.APPROVE` | `PROSPECT` | `APPROVED` |
| `SUPPLIER.MARK_PREFERRED` | `APPROVED` | `PREFERRED` |
| `SUPPLIER.REMOVE_PREFERRED` | `PREFERRED` | `APPROVED` |
| `SUPPLIER.SUSPEND` | `APPROVED`, `PREFERRED` | `SUSPENDED` |
| `SUPPLIER.RESUME` | `SUSPENDED` | `APPROVED` |
| `SUPPLIER.BLOCK` | `PROSPECT`, `APPROVED`, `PREFERRED`, `SUSPENDED` | `BLOCKED` |
| `SUPPLIER.UNBLOCK` | `BLOCKED` | `PROSPECT` |
| `SUPPLIER.DEACTIVATE` | `PROSPECT`, `APPROVED`, `PREFERRED`, `SUSPENDED`, `BLOCKED` | `INACTIVE` |
| `SUPPLIER.REACTIVATE` | `INACTIVE` | `PROSPECT` |

Forbidden transitions are `BLOCKED -> APPROVED`, `BLOCKED -> PREFERRED`,
`INACTIVE -> APPROVED` and `INACTIVE -> PREFERRED`; requalification begins at
`PROSPECT`. A `PREFERRED` Supplier that is suspended and resumed returns to
`APPROVED`, never automatically to `PREFERRED`. `SUPPLIER.UPDATE_PROFILE`
does not change lifecycle state.

## 5. Permissions and Command Mapping

The catalog contains `supplier.read`, `supplier.create`, `supplier.update`,
`supplier.approve`, `supplier.status.change` and `supplier.block`.
`supplier.select` remains separate and does not grant master mutation. A broad
`supplier.manage` permission is not normative and must not be used.

| Command | Permission |
|---|---|
| `SUPPLIER.CREATE` | `supplier.create` |
| `SUPPLIER.UPDATE_PROFILE` | `supplier.update` |
| `SUPPLIER.APPROVE`, `SUPPLIER.MARK_PREFERRED`, `SUPPLIER.REMOVE_PREFERRED` | `supplier.approve` |
| `SUPPLIER.SUSPEND`, `SUPPLIER.RESUME`, `SUPPLIER.DEACTIVATE`, `SUPPLIER.REACTIVATE` | `supplier.status.change` |
| `SUPPLIER.BLOCK`, `SUPPLIER.UNBLOCK` | `supplier.block` |

Each command also enforces tenant isolation and applicable resource scope.
Authorization is checked by the backend at execution time; approval policy
does not itself grant command permission.

## 6. Eligibility

- RFQ candidates: `PROSPECT`, `APPROVED`, `PREFERRED`.
- New PO issue: `APPROVED`, `PREFERRED` only.
- `SUSPENDED`, `BLOCKED`, `INACTIVE` are ineligible for new PO issue.
- Candidate and PO issue paths revalidate canonical Supplier state when the
  command executes.

## 7. Commands, Events and Write Controls

The command set is:

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

The event set is:

```text
SUPPLIER.CREATED
SUPPLIER.UPDATED
SUPPLIER.APPROVED
SUPPLIER.PREFERRED
SUPPLIER.PREFERRED_REMOVED
SUPPLIER.SUSPENDED
SUPPLIER.RESUMED
SUPPLIER.BLOCKED
SUPPLIER.UNBLOCKED
SUPPLIER.DEACTIVATED
SUPPLIER.REACTIVATED
```

Retryable writes use `Idempotency-Key`; same key/semantics replays the stored
result and changed semantics conflict. Existing-record mutations use
`expected_version`; lifecycle changes and profile updates require a non-empty
reason. Every mutation performs scoped authorization, append-only before/after audit and an outbox
write in the same transaction. Events contain the committed Supplier version,
correlation/causation envelope and safe payloads; they exclude raw tax/banking
secrets. Correlation ID is required on every command.

Supplier profile and lifecycle changes share one monotonically increasing
version. Competing changes using the same version cannot both commit. The loser
gets `VERSION_CONFLICT` and produces no additional transition history, audit
transition or event. Idempotent replay does not release/emit effects twice.

## 8. Required Specification Changes

- Define the state machine, commands, eligibility, no-delete and commercial
  history rules in the Procurement workflow and master state-machine spec.
- Add the six granular permissions and exact command mapping to the permission
  catalog.
- Add payload contracts for all eleven Supplier master events.
- Specify shared lifecycle/profile version and append-only Supplier history in
  the data model; derive preferred status from `state`, without a duplicate
  boolean.
- Add Supplier lifecycle, authorization, idempotency, concurrency, audit,
  events and eligibility to F-039 traceability and TASK-070 acceptance/tests.
- Reconcile registry, CURRENT_TASK and IMPLEMENTATION_HANDOFF so TASK-070 is
  derived `READY` / `NOT_STARTED` after this remediation, then stop.

## 9. Out of Scope

- TASK-070 application code, database migration, APIs, runtime tests or
  implementation report.
- Automatic cancellation, suspension, amendment or rewriting of existing
  RFQs, Quotations, Purchase Orders, Invoices or Contracts.
- Granting broad `supplier.manage` permission.

## 10. Acceptance Criteria

1. Every transition and explicitly forbidden path in sections 3–4 is normative
   in the Procurement workflow and master state-machine specification.
2. Permission codes and command mapping are normative and contain no broad
   `supplier.manage` grant.
3. RFQ and PO eligibility, canonical-state revalidation and preservation of
   existing commercial records are normative.
4. All eleven event names have safe payload contracts and are tied to committed
   commands/outbox facts.
5. Supplier version and append-only history support optimistic concurrency;
   TASK-070 requires tests for competing lifecycle transitions.
6. TASK-070's recorded `SPEC_CONFLICT` is cleared, its derived readiness is
   `READY`, and its implementation status remains `NOT_STARTED`.
7. Registry, CURRENT_TASK and handoff are updated, and the remediation is
   committed separately from any TASK-070 implementation.
8. No TASK-070 runtime implementation is started by this remediation.

## 11. Completion Report

- Updated Procurement workflow, master state machine, permission catalog,
  event contracts, Supplier data model, F-039 traceability and TASK-070.
- Added exact Supplier command/transition and permission mappings, RFQ/PO
  eligibility, commercial-history preservation, shared optimistic versioning,
  concurrency test requirements and eleven event payload contracts.
- Reconciled the registry, CURRENT_TASK and handoff. TASK-070 is `READY` /
  `NOT_STARTED`; implementation has not begun.
- Verification: cross-document rule/name consistency review, formatting and
  `git diff --check`. Runtime tests are not applicable to this specification-
  only remediation.
