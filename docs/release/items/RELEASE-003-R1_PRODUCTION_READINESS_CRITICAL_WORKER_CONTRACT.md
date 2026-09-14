# RELEASE-003-R1 — Production Readiness & Critical Worker Contract

| Field            | Value                                                         |
| ---------------- | ------------------------------------------------------------- |
| Type             | Planning / operational contract only                          |
| Parent           | RELEASE-003 — Worker Readiness & Background Processing Health |
| R1 status        | `CODE_COMPLETE`                                               |
| Parent state     | `READY / NOT_STARTED`                                         |
| Runtime changes  | None; implementation remains RELEASE-003 scope                |
| Release decision | `BLOCKED_FOR_RC`                                              |

## Deployable-specific readiness

Readiness is evaluated independently. There is no global result combining
unrelated subsystems.

| Profile         | Mandatory capabilities                                                                                                                                     | Explicitly excluded                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `API`           | PostgreSQL connectivity; exact supported schema; RELEASE-001 production authentication readiness.                                                          | Agent Gateway/mTLS issuer, Worker health, Reporting freshness, Recommendation source availability.                |
| `AGENT_GATEWAY` | PostgreSQL connectivity; exact supported schema; RELEASE-002 mTLS trust/authentication and credential/registration lookup for existing provisioned Agents. | API OIDC readiness, Worker health, Reporting and Recommendation.                                                  |
| `WORKER`        | PostgreSQL connectivity; exact supported schema; WorkerHost/WorkerRegistry; every `MANDATORY` worker in the selected production profile.                   | HTTP API listener, human OIDC and Agent Gateway health unless a worker explicitly consumes that local dependency. |

Certificate issuance is a separate Agent Gateway capability. If existing
Agent credentials remain verifiable but issuance is unavailable, enrollment
and rotation are unavailable and the profile is `DEGRADED`; existing
authenticated TASK-091 traffic may continue. If the implementation cannot
separate issuance from existing-credential authentication safely, Gateway is
`NOT_READY`. It must not advertise enrollment/rotation as available while the
issuer is down.

## Liveness, component states, and HTTP semantics

`GET /api/v1/health/live` answers only whether the process/event loop is alive
enough that restarting it is appropriate. It returns HTTP 200 while alive and
does no database/provider calls, worker business queries, or projection work.
A temporary dependency outage does not fail liveness.

Component states are `STARTING`, `READY`, `DEGRADED`, `NOT_READY`, and
`STOPPING`. Aggregate states are `READY`, `DEGRADED`, and `NOT_READY`:

- `READY`: all mandatory capabilities are usable and no known degradable
  capability is unavailable.
- `DEGRADED`: all mandatory capabilities remain usable, while one or more
  explicitly degradable capabilities are unavailable.
- `NOT_READY`: a mandatory capability cannot safely perform its production
  responsibility, startup has not completed, or the process is draining.

`GET /api/v1/health/ready` returns HTTP 200 for `READY` and `DEGRADED`, and
HTTP 503 for `NOT_READY`. A mandatory failure may never be represented as
`DEGRADED`. Response fields may include profile, aggregate status, and safe
reason codes only; no secrets, connection details, tenant/user identifiers,
certificate metadata, or stack traces. `/api/v1/health/live` and
`/api/v1/health/ready` remain explicitly public; capabilities stays protected
under RELEASE-001.

## Component and dependency policy

The deployable runtime owns a bounded component registry. Each record exposes
component id/type, state, safe reason code, last successful check where
applicable, and last state-change time; bounded diagnostic metadata is allowed
only when it contains no sensitive values. Expected components come from the
selected launch profile and code configuration; an expected but unregistered
component cannot disappear from health evaluation. State transitions are
logged once and exposed through low-cardinality metrics/reason codes, not
logged on every probe. Metrics cover aggregate/component readiness,
worker lifecycle and heartbeat age, unexpected exit/restart count, DB/schema,
and the relevant API-auth or Agent-auth component; tenant/user/worker-instance
identifiers are not metric labels.

All profiles require PostgreSQL and compatible schema. The DB check is one
minimal bounded read with a short timeout and no business mutation. Temporary
failure makes the affected profile `NOT_READY` while liveness remains healthy;
a later successful check may recover readiness without process restart.

API consumes RELEASE-001's authentication readiness port. Agent Gateway
consumes RELEASE-002's Agent authentication readiness port. Do not duplicate
OIDC/mTLS validation or combine these distinct authorities into an ambiguous
boolean. One deployable's readiness does not depend on components owned by
another deployable.

The current architecture has no separate external/shared outbox dispatcher:
Worker consumers poll database-backed event/outbox records. Do not invent a
`GLOBAL_OUTBOX_DISPATCHER`; classify each actual poller below. Pollers use
independent timers; there is no shared production scheduler readiness
component in v1.

## Schema compatibility policy

The migration runner records applied migration names and SHA-256 checksums in
`migration_meta.applied`. A build must expose its ordered expected migration
manifest (name and checksum). Initial supported range is exact:

`MIN_SUPPORTED_SCHEMA_VERSION = MAX_SUPPORTED_SCHEMA_VERSION = exact manifest
revision expected by this build`.

The applied metadata must match that manifest exactly. Missing, changed,
unknown, or ahead-of-build metadata is `NOT_READY`; no unproven rolling/N-1
range is allowed. Readiness reads only migration metadata, may cache the result
for a bounded short interval, and never runs migrations or full schema
introspection. RELEASE-006 may widen the range only after compatibility
rehearsal proves it.

## Worker registry, startup, heartbeat, and failures

The Worker profile's authoritative in-process registry records each expected
worker's id/type, criticality, replica mode, lifecycle state, start time, last
independent runtime heartbeat, last safe failure reason, and generation where
useful. Heartbeat is independent of business polling and continues while
queues are empty or business work is hourly/daily.

Default heartbeat cadence is 15 seconds. After entering `READY`, a worker is
stale after more than 45 seconds without heartbeat. Operational configuration
may tune these only within bounded values. A handled business-item error under
the existing retry/failure contract does not itself make the worker unhealthy
while its loop remains operational. Empty queues are healthy.

Worker readiness remains `NOT_READY` during startup until WorkerHost and
WorkerRegistry initialize and every mandatory worker registers, initializes,
and emits a first healthy heartbeat. Default startup deadline is 60 seconds.
After it, a missing mandatory worker is `NOT_READY` with
`WORKER_STARTUP_FAILED` and detail reason `WORKER_STARTUP_TIMEOUT`; a missing
degradable worker yields `DEGRADED`. An expected but unregistered
worker follows the same criticality rule. An unexpected crash maps a
mandatory worker to `NOT_READY` and a degradable worker to `DEGRADED`. A
successful supervised restart and fresh heartbeat may recover readiness.

## Complete production poller classification

These are the exact 13 tasks started by `apps/worker/src/main.ts` in the
current full production profile. All are expected and enabled. Each uses an
independent WorkerRegistry runtime heartbeat and lifecycle/startup/failure
state; business polling cadence is not a health timeout.

| Worker (registered name)               | Criticality  | Replica mode      | Durable concurrency / health signal                                                                                                                                       | Correctness rationale                                                                                                                                                                                                 |
| -------------------------------------- | ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `license-entitlement-expiry`           | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent runtime heartbeat; expiry facts unique by tenant, entitlement and term version, with conflict-safe insert.                                                    | Effective license state derives from validity dates. Delay postpones expiry facts/reminders and downstream reactions; canonical entitlement validity remains authoritative and the scan catches up.                   |
| `search-indexer`                       | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent heartbeat; durable inbox uniqueness `(consumer_name,event_id)` and idempotent tenant projection upserts.                                                      | Search is a derived read projection, rebuildable from canonical data/events; delay does not mutate source state.                                                                                                      |
| `goods-receipt-assetizer`              | `MANDATORY`  | `CONCURRENT_SAFE` | Independent heartbeat; per-unit durable inbox identity, `receipt_assetization_state` primary key `(tenant_id,received_unit_id)`, unique received-unit Asset registration. | A posted receipt must complete received-unit-to-Asset registration; indefinitely unrepresented accepted inventory leaves operational state incomplete. Per-unit retry/dedupe permits concurrent replicas.             |
| `contract-alert-expiry`                | `MANDATORY`  | `CONCURRENT_SAFE` | Independent heartbeat; contract rows selected `FOR UPDATE`; alert facts have durable uniqueness by contract/version/trigger.                                              | Performs canonical contract expiry transitions at `end_at`; delay could leave an ended contract active for downstream authorization/operations.                                                                       |
| `cost-provenance-linker`               | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent heartbeat; durable inbox and tenant/event retry identity, idempotent provenance inserts.                                                                      | Cost lineage is derived evidence over canonical procurement facts. Delayed links can catch up and do not change source financial transactions.                                                                        |
| `automation-rule-evaluator`            | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent heartbeat; transactional inbox dedupe, unique evaluation/intent identities, durable conflict coordination.                                                    | TASK-090 decisions/intents persist from durable events. Delay defers governed automation without granting execution authority or mutating source domains; queued events can replay.                                   |
| `automation-conflict-work-items`       | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent heartbeat; transactional inbox uniqueness and idempotent Work Queue materialization.                                                                          | Conflicts are durably represented in Automation and unsafe conflicting execution remains blocked. Work Queue surfacing can catch up without changing the conflict decision.                                           |
| `automation-action-executions`         | `MANDATORY`  | `CONCURRENT_SAFE` | Independent heartbeat; durable inbox/message identity, execution row locking/guarded transitions, durable attempt uniqueness.                                             | TASK-091 owns dispatch/ACK/verification/timeout guarantees, including `DISPATCHED` without ACK becoming `UNKNOWN` after its 30-second contracted timeout. Missing this worker breaks execution lifecycle correctness. |
| `incident-correlation`                 | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent heartbeat; durable inbox, unique evaluation identity, row locks and unique active correlation evidence.                                                       | Produces governed evidence/review candidates; Incidents remain canonical and delayed correlation can reconcile from durable events.                                                                                   |
| `asset-warranty-state-projection`      | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent heartbeat; Asset row `FOR UPDATE` and deterministic projection comparison.                                                                                    | Warranty authority remains in canonical Maintenance records. Asset warranty state is derived and recomputable.                                                                                                        |
| `asset-risk-replacement-scoring`       | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent heartbeat; Asset row coordination, unique assessment evidence identity, and `scoring_latest` primary key/upsert.                                              | Risk/replacement scores are advisory append-only assessments; source state remains safe and assessments can be recalculated.                                                                                          |
| `reporting-governed-kpi-snapshots`     | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent heartbeat; transaction advisory lock keyed by tenant/snapshot identity, row lock, immutable revision sequence.                                                | Snapshot generation is derived analytics with closed-period catch-up. Worker health and KPI freshness remain separate.                                                                                                |
| `recommendation-source-reconciliation` | `DEGRADABLE` | `CONCURRENT_SAFE` | Independent heartbeat; serializable tenant transaction, recommendation row/advisory locks, unique source/generation identities.                                           | Recommendations are explainable projections; source-family unavailability is not worker failure and projections can rebuild from canonical sources.                                                                   |

`CONCURRENT_SAFE` requires the listed durable constraints, transactional
inbox/idempotency, row/advisory locks, or equivalent canonical coordination;
process-local mutexes do not qualify. There is no leader election in this
contract. `SINGLE_REPLICA` is a deployment constraint, not a fake in-process
leader. This inventory establishes no single-replica worker because each
poller's effects have the durable coordination listed above. RELEASE-004 must
deploy the complete Worker profile and preserve these database semantics.
Change a mode only with code evidence and a revised contract.

## Drain and recovery

On SIGTERM or controlled shutdown, readiness becomes `NOT_READY` before the
listener/process drains. API stops accepting new requests under existing HTTP
shutdown behavior. Agent Gateway stops accepting new Agent sessions and closes
existing sessions under RELEASE-002 rules. WorkerHost stops claiming new DB
work before signaling pollers to stop. Already-claimed work may finish safely
or follow existing abort/retry recovery. Resources and leases are released;
the process exits within the existing 10-second forced shutdown bound unless
a stricter contract applies. Health checks introduce no queue, leader election,
or business mutation.

Probes are observational: they never run migrations, dispatch work, reconcile
projections, create snapshots/recommendations, or issue certificates. They use
cached component state plus bounded DB/schema checks, not worker business
queries. Transient dependencies may recover after a later successful bounded
check. Reporting freshness and Recommendation source-family availability
remain business signals distinct from worker health.

## Release verification obligations

RELEASE-003 tests and staging acceptance must prove:

- API with DB/schema/OIDC ready is `READY/200`; DB, schema, or OIDC failure is
  `NOT_READY/503`; other deployable failures do not affect it.
- Agent Gateway with DB/schema/mTLS ready is `READY/200`; issuer-only failure
  is `DEGRADED/200` if existing-credential authentication remains safe,
  otherwise `NOT_READY/503` with the capability separation limitation recorded.
- Worker stays not-ready until mandatory workers register and heartbeat within
  60 seconds; mandatory crash/stale heartbeat is `NOT_READY/503`, degradable
  failure is `DEGRADED/200`, idle queues remain healthy, and recovery restores
  readiness.
- More than 45 seconds without heartbeat is stale after RUNNING; long-cadence
  workers remain healthy on independent heartbeat.
- Exact schema manifest passes; missing/changed/ahead metadata fails; no probe
  runs migrations.
- Drain changes readiness first and prevents new job claims; probes have no
  business side effects.
- Metrics and transition logs are low-cardinality and safe. Protected
  capabilities diagnostics do not redefine public readiness.

RELEASE-004 must encode the three deployment profiles and Worker replica
constraints. RELEASE-006 must prove N/N-1 migration compatibility before the
schema range is widened. RELEASE-007 owns edge exposure and TLS/rate-limit
topology.

## Decision and state

This R1 resolves all operational decisions required for RELEASE-003,
including criticality and replica mode for all 13 workers. No `TBD`, unknown
criticality, unknown replica mode, shared-scheduler component, or fictional
global outbox dispatcher remains. RELEASE-003-R1 is `CODE_COMPLETE`; the
`SPEC_GAP / OPERATIONAL_DECISION` blocker is cleared; RELEASE-003 was set to
`READY / NOT_STARTED` when this contract was completed. RELEASE-004 is outside
this contract; its deployment model is defined by
[RELEASE-004-R1](RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md)
and tracked in [RELEASE_BACKLOG.md](../RELEASE_BACKLOG.md). Overall release
remains `BLOCKED_FOR_RC`.
