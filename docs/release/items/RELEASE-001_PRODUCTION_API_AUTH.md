# RELEASE-001 — Production API Authentication & Authorization Adapter

| Field          | Value                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Priority       | P0                                                                                                          |
| Status         | `NOT_STARTED`                                                                                               |
| Readiness      | `READY`                                                                                                     |
| Blocker        | None — RELEASE-001-R1 contract is complete; runtime adapter remains unimplemented.                          |
| Planning child | [RELEASE-001-R1 — Production Authentication Contract](RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md) |

## Purpose

Provide the production API with real user authentication and canonical
authorization integration while preserving fail-closed behavior. This item
does not make successful authentication equivalent to broad access. The
AuthorizationPort must continue to evaluate principal, action, resource,
scope and context, with tenant boundary checked before resource scope.

## Existing contract evidence

- `docs/API_COMMAND_CONTRACT_SPEC.md` lists OIDC access tokens, service
  account tokens, mTLS, limited API keys and signed webhooks as deployment-
  dependent methods; it **prefers** OIDC/OAuth2 for users and mTLS/workload
  identity for services.
- `docs/IDENTITY_SSO_RBAC_USER_LIFECYCLE_OFFBOARDING_WORKFLOW.md` describes
  OIDC and SAML SSO and separates authentication from authorization.
- `modules/identity/application/oidc.ts` defines claim validation for issuer,
  audience, expiry, subject, user and tenant; the verifier itself is an
  adapter port.
- `modules/identity/application/authentication.ts` says the adapter must
  verify signature, issuer, audience and expiry and map the subject to a
  canonical tenant/user. It explicitly states no adapter is installed by
  TASK-000.
- `packages/auth/src/index.ts` provides `AuthenticationPort` and
  `AuthorizationPort`; `unavailableAuthentication` and `denyAll` fail closed.
- `apps/api/src/main.ts` wires those fail-closed implementations into the
  executable API.
- Permission policy requires tenant-first scope evaluation, permission and
  scope checks, revocation-aware caching, and no implicit wildcard/admin
  authority.

## Normative contract

The production mechanism and principal-resolution decisions are now
normative in [RELEASE-001-R1](RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md)
and the Identity/API/RBAC/storage/audit standards. In summary: one configured
provider-neutral OIDC 1.0 issuer; RFC 9068 JWT access tokens only as Bearer
credentials; Authorization Code + PKCE for interactive login; exact
issuer/subject IdentityLink; explicit local tenant membership and local RBAC;
no JIT, vendor-role grants, password fallback, wildcard system identity or
default administrator. Token validation, error behavior, bootstrap,
emergency access, audit and acceptance are specified in R1.

RELEASE-001 is `READY / NOT_STARTED`. Readiness means the security contract
gap is closed and the runtime item may be started. The runtime adapter is
still absent, so the production release blocker RR-01 remains open until
RELEASE-001 runtime implementation and staging verification are complete.

## Runtime outcome (under the completed R1 contract)

The production API must use real verified identities and the existing
AuthorizationPort/canonical grant model. Invalid or unavailable identity or
authorization configuration remains denied. Production has no test adapter,
trusted client role header, default administrator, wildcard grant or
tenantless user principal. Authentication/configuration and permission
failures are audited according to existing security audit policy without
recording raw credentials.

## Verification expected after contract approval

- Valid identity produces a canonical, tenant-bound principal.
- Signature/issuer/audience/expiry, local user and tenant-membership state, and identity
  mapping are checked according to the approved mechanism.
- Missing provider configuration fails closed at the approved startup/request
  boundary.
- Unauthorized, forbidden, expired, locally revoked user/membership/permission,
  wrong-tenant and insufficient-scope cases fail with canonical sanitized
  errors. No instant JWT revocation is claimed unless a separately configured
  provider mechanism is implemented and verified.
- No user-controlled role/tenant claim or default admin path grants access.
- Audit and secret/configuration behavior meet the approved contract.
- Integration and E2E tests exercise the real adapter boundary in a
  production-like staging configuration, including negative cases.
