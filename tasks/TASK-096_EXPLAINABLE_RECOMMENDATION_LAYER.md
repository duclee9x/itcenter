# TASK-096 — Explainable Recommendation Layer

```yaml
task_id: TASK-096
feature_id: F-050
workflow_id: WF-INT01
phase: P5
priority: P2
status: READY
readiness: READY
implementation_status: NOT_STARTED
owner_domain: recommendation
depends_on: TASK-090, TASK-092, TASK-093, TASK-094, TASK-095, TASK-096-R1, TASK-096-R2
contract: TASK-096-R1
```

## 1. Objective and scope

Implement the Explainable Recommendation Aggregation Layer. It aggregates
canonical recommendation/advisory artifacts, filters them for the requested
context and actor, preserves source evidence/version/reason data, and provides
secure discovery and navigation to the owning workflow. It does not own the
underlying business decision.

TASK-096 v1 supports exactly:

1. `INCIDENT_CORRELATION_REVIEW` from TASK-092;
2. `KNOWLEDGE_GUIDANCE` from TASK-093;
3. `ASSET_REPLACEMENT_REVIEW` from TASK-059 candidates backed by TASK-094
   assessments.

TASK-096 is not an ML/LLM recommender, a second rules or automation engine, a
replacement for TASK-092/093/094, or a Work Queue. It adds no universal score.
Out of scope: generic AI/“next best action”, TASK-090 ActionIntent
recommendations, TASK-091 self-healing recommendations, Work Queue item
recommendations, duplicate Asset critical-risk recommendations,
Procurement/security optimization, user-authored rules, or a tenth TASK-095
KPI.

## 2. Ownership and source decisions

- TASK-092 remains authoritative for Incident correlation candidates,
  confidence, profile/version, reason codes, evidence categories and review
  outcome. Surface only canonical human-review decisions (`REVIEW_REQUIRED` or
  its canonical equivalent). Never surface `AUTO_LINK` or `NO_LINK` as a
  recommendation. Do not recalculate correlation scores or attach Incidents.
- TASK-093 remains authoritative for Knowledge search, eligibility, rank,
  score, profile/version, session and audience. Surface only its canonical
  eligible items after source presentation validation. Do not rank/search
  Knowledge independently, bypass `PUBLISHED`/audience/read checks, or create
  fallback content.
- TASK-059 remains authoritative for Replacement Candidate lifecycle and human
  disposition; TASK-094 remains authoritative for the assessment. Surface
  only active candidates whose associated current valid assessment is `PLAN`
  or `PRIORITY`. Preserve candidate and assessment references and source
  review state. Do not create another candidate or approve/execute a
  replacement.
- TASK-094 already creates the deduplicated `ASSET_RISK_REVIEW` Work Queue
  item for critical risk. TASK-096 must not duplicate it.
- TASK-095 remains the governed KPI catalog. TASK-096 does not mutate/add a
  TASK-095 KPI.

All source reads go through owner-domain application/query contracts. No
cross-domain private-table SQL is permitted. Required source adapters are
`IncidentCorrelationRecommendationSource`,
`KnowledgeRecommendationSource`, and
`ReplacementCandidateRecommendationSource`; reuse existing owner-domain
primitives and add only minimal owner-domain read adapters where required.

### Implementation-time source-boundary reconciliation

Repository inspection for R1 found:

- Incident exports `readIncidentCorrelationHistory(tx, incidentId)`, which is
  tenant-scoped and returns one Incident's decision/candidate/review history;
  it does not provide a minimal feed/query for current `REVIEW_REQUIRED`
  decisions, current source generation, and presentation eligibility.
- TASK-093 exports `readRecommendationSession` and Knowledge eligibility
  queries. These provide canonical session/item data and a reusable
  presentation check, but no compact TASK-096 family-source contract. A
  Knowledge adapter may compose these owning-domain queries and must retain
  TASK-093 validation.
- Asset exports the TASK-059 recommendation write command, but no
  read-only query for active candidate state bound to its current
  non-stale TASK-094 assessment. Existing API route persistence access is not
  an application boundary for TASK-096.

TASK-096-R2 completed the two runtime source dependencies with minimal
owner-domain application queries: Incident now enumerates current eligible
review decisions; Asset reads active human-review candidates bound to their
current valid assessment. Both are tenant-scoped, authorization-aware and
read-only, and preserve stable source generation. Knowledge does not require a
new persistence/query foundation: TASK-093's `readRecommendationSession`,
`queryKnowledgeRecommendationEligibility` and canonical session/item history
remain the source for later presentation composition. TASK-096 consumes these
ports and must not bypass them with cross-domain SQL.

## 3. Canonical projection and revision model

Persist tenant-scoped concepts equivalent to:

- `Recommendation`: stable identity, family/source identity, tenant, canonical
  context references and mutable latest projection;
- `RecommendationRevision`: append-only explanation/source snapshot;
- `RecommendationInteraction`: actor-scoped append-only interaction;
- optional source/projection watermarks for missed-event reconciliation.

The public envelope contains at least:

- recommendation and tenant IDs;
- family, source domain/type/ID and source version/generation;
- canonical context references;
- TASK-096 projection/profile identity and version;
- source rank, score or band only where applicable (never a normalized global
  score);
- reason codes and structured explainability/evidence references;
- created/refreshed/generated timestamps, source validity/freshness;
- current projection state and actor's interaction state;
- server-defined typed `available_actions`.

`RecommendationRevision` is immutable and records recommendation ID, revision,
source version/generation, source profile/version, TASK-096 profile/version,
reason codes, minimal evidence summary, source rank/score/band where relevant,
generation time, and superseded revision reference when applicable. A
materially changed source generation appends one revision. Reprocessing the
same generation does not. The mutable latest projection points to the current
revision/state; older revision evidence is never overwritten. Do not copy
Incident comments, Ticket descriptions, Knowledge bodies or financial records.

Projection states are `ACTIVE`, `SUPERSEDED`, `RESOLVED_BY_SOURCE`, and
`EXPIRED`. These describe only the recommendation projection. Source workflow
states remain authoritative. A new revision makes its predecessor logically
`SUPERSEDED`; source terminality makes the current projection
`RESOLVED_BY_SOURCE`; source-specific freshness/validity makes it `EXPIRED`.
Retain every revision and interaction. Do not add generic `APPROVED`,
`REJECTED`, or `EXECUTED` states.

Initial deployment reconciliation may create current projections only from
currently eligible source artifacts and marks them `INITIAL_RECONCILIATION`.
It does not claim that a recommendation was historically presented. Projection
rebuild reads current canonical sources, never mutates them, never executes
actions and never deletes actor interactions.

## 4. Family presentation semantics

### INCIDENT_CORRELATION_REVIEW

Present only current TASK-092 human-review decisions. Preserve source Incident,
candidate Root/Incident references, source confidence score, algorithm/profile
version, reason codes, evidence categories and ambiguity state where the actor
is authorized. The meaning is “Review this possible Incident correlation”; it
does not attach anything.

### KNOWLEDGE_GUIDANCE

Present TASK-093 eligible recommendation items for canonical
`TICKET`/`RECOMMENDATION_SESSION` context where TASK-093 provides that
association. Preserve session, exact Knowledge item/version, TASK-093 rank,
score, profile/version, reason/evidence and eligibility reference. Revalidate
through TASK-093/Knowledge presentation authorization immediately before
return. Do not return body text in the aggregation projection.

### ASSET_REPLACEMENT_REVIEW

Present an active TASK-059 candidate only while its associated latest valid
TASK-094 assessment is current and band is `PLAN` or `PRIORITY`. Preserve
Asset/candidate/assessment references, score, band, completeness,
profile/version, summarized reasons and candidate review state, subject to
source authorization. This is a prompt to review only. No extra candidate,
Work Item, approval or Procurement request is created.

## 5. Context, ordering and explainability

Supported canonical context types are `INCIDENT`, `TICKET`,
`RECOMMENDATION_SESSION`, and `ASSET`. Context links must come from source
records. Do not infer from names, user assignment, service similarity or fuzzy
matching.

Preserve source-owned ordering within each family:

- Incident correlation: canonical TASK-092 review/confidence ordering where
  supplied;
- Knowledge: TASK-093 rank;
- Replacement: `PRIORITY` before `PLAN`, then canonical replacement score
  where applicable.

Across families, do not compare scores or claim business priority. Stable
pagination may use family plus generation time as a technical order, clearly
identified as such.

Each family response explains what is suggested, which domain/source/profile
and generation produced it, why it is eligible now, contributing evidence
categories, freshness, and which source workflow can be opened. Use typed
reason codes, deterministic templates and source-owned explanation metadata.
No LLM/generated explanation or free-form content that could contradict
source evidence.

## 6. Actor interactions

Interactions are append-only, tenant-scoped and actor-scoped:

- `VIEWED`
- `DISMISSED`
- `OPENED_SOURCE`

An interaction does not alter recommendation validity or source state.
`DISMISSED` hides that revision/source generation from that actor's default
feed only; it does not reject the source decision. A newer material revision
may be shown again. Actor B is unaffected by Actor A's dismissal. Bind
interactions to revision/source generation. Retrying the same idempotency key
does not duplicate a logical interaction.

There is no generic `RECOMMENDATION.ACCEPT`. Responses expose only
server-defined typed `available_actions` with owning domain, required
permission, and canonical endpoint/command identifier. These are navigation
metadata, never executable URLs or action authorization. Mutations go through
TASK-092, TASK-093, TASK-059 or other owning-domain commands.

## 7. Freshness, source failure and refresh

Preserve source-specific validity; do not impose a universal TTL. Revalidate
source eligibility at presentation time:

- resolved/non-review TASK-092 source is not `ACTIVE`;
- TASK-093 must revalidate publication, exact version, audience and
  authorization;
- terminal TASK-059 disposition or stale/ineligible TASK-094 assessment is
  not `ACTIVE`.

Source events may create/update/supersede/resolve/expire a projection only.
Internal reconciliation repairs missed events from owner-domain queries. A
family source query failure returns `SOURCE_UNAVAILABLE`, not an empty family.
Successful no-match returns `AVAILABLE_EMPTY`. In a combined feed each family
has an explicit availability result; if one source fails, return the other
available families with explicit partial-family availability, never imply the
failed family had no recommendations. Do not fabricate a recommendation from
another source.

## 8. API contract

Provide repository-consistent, tenant-scoped read and interaction routes
equivalent to:

- `GET /api/v1/recommendations` — feed, optional allow-listed family/context/
  projection-state filters and pagination;
- `GET /api/v1/recommendations/{id}` — authorized detail/explanation;
- `GET /api/v1/recommendations/{id}/revisions` — authorized history;
- `POST /api/v1/recommendations/{id}/commands/interact` — typed interaction
  `VIEWED`, `DISMISSED`, or `OPENED_SOURCE` with idempotency.

Routes validate tenant, canonical context, family/state filters, pagination,
permission and source authorization. No arbitrary query language. A read grant
does not grant source-record access. Do not return a redacted placeholder when
the actor cannot read the source; fail closed/omit it without leaking IDs,
names, titles, scores or evidence.

## 9. Authorization and tenant boundary

Use narrow `recommendation.read` and `recommendation.interact` (or canonical
equivalents). `recommendation.interact` authorizes only these presentation
interactions; it grants no source mutation, approval or execution.

Before returning an item, require recommendation permission and the owning
source's read/presentation authorization:

- Incident: canonical Incident read authorization;
- Knowledge: TASK-093 recommendation/session plus `knowledge.read`,
  audience and resource scope;
- Replacement: Asset and TASK-059 candidate read authorization.

All projections, revisions, interactions, contexts and source queries are
tenant-scoped. Source tenant must equal recommendation tenant; cross-tenant
references fail closed. There is no cross-tenant feed. Do not expose source
IDs or metadata in reason codes when source authorization denies access.

## 10. Events, audit and operational behavior

If emitted, recommendation-owned events are limited to
`RECOMMENDATION.PROJECTED`, `RECOMMENDATION.SUPERSEDED`,
`RECOMMENDATION.SOURCE_RESOLVED`, and `RECOMMENDATION.DISMISSED` (or
repository-equivalent versioned names). They contain recommendation/revision,
source references and minimal summaries only. They are not source workflow
commands. Use transactional outbox and idempotent source-event consumption.

Audit actor dismissal and other material TASK-096 writes where repository
policy requires it; never duplicate source-domain audit. Use repository
timeline conventions where an operator-visible event is required. Record
refresh failures, per-family source availability, projection lag, revisions,
reconciliation repairs and interaction counts as operational metrics. Do not
treat dismissal as recommendation-quality ground truth.

## 11. Idempotency, concurrency and failure

Durable projection identity binds tenant, family, source artifact, source
generation/version and applicable TASK-096 profile version. Unique constraints
and transactions serialize duplicate event delivery, concurrent refresh,
reconciliation/event races and revision assignment. Bind materialization to
the exact source generation; if source changes during refresh, retry/reconcile
or persist the exact generation and enqueue a newer refresh. Do not use
process-local locks.

Actor dismissal racing a source update remains bound to the old revision; a
new revision can be visible. Source terminality racing response construction
requires a current owner-domain eligibility check before returning an item.
Interactions use durable idempotency and tenant/actor/source-generation scope.
Source read failure is observable and cannot become `AVAILABLE_EMPTY`.

## 12. Explicit no-side-effect invariant

Generating, refreshing, reading or interacting with TASK-096 must not itself:

- attach/detach an Incident or alter TASK-092 decisions;
- resolve/transition a Ticket;
- mutate Knowledge or change TASK-093 rank/session decisions;
- create an ActionIntent or invoke TASK-091;
- change Asset lifecycle/assignment or approve a replacement;
- create/issue a PO or Procurement request;
- create or alter a Work Queue item.

No source event triggers those actions through TASK-096.

## 13. Required acceptance tests

Dedicated TASK-096 tests must cover:

- each of the three families, preserving canonical source ordering, score,
  profile/version, reason/evidence and source state;
- TASK-092 REVIEW appears while AUTO_LINK and NO_LINK do not; resolved source
  ceases to be active; no score recalculation;
- TASK-093 exact eligible items appear; rank is preserved; unpublished,
  stale, audience-denied or unauthorized Knowledge is omitted; no fallback or
  independent ranking;
- active PLAN/PRIORITY candidate appears; terminal disposition/stale assessment
  is not active; no second candidate or approval;
- no global score across families; deterministic explanations and source
  freshness;
- actor A dismissal does not hide from B, persists for the same generation,
  and does not suppress a new source revision;
- `recommendation.read`, `.interact`, source read and tenant checks, including
  no metadata leak and no source mutation grant;
- family `AVAILABLE_EMPTY` versus `SOURCE_UNAVAILABLE`, and combined-feed
  explicit partial availability;
- duplicate event, concurrent refresh, reconciliation race, idempotent
  interaction, dismissal/new-revision race and terminal-source race;
- initial reconciliation provenance without fabricated historical views;
- deterministic rebuild preserves interactions and has no source side effects;
- outbox/audit behavior and rollback on failed projection/interaction write;
- prohibited side effects: no Incident attach/detach, Ticket transition,
  Knowledge mutation, ActionIntent/TASK-091, Asset lifecycle change,
  candidate approval, Procurement write or Work Queue mutation.

Use focused unit/domain, owner-domain adapter integration, API authorization,
PostgreSQL persistence/concurrency and E2E tests. Test files and commands are
finalized in the implementation report. TASK-097 integration-gate work is
explicitly out of scope.
