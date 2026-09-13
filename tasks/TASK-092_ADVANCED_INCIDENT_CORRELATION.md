# TASK-092 — Advanced Incident Correlation

```yaml
task_id: TASK-092
feature_id: F-050
workflow_id: WF-INT01
phase: P5
priority: P2
status: CODE_COMPLETE
readiness: SATISFIED
implementation_status: CODE_COMPLETE
owner_domain: incident
depends_on: TASK-033, TASK-051, TASK-090, TASK-092-R1
```

## Objective

Discover and score Incident correlation candidates, safely select or create a
Root Incident only under the deterministic v1 rules, automatically link only
unambiguous high-confidence candidates, and preserve immutable decisions and
relationship history for human review. Correlation only groups canonical
records; it is not remediation execution.

## Authority and boundaries

- TASK-033 owns the Incident/Root Incident entities and baseline
  Incident/Ticket relationship primitives. TASK-092 uses the owning Incident
  application command; it does not bypass the domain or destructively merge
  Incident records.
- TASK-051 owns network observations, topology, source confidence, timestamps
  and canonical freshness. TASK-092 uses TASK-051 freshness classification
  without a second TTL.
- TASK-090's typed event/rule/policy primitives may be reused where applicable,
  but correlation does not create Action Intents or call TASK-091 executors.
- Never close Incidents/Tickets, delete Incidents, rewrite source monitoring or
  network evidence, or infer remediation success from a correlation decision.

## Decision and evidence record

Persist an immutable tenant-scoped `CorrelationDecision` (or equivalent) with
subject Incident/event, evaluated Root candidates and their explanations,
selected Root when any, profile ID/version, evidence references/freshness/
contributions, 0..100 final confidence, outcome (`AUTO_LINK`,
`REVIEW_REQUIRED`, `NO_LINK`), actor/system principal, timestamp and
correlation ID. Evidence and historical decisions are never overwritten by a
new profile or a later evaluation.

Use the versioned TASK-092 v1 profile. Contributions are additive across
independent groups and the final score is capped at 100:

| Evidence | Contribution | Strong? |
|---|---:|---|
| Exact canonical source correlation/problem key | +100 | Yes |
| Same FRESH shared topology failure-domain ancestor | +60 | Yes |
| Same FRESH VLAN/subnet | +15 | No |
| Same site | +5 | No |
| Same affected canonical Service/dependency | +20 | No |
| Same normalized symptom/category family | +10 | No |
| Onset difference ≤5 minutes | +15 | No |
| Onset difference >5 and ≤15 minutes | +10 | No |
| Onset difference >15 minutes | +0 | No |

Use only the strongest applicable contribution from the topology/locality
group; never sum ancestor, VLAN/subnet and site for the same topology chain.
An exact deterministic source key may remain valid beyond the temporal
windows while its source/root Incident remains active. Do not use free-form
title/message equality as a deterministic key or raw-text/vector/LLM
similarity as strong evidence. Text similarity may be explanatory or optional
review context only.

Only TASK-051-classified FRESH topology contributes points or strong evidence.
STALE/UNKNOWN topology is retained as explanatory context but contributes
zero topology points. Do not independently recompute freshness.

## Decision policy

- `AUTO_LINK` requires score ≥85, at least one strong signal, one plausible
  candidate meeting the automatic threshold, no other candidate scoring ≥60,
  same tenant, eligible subject, a non-terminal/linkable Root, no manual
  detach suppression and no conflicting active Root relationship.
- `REVIEW_REQUIRED` applies for score 60..84, multiple candidates scoring
  ≥60, materially ambiguous evidence/root selection, stale/unavailable strong
  topology with insufficient safe context, or root/data-integrity ambiguity.
  These explicit ambiguity conditions require review even when the numeric
  score would otherwise fall below 60.
  It creates at most one actionable Work Item and does not mutate
  Incident/Root relationships. Preserve the machine recommendation. An
  authorized reviewer may attach to a Root, reject, or create/select a Root
  through TASK-033's canonical Root creation flow.
- `NO_LINK` applies below 60 when no explicit ambiguity/review condition
  applies, and records the decision without relationship or unnecessary Work
  Item effects. New material evidence may create a new decision; it never
  overwrites the old one.
- Never select the highest score automatically if another candidate scores
  ≥60. For example, 91/42 may auto-link the first Root; 91/68, 91/88 or
  multiple candidates ≥85 require review.

Candidate discovery is tenant-scoped and may use deterministic source key,
canonical Service/dependency, FRESH topology, site/network context and
relevant time context. Exclude terminal/non-linkable Roots and generic
historical matches without contextual evidence. Existing valid Root takes
precedence; do not create a new Root merely because another Incident matches.

Automatic Root creation is permitted only when no valid existing Root exists
and at least two eligible non-root Incidents in the same tenant share the
same exact deterministic canonical source correlation key, with no
conflicting active Root. Topology-only or heuristic evidence must result in
review; it cannot auto-create a Root.

For deterministic auto-created Roots, use a stable active cluster identity
equivalent to tenant + deterministic source type + source correlation key and
durably enforce uniqueness. If concurrent creation loses the uniqueness
race, reload the canonical Root and evaluate/attach to it.

## Relationship governance

An Incident↔Root relationship is independent of either Incident lifecycle and
of `CorrelationDecision.outcome`. Relationship history is canonical and
queryable; the mutable `incidents.root_incident_id` may only be a current
read projection/compatibility pointer, never the sole relationship evidence.
Keep link/detach history, decision IDs, profile version, evidence and actor.

A child may have at most one ACTIVE Root relationship; a Root may have many
children. Durable uniqueness and optimistic concurrency serialize competing
links. A loser reloads and records review/conflict evidence; it never silently
reparents the child. TASK-092 v1 has no automatic reparenting.

`INCIDENT.CORRELATION_ATTACH` is explicit and requires tenant/resource scope,
target Incident and Root, expected version, idempotency, reason, audit,
outbox and correlation ID. An authorized human reviewer with
`incident.correlation.review` may override NO_LINK or REVIEW_REQUIRED,
recording a separate manual decision and preserving the machine decision.
Creating a Root as part of review must use the existing TASK-033 canonical
Root creation authorization/command. Manual attach may explicitly override an
active detach-suppression for that same Root.

`INCIDENT.CORRELATION_DETACH` transitions an ACTIVE relationship to DETACHED.
It requires `incident.correlation.detach`, expected version, idempotency,
reason, audit, outbox and correlation ID. It preserves relationship/decision
history, removes the relationship from current grouping projections, and
does not delete/close/reopen either Incident, rewrite Tickets or erase
timeline history. If a Root has no remaining active children, do not delete
or close it.

Manual detach creates a durable suppression preventing automatic relink of
that same child to that same Root during the Root's active lifecycle. A
manual attach can override the suppression; a materially new Root is
evaluated independently. Suppression changes are themselves audited history.

## Authorization and events

Use an explicit tenant/resource-scoped `SYSTEM_CORRELATION` principal (or
canonical equivalent) for automatic links, authorized through the existing
AuthorizationPort. Never use a rule author, arbitrary human, tenantless
superuser or broad admin wildcard.

Permissions: `incident.correlation.read`, `.link`, `.review`, `.detach` (or
equivalent granular repository codes). Automatic principal uses `.link`;
human reviewers use `.review`; manual detach uses `.detach`. Existing
`incident.correlate` remains the TASK-033 baseline and does not imply these
new granular rights.

Define/adapt events: `INCIDENT.CORRELATION_EVALUATED`,
`INCIDENT.CORRELATION_REVIEW_REQUIRED`, `INCIDENT.LINKED_TO_ROOT`,
`INCIDENT.DETACHED_FROM_ROOT`, `INCIDENT.CORRELATION_REJECTED`, and
`ROOT_INCIDENT.CREATED_FROM_CORRELATION`. Events reference decision/evidence
IDs and minimal metadata; do not embed large raw monitoring/topology payloads.

Audit automatic/manual link, review rejection, detach, deterministic Root
creation and suppression creation/override. Timeline is a derived readable
projection. Work Queue items are created only for REVIEW_REQUIRED,
unresolved multiple-root/data-integrity conflicts and exhausted processing
failures requiring human action; deduplicate per unresolved decision. Never
create items for successful AUTO_LINK or ordinary NO_LINK.

## Idempotency and concurrency

Use stable evaluation identity equivalent to tenant + subject Incident/event
+ profile ID/version + material evidence fingerprint/generation. Equivalent
replay creates no duplicate decision side effects, active link, Root, Work
Item, audit or outbox. New material evidence/profile version may create a new
immutable decision.

Require durable protection for: two workers linking one Incident; competing
Root A/Root B links; concurrent deterministic Root creation; auto-link vs
manual detach; manual attach vs auto-link; and duplicate event redelivery.
Use database uniqueness, transaction/locking, idempotency and expected
versions; in-memory locking or SELECT-before-INSERT alone is insufficient.

## Required acceptance tests

- exact deterministic source key is strong +100 and does not depend on title,
  raw message or temporal proximity while source/root remains active;
- same fresh failure-domain ancestor is strong +60; topology group uses only
  the strongest applicable item and does not sum ancestor/VLAN/site;
- fresh VLAN/subnet +15 and same site +5 are non-strong; stale/unknown TASK-051
  topology is retained as context but contributes zero and is not strong;
- same canonical Service/dependency +20; same normalized symptom family +10;
- onset ≤5 minutes +15, >5 and ≤15 minutes +10, >15 minutes +0; temporal
  evidence alone never auto-links; final score caps at 100 and contributions
  remain individually explainable;
- `<60` gives NO_LINK without relation/work item unless an explicit
  ambiguity/root-integrity review condition applies; 60..84 gives
  REVIEW_REQUIRED; `≥85` without strong evidence gives REVIEW_REQUIRED;
- one candidate ≥85 with all other candidates <60 auto-links; a competitor
  ≥60, two ≥85 candidates, or material root/data ambiguity requires review;
- same-tenant, TASK-033-eligible subject and nonterminal/linkable Root checks; terminal or
  irrelevant historical Roots excluded; cross-tenant candidate excluded
  without leaking its identity or score;
- existing eligible Root is preferred; topology-only correlation may not
  automatically create a Root; deterministic Root creation requires at least
  two eligible non-root Incidents sharing an exact strong canonical source
  key and creates one Root under a uniqueness race;
- concurrent deterministic Root creation reloads the canonical Root;
  competing attach to Root A/B has one winner and loser never silently
  reparents; child has at most one ACTIVE relationship;
- duplicate/redelivered equivalent evidence does not duplicate decision,
  Root link, Root, audit, outbox or Work Item; a new material evidence epoch
  and a new algorithm version retain separate historical decisions;
- automatic linking uses tenant/resource-scoped `SYSTEM_CORRELATION` through
  AuthorizationPort; human permissions do not become system grants;
- manual attach can override NO_LINK/REVIEW_REQUIRED with reason and separate
  history; detach preserves relation/decision/history and does not change
  Incident/Ticket lifecycle; an empty Root is not deleted or closed;
- manual detach suppresses same-child/same-Root automatic reattachment during
  that Root lifecycle; authorized manual attach overrides suppression; a new
  Root is evaluated independently;
- auto-link vs manual detach and manual attach vs auto-link serialize; a
  material conflicting later evaluation for an already-linked child requires
  review and never automatically reparents;
- all candidate contributions, freshness, evidence references, profile
  version, principal, score and outcome persist; profile changes never
  reinterpret old decisions;
- AUTO_LINK emits audit/outbox/timeline facts; REVIEW_REQUIRED creates at
  most one Work Item; ordinary NO_LINK and successful AUTO_LINK create none;
- relationship commands require permission/scope, expected version,
  idempotency, reason, audit, outbox and correlation ID;
- no TASK-091 executor call, remediation, automatic closure, deletion,
  destructive merge or historical monitoring/network evidence rewrite.

## Out of scope

TASK-092 v1 does not perform self-healing/remediation, call TASK-091, close
Incidents/Tickets, delete Incidents, destructively merge records, rewrite
historical evidence, automatically reparent an Incident or use fuzzy semantic
similarity for automatic linking.
