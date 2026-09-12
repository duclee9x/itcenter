# TASK-075 — Contract + Renewal + Commercial Document Governance

## 1. Task Metadata

```yaml
task_id: TASK-075
feature_id: F-045/F-046
workflow_id: WF-P06/WF-016
phase: P4
priority: P1
readiness: SATISFIED
status: CODE_COMPLETE
owner_domain: contract
depends_on: TASK-070, TASK-074, TASK-075-R1
```

## 2. Objective

Implement Contract lifecycle, immutable commercial versions, version-bound
execution evidence, explicit in-term amendments, successor-based Renewal Cases
and governed commercial documents according to this contract and the normative
documents listed below. Do not implement electronic-signature provider
integration or payment settlement.

## 3. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `tasks/TASK-075-R1_CONTRACT_LIFECYCLE_RENEWAL_DOCUMENT_GOVERNANCE_CONTRACT.md`

## 4. In Scope

- Contract legal lifecycle, independent usage status and immutable
  ContractVersions.
- Draft management, signature submission/recall, external/offline execution
  evidence, activation, hold/resume, amendment, natural expiry, termination and
  unexecuted cancellation.
- Conditional context-bound Approval Engine checks for execution, amendment
  and Renewal where a linked request exists; no blanket approval requirement
  or automatic request creation.
- Renewal Case lifecycle, one-open-case/successor invariants and successor
  Contract creation without rewriting the predecessor.
- Commercial Document metadata, immutable object versions, governance status,
  separate signature status, hashes, protected access and retention links.
- Tenant/resource authorization, expected versions, idempotency, audit,
  outbox/events, timeline, actionable Work Queue context and concurrency tests.

## 5. Out of Scope

- TASK-075-R1 defined the normative contract. Runtime behavior is implemented
  by TASK-075 and recorded in `TASK-075_IMPLEMENTATION_REPORT.md`.
- Electronic-signature provider integration; support recording externally
  signed/offline evidence.
- Legal advice, automatic legal execution, automatic renewal execution or a
  global expiry/notice threshold.
- Changing Supplier identity on an executed Contract.
- Extending an existing Contract term through amendment.
- Rewriting/deleting historical Contract, PO, Invoice, Goods Receipt or
  commercial document records.
- Domain-specific binary storage separate from the central document/object
  storage architecture.

## 6. Current Repository Context

Existing specifications define Contract, Contract coverage, Document and
object-storage concepts, but did not provide a consistent lifecycle/version/
renewal contract before TASK-075-R1. Inspect current modules and migrations
before implementation; use central Approval, Audit, Outbox, Timeline,
Work Queue and Document application contracts. Contract runtime APIs and
canonical implementation are not supplied by the remediation.

## 7. Domain Rules

- Keep separate: Contract legal/commercial lifecycle; usage status; Renewal
  Case lifecycle; ContractVersion; Commercial Document governance status;
  signature/execution evidence. Approval is independent in Approval Engine.
- Contract lifecycle: `DRAFT`, `PENDING_SIGNATURE`, `EXECUTED`, `ACTIVE`,
  `EXPIRED`, `TERMINATED`, `CANCELLED`. Terminal: `EXPIRED`, `TERMINATED`,
  `CANCELLED`. `EXPIRING` is derived context, not lifecycle.
- Normal flow: create→DRAFT; draft update remains DRAFT; submit for signature
  freezes the exact version and enters PENDING_SIGNATURE; recall before final
  execution evidence returns to DRAFT; recording valid evidence enters
  EXECUTED; activation enters ACTIVE; active contracts naturally expire or
  may be explicitly terminated. Only unexecuted DRAFT/PENDING_SIGNATURE may
  be cancelled. Never resurrect a terminal Contract.
- Signature recall requires PENDING_SIGNATURE and no accepted final execution
  evidence. It invalidates approval/execution contexts bound to the recalled
  proposal. Frozen pending terms are not edited directly.
- Execution evidence is a finalized signed commercial document or supported
  external execution reference bound to the exact immutable ContractVersion.
  Approval is not execution evidence.
- Require `effective_at < end_at`. Activation requires EXECUTED, current time
  in `[effective_at, end_at)`, valid exact-version evidence and Supplier
  APPROVED/PREFERRED. Expiration is idempotent at/after end time. EXPIRING
  alerts use explicit notice terms; do not add a global default interval.
- Usage status is `ENABLED | ON_HOLD`, independent from legal lifecycle.
  HOLD requires reason. ON_HOLD cannot authorize new downstream procurement
  where Contract eligibility is required. Supplier suspension/block/deactivate
  does not silently rewrite Contract lifecycle.
- DRAFT commercial proposal is mutable by explicit update command. Every
  meaningful change advances expected/entity version. Submitted/executed
  versions are immutable and queryable.
- `CONTRACT.AMEND` is allowed only for EXECUTED/ACTIVE; creates a new immutable
  version, requires reason, records changed fields and evidence, cannot change
  Supplier or extend end date. Linked `CONTRACT_AMENDMENT` approval, if any,
  must be same-tenant, target the Contract, bind the base version and proposed
  snapshot, have that purpose and be APPROVED. Material changes stale it.
- Execution approval is optional unless a linked `CONTRACT_EXECUTION` request
  exists. If linked, it must bind the same tenant, Contract and exact submitted
  version and be APPROVED before RECORD_EXECUTION. Do not auto-create approval.
- Renewal creates a RenewalCase and one DRAFT successor Contract. Never update
  predecessor end date or executed history. Successor has
  `renewed_from_contract_id`; predecessor/case reference successor. One OPEN
  case per predecessor and one canonical successor per case are durable
  invariants.
- Renewal states: `OPEN`, `COMPLETED`, `NOT_RENEWED`, `CANCELLED`; final three
  are terminal. `CANCELLED` means erroneous/abandoned; `NOT_RENEWED` is an
  explicit business decision. Completion requires successor EXECUTED or
  ACTIVE. Successor effective term starts at or after predecessor end.
- Linked `CONTRACT_RENEWAL` approval, if present, is same-tenant, targets the
  case and/or canonical successor per repository convention, binds the exact
  proposal and is APPROVED before the governed action. Proposal changes stale
  approval. Rejected approval does not automatically mark NOT_RENEWED.
- Auto-renew metadata may trigger candidate/notification/work or authorized
  case creation; it never silently executes a successor absent explicit
  normative automation policy.
- Commercial document types include CONTRACT, AMENDMENT, RENEWAL,
  TERMINATION_NOTICE, EXECUTION_EVIDENCE and OTHER_COMMERCIAL_EVIDENCE.
  Governance states are DRAFT, FINAL, SUPERSEDED, VOID; signature state is
  separate. FINAL bytes are immutable, supersession preserves old evidence,
  and executed/signed evidence is not casually VOIDed.
- Use central Document/object-storage architecture. Keep document identity,
  immutable version, storage reference, SHA-256, type, size, actor/time,
  classification/access and finalization/signature metadata. Events/timeline
  carry references, never bytes. Apply tenant/resource document permissions
  and central retention policy.
- Termination requires reason, effective time/date, authorization,
  expected_version, audit, outbox and correlation. It preserves Contract,
  versions, Documents and commercial history. Historical transactions are
  never cancelled by Contract termination.

## 8. State Transitions

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

ENABLED → CONTRACT.HOLD → ON_HOLD
ON_HOLD → CONTRACT.RESUME → ENABLED

none → RENEWAL.OPEN → OPEN
OPEN → RENEWAL.UPDATE_PROPOSAL → OPEN
OPEN → RENEWAL.COMPLETE → COMPLETED
OPEN → RENEWAL.MARK_NOT_RENEWED → NOT_RENEWED
OPEN → RENEWAL.CANCEL → CANCELLED
```

Amendment is a versioned action on EXECUTED/ACTIVE and does not change
lifecycle. Signature/execution state, Approval state and document governance
are independent dimensions.

## 9. Preconditions

- Contract/Supplier/approval/evidence/document references are tenant-consistent.
- `expected_version` matches current canonical Contract/Renewal/document state.
- Effective term is valid; activation date and evidence are valid.
- Supplier is APPROVED/PREFERRED for execution and activation.
- Execution evidence binds exact submitted ContractVersion.
- Renewal predecessor is eligible under the Contract state and term guards;
  no OPEN case already exists; successor has no duplicate canonical owner.
- Amendment base version and proposal fingerprint match the linked approval,
  when present.
- Final document replacement creates a new version; bytes of stored versions
  are never overwritten.

## 10. Authorization

```yaml
permissions:
  CONTRACT.CREATE: contract.create
  CONTRACT.UPDATE_DRAFT: contract.update
  CONTRACT.SUBMIT_FOR_SIGNATURE: contract.update
  CONTRACT.RECALL_SIGNATURE: contract.update
  CONTRACT.CANCEL: contract.update # unexecuted only
  CONTRACT.RECORD_EXECUTION: contract.execute
  CONTRACT.ACTIVATE: contract.lifecycle
  CONTRACT.EXPIRE: contract.lifecycle
  CONTRACT.HOLD: contract.lifecycle
  CONTRACT.RESUME: contract.lifecycle
  CONTRACT.AMEND: contract.amend
  CONTRACT.TERMINATE: contract.terminate
  RENEWAL.*: contract.renew
  COMMERCIAL_DOCUMENT.READ: commercial_document.read
  COMMERCIAL_DOCUMENT.WRITE: commercial_document.write
  COMMERCIAL_DOCUMENT.FINALIZE: commercial_document.finalize
```

All permissions require tenant/resource scope. Approval decisions remain
`approval.decide`. Do not require an Approval Request absent a linked request.

## 11. Database / Data Model

- `contract.contracts`: logical identity, lifecycle, usage status, Supplier,
  effective/end terms, current version and predecessor reference.
- `contract.contract_versions`: immutable version number/snapshot/fingerprint,
  actor/time/source/reason/evidence links; unique tenant+Contract+version.
- `contract.renewal_cases`: predecessor/successor, proposal snapshot/fingerprint,
  lifecycle/version and audit references. Durable uniqueness for one OPEN case
  per predecessor and one canonical successor per case.
- Central `document.documents`, `document.document_versions` and
  `document.document_links` carry governance status, separate signature status,
  object key, SHA-256, size/type, classification/access, actor/time and
  retention references.
- Append-only Contract history, amendment changed-field evidence, renewal
  history and execution/document references. FINAL bytes and submitted/executed
  ContractVersions are immutable.

## 12. API

Follow explicit command routes in `API_COMMAND_CONTRACT_SPEC.md`, including
Contract create/update/submit/recall/record-execution/activate/hold/resume/
amend/expire/terminate/cancel; RenewalCase open/update/complete/
mark-not-renewed/cancel; and commercial-document add/new-version/finalize/
supersede. Use `Idempotency-Key`, `expected_version` and correlation context.
Document binary transfer follows the central upload session/object-storage
contract.

## 13. Events Produced

`CONTRACT.CREATED`, `CONTRACT.UPDATED`, `CONTRACT.SUBMITTED_FOR_SIGNATURE`,
`CONTRACT.SIGNATURE_RECALLED`, `CONTRACT.EXECUTED`, `CONTRACT.ACTIVATED`,
`CONTRACT.HELD`, `CONTRACT.RESUMED`, `CONTRACT.AMENDED`, `CONTRACT.EXPIRED`,
`CONTRACT.TERMINATED`, `CONTRACT.CANCELLED`, `CONTRACT.RENEWAL_OPENED`,
`CONTRACT.RENEWAL_UPDATED`, `CONTRACT.RENEWAL_COMPLETED`,
`CONTRACT.RENEWAL_NOT_RENEWED`, `CONTRACT.RENEWAL_CANCELLED`,
`COMMERCIAL_DOCUMENT.ADDED`, `COMMERCIAL_DOCUMENT.FINALIZED` and
`COMMERCIAL_DOCUMENT.SUPERSEDED`. Emit through outbox after atomic commit;
payloads contain minimal references, not document bytes/sensitive terms.

## 14. Idempotency

Same key and semantic command returns original result without another version,
Renewal Case, successor, document version or event. Same key with a different
payload returns `IDEMPOTENCY_KEY_CONFLICT`. Domain uniqueness is separate from
request idempotency.

## 15. Concurrency

Use optimistic version checks, transactions and durable DB invariants to cover:

- `CONTRACT.UPDATE_DRAFT` vs `CONTRACT.SUBMIT_FOR_SIGNATURE`.
- `CONTRACT.RECALL_SIGNATURE` vs `CONTRACT.RECORD_EXECUTION`.
- `CONTRACT.ACTIVATE` vs `CONTRACT.TERMINATE`.
- `CONTRACT.AMEND` vs `CONTRACT.TERMINATE`.
- Concurrent `RENEWAL.OPEN` for one predecessor.
- `RENEWAL.COMPLETE` vs `RENEWAL.MARK_NOT_RENEWED`.
- Document finalization vs replacement/new-version creation.
- Proposal/version changes vs linked execution/amendment/renewal approval.

Only valid serialized outcomes may commit; never use stale approval snapshots.

## 16. Transaction Boundary / Async Effects

Atomically persist owning-domain lifecycle/version/history, local invariant
changes, durable audit reference and outbox event. Do not keep the transaction
open during signature-provider, object-storage, notification, approval or
human actions. Use central document upload/finalization workflow and async
notifications, expiry alerts and timeline projections. Expiry alert failure
does not alter Contract lifecycle.

## 17. Audit / Timeline / Work Queue

Audit create/material draft update/submit/recall/execution/activation/
hold/resume/amend/renewal decision/terminate/expire/cancel, approval use and
document finalize/supersede. Preserve actor, tenant, Contract/Renewal/version,
before/after lifecycle and usage, reason, approval/evidence references,
correlation and outcome. Audit is append-only.

Timeline is derived and may show operator-readable lifecycle/version/renewal
events; no raw document bytes or unrestricted commercial data. Work Queue is
actionable only for decisions/exceptions such as approaching explicit notice
deadline, renewal action required, missing evidence, stale approval, Supplier
eligibility review or reconciliation failure. It is never canonical state.

## 18. Canonical Errors / Retry / Compensation

Use canonical permission, scope, not-found, invalid-state, version-conflict,
idempotency-conflict, stale-approval, Supplier-ineligible, invalid-term,
duplicate-open-renewal and document-integrity errors. Map durable unique races
to domain conflicts, not raw SQL errors. Do not automatically retry business
conflicts or uncertain execution/termination commands; read canonical state
first. Contract termination is explicit and auditable, not deletion-based
compensation.

## 19. Required Tests

- Create/update DRAFT; update-vs-submit race; submission freezes version.
- Recall before execution; recall-vs-record-execution race.
- Execution evidence bound to exact version; conditional execution approval,
  and stale/missing/non-approved linked approval behavior.
- Activation requires effective date, valid evidence and eligible Supplier;
  future/expired term and ineligible Supplier fail.
- Natural expiry is idempotent; explicit termination; activation-vs-terminate
  and amend-vs-terminate races; no invalid cancel/resurrection.
- Amendment creates immutable version, preserves prior version, rejects
  Supplier/end-date changes and rejects stale approval.
- HOLD/RESUME affects only usage status and preserves legal lifecycle.
- Renewal creates one successor; concurrent duplicate open prevented; linked
  approval/staleness; completion requires executed/active successor;
  NOT_RENEWED differs from CANCELLED; predecessor history remains unchanged.
- Successor term cannot overlap predecessor by default.
- FINAL document bytes immutable; version replacement and supersession
  preserve old evidence; access is permission/scope checked.
- Termination preserves Contract, document, PO, Invoice and Goods Receipt
  history.
- Same-key replay has no duplicate versions/cases/successors/events.
- Audit/outbox atomicity, timeline references and actionable Work Queue cases.

## 20. Acceptance Criteria

1. All specified Contract, usage, Renewal and document transitions are
   explicit and invalid transitions are rejected.
2. Contract lifecycle, usage, Approval, Renewal, ContractVersion, document
   governance and signature status remain separate canonical dimensions.
3. Submitted/executed Contract versions and FINAL document bytes are
   immutable; changes create a version or successor as specified.
4. Execution/activation/amendment/renewal enforce the exact conditional
   approval and Supplier/term/evidence guards.
5. Renewal never rewrites predecessor terms and durable invariants prevent
   duplicate open cases/successors.
6. Every state-changing action uses scope authorization, expected version,
   idempotency, audit/outbox and correlation as applicable.
7. Required concurrency cases prove only valid serialized outcomes commit.
8. Events/timelines expose references only; document bytes remain protected by
   central storage governance.
9. Required unit, API, migration, integration and E2E tests pass with the
   project quality gates.

## 21. Verification Commands

Discover and run repository-defined format, lint, typecheck, unit, contract,
migration, integration and E2E commands; do not invent command names.

## 22. Implementation Report

TASK-075 is `CODE_COMPLETE`; see
`tasks/TASK-075_IMPLEMENTATION_REPORT.md` for delivered APIs, persistence,
verification and the object-storage adapter deployment dependency.
