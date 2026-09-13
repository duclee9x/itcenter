# TASK-094-R1 — Risk + Replacement Scoring Contract

## Status

`BLOCKED / NOT_STARTED` — `SPEC_GAP / PLANNING_REQUIRED`.

TASK-094 runtime remains `BLOCKED / NOT_STARTED` until the normative
decisions below are resolved and a detailed implementation contract is
persisted. This remediation is specification/planning only. It does not
implement scoring or change Asset runtime behavior.

## Objective

Define an implementable, versioned, explainable Risk and Replacement Scoring
contract for TASK-094 without inventing weights, thresholds, evidence
semantics, or automated business actions.

TASK-094 remains decision support unless a later explicit normative rule
authorizes a named action. A score is not approval, a replacement order, or an
Asset lifecycle transition. High score alone must not create a PO, replace,
retire, or dispose an Asset, or invoke TASK-091.

## Reconciliation Findings

- Registry dependencies TASK-038, TASK-050, TASK-058 and TASK-059 are recorded
  `SATISFIED`. TASK-094 itself has no detailed task file; the registry points
  to `GENERATE_ON_READY`.
- Asset persistence has lifecycle, operational, health, warranty, compliance
  and `risk_state` dimensions. `risk_state` is a text field defaulting to
  `UNKNOWN`; no canonical Risk Score, bands, profile, or score history is
  implemented. The runtime Asset schema does not currently persist the
  conceptual `acquisition_date` listed in the data-model specification.
- TASK-059 already owns replacement candidates, review decisions and plans.
  Candidate creation accepts caller-supplied `score`, `reasons` and
  `assessment`, persists them and opens a review item. It does not calculate
  or validate a scoring profile. Human decisions include
  `APPROVE_REPLACEMENT`, `CONTINUE_USE`, `REPAIR_FIRST`, `EXTEND_WARRANTY` and
  `DEFER`.
- TASK-038 stores maintenance orders and warranty coverage. Orders have
  lifecycle state but no canonical repair-cost, downtime, failure-mode or
  repair-frequency summary contract. Warranties have provider, coverage and
  date records; the Asset `warranty_state` defaults to `UNKNOWN`. Current
  application exports provide creation/transition commands, not a scoring
  read contract for per-Asset history.
- Monitoring stores tenant-scoped events with Asset references, metric,
  severity and observed time. It is observation history, not by itself a
  canonical Asset health score or a defined health aggregation window.
- Incident stores lifecycle, priority, monitoring-event and correlation
  references. TASK-092 provides correlation decisions and relationships, but
  no TASK-094 per-Asset incident-frequency query or rule for deduplicating
  correlated incidents was found.
- TASK-050 stores audit observations/exceptions without overwriting Asset
  state. No normative rule was found making audit exceptions Risk Score
  evidence.
- TASK-076 provides immutable Procurement-owned Asset cost provenance and
  source-currency summaries for `COMMITTED`, `ACTUAL` and adjustments. It does
  not provide an FX policy or a canonical maintenance repair-cost ledger.
- Reporting describes replacement-candidate counts, deferred high-risk
  assets, repair-cost KPIs and replacement ratios, but does not define scoring
  semantics or thresholds. No TASK-094 Search projection requirement was
  found.
- The Maintenance/Warranty workflow contains factor lists, decision examples
  and sample scores. They do not define one consistent versioned formula. For
  example, one displayed contribution set sums to 86, while a separate example
  gives 91 without reproducible contributions. `MVP_PHASED_IMPLEMENTATION_PLAN`
  lists potential factors only.

## Normative Decisions Required

The detailed TASK-094 contract cannot be generated until these decisions are
specified. No answer is inferred from the examples in existing workflow
documents.

1. **Score relationship and purpose:** Are Risk Score and Replacement Score
   independent outputs, or is one derived from the other? Define the decision
   each score supports and whether either may produce a recommendation separate
   from a score.
2. **Scale and direction:** Define each score's scale, endpoints, direction
   (for example, whether higher means greater risk/replacement suitability),
   rounding/normalization and whether missing evidence can yield a score at
   all.
3. **Evidence catalog:** Specify the exact allowed signals for each score.
   Confirm or exclude Asset age, health, operational state, warranty,
   maintenance/repair history, Incident history, downtime, business/service
   criticality, support status, software/license compliance, repair estimates,
   replacement cost and cost provenance.
4. **Canonical evidence semantics:** For every selected signal, identify the
   owning-domain query and the exact included records/states, aggregation
   window, timestamp and tenant/resource checks. In particular define
   treatment of monitoring events versus canonical health state; active,
   restored and correlated Incidents; completed/cancelled maintenance; warranty
   validity; and estimate versus realized repair cost.
5. **Weights and calculation:** Define exact weights, formulas, caps,
   normalization, interaction rules and reproducible worked examples for each
   score. Specify whether factors are additive, multiplicative, categorical,
   or otherwise combined.
6. **Thresholds and bands:** Define score bands and any decision thresholds,
   including their labels and exact boundary behavior. Distinguish a score
   band from a business decision such as replacement review or repair.
7. **Unknown, missing and stale evidence:** Define per-signal behavior for
   absent, unavailable, invalid, stale, conflicting or not-applicable data.
   Unknown must not silently become healthy, zero risk, zero cost, or a
   favorable score. Define whether scoring abstains, returns partial evidence,
   or uses another explicitly bounded outcome.
8. **Eligible Asset lifecycle:** Enumerate which Asset lifecycle states may
   be scored and which are excluded or handled as historical-only. Clarify
   treatment of assigned, repair, retired, disposed, received and planned
   Assets.
9. **Age and value source:** Define the canonical age date when acquisition
   date is absent from current runtime persistence, and the authoritative
   replacement-value source. Do not guess age from `created_at` or compare
   incompatible monetary values without an explicit rule.
10. **Cost basis and currency:** Define whether repair/replacement comparisons
    use committed, actual, net, estimate or another cost basis; how Credit Note
    adjustments and effective periods apply; and whether unlike source
    currencies are excluded, converted under a specified FX policy, or handled
    another way. Identify the canonical source for repair cost, which is not
    currently represented by TASK-038's maintenance order model.
11. **Correlated evidence:** Define grouping and precedence to prevent
    double-counting the same underlying failure represented by Monitoring
    events, Incident records, Root Incident relationships, maintenance cases,
    cost records or repeated observations.
12. **Profile versioning and history:** Define stable profile identity and
    immutable version semantics; the input/evidence snapshot or references
    retained; score history; and how a consumer reconstructs a prior result
    after source data changes.
13. **Manual override:** State whether a person may override a score, band or
    recommendation. If allowed, define separate fields/records, permissions,
    reason, actor, expected-version behavior, effective duration/expiry,
    approval requirements and how the machine result remains preserved.
14. **Recalculation and freshness:** Define supported calculation modes and
    triggers (on-demand, domain events, scheduled or other), the event/source
    changes that require recalculation, idempotency identity, freshness limits
    per evidence source, and behavior when recalculation fails. No scheduler,
    temporal window or global freshness duration is presumed by this task.
15. **Automated consequences:** Explicitly state whether scoring only records
    decision support or may create a TASK-059 replacement candidate, Work Queue
    item, notification or other action. The safe default is no automatic
    procurement, replacement, retirement, disposal, Asset lifecycle mutation
    or TASK-091 execution from a score alone.
16. **Explainability and access:** Define required per-signal contributions,
    source references, source timestamps/freshness, profile version,
    calculation actor/time, reason codes and before/after history. Define
    permissions and scope for scores and sensitive cost/business-criticality
    evidence, including operator/reporting access.
17. **Consumer contract:** Identify which TASK-059 command/query consumes a
    computed score, whether TASK-059's caller-supplied score fields change, and
    which Reporting/Work Queue projections are required. Confirm whether
    Search is explicitly out of scope or needed for a named use case.

## Implementation Planning After Decisions

The eventual TASK-094 implementation plan must map source reads through owning
domains and avoid cross-domain table access. Likely touchpoints, subject to the
decisions above, are:

- Asset-owned score/evidence history and Asset lifecycle eligibility;
- read/query contracts from Maintenance/Warranty, Incident, Monitoring,
  Procurement Cost Provenance and any selected License/Software source;
- TASK-059 replacement-candidate integration;
- versioned Asset persistence migration, API/query or command handlers, and
  event/recalculation workers only if the chosen trigger model requires them;
- Reporting/Work Queue projections only for explicitly approved outcomes.

Search has no established TASK-094 projection requirement. Do not add Search
integration unless the resolved contract names a consumer and authorization
model.

These are planning candidates, not authorization to implement them in R1.

## Acceptance Criteria for R1

1. All 17 decision areas above have explicit normative answers or are
   explicitly declared out of scope with defined behavior.
2. Risk and Replacement scoring semantics are separately stated, including
   scale, evidence, weights, missing/stale data, eligibility, bands and
   correlated-evidence handling.
3. Formula examples are arithmetically reproducible and bind to a stable
   immutable profile version.
4. Manual override, recalculation, history/explainability and automated
   consequence boundaries are explicit.
5. Canonical data ownership/query boundaries and least-privilege access are
   defined; cost follows immutable TASK-076 provenance and no guessed mutable
   `Asset.cost` source is introduced.
6. The detailed TASK-094 implementation task and normative cross-document
   changes are persisted only after those decisions are resolved.
7. TASK-094 is changed to `READY / NOT_STARTED` only after this contract is
   complete. No runtime TASK-094 code is part of R1.

## Current Blocker

The decisions above require normative product/business input. Until supplied,
TASK-094 and TASK-094-R1 remain `BLOCKED / NOT_STARTED` with
`SPEC_GAP / PLANNING_REQUIRED`. Do not choose weights, thresholds, data
windows, unknown-data defaults, override semantics or automated actions by
inference.
