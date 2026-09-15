# RELEASE-006 — PostgreSQL Migration Rehearsal + N-1 Compatibility

| Field           | Value                                                                           |
| --------------- | ------------------------------------------------------------------------------- |
| Status          | `CODE_COMPLETE / NOT VERIFIED`                                                  |
| Contract        | [RELEASE-006-R1](RELEASE-006-R1_POSTGRESQL_MIGRATION_COMPATIBILITY_CONTRACT.md) |
| Dependencies    | RELEASE-004, RELEASE-005                                                        |
| Deployment mode | `CONTROLLED_MAINTENANCE`, `SINGLE_HOST`, `NO_HA`                                |
| Runtime         | Lima VM, rootless Podman, `podman compose`                                      |

RELEASE-006 implements the deterministic rehearsal command and evidence path
for fresh
installation, N-1 to N upgrade, data integrity, application/Worker/Gateway
validation, failure behavior, timeout and lock observation, and the exact
compatibility matrix. The approved v1 strategy allows bounded maintenance
downtime and does not require zero-downtime or rolling schema upgrades.

The authoritative decisions are in [RELEASE-006-R1](RELEASE-006-R1_POSTGRESQL_MIGRATION_COMPATIBILITY_CONTRACT.md).
See the [implementation report](RELEASE-006_IMPLEMENTATION_REPORT.md) and use
`deploy/scripts/rehearse-migration.sh` inside the Lima guest for an isolated
run. The implementation does not start RELEASE-007 and preserves
RELEASE-005's separate `CODE_COMPLETE / NOT VERIFIED` status until its
operational evidence exists.
