# RELEASE-001-R1 — Production Authentication Contract

| Field                  | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| Type                   | Release planning/security contract only                                        |
| Status                 | `CODE_COMPLETE`                                                                |
| Parent                 | RELEASE-001 — Production API Authentication & Authorization Adapter            |
| Runtime implementation | Not implemented or authorized in R1                                            |
| Decision               | Provider-neutral OIDC 1.0 access-token authentication over OAuth 2.0 and HTTPS |

## 1. Purpose and scope

This document fixes the production authentication and principal-resolution
contract for RELEASE-001. It is normative for the production API adapter. It
does not implement the adapter, provision an identity provider, configure
credentials, or close the runtime release blocker. The API and Agent Gateway
remain fail-closed until their separately scoped production adapters are
implemented and verified.

The identity provider is deployment configuration, not an application vendor
dependency. One trusted OIDC issuer is configured per production deployment
for v1. A conformant provider may be used if it implements the token profile
and claims below. Authorization must not depend on vendor-specific role,
group, tenant or entitlement claims.

## 2. Protocol and accepted credentials

Production API requests authenticate only with:

```http
Authorization: Bearer <OIDC JWT access token>
```

For interoperability and unambiguous access-token identification, the v1
accepted token profile is the [OAuth 2.0 JWT Access Token Profile (RFC 9068)](https://www.rfc-editor.org/rfc/rfc9068.html).
The resource server requires the access-token type (`at+jwt` or
`application/at+jwt`) and the profile's required claims: `iss`, `sub`, `aud`,
`exp`, `iat`, `jti`, and `client_id`; `nbf`, when present, is validated.
Opaque tokens are
not supported by this v1 adapter; adding introspection requires another
security contract.

The API accepts access tokens only. It rejects ID tokens, refresh tokens,
authorization codes, unsigned JWTs, arbitrary platform session identifiers,
and identity data from untrusted headers. JWT decoding alone is never
authentication. No independent username/password authentication is added.

Interactive user login uses OpenID Connect Authorization Code flow with
PKCE. Implicit Flow is prohibited. Browser applications do not contain client
secrets. A server-side BFF may keep tokens server-side; regardless of browser
session arrangement, every API principal must derive from a successfully
validated OIDC access token. If a UI uses cookies, cookie attributes and CSRF
controls remain the UI/BFF's responsibility; RELEASE-001 does not disable
them.

Machine clients may use OAuth 2.0 Client Credentials with the same trusted
issuer where supported. A valid service token proves an external identity
only. It must resolve through an explicit local external-service identity
mapping to a tenant-scoped `SystemPrincipal`; no token claim creates a system
principal or permissions. Existing principals such as `SYSTEM_AUTOMATION`,
`SYSTEM_ASSET_SCORING`, Reporting and Recommendation remain governed by their
own scoped permission contracts.

## 3. Trusted issuer and cryptographic validation

The issuer and API audience are explicit operator configuration. Discovery
and JWKS are fetched only from the configured HTTPS issuer's trusted metadata.
A token cannot select its own issuer or JWKS URL. The validated `iss` value
must exactly equal the configured issuer identifier. Production has no
wildcard or omitted audience; the configured API audience must be present in
`aud`.

For every request, the adapter validates at least:

- signature against a trusted JWKS key selected by `kid`;
- the v1 signing algorithm `RS256` only, with key/algorithm binding;
- exact issuer and configured API audience;
- `exp` and `nbf` where present, plus required RFC 9068 access-token profile
  claims and token type;
- access-token usage, rejecting ID tokens and token-type confusion;
- trusted key provenance and key validity.

Reject `alg=none`, any algorithm other than `RS256`, invalid signature, wrong issuer or
audience, expired or not-yet-valid token, malformed required claims, and
unknown/untrusted key. Use provider-neutral profile validation; do not add
vendor-specific token behavior. Follow [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html)
for algorithm verification and JWT-type separation.

JWKS keys may be cached under bounded secure library behavior. A previously
unknown `kid` may trigger one bounded refresh from the configured issuer's
JWKS endpoint. If validation still fails, reject the token. If issuer/JWKS
infrastructure is unavailable and no valid cached verification key can
validate the token, fail closed with sanitized dependency-unavailable
semantics; never accept an unverifiable token or fall back to anonymous
access.

### Time tolerance and token lifetime

The production validator's default clock tolerance is **30 seconds**, with a
hard configuration ceiling of **60 seconds**. The adapter must configure this
explicitly rather than inherit an undocumented library default. The small
leeway accounts for ordinary clock drift; production hosts must use reliable
time synchronization. This is the repository's v1 policy bound, consistent
with the small-leeway guidance in RFC 9068; it is not a claim that RFC 9068
sets a numeric default.

Production access-token issuance should have a **recommended maximum lifetime
of 10 minutes**. The IdP owns issuance and renewal. The API never accepts a
refresh token and RELEASE-001 does not build a refresh-token issuer. This
maximum is a deployment recommendation, not an application-side lifetime
claim. Short token lifetime does not replace local status, tenant-membership
or permission checks.

## 4. Canonical human identity and tenant authority

The immutable external human identity key is the exact pair:

```text
validated issuer + OIDC subject (sub)
```

Email, username and display name are mutable attributes and must never be used
as immutable account-link keys. `IdentityLink` is the canonical mapping
(adapting `identity.external_identities` only where its issuer identity is
deterministic):

```text
IdentityLink:
  id
  issuer
  subject
  principal_type: HUMAN | SERVICE
  status
  provenance
  created_at
  created_by
  verified_at
  updated_at
```

Enforce one canonical external identity for `(issuer, subject, principal_type)`
in the deployment trust scope. Tenant-local User binding is performed through
TenantMembership as refined by R2; IdentityLink itself is not a tenant-local
User record. Do not guess a link for a legacy row from `provider_id`, email,
username or display name unless a separately verified deterministic issuer
mapping exists. Otherwise the identity remains unprovisioned until explicitly
linked.

A valid external identity is not, by itself, platform access. A valid token
without an active `IdentityLink` and provisioned local user is denied with
HTTP 403 and stable code `IDENTITY_NOT_PROVISIONED`. RELEASE-001 v1 disables
JIT account creation for API access. The general Identity workflow's optional
JIT path may only be enabled by a separate governed provisioning contract;
it cannot override this API rule.

The platform owns tenant membership. R1 left the concrete request selector
and tenant-local membership binding shape to the focused R2 contract; see
[RELEASE-001-R2 — Explicit Tenant Context & Membership Foundation](RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md).
For the API v1 runtime, that contract fixes `X-Tenant-ID` as the only
required selector and binds the external IdentityLink through an ACTIVE
membership to the tenant-local User. The request pipeline resolves:

```text
validated external identity
→ canonical local user
→ requested tenant from exactly one `X-Tenant-ID`
→ active local TenantMembership bound to a tenant-local User
→ local effective permissions
→ resource authorization
```

An IdP `tenant_id`, organization or group claim is not proof of platform
membership. A tenant claim may be auxiliary provisioning input only under a
future explicit mapping contract. Multi-tenant users must select the requested
tenant through `X-Tenant-ID`; the
middleware must not silently choose one. Each request principal is bound to
exactly that tenant. Membership in one tenant gives no access to another.

The canonical request principal contains only the needed authenticated
context: principal type, local user or system-principal ID, bound tenant,
validated issuer and subject/reference, authentication method, request and
correlation context, and locally derived effective-permission context where
available. Effective permissions are computed from local canonical state for
the current request/action; they are never copied from token role claims or
treated as indefinitely valid. Downstream domains consume this canonical
principal and do not parse raw OIDC tokens.

## 5. User state, authorization and revocation

Authentication and authorization remain separate. Canonical authorization
uses platform RBAC, active TenantMembership, role assignments, permission
policy, tenant and resource scope. OIDC role/group claims are metadata only;
they do not grant permissions. Existing versioned group-to-role provisioning
continues only through its separately governed mapping/synchronization
workflow and never by blind per-request claim translation.

Every authenticated human request checks canonical local user status. At
minimum, `SUSPENDED`, `TERMINATED`, `ARCHIVED`, and `TERMINATING` where the
existing lifecycle policy denies access are denied. `PRE_HIRE`, `LEAVE` and
other states follow the canonical user-lifecycle policy; any onboarding
exception must be an explicitly authorized onboarding route, not generic API
access.

Every tenant request requires an active local `TenantMembership`. Effective
permissions are resolved from local role bindings and canonical policy.
Membership removal, role removal, scope change, user suspension/termination
and permission-policy change take effect independently of still-valid token
claims. Authorization caches, if used, require explicit version/invalidation
semantics and may not preserve stale grants indefinitely.

For self-contained signed access tokens, the platform does not claim that
OIDC logout immediately revokes every issued JWT. The contract relies on
cryptographic expiry, the short issuance lifetime recommendation, and local
user, membership and permission checks. Provider-specific introspection may
be added only under an explicit compatible deployment contract.

## 6. Machine identity, bootstrap and emergency access

External machine identity is explicitly registered:

```text
ExternalServiceIdentity(issuer, client_id)
→ one canonical tenant-scoped SystemPrincipal
```

The mapping is durable, uniquely constrained, active/revocable and audited.
The client-credentials access token must satisfy the configured RFC 9068
profile; its validated `client_id` is the external mapping key and is kept in
the service-principal namespace, distinct from human `(issuer, sub)` links.
It cannot grant permissions by itself; existing local grants determine
capability and resource scope. Human and service principal namespaces remain
distinct. Unregistered clients are denied. No wildcard or tenantless service
identity is allowed.

There is no permanent local username/password administrator. Initial
administrative bootstrap binds an explicitly known OIDC issuer/subject to an
existing local user and explicitly named tenant/admin role through a trusted
control-plane operation, never a public unauthenticated endpoint. It is
allowed only when (a) no active local human user currently has the canonical
`rbac.manage` permission in any active tenant and (b) a durable singleton
initial-administrator bootstrap marker has never been committed. The trusted
control-plane operation checks both conditions under a serialized database
transaction, validates the target user/tenant/role and issuer/subject, creates
the IdentityLink and local grant, writes audit evidence and the marker
atomically. Concurrent bootstrap attempts cannot create a second initial
administrator. Once committed, the marker permanently prevents bootstrap
replay, even if that administrator is later suspended or removed. Repeated or
unauthorized bootstrap is rejected. A tenant-scoped admin grant does not
imply cross-tenant support access.

RELEASE-001 v1 does not add local-password break-glass. Emergency access uses
a pre-provisioned external OIDC identity with strong IdP-side MFA, an explicit
local emergency mapping/role, narrow scope and short validity as governed by
the existing privilege policy. Use is separately auditable and subject to
security review. An IdP outage is not permission to enable a local-password
fallback. IdP-independent emergency login requires a separate threat-reviewed
contract.

## 7. Identity-link lifecycle and persistence

External link/unlink/change operations are explicit authorized Identity
commands equivalent to `IDENTITY.LINK_EXTERNAL` and
`IDENTITY.UNLINK_EXTERNAL`. Link input includes local user, configured issuer,
subject, tenant/administrative context where required, reason, actor,
correlation and idempotency key. Enforce active local user, uniqueness,
tenant and administrative authorization, expected version/concurrency,
durable idempotency, and audit. Same key/same semantic request replays the
prior outcome; same key/different request conflicts. Ordinary users may not
link an identity to another user. Changing from subject A to B is an explicit
audited unlink/link or governed replacement operation; an email change never
rebinds the subject.

Identity-link records, active tenant memberships, external service mappings,
role bindings and audit references live in canonical Identity relational
storage. External token contents, refresh tokens, authorization codes, client
secrets and private keys are never persisted in IdentityLink or logs. Legacy
identities without deterministic issuer provenance remain unlinked rather
than receiving fabricated links.

## 8. HTTP behavior, public routes and startup

Authentication is deny-by-default. Every API route is protected unless it is
explicitly listed in a server-owned unauthenticated endpoint allow-list. The
allow-list may contain liveness, readiness, and applicable OIDC login/callback
routes only. A route is never public because middleware was accidentally
omitted. Health responses expose no secrets, user or tenant details; edge
exposure is finalized by RELEASE-007.

Stable external semantics:

| HTTP | Meaning                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401  | Missing/malformed bearer token, invalid access-token type, signature, issuer, audience, expiry or not-before; untrusted/unknown signing key           |
| 403  | Valid external identity but unprovisioned link, inactive local user, missing/inactive tenant membership, missing local permission, or resource denial |
| 503  | Authentication dependency/JWKS unavailable and no valid cached key can complete verification                                                          |

Return sanitized canonical error codes such as `AUTHENTICATION_REQUIRED`,
`IDENTITY_NOT_PROVISIONED`, `PERMISSION_DENIED` and
`DEPENDENCY_UNAVAILABLE`. Unauthenticated clients receive no detail about
whether another tenant has a matching user, identity or resource.

In production, required OIDC configuration is explicit and equivalent to:

```text
AUTH_MODE=oidc
OIDC_ISSUER=<one trusted HTTPS issuer>
OIDC_AUDIENCE=<explicit API audience>
```

Required discovery/JWKS and clock settings are validated from that trust
configuration. Missing or invalid issuer/audience/trust configuration fails
startup before serving protected application traffic; at minimum readiness
must stay false and every protected request denied. Production may not set
`AUTH_MODE=disabled`, use a test/mock/bypass adapter, or fall back to
anonymous/local-password auth. Valid production configuration is required
before the auth component reports ready. Release-003 owns aggregate worker
readiness; RELEASE-007 owns edge/TLS exposure.

## 9. Logging, audit and observability

Authentication diagnostics may include request/correlation ID, safe local
principal/tenant references after resolution, configured issuer identifier
and reason code. Never log access/refresh tokens, authorization codes, client
secrets, private keys or a complete token claim set. Use bounded-cardinality
metrics for successful/failed validation categories, invalid issuer/audience,
expiry, unknown local identity, tenant membership rejection, permission
denial, JWKS refresh/failure and auth-component readiness; do not label by
email or raw subject.

Use existing AuditPort/security event standards for identity link/unlink,
bootstrap success/failure, emergency identity use and privileged mapping
changes. Do not create an independent audit system or emit excessive
per-request compliance records where existing policy does not require them.

## 10. Acceptance requirements for RELEASE-001 implementation

Dedicated tests and staging verification must prove:

- valid RFC 9068-signed access token accepted; missing/malformed token, ID
  token, refresh token, code, unsigned JWT, invalid signature, wrong
  issuer/audience, expired/not-yet-valid token and disallowed algorithm
  rejected; RS256 and all required profile claims are explicitly exercised;
- trusted configured issuer/JWKS only, unknown `kid` gets bounded refresh,
  rotation succeeds, and unresolved key/JWKS failure fails closed;
- configured 30-second clock default and 60-second ceiling are enforced;
- valid identity with active IdentityLink/user and active tenant membership
  proceeds; unlinked identity returns 403 `IDENTITY_NOT_PROVISIONED`;
- suspended/terminated/archived and policy-denied terminating user are
  denied; email/display-name change cannot transfer identity and another
  subject with the same email cannot inherit the link; duplicate
  `(issuer, subject)` mapping is rejected;
- explicit tenant selection and active membership are required; arbitrary
  token tenant/group claims cannot authorize access; multiple memberships do
  not cause implicit tenant selection;
- local permission grant/removal governs access; IdP roles alone grant
  nothing; resource-level authorization remains in owning domains;
- registered service identity maps to a scoped system principal; unregistered
  client, human/service confusion and wildcard grants are rejected;
- production startup rejects missing issuer/audience, invalid trust config,
  mock/bypass auth and disabled auth; valid config is required for auth
  readiness; no anonymous fallback exists;
- bootstrap is trusted-control-plane-only, tenant-scoped, audited and
  one-time under its contract; unauthorized repeat is rejected; there is no
  default password;
- emergency OIDC identity is distinguishable and audited; IdP outage does
  not enable local-password fallback;
- authentication errors do not disclose sensitive reason details and logs
  never contain token, authorization code, refresh token or client secret;
- OIDC Authorization Code + PKCE is supported for interactive client login;
  implicit flow is rejected/not configured; service and human identities
  remain distinct;
- failures do not construct anonymous/default-tenant/default-admin
  principals, and no business handler runs before authentication and
  authorization gates.

## 11. Deliberate exclusions

RELEASE-001 v1 does not implement a provider-specific IdP, local password
login, JIT account creation, direct IdP role/group-to-permission mapping,
opaque-token introspection, refresh-token issuance, automatic identity
matching by email/name, local-password break-glass, or TLS ingress/rate
limiting (RELEASE-007). Any such capability requires a separate approved
contract or an existing owning Identity workflow; it cannot be silently
added to the adapter.
