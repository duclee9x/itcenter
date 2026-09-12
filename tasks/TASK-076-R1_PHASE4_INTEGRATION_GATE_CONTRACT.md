# TASK-076-R1 — Contract Alert + Asset/License Cost Provenance Integration Contract

## Remediation status

`CODE_COMPLETE` — normative/specification remediation only. TASK-076 runtime
integration was not implemented or started by this task.

## Objective

Make Contract alert scheduling, Asset/License commercial-cost provenance and
the Phase 4 integration-gate evidence contract normative before TASK-076
implementation. The existing Phase 4 Definition of Done remains authoritative.

## Normative contract

### Contract alert configuration and scheduling

- No global renewal/expiry warning interval may be invented.
- Proactive action requires an explicit Contract-specific
  `renewal_notice_date` or `renewal_notice_period` combined with Contract
  `end_at`. The repository model expresses the period as
  `renewal_notice_period_days`.
- When both date and period exist, the explicit date wins. Otherwise derive
  `renewal_action_at = end_at - renewal_notice_period`.
- No alert configuration means no proactive warning; natural expiration at
  `end_at` remains independent and must proceed.
- Invalid/impossible configuration creates a configuration/data-integrity
  exception; the system never guesses a date.
- Bind alert settings/facts to an immutable ContractVersion. A material term
  change recalculates only future schedules; old alert facts remain.
- Logical alert identity is tenant + Contract + applicable ContractVersion +
  trigger type + trigger time. Scheduler retries/concurrency cannot duplicate
  events, Work Items or notifications.
- A due action may create actionable Work Queue/notification context or an
  authorized Renewal Case/candidate. It never executes a renewal, extends the
  old Contract or executes a successor. Auto-renew metadata does not authorize
  automatic commercial execution.
- Define events equivalent to `CONTRACT.RENEWAL_NOTICE_DUE` and
  `CONTRACT.EXPIRY_ACTION_DUE` where the explicit action applies. They reference
  Contract, ContractVersion, trigger type and trigger time. `CONTRACT.EXPIRED`
  is a separate natural lifecycle fact.

### Immutable cost provenance

- Cost history is immutable CostProvenance/CostAllocation, not mutable Asset
  or License cost fields. Asset/License cost values are derived summaries.
- A provenance record binds tenant, target type/id, canonical source
  type/document/immutable-version-reference/line, amount, currency, quantity/allocation basis,
  cost basis, effective period, allocation method, audit/correlation reference
  and stable idempotency identity.
- Source types include PO, Invoice, Credit Note, Contract and ContractVersion;
  use line-level source IDs when the cost is line-derived. Free-form display
  numbers alone are insufficient.
- Preserve COMMITTED (commercial commitment), ACTUAL (effective approved
  Invoice) and ADJUSTMENT (applied Credit Note/explicit correction) as
  separate append-only facts. Credit adjustments use positive semantic amount
  plus direction; they do not mutate Invoice allocations.
- Asset lineage traverses Asset → `received_unit_id` → POSTED Goods Receipt
  unit/line → PO line/version → Invoice allocation where available → Contract
  and ContractVersion where applicable. Goods Receipt proves physical
  receiving, not cost.
- A PO allocation can create provisional COMMITTED cost. An effective Invoice
  adds ACTUAL cost while retaining the PO value. An applied Credit Note adds
  an adjustment. Deterministic multi-unit allocation, including minor-unit
  remainder distribution, reconciles exactly to source line total.
- The target-unit set and quantity come from durable source-line/receipt-line
  allocation. Invoice allocations use TASK-074 receipt-line evidence and
  stable `received_unit_id`; any minor-unit remainder goes to the first units
  in stable ID order. Never lose/create money through rounding.
- Do not invent allocation for header freight, tax, fees, discounts or other
  charges. Leave those at source unless an explicit policy exists.
- License cost attaches primarily to Entitlement/Pool/commercial entitlement
  unit, not user assignment. Recurring terms preserve effective periods; a
  successor Contract creates new provenance and never rewrites predecessor
  history. Amendments apply new price provenance only to the effective period
  backed by the applicable ContractVersion.
- Preserve source amount/currency. Do not invent FX policy. Corrections append
  adjustment/superseding evidence.
- Procurement owns the commercial allocation ledger; Asset and License own
  their entities and derived summaries. Use owning-domain application
  commands/events, outbox/inbox and idempotent projections. No direct
  cross-domain table writes or distributed transaction.
- Normal success creates no Work Item. Missing/ambiguous sources,
  non-reconciling allocations and integrity conflicts create actionable work.

### ObjectStore and Phase 4 gate

- The phase environment verifies either configured central ObjectStore or an
  explicit unavailable/not-ready capability result. A fake adapter proves
  automated behavior only, not production configuration.
- TASK-076 verifies the full path Procurement Request → Supplier/RFQ/Quotation
  → PO → Goods Receipt → Asset registration → Invoice/3-Way Match → cost
  provenance, plus configured Contract alert action and License provenance
  where applicable.
- The gate must trace each Phase 4 Definition of Done criterion to evidence;
  isolated CRUD existence does not pass the gate.

## Required concurrency and test coverage

TASK-076 requires the exact scenarios in
`tasks/TASK-076_PHASE4_PROCUREMENT_TO_ASSET_INTEGRATION_GATE.md`, including
date precedence, missing-notice natural expiry, scheduler races, stale
ContractVersion alert schedules, received-unit/PO/Invoice/Contract cost
lineage, deterministic multi-Asset allocation, invoice-vs-credit races,
idempotent event redelivery, License renewal period history and ObjectStore
capability reporting.

## Files reconciled

- `docs/PROCUREMENT_SUPPLIER_PO_INVOICE_CONTRACT_DOCUMENT_WORKFLOW.md`
- `docs/ASSET_RECEIVING_WAREHOUSE_ASSIGNMENT_TRANSFER_RETURN_WORKFLOW.md`
- `docs/SOFTWARE_CATALOG_ARTIFACT_REPOSITORY_LICENSE_WORKFLOW.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/SYSTEM_WORKFLOW_INDEX_TRACEABILITY_MATRIX.md`
- `tasks/TASK-075_CONTRACT_RENEWAL_COMMERCIAL_DOCUMENT_GOVERNANCE.md`
- `tasks/TASK-076_PHASE4_PROCUREMENT_TO_ASSET_INTEGRATION_GATE.md`
- `tasks/CODEX_TASK_REGISTRY.md`
- `tasks/CODEX_TASK_DEPENDENCY_GRAPH.md`
- `CURRENT_TASK.md`
- `IMPLEMENTATION_HANDOFF.md`

No runtime migration, API, worker, schema or code change was made for
TASK-076. `STATE_MACHINE_MASTER_SPEC.md` was not changed because no lifecycle
state or transition was introduced.

## Completion

Normative conflicts/gaps for the alert and cost-provenance scope are resolved.
TASK-076 is `READY / NOT_STARTED`, its detailed implementation contract is
generated, and CURRENT_TASK/HANDOFF point to TASK-076. TASK-076 runtime work
remains unstarted pending explicit user instruction.
