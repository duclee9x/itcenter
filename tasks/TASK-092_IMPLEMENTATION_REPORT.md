# TASK-092 Implementation Report

```yaml
task_id: TASK-092
status: CODE_COMPLETE
implementation_status: CODE_COMPLETE
```

## Delivered behavior

The Incident worker consumes `INCIDENT.CREATED` through the durable inbox,
loads tenant-owned Incident, monitoring and TASK-051 topology context, and
persists immutable `CorrelationDecision` and candidate evidence under the
versioned `TASK-092-V1` 0..100 profile. It records evidence contributions and
freshness, creates at most one deterministic active Root cluster for an exact
source key shared by two eligible Incidents, and automatically links only an
authorized, unambiguous strong candidate. Ambiguity creates one human review
Work Item; ordinary `NO_LINK` creates none.

Human reviewers can read correlation history and issue explicit attach,
reject and detach commands. Attach preserves the machine decision and can
record an authorized override of manual-detach suppression. Detach preserves
relationship history and suppresses automatic relinking to that Root until
the Root's active lifecycle ends. Durable constraints, row locks, optimistic
versions and stable evaluation identities protect duplicate delivery,
concurrent Root creation and competing relationships. Correlation does not
close/delete Incidents, rewrite source evidence, call TASK-091 or execute
remediation.

Consumer processing failures use a bounded technical retry policy: five total
attempts with 1/2/4/8-second delays (30-second maximum cap). Exhaustion is
durable and creates one actionable Work Item plus audit/timeline evidence;
successful processing resolves the retry ledger.

## Persistence, API and authorization

Five migrations add the canonical source correlation key, tenant-scoped
`SYSTEM_CORRELATION` principal and permissions, immutable decision/candidate
records, Root relationship history, suppression/override history, deterministic
cluster uniqueness, bounded processing-failure ledger and the correlation
Work Queue source type.

The API exposes `GET /api/v1/incidents/{id}/correlations` and explicit
`correlation-attach`, `correlation-reject` and `correlation-detach` commands.
Mutations require authorization, `expected_version`, idempotency and reason
where applicable; successful commands persist outbox, audit and timeline in
the transaction. Existing generic Incident correlation remains available for
Ticket links and cannot bypass Root relationship governance.

Permissions are `incident.correlation.read`, `.link`, `.review` and `.detach`.
Automatic linking resolves the active tenant's explicit `SYSTEM_CORRELATION`
principal and uses the existing AuthorizationPort with scoped grants. No
principal, grant or wildcard is provisioned by default. A production tenant
must explicitly configure its principal and grant before automatic linking
can succeed.

## Files and migrations

- Runtime: `apps/worker/src/incident-correlation.ts`, worker registration,
  `apps/api/src/server.ts`, Incident domain/application, Identity authorization
  and permissions, Monitoring ingestion, and Work Queue application.
- Migrations: two Identity migrations and one each for Incident, Monitoring
  and Operations.
- Tests: correlation scoring unit tests, PostgreSQL correlation integration
  tests, monitoring normalization tests and an API end-to-end test.
- Normative/traceability updates: data model, retry/idempotency standard,
  master traceability matrix, detailed TASK-092 contract status, registry,
  CURRENT_TASK and handoff.

## Implementation assumptions and limits

The current TASK-051 persistence has fresh observations with `switch_name`,
VLAN and Asset linkage but no persisted topology-edge/failure-domain graph.
For the shared failure-domain signal, TASK-092 uses an exact matching
`switch_name` only when both current observations are TASK-051-classified
`FRESH`; freshness is never recomputed. Same-site context is derived from the
Asset's canonical location ancestry. This is the repository's available
provider-neutral representation of the workflow's shared-upstream-switch
example; a future canonical topology graph may supply a more explicit
failure-domain ancestor.

`source_correlation_key` is stored canonically for deterministic matching,
but outbox/audit evidence exposes only the monitoring-event reference or a
one-way fingerprint. TASK-093's dependencies are satisfied after TASK-092,
but its detailed implementation contract remains absent and blocks its
readiness; no TASK-093 business rules were generated.

## Verification

Full repository verification is recorded below after the final run:

- `npm test` — 128 tests passed: unit 46, contract 2, migration 1,
  integration 26 and E2E 53.
- `npm run typecheck` — passed.
- `npm run lint` — passed, including repository boundary checks.
- `npm run format:check` — passed.
- `git diff --check` — passed.

The TASK-092 PostgreSQL integration subset was rerun after the final fixture
type correction; all five cases passed. API attach/detach E2E also passed.
