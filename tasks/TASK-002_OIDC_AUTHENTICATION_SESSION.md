# TASK-002 — OIDC Authentication + Session Lifecycle

```yaml
task_id: TASK-002
feature_id: F-001
workflow_id: WF-ID01
phase: P0
priority: P0
status: CODE_COMPLETE
owner_domain: Identity
```

## Objective

Implement the OIDC authentication boundary, verified principal resolution and session lifecycle foundation. RBAC policy changes remain TASK-003.

## Required Specifications

- AGENTS.md
- MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md
- IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md
- DATA_MODEL_ENTITY_RELATIONSHIP_SPEC.md
- API_COMMAND_CONTRACT_SPEC.md
- EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md
- ERROR_RETRY_IDEMPOTENCY_STANDARD.md
- AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md

## In Scope

- `identity.sessions` persistence with idle/absolute expiry and revocation.
- OIDC verifier port requiring issuer, audience, signature, expiry, subject and tenant mapping.
- Authenticated `/api/v1/me` session response and `AUTH.REVOKE_SESSION` command/API.
- Tenant/user-status checks before session creation/use.
- Audit port hook for login success/failure and revocation.
- Unit, migration, API and failure tests.

## Out of Scope

OIDC provider discovery/token exchange UI, custom passwords, SAML, directory sync, JML/offboarding, RBAC policy changes, privileged access and business domains.

## State Transition

Session: `ACTIVE → REVOKED | EXPIRED`; no generic status setter. User lifecycle is read-only in this task; only ACTIVE users may authenticate.

## Authorization

Authentication establishes identity. Session revocation requires `session.revoke` and backend authorization; no client role claims are trusted.

## Database / Data Model

Add `identity.sessions` with user/tenant, authentication method, timestamps, expiry, revoked state, risk/device metadata and version. Index active sessions by tenant/user and expiry. No secrets or raw tokens are stored.

## API / Command

- `GET /api/v1/me` requires a verified bearer token and returns the canonical principal/session context.
- `POST /api/v1/auth/logout` receives a session identifier and dispatches `AUTH.REVOKE_SESSION` with `Idempotency-Key`.

## Events

`AUTH.LOGIN_SUCCESS`, `AUTH.LOGIN_FAILED`, `AUTH.SESSION_REVOKED` are emitted only after the local transaction through the existing outbox writer. Consumers: none.

## Idempotency / Concurrency

Logout uses scoped idempotency and expected session version. Session use locks/validates the authoritative row; revoked or expired sessions cannot authenticate.

## Audit / Timeline

Audit login success/failure, session revocation, actor, subject, reason, correlation and outcome. No timeline projection.

## Errors

`AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`, `VALIDATION_ERROR`, `NOT_FOUND`, `VERSION_CONFLICT`, `IDEMPOTENCY_KEY_CONFLICT`, `INTERNAL_ERROR`.

## Acceptance Criteria

1. Invalid signature/issuer/audience/expiry/subject/tenant is rejected.
2. Only an ACTIVE canonical user can obtain a session.
3. `/me` never trusts unverified role claims or raw client identity.
4. Logout revokes a session idempotently and cannot revoke another tenant's session.
5. Expired/revoked sessions are denied.
6. Login failure and session revocation are auditable; events are outbox-backed after commit.
7. All applicable tests pass without starting TASK-003.

## Verification Commands

`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:contract`, `npm run test:migration`, `npm run test:integration`, `npm run test:e2e`, `npm run build`.

## Completion Condition

Set `CODE_COMPLETE` only after every acceptance criterion passes and current-task, handoff and registry are synchronized.
