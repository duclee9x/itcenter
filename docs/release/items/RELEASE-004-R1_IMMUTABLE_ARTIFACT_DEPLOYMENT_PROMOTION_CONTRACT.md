# RELEASE-004-R1 — Immutable Artifact & Deployment Promotion Contract

| Field                      | Value                                                   |
| -------------------------- | ------------------------------------------------------- |
| Scope                      | Planning and deployment contract only                   |
| Status                     | `CODE_COMPLETE`                                         |
| RELEASE-004                | `READY / NOT_STARTED`                                   |
| Blocker                    | Cleared: `SPEC_GAP / OPERATIONAL_DECISION`              |
| Overall release            | `BLOCKED_FOR_RC`                                        |
| Runtime / pipeline changes | None; implementation is a separate RELEASE-004 activity |

## 1. Purpose and boundary

This contract fixes the v1 artifact, host deployment, staging, migration,
promotion, and recovery model for RELEASE-004. The production target is a
Linux server or VM running Docker Engine and Docker Compose v2. Docker Compose
is the canonical deployment mechanism. The v1 design is a single-host,
non-HA deployment optimized for operational simplicity.

This is planning/specification work only. It adds no runtime code, image,
Compose file, CI workflow, deployment script, migration, or production secret.
RELEASE-005 backup/restore, RELEASE-006 migration rehearsal, and RELEASE-007
edge hardening remain separate release items.

## 2. Repository reconciliation

The actual deployables are API (`apps/api`), Agent Gateway
(`apps/agent-gateway`), and Worker (`apps/worker`). The root TypeScript build
compiles all three and shared `packages/` and `modules/` into one `dist/`
tree; `scripts/copy-contracts.mjs` copies the shared contracts. Their entry
points are `dist/apps/api/src/main.js`,
`dist/apps/agent-gateway/src/main.js`, and `dist/apps/worker/src/main.js`.
The migration runner is compiled into the same tree at
`dist/database/scripts/migrate.js`, and SQL migrations are data files under
`database/migrations/`. One OCI image can therefore safely serve all three
processes and the one-shot migration command by using different Node entry
commands. V1 uses one shared image; the evidence does not justify splitting
images by process.

The existing CI provider is GitHub Actions. Its current workflow verifies and
uploads build output but does not build/push an OCI image or deploy. The
existing `infra/docker/compose.yaml` is local PostgreSQL development setup.
No production deployment topology or registry was configured before this R1.
Applications already expose RELEASE-003 health at
`GET /api/v1/health/live` and `GET /api/v1/health/ready`; their container
defaults are API port 3000, Agent Gateway port 3001, and Worker health port 3002. Agent Gateway itself terminates TLS client authentication. Runtime
configuration already accepts protected file references for database and
Agent TLS/CA materials. Migrations run through the built migration runner,
which uses the ordered manifest, checksums, PostgreSQL advisory lock, and a
transaction per migration.

## 3. Canonical build artifact and provenance

The canonical artifact is one OCI image for the shared compiled runtime. CI
builds it once from a clean, immutable Git commit after required verification.
The production server pulls the image; it never checks out application source
to build, runs `npm install`, runs `npm run build`, or invokes `docker build`.

The immutable deployment identity is `image@sha256:<digest>`. Git-SHA, RC, and
release tags are human-readable aliases only; mutable tags are never the
production identity. An environment may change Compose values, secret files,
ports, or process count without changing the artifact digest. Source or build
input changes produce a new artifact.

GitHub Actions is the existing CI provider and owns VERIFY, OCI BUILD, PUSH,
digest capture, and RC metadata creation. Use a normal OCI registry supported
by that provider, with a private repository where required. Keep the contract
registry-vendor-neutral. CI push and host pull credentials are external
secrets; the host credential is read-only. Retain all artifacts referenced by
staging, production, or last-known-good release metadata.

Each RC record is committed under `release/rc/<id>.json` and contains at least
the release id, Git commit, shared image digest, schema/migration manifest
revision, build time, provenance reference, SBOM reference/status, staging
status/evidence, production status, configuration revision/reference,
approver/operator identity, and timestamps. It contains no secret values.
Runtime diagnostics may expose safe version, commit, build time, and digest
through protected capabilities; public health remains minimal.

Build provenance is required and must tie commit, workflow invocation,
lockfile state, build time, and image digest. Generate and associate an SBOM
using standard tooling supported by the selected CI/registry path. The
repository contains no normative artifact-signing requirement or signing
service; v1 does not claim signed images or introduce a signing key. A later
mandatory signing policy must use approved managed key custody and be recorded
as a security-policy change before implementation.

## 4. Shared image and Compose topology

The deployment source is version-controlled under this structure, with exact
filenames following the repository convention:

```text
deploy/
  compose.yaml
  compose.staging.yaml
  compose.production.yaml
  env/
    staging.example
    production.example
  scripts/
    deploy.sh
    smoke.sh
    rollback.sh
```

Use a base Compose definition plus concise environment overrides. The same
digest configures the `api`, `agent-gateway`, `worker`, and one-shot `migrate`
services; their commands select the corresponding compiled entry point. The
production stack includes a lightweight Caddy reverse proxy for API HTTPS. It
routes API requests and applies basic proxy headers; RELEASE-007 owns full
edge hardening. Agent clients connect directly to the dedicated Agent Gateway TLS/mTLS port;
the reverse proxy does not terminate or forward Agent client identity.
PostgreSQL may be a `postgres` Compose service or an external PostgreSQL
service. Both modes are supported by configuration; a Compose-managed
database uses a named persistent volume and an internal network, with no
public bind by default.

API listens internally on 3000 behind Caddy. Agent Gateway listens internally
on 3001 and is published on its dedicated configurable host port, directly to
that TLS listener. Worker runs independently and serves health on 3002; it is
not routed through the public reverse proxy. Bind application listeners to
the container interface only inside the Compose network. Expose only the
reverse-proxy ports, the dedicated Agent mTLS port, and restricted host
administration. PostgreSQL is not public. RELEASE-007 later finalizes ingress
TLS lifecycle, rate limits, headers, and edge restrictions.

The expected steady state is one API, one Agent Gateway, and one Worker
process. Compose does not auto-scale. All 13 Worker pollers retain the
RELEASE-003 `CONCURRENT_SAFE` durable database coordination contract; no
leader-election mechanism is introduced. The single-process default is not an
HA claim.

## 5. Environment isolation and secrets

Staging defaults to a separate Compose project on the same Docker host, with
project name `itsm-staging`; production uses stable project name
`itsm-production`. An operator may place staging on a separate VM without
changing the artifact. Same-host staging must use distinct project networks,
volumes, host ports, PostgreSQL database/schema and roles, secret files,
OIDC client/configuration, and Agent CA/certificates. It uses no production
credentials or production data. Staging external ports bind to loopback or
otherwise remain isolated from production traffic. A production-owned Caddy
service publishes the production API; staging access is isolated and uses
separate staging host/port configuration.

Configuration enters at runtime through environment, Compose env/config files,
or mounted secret files. The image contains no environment-specific endpoint,
database credential, OIDC secret/configuration, tenant data, or Agent CA
private key. Commit only `.example` files, non-secret configuration, schemas,
and secret variable names. Production secrets are host-local protected files
or references to an approved secret store, with restrictive ownership and
permissions; deployment scripts must not print their contents. Production
and staging use distinct secret sets.

Agent Gateway server TLS material, Agent trust certificate, and CA signing
material are mounted only where the RELEASE-002 issuer requires them. CA
private keys remain outside Git and OCI images. Staging uses a separate Agent
CA. Caddy's API TLS private material also stays outside the image and Git.

## 6. Migration and deployment order

Exactly one one-shot Compose migration service owns schema migration for a
release. It uses the same OCI digest as the application services and invokes
`node dist/database/scripts/migrate.js` with the migration SQL shipped in that
image. Application replicas never race to migrate. Migration is not run from
a developer checkout or another artifact. Migration exit code 0 is a hard
precondition for application rollout; failure stops the release command and
records the failed RC/deployment state. Readiness never runs migrations.

The canonical deployment command performs, in order:

1. Validate the explicit digest, approved RC, Compose configuration, required
   production auth/Agent mTLS/database configuration, mounts, ports, and
   configuration revision without printing secret values.
2. Pull the exact image digest.
3. Run any pre-migration backup prerequisite required by the approved release
   policy; backup/restore implementation and evidence remain RELEASE-005.
4. Run the one-shot migration service and require successful completion.
5. Start/update Compose services with that same digest.
6. Poll the RELEASE-003 readiness endpoint for each owned deployable using a
   bounded timeout; do not substitute a fixed sleep for readiness.
7. Run deterministic, non-destructive staging smoke checks. Production smoke
   uses only safe read-only or disposable-fixture operations.
8. Record success/failure, artifact, schema, config revision, and actor in the
   RC/deployment metadata.

The command uses strict failure handling and does not advance after config,
migration, service-start, readiness, or smoke failure. Compose healthchecks
may use `/api/v1/health/live` or `/api/v1/health/ready` as appropriate;
deployment acceptance uses readiness semantics. Services use an approved
restart policy, and Docker stdout/stderr logging has host-level rotation
limits.

## 7. Deployment control and host lifecycle

CI has no production deployment credential in v1. CI verifies, builds, pushes,
and records the candidate; an authorized release operator explicitly runs
the versioned deployment script on the target host with the approved RC id,
image digest, and configuration revision. Staging deployment/evidence must
pass before a separate explicit production approval and command. The command
records operator identity, approval reference, and time. No arbitrary branch
or mutable image tag may deploy production.

Production deployment commands acquire a host-level `flock` lock before
changing Compose state, preventing concurrent releases. The stable project
name and named volumes remain predictable. A systemd unit starts the approved
Compose production project after Docker at host boot and performs controlled
Compose shutdown at host stop. Compose stops containers with SIGTERM so
RELEASE-003 readiness/drain occurs before exit; the existing 10-second
application shutdown bound remains. Deployment and host shutdown can cause
maintenance downtime; the single-host service has no automatic failover.

Staging and production may share a host in v1 but must remain separately
isolated. Production is explicitly `NO_HA / SINGLE_HOST`: a host failure or
maintenance may make the service unavailable; there is no automatic failover
and scaling is manual. This is an accepted v1 limitation, not a reason to add
cluster orchestration. RELEASE-005 must place backups outside the production
host; backup implementation is not part of this R1/R4 contract.

## 8. Promotion, rollback, and forward-fix

Promotion approves an already-built digest; it never rebuilds or retags an
unknown mutable image. The digest deployed and verified in staging is exactly
the digest promoted to production. Failed staging verification blocks
production promotion. A configuration-only failure is repaired through the
approved config revision without rebuilding the image; a source/build fix
creates a new commit and digest.

Persist the exact last-known-good release set: shared image digest, source
commit, schema revision, and configuration revision/reference. Update
last-known-good only after production readiness and required smoke checks pass.
Application rollback is a controlled redeployment of that exact prior digest
and config revision, guarded by a schema-compatibility check. Do not rebuild
the previous source. Never execute down migrations automatically. Until
RELEASE-006 proves N/N-1 compatibility, rollback across a schema-changing
release is not presumed safe. If the previous application cannot safely use
the current schema, stop rollback and use an authorized forward-fix with a new
immutable digest, or a separately validated recovery procedure. R4 does not
claim database rollback safety.

## 9. Acceptance and verification

RELEASE-004 implementation must prove: one clean commit produces one OCI image
digest; all three deployables and migration command use that digest; CI
provenance and RC metadata bind digest to source; staging and production use
the identical digest; the server never builds; Compose separates configuration
and secrets; same-host staging isolation works; PostgreSQL managed/external
modes are supported; migration failure blocks rollout; readiness and smoke
gates stop failed releases; deployment lock prevents concurrency; rollback
uses an exact prior digest and checks schema; systemd host boot/drain behavior
works; and no secret is committed, logged, or baked into the image.

Staging verification must use real OIDC and direct Agent mTLS, not test
adapters, and prove tenant selector/RBAC, all three readiness profiles,
migration, safe smoke flow, and Compose SIGTERM drain before RELEASE-001,
RELEASE-002, or RELEASE-003 can be marked `VERIFIED`. Pipeline implementation
alone does not verify those releases. RELEASE-006 later rehearses migrations
and N/N-1 behavior on this same OCI/Compose model using the proven RELEASE-005
recovery path. RELEASE-007 later hardens this host topology with edge controls;
it does not add a cluster ingress layer.

## 10. State

All v1 deployment-platform decisions are now fixed by this contract.
RELEASE-004-R1 is `CODE_COMPLETE`; the `SPEC_GAP / OPERATIONAL_DECISION`
blocker is cleared; RELEASE-004 is `READY / NOT_STARTED`. This permits a
separate future RELEASE-004 implementation activity but does not implement
it. RELEASE-005 remains independently `READY / NOT_STARTED`; RELEASE-006 and
RELEASE-007 remain `WAITING_DEPENDENCY`. RELEASE-001 through RELEASE-003
remain `CODE_COMPLETE / NOT VERIFIED`, and overall release remains
`BLOCKED_FOR_RC`.
