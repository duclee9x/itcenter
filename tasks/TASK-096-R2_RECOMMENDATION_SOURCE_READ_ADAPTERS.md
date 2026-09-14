# TASK-096-R2 — Recommendation Source Read Adapters Foundation

```yaml
task_id: TASK-096-R2
parent_task: TASK-096
status: CODE_COMPLETE
readiness: SATISFIED
implementation_status: IMPLEMENTED_AND_VERIFIED
scope: owner_domain_read_adapters_only
depends_on: TASK-059, TASK-092, TASK-093, TASK-094, TASK-096-R1
```

## Objective

Provide the two missing source-domain read boundaries required by TASK-096:

- Incident/TASK-092 current correlation-review source;
- Asset/TASK-059 active replacement candidate bound to its current TASK-094
  assessment.

This task does not implement Recommendation projection, revision or interaction
storage, feed aggregation, API routes, source commands or new business scoring.
It does not begin TASK-097.

## Source contracts

`queryIncidentCorrelationRecommendationSource` is owned/exported by Incident.
It returns only the latest immutable per-Incident machine decision when its
outcome is `REVIEW_REQUIRED` and source-owned current reviewability checks
still pass. Manual attach/reject, active detach suppression, superseding
decisions, terminal/ineligible subjects and terminal/non-Root candidates are
excluded. It preserves decision/evaluation identity, score, canonical profile,
reason code and structured candidate evidence. Incident/Root visibility is
authorized per resource; the query is tenant-scoped and paginated.

`queryReplacementCandidateRecommendationSource` is owned/exported by Asset.
It returns only an `UNDER_REVIEW` candidate bound to the exact assessment that
is still referenced by the Asset scoring-latest projection. The Asset must
remain eligible and the assessment must be current, valid and `PLAN` or
`PRIORITY`. It returns minimal score/band/completeness/profile/reason and
contribution summaries with a stable candidate ID/version + assessment ID
generation. Reads require `asset.read` and `asset.scoring.read`.

Both contracts report `AVAILABLE`, `AVAILABLE_EMPTY` or `SOURCE_UNAVAILABLE`;
authorization and validation failures remain explicit errors. SQL query errors
are isolated with a savepoint before returning unavailable status. Neither
adapter writes source state or performs business actions. No new migration or
Recommendation persistence is required.

TASK-093 needs no new R2 adapter: future TASK-096 presentation composes
`readRecommendationSession`, `queryKnowledgeRecommendationEligibility`, and
existing canonical session/item data while revalidating exact article
publication, version, audience and authorization.

## Acceptance and verification

- REVIEW is returned; AUTO_LINK, NO_LINK, superseded, manually resolved and
  suppressed decisions are excluded.
- Source profile, confidence, reason/evidence categories and stable decision
  generation are preserved without rescoring.
- Active PLAN/PRIORITY candidate is returned only with its exact latest fresh
  assessment; REVIEW/MONITOR, terminal, stale and mismatched assessments are
  excluded.
- Tenant and source-read authorization are enforced; unauthorized source
  identifiers are not returned.
- Empty source and failed query remain distinct.
- Queries are read-only and bounded with deterministic order.
- Full project test, typecheck, lint/boundaries, format, migration tests,
  PostgreSQL integration/E2E and `git diff --check` pass.

## Result

The Incident and Asset source-domain adapters are implemented and exported by
their owning modules. They preserve canonical source generation/evidence,
enforce tenant and source-read authorization, distinguish empty from failed
queries, and perform no business mutations. TASK-093's existing session and
eligibility reads remain the Knowledge source boundary; R2 adds no third
adapter. No migration or Recommendation-owned persistence was added.

Verification: `npm test` passed with 189 tests (68 unit/architecture, 2
contract, 6 migration, 54 integration, 59 E2E); `npm run typecheck`,
`npm run lint`, `npm run format:check`, `npm run test:migration`, and
`git diff --check` passed. PostgreSQL source-adapter tests are included in the
54 integration tests.
