# RELEASE-002 Implementation Report

| Field            | Value                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Release item     | RELEASE-002 — Production Agent Authentication for TASK-091                                              |
| Contract         | [RELEASE-002-R1](RELEASE-002-R1_PRODUCTION_AGENT_AUTHENTICATION_CONTRACT.md)                            |
| Status           | `CODE_COMPLETE`                                                                                         |
| Verification     | Automated repository gates pass; real CA/staging validation is pending, so this item is not `VERIFIED`. |
| Release decision | `BLOCKED_FOR_RC`                                                                                        |

## Architecture and trust boundary

The Agent Gateway terminates TLS directly with Node HTTPS. Production config
sets `AGENT_AUTH_MODE=mtls`, requires the server certificate/key, trusted
Agent CA and CA signing-key secret references, requests a client certificate,
and requires TLS 1.2 or later. No proxy identity-header adapter was added.
The TLS socket's verified peer certificate is the only Agent authentication
input. Public `X-Agent-ID`, certificate-forwarding headers, bearer credentials
and `X-Tenant-ID` cannot establish or change Agent identity. The enrollment
endpoint is the narrow first-credential exception: server-authenticated TLS
plus a one-time Enrollment Token authorizes enrollment.

Startup rejects missing production mTLS configuration. There is no fallback
to the human OIDC adapter, a test adapter, bearer token, or anonymous Agent.
The production health readiness callback requires database readiness, the
mTLS authentication adapter, and the certificate issuer. The Gateway returns
not-ready if any required capability is unavailable. RELEASE-003 aggregate
worker readiness and RELEASE-007 edge deployment are outside this item.

## Canonical identity and persistence

`agent.agents` remains the owning domain's canonical AgentRegistration and
Asset binding. The migration adds registration lifecycle/provenance/version
metadata without creating a second Agent registry or manufacturing
credentials. Existing Agent runtime/session fields remain process-generation
evidence, not authentication authority.

The migration adds:

- `agent.agent_credentials`: tenant/Agent-bound public certificate,
  fingerprint/SPKI/serial, validity, lifecycle, revocation, replacement and
  overlap metadata. The certificate identity is the exact server-issued URI
  SAN `urn:itcenter:agent-credential:<credential_id>`.
- `agent.enrollment_tokens`: verifier hash and bound registration/Asset,
  issue/expiry/consume/revoke, actor, reason and idempotency metadata. Raw
  tokens are returned once and never persisted.
- `agent.certificate_issuance_attempts`: durable CSR hash/CSR, attempt,
  serial, deterministic credential ID, state, certificate and bounded lease
  for enrollment and rotation recovery.
- `agent.agent_sessions` and `agent.agent_message_receipts`: server-generated
  TLS connection sessions and durable per-session message receipts, including
  execution-attempt binding where present.
- A transport-session binding on automation action receipts and narrow local
  permissions for registration, enrollment, revocation and forced
  re-enrollment.

No legacy enrollment hash is promoted into a credential. No Agent is inferred
from host/network metadata, and no certificate or private key is fabricated
for existing rows.

## Certificate issuance and lifecycle

`AgentCertificateIssuerPort` separates application workflows from PKI
signing. `OpenSslAgentCertificateIssuer` validates CSR signature/key profile,
sets the canonical URI SAN and client-auth EKU server-side, caps leaf validity
at 30 days, and checks the issued certificate identity. Its CA signing key is
provided via file-backed secret references and passed to the signer process
through a private input stream; no CA private key is stored in the database or
repository. Tests generate ephemeral CA/Agent keys.

Enrollment requires a pre-existing ACTIVE registration bound to a usable
same-tenant Asset and a 256-bit single-use token with a ten-minute default
life. Token consumption and credential persistence are durable and
transactional; a database lock and issuance attempt ensure only one
concurrent use succeeds. Rotation requires the current ACTIVE credential,
the same registration, a new CSR and seven days or less remaining validity.
The old certificate has a bounded 24-hour overlap, after which authentication
marks it REPLACED and rejects it. Rotation request idempotency is scoped to
the server-generated TLS session. Revocation updates canonical credential
state and ends sessions; current state is rechecked on every request and
inside protected Agent transactions, so already-open connections cannot
continue after revocation.

Application authorization requires current credential state, registration
state, exact SAN, certificate serial/fingerprint/SPKI, validity and clientAuth
EKU. CA-chain verification is performed by the Node TLS implementation; the
application does not implement X.509 cryptography. No CRL/OCSP capability is
claimed.

## Tenant, Asset and TASK-091 binding

The resulting `AgentPrincipal` is built from the certificate credential and
server-side registration: Agent ID, credential ID, registration tenant,
canonical Asset, `MTLS` method and server-generated connection-session UUID.
No Agent-supplied tenant or Asset field is trusted. Protected Agent
transactions revalidate the principal under shared locks before business
work, serializing revocation/disablement against active requests.

TASK-091 remains execution owner. Existing claim, ACK, result and restart
checks remain bound to the assigned Agent, tenant, command and transport
session. Automation receipts now retain transport-session binding. The
Gateway adds a durable message receipt keyed by tenant, Agent, server session
and `Idempotency-Key`; canonical payload replay returns the prior outcome,
while changed content conflicts. Wipe, deployment, removal, inventory,
heartbeat and automation command paths use this durable session boundary.
The legacy Agent runtime generation remains separate. Existing TASK-091
`UNKNOWN`, timeout and late-evidence behavior is unchanged; E2E acceptance
continues to prove a late ACK is reconciliation evidence and cannot resurrect
execution.

## Administration, audit and observability

Authenticated platform administrators use narrow permissions for Agent
registration, one-time token issuance/revocation, credential revocation,
forced re-enrollment and registration state changes. These commands validate
tenant/Asset/version/reason and idempotency, use durable database constraints
and row locks, and append existing outbox/audit records. Emergency access
continues to use the platform's external OIDC model; no local password or
Agent-auth bypass was added.

Agent-authentication logging emits only fixed low-cardinality events for
success, invalid peer/certificate, unknown/revoked/expired credential,
registration ineligibility, session conflict and repository unavailability.
It never logs certificate bodies, private keys, bearer credentials or raw
Enrollment Tokens. Readiness exposes only aggregate health.

## Automated verification

The final uninterrupted `npm test` completed with exit code 0:

| Layer               |         Result |
| ------------------- | -------------: |
| Unit / architecture |   87/87 passed |
| Contract            |     2/2 passed |
| Migration           |     6/6 passed |
| Integration         |   60/60 passed |
| E2E                 |   61/61 passed |
| Total               | 216/216 passed |

RELEASE-002 coverage is in:

- `tests/unit/release002-agent-auth.test.ts` — production fail-closed config,
  TLS setup, ephemeral OpenSSL CA signing, certificate identity, principal
  derivation from current canonical records, receipt idempotency/conflict and
  TASK-091 session binding.
- `tests/integration/release002-agent-auth.test.ts` — PostgreSQL registration,
  hash-only token persistence, atomic single-use/concurrent enrollment,
  token revocation during external signing, certificate authentication, token
  replay rejection, rotation overlap and expiry, immediate revocation,
  controlled re-enrollment and registration disable/re-enable.
- Existing `tests/e2e/automation-executions.test.ts` — Agent/tenant execution
  binding, authenticated command delivery, timeout-to-UNKNOWN and late
  authenticated evidence without illegal resurrection.
- `tests/migration/migrations.test.ts` — fresh ordered bootstrap, idempotent
  rerun and migration checksum protection, including the RELEASE-002 schema.

The complete run also passed `npm run typecheck`, `npm run lint` (including
domain-boundary checks), `npm run format:check`, `npm run test:migration` and
`git diff --check` after implementation. The repository's existing
Operations Overview E2E emitted the known `pg@9.0` client-query deprecation
warning; it did not affect correctness or test results.

## Pending production verification and exclusions

This report establishes `CODE_COMPLETE`, not `VERIFIED`. RELEASE-007 must
deploy the immutable release through the intended staging ingress/topology.
An operator must provision the private Agent CA and server/Agent certificates
through the approved secret/PKI path, enroll a real staging Agent, and verify
the full positive and negative mTLS, rotation, revocation, replay, readiness
and TASK-091 binding scenarios. No production or staging credential has been
created by this implementation.

This item does not implement RELEASE-003 worker readiness, RELEASE-007 edge
TLS/rate limiting, external PKI/CA lifecycle management, human OIDC, a proxy
certificate-header trust adapter, or new TASK-091 behavior. Overall release
remains `BLOCKED_FOR_RC`; RELEASE-001 still awaits real IdP/staging
verification, and other release backlog items remain open.
