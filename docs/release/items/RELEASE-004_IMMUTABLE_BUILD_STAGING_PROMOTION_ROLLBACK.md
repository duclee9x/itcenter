# RELEASE-004 — Immutable Build / Staging / Promotion / Rollback Pipeline

| Field           | Value                                                                                |
| --------------- | ------------------------------------------------------------------------------------ |
| Status          | `BLOCKED / NOT_STARTED`                                                              |
| Readiness       | `BLOCKED`                                                                            |
| Blocker         | `SPEC_GAP / OPERATIONAL_DECISION`                                                    |
| Overall release | `BLOCKED_FOR_RC`                                                                     |
| Contract gap    | [RELEASE-004-R1](RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md) |

## Objective

Establish a reproducible release artifact and a controlled staging-to-
production lifecycle for the API, Agent Gateway, and Worker deployables. Build
once from an identified clean commit, verify the immutable artifact in
staging, and promote that same artifact identity to production. Keep
environment configuration and secrets outside the artifact; gate migrations,
rollout, and production promotion; record provenance; and define safe
application rollback versus database forward-fix behavior.

## Current blocker

The repository currently contains a TypeScript build, a verification-only
GitHub Actions workflow, a local PostgreSQL Compose file, and a standalone
migration command. It contains no production deployable images, registry,
staging/production deployment target, manifests, promotion authorization path,
or rollback runbook. The existing release checklist states goals but does not
resolve the operational choices required to implement them.

RELEASE-004-R1 records repository evidence, fixed release invariants, and the
operational decisions that must be approved. Do not start runtime or pipeline
implementation until those decisions are normative and the blocker is
cleared. RELEASE-005 remains independent; RELEASE-006 and RELEASE-007 retain
their declared dependencies on RELEASE-004.

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
