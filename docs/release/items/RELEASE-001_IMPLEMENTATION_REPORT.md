# RELEASE-001 — Production API Authentication & Authorization Adapter

| Field        | Value                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status       | `CODE_COMPLETE`                                                                                                                                                                                  |
| Verification | Automated repository checks passed; real IdP/staging validation remains open, so this item is not `VERIFIED`.                                                                                    |
| Contracts    | [R1 Production Authentication](RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md); [R2 Explicit Tenant Context & Membership](RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md) |

## Architecture

The API authentication boundary is implemented by
`OidcApiAuthentication` in `modules/identity/infrastructure/oidc-authentication.ts`.
It uses `jose` 6.2.12 for JWT signature verification and remote JWKS handling;
no cryptographic verification is hand-written. Production startup in
`apps/api/src/main.ts` requires the `oidc` auth mode, initializes trusted OIDC
discovery/JWKS before listening, wires the PostgreSQL AuthorizationPort, and
fails startup if the trust initialization fails. Production configuration
requires `AUTH_MODE=oidc`, `OIDC_ISSUER`, and `OIDC_AUDIENCE`; development/test
can retain the explicitly injected adapter. There is no automatic mock,
disabled, anonymous, or default-principal fallback.

The verifier requires RFC 9068 access-token type, RS256, exact configured
issuer, configured audience, trusted JWKS signing key, and required registered
claims. It validates expiry, not-before, and issued-at with a 30-second clock
tolerance. JWKS is fetched only through discovery from the operator-configured
HTTPS issuer; remote caching and bounded refresh support rotation. Invalid
credentials return safe authentication errors; unavailable trust material
without a usable cached key fails closed. Logs contain bounded event names,
not tokens, claims, email, subject, or tenant labels.

`packages/auth` now supports a tenant-bound request context and optional
authentication readiness. `apps/api/src/server.ts` authenticates all
`/api/v1/*` routes before handler dispatch when the production adapter is
active, using the raw request headers to reject missing, malformed, or
duplicate `X-Tenant-ID`. Public liveness and readiness routes remain explicit;
the capabilities route is protected by local `operation.read`. Existing
resource-specific authorization stays in its owning routes.

## Identity, tenant context, and authorization

Migration
`database/migrations/identity/20260927_001_release001_identity_memberships.sql`
adds `identity.identity_links`, `identity.tenant_memberships`, and the
one-time `identity.initial_admin_bootstrap` marker. Human links are unique by
trusted issuer and exact subject; service links use a separate issuer/client
identity namespace. No legacy user or `external_identities` rows are
automatically linked. There is no email, username, display-name, or token-role
mapping. IdentityLink records have constrained `STANDARD` / `EMERGENCY`
classification; emergency classification is limited to human identities.

The request binding is:

```text
validated issuer + sub
→ IdentityLink
→ required X-Tenant-ID
→ ACTIVE TenantMembership
→ tenant-local User or explicitly registered SystemPrincipal
→ current User state and local RBAC/resource authorization
→ tenant-bound AuthPrincipal
```

The selector never grants access. A user with multiple memberships resolves
the local User for the selected tenant; there is no single-tenant or token
claim fallback. User and membership state are queried on each request. RBAC
uses the existing `evaluateAuthorization` path through
`apps/api/src/postgres-authorization.ts`; IdP roles/groups are not local
permissions. System principals retain their local tenant scope and grants,
including the narrow Reporting capabilities.

## Governed provisioning and bootstrap

Protected Identity operations provide:

- `POST /api/v1/identity/links` — `IDENTITY.LINK_EXTERNAL`;
- `POST /api/v1/identity/tenant-memberships` — `IDENTITY.GRANT_TENANT_MEMBERSHIP`;
- `POST /api/v1/identity/tenant-memberships/{id}/revoke` —
  `IDENTITY.REVOKE_TENANT_MEMBERSHIP`;
- `POST /api/v1/identity/links/{id}/revoke` — `IDENTITY.UNLINK_EXTERNAL`.

They require narrow local permissions, explicit tenant context, reason,
durable idempotency and database uniqueness/version checks, with audit in the
same transaction. A global identity link is not revoked while another tenant
still has an active membership; operators must revoke those memberships
through their owning tenant contexts before the final link revocation. Safe
external errors do not disclose another tenant's membership.

Emergency identity linking requires the additional
`identity.emergency_identity.manage` permission and an explicit human identity
classification. Emergency authentication requires verified `amr` to include
`mfa`; each successful emergency authentication appends a restricted
`IDENTITY.EMERGENCY_IDENTITY_USED` audit record, and authentication fails
closed if that audit cannot commit. The IdP remains responsible for enforcing
strong MFA. No local-password or IdP-independent break-glass path is added.

`bootstrapInitialAdministrator` is a trusted Identity infrastructure
operation with no HTTP route or default password. It serializes with a
database advisory lock, checks the permanent singleton marker and active
administrator precondition, validates the local user/tenant/admin grant, and
atomically persists the IdentityLink, membership, role binding, marker, and
audit record.

## Readiness, audit, and exclusions

Authentication readiness is exposed through `AuthenticationPort.isReady()`;
API readiness combines it with the existing database readiness. OIDC trust is
initialized before serving, and readiness also verifies required Identity
storage. RELEASE-003 aggregate worker readiness and RELEASE-007 TLS ingress,
rate limiting, and edge CORS remain out of scope.

The runtime does not implement browser/BFF login or OIDC token issuance,
provider-specific IdP configuration, JIT provisioning, IdP group-to-role
synchronization, token introspection, local-password authentication, or a
break-glass password path. Existing legacy identities without deterministic
issuer provenance remain unprovisioned. No Identity business event/outbox
contract was added; security mutations use the canonical audit and shared
idempotency stores. Real production secret injection, provider enforcement,
credential lifecycle, and staging validation are not claimed by automated
tests.

## Acceptance tests and verification

Dedicated RELEASE-001 coverage is mapped as follows:

| Acceptance area                                                                                                                                                                                                                                    | Test files                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| RS256/RFC 9068 validation, issuer/audience, expiry/nbf, token type, key rotation, unknown key, provider failure, auth config, selector grammar, persistence/RBAC failure closed                                                                    | `tests/unit/release001-auth.test.ts`                                  |
| Protected-by-default API, auth-before-tenant error precedence, missing/malformed/duplicate tenant header, protected capabilities, public health allow-list                                                                                         | `tests/e2e/release001-auth-boundary.test.ts`                          |
| Identity uniqueness, no heuristic legacy linking, multi-tenant User binding, membership revocation, service mapping, local RBAC changes, emergency MFA/audit, governed link/grant/revoke/unlink, cross-tenant unlink denial, atomic bootstrap race | `tests/integration/release001-identity-membership.test.ts`            |
| Fresh database, migration replay/checksum and schema invariants                                                                                                                                                                                    | `tests/migration/migrations.test.ts`                                  |
| Existing readiness and resource-authorization compatibility                                                                                                                                                                                        | `tests/e2e/http.test.ts`, `tests/e2e/task076-cost-provenance.test.ts` |

Final uninterrupted `npm test` passed **208/208**: unit/architecture **80**,
contract **2**, migration **6**, PostgreSQL integration **59**, and E2E
**61**. Also passed `npm run typecheck`, `npm run lint`,
`npm run format:check`, `npm run test:migration`, PostgreSQL-backed RELEASE-001
integration/E2E coverage, and `git diff --check`.

The full suite still emits the pre-existing PostgreSQL client deprecation
warning about calling `client.query()` while another query is running; it did
not fail the suite and remains TECH_DEBT outside this release item.
