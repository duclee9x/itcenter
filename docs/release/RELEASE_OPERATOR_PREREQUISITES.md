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

## Production Lima scheduled backup timer

The portable checked-in unit now reads an explicit user EnvironmentFile. For
the production-equivalent host, provide a non-secret config file containing
the actual checkout and production environment paths:

```sh
mkdir -p ~/.config/systemd/user
cat > ~/.config/itcenter/backup.env <<'EOF'
ITCENTER_DEPLOY_ROOT=/absolute/path/to/itcenter/deploy
ITCENTER_BACKUP_ENVIRONMENT=production
ITCENTER_ENV_FILE=/absolute/path/to/itcenter/.config/itcenter/production.env
EOF
chmod 600 ~/.config/itcenter/backup.env
install -m 0644 deploy/systemd/itcenter-backup.service ~/.config/systemd/user/
install -m 0644 deploy/systemd/itcenter-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now itcenter-backup.timer
systemctl --user start itcenter-backup.service
systemctl --user status itcenter-backup.timer --no-pager
```

Validation: record a successful scheduled-equivalent encrypted backup on the
HOST_PROTECTED destination and inspect the timer's next/last run. The staging
equivalent was exercised successfully in Phase 6; production installation and
production configuration remain operator-controlled.

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
