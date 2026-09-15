# Current Release Item

| Field         | Value                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| Selected item | RELEASE-007 — Production TLS Ingress + Rate Limiting                                 |
| Priority      | P0                                                                                   |
| Status        | `READY / NOT_STARTED`                                                                |
| Readiness     | `READY`                                                                              |
| Blocker       | None; RELEASE-007-R1 is complete.                                                    |
| Contract      | [RELEASE-007-R1](items/RELEASE-007-R1_PRODUCTION_EDGE_TLS_RATE_LIMITING_CONTRACT.md) |
| Item          | [RELEASE-007](items/RELEASE-007_PRODUCTION_TLS_INGRESS_RATE_LIMITING.md)             |

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
rehearsal remain operational verification work. RELEASE-006 is
`CODE_COMPLETE / NOT VERIFIED`; its isolated rehearsal infrastructure is
implemented, but qualifying N-1 and production-like evidence remain open.
RELEASE-007 is `READY / NOT_STARTED` after completion of its edge security
contract. No runtime edge change has started; implementation must preserve
direct Agent mTLS and the Podman/Lima topology.
RELEASE-GATE-001 remains blocked on verification evidence. Do not start another
release item automatically. See
[RELEASE_BACKLOG.md](RELEASE_BACKLOG.md) and
[RELEASE_DEPENDENCY_GRAPH.md](RELEASE_DEPENDENCY_GRAPH.md).
