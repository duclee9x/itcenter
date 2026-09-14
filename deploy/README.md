# Linux Docker Compose deployment

RELEASE-004 v1 ships one application OCI image for API, Agent Gateway, Worker,
and the one-shot migration command. CI records the immutable
`repository@sha256:...` digest in `release/rc/<id>.json`; staging and production
must receive that exact digest. This is a single-host `NO_HA` deployment.
Compose does not build application images, and the production host must not
run Git, npm install, TypeScript build, or Docker build to create a release.

## Host prerequisites

Use Linux, Docker Engine, Docker Compose v2, `jq`, `flock` (util-linux),
`curl`, and `sha256sum`. Provision the OCI registry with a read-only host pull
credential. Configure Docker stdout/stderr log rotation on the host; a typical
daemon policy is `local` logging with bounded `max-size` and `max-file`.
Restrict SSH to administrators, publish only Caddy's API ports and the direct
Agent Gateway mTLS port, and do not publish PostgreSQL.

The CI repository/environment must define `OCI_REGISTRY`, `OCI_REPOSITORY`,
and the `OCI_USERNAME` / `OCI_PASSWORD` secrets. Protect the GitHub
`release-publish` environment with the release-owner approval policy. The
publish job is manual and requires a protected branch; ordinary pull-request
and push verification cannot access registry credentials. It records a
versioned RC manifest and enables BuildKit provenance and SBOM attestations.
Image digests, rather than the human-readable CI tag, are the deployment
identities.

## Environment setup

Create distinct staging and production config/runtime files and protected
secret directories, owned by the deployment operator and mode `0600` (secret
files also `0600`). The checked-in `*.example` files contain only names,
references, and non-secret examples. Never place secret values in those
files, Git, image build arguments, or terminal output.

Standalone Compose file-backed secrets are mounted from host files. Keep their
mode owner-only and make each source readable by the consuming container UID:
the Node services and migration command run as UID/GID `1000:1000`, Caddy
secret ownership must match the pinned Caddy image's runtime UID, and the
PostgreSQL entrypoint reads its password file before dropping privileges.
Account for Docker user-namespace mappings when enabled. The config gate checks
restrictive permissions; readiness/smoke checks catch unreadable runtime
material without printing its contents.

```sh
sudo install -d -m 0700 /etc/itcenter/staging/secrets
sudo install -d -m 0700 /etc/itcenter/production/secrets
sudo install -d -m 0750 /var/lib/itcenter/release-state
sudo install -m 0600 deploy/env/staging.example /etc/itcenter/staging/compose.env
sudo install -m 0600 deploy/env/runtime-staging.example /etc/itcenter/staging/runtime.env
sudo install -m 0600 deploy/env/production.example /etc/itcenter/production/compose.env
sudo install -m 0600 deploy/env/runtime-production.example /etc/itcenter/production/runtime.env
```

Replace example OIDC issuers/audiences, hostnames, exact `APP_IMAGE` digest,
ports, and all secret paths with the environment's reviewed values. Create the
referenced secret files through the approved DB, IdP, TLS, and Agent PKI
processes. Staging and production must have different databases, secret files,
OIDC clients, and Agent CA material. The optional passphrase file may be empty
when the protected Agent CA key has no passphrase; the optional runtime
reference is set only for an encrypted key.

External PostgreSQL is the default. For the Compose-managed option, set
`DB_MODE=compose`, put a database URL addressing `postgres` in the protected
database URL file, and use a separate PostgreSQL password file. The database
is then on the project's private network with a project-scoped named volume
and no host port. Backups and restore are outside RELEASE-004 and must follow
RELEASE-005. When using external PostgreSQL, keep the required password-file
path as an empty mode-0600 placeholder because Compose resolves the optional
PostgreSQL secret even when that service profile is disabled.

Staging defaults to project `itsm-staging`, Caddy host ports 8080/8443 on
loopback, and direct Agent port 13001. Production uses stable project
`itsm-production`, Caddy ports 80/443, and Agent port 3001. A staging Agent
port may bind a restricted host interface when real staging Agents need to
connect. The project names, Compose networks, volumes, databases, and secret
paths remain separate. The default Worker process count is one; any manual
replicas must preserve the RELEASE-003 durable database coordination.

Caddy serves API HTTPS only. Supply its certificate and key as external
read-only secret files. Agent Gateway receives TLS certificates and client
certificates directly; do not put its client-authentication port behind Caddy
or forward client-certificate identity headers. RELEASE-007 still owns final
TLS lifecycle and edge controls.

## Build, staging, and production

Run the manual `Bootstrap CI` workflow on the protected release commit with a
new RC identifier. The workflow verifies first, builds and pushes one shared
OCI image once, records its digest and provenance, and commits the RC manifest.
The registry's retention policy must retain every staged, current, and
last-known-good digest. No registry signing policy is claimed by this release.

On the deployment host, use the versioned Compose/scripts/configuration from a
reviewed commit. A server pull credential must be read-only. Example staging
deployment:

```sh
sudo bash deploy/scripts/verify-config.sh staging /etc/itcenter/staging/compose.env
sudo bash deploy/scripts/deploy.sh staging \
  registry.example.invalid/itcenter/app@sha256:<64-hex-digest> \
  /etc/itcenter/staging/compose.env release/rc/RC-2026-001.json
```

The deployment lock is `flock`-based and scoped by environment. The command
validates config and RC provenance, pulls the exact digest, runs the one-shot
`migrate` service from that same digest, updates API/Gateway/Worker/Caddy only
after migration succeeds, waits for each RELEASE-003 profile to be exactly
`READY`, and runs smoke checks. `DEGRADED` returns HTTP 200 by the health
contract but fails this strict RC gate. Failed migration/readiness/smoke
creates a failed event record and does not update `CURRENT` or
`LAST_KNOWN_GOOD`.

The checked-in Caddy and PostgreSQL image references are also digest-pinned
and must be replaced with reviewed immutable references when updating those
runtime versions.

The smoke script checks API HTTPS, direct Agent Gateway TLS readiness, Worker
readiness from inside its container, and optionally a protected capabilities
request plus a direct Agent mTLS authentication probe. To verify the deployed
commit and digest in the protected API response, provide
`SMOKE_BEARER_TOKEN_FILE`, `SMOKE_TENANT_ID`, and `SMOKE_PROTECTED_URL` in the
Compose config. The token file is read locally into a mode-0600 temporary curl
config and is not logged. Use a short-lived staging identity with only the
capability needed for this diagnostic. To exercise an enrolled Agent
credential, configure `AGENT_MTLS_SMOKE_CERT_FILE` and
`AGENT_MTLS_SMOKE_KEY_FILE`; the probe authenticates at the direct mTLS port
and expects the intentionally unknown path to return 404 only after Agent
authentication succeeds. It makes no Agent business mutation.

A successful staging deployment records `SMOKE_PASSED`, not a verification
attestation. RELEASE-001/002/003 become verified only after their real staging
acceptance evidence is reviewed. Complete
`deploy/env/staging-acceptance-evidence.example.json` with the RC's exact
release id/digest/commit/schema, verified status and evidence references for
OIDC/tenant/RBAC, real Agent mTLS/credential behavior, and Compose readiness /
drain. Then run:

```sh
sudo bash deploy/scripts/verify-staging.sh \
  release/rc/RC-2026-001.json \
  /etc/itcenter/staging/compose.env \
  /etc/itcenter/staging/acceptance-evidence.json
```

This writes the digest/commit/schema-bound accepted record under
`/var/lib/itcenter/release-state/staging/attestations/<release-id>.json`.
Production requires that verified attestation. The same-host v1 topology
uses it in place; when staging is on another VM, transfer the attestation
through the reviewed operator channel and pass its path as the final argument
to `deploy.sh`.

Production also requires a non-placeholder change/approval reference and
`PRE_MIGRATION_BACKUP_REF`. RELEASE-004 records that backup reference only;
it does not run or verify a backup. Production schema-changing promotion
remains blocked pending RELEASE-005 backup/restore and RELEASE-006 migration
rehearsal/compatibility evidence. Never treat the reference itself as backup
proof.

## State and recovery

Host-local per-attempt event files record pending, success, and failure
events. `CURRENT.json` and `LAST_KNOWN_GOOD.json` contain the exact image,
commit, schema revision, config revision/reference, and timestamps. These
mutable environment pointers are separate from the committed RC manifest;
completed RC source metadata is not rewritten by deployment.

Rollback accepts an exact digest and matching RC file. Before changing
services it runs the target image's read-only schema compatibility check
against `migration_meta.applied`. An exact manifest match is required; an
ahead, behind, unknown, or mismatched schema stops with
`FORWARD_FIX_REQUIRED_SCHEMA_INCOMPATIBLE`. Rollback never runs a down
migration. If the prior application cannot use the current schema, use a
reviewed forward-fix or separately validated recovery process. The rollback
target must be a retained prior immutable artifact; do not rebuild it.

The systemd unit at `deploy/systemd/itsm-compose.service` starts the stable
production Compose project after Docker at host boot by reading the exact
digest and build identity from `CURRENT.json`; it does not depend on a mutable
tag or image value left in the environment template. It re-pulls that digest,
starts the Compose services, and rechecks readiness without running
migrations. The paired stop command uses the same environment deployment lock
and stops Compose with the 10-second RELEASE-003 drain bound. Single-host
maintenance and host failure can make the service unavailable; v1 has no
automatic failover.

Install the reviewed deployment-only files (not application source or build
output) and enable the host unit after the first successful production deploy:

```sh
sudo install -d -m 0755 /opt/itcenter/deploy/scripts /opt/itcenter/deploy/caddy
sudo install -m 0644 deploy/compose.yaml deploy/compose.staging.yaml deploy/compose.production.yaml /opt/itcenter/deploy/
sudo install -m 0644 deploy/caddy/Caddyfile /opt/itcenter/deploy/caddy/Caddyfile
sudo install -m 0755 deploy/scripts/*.sh /opt/itcenter/deploy/scripts/
sudo install -m 0644 deploy/systemd/itsm-compose.service /etc/systemd/system/itsm-compose.service
sudo systemctl daemon-reload
sudo systemctl enable itsm-compose.service
```

The install source must be a reviewed commit. Keep this host-side deployment
configuration update separate from image creation; the host pulls the already
published artifact digest.
