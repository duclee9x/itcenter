# Release Operator Prerequisites

This file contains only operator-controlled inputs still missing for release
verification. It contains no credentials or secret values.

## Protected release branch for GHCR publication

Enable the repository's approved branch protection/ruleset for `master`. The
publish workflow intentionally requires `github.ref_protected == true` and
now publishes to `ghcr.io/duclee9x/itcenter` using the job-scoped
`GITHUB_TOKEN` with `packages: write`; no PAT or registry password is required
by the checked-in workflow.

Validation:

```sh
curl -fsSL https://api.github.com/repos/duclee9x/itcenter/branches/master \
  | jq -r '.protected'
```

Expected output: `true`. Then dispatch Bootstrap CI with a new release id and
verify the resulting RC metadata references the exact GHCR digest.

Blocks: RELEASE-004 registry-backed RC publication and exact-digest staging
attestation.

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

## Public production edge (not required for local staging TLS)

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

Blocks production ACME/external-reachability evidence only. RELEASE-007 local
staging verification may use the approved independent Caddy CA mode.

## Current local candidate reference

The current local candidate is `RC-LOCAL-CCA7D1B`, built from committed
`cca7d1b3bfc7510635d4db1be67bafa65981a8a3`, with local image identity
`sha256:474f72db0aca9f5464c365a4b9e47db695e100a45b852b32bf5e21be70b72b0f`.
It is intentionally marked `NOT_VERIFIED` and `NOT_PROMOTED` until the exact
GHCR digest is published and deployed.
