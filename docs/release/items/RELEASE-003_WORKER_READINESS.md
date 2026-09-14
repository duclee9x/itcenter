# RELEASE-003 — Worker Readiness & Background Processing Health

| Field                | Value                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Status               | `NOT_STARTED`                                                                                                                       |
| Readiness            | `READY`                                                                                                                             |
| Blocker              | None; R1 operational contract is complete.                                                                                          |
| Current release item | Yes                                                                                                                                 |
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

## Verified current implementation gap

- `/api/v1/health/live` is currently a lightweight HTTP response independent
  of database/provider checks.
- `/api/v1/health/ready` maps a false callback or exception to HTTP 503.
- API currently checks DB only and does not compose RELEASE-001 auth readiness.
- Agent Gateway checks DB, mTLS auth, and certificate issuer as a single
  readiness result; R1 specifies degradable issuer-only failure if safe
  separation is supported.
- Worker starts 13 pollers but passes `async () => false` to its health
  server. `WorkerHost` tracks task promises only, with no lifecycle registry,
  independent heartbeat, crash classification, or readiness recovery.
- Migration metadata exists in `migration_meta.applied`; readiness does not
  yet validate the exact build migration manifest.

## Implementation boundary

Implement RELEASE-003 only. Do not add a shared scheduler, leader-election
subsystem, external outbox dispatcher, business behavior, or deploy manifests.
RELEASE-004 owns deployment replica constraints and topology. Staging must
later verify real probe behavior before this item can be `VERIFIED`.
