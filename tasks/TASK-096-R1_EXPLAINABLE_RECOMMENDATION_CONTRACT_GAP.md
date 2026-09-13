# TASK-096-R1 — Explainable Recommendation Layer Contract Gap

```yaml
task_id: TASK-096-R1
parent_task: TASK-096
feature_id: F-050
workflow_id: WF-INT01
phase: P5
priority: P0
status: BLOCKED
readiness: BLOCKED
implementation_status: NOT_STARTED
blocker: SPEC_GAP / PLANNING_REQUIRED
scope: normative_decision_register_only
```

## Result

TASK-096 is not implementable from the persisted contract. The registry
provides only the title “Explainable Recommendation Layer”, a dependency list
and a `GENERATE_ON_READY` artifact marker. No detailed TASK-096 contract or
acceptance criteria exist. The traceability matrix identifies F-050 as
“Intelligence/Recommendation” and WF-INT01, but does not define this task's
behavior.

No runtime changes are authorized by this remediation. TASK-096 remains
`BLOCKED / NOT_STARTED` with `SPEC_GAP / PLANNING_REQUIRED`; TASK-097 remains
`WAITING_DEPENDENCY / NOT_STARTED`.

## Reconciled foundations and boundaries

The declared TASK-096 dependencies are satisfied: TASK-090, TASK-092, TASK-093,
TASK-094 and TASK-095 are `CODE_COMPLETE`. Their owned capabilities are
distinct and must remain authoritative:

- TASK-090 owns policy-gated Automation rules and Action Intent behavior.
- TASK-092 owns Incident correlation decisions and Root relationships.
- TASK-093 owns Knowledge self-service recommendation sessions, its fixed
  versioned ranking profile, feedback/resolution evidence and Ticket handoff.
- TASK-094 owns immutable Asset Risk and Replacement assessments; scores are
  decision support and do not authorize lifecycle or Procurement actions.
- TASK-095 owns governed KPI/reporting reads; KPI results do not trigger
  workflow actions.

Existing recommendation-related behavior is not a generic TASK-096 contract.
TASK-093 recommendations are limited to eligible Knowledge guidance. TASK-092
correlation decisions and TASK-094 scores are domain-owned assessments. The
repository contains no persisted rule saying whether TASK-096 composes these
outputs, recommends a separate set of actions, or owns a new recommendation
record/lifecycle. None of these boundaries may be inferred from the task name.

## Normative decisions required before runtime work

The product/domain owner must resolve the following. Decisions must be
recorded in a detailed TASK-096 contract and reconciled with the normative
documents listed below.

1. **Capability and scope:** Is TASK-096 a cross-domain presentation/composition
   layer over TASK-092/093/094 decisions, a new action recommender, or both?
   Identify intended users, entry points, consuming workflows, recommendation
   categories, target entity types and explicit exclusions. Clarify whether
   TASK-093 remains the only Knowledge recommender and how duplicate or
   conflicting recommendations are handled.
2. **Meaning of a recommendation:** Define its canonical entity and whether it
   is advisory, a human review item, or an input to another workflow. Define
   the distinction among recommendation, assessment, Work Queue item, Action
   Intent, approval and executed action.
3. **Candidate evidence and authority:** Enumerate allowed canonical sources
   per recommendation category and the owning-domain query/application port
   for each. Define tenant/resource scope, source identity, deduplication,
   freshness, time windows and behavior for stale, missing, conflicting or
   unavailable evidence. Search must remain discovery-only unless a metric or
   recommendation contract explicitly establishes otherwise.
4. **Decision/ranking semantics:** For each category define deterministic
   eligibility, score/confidence scale, evidence contributions and weights,
   thresholds/bands, ordering, tie-breaking, caps, duplicate suppression and
   correlated-evidence handling. Specify whether any existing TASK-092/093/094
   score is reused verbatim or transformed. Do not invent weights or
   thresholds.
5. **Explainability and versioning:** Define required explanation fields,
   evidence references/summaries, unavailable reasons, profile/algorithm
   identity and version, immutability/history, and how a changed profile or
   source evidence affects prior recommendations.
6. **Lifecycle and human decisions:** Define recommendation states and legal
   transitions, expiry/withdrawal/supersession, acknowledgement, accept,
   reject/defer/override semantics, actor/reason requirements and whether
   feedback changes future ranking. State how human outcomes remain separate
   from computed evidence and how terminal human decisions constrain later
   recalculation.
7. **Action and automation boundary:** For each recommendation category state
   whether it can only be displayed, can create/upsert a Work Queue item, or
   may request another domain command. Explicitly define any TASK-090 Action
   Intent handoff and TASK-091 execution boundary, including policy, approval,
   authorization and verification requirements. Without an explicit contract,
   recommendations cannot execute actions, mutate domain state, create
   Procurement, alter lifecycle/assignment, or invoke TASK-091.
8. **Interfaces and events:** Define catalog/read/drill-down surfaces and any
   commands, request/response fields, validation/errors, pagination and
   visibility rules. Define emitted/consumed event names, versioned payloads,
   correlation/causation references and which domain owns each contract.
9. **Authorization and privacy:** Define human permissions by operation,
   tenant/resource/audience scope, any system principal and its exact grants,
   cross-domain reauthorization for drill-down, sensitive-data minimization
   and denial behavior. Recommendation visibility must not imply permission
   to read underlying records or execute actions.
10. **Persistence and legacy:** Decide whether recommendations are durable or
    computed live; if durable, define tenant-scoped entities, uniqueness,
    version/history, evidence-reference retention, migration and legacy
    unknown behavior. Do not backfill from free text or fabricate evidence.
11. **Triggers, idempotency and concurrency:** Define recalculation triggers,
    explicit refresh behavior, durable idempotency identity, source-generation
    binding, expected-version rules and races among duplicate workers,
    evidence changes, user decisions and downstream commands. State whether
    late/corrected evidence creates a new immutable revision or supersedes a
    current projection.
12. **Failure, audit and operations:** Define atomic boundaries, outbox/audit/
    timeline requirements, retryable versus terminal failures, partial failure
    and compensation (if any), observability/freshness, retention and recovery.
    Audit and timeline must reuse repository standards rather than a parallel
    system.
13. **Acceptance:** Specify category-by-category examples and expected
    outcomes, including authorization/tenant isolation, missing evidence,
    stale data, duplicate/conflicting recommendations, terminal human
    decisions, concurrency, replay, failure rollback, event/audit behavior
    and prohibited side effects. Identify required unit, integration, API and
    E2E coverage.

## Explicitly preserved safety constraints

Until a detailed contract says otherwise, TASK-096 must preserve the existing
domain boundaries above. A recommendation is not implicitly an approval,
Action Intent, Work Queue state, lifecycle transition, Procurement action or
TASK-091 execution. No cross-domain table access or mutation is authorized by
this planning artifact.

## Documents to reconcile when closing R1

At minimum, the detailed contract must be reflected consistently in:

- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- the applicable Knowledge, Incident, Asset, Automation and Reporting
  workflow specifications
- `docs/DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `tasks/CODEX_TASK_REGISTRY.md`

R1 may be marked complete only after the decisions above are resolved by
normative authority, conflicts are reconciled, and TASK-096 receives a
deterministic detailed implementation contract. No runtime implementation or
TASK-097 work is part of R1.
