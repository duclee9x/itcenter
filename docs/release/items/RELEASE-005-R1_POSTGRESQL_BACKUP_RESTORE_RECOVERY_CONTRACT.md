# RELEASE-005-R1 — PostgreSQL Backup / Restore / Recovery Contract

**Status:** `PLANNING / BLOCKED`
**Parent:** [RELEASE-005 — Backup / Restore + RPO / RTO Validation](RELEASE-005_BACKUP_RESTORE_RPO_RTO.md)
**Scope:** recovery and operational decisions only. This document authorizes
no backup or restore runtime implementation.

## Decision boundary

RELEASE-005 cannot safely implement production automation until the recovery
policy is approved. The repository currently has a local development helper
using PostgreSQL custom-format `pg_dump`/`pg_restore`, a 24-hour local backup
loop, and a RELEASE-004 pre-migration reference hook. These are not production
backup evidence. No production schedule, off-host destination, retention,
encryption policy, restore authorization, RPO, RTO, or measured rehearsal is
currently normative.

The canonical deployment boundary remains macOS host → Lima VM → rootless
Podman → `podman compose`. PostgreSQL backup and restore must use PostgreSQL
protocol tooling through `podman compose exec`/`run` when the database is
Compose-managed. External PostgreSQL must use the same connection contract;
backup must never copy Podman volume internals or a live PostgreSQL data
directory.

## Authoritative data and recovery scope

PostgreSQL is the authoritative mutable application store for the implemented
release. Audit, outbox/inbox, identity, membership, Agent credential metadata,
TASK-091 state, worker state, and business records must be covered by the
database backup. Search, cache, and worker runtime state are rebuildable or
re-established and are not authoritative backup inputs.

The repository does not currently provide a production object-storage adapter
or a separate application file store. If file/object evidence is enabled for
launch, its owner must add that store to the approved recovery scope before
RELEASE-005 can be marked ready. A backup must never be described as complete
while authoritative data exists outside PostgreSQL and is not recoverable.

Agent CA private signing material, OIDC configuration, database credentials,
registry credentials, Caddy/TLS keys, and other recovery-critical secrets are
external operator-managed material. They must not be placed in a database
dump or backup directory. The owner, escrow/recovery location, access
authorization, and restore validation for each enabled secret must be
recorded before verification. In particular, loss of the Agent CA key can
prevent enrollment and rotation and is a `RECOVERY_GAP` until independently
protected recovery is demonstrated.

## Backup and artifact model

The implementation target, subject to approval, is a consistent logical
PostgreSQL custom-format dump (`pg_dump -Fc`) produced by the PostgreSQL
client compatible with the deployed major version. Every artifact will have
an immutable backup id, temporary/incomplete state, SHA-256 checksum, and
metadata linking environment, database identity, PostgreSQL major version,
schema revision, RELEASE-004 RC/release id, OCI digest/source commit when
known, timing, size, and storage locations. A backup becomes protected only
after the required off-host copy and checksum verification succeed.

The lifecycle is:

```text
TEMPORARY → COMPLETE_LOCAL → OFF_HOST_VERIFIED → PROTECTED
```

Partial, checksum-invalid, or failed-copy artifacts cannot become latest-good.
Restore verifies the checksum before `pg_restore`, restores into an isolated
target by default, validates schema and deterministic data/integrity checks,
and records retrieval, restore, application validation, and total durations.
Production restore requires an explicit environment, backup id, destructive
confirmation, authorized operator, and recovery runbook. No down migration is
implicit in restore.

## Off-host failure-domain decision

The following destinations are distinct and must not be conflated:

| Level           | Meaning                                                    | Current decision                                             |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| `LOCAL_VM_COPY` | File in the Lima guest or a Podman volume                  | Never sufficient for release recovery                        |
| `HOST_COPY`     | Explicit Lima mount to a macOS host backup directory       | Proposed minimum; protects VM loss but not host/disk loss    |
| `REMOTE_COPY`   | NAS, external disk, or object storage outside the Mac host | Required if host-loss protection is part of approved RPO/RTO |

The current Lima configuration exposes the developer home mount but does not
define a dedicated production backup mount. The operator must approve an
explicit guest path such as `/mnt/host-backups/itcenter` mapped to a named
macOS host directory, with separate permissions and capacity monitoring. A
host copy may satisfy the minimum RC requirement only after the owner accepts
that total physical host/disk loss remains outside its protection. Otherwise
an additional remote copy is mandatory.

## Decisions requiring approval

These values are intentionally unresolved; examples are not normative:

| Decision              | Proposed simple profile for review                                                                                            | Required evidence/owner           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| RPO                   | Daily logical backup plus a successful pre-migration backup; exact maximum data loss is pending approval                      | Service owner / DB operator       |
| RTO                   | Restore initiation to validated database and usable application; duration target is pending approval                          | Service owner / DB operator       |
| Schedule              | Daily timer inside Lima, with Lima continuously running; external/manual fallback if this availability assumption is rejected | Platform operator                 |
| Backup type           | `pg_dump -Fc` with PostgreSQL-major compatibility check                                                                       | DB operator                       |
| Required destination  | `HOST_COPY` minimum, or `HOST_COPY + REMOTE_COPY` if host-loss protection is required                                         | Service owner / security reviewer |
| Encryption            | FileVault/host encryption assumption versus approved artifact encryption mechanism                                            | Security reviewer                 |
| Retention             | Review example: 7 daily and 4 weekly, with latest-good, active recovery targets, and legal/manual holds protected             | Data owner                        |
| Restore authorization | Isolated restore by authorized operator; destructive production restore requires explicit approval and confirmation           | Release owner / DB operator       |
| Pre-migration gate    | Verified required off-host backup reference before production migration                                                       | Release owner                     |
| Failure handling      | Backup/copy/checksum/restore validation failure stops the operation; migration failure never auto-restores                    | Release owner                     |
| Recovery secrets      | Independent escrow and restore test for Agent CA, OIDC, DB, registry, and TLS material                                        | Security / platform owners        |
| Ownership             | Named backup operator, restore operator, alert owner, and evidence approver                                                   | Service owner                     |

No RPO/RTO value, schedule, retention, destination level, or encryption claim
becomes normative merely because it appears in the proposed column.

## Readiness and evidence

Backup status is `UNVERIFIED`, `MET`, or `NOT_MET`. A timer, file existence,
or checksum alone is not evidence of a met RPO. Verification requires a dated
production-like or approved sanitized rehearsal that retrieves a protected
off-host artifact, verifies it, restores an isolated PostgreSQL instance,
checks the schema and immutable history, runs safe application reads using the
matching immutable OCI image where feasible, and records measured RPO/RTO
outcomes.

Retention must not remove the latest-known-good backup, an active rollback or
recovery target, or a protected/manual hold. Retention is applied only after
successful artifact verification and must preserve failed-attempt history.

RELEASE-004 production deployment must consume this contract's verified
pre-migration backup reference before migration. RELEASE-006 separately owns
N/N-1 migration compatibility and must use the same immutable OCI artifact and
the proven recovery path.

## Current blocker

`RELEASE-005 = BLOCKED / NOT_STARTED` with blocker
`SPEC_GAP / OPERATIONAL_DECISION`. The unresolved decisions above must be
approved and persisted before scripts, timers, migrations, or restore
automation are implemented.
