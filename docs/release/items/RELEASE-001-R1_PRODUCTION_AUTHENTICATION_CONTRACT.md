# RELEASE-001-R1 — Production Authentication Contract

| Field                  | Value                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| Type                   | Release planning/specification child; not a runtime release item    |
| Status                 | `SPEC_GAP / DECISION_REQUIRED`                                      |
| Parent                 | RELEASE-001 — Production API Authentication & Authorization Adapter |
| Runtime implementation | Not authorized by this document                                     |

## Why this decision is required

The API contract lists multiple supported deployment mechanisms and gives
preferences, not a binding production provider or complete API login/request
credential flow. The repository has an OIDC verifier port and an
OIDC-compatible login/session application use case, but the executable API
uses a separate bearer `AuthenticationPort`, currently wired to
`unavailableAuthentication`. The production authorization port is wired to
`denyAll`. Selecting a provider, token flow, or mapping source in runtime
code would therefore create security semantics that the persisted contract
does not currently choose.

This child must produce an approved, normative contract. It must not implement
an adapter, alter `AGENTS.md`, change the product task registry, or weaken the
fail-closed runtime.

## Decisions to resolve

1. **Identity provider and protocol:** Which production identity provider is
   authoritative, and which human login protocol is required? Decide whether
   OIDC is the required deployment baseline or whether SAML-to-session is also
   a supported production path. “OIDC preferred” alone does not answer this.
2. **API credential flow:** Does the API validate provider-issued bearer
   access tokens on each request, or does the Identity application exchange a
   validated login assertion for a platform session credential? Define token
   audience, issuer discovery/key rotation, accepted claims, expiration,
   renewal, logout and revocation checks.
3. **Canonical principal mapping:** Define the authoritative mapping from
   provider subject to canonical user, tenant and actor type; define behavior
   for missing, duplicate, suspended, offboarded or conflicting mappings.
   State whether tenant identity is mapped from the verified subject or
   selected through an approved account context; never trust a client tenant
   header or unverified claim.
4. **Authorization integration:** Define how the production adapter uses the
   existing AuthorizationPort and canonical role/permission/scope grants,
   including immediate or bounded revocation, cache invalidation, temporary
   grants and policy-version handling. Authentication success must not imply
   authorization.
5. **Service/system principals:** Define which service principal types may
   call user-facing API routes, how each is authenticated and mapped to
   tenant-scoped capabilities, and how they remain distinct from human
   identities. Preserve no-wildcard/no-tenantless constraints.
6. **Bootstrap and emergency access:** Define whether any bootstrap,
   break-glass or recovery administrator exists, its enrollment and approval
   conditions, scope, expiry, re-authentication/MFA, audit and revocation.
   If none is allowed, define the supported initial administrator provisioning
   process. No default admin may be inferred.
7. **Unavailable configuration:** Decide whether missing/invalid production
   auth configuration prevents process startup/readiness or allows startup
   while every protected request fails closed. Specify health endpoint
   exposure and operator-visible diagnostics without leaking secrets.
8. **Secrets and operations:** Define provider client/verification key
   references, secret manager integration, rotation, key rollover, emergency
   revocation and environment separation. Never persist real secrets in the
   repository or audit payloads.
9. **Audit and errors:** Define security audit events for success/failure,
   account mapping denial, revocation and administrative binding changes;
   define sanitized 401/403 behavior, rate-limit interaction and correlation
   metadata without logging bearer credentials.
10. **Verification topology:** Define staging tests and production rollout
    controls, including valid and invalid credentials, expired/revoked
    identity, wrong tenant, disabled user, insufficient permission,
    cross-tenant denial, provider outage, key rotation and bootstrap recovery.

## Invariants already fixed by existing specifications

R1 should resolve deployment choices without reopening these rules:

- Authentication and authorization are separate decisions.
- A successful SSO/token check does not grant broad access.
- Authorization evaluates principal, action, resource, scope and context;
  tenant is checked before resource scope.
- Do not trust unverified role claims or client-supplied tenant/role headers.
- Permission caching must be invalidated on role binding, user state, scope
  and temporary-grant changes where revocation is required.
- No wildcard, tenantless principal or implicit administrator privilege.
- Production secrets are externally provisioned; fail closed on invalid or
  absent authentication/authorization.
- Audit evidence must not contain raw tokens, passwords, keys or secrets.

## Required R1 deliverable and exit criteria

R1 should create or update the normative Identity/API/security contract and
record the selected provider/protocol, request credential flow, canonical
principal mapping, permission adapter boundary, bootstrap policy, startup
failure behavior, configuration/secrets, audit and verification requirements.
The decision must be reviewed by the release/security owner before RELEASE-001
can become `READY / NOT_STARTED`.

No provider is selected here. Until R1 is resolved, RELEASE-001 remains
`NOT_STARTED / BLOCKED` with blocker `SECURITY_DECISION / SPEC_GAP`.
