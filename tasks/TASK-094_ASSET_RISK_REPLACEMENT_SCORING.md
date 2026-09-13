# TASK-094 — Asset Risk + Replacement Scoring

## Metadata

```yaml
task_id: TASK-094
feature_id: F-050
workflow_id: WF-017/WF-INT01
phase: P5
priority: P2
status: NOT_STARTED
readiness: READY
blocker: NONE
owner_domain: asset
  depends_on: TASK-038, TASK-050, TASK-058, TASK-059, TASK-094-R1, TASK-094-R2, TASK-094-R3
```

Normative scoring rules are in `TASK-094-R1_RISK_REPLACEMENT_SCORING_CONTRACT.md`
and the referenced specification sections. TASK-094 is decision support; it
does not approve or execute replacement, procurement, retirement, disposal,
assignment change or automation.

`TASK-094-R3` has implemented and verified the required Incident–Asset
reliability and Warranty state foundations. See
`tasks/TASK-094-R3_IMPLEMENTATION_REPORT.md`. TASK-094 is READY / NOT_STARTED;
R3 does not implement scoring.

## Scope

Implement two separate immutable Asset assessments:

- Operational Risk Assessment: current operational risk represented by an
  in-service Asset.
- Replacement Priority Assessment: how strongly the Asset should be
  considered for replacement.

Both use integer scores 0–100, their own band, immutable profile ID/version,
evidence contributions and availability, completeness, reasons,
`calculated_at`, `as_of`, and correlation ID. Never store only a mutable score
on Asset. Never merge the two assessments.

Do not use Warranty, age or cost in Operational Risk. Replacement Priority
must consume the latest usable Risk assessment and must not add Incident,
Monitoring or corrective-maintenance counts again.

## Eligibility and Asset data

Normal scoring applies only to canonical lifecycle states `ASSIGNED`,
`IN_USE` and `REPAIR`. `PLANNED`, `PURCHASED`, `RECEIVED`, `AVAILABLE`,
`RESERVED`, `RETURNED`, `RETIRED` and `DISPOSED` are not scored as current
replacement candidates. Historical assessments remain queryable; lifecycle
leaving eligibility makes the latest projection non-current. A stale or
ineligible score is not current decision evidence.

Use the canonical Asset category ID for useful-life policy scope. Asset age
must use trusted in-service/acquisition evidence, in this order: existing
canonical `in_service_at`, immutable receiving/acquisition provenance,
verified acquired date, otherwise UNKNOWN. Never infer from `created_at`,
first Incident, first Monitoring observation, serial number or free text.
Manual verified date requires authorization, actor, reason/source, audit and
version protection; legacy rows are not backfilled from creation time.

Age is completed calendar months: the count of whole calendar-month
anniversaries from the evidence date to `as_of`, using UTC calendar dates and
clamping an anniversary to the last day of a shorter month. Count only
anniversaries not later than `as_of`; future evidence is invalid/UNKNOWN.
`age_ratio = asset_age_months / expected_life_months`.

Expected useful life comes from an explicit tenant-scoped, versioned
AssetReplacementPolicy selected by canonical Asset category/type and holding
`expected_life_months`. No matching policy means unavailable age evidence.
Useful life is replacement-planning policy, not depreciation.

## Operational Risk v1

Profile: `ASSET_RISK_V1`, immutable version. Evidence groups and maxima:

| Group | Rule | Maximum |
| --- | --- | ---: |
| Current Condition | max of known health and operational contributions | 40 |
| Reliability History | max of Incident and Monitoring episode contributions | 40 |
| Corrective Maintenance Burden | completed qualifying corrective repairs in last 180 days | 20 |

Current health: HEALTHY=0, WARNING=20, CRITICAL=40, UNKNOWN=unavailable.
Operational state: ONLINE=0, MAINTENANCE=15, OFFLINE/UNAVAILABLE=30,
UNKNOWN=unavailable. Do not add health and operational contributions.

Incident episodes use the last 90 days. Episode identity is Root Incident ID
when linked to a Root; otherwise Incident ID. Contributions: 0 episodes=0,
1=15, 2=25, 3+=40. Count unique episodes, not child Incidents under a
shared Root.

Monitoring reliability uses qualifying CRITICAL failure episodes from the
last 30 days: 0=0, 1–2=10, 3–5=25, 6+=40. Events already linked/correlated to
a counted Incident/Root episode are excluded. Monitoring owns canonical
episode identity; redelivery/repeated event rows are not separate episodes.
If identity cannot be resolved, the Monitoring evidence is unavailable.
Reliability is max(Incident contribution, Monitoring contribution), never a
sum.

Maintenance burden counts only completed corrective/repair work in the last
180 days: 0=0, 1=5, 2=10, 3+=20. Exclude scheduled/preventive work. Use
Maintenance-owned typed classification; never infer from title/description.

Risk score is the sum of the three group contributions, capped at 100.
Available group weights are 40, 40 and 20; completeness is their sum (0–100).
For a group composed from multiple required sources, count its availability
weight only when all required source queries/state inputs are available.
Known component contributions still contribute to the partial score; preserve
the unavailable component as missing evidence. An empty successful query
means available evidence with zero events. Query or domain failure means
UNAVAILABLE, not zero. Bands: 0–24 LOW, 25–49 MEDIUM,
50–69 HIGH, 70–100 CRITICAL. When score <50 and completeness <70, band is
UNKNOWN. Known evidence may establish HIGH/CRITICAL despite partial
completeness. Persist missing-evidence reasons.

The Asset latest `risk_state` projection mirrors a current valid Risk band;
no valid/current assessment means UNKNOWN. It is not a manual score field.
Do not allow generic Asset update to overwrite the derived projection.

## Replacement Priority v1

Profile: `ASSET_REPLACEMENT_V1`, immutable version. Components:

| Dimension | Maximum / availability weight |
| --- | ---: |
| latest usable Operational Risk score | 40 |
| age/useful life | 20 |
| Warranty/supportability | 15 |
| economic repair pressure | 25 |

Risk component is `floor(risk_score * 40 / 100)`. Missing usable Risk
assessment is unavailable, not a zero-risk score.

Age contribution by ratio: <0.70=0; 0.70–0.89=5; 0.90–0.99=10;
1.00–1.19=15; >=1.20=20. Exact boundaries are half-open: 0.70<=ratio<0.90,
0.90<=ratio<1.00, 1.00<=ratio<1.20, and ratio>=1.20. Expected life must be
positive.

Warranty state: VALID=0, EXPIRING=5, EXPIRED=15, UNKNOWN=unavailable. Use
canonical Warranty state/date query; do not infer warranty from Asset age.

Economic evidence uses a 365-day repair-spend window and same-Asset,
same-currency, positive canonical ACTUAL amounts only:

`repair_spend_ratio = canonical_actual_repair_spend / canonical_actual_acquisition_cost`

Ratios <0.20=0; 0.20<=ratio<0.40=5; 0.40<=ratio<0.60=10;
0.60<=ratio<0.80=15; >=0.80=25.
Acquisition cost uses immutable Procurement CostProvenance/CostAllocation,
preferring actual net acquisition evidence and applying canonical Credit
Note adjustments. COMMITTED is context only, not ACTUAL. Repair spend must
come from canonical actual Maintenance/repair financial evidence. If that
ledger is absent, values are invalid/non-positive, or currencies differ, the
dimension is unavailable. TASK-094 v1 has no FX conversion.

Unavailable dimensions add zero points and reduce completeness. Completeness
is the sum of availability weights (40/20/15/25). Score is capped at 100.
Bands: 0–39 MONITOR, 40–59 REVIEW, 60–79 PLAN, 80–100 PRIORITY. If score <60
and completeness <70, band is UNKNOWN. Missing evidence is explicit.

## Versioning, freshness and recalculation

Assessments are append-only. Recalculation creates a new assessment and
updates only a derived latest projection. Persist assessment ID, tenant,
Asset, exact score/band/completeness, profile ID/version, evidence
contributions/references and availability, missing reasons, date/policy
versions, trigger, `calculated_at`, `as_of`, `valid_until` and correlation ID.
Do not copy complete Incident, Monitoring, invoice or commercial documents.

Freshness is 24 hours: `valid_until = calculated_at + 24 hours`. After this,
assessment is STALE; consumers treat current risk as UNKNOWN while historical
evidence remains available. Recalculate after relevant Asset lifecycle or
health/operational change, qualifying Incident/Monitoring episode change,
corrective Maintenance completion, Warranty change, verified age evidence
change, cost/repair evidence change, useful-life policy version change or
profile version change. Also provide an explicitly authorized recalculation.
Use existing job/scheduler mechanisms; do not build another automation
engine. Persist source versions/evidence context; reject/retry a mixed
snapshot or preserve its exact versions and enqueue newer work.

Durable idempotency identity includes tenant, Asset, assessment type, profile
version and evidence generation/`as_of` epoch. Serialize concurrent
recalculation, lifecycle changes and candidate integration with database
invariants/optimistic concurrency, not process locks alone.

## Candidate and Work Queue behavior

Current CRITICAL Risk may create/upsert one `ASSET_RISK_REVIEW` Work Queue item
per unresolved review. Recalculation must not duplicate it; human review does
not alter computed score. HIGH may appear in reporting without a Work Item.

Replacement MONITOR/REVIEW is reporting/prioritization only. UNKNOWN creates
no candidate. PLAN/PRIORITY may create/upsert a TASK-059 Replacement
Candidate using the canonical Asset application command/port. This is a
review recommendation only. At most one active candidate exists per Asset;
do not recreate/reopen a terminal human disposition. A score drop does not
close/delete a candidate; an increase does not override a human decision.
Use latest assessment reference, score, band, profile/version and evidence
reasons. Do not write TASK-059 tables directly.

## Boundaries, permissions and events

Use read-only tenant/resource-scoped owning-domain query contracts for
Incident episodes, Monitoring reliability episodes, Maintenance history,
Warranty, and minimal Procurement cost evidence. Asset owns assessments,
verified acquisition evidence and useful-life policy. Maintenance, Incident,
Monitoring and Procurement own their source queries and records. Scoring
principal is explicit `SYSTEM_ASSET_SCORING`; no human impersonation,
wildcard or tenantless grant. Permissions include `asset.scoring.read`,
`asset.scoring.recalculate`, `asset.scoring.manage_policy` and only required
scoped source-query grants. Policy management is separate from scoring reads.
Cost queries expose only amount, currency, basis, provenance reference and
effective date; never supplier banking, full invoices or commercial document
contents.

Define events equivalent to `ASSET.RISK_ASSESSED`,
`ASSET.RISK_BAND_CHANGED`, `ASSET.REPLACEMENT_ASSESSED` and
`ASSET.REPLACEMENT_RECOMMENDED`, plus useful-life policy change events.
Events reference assessment IDs and minimal evidence summaries. Audit and
timeline preserve computed assessments separately from human decisions.

## Implementation prerequisites

The three repository dependencies identified during R1 were resolved by
`TASK-094-R2` without implementing scoring:

1. **Maintenance classification:** Maintenance now owns typed
   `CORRECTIVE`/`PREVENTIVE`/`INSPECTION`/`OTHER`/`UNKNOWN` classification and
   a tenant-scoped completed Asset history query. Legacy classifications remain
   `UNKNOWN`; completed classification is immutable; ambiguous UNKNOWN history
   is explicit.
2. **TASK-059 application boundary:** Asset now exports an authorized,
   idempotent Replacement Candidate recommendation command with explicit
   lifecycle outcomes, durable one-active-candidate protection, and terminal
   disposition suppression. TASK-094 must call this boundary rather than write
   TASK-059 persistence directly.
3. **Asset Risk-state compatibility:** Offboarding now owns typed return
   recovery state. Asset Risk is constrained to `LOW`, `MEDIUM`, `HIGH`,
   `CRITICAL` or `UNKNOWN`; legacy `MISSING` meaning is preserved in a
   deterministically linked recovery record or reconciliation evidence.

These prerequisites are verified and no longer block TASK-094. TASK-094 itself
remains `READY / NOT_STARTED` until its scoring runtime is explicitly started.

## Required verification

Required tests include:

- Risk mappings for HEALTHY/WARNING/CRITICAL and ONLINE/MAINTENANCE/OFFLINE;
  CRITICAL health and OFFLINE use max, not sum.
- Root child Incidents count as one episode; standalone Incidents count
  separately; monitoring tied to a counted Incident is excluded; redelivery
  does not inflate episodes.
- Corrective work counts by its typed classification; preventive work is
  excluded; query failure is not zero events.
- Missing component/group evidence lowers completeness; incomplete low score
  gets UNKNOWN; known evidence can still establish HIGH/CRITICAL; score caps
  and profile/version/history are preserved.
- Replacement Risk contribution is capped at 40 and Incident/Monitoring/
  Maintenance counts are not added again.
- Canonical acquisition date is used; `Asset.created_at` is never an age
  fallback; missing date/policy is unavailable; category-scoped useful-life
  brackets and exact ratio boundaries are tested.
- Warranty VALID/EXPIRING/EXPIRED scoring and UNKNOWN completeness behavior.
- Same-currency canonical actual economic evidence scores; cross-currency,
  committed-only, invalid values, missing repair ledger and missing actual
  acquisition evidence are unavailable; no FX conversion occurs.
- Both score caps, all bands, low-incomplete UNKNOWN rules and explainability
  contributions are verified.
- RETIRED/DISPOSED and non-eligible lifecycle assets are not scored as current
  candidates; old assessments remain append-only; latest projection updates;
  24-hour stale assessments are not current; lifecycle exit makes projection
  non-current.
- Recalculation is idempotent and concurrent workers produce canonical
  assessment history; source mutation during evidence collection cannot
  produce an unexplained mixed snapshot.
- Current CRITICAL Risk creates one deduplicated review item. PLAN/PRIORITY
  uses the TASK-059 command/port; a candidate is not duplicated or reopened
  after terminal human disposition. Score drop does not close a candidate;
  score increase does not override human disposition.
- Scoring never creates/approves/issues a PO, changes Asset lifecycle or
  assignment, retires/disposes an Asset, or invokes TASK-091.
- Tenant isolation, scoped `SYSTEM_ASSET_SCORING` permissions, no wildcard
  grant, read-only owning-domain queries, minimal Procurement evidence and no
  invoice/supplier document leakage.

Run repository tests, typecheck, lint/boundary, format, migration,
PostgreSQL integration/E2E and `git diff --check` gates.
