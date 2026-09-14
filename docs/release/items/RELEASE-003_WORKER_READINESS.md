# RELEASE-003 — Worker Readiness & Background Processing Health

| Field                | Value                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Status               | `CODE_COMPLETE`                                                                                                                     |
| Readiness            | `N/A`                                                                                                                               |
| Blocker              | Staging/orchestrator verification remains before `VERIFIED`.                                                                        |
| Current release item | Yes — retain selection for staging verification.                                                                                    |
| Runtime scope        | Deployable-specific liveness/readiness, component registry, WorkerRegistry, worker heartbeat, schema/DB checks, and graceful drain. |

## Authoritative contract

[RELEASE-003-R1 — Production Readiness & Critical Worker Contract](RELEASE-003-R1_PRODUCTION_READINESS_CRITICAL_WORKER_CONTRACT.md)
is `CODE_COMPLETE` and fixes the API, Agent Gateway, and Worker profiles; the
13-worker criticality and replica-mode matrix; state/HTTP aggregation;
heartbeat/startup deadlines; exact schema policy; and drain behavior.

The Worker profile has three `MANDATORY` workers:
`goods-receipt-assetizer`, `contract-alert-expiry`, and
`automation-action-executions`. The other ten are `DEGRADABLE`. All 13 are
`CONCURRENT_SAFE` based on the durable constraints and transaction semantics
recorded in R1. Runtime implementation must register every expected worker;
it may not silently drop one from readiness.

## Implementation result

- `/api/v1/health/live` remains independent of DB, authentication providers,
  and worker state. `/api/v1/health/ready` returns 200 for READY/DEGRADED and
  503 for NOT_READY, with only safe profile/component/reason fields.
- API readiness combines PostgreSQL connectivity, exact migration-manifest
  compatibility, and the RELEASE-001 `AuthenticationPort.isReady()` signal.
- Agent Gateway readiness combines PostgreSQL/schema checks and RELEASE-002
  mTLS authentication. Certificate issuance is separately degradable while
  existing Agent authentication remains usable.
- WorkerHost supervises all 13 R1 pollers through WorkerRegistry. Three are
  mandatory and ten degradable; all retain R1 `CONCURRENT_SAFE` classification
  and their documented durable coordination rationale. Heartbeats run
  independently of business work at 15-second intervals; 45-second staleness,
  60-second startup deadline, crash classification and restart recovery are
  applied.
- The migration runner and readiness use the same deterministic, ordered,
  de-duplicated build manifest with SHA-256 checksums. Readiness compares it to
  `migration_meta.applied` and never runs migrations.
- SIGTERM/controlled shutdown marks readiness NOT_READY before closing the
  listener; WorkerHost enters STOPPING and aborts polling loops before
  dependencies close.
- Automated implementation evidence is in
  [RELEASE-003_IMPLEMENTATION_REPORT.md](RELEASE-003_IMPLEMENTATION_REPORT.md).
  Local test results do not replace staging/orchestrator verification.

## Implementation boundary

Do not add a shared scheduler, leader-election subsystem, external outbox
dispatcher, business behavior, or deploy manifests. RELEASE-004 owns deployment
replica constraints and topology. Staging must verify real probe behavior
before this item can be `VERIFIED`. Do not begin RELEASE-004 automatically.
