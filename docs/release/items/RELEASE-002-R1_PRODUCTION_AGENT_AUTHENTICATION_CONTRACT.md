# RELEASE-002-R1 — Production Agent Authentication Contract

| Field                  | Value                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| Type                   | Release security contract; planning only                                   |
| Parent                 | RELEASE-002 — Production Agent Authentication for TASK-091                 |
| Status                 | `CODE_COMPLETE`                                                            |
| Runtime implementation | Not authorized in R1                                                       |
| Decision               | TLS client-certificate mTLS with one X.509 credential per registered Agent |

## 1. Purpose and scope

This contract fixes the production machine-identity, enrollment, credential
lifecycle, request-session, replay, and authorization boundary for the Agent
Gateway used by TASK-091 and other enabled Agent protocols. It is separate
from human OIDC authentication in RELEASE-001. RELEASE-002 runtime may
implement this contract; this R1 adds no runtime behavior or migration.

RELEASE-002 owns Agent identity semantics and the authentication contract.
RELEASE-007 owns the final production TLS ingress, certificate deployment,
trusted-proxy topology, and edge controls. RELEASE-002 may become
`CODE_COMPLETE` after implementation and automated verification, before
deployment is `VERIFIED`; staging must later prove mTLS through the actual
RELEASE-007 topology.

## 2. Credential and transport decision

Production Agent authentication uses mutual TLS with one X.509 client
certificate credential per Agent credential record. Agent endpoints require
TLS 1.2 or later; prefer TLS 1.3 where supported. A valid client certificate
chaining to the operator-configured private Agent CA is mandatory for every
production Agent connection. Bearer-only authentication is insufficient.
Disable TLS 1.3 0-RTT early data on Agent endpoints.

The production Agent must generate its own asymmetric key pair. The private
key remains on the Agent host where operationally possible and is never
uploaded to or stored by the platform. The server stores certificate/public
identity metadata, lifecycle state, Agent relation, provenance, and audit
references only. Do not commit Agent or CA private keys or treat ordinary
application storage as a PKI secret store.

An operator-controlled private Agent CA is the sole trust anchor. The Agent
cannot choose the CA, issuer, trust anchor, or validation policy. Reject
arbitrary self-signed certificates. CA signing keys come from approved
secret/PKI infrastructure and are accessed only through an
`AgentCertificateIssuerPort`; domain/application code never handles CA
private keys directly. Use maintained TLS/X.509 implementations and
platform-supported secure algorithm profiles; do not implement chain or
signature verification manually.

### Trusted TLS termination

mTLS may terminate at the Agent Gateway or at an explicitly trusted ingress.
For direct termination, the Gateway consumes the verified TLS peer
certificate from the TLS socket. For proxy termination, the proxy must
validate the certificate chain, strip all client-supplied peer-identity
headers, and pass verified peer-certificate metadata only over a protected,
authenticated internal channel. The Gateway accepts that metadata only from
the explicitly authenticated proxy and is not publicly reachable around it.
No public `X-Agent-ID`, `X-Client-Cert`, `X-Authenticated-Agent`, or similar
header is authentication. Missing or untrusted peer metadata fails closed.
RELEASE-007 verifies the concrete topology.

## 3. Canonical Agent registration and authority

`agent.agents` is the canonical AgentRegistration for v1, adapted as needed
without creating a second Agent registry. It owns the server-generated
`agent_id`, `tenant_id`, and required same-tenant `asset_id`. V1 requires a
pre-existing canonical Asset; unbound Agent registrations are not permitted.
The current one-registration-per-tenant/Asset rule remains: only one active
AgentRegistration may bind a given `(tenant_id, asset_id)`. An authorized
operator may retire the prior registration and provision a replacement for
the same Asset; registration history is retained. Authentication never
rebinds an Agent to another Asset.

Add or adapt an explicit security lifecycle separate from the existing
operational online/status dimension:

- `ACTIVE`: registration may authenticate if its credential is valid;
- `DISABLED`: authentication and Agent work are denied until an authorized
  administrative operation re-enables it;
- `RETIRED`: terminal registration state; it cannot authenticate or be
  reactivated. A replacement is a new registration under the one-active-per-
  Asset rule.

Existing `ONLINE`, `OFFLINE`, `DEGRADED`, `UPDATE_REQUIRED`, `RECOVERING`,
and `UNMANAGED` operational meanings are not silently repurposed. An offline
or degraded but `ACTIVE` registration may authenticate a heartbeat to recover
operational status. `UNMANAGED` is not an eligible registration for protected
Agent operations. Unknown clients never create AgentRegistration on connect.

The canonical authority chain is:

```text
verified TLS peer certificate
→ AgentCredential by controlled certificate identity/fingerprint
→ ACTIVE AgentRegistration
→ server-owned tenant_id and required Asset binding
→ route authorization and exact Agent/execution binding
```

Never identify or authorize an Agent using hostname, IP, MAC, logged-in user,
display name, free text, or Agent-supplied tenant/Asset fields.

## 4. AgentCredential model and certificate identity

Persist an Agent-owned AgentCredential record with at least:

- `credential_id`, `agent_id`, certificate serial and SHA-256 fingerprint;
- public-key/SPKI identity reference and certificate profile;
- `issued_at`, `not_before`, `expires_at`;
- status, `revoked_at`, revocation reason, and `replaced_by`/rotation link;
- registration/issuer provenance and audit references.

Credential states are `ACTIVE`, `REVOKED`, `EXPIRED`, and `REPLACED`.
`REVOKED`, `EXPIRED`, and `REPLACED` are terminal; a credential is never
reactivated. Expiry is enforced from certificate and database validity times
on every authorization check, even if a background process has not yet
persisted the `EXPIRED` state. Keep prior credentials and their audit lineage.

Each issued leaf certificate contains exactly one server-controlled URI SAN
in this form:

```text
urn:itcenter:agent-credential:<credential_id>
```

The issuer, not the CSR, sets this SAN after allocating the credential ID.
Ignore or reject CSR-requested identity SANs; do not use CN, hostname, email,
organization, tenant text, or certificate permissions for authorization.
Bind the issued certificate serial, fingerprint, SPKI identity, and URI SAN
to the same credential and AgentRegistration. Validate the trust chain,
validity period, client-auth EKU, approved certificate/key profile, URI SAN,
fingerprint/serial registration, current credential state, and current
registration state. Fail closed on any mismatch or ambiguity.

TLS certificate validity uses synchronized system time and only small bounded
clock tolerance: 30 seconds by default and 60 seconds maximum. The maximum
validity of a newly issued Agent certificate is 30 days; production policy
may set a shorter duration, never a longer one without a security-policy
change. Agents rotate before expiry.

## 5. Trusted enrollment and one-time Enrollment Token

Enrollment is possible only for a pre-provisioned AgentRegistration created
by an authorized administrative/control-plane operation. The registration
must already bind the intended tenant and Asset. V1 enrollment uses a
single-use Enrollment Token only to authorize the first certificate for that
registration; the token is not a long-term credential and cannot select a
tenant, Asset, or Agent.

An Enrollment Token record is bound server-side to the exact Agent ID,
tenant, Asset, issuance time, expiry, issuer actor, and single-use state. The
platform generates at least 256 bits of cryptographically secure random
entropy, returns the opaque token once, and stores only its SHA-256 verifier
and non-secret metadata. Default lifetime is 10 minutes. Expired, consumed,
revoked, mismatched, or unknown tokens fail with one safe enrollment error;
responses do not reveal whether another Agent registration exists.

Creating a registration, issuing a token, and revoking a token are privileged
operations. Minimum narrow permissions are `agent.registration.manage` and
`agent.enrollment_token.issue`; normal Helpdesk access does not imply them.
Each write requires actor, tenant, target registration, reason,
`Idempotency-Key`, and an expected registration/token version where mutable
state is involved. Competing enrollment-token uses serialize durably; exactly
one enrollment attempt may consume a token.

### Enrollment flow and failure recovery

1. An authorized operator provisions the same-tenant AgentRegistration for
   the existing Asset.
2. An authorized operator issues a ten-minute, single-use Enrollment Token.
3. The Agent generates a private key locally and creates a CSR.
4. The Agent connects over server-authenticated TLS (without an Agent client
   certificate because this is first-credential bootstrap) and submits the
   Enrollment Token, CSR, and enrollment message identity.
5. The platform verifies the token verifier, expiry, unused state and exact
   registration binding, and validates CSR proof-of-possession and key
   profile. It does not accept CSR-supplied Agent, tenant, Asset or
   authorization attributes.
6. The platform reserves the token/enrollment attempt durably, then calls the
   PKI only through `AgentCertificateIssuerPort`. The issuer inserts the
   allocated credential URI SAN and signs the leaf certificate.
7. A local transaction persists the ACTIVE AgentCredential, consumes the
   Enrollment Token, records the durable enrollment/message result, and
   appends required audit/outbox evidence. Return the certificate chain and
   credential ID; never return or receive the private key.

The PKI issue operation is idempotent by the durable enrollment-attempt ID,
or supports lookup/reconciliation by that ID before retry. Do not hold a
database transaction open during external signing. If signing succeeds but
the local commit/result is uncertain, reconcile the same issuance attempt;
do not issue a second credential or consume a different token silently.
Token reservation prevents concurrent issuance. Failed or abandoned attempts
are recoverable through a durable state transition and audit, not by
reopening a consumed token. A raw token is never returned on retry after its
one-time response has been lost; the operator revokes it and issues a new
token through the governed operation.

## 6. Rotation, re-enrollment, and compromise

Normal self-rotation is allowed only when the current credential is ACTIVE,
not revoked, and has seven days or less remaining. It requires the same
AgentRegistration, current valid mTLS identity, a new locally generated key
pair and CSR, and a durable rotation request identity. An Agent cannot rotate
another Agent's credential. The signer binds the new certificate to the same
AgentRegistration. An expired or revoked credential cannot self-rotate; it
requires a new authorized one-time Enrollment Token and controlled
re-enrollment.

After the new credential is successfully persisted and returned, both old
and new credentials may authenticate the same registration for at most 24
hours. The overlap deadline is durable and cannot be extended by retry. The
old credential becomes `REPLACED` at or before that deadline and is denied
thereafter; no registration may have more than two valid credentials during
normal overlap. A changed CSR/payload under the same rotation identity is a
conflict. Signing and response retries reconcile to the same credential.

Administrative forced rotation, registration disablement/retirement, and
credential revocation require narrow local permissions such as
`agent.credential.force_rotate`, `agent.registration.manage`, and
`agent.credential.revoke`. Revocation requires actor, reason, timestamp,
credential ID, expected version, `Idempotency-Key`, and audit. Revoking one
credential does not affect other Agents; disabling/retiring a registration
denies every credential belonging to that registration. Revoked credentials
are not reactivated.

For suspected compromise: revoke the credential immediately, terminate its
active sessions where possible, deny every later request/message, preserve
evidence, and issue a controlled new Enrollment Token for re-enrollment.
Never rely only on certificate expiry, Asset deletion, or a background CRL
refresh for platform revocation. CRL/OCSP may supplement local checks only
when the selected production PKI actually supports and configures them; do
not claim it otherwise.

## 7. AgentPrincipal, tenant, Asset, and execution authorization

Successful authentication yields a canonical AgentPrincipal containing only
the necessary trusted context:

- `agent_id`, `credential_id`, `tenant_id`, and registered `asset_id`;
- `authentication_method = MTLS`;
- server-established `agent_session_id` and connection establishment time;
- safe certificate serial/fingerprint/issuer metadata and request/correlation
  context.

The principal's tenant and Asset come exclusively from the current
AgentCredential → AgentRegistration mapping. Agent routes do not accept
`X-Tenant-ID` as a selector. If supplied, it is rejected as
`INVALID_TENANT_CONTEXT`; it never overrides the canonical tenant. Request
body tenant/Agent/Asset claims must match the principal and canonical target
or the request is denied.

Before accepting any TASK-091 execution/attempt evidence, verify in the
Automation owner boundary:

```text
authenticated tenant = execution tenant
authenticated agent = execution's assigned target Agent
registered Asset/device = execution target when required by its contract
authenticated command/session/message = exact expected attempt context
```

Same-tenant membership is insufficient. Agent B cannot acknowledge, report,
claim, or reconcile Agent A's execution. Authentication grants no arbitrary
Asset mutation, Work Queue creation, ActionIntent, cross-Agent operation, or
other API route. Keep TASK-091's action allow-list and source-domain
authorization intact.

Human OIDC IdentityLink/TenantMembership and AgentCredential are distinct
principal namespaces. A human token cannot authenticate as an Agent; an
Agent certificate cannot authenticate as a human or inherit human RBAC or
SystemPrincipal privileges. Do not reuse RELEASE-001's `X-Tenant-ID`
semantics for the Agent channel.

## 8. Session generation, freshness, and replay

For each newly authenticated TLS connection, the server creates a fresh
opaque `agent_session_id` and binds it to `agent_id`, `credential_id`,
`tenant_id`, TLS connection identity, and establishment time. The session
identity is server-owned, persisted as required for message dedupe and
revocation, and supplied to the Agent over that authenticated channel. It
cannot be changed by request body or header. Reconnect creates a new session;
messages from an old session cannot become current-session evidence. Existing
`agent_runtime_id` remains separate restart/process-generation evidence under
TASK-091; it does not authenticate the Agent. Any Agent-provided
`agent_session_id` is ignored or rejected in favor of the server-bound value.

TLS record protection is the network-channel replay control; TLS 1.3 0-RTT
is disabled. Every state-changing Agent protocol message uses the existing
`Idempotency-Key` as its `message_id` and is durably bound to:

```text
tenant_id + agent_id + agent_session_id + message_id
```

The receipt stores a canonical request fingerprint and result/reference
under the repository's durable idempotency/inbox rules. Replaying the exact
identity and same canonical payload returns the prior logical outcome without
a second domain transition or event. Reusing the identity with different
content returns `409 AGENT_MESSAGE_CONFLICT`, creates no business effect, and
records a security anomaly according to audit/observability policy. State
changes and their message receipt/result/outbox evidence commit atomically
where they share the local transaction; recovery reconciles uncertain external
effects by the same durable operation identity. No process-local dedupe or
custom cryptography is allowed.

Messages must use the current connection's server-bound session. A previous
session's message ID is not current evidence after reconnect. If a duplicate
is retried on its original still-authenticated session, return its prior
receipt; do not replay a state transition. All protected routes check
current AgentCredential and AgentRegistration validity for each request, and
long-lived channels recheck before each message. Revoke/disable closes active
sessions where possible; the next request/message is denied even if an
existing socket remains open. No positive credential-status cache may delay
revocation in v1. If credential/registration state cannot be queried, fail
closed with `503 DEPENDENCY_UNAVAILABLE`.

## 9. TASK-091 execution and late evidence

An authenticated acceptance/report must match the exact immutable
`execution_id`, `command_id`, tenant and `target_agent_id`, plus the bound
session/message identity. Existing Agent-side durable command receipts
continue to deduplicate `(tenant_id, agent_id, command_id)` and reject
same-ID/different-content requests. The additional session/message identity
protects Agent protocol replay; it does not replace TASK-091 command
idempotency.

Authentication does not change TASK-091's deadlines or state machine. A
dispatched execution without timely acceptance becomes `UNKNOWN` under the
existing timeout contract. A later valid authenticated ACK or heartbeat may
be recorded as append-only reconciliation evidence only; it must never
resurrect or rewind the terminal execution. No redispatch, retry, or source
mutation follows merely from successful Agent authentication.

Heartbeat requires valid current Agent authentication. It may update
operational liveness and current server session according to the Agent
runtime contract, but cannot change tenant, create registration, reactivate
credential, or authorize an execution. Reconnect authenticates again and
receives a new server session ID. Existing restart proof continues to use
the canonical `agent_runtime_id`/runtime generation and TASK-091 baseline,
not the session ID alone.

## 10. Safe errors, audit, permissions, and observability

An untrusted, malformed, not-yet-valid, expired, unknown, replaced or revoked
certificate is rejected at TLS/authentication validation; when an HTTP error
can safely be returned, use `401 AGENT_AUTHENTICATION_FAILED` without
revealing which registration or credential failed. Authenticated but
disabled/retired registration or tenant/Asset/execution/Agent mismatch returns
a safe `403 AGENT_NOT_AUTHORIZED` (or the owning domain's equally safe
not-found mapping). Invalid/expired/consumed/wrong-registration Enrollment
Tokens share `401 ENROLLMENT_TOKEN_INVALID`. Trust, credential-store, or PKI
dependency failures return sanitized `503 DEPENDENCY_UNAVAILABLE`; they
never create an anonymous principal or successful empty result.

Audit significant operations through the existing AuditPort: registration
provision/disable/retire and Asset binding changes; Enrollment Token
issuance/revocation; enrollment and certificate issuance; rotation,
revocation, forced re-enrollment and compromise recovery; and security
anomalies. Audit binds actor, tenant, Agent/Asset, credential/operation
reference, reason, time, version, idempotency and correlation. Successful
enrollment, rotation, revocation and administrative changes fail closed if
required audit cannot be committed. Do not create a parallel auth audit
store. Routine successful heartbeat/auth need not create a compliance audit
per request; use bounded operational metrics/logs for success/failure
categories and suspicious failure rates.

Use narrow local permissions, at minimum equivalent to:

- `agent.registration.manage` — provision, disable, retire, or replace a
  server-owned registration/binding;
- `agent.enrollment_token.issue` — issue or revoke a one-time enrollment
  token;
- `agent.credential.revoke` — revoke a credential;
- `agent.credential.force_rotate` — administrative forced re-enrollment.

Normal self-rotation requires the currently valid certificate and exact
registration binding, not an administrative permission. No Agent credential
grants these human administrative permissions. Metrics use bounded reason
codes and no unbounded Agent ID, certificate serial, fingerprint, hostname,
or tenant labels. Logs/audit never contain private keys, raw Enrollment
Tokens, CA signing keys, or bearer credentials.

## 11. Readiness and production fail-closed behavior

Agent authentication readiness is true only when the configured Agent trust
anchor is usable, TLS peer-certificate validation is active, the trusted
peer-metadata boundary (if proxied) is usable, and the canonical
AgentCredential/AgentRegistration store can be queried. Production startup
rejects missing trust/configuration and test, mock, unavailable, bearer-only,
or bypass adapters. There is no anonymous fallback.

Credential-issuance readiness is separately false unless the approved
`AgentCertificateIssuerPort`/PKI integration is configured and usable for
enrollment and rotation. If signing is unavailable, existing valid
credentials may authenticate if trust and current local credential state are
available; enrollment/rotation fails closed with dependency-unavailable.
If credential or registration state is unavailable, Agent authentication
itself is not ready and requests fail closed. RELEASE-003 later composes
platform/worker readiness; it is not part of R1.

The production channel rejects untrusted CA, missing/invalid peer
certificate, bad chain, wrong EKU/profile, invalid time, unknown or inactive
credential, inactive registration, tenant/binding mismatch, or unavailable
revocation state. No development/test authentication adapter is selectable
in production. TLS ingress, certificates and rate limiting are deployed and
validated under RELEASE-007; staging must prove that the exact promoted
topology preserves the verified Agent peer identity and cannot be bypassed.

## 12. Storage and event ownership

The Agent domain owns registration security state, Enrollment Token
verifiers, AgentCredential metadata, Agent session identity, and durable
Agent-message receipts. Keep credential history append-only or superseding;
revocation/expiry/replacement does not delete prior evidence. Enforce durable
uniqueness for certificate serial/fingerprint, credential ID, one-time token
verifier, one active registration per tenant/Asset, and
`(tenant_id, agent_id, agent_session_id, message_id)`. Preserve tenant/Asset
foreign-key consistency. Do not backfill credentials or Agent sessions from
hostname, IP, MAC, display name, current heartbeat, or ambiguous legacy
enrollment fields. Existing enrollment-token hash/expiry columns may be
adapted only if their provenance and format are proven compatible; otherwise
new constrained persistence is required and old data remains non-authoritative.

Agent-owned credential lifecycle events may be emitted through the existing
transactional outbox after commit, for example registration provisioned,
enrollment token issued/consumed/revoked, credential issued/rotated/revoked,
and registration disabled/retired. They describe Agent identity state only;
they do not execute TASK-091 or Asset workflows. Consumers are at-least-once
and idempotent. External PKI actions use a durable operation identity and
reconciliation; they are never placed inside a long database transaction.

## 13. Acceptance contract

The RELEASE-002 runtime must provide dedicated tests for:

- trusted CA, valid ACTIVE credential and ACTIVE registration authenticate
  exactly the expected Agent; untrusted, self-signed, malformed, expired,
  not-yet-valid, unknown, replaced and revoked certificates are denied;
- certificate chain, client-auth EKU, URI SAN credential ID, serial,
  fingerprint and AgentRegistration must all bind; CN/hostname/tenant
  attributes cannot change identity;
- TLS 1.2+ enforcement, TLS 1.3 preference, disabled 0-RTT, trusted proxy
  peer-metadata handling, spoofed identity-header rejection, and no direct
  ingress bypass;
- server-owned Agent tenant/Asset resolution, no `X-Tenant-ID` selection,
  same-tenant Asset validation, one-active-Agent-per-Asset, disabled/retired
  registration denial, and cross-tenant/cross-Asset denial;
- Enrollment Token issuance is privileged and audited; valid bound token plus
  CSR issues one cert; unknown/mismatched/expired/consumed/revoked token,
  invalid CSR and altered identity SAN fail closed; raw token is not stored;
- concurrent token use yields exactly one issuance; signer retry/crash
  recovery reconciles the same issuance and does not create duplicate
  credentials; audit failure rolls back or blocks activation as specified;
- self-rotation requires an ACTIVE certificate with at most seven days
  remaining; new locally generated key/CSR is bound to same Agent; at most
  24-hour overlap; old credential becomes unusable; expired/revoked
  credential cannot self-rotate; forced rotation requires privileged scope;
- revocation denies the next request/message while the certificate remains
  time-valid, disconnects or fences existing long-lived sessions, and does
  not affect other Agents; credential-store outage fails closed;
- human/Agent principal namespaces are distinct; Agent cannot choose tenant
  or Asset, invoke unrelated API capability, or act for another Agent;
- same session/message identity and payload is idempotent, changed payload
  conflicts, previous-session evidence is rejected as current, and concurrent
  duplicate delivery causes one state transition;
- authenticated ACK/report matches exact tenant, Agent, Asset where
  required, execution, attempt and command; late ACK/heartbeat after
  `UNKNOWN` is evidence only and does not resurrect execution;
- heartbeats require authentication and cannot create registrations, switch
  tenant, reactivate credentials, or authorize unrelated work;
- mock/test/unavailable auth, missing CA/config, and missing credential
  storage are rejected/not-ready in production; enrollment signing readiness
  is distinguished from authentication readiness;
- logs, metrics, audit, outbox, responses and fixtures contain no private
  key, raw enrollment token, CA key, or secret; audit and low-cardinality
  failure observability behave as specified.

Real PKI provisioning and mTLS validation through the production-like staging
topology are required before RELEASE-002 is `VERIFIED`; automated tests alone
can establish at most `CODE_COMPLETE`.

## 14. Release and runtime boundary

This R1 is a security contract only. It adds no Agent runtime adapter,
Enrollment/rotation/revocation endpoint, migration, permission assignment,
PKI integration, or TASK-091 state-machine change. `unavailableAuthentication`
remains the production Agent Gateway composition until RELEASE-002 runtime is
implemented under this contract. RELEASE-003 is not started. The release
decision remains `BLOCKED_FOR_RC` until all release blockers and the final
staging gate are verified.
