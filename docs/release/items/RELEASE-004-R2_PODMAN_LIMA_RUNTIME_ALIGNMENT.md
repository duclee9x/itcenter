# RELEASE-004-R2 — Podman / Lima Runtime Alignment

**Status:** `CODE_COMPLETE`
**Scope:** deployment tooling, Compose compatibility, and operations
documentation remediation only.
**Parent:** [RELEASE-004](RELEASE-004_IMMUTABLE_BUILD_STAGING_PROMOTION_ROLLBACK.md)
**Supersedes:** Docker Engine as the deployment-host runtime selected in
[R1](RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md).

## Canonical runtime and artifact

The canonical v1 deployment environment is macOS host → Lima VM → Linux guest
→ rootless Podman → `podman compose`. Docker Engine and Docker Desktop are not
required. `podman compose` delegates to an installed Compose provider; the
operator must install the tested provider from the guest distribution's
trusted package source. Scripts check `podman --version` and
`podman compose version` and fail closed if the CLI/provider is unavailable.
The default is `CONTAINER_CLI=podman`. `CONTAINER_CLI=docker` is optional
compatibility and is never selected implicitly.

The tested baseline is Podman 5.8.4, `podman-compose` 1.6.0, and Lima 2.2.0
in the current Fedora 44 guest. The macOS Podman client is 6.1.1; its
`podman compose` delegates to an external Compose 5.5.1 provider and is not
the deployment acceptance runtime. Compatibility with earlier versions is
not claimed. CI may keep its existing OCI-compatible Buildx builder; it
publishes standard OCI image bytes and an immutable SHA-256 digest.

R1 artifact semantics do not change: one shared OCI image supports API,
Agent Gateway, Worker, and migration commands. CI creates digest `D`, staging
deploys `D`, and production promotion consumes the same `D`. Environment
configuration, secrets, ports, and service commands remain runtime inputs.
The Linux deployment target pulls an exact digest and does not build from
source. The Compose files retain digest-pinned external images and isolated
`itsm-staging` / `itsm-production` project identities.

## Compose and trust boundaries

Compose files are checked through `podman compose config` with the supported
guest provider. RELEASE-004 uses profiles, health checks, `depends_on`,
`env_file`, file-backed secrets, named volumes, private networks, restart
policies, command overrides, port publishing, `run`, `exec`, `up --wait`, and
`down --timeout`. Runtime checks validate the provider's implementations of
those operations. Container/application readiness endpoints remain the
deployment success gate; Podman container health is supplementary.

Caddy handles API HTTPS only. Rootless production Compose publishes guest
ports 8080/8443 for Caddy and 3001 for Agent Gateway. Production example
configuration uses 8080/8443; Lima may forward host 80/443 to those guest
ports. Staging uses 18080/18443 and Agent port 13001 so both projects can run
on the same VM without binding collisions. Host forwarding defaults to
loopback; public/LAN exposure requires an explicit Lima `hostIP` rule and
firewall review. Rootless containers never need privileged mode to bind 80 or 443.

Agent Gateway stays a direct mTLS endpoint: Agent → forwarded TCP port → Lima
guest → Podman-published Gateway port. The Gateway terminates the client
certificate itself. Caddy does not proxy this channel, and no client-supplied
certificate or Agent identity header is trusted.

Compose-managed PostgreSQL uses project-scoped Podman named volumes on the
private network with no public DB port. Podman owns volume setup and UID/GID
mapping; operational tooling must not depend on Docker volume paths. Runtime
secret files are separate between environments, operator-owned, mode 0600,
and mounted read-only. The provider's `x-podman.relabel: z` labels file-backed
secret mounts for SELinux. Application/Caddy processes retain container
UID/GID 1000:1000, mapped to the rootless operator with
`userns_mode: keep-id:uid=1000,gid=1000`; Compose PostgreSQL maps container
root to that operator to read its startup password before dropping
privileges. The verified Lima guest uses host UID 501/GID 1000, showing that
container UID 1000 need not equal the guest account UID. No Podman API socket
is required.

## Deployment and host lifecycle

Deployment scripts share a narrow runtime switch and invoke `podman compose`
by default for pull, config, one-shot migration, up, exec, and down. They
require an immutable image digest, retain migration-before-rollout, wait on
RELEASE-003 readiness and smoke checks, and use an environment-scoped `flock`
on the Linux guest filesystem. Lock and mutable release state default below
the operator's XDG state directory, so deployment does not require root. No
build step is present in deployment or rollback.

The tested rootless Podman guest uses the `journald` log driver. Configure and
verify bounded systemd-journald retention in the guest; Docker daemon log
rotation settings do not apply. PostgreSQL backup/restore must use PostgreSQL
logical interfaces, not volume internals.

The systemd unit is a user unit for the guest deployment account and manages
the Compose stack after the Lima VM has booted. It does not start Lima on the
macOS host. The v1 recovery sequence after a host reboot is operator
`limactl start <instance>` followed by the guest user service; user lingering
can restore the stack without an interactive guest login. No launchd
automation or high availability is introduced. The deployment remains
`SINGLE_HOST / NO_HA`.

## RELEASE-005 integration input

RELEASE-005 operational examples must use `podman compose exec` and
`podman compose run` inside the Linux guest for PostgreSQL-native backup and
restore operations. Backup evidence must be stored outside the production
host as required by its own contract. RELEASE-005 must not copy internal
Podman volume directories or assume Docker commands/paths.

## Verification boundary

The current guest baseline was inspected directly: Lima 2.2.0, Fedora 44,
rootless Podman 5.8.4, and podman-compose 1.6.0. Rootless `podman build`
created a local-only test image; staging and production both passed
`podman compose config`. The isolated runtime smoke started PostgreSQL,
applied the migration, and ran API, Agent Gateway, Worker, and Caddy. API and
Worker reported `READY`; Gateway reported `DEGRADED` because certificate
issuance was unavailable while its existing-Agent authentication component
was `READY`. Two Compose projects ran concurrently with distinct containers,
networks, and volumes. Guest `flock` mutual exclusion was exercised directly.
The release architecture tests passed 10 cases; the host-only suite skipped
its `flock` subprocess case on macOS, which was separately run in Lima.

All smoke credentials and certificates were ephemeral guest fixtures and
were removed with the test projects. Host port forwarding, macOS reboot
startup, real staging OIDC and Agent certificate lifecycle, registry
publication, and deployment of a clean CI-published digest remain unverified.
These are compatibility checks, not real staging/provider verification.
RELEASE-004 remains `CODE_COMPLETE / NOT VERIFIED` until the same clean
CI-published digest is deployed and accepted through the intended staging
topology, including real OIDC and Agent mTLS evidence.
