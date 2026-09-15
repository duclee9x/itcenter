# RELEASE-005 — Backup / Restore + RPO / RTO Validation

**Status:** `CODE_COMPLETE / NOT VERIFIED`
**Readiness:** `N/A`
**Blocker:** None
**Contract:** [RELEASE-005-R1](RELEASE-005-R1_POSTGRESQL_BACKUP_RESTORE_RECOVERY_CONTRACT.md)

RELEASE-005 implements PostgreSQL-native backup, isolated restore,
pre-migration protection, retention, and RPO/RTO evidence commands for the
Podman/Lima deployment. Runtime code and repository checks are complete; RPO
and RTO remain `UNVERIFIED` until the required production-like rehearsal.

RELEASE-005 is independent of RELEASE-004 for design, but its pre-migration
backup gate integrates with the RELEASE-004 deployment sequence. RELEASE-006
must wait for a verified recovery path and migration rehearsal.
