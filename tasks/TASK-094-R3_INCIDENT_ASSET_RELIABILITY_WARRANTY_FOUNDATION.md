# TASK-094-R3 — Incident–Asset Reliability + Warranty State Foundation

## Status

`CODE_COMPLETE` — runtime foundation only. TASK-094 scoring remains
`READY / NOT_STARTED`; R3 does not implement scoring.

## Scope

R3 supplies two missing owning-domain capabilities:

1. Incident-owned, tenant-scoped canonical `AFFECTED_ASSET` links and minimal
   Asset Incident history; Monitoring-owned reliability episode queries and
   event-to-episode resolution.
2. Maintenance-owned canonical Warranty state evaluation and minimal per-Asset
   Warranty query, with `asset.warranty_state` treated only as a projection.

R3 must not create Risk/Replacement assessments, policies, scores, scoring
workers, TASK-059 recommendations, or Risk Work Queue items. It does not
implement TASK-095.

## Incident–Asset relationship

Incident owns immutable link history (`AFFECTED_ASSET`) containing tenant,
Incident, Asset, deterministic/manual source, optional source reference,
actor/system identity, reason and timestamp. Same-tenant existence is
validated. No relationship is inferred from user assignment, text, service,
or topology.

Allowed sources are a canonical Monitoring event's same-tenant `asset_id`,
an explicitly selected canonical Asset in supported intake, or an authorized
manual command. Deterministic legacy migration may link only when a canonical
Monitoring event proves the same-tenant Asset. No fuzzy/backfill guessing.
Manual unlink is an audited append-only detach; it does not erase the link.

Incident history queries start from direct Asset links. Root relationships
deduplicate episode identity only; Asset links are not propagated from sibling
Incidents. Query results are minimal and distinguish successful empty results
from failure. Authorization uses `incident.asset_history.read` for aggregate
Asset history reads and the narrow Incident link permission for manual
changes; the aggregate query does not misrepresent an Asset ID as one Incident
ID. Every internal/system call is tenant-bound and resource-scoped.
Permissions are registered without granting roles.

Monitoring reliability queries return canonical episodes, not delivery rows.
Episode identity uses canonical source plus non-empty source correlation key.
Rows without resolvable episode identity are reported as ambiguous/unavailable,
not independently counted. Queries expose stable event references so the
Incident Monitoring source can be excluded from duplicate reliability counts.

## Warranty state authority

Maintenance Warranty records own source evidence. Effective evidence is a
same-tenant record covering `as_of`. Exactly one applicable record can be
evaluated. No applicable record produces `UNKNOWN / NO_WARRANTY`; invalid or
missing end evidence produces `UNKNOWN`; more than one plausible applicable
record produces `UNKNOWN / AMBIGUOUS_WARRANTY_EVIDENCE`.

Policy `WARRANTY_STATE_V1` uses canonical UTC date semantics for the existing
date-valued `starts_at` and `ends_at`. `as_of` is normalized to its UTC
calendar date; `ends_at <= as_of UTC date` is EXPIRED, exactly 90 days
remaining is EXPIRING, and dates later than 90 days are VALID. The effective
validity boundary is evaluated consistently at UTC date granularity. The 90-day
EXPIRING threshold is independent of 90/60/30/7-day reminder milestones.

The query returns minimal state, source ID/date, evaluated time, policy ID and
version, availability and reason. Query failure is not represented as a
successful UNKNOWN result. The Asset Warranty value is a derived projection
limited to VALID/EXPIRING/EXPIRED/UNKNOWN. A deterministic, idempotent refresh
must run on evidence changes and at date boundaries using the existing worker
pattern; old source evidence is not rewritten.

## Verification requirements

Cover explicit and Monitoring-origin links, same-tenant enforcement, no
inference, append-only unlink, Asset-scoped Incident history, Root episode
dedupe without sibling Asset propagation, windowing, empty-vs-unavailable,
Monitoring episode dedupe and overlap references, Warranty 90-day boundaries,
missing/overlapping records, UTC date handling, projection refresh and
idempotency. Assert no TASK-094 scoring persistence/runtime is introduced.

## Implementation outcome

Implemented the Incident-owned AFFECTED_ASSET link/history and tenant-scoped
Asset Incident query, Monitoring-owned validated reliability episode query
and resolver, `WARRANTY_STATE_V1` evaluation/query, and the scheduled Asset
Warranty projection refresh. Added conservative legacy migrations, narrow
permission catalog entries without role grants, audited/idempotent link and
unlink commands, API exposure for manual link and Warranty/Monitoring queries,
and explicit intake/Monitoring-origin Asset linkage. Database guards enforce
same-tenant Asset/Incident references and append-only relationship history.

No Risk or Replacement assessment, scoring formula/worker, useful-life policy,
TASK-059 candidate from score, Work Queue risk item, or TASK-095 implementation
was added. Verification evidence is recorded in
`tasks/TASK-094-R3_IMPLEMENTATION_REPORT.md`.
