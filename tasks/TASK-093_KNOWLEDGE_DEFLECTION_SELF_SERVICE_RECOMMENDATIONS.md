# TASK-093 — Knowledge Deflection + Self-Service Recommendations

## 1. Task Metadata

```yaml
task_id: TASK-093
feature_id: KNOWLEDGE-DEFLECTION
workflow_id: WF-PC-K
phase: P5
priority: P2
status: NOT_STARTED
readiness: BLOCKED
owner_domain: Helpdesk / Problem Knowledge
dependencies: [TASK-037, TASK-061, TASK-092, TASK-093-R1, TASK-093-R2]
blocker: SCOPE_DEPENDENCY / SECURITY_CONCERN (TASK-093-R2 foundation must complete before recommendation runtime)
```

## 2. Objective

Implement governed Knowledge recommendations for support context, self-service
deflection, explainable ranking and interaction/feedback evidence, with safe
escalation to canonical Ticket intake. Recommendation is advisory and may
avoid Ticket creation only after explicit user resolution confirmation.

## 3. Required Specifications

- `AGENTS.md`
- `MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md`
- `HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`
- `SEARCH_INDEXING_SPEC.md`
- `DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `STATE_MACHINE_MASTER_SPEC.md`
- `API_COMMAND_CONTRACT_SPEC.md`
- `EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `REPORTING_KPI_OPERATIONS_OVERVIEW_WORK_QUEUE_WORKFLOW.md`
- `TASK-037_PROBLEM_CHANGE_KNOWLEDGE.md`
- `TASK-061_ADVANCED_SEARCH_PHASE3_INTEGRATION_GATE.md`
- `TASK-092_ADVANCED_INCIDENT_CORRELATION.md`
- `TASK-093-R1_KNOWLEDGE_DEFLECTION_SELF_SERVICE_CONTRACT.md`

## 4. In Scope

- Reuse TASK-037 Knowledge governance/lifecycle and TASK-061 Search; do not
  create another search engine or Knowledge lifecycle.
- Build tenant-, authorization-, audience- and scope-filtered candidates,
  revalidate exact article version before presentation, rank with the
  versioned TASK-093 v1 profile, and present at most three end-user items.
- Persist recommendation session, item and interaction evidence, feedback,
  explicit resolution confirmation and Ticket handoff references.
- Consume TASK-092 Root Incident/Service context when available; never invoke
  TASK-091 or mutate Incident/Ticket lifecycle directly.
- Implement APIs, permissions, events, idempotency, concurrency,
  observability and tests required by this contract.

## 5. Out of Scope

- Knowledge authoring, publishing or lifecycle redesign.
- A new Search engine/index ownership model.
- Generated authoritative troubleshooting instructions or LLM fallback.
- Infrastructure remediation, TASK-090 Action Intent creation, TASK-091
  execution, or automatic remediation.
- Automatic Ticket/Incident closure, destructive merge, or historical rewrite.
- Automatic online changes to ranking weights from feedback.

## 6. Current Repository Context

- TASK-037 canonical article states: `DRAFT`, `IN_REVIEW`, `PUBLISHED`,
  `ARCHIVED`; aggregate `version` is the current optimistic version. Use these
  actual states and do not create a second KnowledgeVersion lifecycle model.
- TASK-061 owns RBAC-aware Search/indexing and its explicitly bounded exact
  canonical fallback. Its current PostgreSQL source list does not yet include
  Knowledge; add Knowledge through that existing source/index architecture
  only if required by implementation.
- TASK-092 provides explainable Root Incident correlation context.
- Canonical Ticket creation/intake and state commands remain Helpdesk-owned.

## 7. Domain Rules

### Knowledge eligibility, authorization and privacy

- A recommendation must be same-tenant, canonical `PUBLISHED`, current and
  visible, authorized under `knowledge.read` equivalent, audience-compatible,
  service/product/platform-compatible and not withdrawn, superseded,
  archived or otherwise unavailable.
- Search-index presence is never sufficient. Revalidate canonical lifecycle,
  exact version, audience and authorization immediately before presentation;
  drop candidates that became ineligible.
- End-user context may receive only governed end-user-safe content. Operator-
  only procedures (privileged commands, credential operations, destructive
  recovery, network/security administration and infrastructure runbooks) must
  not leak to ordinary users.
- Do not reveal inaccessible content through title, snippet, count, score,
  tags, rank, existence, error or timeline. Cross-tenant recommendation is
  forbidden.
- Search failure uses only TASK-061-authorized fallback; otherwise return
  `NO_RECOMMENDATION` and allow Ticket intake to continue. Never bypass RBAC
  with unrelated direct canonical-table queries.
- Do not propagate credentials, secrets, protected telemetry or unnecessary
  raw payloads into recommendation evidence.

### Versioned score profile

Profile identity/version is persisted on each session/item. Any change to
weights, threshold, ranking semantics or evidence interpretation creates a
new profile version. Historical recommendations are not reinterpreted.

| Evidence | Contribution | Strength / handling |
|---|---:|---|
| Exact Known Error or explicit Knowledge binding | +60 | STRONG |
| Same Problem / Known Error relationship | +50 | STRONG; when semantically the same source as the row above, use only the stronger contribution |
| Same canonical Service/product | +20 | Context |
| Same normalized category/symptom | +15 | Context; raw free text alone is never strong |
| Same supported platform/environment | +10 | Context |
| Prior explicitly confirmed successful deflection for equivalent normalized context | +10 | Historical evidence |

Cap score at 100. Candidate threshold is 70; below 70 is not presented as a
curated recommendation. Score never overrides lifecycle, authorization,
audience, tenant, scope or safety. TASK-061 fuzzy/full-text relevance may
assist candidate discovery/ranking only. Present at most three items, ordered
by explainable relevance; retain Search order for equal TASK-093 scores and do
not return filler.

An ACTIVE Root Incident may prioritize associated eligible end-user-safe
status/guidance over generic troubleshooting where appropriate. Avoid
recommending local remediation known ineffective for a shared upstream
outage. Do not mutate or close the Root Incident. Track
`KNOWN_INCIDENT_DEFLECTION` separately from `KNOWLEDGE_RESOLUTION`.

### Sessions, interactions and deflection

- Persist `KnowledgeRecommendationSession`, `KnowledgeRecommendationItem`
  and append-only `KnowledgeRecommendationInteraction` (or equivalent).
- Session records tenant, actor/user, optional Ticket, normalized context
  reference, profile/version, created/presented times, outcome and correlation.
- Each item records `knowledge_id`, exact canonical aggregate `version`, rank,
  score, evidence contributions, profile/version, eligibility decision
  reference and presentation time. Do not copy article body into history.
- Outcomes: `NO_RECOMMENDATION`, `PRESENTED`, `USER_RESOLVED`,
  `NOT_HELPFUL`, `ESCALATED` (or equivalent).
- Opening/clicking an article, remaining on it, `HELPFUL`, or a high score is
  not resolution. Accept explicit `ISSUE_RESOLVED` confirmation; objective
  verification is allowed only if another existing normative workflow
  defines it.
- Feedback values include `HELPFUL`, `NOT_HELPFUL`, `ISSUE_RESOLVED`.
  Feedback is evidence only; it does not mutate ranking weights, profile or
  Knowledge publication.
- Self-service success may avoid creating a Ticket. On no result, unresolved
  issue, escalation or `NOT_HELPFUL`, continue canonical Ticket creation and
  preserve collected context plus the recommendation attempt/session. Do not
  require equivalent re-entry. Existing Tickets are never directly closed by
  TASK-093; all Ticket transitions use Helpdesk commands.
- `PRESENTED`, article-opened, helpful or score=100 never changes Ticket or
  Incident lifecycle.

### TASK-090/TASK-091 boundary

Recommendation is not an Action Intent or Action Execution. TASK-093 never
calls TASK-091. A future automated remediation affordance must go through
TASK-090 policy/intent and TASK-091 execution.

## 8. State / Outcome Model

Knowledge article lifecycle remains TASK-037-owned:

```text
DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED
```

Recommendation session outcomes are independent:

```text
NO_RECOMMENDATION | PRESENTED | USER_RESOLVED | NOT_HELPFUL | ESCALATED
```

These outcomes do not change Knowledge, Ticket or Incident lifecycle.

## 9. Preconditions

- Tenant and actor context are unambiguous.
- Support context is normalized and minimally scoped.
- Search candidates pass canonical current-version, access, audience and
  applicability validation before any presentation data is returned.
- A stable request/session identity and correlation context are available.
- Ticket handoff is dispatched through canonical Helpdesk intake.

## 10. Authorization

```yaml
permissions:
  - knowledge.recommendation.use
  - knowledge.recommendation.review
  - knowledge.feedback.submit
knowledge_read_permission_required: true
tenant_and_resource_scope_required: true
audience_scope_required: true
```

Recommendation permission never substitutes for underlying `knowledge.read`
or audience/resource authorization. Knowledge authoring/publishing stays
TASK-037-owned. `knowledge.recommendation.review` is for authorized operator
review; `knowledge.feedback.submit` is actor/session scoped.

## 11. Database / Data Model

Tables/records, or repository-equivalent structures:

- `KnowledgeRecommendationSession`: tenant, actor, Ticket reference,
  normalized context reference, profile/version, timestamps, outcome,
  correlation ID, request identity.
- `KnowledgeRecommendationItem`: session, Knowledge ID and exact article
  version, rank, score, evidence contributions, profile/version, eligibility
  decision reference and presented timestamp. No body copy.
- `KnowledgeRecommendationInteraction`: append-only selection/open/feedback/
  resolution/escalation evidence, actor, item/session, idempotency identity,
  timestamp and correlation. Duplicate submission has one effective result.

Use tenant-scoped foreign/reference validation, durable request/session
idempotency, uniqueness for the same effective presentation/interaction, and
transactional outbox for emitted domain events. Preserve old decisions/items
when profile or article state later changes. Do not create a parallel
KnowledgeVersion entity; bind to TASK-037 canonical version semantics.

## 12. API

Adapt to existing route conventions. Expected command/query intents:

```text
POST /api/v1/knowledge/recommendation-sessions
GET  /api/v1/knowledge/recommendation-sessions/{session_id}
POST /api/v1/knowledge/recommendation-sessions/{session_id}/commands/select
POST /api/v1/knowledge/recommendation-sessions/{session_id}/commands/feedback
POST /api/v1/knowledge/recommendation-sessions/{session_id}/commands/confirm-resolution
POST /api/v1/knowledge/recommendation-sessions/{session_id}/commands/escalate
```

Use `Idempotency-Key` on retryable writes. Return only currently eligible,
authorized end-user-safe items. Escalation creates/continues canonical
Ticket intake and links the session; it is not a Ticket state mutation. Do
not add an automatic Ticket close/resolve endpoint.

## 13. Commands

```text
KNOWLEDGE.RECOMMEND
KNOWLEDGE.RECOMMENDATION_SELECT
KNOWLEDGE.RECOMMENDATION_FEEDBACK
KNOWLEDGE.DEFLECTION_CONFIRM
KNOWLEDGE.RECOMMENDATION_ESCALATE
```

Commands require tenant/session scope, actor authorization, idempotency,
correlation and expected version where the canonical aggregate is versioned.

## 14. Events Produced

Define payload contracts for:

```text
KNOWLEDGE.RECOMMENDATION_CREATED
KNOWLEDGE.RECOMMENDATION_PRESENTED
KNOWLEDGE.RECOMMENDATION_SELECTED
KNOWLEDGE.RECOMMENDATION_FEEDBACK
KNOWLEDGE.DEFLECTION_CONFIRMED
KNOWLEDGE.RECOMMENDATION_ESCALATED
KNOWLEDGE.KNOWN_INCIDENT_DEFLECTION_CONFIRMED
```

Reference session/item/Knowledge version/Ticket/Root Incident and profile;
include only minimal authorized evidence references. Never embed article
body or protected source payload.

## 15. Events Consumed

- Existing TASK-061 Search and canonical Knowledge eligibility/read
  interfaces.
- TASK-092 Incident/Root Incident context where available.
- Existing Helpdesk/Ticket references and canonical intake interfaces.
- No TASK-091 execution events are consumed to perform remediation.

## 16. Idempotency

Stable tenant + request/session identity prevents duplicate sessions/items.
Same key and same request returns the original outcome without repeated
presentation/feedback/outbox effects; same key with a different payload
returns `IDEMPOTENCY_KEY_CONFLICT`. Duplicate selection, feedback,
resolution confirmation or escalation is idempotent. Event redelivery must
not duplicate interactions or Ticket handoff.

## 17. Concurrency

Handle Knowledge version/state/access changes during generation and before
presentation; Ticket creation racing an active recommendation session;
duplicate resolution confirmation; duplicate feedback; and duplicate
recommendation processing. Do not expose stale/inaccessible items and do
not rewrite already presented evidence. Serialize/uniquely constrain
canonical session and handoff identity.

## 18. Transaction Boundary

Atomically persist the session and its recommendation items/presentation
references plus required local outbox records. Ticket creation is performed
through Helpdesk's owning command; link the resulting canonical Ticket by
application contract/event, never by cross-domain table write. Search/network
calls and user interaction do not hold a database transaction open.

## 19. Async Side Effects

- TASK-061 Search/index retrieval and permitted exact fallback.
- Timeline/projection updates from reference-only events.
- Optional notifications only if an existing workflow requires them.
- Ticket handoff through canonical Helpdesk intake.

No article body replication, generative content, remediation executor or
cross-domain direct writes.

## 20. Audit Requirements

Ordinary article views and recommendation interactions use interaction
history, not excessive compliance audit. Audit privileged/manual overrides
and governance-sensitive actions where applicable. Preserve actor, tenant,
session/item, Knowledge version, reason, correlation and outcome. Never
include inaccessible Knowledge details, secrets or full article content.

## 21. Timeline Requirements

Ticket timeline may show safe operator-facing entries such as “Self-service
recommendation attempted before Ticket creation”, “Knowledge KB-52 v4
recommended”, “User reported recommendation was not helpful”, and “Ticket
created after unsuccessful self-service attempt”. Timeline is derived, not
source of truth; omit any Knowledge reference the viewer cannot access.

## 22. Notification Requirements

No notification is required for ordinary recommendation success/failure.
Any future notification follows existing consent, audience and access rules;
it must not reveal inaccessible Knowledge.

## 23. Search / Projection Impact

TASK-061 owns Knowledge indexing and RBAC-aware retrieval. Extend only its
existing source/index contracts if needed. Apply tenant, lifecycle, audience,
service/product/platform and authorization constraints before presentation;
revalidate canonical state/version. Search index presence is not authority.
TASK-093 must not add a parallel search engine or bypass TASK-061 fallback
rules. Expose safe freshness/failure outcomes without leaking candidate
counts.

## 24. Error Codes

Use canonical equivalents for:

```text
KNOWLEDGE_NOT_FOUND_OR_NOT_VISIBLE
KNOWLEDGE_VERSION_INELIGIBLE
KNOWLEDGE_AUDIENCE_DENIED
RECOMMENDATION_CONTEXT_INVALID
RECOMMENDATION_SESSION_NOT_FOUND
RECOMMENDATION_SESSION_CONFLICT
IDEMPOTENCY_KEY_CONFLICT
PERMISSION_DENIED
VERSION_CONFLICT
SEARCH_UNAVAILABLE
TICKET_HANDOFF_FAILED
```

Do not reveal whether an inaccessible Knowledge article exists.

## 25. Retry / Compensation

Retry only idempotent Search/session operations under existing retry rules.
Search failure degrades to `NO_RECOMMENDATION` when no TASK-061-approved
fallback is available; Ticket creation remains available. No compensation
mutates an article or closes a Ticket. Handoff uncertainty must be reconciled
through canonical Ticket request identity before retry.

## 26. Observability

Measure sessions, presented items, selected articles, helpful/not-helpful
feedback, explicit resolutions, known-incident deflections, escalations,
Tickets avoided and Tickets created after recommendations. Track Search
freshness/failure and authorization-denial outcomes without logging protected
candidate details. A click is not a deflection metric.

## 27. Required Tests

### Unit / ranking / lifecycle

- [ ] Canonical TASK-037 `PUBLISHED` current Knowledge is eligible; `DRAFT`,
      `IN_REVIEW`, `ARCHIVED`, withdrawn, superseded or unavailable content is excluded.
- [ ] Exact Known Error/binding and same Problem/Known Error evidence score
      correctly; duplicate semantic source uses only the strongest value.
- [ ] Service/product, normalized symptom, platform and confirmed-history
      contributions are explainable and score is capped at 100.
- [ ] Score below 70 yields `NO_RECOMMENDATION`; at most three items are
      returned in deterministic relevance order.
- [ ] Profile/version and exact Knowledge aggregate version are preserved.
- [ ] Article opened/clicked, `HELPFUL`, or score 100 does not resolve;
      explicit `ISSUE_RESOLVED` confirms deflection.

### Authorization / Search / privacy

- [ ] Tenant isolation and resource/audience authorization apply.
- [ ] Inaccessible Knowledge leaks no title, snippet, count, score, tags,
      rank, existence or error distinction.
- [ ] End user cannot receive operator-only content.
- [ ] Search/index presence alone does not bypass canonical lifecycle/access.
- [ ] Withdrawn/superseded/inaccessible version between search and
      presentation is not returned.
- [ ] Search failure follows TASK-061 fallback only and never blocks Ticket
      creation or bypasses RBAC.
- [ ] No generated troubleshooting fallback and no TASK-091 call.

### Handoff / interactions / integration

- [ ] No recommendation and `NOT_HELPFUL` continue canonical Ticket flow.
- [ ] Recommendation context and attempted session are preserved at Ticket
      handoff without equivalent user re-entry.
- [ ] Existing Ticket is not auto-closed; only canonical Helpdesk commands
      can transition it.
- [ ] Active Root Incident context prioritizes eligible guidance safely;
      Known Incident Deflection is measured separately.
- [ ] Duplicate recommendation request, feedback and resolution confirmation
      are idempotent.
- [ ] Ticket creation racing an active session produces one canonical
      handoff/reference.
- [ ] Timeline/events use references and do not expose inaccessible content.

### Contract / failure / E2E

- [ ] Required recommendation/session/item/interaction events and outbox
      behavior are verified.
- [ ] Recommendation infrastructure failure does not block Ticket intake.
- [ ] Feedback does not mutate profile weights or Knowledge publication.
- [ ] TASK-090/TASK-091 execution boundary is enforced.

## 28. Acceptance Criteria

1. Only currently published, visible, authorized and audience-compatible
   Knowledge versions can be presented.
2. Ranking uses the versioned 0..100 profile and 70 threshold; explanations
   identify each contribution; no more than three recommendations are
   returned.
3. Recommendation history is durable, tenant-scoped, idempotent and bound to
   the exact Knowledge aggregate version/profile version.
4. A click/open/helpful response never counts as successful deflection;
   explicit resolution evidence is required.
5. No recommendation, unsuccessful feedback or escalation can continue
   canonical Ticket intake with preserved context and session reference.
6. TASK-093 cannot close Ticket/Incident or invoke TASK-091.
7. Unauthorized Knowledge cannot leak through any response, event, metric,
   timeline or candidate count.
8. Required unit, integration, API, event, concurrency and E2E tests pass.

## 29. Verification Commands

Discover and run repository-defined format, lint, typecheck, unit,
integration, migration, contract and E2E checks. At minimum run:

```text
npm test
npm run typecheck
npm run lint
npm run format:check
git diff --check
```

Run applicable migration and PostgreSQL integration tests.

## 30. Codex Execution Protocol

Inspect existing TASK-037, TASK-061, TASK-092 and Helpdesk paths first.
Implement only this task contract, keep domain ownership boundaries, report
any newly discovered material dependency or spec conflict, and do not start
TASK-094 or later work.

## 31. Required Completion Report

```markdown
## Implementation Report

### Status
IMPLEMENTED / PARTIAL / BLOCKED

### Files Changed
- ...

### Database Changes
- ...

### APIs / Commands
- ...

### Events
- ...

### Permissions
- ...

### Audit / Timeline
- ...

### Tests Run
- command: result

### Remaining Gaps
- ...

### Spec Conflicts
- none / ...

### Assumptions
- none / ...
```

## 32. Scope / Conflict Rules

Do not redesign TASK-037 lifecycle, TASK-061 Search or TASK-092 correlation.
If implementation requires an unprovided decision or cross-domain expansion,
report `SPEC_CONFLICT` or `SCOPE_DEPENDENCY` before that expansion. Preserve
privacy and domain integrity over returning a recommendation.
