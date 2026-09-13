# TASK-093-R1 — Knowledge Deflection + Self-Service Recommendation Contract

```yaml
task_id: TASK-093-R1
parent_task: TASK-093
work_type: NORMATIVE_SPEC_REMEDIATION
runtime_implementation: OUT_OF_SCOPE
status: BLOCKED
blocker: SPEC_GAP / PLANNING_REQUIRED
```

## Planning reconciliation

TASK-093 remains `NOT_STARTED / BLOCKED`. Its dependencies TASK-037,
TASK-061 and TASK-092 are all `SATISFIED / CODE_COMPLETE` in the current
registry. Dependency readiness does not remove TASK-093's explicit planning
blocker: the detailed normative TASK-093-R1 contract is not available in the
repository, reachable Git history or current conversation context.

The existing source material establishes only the following baseline:

- TASK-037 owns Knowledge article draft/review/publish foundation and
  explicitly leaves Knowledge recommendations out of scope.
- `PROBLEM_CHANGE_KNOWLEDGE_WORKFLOW.md` lists article types, audiences,
  quality requirements, qualitative usage feedback, and the optional
  self-service flow. It says users must not be forced to consume an article.
- `SEARCH_INDEXING_SPEC.md` lists Knowledge search fields and qualitative
  ranking factors (symptom relevance, service context, article quality and
  freshness).
- The permission catalog includes `knowledge.read`, `knowledge.draft` and
  `knowledge.publish_candidate`. The workflow lists Knowledge lifecycle event
  names, but the central Event Catalog does not define their payload
  contracts.
- The data model and API command specifications do not define a canonical
  Knowledge recommendation, article-use, feedback or attempted-article
  reference contract. TASK-037's implementation currently exposes a basic
  draft/review/publish/archive record and generic transition helper.
- TASK-061 provides the governed search foundation and TASK-092 provides
  explainable Incident correlation context.

These sources do not constitute the referenced agreed TASK-093-R1 contract.
No runtime code has been changed.

## Unresolved normative gaps

The contract cannot be marked implementation-ready without resolving or
providing the intended rules for:

1. **Scope boundary:** whether TASK-093 consumes existing Knowledge article
   lifecycle only, or also changes article lifecycle/publishing. TASK-037
   claims the lifecycle foundation, while its persistence states are
   `DRAFT / IN_REVIEW / PUBLISHED / ARCHIVED`; the workflow separately lists
   `DRAFT / REVIEW / APPROVED / PUBLISHED / REVIEW_DUE` and subsequent update
   or retirement paths.
2. **Recommendation behavior:** candidate eligibility, exact ranking/tie
   behavior, result limits, explanations, and behavior when no relevant
   article is found. Current Search rules are qualitative and do not settle
   these API-level outcomes.
3. **Self-service action boundary:** whether TASK-093 only recommends
   Knowledge and other safe actions, or may initiate any action. The existing
   sources do not define the action catalog, authorization, approval,
   confirmation or execution owner for such actions.
4. **Audience and tenant/resource visibility:** how `PUBLIC_END_USER`,
   `AUTHENTICATED_USER`, and internal audiences map to principal/resource
   scopes in the recommendation query, including whether unauthenticated
   public access is supported.
5. **Deflection and feedback facts:** what constitutes a suggestion, use,
   helpful/unhelpful result and a deflected request; required durable records,
   idempotency and metric definitions are not specified.
6. **Ticket handoff:** the workflow says an attempted article is attached
   when a Ticket is created, but the canonical reference model, event/API
   contract and authorization behavior are not defined.

No thresholds, weights, result counts, metrics formulas, action execution
rules, or new state transitions have been inferred here.

## Required next input

Provide or identify the previously agreed TASK-093-R1 normative contract. Once
available, reconcile it against the Knowledge workflow, Search specification,
TASK-037 article lifecycle, TASK-061 search contract, TASK-092 correlation
evidence, permissions, data model, API, events, idempotency, audit and
traceability documents. Then update the normative documents and task registry
before marking TASK-093 `READY / NOT_STARTED`.

Until those normative gaps are resolved, TASK-093 remains blocked and no
runtime implementation may begin.
