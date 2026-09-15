# RELEASE-007-R1 — Production Edge TLS & Rate Limiting Contract

| Field          | Value                                                |
| -------------- | ---------------------------------------------------- |
| Status         | `CODE_COMPLETE / PLANNING_ONLY`                      |
| Parent item    | `RELEASE-007`                                        |
| Current status | `BLOCKED / NOT_STARTED`                              |
| Blocker        | `SPEC_GAP / SECURITY_DECISION`                       |
| Runtime        | Lima VM, rootless Podman, `podman compose`           |
| Topology       | Caddy → API; Agent → direct TCP/mTLS → Agent Gateway |

## Purpose

RELEASE-007 cannot safely change the edge configuration until the following
security and operational decisions are explicit. This document records the
gap and the facts found during state recovery. It does not implement Caddy,
Compose, application, or Agent Gateway changes.

## Reconciled current topology

- API listens on internal container port `3000`.
- Agent Gateway listens on internal TLS/mTLS port `3001`.
- Production currently publishes Caddy guest ports `80` and `443`, and the
  dedicated Agent Gateway TCP port `3001`.
- Staging currently publishes Caddy guest ports `18080` and `18443`, and
  Agent Gateway port `13001`.
- The current Caddyfile only declares `${API_HOSTNAME}`, mounts the external
  API certificate/key, and proxies to `api:3000`.
- Caddy has no checked-in HTTP redirect, rate-limit policy, request-body
  policy, security-header policy, or bounded upstream timeout policy.
- API TLS material is supplied as external Compose secrets. No private key is
  committed or placed in the application image.
- Agent Gateway uses its own TLS listener and certificate authentication. It
  must remain outside normal Caddy HTTP proxying.
- The production API raw port is private to the Compose network; Caddy is the
  intended public API edge. PostgreSQL has no public Compose port.
- The application has public/simple liveness and readiness paths and keeps
  `/api/v1/health/capabilities` behind RELEASE-001 authentication.
- Node HTTP servers already use 10-second request and header timeouts, while
  route body parsers are inconsistent: some cap JSON at 64 KiB and others do
  not provide one uniform edge limit.
- The application does not establish a completed trusted-proxy policy for
  arbitrary client-supplied `X-Forwarded-*` or `Forwarded` values.

## Decisions required before implementation

### Certificate ownership and lifecycle

Choose and record the production certificate source:

- Caddy-managed ACME with approved DNS/domain automation; or
- operator-provisioned certificate/key mounted from protected external secret
  storage.

The decision must define renewal, persistent Caddy state, staging
certificate/domain isolation, expiry failure behavior, and whether HSTS is
enabled after production HTTPS is stable. Missing certificate configuration
must fail closed; plaintext API fallback is forbidden. Staging may use an
approved local/internal certificate mode but must not reuse production private
material.

### HTTPS and port ownership

Confirm that production port `80` is redirect-only and port `443` is the API
HTTPS edge. Confirm the Lima guest-to-macOS forwarding required to expose
guest `80/443` safely under rootless Podman. Confirm that Agent Gateway's
dedicated TCP/mTLS port is forwarded independently and is never sent through
Caddy HTTP routing.

### Trusted proxy and forwarded headers

Define the exact trusted boundary: Caddy is the only trusted reverse proxy for
API traffic. Define which normalized headers Caddy sets, which application
addresses are trusted, and how public client-supplied `X-Forwarded-For`,
`X-Forwarded-Proto`, `X-Forwarded-Host`, and `Forwarded` values are discarded
or replaced. Define whether client IP is used for rate limiting, audit, or
logs, and the privacy/retention rule for that value.

### Rate-limit policy

The API contract requires rate limiting and `429`/`Retry-After`, but does not
define numeric production limits. Approve a small policy for:

- general API traffic;
- authentication-sensitive or unauthenticated traffic that actually exists;
- expensive or bulk/mutating traffic;
- health endpoints used by local readiness checks.

For each group define the counting key, window/algorithm, burst behavior,
response headers, staging override mechanism, and whether the policy is
per-Caddy-instance. Redis or a distributed limiter is not required for the
single-host v1 unless explicitly chosen.

### Request size and proxy timeouts

Define the maximum edge request body and any endpoint exceptions required by
current upload/import flows. Define header limits and upstream read/write/
idle timeouts. The values must be compatible with the existing application
body parsers and Node 10-second request/header timeout behavior. No runtime
number may be invented solely while editing Caddy.

### Security headers and CORS

Define the baseline headers appropriate to this API. Decide whether the
instance serves a browser UI, which determines whether CSP, frame policy and
CORS are needed. If HSTS is enabled, define the exact production hostname
scope and explicitly exclude preload/subdomain-wide policy unless separately
approved. Caddy must not add wildcard authenticated CORS.

### Failure and verification policy

Define whether invalid Caddy configuration is validated before rollout and
how known-good edge state is retained on failure. Define the staging smoke
requirements for TLS trust, HTTP redirect, 429 behavior, body rejection,
forwarded-header spoofing, protected capabilities, health endpoints, direct
Agent mTLS, and raw API/PostgreSQL exposure. Define the acceptance evidence
needed before RELEASE-007 becomes `VERIFIED`.

## Non-negotiable boundaries already fixed

- Caddy terminates API HTTPS only.
- Agent client certificates terminate at Agent Gateway itself; certificate
  headers are never an authentication substitute.
- API authentication and tenant/RBAC remain RELEASE-001 behavior.
- Agent authentication and credential binding remain RELEASE-002 behavior.
- Readiness and drain semantics remain RELEASE-003 behavior.
- Podman/Lima and Compose remain the runtime; no Kubernetes, ingress
  controller, service mesh, Docker Engine, CDN, WAF, or HA proxy is added.
- The deployment remains `SINGLE_HOST / NO_HA`; edge rate limits do not claim
  DDoS protection.

## Exit condition

After the decisions above are approved and persisted, update the parent item to
`READY / NOT_STARTED`, clear `SPEC_GAP / SECURITY_DECISION`, and implement
RELEASE-007 in a separate run. Until then, no Caddy or Compose runtime change
is authorized by this contract.
