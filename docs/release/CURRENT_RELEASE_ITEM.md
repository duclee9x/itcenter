# Current Release Item

| Field         | Value                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| Selected item | RELEASE-005 — Backup / Restore + RPO / RTO Validation                                 |
| Priority      | P0                                                                                    |
| Status        | `CODE_COMPLETE / NOT VERIFIED`                                                        |
| Readiness     | `N/A`                                                                                 |
| Blocker       | RPO/RTO and production-like protected restore evidence remain unverified.             |
| Contract      | [RELEASE-005-R1](items/RELEASE-005-R1_POSTGRESQL_BACKUP_RESTORE_RECOVERY_CONTRACT.md) |
| Item          | [RELEASE-005](items/RELEASE-005_BACKUP_RESTORE_RPO_RTO.md)                            |

RELEASE-001 runtime is `CODE_COMPLETE` but not `VERIFIED`; real provider and
staging acceptance remain open. RELEASE-002-R1 fixes Agent authentication as
mTLS with per-Agent certificates and governed enrollment, credential
lifecycle, session, replay and TASK-091 execution binding. RELEASE-002
runtime is `CODE_COMPLETE`; automated verification passes. The production
channel remains unavailable until valid mTLS, CA and database configuration
are deployed and proven through staging.

RELEASE-003 runtime is `CODE_COMPLETE`, but staging/orchestrator verification
remains pending. RELEASE-004-R1 defines immutable artifact lifecycle;
RELEASE-004-R2 aligns runtime to Podman in a Lima Linux VM with
`podman compose`. One OCI image, isolated staging, operator-triggered
deployment, migration-before-rollout, readiness/smoke gates, and exact-digest
rollback/forward-fix semantics remain. RELEASE-004 is `CODE_COMPLETE`, but is
not `VERIFIED`: no clean CI-published digest has yet been deployed through
the intended Linux staging topology.
Overall release remains `BLOCKED_FOR_RC`.

RELEASE-005 is `CODE_COMPLETE / NOT VERIFIED`; its protected backup and restore
rehearsal remain operational verification work. RELEASE-006 is now eligible
from its code dependencies but is not started. RELEASE-007 is now
`READY / NOT_STARTED` because its deployment-topology dependency is
implemented; RELEASE-006 remains `WAITING_DEPENDENCY` on RELEASE-005.
RELEASE-GATE-001 remains blocked on verification evidence. Do not start another
release item automatically. See
[RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
