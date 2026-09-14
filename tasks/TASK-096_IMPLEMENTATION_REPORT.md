# TASK-096 Implementation Report

Status: `CODE_COMPLETE`
Task: Explainable Recommendation Layer
Commit: TASK-096 implementation commit in repository history.

## Delivered

Implemented a tenant-scoped Recommendation module with exactly three source-
owned families: `INCIDENT_CORRELATION_REVIEW`, `KNOWLEDGE_GUIDANCE`, and
`ASSET_REPLACEMENT_REVIEW`. The module aggregates and explains canonical
decisions; it does not recalculate source scores or execute source workflows.

The source integrations use TASK-092's current REVIEW decision query,
TASK-093's session, item, rank, and presentation eligibility queries, and
TASK-059/TASK-094's active candidate/current fresh assessment query. No
Recommendation code reads another domain's private tables. Source generation,
profile/version, reason codes, evidence categories, family-specific score or
band, contexts, and freshness are preserved in a minimal structured envelope.
No source descriptions, comments, or Knowledge bodies are copied.

PostgreSQL persistence adds `recommendation.recommendations`, immutable
`recommendation.recommendation_revisions`, append-only
`recommendation.recommendation_interactions`, and per-family
`recommendation.source_watermarks`. Tenant/source identity and generation
uniqueness are durable. Revisions retain the source generation and TASK-096
profile version; same-generation retries are idempotent, and an older replay
cannot roll the current projection backward. Actor interactions bind to a
specific revision and generation. Dismissal does not affect another actor or a
future revision.

The worker performs tenant-scoped reconciliation on the existing worker host
using an explicitly provisioned `SYSTEM_RECOMMENDATION` principal with a narrow
reconciliation grant. It reconciles the owner-domain source queries, updates
watermarks, preserves prior revisions/interactions, and marks no-longer-eligible
projections as source-resolved or expired. Failed family reads remain
`SOURCE_UNAVAILABLE`; a successful empty source is `AVAILABLE_EMPTY`. It does
not mutate source domains, create Work Queue items, or invoke TASK-091.

The API provides feed, detail, revision history, interaction, and source
observability routes. The catalog is the discoverable family allow-list.
Feed/detail/history revalidate source eligibility and source-domain access;
inactive or inaccessible source records fail closed. Actions are server-defined
navigation descriptors only. Feed ordering preserves Knowledge rank and
replacement band/score within their families and does not compare scores across
families. There is no universal recommendation score or generic accept command.

`recommendation.read` and `recommendation.interact` are separate permissions.
Source permissions and Knowledge audience/presentation rules remain required.
Dismissal is audited; interaction writes are idempotent. API interactions do
not execute source actions. V1 emits no new outbox events; source refresh uses
reconciliation, and dismissal uses the canonical audit path.

## Acceptance coverage

| Acceptance area | Verification |
| --- | --- |
| Exactly three families; no global score; deterministic source generations; preserved Incident/Replacement score, profile, reasons and evidence | `tests/unit/task096-recommendation.test.ts` |
| Concurrent materialization, same-generation retry, immutable revisions, stale-generation replay, actor-scoped dismissal/revision binding, empty versus failed sources, tenant scope | `tests/integration/task096-recommendation-projection.test.ts` |
| Source-specific Incident eligibility and current TASK-092 review semantics; active TASK-059 candidate bound to current fresh TASK-094 assessment; tenant/read authorization; query failure | `tests/integration/task096-r2-recommendation-sources.test.ts` |
| Feed family availability (including one unavailable family alongside available-empty families); recommendation permission; inaccessible synthetic source hidden from detail and interaction; input validation | `tests/e2e/task096-recommendations.test.ts` |
| TASK-093 eligible session ordering/presentation/audience and source lifecycle | `tests/e2e/task093-recommendations.test.ts` and `tests/integration/task093-knowledge-foundation.test.ts` |
| Migration/schema, tenant constraints, revision/interactions persistence | `tests/migration/migrations.test.ts` |
| Domain action boundaries, permissions, append-only state, worker and API regressions | `tests/architecture/`, source-domain integration tests, and full repository suite |

## Verification

Final complete repository verification passed:

- `npm test` — 195 passed: 71 unit/architecture, 2 contract, 6 migration, 56 integration, 60 E2E; final process exit code 0.
- `npm run typecheck` — passed.
- `npm run lint` — passed, including boundary checks.
- `npm run format:check` — passed.
- `npm run test:migration` — 6 passed.
- `git diff --check` — passed.

PostgreSQL-backed tests used the existing local `TEST_DATABASE_URL` mechanism;
credentials were not emitted or persisted.

## Boundaries and v1 exclusions

This implementation does not add a fourth family, LLM explanations, global
ranking, user-authored rules/formulas, Work Queue duplication, a generic accept
command, TASK-091 execution, source-domain mutation, Procurement actions,
replacement approval, or TASK-095 KPIs. Recommendation history begins at
projection creation/reconciliation; it does not claim prior presentation.
Reconciliation is periodic (60 seconds) rather than source-event driven in v1.
TASK-097 has not been implemented.
