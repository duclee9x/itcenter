# RELEASE-007-R1 — Production Edge TLS & Rate Limiting Contract

| Field          | Value                                                |
| -------------- | ---------------------------------------------------- |
| Status         | `CODE_COMPLETE`                                      |
| Parent item    | `RELEASE-007`                                        |
| Current status | `READY / NOT_STARTED`                                |
| Blocker        | None                                                 |
| Runtime        | Lima VM, rootless Podman, `podman compose`           |
| Topology       | Caddy → API; Agent → direct TCP/mTLS → Agent Gateway |

## Purpose

This document fixes the v1 edge security and operational decisions for
RELEASE-007. It does not implement Caddy, Compose, application, or Agent
Gateway changes.

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

## Normative v1 decisions

### Certificate ownership and lifecycle

Caddy owns production certificate lifecycle through Caddy-supported automatic
public ACME issuance with an operator-configured hostname and DNS. Caddy
certificate/account state persists in a protected production Podman volume,
isolated from staging. Operator-provisioned certificate/key files are an
explicit alternative mode, mounted externally read-only where possible. ACME
failure while the installed certificate remains valid continues serving HTTPS
and raises an operational failure; expiry or missing TLS material makes the
API unavailable. Plaintext fallback is forbidden. Staging uses an independent
Caddy internal/local CA or staging ACME hostname.

### HTTPS and port ownership

Production guest port `80` is redirect-only and guest port `443` is the API
HTTPS edge. Lima forwards these guest ports to operator-selected macOS host
ports. Agent Gateway's dedicated TCP/mTLS port is forwarded independently and
is never sent through Caddy HTTP routing. PostgreSQL and the raw API HTTP port
remain private.

### Trusted proxy and forwarded headers

Caddy is the only trusted reverse proxy and exactly one application proxy hop
is trusted. Caddy normalizes `X-Forwarded-For`, `X-Forwarded-Proto`, and
`X-Forwarded-Host`; public client-supplied forwarding values are discarded or
replaced. API client IP, used by the limiter, is accepted only through that
bounded boundary. Forwarded metadata never grants auth, tenant, RBAC, or
Agent identity.

### Rate-limit policy

Rate limiting is enforced by API middleware behind Caddy, using an in-memory
per-process token-bucket or equivalent implementation. The key is trusted
client IP. The general `/api/v1/*` bucket is 300 requests per 60 seconds with
a 100-request burst. `POST`, `PUT`, `PATCH`, and `DELETE` under `/api/v1/*`
also require a 60 requests per 60 seconds bucket with a 20-request burst.
Both buckets apply to mutations. A hit returns `429` and `Retry-After` where
practical. Health endpoints are exempt for trusted local probes and may have a
generous abuse ceiling when public. The authenticated capabilities endpoint
uses the normal API bucket. Limits are local to the single API process; no
distributed/global guarantee or Redis dependency exists.

### Request size and proxy timeouts

The production edge request-body limit is 2 MiB for ordinary JSON/API
requests. Repository inspection found no raw upload/import route requiring a
larger public body, so there is no v1 exception. Oversized requests return
`413`. The upstream connect timeout is 5 seconds, response-header timeout is
30 seconds, and the normal request/upstream budget is 60 seconds. Long-running
work must use existing asynchronous workflows rather than an unlimited proxy
timeout.

### Security headers and CORS

Production API responses add `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`. HSTS is
production-only with `max-age=86400`, without `includeSubDomains` or
`preload`. CSP is not added because this edge serves an API, and CORS remains
application-owned; Caddy never adds wildcard authenticated CORS.

### Failure and verification policy

Deployment validates Caddy configuration before switching edge state and fails
without replacing a known-good configuration when validation fails. Staging
must test TLS trust, HTTP redirect, 429 behavior for both buckets, 2 MiB body
rejection, forwarded-header spoofing, protected capabilities, health paths,
direct Agent mTLS, and raw API/PostgreSQL exposure before RELEASE-007 can be
`VERIFIED`.

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

## Operational cleanup rule

RELEASE-007 implementation and rehearsal work must clean task-owned temporary
containers, images, networks, volumes, Compose projects, scratch files,
generated test certificates, and temporary logs on success and failure. Use
deterministic `itsm-release007-test-*` or `itsm-edge-test-*` names. Never run
global prune and never delete release artifacts, LKG/current images, backup or
evidence data, persistent staging/production volumes, or unrelated user files.
Report `podman system df` where Podman was used.

## Completion

The edge contract is internally consistent. RELEASE-007 is `READY /
NOT_STARTED`; implementation is a separate authorized run. RELEASE-GATE-001
must not start automatically.
