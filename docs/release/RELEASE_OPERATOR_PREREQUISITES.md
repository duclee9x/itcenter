# Release Operator Prerequisites

This file contains only operator-controlled inputs still missing for release
verification. It contains no credentials or secret values.

## OCI registry-backed RC

Provide the protected registry configuration required by the existing release
workflow:

- `OCI_REGISTRY`
- `OCI_REPOSITORY`
- protected `OCI_USERNAME` and `OCI_PASSWORD` in CI secret storage

Why: the local candidate is usable for inspection but is not a promotable RC
identity. RELEASE-004 deployment and all qualifying staging evidence require
one immutable repository digest plus RC metadata.

Validation:

```sh
podman pull "$OCI_REGISTRY/$OCI_REPOSITORY@sha256:<digest>"
podman inspect "$OCI_REGISTRY/$OCI_REPOSITORY@sha256:<digest>"
```

Blocks: RELEASE-004, then RELEASE-001/002/003/006/007 staging verification.

## Staging OIDC provider

Provide a real staging OIDC integration; do not use the mock adapter:

- issuer URL;
- API audience/client configuration;
- staging test identity and RFC9068 access token procedure;
- authorization/group mapping inputs;
- callback/origin values if the selected provider requires them.

Prepare the corresponding non-secret database setup for `IdentityLink`,
`TenantMembership`, tenant-local `User` and local RBAC permissions.

Validation:

```sh
deploy/scripts/verify-config.sh staging <resolved-runtime-env>
```

Then run the RELEASE-001 positive and negative token/tenant/RBAC matrix through
the staging edge.

Blocks: RELEASE-001 and the real RELEASE-003 readiness profile.

## Agent registration and client credential

Use the generated staging CA/client material with the existing certificate
issuer and create the staging `AgentRegistration` and `AgentCredential` records
for the test agent. Supply only protected runtime references to the gateway and
test client.

Validation: connect the test client through the forwarded Agent mTLS port and
run the RELEASE-002 binding, revocation and replay checks. The path must remain
direct TCP/mTLS and must not traverse Caddy.

Blocks: RELEASE-002 and relevant RELEASE-003/007 verification.

## Recovery escrow governance

Provide non-secret governed references for:

- the age recovery identity outside Lima;
- the Agent CA/private issuer material outside Lima;
- any additional RELEASE-005 recovery-critical secrets.

The staging files prepared by this bootstrap are evidence of staging material
placement only. They do not prove production custody or RELEASE-005 VERIFIED.

Validation: run the existing non-destructive escrow readiness check and record
presence/governance without reading or logging secret values.

Blocks: RELEASE-005 verification, RPO/RTO closure and RC approval.

## Public staging edge (optional local path already prepared)

For public ACME/production-like edge evidence, provide a staging hostname with
DNS resolving to the intended Lima/macOS path and the operator-controlled
certificate challenge/HTTPS reachability. The local independent Caddy TLS mode
can verify local HTTPS behavior without public DNS, but cannot prove public
ACME or external reachability.

Validation:

```sh
curl --resolve <staging-host>:443:<host-address> https://<staging-host>/health/live
nc -vz <host-address> <agent-mtls-port>
```

Blocks: public portion of RELEASE-007 verification and the corresponding
production-like edge evidence.

## Current local candidate reference

The bootstrap-only local candidate is recorded outside Git at the host-backed
verification path as `RC-LOCAL-7EA3001.json`. It is intentionally marked
`NOT_VERIFIED` and `NOT_PROMOTED`.
