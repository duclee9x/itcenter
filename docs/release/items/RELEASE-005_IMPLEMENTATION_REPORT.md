# RELEASE-005 implementation report

**Status:** `CODE_COMPLETE / NOT VERIFIED`
**RPO:** `UNVERIFIED` (requirement: 6 hours)
**RTO:** `UNVERIFIED` (requirement: 2 hours)

RELEASE-005 adds a PostgreSQL-native recovery path for the Podman/Lima
deployment. `deploy/scripts/backup.sh` uses PostgreSQL tooling from the
configured PostgreSQL image, creates a custom-format dump, encrypts it with
the configured age recipient, computes SHA-256 over the encrypted artifact,
and publishes only after verification to a writable Lima host mount. A Lima
directory or Podman volume never satisfies `HOST_PROTECTED`.

Backup records are immutable per backup id. `backup-status.sh` calculates RPO
from the latest successful protected copy; `hold-backup.sh` preserves an
operator-held backup. `restore.sh` verifies the protected checksum, requires a
separately supplied age identity, restores rehearsal data into a fresh
Podman Compose project and records non-secret rehearsal evidence. Production
restore requires an exact backup id, an explicit production target and
`--confirm-production-restore`.

The six-hour systemd timer and pre-migration deployment gate are included.
The gate runs after the deployment lock and before migration, and a failed
protected backup prevents migration. No PITR, WAL archiving or Podman-volume
copy is used. Retention and hold state are evaluated only after successful
protected publication.

The remaining verification boundary is operational: the current Lima guest
has no writable host backup mount and no installed `age` binary. A real
staging/production-like rehearsal must provision those, verify age identity
and Agent-CA escrow references, execute backup and fresh restore, validate the
application image, and measure RPO/RTO. No production secrets are included.

## Verification evidence

- `npm test`: 245 passed, 1 existing workstation-only flock test skipped
  (113 unit/architecture, 2 contract, 6 migration, 61 integration, 64 E2E).
- `npm run typecheck`: pass.
- `npm run lint`: pass, including dependency-boundary checks.
- `npm run format:check`: pass.
- `git diff --check`: pass.
- `bash -n deploy/scripts/*.sh`: pass.
- Isolated fake-tooling backup test: encrypted publication, SHA-256 copy
  verification, metadata and latest-protected pointer passed.
- `podman compose config` for `compose.restore.yaml` passed inside the running
  Lima guest with non-secret dummy values.

The canonical Lima backup/restore rehearsal was not claimed: `age` is not
installed in the guest and its current `/Users/duclee` mount is read-only, so
there is no writable `HOST_PROTECTED` destination. RPO and RTO therefore stay
`UNVERIFIED`.
