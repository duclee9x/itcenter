# TASK-076-R1 — Reconcile Phase 4 Gate Evidence and Unresolved Requirements

## Planning status

`PLANNING_REQUIRED` — specification/planning only. TASK-076 runtime integration
gate has not started.

## Purpose

Generate a detailed, testable Phase 4 gate contract by translating the
existing Definition of Done into verifiable evidence and reconciling it with
the completed feature contracts and reports. The Phase 4 criteria already
exist; this task must not describe them as absent. Initial reconciliation has
identified two unmet requirements that prevent the gate from passing:

1. Contract expiry/renewal alerts: TASK-075 implements the explicit expiry
   command but has no Contract alert scheduler or configured notice field.
   Existing normative rules prohibit inventing a global notice threshold and
   require explicit contract terms/configuration.
2. Cost lineage: Asset records expose purchase cost without canonical
   procurement/contract source references; License Entitlements expose cost
   with free-text supplier/contract references, not canonical source links.
   The Phase 4 Definition of Done requires both Asset and license costs to
   link back to procurement/contract sources, but does not settle their
   canonical relationship, allocation granularity or historical snapshot
   semantics.

## Required source reconciliation

- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/MVP_PHASED_IMPLEMENTATION_PLAN.md` Phase 4 Definition of Done
- Supplier, RFQ/Quotation, PO, Goods Receipt, Invoice/3-Way Match, Contract,
  Renewal and Commercial Document task contracts and implementation reports
- Asset receiving and license entitlement workflows
- `tasks/CODEX_TASK_REGISTRY.md`

## Gate criteria and evidence to reconcile

Use the Phase 4 Definition of Done in
`docs/MVP_PHASED_IMPLEMENTATION_PLAN.md` §90 as the normative checklist:

- Procurement Request to PO works.
- Receiving can create Assets.
- Partial receiving works.
- Invoice duplicate prevention works.
- 3-Way Match works.
- Contract expiry/renewal alerts work.
- Commercial documents are versioned/immutable where required.
- Asset and license costs link to procurement/Contract sources.

For criteria covered by completed task reports, cite their verification
evidence. Do not rerun or rewrite their business rules without a concrete
failure. Keep the alert and cost-lineage criteria open until their missing
configuration/relationship semantics are normatively resolved and implemented.

## Constraint

Do not infer new commercial or lifecycle business rules from this planning
marker. Reconcile existing normative sources, record conflicts or unimplemented
dependencies precisely, and request a normative decision only where those
sources do not settle the required gate behavior.

No TASK-076 runtime code or integration-gate status change is authorized by
this planning marker.
