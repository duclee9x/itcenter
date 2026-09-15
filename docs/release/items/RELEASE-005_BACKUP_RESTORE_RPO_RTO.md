# RELEASE-005 — Backup / Restore + RPO / RTO Validation

**Status:** `READY / NOT_STARTED`
**Readiness:** `READY`
**Blocker:** None
**Contract:** [RELEASE-005-R1](RELEASE-005-R1_POSTGRESQL_BACKUP_RESTORE_RECOVERY_CONTRACT.md)

RELEASE-005 will implement and verify PostgreSQL-native backup, isolated
restore, pre-migration protection, retention, and measured RPO/RTO evidence
for the Podman/Lima deployment. The normative v1 policy is complete; runtime
automation and actual recovery evidence remain to be implemented.

RELEASE-005 is independent of RELEASE-004 for design, but its pre-migration
backup gate integrates with the RELEASE-004 deployment sequence. RELEASE-006
must wait for a verified recovery path and migration rehearsal.
