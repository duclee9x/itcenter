# Podman and Lima deployment

RELEASE-004 v1 uses one OCI image for API, Agent Gateway, Worker, and the
one-shot migration command. CI writes its immutable
`repository@sha256:...` identity to `release/rc/<id>.json`; staging and
production consume that exact digest. The deployment host does not build from
Git, install npm packages, or rebuild by environment. The supported target is
one Linux VM with Podman and `podman compose`; the current operator workstation
is macOS → Lima VM → Linux → rootless Podman. This is `SINGLE_HOST / NO_HA`:
the host and Lima VM are failure domains, failover is manual, and maintenance
can cause downtime.

The currently validated toolchain baseline is Podman 5.8.4,
`podman-compose` 1.6.0 as the `podman compose` provider, and Lima 2.2.0.
Compatibility with earlier versions is not claimed. Podman’s `compose`
subcommand delegates to an installed Compose provider; deployment checks both
`podman --version` and `podman compose version` and fails if either is absent.
Do not silently switch providers. The Mac host also has Podman 6.1.1; there,
`podman compose` delegates to an external Compose 5.5.1 provider. Runtime
acceptance is based on the explicitly installed Fedora guest provider, not
that host-side compatibility provider. Optional Docker CLI compatibility is
available by setting `CONTAINER_CLI=docker`; it is not required or canonical.

## Host and Lima commands

Commands that manage the VM run on macOS. Image building, registry login,
Compose operations, deployment locks, and systemd commands run inside Linux in
the Lima VM. Containers do not run directly on macOS. Start the instance after
host reboot, then connect to the guest:

```sh
# macOS host
limactl start default
limactl shell default

# Inside Lima guest
podman --version
podman compose version
podman login registry.example.invalid
```

Install Podman and a supported Compose provider from the guest distribution's
trusted package source. Do not depend on a Podman API socket or Docker
credential-store files. The guest operator also needs `jq`, `curl`, `flock`
from util-linux, `sha256sum`, Bash, and `openssl` for the test-only runtime
smoke. Registry credentials are owned by the deployment operator and remain
outside Git and images.

Lima forwards guest ports to the macOS host. The Compose production profile
binds Caddy on guest ports 8080/8443 and Agent Gateway on guest port 3001, so
rootless containers do not bind privileged ports. Configure the Lima instance
port-forward rules before starting it when host ports 80/443 are desired:

```yaml
portForwards:
  - guestPort: 8080
    hostPort: 80
  - guestPort: 8443
    hostPort: 443
  - guestPort: 3001
    hostPort: 3001
  - guestPort: 18080
    hostPort: 18080
  - guestPort: 18443
    hostPort: 18443
  - guestPort: 13001
    hostPort: 13001
```

Lima defaults host binds to loopback. To expose a service to a LAN, set the
corresponding rule's `hostIP: "0.0.0.0"` and apply the VM/host firewall policy;
do not expose every guest port. Staging uses guest ports 18080, 18443, and
13001; use separate forwarding rules or keep staging reachable only inside
the VM. A port-forward configuration change requires restarting the Lima
instance. An HTTPS request reaches macOS host port 443 → Lima guest port 8443
→ Podman-published Caddy port → API. Agent traffic reaches the forwarded TCP
port → Lima guest → Podman-published Agent Gateway port; the Gateway itself
terminates the Agent client mTLS certificate. Caddy never proxies Agent
authentication or certificate metadata. RELEASE-007 still owns final edge
TLS lifecycle and hardening.

The Compose projects are fixed as `itsm-staging` and `itsm-production`. They
have separate networks, project-scoped volumes, ports, DB names, config files,
secrets, OIDC clients, and Agent CA material. They may coexist on one VM.
PostgreSQL can be external or an optional Compose service on a private network
with a Podman-managed named volume and no public DB port. Rootless Podman owns
volume setup; do not access its internal storage path directly. Secret source
files must be owned by the operator account and mode `0600`. File-backed
secrets use the provider's `x-podman.relabel: z` so SELinux grants project
containers access without disabling container labels. Node and Caddy run as
UID/GID `1000:1000`, mapped to the rootless operator with Podman's keep-id
user namespace. PostgreSQL maps container root to that operator to read its
startup password before dropping privileges. No privileged container mode is
required. PostgreSQL's image entrypoint initializes its named volume; verify
the volume survives container replacement before production use.

## Configuration and secrets

Create an unprivileged guest account named `itcenter` and provision
independent staging and production files under its home. The host guest UID
may be distribution-assigned; Compose maps container UID/GID 1000 to the
rootless operator:

```sh
install -d -m 0700 ~/.config/itcenter/staging/secrets
install -d -m 0700 ~/.config/itcenter/production/secrets
install -d -m 0700 ~/.local/state/itcenter/release-state
install -d -m 0700 ~/.local/state/itcenter/locks
install -m 0600 deploy/env/staging.example ~/.config/itcenter/staging/compose.env
install -m 0600 deploy/env/runtime-staging.example ~/.config/itcenter/staging/runtime.env
install -m 0600 deploy/env/production.example ~/.config/itcenter/production/compose.env
install -m 0600 deploy/env/runtime-production.example ~/.config/itcenter/production/runtime.env
```

The example paths use `/home/itcenter`. If a different account/home is used,
edit each copied configuration to its absolute guest path. Replace example
domains, image digests, ports, DB references, and secret paths; never put
secret values in examples, Git, build arguments, logs, or terminal output.
Staging and production use different DBs, secret files, OIDC clients, and Agent
CA material. `DATABASE_URL_FILE` contains the PostgreSQL URL; Agent CA signing
keys stay in protected guest secret storage or approved PKI. The CA private
key never enters the OCI image. Compose file-backed secrets are read-only
mounts. Do not use production credentials in staging.

Use `DB_MODE=external` by default. For a Compose-managed database, set
`DB_MODE=compose`, configure the protected URL to address `postgres`, and
provide the separate password file. PostgreSQL remains on the project's
private network. RELEASE-005 owns backup/restore. `deploy/scripts/backup.sh`
uses `pg_dump -Fc`, encrypts with `age`, computes SHA-256 over the encrypted
artifact and publishes only after verification to the configured writable
`GUEST_BACKUP_MOUNT`. A Lima-only directory or Podman volume never satisfies
`HOST_PROTECTED`.

The six-hour guest timer is installed with
`systemctl --user enable --now itcenter-backup.timer`. `backup-status.sh`
reports RPO from the latest protected copy; `restore.sh --backup <id>
--target rehearsal --config <env> --age-identity <identity>` uses a fresh
Podman Compose project. Production restore requires an exact backup id,
`--target production` and `--confirm-production-restore`. No migration or
deployment failure automatically restores a database. RPO is 6 hours and RTO
is 2 hours, both `UNVERIFIED` until a production-like rehearsal supplies
evidence. Age identity and Agent CA escrow references are checked without
reading private material.

The guest's Podman reports the `journald` log driver. Configure bounded
systemd-journald retention on the Linux guest (for example `SystemMaxUse`,
`RuntimeMaxUse`, and `MaxRetentionSec`) and verify effective limits with
`journalctl --disk-usage`; Docker daemon logging settings do not apply.

## Build, migration, and deploy

CI remains GitHub Actions. Its protected publish job may use Buildx as an OCI
builder, but it publishes one standard OCI digest after verification and
records provenance/SBOM in the RC metadata. CI registry secrets are only
available to the protected publish environment, never ordinary PR builds.
For local development-only builds inside the VM, use
`podman build -t itcenter:local -f Dockerfile .`; a local build is not release
provenance and cannot be promoted as an RC. The server pulls artifacts and
never builds from source.

Run the following inside the Lima guest as the `itcenter` account. Login to
the registry with `podman login` first. Scripts acquire an environment-scoped
`flock` on the Linux guest filesystem, validate the immutable digest and
configuration, validate `podman compose` availability, pull the exact image,
record a pending attempt, run the one-shot migration with the same
`APP_IMAGE`, then start services and wait on RELEASE-003 application readiness
and smoke checks. They stop on any failure; only a successful deployment
updates `CURRENT`/`LAST_KNOWN_GOOD`. Migration is never launched by every
application container. Production schema-changing promotion first invokes the
RELEASE-005 protected pre-migration backup and stops if its host-copy
verification fails; RPO/RTO evidence remains a separate release gate.

```sh
# Inside Lima guest, from the reviewed deployment checkout
CONTAINER_CLI=podman bash deploy/scripts/verify-config.sh staging \
  /home/itcenter/.config/itcenter/staging/compose.env
CONTAINER_CLI=podman bash deploy/scripts/deploy.sh staging \
  registry.example.invalid/itcenter/app@sha256:<64-hex-digest> \
  /home/itcenter/.config/itcenter/staging/compose.env \
  release/rc/RC-2026-001.json
```

Do not promote a mutable tag or rebuild between environments. Production
consumes the same staging-verified digest after required approval, staging
attestation, backup/recovery gates, and release authorization. The staging
smoke path checks API live/ready, direct Gateway readiness, and Worker
readiness, and can optionally verify protected build identity and an enrolled
Agent certificate without business mutation. Real staging OIDC and Agent CA
credentials are required for verification; scripts alone do not mark
RELEASE-001/002/003 verified. `DEGRADED` is visible but does not satisfy the
strict release smoke gate.

Release state and deployment locks default under the guest operator's
`XDG_STATE_HOME` (or `~/.local/state`), not `/var/lib` or `/var/lock`, so the
deployment does not need root. Override `DEPLOY_STATE_ROOT` and
`DEPLOY_LOCK_ROOT` only to other protected Linux guest paths. The rollback
script accepts the exact prior digest and refuses if the current schema does
not exactly match that artifact's supported revision; it never runs down
migrations. If schema is incompatible, use a reviewed forward-fix or validated
recovery route.

## Guest boot and shutdown

The checked-in unit is a systemd **user** unit. Install reviewed runtime
configuration under `/opt/itcenter/deploy` readable by `itcenter`, then inside
the guest:

```sh
mkdir -p ~/.config/systemd/user
install -m 0644 deploy/systemd/itsm-compose.service \
  ~/.config/systemd/user/itsm-compose.service
systemctl --user daemon-reload
systemctl --user enable itsm-compose.service
```

After a successful first deployment, enable user lingering if the stack must
start without an interactive guest login:

```sh
sudo loginctl enable-linger itcenter
```

On VM shutdown, systemd calls the stop wrapper; it marks readiness down by
stopping the stack and allows the existing 10-second RELEASE-003 drain. On a
macOS host reboot, systemd inside Lima cannot start the VM. The v1 operator
starts it with `limactl start <instance>`; the guest user service then restores
the recorded digest if lingering is enabled. No launchd automation is added.
This is an intentional single-host/no-HA limitation.

## Promotion and verification

Use `deploy/scripts/verify-staging.sh` inside the guest only after the exact RC
digest has deployed and the OIDC, tenant/RBAC, real Agent mTLS, worker,
readiness and drain evidence is reviewed. It writes a digest-bound acceptance
attestation. Production promotion uses that same digest and attestation. A
real staging deployment remains required before RELEASE-004 is `VERIFIED`.
RELEASE-007 will complete API ingress controls; it does not change direct
Agent mTLS termination.
