# TASK-003 — Authorization Scopes + Privileged Access

```yaml
task_id: TASK-003
feature_id: F-002
workflow_id: WF-ID02
phase: P0
priority: P0
status: CODE_COMPLETE
owner_domain: Identity
```

## Objective

Implement tenant and resource-scope authorization evaluation plus temporary
privilege grants. Authentication is established by TASK-002; this task owns
authorization policy decisions and privileged access controls.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`
- `docs/IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`

## In Scope

- Tenant-first authorization and declared resource scope evaluation.
- Active role binding and permission evaluation with explicit deny precedence.
- Temporary grants with bounded validity, reason and audit/outbox effects.
- `authorization.evaluate` API decision responses.
- `PRIVILEGE.GRANT_TEMPORARY` and `PRIVILEGE.REVOKE_TEMPORARY` commands.
- Idempotency, expected version/concurrency, authorization and tests.

## Out of Scope

- New business-domain permissions or workflows.
- Approval engine, MFA provider and privileged session recording.
- User lifecycle/offboarding changes.

## Acceptance Criteria

1. Tenant mismatch denies before resource-scope evaluation.
2. Only active bindings and permissions are considered.
3. Explicit deny wins over allow.
4. Scope decisions are explainable and do not trust client role claims.
5. Temporary grants require reason, expiry and authorization; high-risk grants
   are audited and outbox-backed atomically.
6. Grant/revoke retries are idempotent and version conflicts return 409.
7. Unit, integration, contract, E2E, format, lint, typecheck and build gates
   pass without starting a later task.
