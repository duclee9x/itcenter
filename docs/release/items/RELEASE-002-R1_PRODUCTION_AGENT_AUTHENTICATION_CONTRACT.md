# RELEASE-002-R1 — Production Agent Authentication Contract

| Field                  | Value                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Type                   | Release security-planning remediation only                                                                                |
| Parent                 | RELEASE-002 — Production Agent Authentication for TASK-091                                                                |
| Runtime implementation | Not authorized in R1                                                                                                      |
| Status                 | `PLANNING_REQUIRED / SECURITY_DECISION_PENDING`                                                                           |
| Parent status          | `BLOCKED / NOT_STARTED`                                                                                                   |
| Blocker                | Production Agent credential, enrollment, lifecycle, replay and channel semantics are not selected by repository contract. |

## 1. Purpose and decision boundary

This document records the canonical Agent authentication boundary and the
security decisions that must be settled before a production adapter can be
implemented. Existing specifications require an authenticated enrolled
Agent and fail-closed execution, but do not select a credential mechanism or
define how it is trusted, issued, rotated, revoked, or bound to an
authenticated channel. This is a genuine `SECURITY_DECISION / SPEC_GAP`.

R1 does not select mTLS, workload identity, OAuth client credentials, a
certificate format, an enrollment-token flow, or any other credential by
assumption. The generic list of service authentication methods in
`API_COMMAND_CONTRACT_SPEC.md` is not an Agent Gateway decision. The security
owner must approve one coherent profile, including the interaction between
transport identity and application credential, before RELEASE-002 runtime
implementation begins.

## 2. Current canonical boundary (observed, not expanded by R1)

The Agent Gateway is a separate HTTP application at `apps/agent-gateway`.
Agent routes use the generic `AuthenticationPort` and currently accept a
Bearer credential at the transport adapter boundary. The executable gateway
passes `unavailableAuthentication`, so production requests fail closed.
Tests inject controlled authenticated principals; this test behavior is not
a production adapter.

The canonical registration is `agent.agents`: `id` is the Agent identifier;
`tenant_id` is its tenant; `asset_id` is required and unique per tenant in the
current schema; and `status` describes registration/online state. Legacy
`enrollment_token_hash` and `enrollment_token_expires_at` columns exist, but
their presence does not define a complete or currently configured issuance,
validation, rotation, or revocation protocol. Do not treat them as an
approved production credential contract.

`agent_runtime_id`, `agent_session_id`, and `last_seen_at` are mutable latest
Agent-reported heartbeat/runtime values. They are not currently
cryptographically bound to the authentication credential and cannot serve as
authentication authority. The existing schema does not persist a canonical
authenticated channel/session generation.

TASK-091 uses `POST /api/v1/agent/automation-actions/claim`,
`/{command_id}/commands/accept`, and `/{command_id}/commands/report`. The
authenticated principal supplies Agent and tenant identity. Automation
validates the exact execution, target Agent, tenant and command. Agent-side
receipts deduplicate `(tenant_id, agent_id, command_id)` and reject changed
content. This protects command processing from duplicate delivery; it does
not prevent replay or theft of a reusable authentication credential.

TASK-091's dispatch acceptance deadline and `UNKNOWN` behavior remain
authoritative. Late authenticated acceptance or runtime markers may be
retained as reconciliation evidence but must never move a terminal `UNKNOWN`
execution back to an active or success state. R1 does not change those
semantics.

## 3. Invariants fixed for any future profile

The following are fixed regardless of the credential decision:

1. An Agent is a machine/device principal and cannot authenticate as a human
   `IdentityLink` or inherit a human user's role or permissions.
2. Authentication resolves one currently registered canonical Agent ID.
   Hostname, IP, display name, request-supplied MAC, or other descriptive
   attributes are not identity keys.
3. Tenant and Asset context derive from authoritative Agent registration and
   current canonical ownership/binding. Agent-supplied tenant or Asset
   identifiers and `X-Tenant-ID` do not grant or select authority.
4. Protected Agent work requires a valid current Asset binding. The system
   must not infer or silently transfer that binding.
5. Authentication and authorization remain separate. A credential proves
   Agent identity only. TASK-091 continues checking tenant, exact target
   Agent, execution/attempt, command ID, allowed action and current execution
   state before accepting evidence.
6. Unknown, disabled, unenrolled, revoked, expired or otherwise invalid
   identity/credential fails closed. No first-request auto-enrollment,
   anonymous, test, mock, human OIDC, default-Agent, or fallback identity is
   allowed in production.
7. Credential verification failure or unavailable required trust/revocation
   state cannot become successful authentication. The gateway and Agent
   execution capability remain not-ready/unavailable when required
   production authentication cannot operate safely.
8. Credentials, private keys, bearer tokens and enrollment secrets never
   appear in logs, audit payloads, outbox events, timeline, Work Queue,
   idempotency responses, or committed test fixtures.
9. TASK-091 semantics remain authoritative: stable command IDs, durable
   receipt dedupe, no automatic business redispatch, and no resurrection of
   `UNKNOWN` by late evidence.
10. RELEASE-007 owns production edge TLS ingress and rate limiting. R1 must
    still decide which transport security properties the Agent credential
    profile requires and how those properties remain trustworthy across any
    TLS-terminating proxy.

## 4. Security decisions required before runtime

Each decision below must be explicit, internally compatible, and recorded in
an approved R1 contract revision. None is selected by this draft.

### 4.1 Credential and channel profile

Choose the Agent credential type and protocol. Current repository-level
possibilities such as mTLS and workload identity are alternatives, not an
approved profile. Specify whether TLS is mandatory end-to-end, whether mTLS
is required, whether a certificate itself is the identity, or whether a
short-lived application credential is bound to workload identity. Define
which trusted component validates it and which authenticated facts reach the
Gateway. Do not trust client-supplied identity headers from an untrusted
network.

### 4.2 Enrollment and trust bootstrap

Identify the trusted operator/control-plane actor and channel allowed to
create or activate an Agent registration and credential. Define proof of
control of the intended Agent/device, one-time enrollment material if used,
expiry and consumption, recovery from interrupted enrollment, and how the
first trust anchor is provisioned. An unknown Agent's first API request must
not create its own registration.

### 4.3 Identity binding and cardinality

Define credential-to-`agent.agents.id` mapping and prove tenant and Asset
binding at authentication/use time. Decide whether one Agent per Asset (the
current unique constraint), multiple concurrently registered Agents per
Asset, or a controlled replacement is intended. Define whether an Agent can
be registered before an Asset exists; current persistence requires an Asset
ID. Define re-enrollment and replacement without guessing based on hostname,
user assignment, or network attributes.

### 4.4 Issuance, storage, lifetime, and rotation

Specify who issues credentials, where enrollment/private-key material is
stored on the Agent and server/control plane, minimum cryptographic/profile
requirements, credential lifetime, renewal protocol, whether overlap is
allowed, exact old/new activation and retirement order, and recovery if
rotation fails. Define how a compromised Agent receives replacement
credentials and how its old credential is guaranteed unusable.

### 4.5 Revocation, disablement, and stolen credentials

Define the canonical revocation/disable operation and its authorization,
expected-version/idempotency, audit and durable state. Specify how quickly
revocation takes effect at every Gateway replica, whether verifier caches or
offline operation are allowed, maximum stale-acceptance window, and behavior
when the revocation source is unavailable. Define the response to suspected
credential theft, including disabling the Agent, preserving evidence, and
re-enrollment. Asset removal or deletion of historical Agent data is not a
revocation substitute.

### 4.6 Expiry and clock policy

If credentials expire, define their lifetime, renewal grace, clock tolerance,
expired-Agent behavior, and recovery without bypassing enrollment. If the
chosen credential has no intrinsic expiry, explicitly define compensating
rotation and revocation bounds.

### 4.7 Replay, freshness, and channel/session binding

Specify protocol-layer controls preventing reuse of captured credentials and
requests, including freshness, nonce/challenge, token/certificate binding,
or another established mechanism supported by the selected profile. Define
whether and how authenticated channel/session generation is persisted and
bound to heartbeat and Agent messages. Existing command receipt idempotency
remains necessary but is not authentication replay protection. Do not design
custom cryptography.

### 4.8 Request scope and authorization mapping

Define Agent principal type and minimum Gateway context, route/action scopes,
and policy for heartbeat, inventory, execution claim/accept/report, software
deployment/removal, wipe, and other existing Agent routes. Confirm which
routes are enabled for RELEASE-002. Specify checks for cross-Agent,
cross-tenant, wrong-Asset, wrong-execution and wrong-command requests. A valid
Agent credential must not authorize unrelated API access or arbitrary Asset
mutation.

### 4.9 Failures, audit, readiness, and operations

Define safe external failure codes for invalid, unknown, inactive, expired,
revoked, wrong-tenant, wrong-Asset, binding mismatch, replay, dependency
outage and abuse conditions. Define which enrollment, issuance, rotation,
revocation, identity/binding change and suspicious failure events are
audited, and which audit failures block the operation. Specify low-cardinality
metrics/logs without Agent ID labels, auth-component readiness criteria,
alerts, credential rotation ownership and incident runbooks. Distinguish
authentication readiness from RELEASE-003 aggregate worker readiness.

## 5. Acceptance contract to finalize

After decisions above are approved and encoded in a normative revision,
runtime acceptance must include at minimum:

- valid registered Agent accepted; unknown, unregistered, disabled, revoked
  and invalid credentials denied;
- credential expiry and rotation, overlap, revocation propagation and
  compromise/re-enrollment behavior tested as selected;
- registration tenant and Asset binding are authoritative; caller tenant or
  Asset claims cannot change them;
- human and Agent identity namespaces cannot cross-resolve;
- an Agent cannot claim or report another Agent's execution, including a
  same-tenant execution;
- replay/freshness and duplicate delivery are tested separately; command
  receipts remain durable and idempotent;
- production rejects mock/test/unavailable auth and missing or unsafe
  configuration; no fallback principal is created;
- credential material is absent from logs, audit, events and responses;
- enrollment and credential lifecycle audit, readiness and operational
  failure behavior meet the approved profile;
- late acceptance/heartbeat after TASK-091 `UNKNOWN` remains evidence only
  and does not resurrect execution;
- PostgreSQL integration, concurrency, gateway/API contract and E2E tests
  cover the selected profile.

## 6. Runtime authorization boundary

This R1 is planning only. It authorizes no schema migration, route,
credential adapter, enrollment command, authentication library, TLS change,
or TASK-091 behavior change. The current `unavailableAuthentication`
composition remains in place. RELEASE-002 stays `BLOCKED / NOT_STARTED`
until credential, enrollment and channel decisions are approved in a complete
contract revision. RELEASE-003 is not started by this planning item.
