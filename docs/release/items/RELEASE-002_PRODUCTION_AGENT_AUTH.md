# RELEASE-002 — Production Agent Authentication for TASK-091

| Field        | Value                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Status       | `READY / NOT_STARTED`                                                                                                                     |
| Readiness    | `READY`                                                                                                                                   |
| Dependencies | None                                                                                                                                      |
| Blocker      | None. Production Agent Gateway remains fail-closed until RELEASE-002 is implemented and verified.                                         |
| Contract     | [RELEASE-002-R1 — Production Agent Authentication Contract](RELEASE-002-R1_PRODUCTION_AGENT_AUTHENTICATION_CONTRACT.md) (`CODE_COMPLETE`) |

## Purpose

Provide the production TASK-091 Agent Gateway with mutual-TLS authentication
for registered machine/device identities. Each Agent has its own CA-issued
X.509 client certificate and locally generated keypair. This is separate
from human OIDC in RELEASE-001. TASK-091 and the owning domain still authorize
the operation and bind it to the authenticated Agent, tenant, Asset/device,
execution and command.

## Repository evidence

- `apps/agent-gateway/src/main.ts` currently wires
  `unavailableAuthentication`; the gateway remains fail-closed in production.
- `apps/agent-gateway/src/server.ts` authenticates Agent routes through the
  generic `AuthenticationPort` Bearer-token interface. Handlers derive the
  Agent ID and tenant from the resulting principal.
- `agent.agents` stores a UUID Agent ID, tenant, required Asset ID, status,
  and legacy enrollment-token hash/expiry fields. The current unique
  `(tenant_id, asset_id)` constraint permits one registration per Asset and
  tenant.
- Agent runtime/session IDs and last-seen time are mutable latest reported
  values. They are not proof of credential identity or authenticated channel
  generation.
- TASK-091 binds claim, accept and report to the authenticated Agent and
  tenant. Durable command receipts deduplicate by tenant, Agent and command;
  same-command content conflicts are rejected. Late evidence may be recorded
  after `UNKNOWN`, but cannot resurrect the execution.
- No production credential issuance, rotation, revocation, enrollment trust,
  certificate validation, workload identity adapter, or Agent auth readiness
  implementation is present.

## Required boundary

R1 normatively fixes mTLS, the private Agent CA, pre-provisioned registration,
single-use Enrollment Token, certificate issuance/rotation/revocation,
server-derived tenant, session/message replay, and TASK-091 execution binding.
Until runtime implementation is complete, Agent execution remains unavailable.
Unknown clients cannot self-enroll; host/network attributes cannot identify
an Agent; an Agent cannot choose a tenant.

## Release evidence required

Acceptance must prove registration/enrollment, mTLS certificate validation,
tenant/Asset and execution binding; invalid, unknown, expired and revoked
credentials; rotation/re-enrollment; replay and duplicate delivery;
production rejection of test adapters; fail-closed configuration/provider
behavior; credential secrecy; audit and operational readiness; and
preservation of TASK-091 `UNKNOWN` and late-evidence semantics. Real private
PKI provisioning and mTLS validation through staging are required before this
release item can be `VERIFIED`.
