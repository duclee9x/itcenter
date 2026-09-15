# RELEASE-006-R1 — PostgreSQL Migration Compatibility & Rehearsal Contract

| Field              | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Release item       | RELEASE-006 — PostgreSQL Migration Rehearsal + N-1 Compatibility       |
| Type               | Normative planning/specification contract                              |
| Status             | `CODE_COMPLETE`                                                        |
| Runtime            | macOS host → Lima VM → rootless Podman → `podman compose` → PostgreSQL |
| Deployment mode    | `CONTROLLED_MAINTENANCE`, `SINGLE_HOST`, `NO_HA`                       |
| RPO/RTO dependency | RELEASE-005 remains `CODE_COMPLETE / NOT VERIFIED`                     |

## Purpose and boundary

This contract defines the evidence required to migrate a production-like
PostgreSQL database safely and to state which application/schema combinations
are usable. It does not require zero-downtime schema changes, arbitrary
N/N-1 overlap, Kubernetes, a PostgreSQL cluster, or a new orchestration system.
Correctness and truthful rollback behavior take priority over continuous
availability.

RELEASE-006 implementation must use the exact RELEASE-004 migration command
and the same immutable OCI candidate image. It must use the RELEASE-005
pre-migration backup gate in rehearsal. Fixture-based evidence does not mark
RELEASE-005 verified and does not make its RPO/RTO met.

## Version identity

`N` is the candidate application artifact and its expected schema revision.
`N-1` is the immediately previous production-compatible application release
and its expected schema revision; it is not an arbitrary Git commit.

When RELEASE-004 metadata exists, identify both releases by exact OCI digest
and release metadata. During the one transitional period where no historical
immutable artifact exists, an N-1 reference may be:

- an exact committed source revision;
- an exact schema revision;
- a deterministic build/rehearsal artifact; and
- recorded provenance labelled `TRANSITIONAL_N_MINUS_1_REFERENCE`.

No registry digest may be invented. Future rehearsals use actual immutable
release artifacts.

## Compatibility matrix

Every completed rehearsal persists exactly one result for every cell:
`SUPPORTED`, `UNSUPPORTED`, or `NOT_APPLICABLE`.

| Application | Schema | V1 rule                                                       |
| ----------- | ------ | ------------------------------------------------------------- |
| N-1         | N-1    | `SUPPORTED`; mandatory healthy baseline                       |
| N           | N-1    | `UNSUPPORTED` by default; actual rehearsal result is recorded |
| N-1         | N      | `UNSUPPORTED` by default; actual rehearsal result is recorded |
| N           | N      | `SUPPORTED`; mandatory target state                           |

The defaults are release-pair defaults, not a permanent claim about all future
releases. A rehearsal may prove a particular cross-version cell supported;
that evidence applies only to the exact release pair and schema transition.

RELEASE-003 remains exact-schema by default:

```text
MIN_SUPPORTED_SCHEMA_VERSION =
MAX_SUPPORTED_SCHEMA_VERSION = EXPECTED_SCHEMA_VERSION
```

No rehearsal implementation may widen this range by assumption. A separately
documented, tested release-pair result is required before any widening.

## Canonical deployment strategy

The v1 strategy is `CONTROLLED_MAINTENANCE`:

1. acquire the deployment lock and validate configuration;
2. run a successful RELEASE-005 `PRE_MIGRATION` protected backup;
3. drain the API, Agent Gateway and Worker according to RELEASE-003;
4. make readiness `NOT_READY` and stop accepting new work;
5. run the candidate migration from the exact immutable image;
6. validate Schema N and data integrity;
7. start App N, Gateway and Worker;
8. wait for readiness and run safe smoke validation; and
9. record release and rehearsal evidence.

If the backup fails, migration must not start. Caddy may return a bounded
maintenance response or 503. Normal production writes must not be routed to an
old application during an incompatible schema transition.

Before migration, WorkerHost must stop claiming new jobs and safe in-flight
work must drain. If the migration touches Agent/TASK-091 persistence, Agent
Gateway must stop accepting new sessions/work before schema mutation. Existing
authentication and session guarantees remain governed by RELEASE-002.

V1 does not require `ZERO_DOWNTIME_SCHEMA_MIGRATION` or
`ROLLING_SCHEMA_UPGRADE`. A later release may adopt overlap only with new
evidence and an explicit deployment decision.

## Migration budgets and locking

The normative v1 budgets are:

| Setting                      | Value      | Meaning                                       |
| ---------------------------- | ---------- | --------------------------------------------- |
| `lock_timeout`               | 10 seconds | conflicting lock acquisition fails            |
| `statement_timeout`          | 10 minutes | one migration statement fails after the limit |
| overall migration timeout    | 30 minutes | the migration stage fails/escalates           |
| maintenance migration budget | 30 minutes | expected maximum migration execution window   |

The overall timeout is distinct from PostgreSQL session settings. It is not a
promise that PostgreSQL automatically rolls back every operation at exactly
30 minutes. Timeout outcomes are `LOCK_TIMEOUT`, `STATEMENT_TIMEOUT`, or
`OVERALL_MIGRATION_TIMEOUT`; each stops rollout, records evidence, preserves
the pre-migration backup, and requires operator recovery or forward-fix
decision. There are no silent infinite retries.

The migration runner should apply the session-local settings where it can do
so safely. The current advisory lock and per-migration transactions remain;
the complete chain is not assumed atomic. Any required non-transactional
operation must be labelled `NON_TRANSACTIONAL` and document partial state,
completion detection, retry safety, recovery, and forward-fix requirements.

## Migration classification

Rehearsal classifies operations as structural, data migration/backfill,
contracting, or destructive. At minimum, `DROP TABLE`, `DROP COLUMN`,
incompatible type replacement, destructive deletion, irreversible transforms,
and constraints that invalidate old application assumptions are
`DESTRUCTIVE` or `CONTRACTING`.

The current chain includes compatibility-sensitive examples: column rename,
constraint replacement, nullability changes, Agent mTLS schema changes,
legacy SLA-purpose normalization, asset-risk normalization,
monitoring/incident link backfill, and state-history baselines. A data
backfill records affected tables, rehearsal row counts, duration, validation,
and retry/idempotency behavior. A synthetic dataset is labelled `SYNTHETIC`;
absence of production-size data is recorded as `PERFORMANCE_LIMITATION`.

Expand/contract is used when a future release requires overlapping versions,
zero downtime becomes a requirement, or measured migration risk warrants it.
It is not mandatory for this controlled-maintenance transition, and historical
migrations are not rewritten merely to claim rolling compatibility.

## Required rehearsal cases

Every candidate requires both paths:

### Fresh install

```text
empty PostgreSQL
→ complete canonical migration chain
→ Schema N
→ App N startup/readiness and representative validation
```

### N-1 upgrade

```text
valid Schema N-1 + deterministic representative data + healthy App N-1
→ successful pre-migration backup gate
→ candidate migration
→ Schema N and data validation
→ App N, Worker and relevant Gateway validation
```

The N-1 baseline must be `SUPPORTED`. If App N-1 cannot operate against its
own expected schema, the rehearsal is `INVALID`. App N + Schema N-1 and App
N-1 + Schema N are actually exercised where artifacts permit; an unsupported
red cell is acceptable and must not be changed only to make the matrix green.

After Schema N, the rehearsal emits exactly one of:

- `APPLICATION_ROLLBACK_SUPPORTED`, only when the exact App N-1 + Schema N
  pair was proven `SUPPORTED`; or
- `FORWARD_FIX_REQUIRED`, when it was not.

## Data, application and lock validation

After migration, evidence must show the target manifest revision, required
records, transformed values, foreign keys/constraints, indexes, nullability
and absence of unexpected data loss. Migration-specific checks supplement
generic smoke tests.

App N + Schema N must pass startup, RELEASE-003 readiness, database access,
safe representative reads, isolated safe writes and domain paths touched by
the migration. Worker readiness and paths used by the three mandatory workers
are included when affected. Gateway repository/runtime validation is included
when AgentRegistration, AgentCredential or TASK-091 persistence is touched.
Full real OIDC or Agent PKI verification is outside an unrelated schema test;
this shortcut must not mark RELEASE-001 or RELEASE-002 verified.

Rehearsal captures bounded lock evidence where feasible: lock timeout,
strong locks such as `ACCESS EXCLUSIVE`, blocked-query evidence, long
transactions and relevant conflict behavior. Full production write
concurrency is not required during controlled maintenance, but bounded conflict
tests may validate timeout behavior.

Measure separately drain, pre-migration backup, migration, startup/readiness,
smoke and total maintenance duration. Migration duration is not RELEASE-005's
two-hour disaster RTO.

## Failure, retry and recovery

Any migration failure stops rollout; App N is not marked successful, the
pre-migration backup is preserved, and evidence records the failure. There is
no automatic restore, down migration, or blind retry.

Retry is permitted only after the cause, current migration state and
migration-specific retry safety are inspected. Re-running a successful
migration against Schema N must be a safe current-state no-op and must not
reapply destructive work.

After committed Schema N, App N-1 rollback is forbidden unless its exact matrix
cell is `SUPPORTED`. Recovery is either an explicitly authorized RELEASE-005
restore, with its possible post-migration data loss considered, or a
`FORWARD_FIX_REQUIRED` corrective release. Before App N resumes production
writes, restoring the pre-migration backup may be simpler; after new writes,
restore is a deliberate incident decision.

## Rehearsal evidence and acceptance

Each run persists non-secret evidence containing:

```text
rehearsal_id
source_release / target_release
source_schema / target_schema
PostgreSQL version
candidate OCI digest and N-1 reference
pre-migration backup id
migration start/end/duration
lock and timeout results
compatibility matrix
data, App N, App N-1, Worker and Gateway results
maintenance durations
rollback result / forward-fix requirement
final PASS or FAIL
```

`PASS` requires a valid baseline, backup gate, successful N-1→N migration,
Schema N, data validation, supported App N + Schema N, required Worker/Gateway
checks, complete matrix and unambiguous deployment/rollback semantics. It
does not require unsupported cross-version cells to become supported.

The rehearsal always uses a separate Podman Compose project, PostgreSQL volume,
network and non-production configuration. It never defaults to production.
The canonical runtime is Lima + rootless Podman + `podman compose`; Docker and
Kubernetes are not dependencies.

## Release boundaries and approval

A schema-changing RC is not production-approved until the rehearsal passes,
the matrix and rollback/forward-fix mode are recorded, the RELEASE-005 backup
prerequisite is satisfied, and no migration blocker remains.

This R1 does not change RELEASE-005's RPO 6 hours, RTO 2 hours, `age`,
`HOST_PROTECTED`, retention or restore authorization. RELEASE-005 remains
`CODE_COMPLETE / NOT VERIFIED` until age encryption, writable protected copy,
restore rehearsal, measured RPO/RTO and escrow evidence are real.

## R1 completion

The operational decisions required by the prior gap are now fixed:

- `RELEASE-006-R1 = CODE_COMPLETE`;
- clear `SPEC_GAP / OPERATIONAL_DECISION`;
- set `RELEASE-006 = READY / NOT_STARTED`;
- keep `CURRENT_RELEASE_ITEM = RELEASE-006`;
- do not implement RELEASE-006 runtime in this planning run; and
- do not begin RELEASE-007.
