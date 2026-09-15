# RELEASE-007 Implementation Report

Status: `CODE_COMPLETE / NOT VERIFIED`

RELEASE-007 implements the R1 edge boundary. Caddy is the only public HTTP
proxy for the API. Production selects automatic ACME mode with persistent
`caddy_data`; staging selects an isolated Caddy internal CA; an explicit manual
certificate override is available without putting private keys in the image or
repository.

The API stays private on the Compose network. Caddy enforces the 2 MiB body
limit, HTTP-to-HTTPS redirect, production HSTS, security headers, and bounded
upstream timeouts. API middleware applies trusted-client-IP token buckets of
300/60 seconds plus burst 100 generally and 60/60 seconds plus burst 20 for
mutations. Buckets expire and are bounded. Health probes bypass quotas;
capabilities remains authenticated and rate limited.

Forwarded client metadata is trusted only through the private immediate Caddy
hop. Agent Gateway remains a separately published direct TLS/mTLS TCP path; no
Caddy HTTP route or certificate-header authentication was added. PostgreSQL,
raw API HTTP, worker, and the Podman socket are not public host bindings.

Deployment validates the selected Caddy file before rollout and smoke can check
the configured HTTP redirect. Staging and production select independent Caddy
files, ports, Compose projects and persistent Caddy state. The Lima guide
documents that guest published ports still require Lima/macOS forwarding.

Automated evidence covers edge policy, bounded limiter state, forwarded-header
spoof protection, body limits, Caddy/Compose topology and deployment hooks.
`CODE_COMPLETE` does not assert `VERIFIED`: real staging DNS/certificate,
Lima forwarding, public HTTPS smoke and direct Agent mTLS remain operational
verification work. RELEASE-004/005/006 remain `CODE_COMPLETE / NOT VERIFIED`.
