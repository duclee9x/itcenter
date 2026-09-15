# RELEASE-007 — Production TLS Ingress + Rate Limiting

| Field      | Value                                                                          |
| ---------- | ------------------------------------------------------------------------------ |
| Status     | `READY / NOT_STARTED`                                                          |
| Contract   | [RELEASE-007-R1](RELEASE-007-R1_PRODUCTION_EDGE_TLS_RATE_LIMITING_CONTRACT.md) |
| Dependency | RELEASE-004                                                                    |
| Runtime    | Lima VM, rootless Podman, `podman compose`                                     |
| Topology   | Caddy → API; Agent → direct TCP/mTLS → Agent Gateway                           |

RELEASE-007-R1 is complete. The implementation run must add Caddy TLS and
redirect configuration, API middleware rate limiting, bounded request and
upstream timeouts, trusted one-hop forwarding behavior, production security
headers, isolated staging/production certificate state, validation and edge
smoke tests. Agent mTLS remains a direct Gateway path and must never be
converted into Caddy HTTP proxying.

The implementation remains `SINGLE_HOST / NO_HA`. It must preserve RELEASE-001
authentication, RELEASE-002 certificate identity, RELEASE-003 readiness, and
RELEASE-004 Podman/Lima deployment semantics. `CODE_COMPLETE` will require
automated/static checks and documentation; `VERIFIED` requires actual
production-like staging TLS, Lima forwarding, HTTPS, rate-limit and direct
mTLS evidence.
