# RELEASE-004-R1 — Immutable Artifact & Deployment Promotion Contract

| Field                      | Value                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Scope                      | Planning and operational decision record only                                                            |
| Status                     | `CODE_COMPLETE` — repository gap and required decisions recorded; deployment contract remains incomplete |
| RELEASE-004                | `BLOCKED / NOT_STARTED`                                                                                  |
| Blocker                    | `SPEC_GAP / OPERATIONAL_DECISION`                                                                        |
| Release decision           | `BLOCKED_FOR_RC`                                                                                         |
| Runtime / pipeline changes | None authorized by R1                                                                                    |

## Purpose and boundary

RELEASE-004 cannot safely implement a deployment pipeline until the artifact,
registry, target environments, migration gate, rollout, promotion authority,
and recovery mechanism have approved operational choices. This R1 records the
repository evidence, the non-negotiable release invariants, and the decisions
that must be resolved before RELEASE-004 becomes `READY`.

This is a planning record, not an implementation recipe. It does not select a
container orchestrator, registry, secret manager, signing service, CI provider
integration, or production topology. It authorizes no runtime, CI, container,
manifest, migration, or deployment change. RELEASE-005, RELEASE-006, and
RELEASE-007 remain outside this item.

## Repository reconciliation at `bead89f`

The repository has three production deployables: API (`apps/api`), Agent
Gateway (`apps/agent-gateway`), and Worker (`apps/worker`). Each has an npm
start script; the root `npm run build` runs TypeScript compilation and copies
contracts to `dist/`. It does not produce a production deployment artifact.
The deployable package manifests do not define separate production build or
container commands.

The only container file found is `infra/docker/compose.yaml`, which starts a
local PostgreSQL instance for development. No API, Agent Gateway, or Worker
Dockerfile/Containerfile, OCI build, Kubernetes/Helm/Kustomize/GitOps manifest,
staging environment, production environment, or deployment target is present.
The existing `.github/workflows/ci.yml` runs verification and uploads `dist/`,
contracts, migrations, and package manifests as a GitHub Actions artifact. It
does not publish an image to a registry or deploy/promote/rollback an
environment. GitHub Actions is therefore the current CI verification provider,
but no release deployment authorization or credentials are configured here.

`npm run db:migrate` invokes the repository migration runner. The runner uses
the ordered migration manifest, a PostgreSQL advisory lock, per-migration
transactions, and a checksum ledger. There is no release-owned migration job
or declared ordering relative to application rollout. Database configuration
is supplied through `DATABASE_SECRET_REF` (including environment/file-backed
references); no production secret manager or Agent CA/PKI delivery integration
is selected. RELEASE-003 implements deployable-specific health/readiness and
drain behavior in the applications, but no orchestrator currently wires those
probes or shutdown semantics. No current mechanism promotes one artifact
unchanged or records a last-known-good deployment set.

The existing RC checklist proposes build-once, immutable digest, provenance,
staging checks, promotion, and forward-fix behavior. It is a future checklist,
not a selected artifact, registry, deployment, authorization, migration, or
rollback contract. RELEASE_READINESS.md likewise describes remediation goals,
not a deployable topology.

## Invariants for a future RELEASE-004 implementation

The following requirements are already authorized by the RELEASE-004 scope and
must be preserved when the operational decisions below are made:

- Build from a clean, identified Git commit using lockfiles, deterministic
  dependency installation, and explicit runtime/build versions. One source
  commit produces an immutable artifact set; promote the same digest(s) from
  staging to production without rebuilding.
- Separate deploy-time environment configuration and secret references from
  the artifact. Never bake database credentials, OIDC secrets/configuration,
  Agent CA private keys, or environment-specific endpoints/data into artifacts.
- A production release record identifies the source commit, artifact digest
  set, build provenance, schema revision, environment/config revision,
  staging evidence, promotion actor, and timestamps. Public health responses
  remain free of sensitive configuration.
- The migration input comes from the same release artifact/source provenance.
  Exactly one controlled deployment step owns migrations; migration failure
  blocks application rollout. Readiness does not run migrations.
- API, Agent Gateway, and Worker retain their RELEASE-003 readiness profiles,
  startup and drain behavior. Unready instances receive no normal traffic;
  health failure in one deployable does not couple unrelated deployables.
- Production promotion requires the approved staging gate and an explicit
  authorized promotion control. Preserve RELEASE-001 OIDC/X-Tenant-ID/RBAC and
  RELEASE-002 mTLS/credential/session semantics without test or bypass modes.
- Application rollback targets an exact previously deployed immutable digest
  set and is allowed only when the currently applied schema is compatible.
  Database rollback is not assumed. When the previous application cannot run
  safely against the current schema, use a new immutable forward-fix release.
- Worker rollout retains the 13-worker RELEASE-003 inventory and durable
  `CONCURRENT_SAFE` coordination. No in-memory leader election is implied.
- SBOM, signature, and supply-chain provenance claims require recorded evidence
  and an approved tool/key custody path; unmanaged signing keys are forbidden.

## Decisions required before RELEASE-004 is READY

| Decision                                           | Current repository evidence                                                                                                         | Required approved outcome                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical artifact format and deployable packaging | `npm run build` emits build output; there are no application images or packages designated as release artifacts.                    | Select the canonical immutable artifact format, whether the three deployables are separate artifacts, and how runtime/migrations are packaged. OCI digest is preferred by the release request but not yet adopted as repository policy.                   |
| Registry and immutability/retention                | No registry configuration or credentials.                                                                                           | Name the registry/repository model, enforce digest-based deployment, define immutable identity and retention for deployed/rollback artifacts.                                                                                                             |
| Staging and production targets/topology            | No environment definitions or deployment manifests.                                                                                 | Select the deployment target and define production-like staging and production topology for API, Agent Gateway, Worker, PostgreSQL, and ingress boundaries.                                                                                               |
| Build/publish/deploy trust boundaries              | GitHub Actions currently verifies and uploads a build artifact only.                                                                | Define trusted-branch/commit rules, clean-tree provenance, permissions for build, publish, staging deploy, and production promotion; keep production authority away from untrusted pull-request contexts.                                                 |
| Promotion authorization and evidence               | RC checklist names reviewers but no protected environment, approval mechanism, or release record is implemented.                    | Define who/what may approve a digest, required staging evidence, promotion record format, and idempotent retry semantics.                                                                                                                                 |
| Configuration and secret/PKI delivery              | App configuration accepts secret references; no production secret manager or PKI integration is selected.                           | Select the deployment-time config/version mechanism and secret/Agent CA delivery path, including access boundaries and safe rotation; do not place values in Git, artifacts, or logs.                                                                     |
| Migration ownership and ordering                   | `db:migrate` and an advisory-lock runner exist, but no release job or rollout ordering is defined.                                  | Specify the single migration owner/job, artifact provenance, database roles, exact pre-rollout/rollout order, failure stop behavior, and state recorded after partial migration progress.                                                                 |
| Rollout and capacity policy                        | Readiness/drain exists in runtime, but no orchestrator or rollout strategy is configured.                                           | Select the orchestration-native rollout, probe wiring, startup/drain bounds, resource policy, and old/new worker overlap policy consistent with schema constraints.                                                                                       |
| Staging smoke gate                                 | RC checklist has proposed checks; no executable staging workflow or verification record exists.                                     | Define deterministic non-destructive smoke/acceptance checks and the exact evidence threshold required before production promotion, including real OIDC and mTLS paths.                                                                                   |
| Rollback and forward-fix authority                 | No deployment rollback mechanism/runbook exists; migration runner has no down-migration mechanism.                                  | Define who can initiate application rollback, how the exact last-known-good digest set and schema compatibility are checked, when rollback is prohibited, and how forward-fix is authorized. Do not claim database rollback without RELEASE-006 evidence. |
| Release provenance and version metadata            | CI artifact is named `bootstrap-build`; no release/RC identity, OCI digest, runtime build metadata, or config revision is recorded. | Define RC/release identity, digest-to-SBOM/provenance relationship, safe runtime diagnostic fields, and the durable location/owner for promotion history.                                                                                                 |
| Artifact signing/SBOM policy                       | RC checklist says signature/SBOM “where the chosen platform supports them”; no policy or mechanism is selected.                     | Decide whether signing and SBOM are mandatory for this release, approved tools/identity/key custody, verification point, and failure behavior. Never introduce unmanaged CI signing keys.                                                                 |

These are operational decisions, not implementation details for an engineer to
guess. Until the relevant release, security, platform, and database owners
approve them and the normative release documents are updated, RELEASE-004
remains blocked. Any later architecture change must preserve the invariants
above and must not broaden RELEASE-004 into RELEASE-005/006/007.

## Release state

R1 records the discovered contract gap as a completed planning artifact. It
does not clear the gap. RELEASE-004 is `BLOCKED / NOT_STARTED` with blocker
`SPEC_GAP / OPERATIONAL_DECISION`; RELEASE-005 remains independently
`READY / NOT_STARTED`; RELEASE-006 and RELEASE-007 remain
`WAITING_DEPENDENCY` on RELEASE-004 (and RELEASE-005 for RELEASE-006).
RELEASE-001 through RELEASE-003 remain `CODE_COMPLETE / NOT VERIFIED`, and the
overall release remains `BLOCKED_FOR_RC`.
