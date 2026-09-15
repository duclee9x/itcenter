# RELEASE-004 Implementation Report

**Status:** `CODE_COMPLETE / NOT VERIFIED`
**Contract:** [RELEASE-004-R1](RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md)
**Runtime remediation:** [RELEASE-004-R2 — Podman / Lima](RELEASE-004-R2_PODMAN_LIMA_RUNTIME_ALIGNMENT.md)
**Verification boundary:** repository and local image checks pass; no CI-published
candidate has been deployed and accepted in the intended staging environment.

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
files are supplied inside the Linux deployment guest and owner-only;
application/migration processes run as container UID/GID `1000:1000`. R2
selects macOS host → Lima VM → Linux guest → rootless Podman → `podman compose`
as the current operator runtime. Podman `userns_mode: keep-id` maps the
non-root application identity to the rootless guest operator, and
`x-podman.relabel: z` allows SELinux-protected read-only secret mounts without
privileged containers. Podman named volumes own PostgreSQL data; operators
must not rely on Docker volume paths. Caddy remains the API proxy, while
Agent Gateway terminates direct mTLS on its dedicated published TCP port.
The deployment config gate enforces OIDC and mTLS modes, immutable digests for
app/Caddy/PostgreSQL images, protected secret files, and separate project/config
identities. Production CA signing material never enters the image. Podman uses
stdout/stderr with the guest's `journald` log driver; bounded
systemd-journald retention is an operator requirement. The systemd user unit
starts the stable production Compose project after the Lima guest boots, but
cannot start Lima after the macOS host reboots; an operator starts the VM with
`limactl start`. The topology is explicitly `SINGLE_HOST / NO_HA`.

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

| Check                         | Result                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm test` with PostgreSQL    | PASS — 243 tests total; 242 passed, one Linux `flock`-availability test skipped on macOS         |
| `npm run typecheck`           | PASS                                                                                             |
| `npm run lint`                | PASS, including module-boundary checks                                                           |
| `npm run format:check`        | PASS                                                                                             |
| `npm run test:migration`      | PASS — 6 migration tests                                                                         |
| `git diff --check`            | PASS                                                                                             |
| Compose config render         | PASS for staging and production using Podman Compose 1.6.0 in the Lima guest                     |
| OCI image build               | PASS using rootless Podman 5.8.4; all runtime commands available                                 |
| Podman Compose runtime smoke  | PASS — PostgreSQL, migration, API, Agent Gateway, Worker, and Caddy started; health gates passed |
| Project isolation             | PASS — concurrent projects have distinct containers, networks, and volumes                       |
| Rootless secret mounts        | PASS — SELinux relabel and keep-id mapping permit non-root read-only secret access               |
| Deployment failure-gate tests | PASS — migration failure, readiness timeout, schema-incompatible rollback refused                |
| Staging attestation test      | PASS — matching digest and all three verified evidence records required                          |

The local OCI build used the dirty implementation worktree and a local-only
tag; it is not release provenance and is not eligible for promotion. The
isolated rootless Lima smoke used ephemeral test credentials and certificates,
not real IdP or Agent provisioning. Agent Gateway reported `DEGRADED` because
the certificate issuer capability was unavailable, while the existing-Agent
authentication capability reported `READY`; that is the expected R1
separation. The smoke does not prove public/LAN Lima forwarding, a macOS host
reboot, a clean CI-published digest, protected registry push, real staging
OIDC, real Agent mTLS enrollment/revocation/rotation, or production promotion.
GitHub Actions and an actual staging deployment must provide that evidence.
The external registry, protected `release-publish` environment, IdP, staging
Agent CA/certificates, and database still require operator configuration.
RELEASE-004 therefore remains `CODE_COMPLETE / NOT VERIFIED`.
