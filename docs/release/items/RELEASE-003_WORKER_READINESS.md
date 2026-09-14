# RELEASE-003 — Worker Readiness & Background Processing Health

| Field     | Value                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Status    | `BLOCKED / NOT_STARTED`                                                                                                             |
| Readiness | `BLOCKED`                                                                                                                           |
| Blocker   | `SPEC_GAP / OPERATIONAL_DECISION` — required-worker and degraded-operation policy is undefined.                                     |
| Planning  | [RELEASE-003-R1 — Production Readiness & Critical Worker Contract](RELEASE-003-R1_PRODUCTION_READINESS_CRITICAL_WORKER_CONTRACT.md) |
| Runtime   | Not started; runtime work waits for R1 policy resolution.                                                                           |

## Current evidence

- `/api/v1/health/live` is a lightweight process response and does not query dependencies.
- `/api/v1/health/ready` calls the process callback and returns HTTP 503 when it is false or throws.
- API readiness currently checks PostgreSQL. Production OIDC trust is initialized before listen, but `AuthenticationPort.isReady()` is not composed into the probe callback.
- Agent Gateway readiness checks PostgreSQL, Agent authentication and the certificate issuer. The Gateway is a separate deployable and hosts no Worker pollers.
- Worker starts 13 polling tasks in one process and passes `async () => false` to its health server. `WorkerHost` does not track task running state, heartbeat, failure, restart, or per-task readiness.
- The Worker tasks use PostgreSQL-backed polling or scheduled scans. `apps/worker/src/main.ts` starts no external outbox publisher, broker dispatcher, or shared scheduler.

The code behavior is observable, but the release contract does not classify the 13 tasks as mandatory or optional for an approved production launch profile. It also does not set worker-specific heartbeat limits or say whether an optional task failure leaves the combined process routable. R1 must resolve these operational decisions before readiness behavior is implemented.

No product task registry or runtime module is changed by this planning item.
