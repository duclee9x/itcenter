# RELEASE-005-R1 — PostgreSQL Backup / Restore / Recovery Contract

**Status:** `CODE_COMPLETE`
**Parent:** [RELEASE-005 — Backup / Restore + RPO / RTO Validation](RELEASE-005_BACKUP_RESTORE_RPO_RTO.md)
**Scope:** normative v1 recovery policy. Runtime implementation is a later
RELEASE-005 activity.

## Recovery objectives

The production requirements are **RPO 6 hours** and **RTO 2 hours**. RPO is
the age of the newest successfully completed `HOST_PROTECTED` backup at the
recovery point. It must include successful encryption, copy to the required
off-Lima destination, and checksum verification. RPO status is
`UNVERIFIED`, `MET`, or `NOT_MET`; a Lima-only artifact never qualifies.

RTO measurement starts when the operator begins the documented recovery
procedure and ends only after artifact retrieval, checksum/decryption,
PostgreSQL restore, schema validation, required configuration/secrets,
compatible application OCI startup, and representative application
validation. `pg_restore` completion alone is not recovery completion. RTO is
`MET` only when measured total recovery time is at most two hours.

## Backup policy

Production takes a PostgreSQL logical custom-format backup every six hours and
takes a new protected pre-migration backup before every production
schema-changing deployment. The pre-migration backup does not replace the
schedule. A systemd timer inside the Lima guest is the scheduler; Lima is
expected to remain running continuously. A missed window, stopped Lima VM,
unavailable PostgreSQL, unavailable host mount, encryption failure, or timer
failure makes RPO `NOT_MET` until a protected backup succeeds.

The format is `pg_dump -Fc`, restored with `pg_restore` and PostgreSQL-major
compatible tooling already supplied by the deployment environment. V1 does
not use PITR or WAL archiving. If measurement cannot meet either objective,
the result is a new recovery remediation; compliance is never asserted from a
timer or design estimate.

Each backup set contains an immutable sortable id with environment, UTC
timestamp and unique suffix, plus:

```text
<backup-id>.dump.age
<backup-id>.json
<backup-id>.sha256
```

Temporary files are incomplete and cannot become latest-good. A backup is
successful only after `pg_dump`, `age` encryption, metadata finalization,
SHA-256 generation, copy to `HOST_PROTECTED`, and copied-checksum verification
all succeed. Metadata contains backup id, environment, type, PostgreSQL major,
schema revision, release id, source commit, OCI digest, start/completion
times, original/encrypted size, checksum, storage locations, protection state,
and verification state. It contains no secrets.

## Encryption and storage levels

Production backup artifacts are encrypted with `age` using a configured public
recipient. The private recovery identity is never committed, placed in the
OCI image, written to metadata, or stored only inside Lima. It has at least
one protected escrow copy outside Lima and is not encrypted only by itself.

Storage levels are explicit:

| Level              | Definition                                                                                                       | Requirement                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `LIMA_LOCAL`       | Lima filesystem or Podman volume                                                                                 | Never satisfies production protection or RPO                        |
| `HOST_PROTECTED`   | Encrypted artifact copied to an explicit Lima mount backed by a macOS host directory, with checksum verification | Required minimum v1 level                                           |
| `REMOTE_PROTECTED` | Copy outside the physical Mac host                                                                               | Optional v1; required only if host-loss protection is adopted later |

The operator configures `HOST_BACKUP_PATH` on macOS and
`GUEST_BACKUP_MOUNT` inside Lima. The guest mount must be explicitly
validated; absence or fallback to a same-VM directory fails the backup. A
host copy protects against Lima loss, VM corruption, Podman volume loss, and
PostgreSQL volume corruption, but not total Mac/disk loss. That limitation is
accepted as `KNOWN_LIMITATION` for v1. No S3, NAS, or other remote service is
required.

Backups use a per-environment Lima `flock`; concurrent production backups are
not allowed. Retention keeps the latest 28 successful six-hour backups and
four weekly protected backups, selecting one successful protected backup per
completed UTC week. Retention runs only after a new protected backup succeeds
and never deletes the latest-good, current pre-migration, held, or active
rehearsal backup. Storage pressure causes backup failure and alerting rather
than retention violations.

## Authoritative data and secrets

PostgreSQL is the only authoritative mutable application-data backup target in
RELEASE-005 v1. This includes business records, audit, outbox/inbox, identity,
membership, Agent credential metadata, TASK-091 state, and worker-owned
durable state. Search, cache, and in-process worker state are rebuildable.
The current release has no production object-storage or separate application
file store; if that changes, recovery scope must be expanded before release
verification. Podman volume internals and live PostgreSQL data directories are
never backup interfaces.

Database backup does not contain recovery-critical secrets. Separate protected
escrow outside Lima is required for the `age` identity, OIDC configuration,
Agent CA/private issuer material, application encryption keys if introduced,
database credentials, registry access, and Caddy/TLS material. Escrow
references may be validated without reading or logging values. Agent CA loss
can block enrollment and rotation; no complete recovery claim is allowed
without an independently protected CA copy.

## Restore and authorization

Normal verification restores to a fresh isolated PostgreSQL instance, new
Podman volume, and new Compose project; it never reuses production storage.
The canonical flow verifies the encrypted artifact checksum, decrypts with
the separately supplied `age` identity, starts compatible PostgreSQL, runs
`pg_restore`, validates schema revision and deterministic integrity fixtures,
starts the matching immutable OCI application image where feasible, performs
safe reads, records retrieval/decryption/restore/validation/total durations,
and removes rehearsal resources safely.

Production restore is privileged and destructive. It requires an explicit
production environment, exact backup id, operator-initiated command,
recovery-runbook invocation, and the stable flag
`--confirm-production-restore`. No generic command selects production by
default. Deployment or migration failure never triggers an automatic restore
or down migration.

Restore rehearsal is required at least once before the RC gate, after material
backup/restore automation changes, and after a PostgreSQL major-version
change. Verification requires actual Podman/Lima execution, a protected
off-Lima encrypted copy, checksum verification, fresh restore, application
validation, and measured RPO/RTO evidence. Status remains `UNVERIFIED` until
that evidence exists.

## Integration and ownership

The RELEASE-004 production deployment sequence is:

```text
deployment lock → config validation → new HOST_PROTECTED pre-migration backup
→ protected-copy verification → migration → rollout → readiness/smoke
```

Migration does not start if the backup gate fails. RELEASE-004 remains the
deployment owner; RELEASE-005 supplies the backup gate and evidence.

The systemd timer/production host runtime owns scheduled backup execution. The
system operator owns backup failure response and restore rehearsal. An
authorized system operator performs production restore. The system operator
and security custodian own secret and Agent-CA escrow. No multi-team approval
workflow is required for this simple v1 deployment.

Future `REMOTE_PROTECTED` transports must reuse this encrypted artifact and
metadata format. RELEASE-006 uses the same immutable OCI artifact, Podman
Compose topology, and verified recovery path for migration compatibility
rehearsal.

## Acceptance plan

The implementation must test successful and failed dump/encryption/copy,
checksum mismatch, unavailable host mount, backup lock contention, incomplete
artifacts, 28-plus-4 retention and holds, corrupt restore, fresh PostgreSQL
restore, schema/application validation, production safety guard, pre-migration
blocking, RPO age calculation, and RTO duration recording. It must not log DB
passwords, storage tokens, CA keys, OIDC secrets, or raw key material.

R1 resolves every operational decision required for implementation. It does
not claim that RPO/RTO are achieved; those remain `UNVERIFIED` until the
measured recovery rehearsal is accepted.
