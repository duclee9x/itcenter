# RELEASE-003-R1 — Production Readiness & Critical Worker Contract

| Field        | Value                                                         |
| ------------ | ------------------------------------------------------------- |
| Type         | Planning / operational-contract remediation only              |
| Parent       | RELEASE-003 — Worker Readiness & Background Processing Health |
| Parent state | `BLOCKED / NOT_STARTED`                                       |
| Blocker      | `SPEC_GAP / OPERATIONAL_DECISION`                             |
| Runtime      | Not authorized in R1                                          |

## Purpose

Resolve the production policy needed before RELEASE-003 can implement deployable readiness. This artifact records verified repository behavior and isolates unresolved operational decisions. It does not select critical workers, classify optional capabilities, define production cadence limits, or change runtime behavior by inference.

## Verified runtime baseline

### Health routes and deployable ownership

`packages/observability/src/index.ts` serves public `GET /api/v1/health/live` as a lightweight process response. It does not call readiness or query dependencies. `GET /api/v1/health/ready` calls the process callback, returns HTTP 200 when it resolves true, and maps false or an exception to the safe HTTP 503 dependency-unavailable response.

The API deployable starts no background workers. Its main module initializes production OIDC discovery/JWKS before opening the listener and currently passes `databaseReady(pool)` as the readiness callback. The OIDC adapter implements `AuthenticationPort.isReady()`, but API readiness does not compose it. API capabilities remain protected.

Agent Gateway is a separate deployable. Its readiness callback checks database reachability, Agent authentication readiness and certificate-issuer readiness for the configured production mTLS path. It does not host Worker pollers.

Worker starts its loops and serves health from the same process. Its callback is currently `async () => false`, so the endpoint remains not-ready regardless of loop state.

### Background task inventory

`apps/worker/src/main.ts` starts these 13 long-running tasks in one `WorkerHost`:

| Worker task name                       | Current observed cadence / mechanism                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `license-entitlement-expiry`           | Poll/scan cycle of 60 seconds.                                                   |
| `search-indexer`                       | Durable outbox/inbox polling, typically 1-second idle and 2-second error delays. |
| `goods-receipt-assetizer`              | Durable receipt polling, typically 1-second idle and 2-second error delays.      |
| `contract-alert-expiry`                | Poll cycle of 5 seconds.                                                         |
| `cost-provenance-linker`               | Durable provenance polling, typically 1-second idle and 2-second error delays.   |
| `automation-evaluator`                 | Durable event polling, typically 1-second idle and 2-second error delays.        |
| `automation-conflict-work-items`       | Durable event polling at approximately 1 second.                                 |
| TASK-091 automation execution consumer | Execution message/timeout polling at approximately 1 second.                     |
| TASK-092 incident correlation consumer | Durable event polling, approximately 1-second idle and 1.5-second retry delay.   |
| `asset-warranty-state-projection`      | Poll cycle of 60 seconds.                                                        |
| `asset-risk-replacement-scoring`       | Scheduled scan hourly.                                                           |
| `reporting-governed-kpi-snapshots`     | Five-minute catch-up cycle for closed periods.                                   |
| `recommendation-source-reconciliation` | Scheduled scan every 60 seconds.                                                 |

These are current-code cadences, not approved health thresholds. Some loops catch errors and continue; `WorkerHost` stores task promises but does not expose whether a task is running, idle, stuck, failed, or restarting. No process-level task registry or per-task heartbeat exists.

### Dependencies, scheduling, delivery, and shutdown

- PostgreSQL is used by API business requests and all listed Worker tasks. `databaseReady` performs a zero-row query against `platform.outbox_events`; it does not validate migration/schema compatibility beyond that relation being queryable.
- Tasks use database-backed queues, inbox/outbox rows, idempotency and scheduled scans. Worker main starts no external outbox publisher or broker dispatcher. The messaging package documents that no broker adapter is present.
- There is no shared scheduler service or configured leader-election/lease registry for these tasks. Individual tasks poll on their own timers. Particular paths use row locks, `SKIP LOCKED`, inbox deduplication and idempotency, but these do not define one uniform multi-replica readiness contract for every task.
- API OIDC trust initializes before listen. Agent mTLS readiness is owned by Agent Gateway. These capabilities must remain deployable-specific and must not make unrelated processes fail readiness.
- `WorkerHost.stop()` aborts its shared signal and awaits task promises. The process shutdown helper closes the HTTP server before dependencies and has a 10-second forced-exit bound. There is no readiness-draining state.
- Existing observability provides structured console logs and process-local metrics. Worker functions report fixed error events, but no worker health registry, exporter, or readiness-transition log exists.

## Contract gap requiring an operational decision

Existing specifications establish that DB may be a critical readiness dependency, health checks must be cheap, and production Worker readiness must reflect required adapters. They do not normatively answer:

1. **Launch profile and criticality:** Which of the 13 named tasks are required for the default production release, which may be disabled/optional, and whether that changes with enabled capabilities. Decide whether all tasks share one Worker readiness result or readiness is exposed per independently deployable/capability group.
2. **Degraded semantics:** Whether an optional task failure produces `DEGRADED` while HTTP readiness remains 200, or another explicit behavior. A mandatory task failure must never be hidden as routable readiness.
3. **Startup and failure detection:** Startup grace and worker-specific heartbeat/progress timeout for each polling cadence, including the distinction between idle/no business work and a stuck loop. Current cadence differences do not justify one universal timeout.
4. **Outbox/event delivery:** Whether local database outbox/inbox processing is the whole required delivery contract, whether an external publisher is enabled only for selected integrations, and which state affects readiness versus operational alerts.
5. **Scheduler and replica operation:** Whether production supports multiple Worker replicas, required standby/leader/lease semantics, and readiness for a healthy non-leader. Current per-task locks do not define global Worker leadership policy.
6. **Schema and recovery state:** The authoritative cheap schema-compatibility check and expected readiness recovery after DB/task restart.
7. **Drain policy:** The required transition to not-ready and stop-accepting behavior before graceful shutdown, including how in-flight work completes or becomes recoverable within the existing shutdown bound.

These choices affect whether automation execution, correlation, scoring, Reporting, Recommendation, search and scheduled lifecycle processing can be advertised as operational when one poller is unavailable. Choosing a list in runtime code would silently decide production scope and degraded-operation policy.

## Required R1 resolution artifact

Before RELEASE-003 runtime begins, an approved normative decision must provide:

- a deployable/capability matrix naming each Worker task as mandatory, optional/degraded, or disabled for the approved launch profile;
- the mandatory dependency set for API, Worker and Agent Gateway separately;
- deterministic `READY`, `NOT_READY`, `DEGRADED`, and `UNKNOWN` aggregation, including the HTTP status for degraded state;
- per-task startup grace and heartbeat/progress stale thresholds, or an explicit proof that process-running/DB access suffices for a given task;
- outbox, scheduler, multi-replica/standby, schema compatibility and graceful-drain policy;
- source of readiness state and safe reason codes, without secrets or tenant/user details in public probes.

The resulting contract must preserve TASK-090/091/092/094/095/096 business semantics. It must not add a scheduler, worker subsystem, broker, or alerting platform as a workaround for missing policy. RELEASE-003-R1 itself does not modify runtime, migrations, product TASK records, or RELEASE-004.

## Decision and next state

Because critical-worker and degraded-operation policy is not defined, RELEASE-003 remains `BLOCKED / NOT_STARTED` with blocker `SPEC_GAP / OPERATIONAL_DECISION`. Resolve the decisions above in a normative contract before setting RELEASE-003 to `READY / NOT_STARTED`. Overall release remains `BLOCKED_FOR_RC`; RELEASE-004 is not started.
