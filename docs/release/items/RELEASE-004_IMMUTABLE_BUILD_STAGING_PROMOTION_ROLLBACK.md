# RELEASE-004 — Immutable Build / Staging / Promotion / Rollback Pipeline

| Field           | Value                                                                                |
| --------------- | ------------------------------------------------------------------------------------ |
| Status          | `READY / NOT_STARTED`                                                                |
| Readiness       | `READY`                                                                              |
| Blocker         | Cleared by RELEASE-004-R1                                                            |
| Overall release | `BLOCKED_FOR_RC`                                                                     |
| Contract        | [RELEASE-004-R1](RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md) |

## Objective

Establish a reproducible release artifact and a controlled staging-to-
production lifecycle for the API, Agent Gateway, and Worker deployables. Build
once from an identified clean commit, verify the immutable artifact in
staging, and promote that same artifact identity to production. Keep
environment configuration and secrets outside the artifact; gate migrations,
rollout, and production promotion; record provenance; and define safe
application rollback versus database forward-fix behavior.

## Current blocker

RELEASE-004-R1 now normatively selects Linux + Docker Engine + Compose v2,
one shared OCI image, Caddy for API HTTPS, operator-triggered deployment,
isolated Compose staging, a one-shot migration service, and exact-digest
promotion/rollback semantics. Runtime and pipeline implementation has not
started; the existing repository still has no production images, registry
configuration, deployment manifests, scripts, or staging environment.

RELEASE-004-R1 clears the operational-decision blocker and makes this item
`READY / NOT_STARTED`. Implement only this approved Compose v2 contract in the
separate RELEASE-004 implementation activity. RELEASE-005 remains
independent; RELEASE-006 and RELEASE-007 retain their declared dependencies on
RELEASE-004.

## Scope after the blocker is cleared

The eventual implementation is limited to the approved artifact, build,
staging, promotion, migration orchestration, rollout, provenance, and
application-recovery mechanism. It must preserve RELEASE-001 authentication,
RELEASE-002 Agent mTLS, and RELEASE-003 deployable readiness/drain contracts.
It does not implement backup/restore (RELEASE-005), migration compatibility
rehearsal (RELEASE-006), or edge TLS/rate limiting (RELEASE-007).

## Completion evidence

- Reproducible build from a clean commit and immutable artifact identity for
  each actual deployable.
- Build-once evidence proving the same digest is deployed to staging and
  promoted to production, with no production rebuild.
- Configuration/secret separation, provenance, registry retention, and
  authorized promotion evidence.
- A single controlled migration step using migration material from the same
  release; migration failure stops rollout.
- Readiness-gated rollout and deterministic staging smoke/security checks.
- Exact last-known-good application artifact rollback procedure, guarded by
  schema compatibility; database rollback is not claimed without RELEASE-006
  proof, with forward-fix behavior documented.
- Static/configuration tests for manifest, immutable reference, probes,
  required security modes, secret references, and deployment constraints.
- Full repository verification and an implementation report. `CODE_COMPLETE`
  does not imply `VERIFIED`; actual staging deployment and promotion evidence
  are required for verification.
