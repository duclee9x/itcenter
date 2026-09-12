# TASK-061 — Advanced Search + Phase 3 Integration Gate

## 1. Task Metadata

```yaml
task_id: TASK-061
feature_id: F-047/PHASE-GATE
workflow_id: WF-SRCH01/P3-E2E
phase: P3
priority: P1
readiness: READY
status: NOT_STARTED
owner_domain: search
depends_on: TASK-050, TASK-051, TASK-052, TASK-053, TASK-055, TASK-056, TASK-058, TASK-059, TASK-060
```

## 2. Objective

Complete the Phase 3 search capability and demonstrate an integrated,
tenant-safe operational search experience across the Phase 3 domains already
declared as dependencies. Preserve search as a rebuildable read model; every
business action must re-read canonical state and use its owning command.

## 3. Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/SEARCH_INDEXING_SPEC.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/STATE_MACHINE_MASTER_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`
- Relevant P3 task contracts and implementation reports for TASK-050, -051,
  -052, -053, -055, -056, -058, -059 and -060.

## 4. In Scope

- Extend the existing PostgreSQL-backed search projection/API into a
  tenant-scoped, permission-aware cross-domain search for implemented P3
  entities, based on source data actually available in this repository.
- Support exact structured identifiers before prefix, fuzzy and full-text
  matches; normalize Unicode and Vietnamese secondary matching, IP/MAC and
  serial forms without reducing exact-match priority.
- Implement supported entity/type filters, safe highlights, stable cursor
  pagination and freshness/degraded metadata. Autocomplete must use a bounded
  lightweight query path.
- Populate and maintain documents through idempotent projection/indexing
  behavior with source-version ordering, tombstones and a rebuild/reindex path.
  Keep canonical PostgreSQL records authoritative.
- Enforce tenant and resource scope before returning results, counts, facets,
  snippets or autocomplete candidates. Recheck sensitive result authorization
  where required by owning-domain policy.
- Provide exact identifier fallback to canonical relational sources when the
  search projection is unavailable; do not perform expensive fuzzy scans as
  fallback.
- Complete the Phase 3 integration gate with database-backed tests showing
  the dependent P3 workflows remain connected through canonical entity IDs,
  Work Queue/timeline references and source commands where applicable.
- Add only the minimum schema, query/indexing code, event consumer wiring,
  authorization integration, metrics and contract changes needed for these
  outcomes. Keep PostgreSQL full-text/trigram behind a search application
  boundary; a dedicated search service is not required for this task.

## 5. Out of Scope

- Procurement and contract entities not implemented until Phase 4.
- Semantic/vector search, personalization, graph ranking, a dedicated search
  engine, UI redesign or unrelated P3 domain changes.
- Using stale search documents as authority for writes or irreversible actions.
- Auto-merging records based on fuzzy similarity.

## 6. Current Repository Context

- A minimal `GET /api/v1/search` route queries
  `operations.search_documents`, currently prioritizing exact key and then a
  text substring match.
- The operations migration creates the initial search document table and
  tenant/exact/prefix indexes; Ticket creation writes a search document.
- The repository has PostgreSQL unit-of-work, outbox/inbox, audit, RBAC,
  domain-owned workflows and database-backed E2E test helpers.
- Inspect current source events, owning-domain read contracts and P3
  implementation reports before selecting indexed fields or consumer wiring.

## 7. Domain Rules

- Search documents are derived, tenant-scoped and rebuildable; source records
  remain canonical.
- Apply tenant/scope filters before producing any result metadata.
- Exact display codes and structured identifiers outrank prefix, fuzzy and
  full-text results.
- Search relevance cannot override authorization or expose restricted fields.
- Index consumers are idempotent and ignore older source versions; deletes or
  anonymization produce tombstones/authorized removal from the projection.
- Search result actions navigate to context; commands independently authorize
  and validate canonical state.

## 8. State Transition

```text
Canonical domain changes
→ committed outbox / controlled reindex
→ version-ordered search projection
→ authorized query response
```

Search queries do not change business state.

## 9. Authorization

```yaml
permission: existing authenticated query authorization and owning-resource scopes
resource: tenant-scoped search document and canonical resource
scope: tenant first, then applicable organization/site/team/department/resource scope
high_risk: false
reauth_required: false
mfa_required: false
approval_required: false
```

Do not invent a broad search permission or treat document visibility metadata
as a replacement for owning-domain authorization. Record any genuine policy
ambiguity as `SPEC_CONFLICT` before implementing it.

## 10. Database / Data Model

- Evolve `operations.search_documents` with the canonical document fields
  required by the Search spec: display metadata, aliases/keywords, searchable
  and exact terms, filters, security scope, source version, freshness and
  indexed timestamps.
- Add tenant-scoped uniqueness, exact/prefix/filter indexes and PostgreSQL
  full-text/trigram indexes only where the current query path needs them.
- Preserve rebuildability; do not add canonical business state to Search.
- Add bounded cursor state or a signed cursor representation bound to query,
  filters, sort and authorization context.

## 11. API

Evolve `GET /api/v1/search` with `q`, `types`, supported filters, `limit` and
`cursor`. Add a bounded autocomplete endpoint only if needed by the existing
API conventions.

Return authorized result type/id/display fields, safe highlights and score,
plus `next_cursor`, query duration and index freshness/degraded state. Do not
return counts/facets unless they are filtered by the same authorization scope.

## 12. Events / Indexing

- Consume only committed source events with catalogued schemas for implemented
  P3 sources, or use an explicitly bounded canonical reindex job where an
  applicable event is unavailable.
- Use inbox/dedupe and source-version checks; projection writes are atomic with
  consumer progress.
- Do not emit search events as business facts. No business event is required
  for a read-only query.

## 13. Idempotency and Concurrency

- Query requests are side-effect free; cursor contents are bound to the query
  and caller's tenant/scope context.
- Repeated indexing of the same source version is a no-op; an older version
  cannot overwrite a newer document or tombstone.
- Reindex/rebuild work is bounded, resumable and safe to repeat.

## 14. Transaction Boundary

Canonical domain transactions remain unchanged. Search projection updates
commit with inbox/dedupe state after source event delivery; no external search
service calls occur inside a database transaction.

## 15. Audit / Timeline / Notifications

- Search queries do not create business audit or timeline events by default.
- Follow existing security/observability policy for aggregate query metrics;
  do not retain sensitive raw queries indefinitely.
- Search has no notification side effects.

## 16. Error and Degraded Behavior

- Invalid query/filter/cursor returns canonical validation errors.
- Cross-tenant access is denied without leaking existence or counts.
- Search index outage returns documented degraded metadata and permits only
  bounded exact lookup fallback against canonical sources.
- Fuzzy/full-text failure never triggers unbounded DB scans.

## 17. Required Tests

- Unit: normalization, exact-before-fuzzy ranking, Vietnamese diacritic
  secondary matching, MAC/IP normalization and cursor binding.
- Repository integration: tenant/scope filtering, type/filter queries,
  tombstones, freshness metadata and source-version ordering.
- Consumer integration: duplicate delivery, stale event, retry and rebuild.
- API/E2E: cross-domain P3 entities, scope-denied no-leak behavior, safe
  highlights, pagination, autocomplete bounds and exact fallback while the
  index is unavailable.
- Phase gate: focused end-to-end scenarios for dependent domains use canonical
  identifiers and preserve each domain's own permissions, audit/events and
  Work Queue/timeline behavior.
- Failure cases: index outage, malformed cursor, incomplete source payload,
  unauthorized scope and failed/retried indexing.

## 18. Acceptance Criteria

1. Exact structured identifiers outrank fuzzy/text results for the same query.
2. Search returns only authorized, tenant-scoped results; unauthorized
   resources leak no title, code, snippet, count or autocomplete candidate.
3. Supported P3 entity documents are populated and updated idempotently from
   canonical sources, and stale source versions cannot overwrite newer state.
4. Cursor pagination is stable and bound to caller scope, query, filters and
   sort.
5. Response metadata exposes index freshness and degraded state.
6. Search outage permits bounded exact fallback and does not run broad fuzzy
   scans against OLTP.
7. Rebuild/reindex can restore derived documents without mutating source
   aggregates or duplicating effects.
8. The P3 integration gate's declared domain scenarios pass and do not bypass
   owning-domain commands, permissions, audit or state machines.
9. Unit, contract, migration, integration, E2E, format, lint and typecheck
   checks pass; registry, report, CURRENT_TASK and handoff are reconciled.

## 19. Assumptions To Validate

- The Search specification labels itself `Foundation Draft` while traceability
  marks F-047 `DESIGN_READY`. Confirm implementation details do not create a
  material contradiction; preserve normative security and exact-match rules.
- Index only entity fields and event payloads present in implemented domains;
  do not fabricate entities or introduce a new deployable service.
- The phase gate validates integration of already completed domain features;
  it does not reopen their implementation scopes.

## 20. Completion Rule

TASK-061 may be marked `CODE_COMPLETE` only after all acceptance criteria and
applicable verification gates pass, its completion report is recorded, and
its implementation commit is created separately. This contract is planning
only; implementation requires an explicit user request.
