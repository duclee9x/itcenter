# Release Operator Prerequisites

This file contains only operator-controlled inputs still missing for release
verification. It contains no credentials or secret values.

## OCI registry-backed RC

Provide the protected registry configuration required by the existing release
workflow:

- `OCI_REGISTRY`
- `OCI_REPOSITORY`
- protected `OCI_USERNAME` and `OCI_PASSWORD` in CI secret storage

Why: the local candidate is usable for inspection but is not a promotable RC
identity. RELEASE-004 deployment and all qualifying staging evidence require
one immutable repository digest plus RC metadata.

Validation:

```sh
podman pull "$OCI_REGISTRY/$OCI_REPOSITORY@sha256:<digest>"
podman inspect "$OCI_REGISTRY/$OCI_REPOSITORY@sha256:<digest>"
```

Blocks: RELEASE-004, then RELEASE-001/002/003/006/007 staging verification.

## Recovery escrow governance

Provide non-secret governed references for:

- the age recovery identity outside Lima;
- the Agent CA/private issuer material outside Lima;
- any additional RELEASE-005 recovery-critical secrets.

The staging files prepared by this bootstrap are evidence of staging material
placement only. They do not prove production custody or RELEASE-005 VERIFIED.

Validation: run the existing non-destructive escrow readiness check and record
presence/governance without reading or logging secret values.

Blocks: RELEASE-005 verification, RPO/RTO closure and RC approval.

## Lima scheduled backup timer

Install the checked-in user units in the canonical Lima guest and enable the
six-hour timer after resolving the production configuration paths:

```sh
mkdir -p ~/.config/systemd/user
install -m 0644 deploy/systemd/itcenter-backup.service ~/.config/systemd/user/
install -m 0644 deploy/systemd/itcenter-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now itcenter-backup.timer
systemctl --user start itcenter-backup.service
systemctl --user status itcenter-backup.timer --no-pager
```

Validation: record a successful scheduled-equivalent encrypted backup on the
HOST_PROTECTED destination and inspect the timer's next/last run. This is
required for RELEASE-005 RPO evidence; the current Lima guest has no installed
user timer.

## Public staging edge (optional local path already prepared)

For public ACME/production-like edge evidence, provide a staging hostname with
DNS resolving to the intended Lima/macOS path and the operator-controlled
certificate challenge/HTTPS reachability. The local independent Caddy TLS mode
can verify local HTTPS behavior without public DNS, but cannot prove public
ACME or external reachability.

Validation:

```sh
curl --resolve <staging-host>:443:<host-address> https://<staging-host>/health/live
nc -vz <host-address> <agent-mtls-port>
```

Blocks: public portion of RELEASE-007 verification and the corresponding
production-like edge evidence.

## Current local candidate reference

The bootstrap-only local candidate is recorded outside Git at the host-backed
verification path as `RC-LOCAL-7EA3001.json`. It is intentionally marked
`NOT_VERIFIED` and `NOT_PROMOTED`.
