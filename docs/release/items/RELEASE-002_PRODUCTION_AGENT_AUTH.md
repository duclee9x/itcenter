# RELEASE-002 — Production Agent Authentication for TASK-091

| Field        | Value                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Status       | `CODE_COMPLETE`                                                                                                                           |
| Readiness    | `N/A`                                                                                                                                     |
| Dependencies | None                                                                                                                                      |
| Blocker      | Runtime implementation is complete; real CA provisioning and mTLS through the RELEASE-007 staging topology remain unverified.             |
| Contract     | [RELEASE-002-R1 — Production Agent Authentication Contract](RELEASE-002-R1_PRODUCTION_AGENT_AUTHENTICATION_CONTRACT.md) (`CODE_COMPLETE`) |
| Report       | [RELEASE-002 implementation report](RELEASE-002_IMPLEMENTATION_REPORT.md)                                                                 |

## Purpose

Provide the production TASK-091 Agent Gateway with mutual-TLS authentication
for registered machine/device identities. Each Agent has its own CA-issued
X.509 client certificate and locally generated keypair. This is separate
from human OIDC in RELEASE-001. TASK-091 and the owning domain still authorize
the operation and bind it to the authenticated Agent, tenant, Asset/device,
execution and command.

## Runtime state

The production Agent Gateway now terminates TLS/mTLS directly and consumes
verified TLS peer certificates from the socket. It resolves the exact
server-issued URI SAN through tenant-scoped `AgentCredential` and canonical
`agent.agents` registration state; production configuration fails closed and
readiness includes the database, mTLS adapter and certificate issuer.

The migration adds retained credential lifecycle, single-use hashed
Enrollment Tokens, durable issuance attempts, server transport sessions and
per-session message receipts. Enrollment and self-rotation use an
`AgentCertificateIssuerPort` implemented by an OpenSSL adapter whose CA key
comes from file-backed secret references; only ephemeral CA material is used
in tests. Registration, enrollment-token issue/revoke, forced re-enrollment,
credential revoke and registration state changes require local permissions
and append audit/outbox evidence.

TASK-091 remains the execution owner. The authenticated Agent ID, tenant,
Asset and server transport session are checked before writes; existing
execution assignment/session checks and `UNKNOWN` late-evidence behavior are
preserved. No human OIDC, tenant header, bearer token, or client-supplied
identity header authenticates the Agent channel.

Automated implementation evidence is recorded in the linked report. Runtime
code deliberately does not claim production verification: the real private
CA and certificates must be provisioned, and mTLS must be exercised through
the RELEASE-007 staging topology before this item can become `VERIFIED`.

## Required boundary

R1 normatively fixes mTLS, the private Agent CA, pre-provisioned registration,
single-use Enrollment Token, certificate issuance/rotation/revocation,
server-derived tenant, session/message replay, and TASK-091 execution binding.
The production Gateway remains unavailable/not-ready unless mTLS, CA and
database trust are configured. Unknown clients cannot self-enroll;
host/network attributes cannot identify an Agent; an Agent cannot choose a
tenant.

## Release evidence required

Remaining release verification must prove real private-PKI provisioning and
mTLS through the intended staging/release topology, then retain evidence for
certificate rejection/rotation/revocation, production configuration,
session/message replay, exact TASK-091 binding, readiness and audit. Automated
acceptance results and their exact test files are listed in the report; they
do not substitute for staging evidence.
