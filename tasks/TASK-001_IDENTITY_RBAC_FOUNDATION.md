# TASK-001 — Identity + RBAC Foundation

```yaml
task_id: TASK-001
feature_id: F-001/F-002
workflow_id: WF-ID01/WF-ID02
phase: P0
priority: P0
status: CODE_COMPLETE
owner_domain: Identity/RBAC
```

## Objective

Implement the identity data foundation and backend RBAC evaluator required by the Identity and Authorization workflows. Authentication protocol/session lifecycle remains TASK-002.

## Required Specifications

- AGENTS.md
- MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md
- IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md
- DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md
- PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md
- API_COMMAND_CONTRACT_SPEC.md
- ERROR_RETRY_IDEMPOTENCY_STANDARD.md
- AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md

## In Scope

- Role, permission, role-permission and scoped role-binding persistence.
- Temporary grant persistence with expiry.
- Explainable allow/deny evaluation with explicit-deny precedence, scope matching and tenant isolation.
- `POST /api/v1/authorization/evaluate` and batch evaluation.
- Permission catalog registration and audit port integration for future role commands.
- Unit, repository, API and tenant/scope tests.

## Out of Scope

OIDC/SAML exchange, sessions, user sync, JML/offboarding, privileged grant commands, approval workflow, and all business domains.

## Current Repository Context

TASK-000 created Identity tables except temporary grants, auth/authorization ports, deny-by-default wiring, migrations, API health and PostgreSQL test infrastructure. No user-facing identity or RBAC implementation is active.

## Domain Rules

- Tenant is checked before resource scope.
- A permission requires an active role binding, active role-permission link and matching resource scope.
- Explicit deny overrides grants; multiple grants union.
- Expired bindings/grants do not authorize.
- Authorization returns an explainable reason without leaking sensitive role data to ordinary callers.

## State Transition

None. Role bindings are protected writes reserved for the explicit commands in a later slice; this task only evaluates existing records.

## Preconditions

Authenticated principal, action, resource type/id and tenant context are required. Unauthenticated requests fail closed.

## Authorization

```yaml
permission: role.read / role.manage / role_binding.grant / role_binding.revoke
resource: role or role_binding
scope: tenant plus declared binding scope
high_risk: role_binding.privileged_grant only (deferred)
```

## Database / Data Model

Add `identity.temporary_grants`; preserve existing tenant-scoped Identity tables and indexes. No cross-domain writes.

## API

`POST /api/v1/authorization/evaluate` and `POST /api/v1/authorization/evaluate-batch`; both require a verified principal and backend evaluation.

## Command / Events

No protected grant command or event is implemented in this foundation slice. `RBAC.GRANT_ROLE`, `RBAC.REVOKE_ROLE`, and binding events remain next work.

## Idempotency / Concurrency

No retryable write is introduced. Evaluation is read-only and uses a transaction snapshot; binding writes later require TASK-000 idempotency and expected-version controls.

## Audit / Timeline / Notifications / Projections

No timeline, notification or search projection. Privileged decision logging uses the existing AuditPort when command implementation begins.

## Error Codes

`AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.

## Required Tests

- Unit: scope union, expiry, explicit deny, explainability.
- Repository: tenant isolation and temporary-grant expiry.
- API: authenticated evaluation, deny-by-default, malformed requests and batch limits.
- Contract: OpenAPI request/response schema.

## Acceptance Criteria

1. Valid active grant allows a matching resource scope.
2. Wrong tenant or scope denies.
3. Explicit deny overrides grants.
4. Expired bindings/grants deny.
5. Evaluation explains the matched role, permission and scope to an authorized operator.
6. API never trusts client role claims and returns canonical errors.
7. All applicable tests pass without implementing TASK-002 or business workflows.

## Verification Commands

`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:contract`, `npm run test:migration`, `npm run test:integration`, `npm run test:e2e`, `npm run build`.

## Completion Condition

Set `CODE_COMPLETE` only when all acceptance criteria pass and the registry/current-task/handoff documents are updated.
