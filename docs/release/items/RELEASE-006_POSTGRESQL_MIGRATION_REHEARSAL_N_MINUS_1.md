# RELEASE-006 — PostgreSQL Migration Rehearsal + N-1 Compatibility

| Field | Value |
| --- | --- |
| Status | `READY / NOT_STARTED` |
| Contract | [RELEASE-006-R1](RELEASE-006-R1_POSTGRESQL_MIGRATION_COMPATIBILITY_CONTRACT.md) |
| Dependencies | RELEASE-004, RELEASE-005 |
| Deployment mode | `CONTROLLED_MAINTENANCE`, `SINGLE_HOST`, `NO_HA` |
| Runtime | Lima VM, rootless Podman, `podman compose` |

RELEASE-006 will implement and run migration rehearsal evidence for fresh
installation, N-1 to N upgrade, data integrity, application/Worker/Gateway
validation, failure behavior, timeout and lock observation, and the exact
compatibility matrix. The approved v1 strategy allows bounded maintenance
downtime and does not require zero-downtime or rolling schema upgrades.

The authoritative decisions are in [RELEASE-006-R1](RELEASE-006-R1_POSTGRESQL_MIGRATION_COMPATIBILITY_CONTRACT.md).
This item is ready for a later implementation run. It must not start
RELEASE-007 automatically, and it must preserve RELEASE-005's separate
`CODE_COMPLETE / NOT VERIFIED` status until its operational evidence exists.
