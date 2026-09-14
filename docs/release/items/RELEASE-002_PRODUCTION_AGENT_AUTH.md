# RELEASE-002 — Production Agent Authentication for TASK-091

| Field          | Value                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Status         | `BLOCKED / NOT_STARTED`                                                                                                              |
| Readiness      | `BLOCKED`                                                                                                                            |
| Dependencies   | None                                                                                                                                 |
| Blocker        | `SECURITY_DECISION / SPEC_GAP`: Agent credential, enrollment, lifecycle, and channel-binding semantics are not normatively selected. |
| Planning child | [RELEASE-002-R1 — Production Agent Authentication Contract](RELEASE-002-R1_PRODUCTION_AGENT_AUTHENTICATION_CONTRACT.md)              |

## Purpose

Provide the production TASK-091 Agent Gateway with authentication for
registered machine/device identities. This is separate from the human OIDC
API adapter in RELEASE-001. A valid Agent identity proves who sent a request;
TASK-091 and the owning domain still authorize the operation and bind it to
the authenticated Agent, tenant, Asset/device, execution and command.

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

Until RELEASE-002 has an approved production profile and runtime verification,
Agent execution remains unavailable. An unknown Agent may not self-enroll.
Agent identity, tenant, and Asset binding must come from canonical registered
records; a request body, hostname, address, or caller-selected tenant cannot
establish them. Authentication does not grant permission to acknowledge a
different Agent's execution or mutate unrelated domain state.

The generic authentication choices in `API_COMMAND_CONTRACT_SPEC.md` are not
an Agent credential decision. The selected mechanism, trust bootstrap,
credential lifecycle, replay resistance, transport assumptions, failure
behavior and operational readiness must be fixed by R1 before runtime work.

## Release evidence required

After R1 is resolved and runtime work is separately authorized, acceptance
must prove registered identity, tenant/Asset and execution binding; invalid,
unknown, expired and revoked credentials; rotation/re-enrollment; replay and
duplicate delivery; production rejection of test adapters; fail-closed
configuration/provider behavior; credential secrecy; audit and operational
readiness; and preservation of TASK-091 `UNKNOWN` and late-evidence semantics.
Real credential provisioning and staging validation are required before this
release item can be `VERIFIED`.
