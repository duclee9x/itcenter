# RELEASE-003 Implementation Report

| Field                  | Value                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Status                 | `CODE_COMPLETE`                                                                              |
| Verification           | Automated repository checks pass; staging/orchestrator validation remains, so not `VERIFIED` |
| Authoritative contract | [RELEASE-003-R1](RELEASE-003-R1_PRODUCTION_READINESS_CRITICAL_WORKER_CONTRACT.md)            |
| Release decision       | `BLOCKED_FOR_RC`                                                                             |

## Readiness architecture

Readiness is calculated independently for the `API`, `AGENT_GATEWAY`, and
`WORKER` deployable profiles. Component states are `STARTING`, `READY`,
`DEGRADED`, `NOT_READY`, and `STOPPING`; aggregate states are `READY`,
`DEGRADED`, and `NOT_READY`. A mandatory component failure yields
`NOT_READY`; a degradable failure yields `DEGRADED` only while all mandatory
components remain usable. READY and DEGRADED return HTTP 200. NOT_READY and
drain return HTTP 503. The public response contains only profile, state, and
safe component/reason codes.

`/api/v1/health/live` is independent of the readiness callback and therefore
does not query PostgreSQL, OIDC/JWKS, the Agent CA, or worker state. Health
probes do not mutate business state or run jobs/migrations.

API readiness checks bounded PostgreSQL connectivity, exact schema
compatibility, and the RELEASE-001 authentication readiness port. Worker and
Agent Gateway health do not affect API readiness. Agent Gateway checks
PostgreSQL/schema, RELEASE-002 mTLS authentication, and certificate issuance
separately. Issuer failure yields `DEGRADED` while existing-Agent
authentication remains ready; mTLS/repository failure yields `NOT_READY`.

## Schema and database checks

The migration runner and readiness share one deterministic ordered migration
manifest. Duplicate file entries caused by overlapping ordering ranges are
collapsed while preserving the runner's first occurrence. Each entry includes
its SHA-256 checksum. Readiness compares the complete expected manifest to
`migration_meta.applied`; missing, changed, or extra applied migrations are
incompatible. It performs one bounded read-only `SELECT 1` connectivity check
and a bounded manifest query. Schema results are cached for at most five
seconds. Probes never run migrations.

No RELEASE-003 database migration was required.

## Worker registry and lifecycle

`WorkerRegistry` is the in-process health authority for the exact worker
inventory below. It tracks criticality, lifecycle, start time, last heartbeat,
state transition time, safe failure reason, generation, and restart count.
WorkerHost rejects a task inventory that differs from the expected registry.
Each worker receives an independent runtime heartbeat every 15 seconds;
heartbeat older than 45 seconds is stale. Workers remain STARTING until their
first heartbeat, and a worker that does not become healthy by 60 seconds is
unavailable according to its criticality. Business-item errors handled within
the worker's retry loop do not directly alter runtime health. Unexpected task
exit invalidates readiness and WorkerHost supervises restart; readiness
recovers after a fresh heartbeat.

All 13 definitions use `CONCURRENT_SAFE`, matching R1. Durable coordination
rationale is recorded in the authoritative R1 table.

| Worker                                 | Criticality | Replica mode    |
| -------------------------------------- | ----------- | --------------- |
| `license-entitlement-expiry`           | DEGRADABLE  | CONCURRENT_SAFE |
| `search-indexer`                       | DEGRADABLE  | CONCURRENT_SAFE |
| `goods-receipt-assetizer`              | MANDATORY   | CONCURRENT_SAFE |
| `contract-alert-expiry`                | MANDATORY   | CONCURRENT_SAFE |
| `cost-provenance-linker`               | DEGRADABLE  | CONCURRENT_SAFE |
| `automation-rule-evaluator`            | DEGRADABLE  | CONCURRENT_SAFE |
| `automation-conflict-work-items`       | DEGRADABLE  | CONCURRENT_SAFE |
| `automation-action-executions`         | MANDATORY   | CONCURRENT_SAFE |
| `incident-correlation`                 | DEGRADABLE  | CONCURRENT_SAFE |
| `asset-warranty-state-projection`      | DEGRADABLE  | CONCURRENT_SAFE |
| `asset-risk-replacement-scoring`       | DEGRADABLE  | CONCURRENT_SAFE |
| `reporting-governed-kpi-snapshots`     | DEGRADABLE  | CONCURRENT_SAFE |
| `recommendation-source-reconciliation` | DEGRADABLE  | CONCURRENT_SAFE |

Reporting freshness, Recommendation source availability, and TASK-094 business
states remain separate from worker runtime health.

## Drain and observability

Shutdown invokes the drain transition before closing the HTTP listener. API
and Agent Gateway report NOT_READY while draining. WorkerHost enters STOPPING
and aborts loops before PostgreSQL closes, preventing subsequent polling
iterations from claiming work; in-flight operations continue under their
existing abort/retry contracts. The existing 10-second forced shutdown bound
is retained.

Readiness updates low-cardinality in-process gauges for aggregate/component
state and worker heartbeat age/restart count; worker lifecycle transitions
are logged with bounded worker names and reason codes. No exporter or alert
route is added here: production metrics export and alert delivery remain under
the existing `OBSERVABILITY_GAP` finding RR-08. No shared scheduler or leader
election is introduced.

## Verification

`npm test` passed: **230 tests** across unit/architecture (97), contract (2),
migration (6), integration (61), and E2E (64). The migration suite verifies
fresh bootstrap, rerun/checksum rejection, existing legacy cases, and exact
equality between the applied ledger and build manifest. A PostgreSQL
integration test verifies exact schema readiness, extra-migration rejection,
recovery after metadata correction, and absence of probe-side migration writes.
Other readiness tests cover
state aggregation, safe response projection, bounded readiness caching, the
13-worker inventory/criticality/replica policy, heartbeat staleness and
recovery, startup timeout, WorkerHost crash recovery/drain, PostgreSQL/schema
readiness, health HTTP semantics, API auth readiness, and Agent issuer-only
degradation.

Also required and passed for this implementation: `npm run typecheck`,
`npm run lint` (including boundary checks), `npm run format:check`,
`npm run test:migration`, and `git diff --check`. PostgreSQL integration and
E2E suites ran against the disposable local PostgreSQL test mechanism. The
existing PostgreSQL client-query deprecation warning remains documented as
TECH_DEBT RR-15; this work does not hide or change it.

## Remaining verification

RELEASE-003 is not `VERIFIED` until staging proves the three deployable
profiles with real configured dependencies and the intended orchestrator
topology. Required evidence includes database/schema/auth failure and recovery,
worker startup/heartbeat/crash classification, idle-worker health,
issuer-only degradation, readiness-first drain, and no probe side effects.
RELEASE-001 real IdP validation, RELEASE-002 real CA/mTLS validation, and
RELEASE-004 deployment topology are separate pending release work. RELEASE-004
was not started by this implementation.
