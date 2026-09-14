# RELEASE-004 Implementation Report

**Status:** `CODE_COMPLETE / NOT VERIFIED`
**Contract:** [RELEASE-004-R1](RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md)
**Verification boundary:** repository and local image checks pass; no CI-published
candidate has been deployed and accepted on a Linux staging host.

## Artifact and build

The repository builds one OCI image for `apps/api`, `apps/agent-gateway`,
`apps/worker`, and the migration command. The explicit runtime commands are:

| Process       | Container command                          |
| ------------- | ------------------------------------------ |
| API           | `node dist/apps/api/src/main.js`           |
| Agent Gateway | `node dist/apps/agent-gateway/src/main.js` |
| Worker        | `node dist/apps/worker/src/main.js`        |
| Migration     | `node dist/database/scripts/migrate.js`    |

`Dockerfile` uses Node `24.21.0`, `npm ci`, the production TypeScript build,
and prunes development dependencies before copying runtime files into a
non-root image. `.dockerignore` excludes Git metadata, local environments,
tests, credentials, and other development-only files. OCI labels record
version, source commit, build time, and source repository. The protected API
capabilities response includes validated, safe build metadata; public health
responses remain minimal.

GitHub Actions remains the CI provider. The protected manual `publish-oci`
workflow runs after the normal test/build gate, pushes one image to the
configured OCI repository, captures its immutable digest, enables BuildKit
provenance and SBOM output, and commits `release/rc/<id>.json`. Registry
credentials and approval are external GitHub environment configuration. No
artifact signature is claimed: R1 records that the repository has no approved
signing service or signing-key custody policy. Image digests, workflow/source
commit, lockfile SHA-256, schema revision, build time, and SBOM status are
recorded in the RC manifest.

## Compose topology and configuration

`deploy/compose.yaml` defines `api`, `agent-gateway`, `worker`, `migrate`,
`postgres` (optional `compose-postgres` profile), and `caddy`. Every app process
and migration service uses the same `APP_IMAGE` digest. The staging and
production overrides use stable project names `itsm-staging` and
`itsm-production`, separate ports and secret/config paths, and separate
Compose networks/volumes. External PostgreSQL remains supported; an optional
Compose PostgreSQL service has a named persistent volume and no published DB
port. Caddy fronts API traffic only. Agent Gateway publishes its dedicated
port and terminates client mTLS directly.

Environment templates contain references and examples only. Runtime secret
files are host supplied and owner-only; application/migration processes run as
UID/GID `1000:1000`. The deployment config gate enforces OIDC and mTLS modes,
immutable digests for app/Caddy/PostgreSQL images, protected secret files, and
separate project/config identities. Production CA signing material never
enters the image. Docker stdout/stderr logging is retained with a documented
host log-rotation requirement. The included systemd unit starts the stable
production Compose project from its recorded digest after host boot and stops
it through the bounded drain wrapper. The topology is explicitly
`SINGLE_HOST / NO_HA`.

## Migration, deployment, and promotion

`deploy/scripts/deploy.sh` requires an exact `repository@sha256:<64 hex>`
reference and matching RC metadata. It serializes deployment per environment
with host `flock`, validates config, pulls rather than builds, records a
pending event, runs the one-shot `migrate` command from the same digest, and
only then updates API/Gateway/Worker/Caddy. It waits for all three RELEASE-003
profiles to report exactly `READY` and runs smoke checks before updating
environment `CURRENT.json` and `LAST_KNOWN_GOOD.json`. Failures record an event
and do not finalize a release pointer. Staging success is recorded as
`SMOKE_PASSED`; health smoke alone cannot create a verification attestation.

`verify-staging.sh` requires reviewed acceptance evidence bound to the exact
RC id, image digest, source commit, and schema revision, with RELEASE-001,
RELEASE-002, and RELEASE-003 each marked `VERIFIED` and linked to evidence.
Only then does it write a separate digest-bound staging attestation. Production
deployment requires this attestation, an approval reference, and the
RELEASE-005 backup-reference hook. The hook records a reference only; it does
not perform or verify backups. Production promotion remains blocked pending
RELEASE-005/006 and the other RC gates.

`rollback.sh` takes an exact target digest and RC record. Before updating
services it runs the target artifact's read-only schema check and requires an
exact manifest match with the current database. An incompatible target fails
with `FORWARD_FIX_REQUIRED_SCHEMA_INCOMPATIBLE`; no down migration is run.
`CURRENT`, `LAST_KNOWN_GOOD`, and append-only per-attempt event files retain
artifact, source, schema, config revision/reference, actor, and time.

## Readiness and smoke

Container checks use RELEASE-003 readiness endpoints. The deployment gate
checks API HTTPS, direct Agent Gateway readiness, and Worker readiness inside
the Worker container; only exact `READY` is accepted for RC promotion.
Optional protected API smoke verifies the running commit and digest.
Optional Agent smoke uses an enrolled staging certificate directly against
the mTLS port and verifies authentication without a business mutation. Real
OIDC, tenant/RBAC, Agent certificate lifecycle, readiness/drain and process
failure checks remain staging acceptance work. RELEASE-007 still owns final
edge TLS lifecycle and hardening.

## Verification

| Check                         | Result                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `npm test` with PostgreSQL    | PASS — 243 tests total; 242 passed, one Linux `flock`-availability test skipped on macOS |
| `npm run typecheck`           | PASS                                                                                     |
| `npm run lint`                | PASS, including module-boundary checks                                                   |
| `npm run format:check`        | PASS                                                                                     |
| `npm run test:migration`      | PASS — 6 migration tests                                                                 |
| `git diff --check`            | PASS                                                                                     |
| Compose config render         | PASS for staging and production through the local Compose-compatible provider            |
| OCI image build               | PASS locally; runtime command/assets and non-root user inspected                         |
| Deployment failure-gate tests | PASS — migration failure, readiness timeout, schema-incompatible rollback refused        |
| Staging attestation test      | PASS — matching digest and all three verified evidence records required                  |

The local OCI build used the dirty implementation worktree and a local-only
tag; it is not release provenance and is not eligible for promotion. The
workstation uses a Podman-backed Docker CLI without Buildx or the Linux
`flock` executable; Compose configuration rendering was possible, but a full
Linux Docker Engine `compose up`, host systemd boot, protected registry push,
and concurrent real-`flock` execution were not performed here. GitHub Actions
and a Linux staging host must perform those deployment checks. The external
registry, protected `release-publish` environment, IdP, staging Agent CA,
certificates, databases, and real secret mounts still need operator
configuration. RELEASE-004 is therefore not `VERIFIED`.
