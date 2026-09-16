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
