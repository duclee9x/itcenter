# Release Operator Prerequisites

This file contains only operator-controlled inputs still missing for release
verification. It contains no credentials or secret values.

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

## Current registry candidate deployment follow-up

`RC-CCA7D1B-20260916-R3` is published at
`ghcr.io/duclee9x/itcenter@sha256:3715744c11e133d7068651d7df6fe1ef2f1377643bf65e6635f4fcadfdac1d9e`.
The digest was pulled into Lima and exercised in the isolated staging stack.
The remaining action is a repository-side deployment integration correction:
the canonical staging deployment must load the non-secret Keycloak CA trust
configuration used by the HTTPS staging issuer. This is not an operator
credential request.

Blocks: RELEASE-004 staging attestation and dependent release verification.
