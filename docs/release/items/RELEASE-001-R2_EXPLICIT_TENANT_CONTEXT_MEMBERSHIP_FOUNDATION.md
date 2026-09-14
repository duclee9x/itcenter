# RELEASE-001-R2 — Explicit Tenant Context & Membership Foundation

| Field                  | Value                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Type                   | Release planning/security contract only                                                                                           |
| Status                 | `CODE_COMPLETE`                                                                                                                   |
| Parent                 | RELEASE-001 — Production API Authentication & Authorization Adapter                                                               |
| Runtime implementation | Not implemented or authorized in R2                                                                                               |
| Depends on             | RELEASE-001-R1 (`CODE_COMPLETE`)                                                                                                  |
| Decision               | Tenant-scoped API v1 requests select exactly one tenant with `X-Tenant-ID`; local active membership and RBAC remain authoritative |

## 1. Purpose and scope

R2 closes the tenant-context and tenant-local membership model needed by the
RELEASE-001 runtime. It is normative with the R1 production OIDC contract and
does not implement OIDC, middleware, schema migrations, or any runtime
behavior. It does not change product TASK roadmap state or start RELEASE-002.
If R1 and R2 differ on how a tenant is selected or how an external identity is
bound to a tenant-local User, this R2 contract is authoritative.

The existing `identity.users` model is tenant-scoped. R2 does not convert it
to a global-user model or merge users across tenants.

## 2. Canonical tenant selector

The sole tenant selector for tenant-scoped API v1 requests is:

```http
X-Tenant-ID: <canonical-tenant-id>
```

It is a client-requested context only. It is not a credential, proof of
membership, authorization grant, role source, or permission source. A valid
OIDC access token plus this header still requires a canonical external
IdentityLink, an ACTIVE TenantMembership for the selected tenant, an active
tenant-local User, local RBAC, and resource authorization.

The header preserves current URL shapes and makes multi-tenant selection
explicit without trusting token claims. For v1, no second path, query,
cookie, default-tenant, or token-claim selector is allowed. There is no
precedence chain between selectors. Every protected tenant-scoped request
requires the header even if the user has one membership or a default tenant.
The API must not infer or silently choose a tenant.

Tenant identifiers are parsed as one canonical opaque value. The v1 accepted
wire grammar is ASCII `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; comparison is exact
and case-sensitive and the application performs no trimming, case folding,
or other normalization. Missing, empty, whitespace-only, malformed, or
repeated header values are rejected. Any duplicate occurrence is invalid,
including identical duplicates; the application must not select the first
value or concatenate values. HTTP infrastructure must preserve enough header
information for the application to detect duplicates.

## 3. Route classification and public allow-list

Every route is classified in server-owned route policy as one of:

| Class                     | Authentication/context rule                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC`                  | No authentication or tenant context. Restricted to explicit allow-list entries.                                                         |
| `PROTECTED_TENANT_SCOPED` | Valid authentication, exactly one `X-Tenant-ID`, active membership, local authorization and resource authorization are required.        |
| `PROTECTED_NON_TENANT`    | Authentication and authorization are required; use only for an explicitly specified control-plane operation that has no tenant context. |

Business API routes default to `PROTECTED_TENANT_SCOPED`. An omitted route
classification never makes a route public. The initial unauthenticated
allow-list includes only `GET /api/v1/health/live` and
`GET /api/v1/health/ready` (plus an OIDC login/callback endpoint only if the
actual UI flow requires it and it is explicitly registered). A public health
request ignores `X-Tenant-ID` and creates no authenticated tenant context.
`/api/v1/health/capabilities` is `PROTECTED_TENANT_SCOPED`; it is not public
by historical accident. It requires `X-Tenant-ID`, membership and a
least-privilege existing read authorization. Runtime route policy must map
that authorization explicitly before exposing the route; if no safe mapping
exists, deny access rather than introduce a new broad permission implicitly.

## 4. Request pipeline and errors

For a protected tenant-scoped request, processing order is:

1. Apply server-owned route classification.
2. Extract and validate the R1 Bearer access token and its signature/profile.
3. Resolve the exact external identity by trusted issuer and subject (human),
   or by the registered service identity key (service).
4. Validate external-link status and resolve the canonical identity record.
5. Parse exactly one `X-Tenant-ID` using the grammar above.
6. Resolve the ACTIVE TenantMembership for that IdentityLink and requested
   tenant; for a human, resolve the User bound to that membership.
7. Validate canonical tenant-local User lifecycle where applicable.
8. Resolve local tenant RBAC and service-principal scope.
9. Apply domain/resource authorization.
10. Construct a principal bound to exactly the selected tenant and dispatch
    the handler.

No business handler runs before these gates. Authentication precedes tenant
header errors: invalid/missing credentials return `401` even if the tenant
header is also absent. For a valid authenticated identity:

| Condition                                                                                | HTTP / stable code                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Missing `X-Tenant-ID`                                                                    | `400 TENANT_CONTEXT_REQUIRED`                                      |
| Empty, whitespace-only, malformed, or duplicate `X-Tenant-ID`                            | `400 INVALID_TENANT_CONTEXT`                                       |
| Syntactically valid tenant but no usable membership/binding, including an unknown tenant | `403 TENANT_MEMBERSHIP_DENIED` with no tenant-existence disclosure |
| Membership is ACTIVE but local permission/resource authorization is absent               | `403 PERMISSION_DENIED` or canonical resource-denial equivalent    |

Unknown tenant and existing-but-unavailable tenant must not be distinguishable
to a caller. A public route never receives tenant authorization merely because
the header is present. A valid identity without a provisioned external link
retains R1's `403 IDENTITY_NOT_PROVISIONED` behavior.

## 5. Identity and membership persistence model

The conceptual ownership is:

```text
IdentityLink (one external identity, deployment trust scope)
  1 ── N TenantMembership (one explicit tenant binding)
             N ── 1 tenant-local User
```

The external identity itself is not tenant-owned and grants no tenant access.
The membership binding selects the canonical local User for one tenant. The
same human IdentityLink may map to different tenant-local Users in different
tenants:

```text
(issuer, subject, HUMAN) → Tenant A → User A
                         → Tenant B → User B
```

The canonical IdentityLink has at least `id`, exact trusted `issuer`, exact
`subject` (or service client identity in a disjoint service namespace),
`principal_type`, status, provenance and security timestamps. Human uniqueness
is `(issuer, subject, HUMAN)` in the configured trust scope. Service identity
uses the separate R1 `(issuer, client_id, SERVICE)` registration semantics.
Email, username, display name, organization and group are never immutable
identity keys.

The canonical TenantMembership has at least `id`, `identity_link_id`,
`tenant_id`, tenant-local `local_user_id` for a human (or the canonical
tenant-scoped SystemPrincipal binding for a service), status, grant/revoke
timestamps, provenance, actor/audit references, and concurrency/version
metadata required by the repository's write standard. A human membership must
be relationally constrained to a User whose `tenant_id` equals the membership
tenant. Enforce one unambiguous usable mapping for `(identity_link_id,
tenant_id)`; two ACTIVE mappings to different local principals are forbidden.
Use tenant-composite foreign keys where supported by the current schema.

Membership v1 has only `ACTIVE` and `REVOKED`. Revocation is a durable status
change; any later re-grant is an explicit authorized, versioned operation
with a new audit record. Do not hard-delete the security lineage. An ACTIVE membership does not
grant permissions and does not override User lifecycle. Both membership and
canonical User state must permit access, followed by local RBAC. Revoking one
tenant membership does not affect other active memberships of that identity.

The current `identity.external_identities` rows are tenant/user-bound and
cannot by themselves represent an external identity independent of tenant.
Reuse/migrate a row only where its exact issuer, subject, principal type,
tenant and local User relationship are deterministic. Otherwise leave it as
legacy data and require explicit provisioning into the canonical link plus
membership model. Do not dual-write competing identity authorities.

## 6. Legacy migration and provisioning operations

No email, username, display-name, provider-label, tenant-claim or fuzzy
matching may create an IdentityLink or TenantMembership. A legacy row may be
migrated only if it deterministically supplies exact trusted issuer, exact
subject, principal type, tenant and exact tenant-local User, and the proposed
mapping has no uniqueness conflict. Ambiguous or incomplete rows remain
unprovisioned for OIDC. The migration must record deterministic provenance and
must not create a membership from a token claim.

Security-sensitive provisioning separates external identity registration
from tenant binding, through Identity-owned commands equivalent to:

- `IDENTITY.LINK_EXTERNAL` / governed unlink or replacement operation;
- `IDENTITY.GRANT_TENANT_MEMBERSHIP`;
- `IDENTITY.REVOKE_TENANT_MEMBERSHIP`.

Each operation validates tenant and local User ownership, requires narrow
administrative authorization, actor, reason, correlation, idempotency key and
expected version/concurrency protection, and writes audit evidence in the
owning Identity transaction. Same-key/same-request retry returns the prior
result; same-key/different-request conflicts. Durable uniqueness and
transaction serialization prevent competing active bindings. Normal login
never creates an IdentityLink, membership, User or role.

R1 bootstrap remains a trusted control-plane operation with its explicit
issuer, subject, tenant, local User and admin role. Under R2 it creates or
confirms both the IdentityLink and the ACTIVE TenantMembership binding in the
same serialized, audited bootstrap transaction and remains unavailable as a
public HTTP self-provisioning flow. Its one-time marker and R1 eligibility
conditions remain unchanged.

## 7. Tenant authority, service identities and principal

Ignore token `tenant`, `tenant_id`, `organization`, `org` and `groups` claims
for tenant selection, membership and authorization. They cannot override the
header or create a binding. `AuthPrincipal.tenant_id` is derived only from the
validated requested tenant plus successful local membership/scope resolution.
Downstream domains receive the canonical principal, never raw OIDC claims.

Tenant-scoped service requests also require `X-Tenant-ID`. The validated R1
service identity must resolve through an explicit registered issuer/client ID
mapping to a tenant-scoped SystemPrincipal and have explicit authorization
for the requested tenant. A service token grants no cross-tenant authority;
human and service principal namespaces remain distinct. Existing scoped
system permissions are not broadened.

## 8. Proxy, browser, caching and observability integration

Reverse proxies must preserve exactly one client `X-Tenant-ID` value.
Application validation remains mandatory. Do not trust
`X-Authenticated-Tenant`, `X-User-Tenant` or similar edge-supplied authority
headers. RELEASE-007 owns final CORS policy; cross-origin clients that use
this selector will need it explicitly included in allowed request headers.
No CORS or edge change is implemented by R2.

Any future cache for tenant data must vary on the authenticated principal and
validated tenant context; a key that ignores `X-Tenant-ID` is invalid. R2
introduces no cache. Safe telemetry may classify
`TENANT_CONTEXT_REQUIRED`, `INVALID_TENANT_CONTEXT` and
`TENANT_MEMBERSHIP_DENIED` without high-cardinality raw tenant labels.

## 9. RELEASE-001 acceptance tests fixed by R2

The runtime item must prove at least:

- valid token plus valid selector and active membership proceeds;
- missing selector returns 400 even for a sole-member user; malformed,
  whitespace, empty and duplicated values return 400;
- invalid token plus missing selector returns 401;
- a token tenant claim cannot override the header; a valid membership for the
  header-selected tenant proceeds, and lack of that membership returns 403;
- unknown tenant and existing tenant without membership have the same safe
  external result;
- two tenant memberships resolve to the correct tenant-local User independently;
- revoked membership denies the next request while another tenant membership
  remains usable; ACTIVE membership plus suspended/terminated User still
  denies;
- membership and header grant no RBAC permission by themselves;
- no deterministic legacy evidence produces no fabricated link or membership;
- public liveness/readiness ignore tenant context, while capabilities is
  protected; an unclassified business route is never public;
- bootstrap binds explicit tenant membership and is not header-based public
  self-provisioning;
- tenant-scoped service access requires a registered tenant binding;
- proxy/header duplication and tenant-specific cache-key invariants are
  enforced where those components exist.

## 10. Explicit exclusions

R2 is normative planning only. It adds no OIDC/authentication runtime, API
middleware, tenant header parser, IdentityLink or TenantMembership migration,
new User model, permission grant, bootstrap endpoint, CORS policy, proxy
configuration, response cache, RELEASE-002 work or product TASK-roadmap change.
RELEASE-001 runtime may implement these foundations only under the combined
R1 and R2 contracts.
