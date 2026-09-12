# TASK-076 — Phase 4 Procurement-to-Asset Integration Gate

## 1. Task Metadata

```yaml
task_id: TASK-076
feature_id: PHASE-GATE
workflow_id: P4-E2E
phase: P4
priority: P0
status: SATISFIED
readiness: READY
implementation_status: CODE_COMPLETE
owner_domain: cross-domain integration
depends_on: TASK-071, TASK-072, TASK-073, TASK-074, TASK-075, TASK-076-R1
```

## 2. Objective

Implement and verify the Phase 4 end-to-end procurement, receiving, Asset,
Invoice, Contract alert, commercial-document capability and cost-provenance
integration. The gate passes only when the Phase 4 Definition of Done has
traceable end-to-end evidence, including immutable commercial source lineage
and the configured/unavailable ObjectStore capability result.

This is an integration gate, not permission to weaken completed domain
contracts or create alternate sources of truth.

## 3. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/MVP_PHASED_IMPLEMENTATION_PLAN.md` §90
- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `docs/SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`
- TASK-070, TASK-071, TASK-072, TASK-073, TASK-074 and TASK-075 contracts
  and implementation reports
- `tasks/TASK-076-R1_PHASE4_INTEGRATION_GATE_CONTRACT.md`
- `tasks/TASK-076_IMPLEMENTATION_REPORT.md`

## 4. In Scope

- Demonstrate the end-to-end Procurement Request → Supplier/RFQ/Quotation
  where applicable → PO → Goods Receipt → Asset registration → Invoice/
  3-Way Match → cost provenance flow.
- Implement Contract-version-bound renewal/expiry alert scheduling using only
  explicit contract-specific notice/action configuration.
- Implement immutable CostProvenance/CostAllocation for Asset and License
  Entitlement/Pool targets, plus authorized derived summaries/projections.
- Connect PO, effective Invoice, applied Credit Note, Contract/ContractVersion
  and accepted received-unit evidence using canonical IDs, immutable versions
  and line references where applicable.
- Preserve ownership boundaries through commands/events/inbox/outbox and
  idempotent domain projections; no direct cross-domain table writes.
- Add actionable Work Queue context only for configured alerts or unresolved
  provenance/allocation/integrity exceptions.
- Validate environment commercial-document capability and produce durable,
  reviewable gate evidence for every Phase 4 Definition of Done criterion.
- Add API/event/integration/E2E tests and observability required by the
  accepted normative contracts.

## 5. Out of Scope

- Changing TASK-070 through TASK-075 lifecycle, authorization, matching,
  receipt, document or history semantics.
- A global Contract renewal/expiry warning threshold.
- Automatic legal renewal, term extension, successor execution or Contract
  acceptance.
- Mutating/deleting historical PO, Goods Receipt, Invoice, Credit Note,
  ContractVersion or cost provenance.
- Arbitrary allocation of header freight, tax, fees, discounts or other
  non-line charges without an explicit allocation policy.
- FX conversion policy, payment settlement, depreciation/accounting engine or
  full ERP behavior.
- Direct Procurement-to-Asset/License table writes or a distributed database
  transaction.
- Treating a test/fake ObjectStore as evidence of production ObjectStore
  configuration.

## 6. Current Repository Context

TASK-070 through TASK-075 are `CODE_COMPLETE`; their task contracts and reports
are the source for existing command behavior and verification. TASK-073 owns
physical receipt and asynchronous Asset registration. TASK-074 owns immutable
Invoice/Credit Note evidence, matching and allocations. TASK-075 owns Contract
versions, Renewal Cases and governed commercial documents. TASK-076 adds the
normative trigger/provenance integration defined by TASK-076-R1; do not rewrite
those source-domain facts.

Asset `purchase_cost` and License `cost` summaries may exist in current read
models. They are derived summaries, not canonical financial history. The
central ObjectStore boundary must fail closed if no adapter is configured.

## 7. Domain Rules

### Contract alerts

- Do not use a global warning threshold such as 30/60/90 days.
- Supported trigger sources are explicit `renewal_notice_date` or an explicit
  `renewal_notice_period` combined with Contract `end_at` (stored as
  `renewal_notice_period_days` in this repository).
- If both are present, the date is authoritative. Otherwise derive
  `renewal_action_at = end_at - renewal_notice_period_days`.
- If neither exists, create no proactive warning; natural expiration remains
  independent and must still occur at `end_at`.
- Invalid/impossible configuration creates a configuration/data-integrity
  exception, never a guessed trigger.
- Bind schedule/fact to the applicable immutable ContractVersion and terms.
  Material changes recalculate future alerts only; historical alert facts are
  retained.
- Stable logical identity is tenant + Contract + ContractVersion + trigger
  type + trigger time. Scheduler retries create no duplicate fact, event,
  notification or Work Item.
- Due action may create Work Queue/notification or an authorized renewal
  candidate/Case. It never executes a renewal, extends `end_at` or executes a
  successor. Auto-renew metadata alone grants no execution authority.
- `CONTRACT.RENEWAL_NOTICE_DUE` and `CONTRACT.EXPIRY_ACTION_DUE` are
  version-referenced operational facts where their explicit configured action
  applies. `CONTRACT.EXPIRED` remains a separate lifecycle fact.

### Cost provenance

- Canonical history is immutable CostProvenance/CostAllocation, not mutable
  Asset or License cost fields.
- Record tenant, target type/id, canonical source type/document/immutable
  version-reference/line,
  amount, currency, quantity/allocation basis, cost basis/type, effective
  period, allocation method, audit/correlation reference and stable
  idempotency identity.
- Sources include `PURCHASE_ORDER`, `INVOICE`, `CREDIT_NOTE`, `CONTRACT` and
  `CONTRACT_VERSION`; line-level references are required when cost derives
  from a specific commercial line.
- Preserve separate `COMMITTED`, `ACTUAL` and `ADJUSTMENT` records. An issued
  PO may create COMMITTED cost. An effective TASK-074 approved Invoice adds
  ACTUAL cost. An applied Credit Note adds a positive semantic adjustment with
  CREDIT/DEBIT direction. Never rewrite the earlier PO or Invoice fact.
- Example: PO COMMITTED unit cost `1,000`, effective Invoice ACTUAL allocation
  `980`; retain both and let the current-cost projection prefer ACTUAL. An
  applied Credit Note adds a separate positive semantic CREDIT adjustment.
- Asset lineage is Asset → `received_unit_id` → POSTED Goods Receipt unit/line
  → PO line/version → Invoice allocation where available → Contract/version
  where applicable. Goods Receipt is physical evidence, not cost authority.
- Allocate homogeneous line totals deterministically across physical Assets
  and reconcile exactly to source. The target-unit set and allocation quantity
  must come from the durable source-line/receipt-line quantity allocation; an
  Invoice allocation uses its TASK-074 Goods Receipt evidence and resolves
  units by stable `received_unit_id` within that allocation. Convert that
  source-line allocation total to currency minor units, divide by its target
  unit count, assign the quotient to each unit, then assign one extra minor
  unit to the first remainder units ordered by stable `received_unit_id`. Do
  not silently allocate header-level charges.
- Attach License cost primarily to Entitlement, Pool or commercial entitlement
  unit, not end-user assignment. Preserve recurring effective periods and
  successor Contract/version lineage.
- An Amendment or Renewal creates new applicable period/source provenance;
  do not rewrite historical periods or point predecessor facts at a successor
  Contract.
- Preserve source amount/currency. FX policy is out of scope unless already
  normative. Corrections append an adjustment/superseding record.
- Cost summaries (`committed_cost`, `actual_cost`, `net_cost`, `currency`,
  source summary) are derived projections only.
- Cost provenance ledger/source allocation is Procurement-owned. Asset and
  License own their entities and summaries. Use application commands/events,
  outbox/inbox and idempotent projections; never write another domain's
  canonical tables.
- Durable provenance identity includes tenant + target type/id + source
  type/document/version-reference/line + allocation role + cost basis, with stable null
  handling for source-level facts.
- Provenance state changes use explicit source-domain commands equivalent to
  `COST_PROVENANCE.RECORD` and `COST_ADJUSTMENT.RECORD`; do not expose a generic
  cost/status patch. Trusted event consumers execute under least-privilege
  system principals and validate tenant/resource scope. Manual allocation
  uses explicit authorization, reason, audit and applicable approval policy;
  it cannot bypass source-domain guards.
- Normal successful linkage creates no Work Item. Missing/ambiguous sources,
  non-reconciling allocations or integrity conflicts create actionable work.

### Document capability

- The phase environment reports either a configured central ObjectStore or an
  explicit unavailable/not-ready capability result.
- Automated tests may use a fake ObjectStore. It does not establish production
  storage readiness. Never introduce an unintended binary-storage fallback.

## 8. State Transition

TASK-076 adds no lifecycle state or transition. Existing Supplier, RFQ,
Quotation, PO, Goods Receipt, Asset, Invoice, Credit Note, Contract, Renewal
Case and License state machines remain authoritative.

## 9. Preconditions

- All declared source-domain dependencies and TASK-076-R1 are `CODE_COMPLETE`.
- Tenant-scoped canonical source IDs and immutable version/line references are
  available through owning-domain contracts.
- A migration/outbox/inbox design preserves ownership, idempotency and source
  history.
- Existing PostgreSQL E2E infrastructure is used for competing transaction
  tests and full traceability checks.

## 10. Authorization

Do not introduce a broad procurement permission. Reuse owning-domain command
permissions and resource/tenant scope for Supplier, Procurement, Asset,
License, Contract, Document and Work Queue operations. System scheduler and
event consumers use explicit least-privilege system principals; they cannot
bypass source-domain commands or mutate other domains' canonical state.

## 11. Data Model / Events / Reliability

- Persist append-only version-bound Contract alert facts and immutable
  CostProvenance/CostAllocation records with durable unique idempotency keys.
- Alert events: `CONTRACT.RENEWAL_NOTICE_DUE`,
  `CONTRACT.EXPIRY_ACTION_DUE`; natural transition event remains
  `CONTRACT.EXPIRED`.
- Cost events: `COST_PROVENANCE.RECORDED` and
  `COST_ADJUSTMENT.RECORDED` or equivalent domain-specific canonical names.
- Events use protected references/minimal authorized metadata; no full
  invoices/contracts, bank/tax data or document bytes.
- Audit alert configuration changes, due action creation, provenance/source
  linkage, adjustment/correction and any manual allocation. Audit is
  append-only.
- Same source event replay creates no duplicate provenance/allocation,
  projection, alert, Work Item or Credit Note adjustment.
- Concurrency protects alert recalculation vs schedule execution, Asset
  registration vs late Invoice allocation, Invoice allocation vs Credit Note
  application, Contract amendment vs cost projection refresh, and competing
  allocations against one commercial line.

## 12. Required Tests and Gate Evidence

- Procurement Request to PO, including applicable Supplier/RFQ/Quotation
  eligibility and source links.
- Goods Receipt full and partial paths register accepted received units
  asynchronously and idempotently; procurement never writes Asset tables.
- Over-receipt, duplicate receipt unit, PO state and concurrent last-unit
  races preserve TASK-073 invariants.
- Exact duplicate Invoice and parallel partial-invoice allocation preserve
  TASK-074 invariants; only POSTED accepted receipt quantity matches.
- Explicit `renewal_notice_date` generates one due alert.
- Explicit notice period derives the correct trigger from `end_at`.
- Explicit date wins when date and period both exist.
- Missing both values creates no proactive warning; Contract still expires
  naturally.
- Invalid/impossible alert configuration creates an actionable integrity
  exception without a guessed date.
- Repeated/concurrent scheduler runs do not duplicate alert facts/events/Work
  Items/notifications.
- Amendment/version material changes recalculate future scheduling without
  rewriting historical alerts; schedule-vs-amendment race has one valid
  serialized outcome.
- Alert generation never auto-executes, extends or signs a Contract.
- Asset resolves received unit → POSTED receipt line → PO line/version →
  Invoice allocation where available → Contract/version where applicable.
- Provisional PO COMMITTED cost remains after ACTUAL Invoice cost is added.
- Applied Credit Note appends adjustment; original Invoice and allocation
  remain unchanged. Allocate credit to the targets/units of its referenced
  Invoice allocation using the same deterministic basis; replay/concurrent
  application cannot double-adjust.
- Multi-Asset allocation is deterministic, including minor-unit remainder,
  and reconciles exactly to the line total.
- Header charges remain unallocated absent explicit policy.
- License Entitlement/Pool links to canonical Contract/PO/Invoice/Credit Note
  sources; assignment does not receive or mutate commercial cost by default.
- Renewal creates new effective-period provenance; predecessor Contract,
  version and cost history remain traceable. Amendment price changes use the
  applicable effective ContractVersion and do not rewrite earlier periods.
- Source currency/amount persist; no implicit FX conversion.
- Cross-domain tests prove no direct table write bypasses application/event
  ownership.
- Tenant/resource scope and least-privilege consumer authorization are tested;
  unauthorized or cross-tenant provenance/adjustment is denied and audited.
- An authorized operator can trace an Asset/License cost summary to canonical
  source document/version/line, allocation basis, effective period and source
  amount/currency without manual display-number lookup.
- ObjectStore capability reports configured or unavailable/not-ready; fake
  storage is accepted only in automated test configuration.
- End-to-end gate report traces every Phase 4 DoD item to durable test/run
  evidence and records all failures; gate cannot pass with an unresolved row.

## 13. Acceptance Criteria

1. The complete Phase 4 path is traceable across Procurement, Warehouse,
   Asset, Invoice/3-Way Match, Contract and License domains.
2. Contract alerts use only explicit version-bound terms with correct date
   precedence, period derivation, idempotency and no auto-renew execution.
3. Natural Contract expiration works without any alert configuration.
4. Asset and License cost history is canonical, immutable, source/version/
   line-linked where applicable and queryably traceable.
5. COMMITTED, ACTUAL and ADJUSTMENT cost facts coexist; deterministic
   allocation reconciles exactly; source amount/currency and history are
   preserved.
6. Cross-domain writes follow owning application commands/events and
  idempotent projections; no direct table mutation or distributed
  transaction is introduced.
7. Authorization is tenant/resource scoped and uses least-privilege
   application/service-principal permissions; manual operations cannot
   bypass source-domain guards.
8. Audit, outbox/inbox, event, Work Queue, retries and concurrency satisfy
  their source-domain contracts.
9. The gate verifies central ObjectStore capability without treating fake
  test storage as production readiness.
10. All required test layers pass and each Phase 4 Definition of Done criterion
   has reviewable evidence. Only then may TASK-076 be marked `SATISFIED`.

## 14. Verification

Discover repository-defined migration, format, lint, typecheck, unit,
contract, integration and E2E commands. Run PostgreSQL concurrency and
cross-domain flow tests; record exact commands/results in the TASK-076
implementation report. The report must distinguish scenarios exercised by
TASK-076 runtime tests from upstream lifecycle contracts verified by their
owning task suites. Do not claim one uninterrupted procurement-to-asset
journey unless one end-to-end test actually creates and traces those records
together.
