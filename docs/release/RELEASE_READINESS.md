# Release Readiness Reconciliation

**Assessment date:** 2026-09-14

**Repository HEAD:** `af42b52` — `Complete TASK-097 Phase 5 integration gate`

**Roadmap state:** Phase 5 `PASSED`; TASK-097 `CODE_COMPLETE / VERIFIED`; no later roadmap task is authorized or inferred.

**Decision:** `BLOCKED_FOR_RC`

## Scope and decision

This is a deployment-readiness assessment, not a new product task. It assumes
the intended release is the implemented IT Operations Hub through Phase 5,
including authenticated API use and TASK-091 Agent execution where enabled.
If launch scope is explicitly narrowed, capability-specific blockers below
may be excluded only by a recorded release-scope decision. Authentication,
tenant isolation, database recovery, safe migration, and deployment controls
remain required for any production release.

The repository is not ready to produce and promote a production Release
Candidate. The decisive blockers are: the executable API has no production
authentication/authorization adapters and therefore denies access; worker
readiness is intentionally false until required adapters are installed; no
staging/production image and promotion path is present; no production-like
migration compatibility rehearsal exists; no production backup/restore drill
or RPO/RTO is evidenced; and TLS/rate limiting are not supplied by a checked-in
deployment edge. Agent execution additionally remains fail-closed until its
real enrolled-Agent authentication adapter is configured.

Do not bypass fail-closed behavior to clear these findings. Read
[RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md) for actions and acceptance evidence,
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for non-blocking limits, and
[RC_CHECKLIST.md](RC_CHECKLIST.md) for the proposed staging-to-production
procedure.

## Roadmap freeze

The registry and dependency graph contain no unfinished roadmap task that
should be started next. Phase 5 gate passed. No TASK-098 exists or is created
by this assessment, and Phase 6 is not opened. Future features must enter a
newly approved backlog/roadmap. This reconciliation makes no runtime changes.

## Release planning update — RELEASE-001-R1

The subsequent planning commit completed RELEASE-001-R1 as a normative
security contract. RELEASE-001 is now `NOT_STARTED / READY`; the production
API adapter is still absent. This resolves its planning/specification blocker,
not RR-01: RR-01 remains a `RELEASE_BLOCKER` until the runtime adapter and
staging acceptance evidence pass. The global decision therefore remains
`BLOCKED_FOR_RC`. The contract requires one configured trusted OIDC issuer,
RFC 9068 JWT access tokens, canonical `(issuer, sub)` provisioning, explicit
local tenant membership, local RBAC and fail-closed startup. See the R1 item
for the complete acceptance contract.

## Evidence and verification baseline

The Phase 5 gate report, [TASK-097_IMPLEMENTATION_REPORT.md](../../tasks/TASK-097_IMPLEMENTATION_REPORT.md),
records a successful uninterrupted verification run:

| Gate                     |                                                                       Recorded result |
| ------------------------ | ------------------------------------------------------------------------------------: |
| `npm test`               | 195/195 passed: 71 unit/architecture, 2 contract, 6 migration, 56 integration, 60 E2E |
| `npm run typecheck`      |                                                                                  PASS |
| `npm run lint`           |                                                       PASS, including boundary checks |
| `npm run format:check`   |                                                                                  PASS |
| `npm run test:migration` |                                                                                  PASS |
| `git diff --check`       |                                                                                  PASS |

This assessment reran `npm run test:migration` against the existing local
PostgreSQL test mechanism: **6/6 passed**. That demonstrates the tested fresh
bootstrap, rerun, checksum rejection, and listed legacy migrations. It is not
a production-like upgrade, locking-duration, N-1 compatibility, backup, or
restore rehearsal. The full suite was not rerun because this change is
documentation-only and the Phase 5 baseline is unchanged.

The exact commit reviewed is `af42b52`. At assessment start, the only working
tree change was the unrelated user edit to `AGENTS.md`; it remains outside
these release documents and outside their commit.

## Findings summary

| ID    | Type                     | Severity | Finding                                                                                                                                    | Release-blocking                                                          |
| ----- | ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| RR-01 | RELEASE_BLOCKER          | Critical | Executable API authentication and authorization are fail-closed; production identity adapters are absent.                                  | Yes                                                                       |
| RR-02 | OPERATIONAL_GAP          | High     | Worker readiness is fixed false until delivery/runtime adapters are wired; no deployable worker readiness contract is demonstrated.        | Yes                                                                       |
| RR-03 | PRODUCTION_CONFIGURATION | High     | TASK-091 Agent authentication adapter is absent; Agent execution must remain disabled until real enrolled-Agent credentials are validated. | Yes when Agent execution is in launch scope; assumed in this assessment   |
| RR-04 | OPERATIONAL_GAP          | High     | No production build/image, immutable promotion, staging deployment, or rollback procedure is present.                                      | Yes                                                                       |
| RR-05 | DATA_MIGRATION_GAP       | High     | No production-like prior-schema upgrade, lock/duration measurement, N-1 compatibility, or forward-recovery rehearsal is evidenced.         | Yes                                                                       |
| RR-06 | RECOVERY_GAP             | Critical | No production backup/restore procedure, verified restore, RPO/RTO, or pre-migration backup control is evidenced.                           | Yes                                                                       |
| RR-07 | SECURITY_GAP             | Critical | TLS ingress and rate limiting are not implemented/configured in a deployment edge; no production edge policy is evidenced.                 | Yes                                                                       |
| RR-08 | OBSERVABILITY_GAP        | High     | Metrics are process-local, there is no exporter/tracing/alert routing, and required worker readiness currently remains false.              | Yes for monitored production operation                                    |
| RR-09 | PRODUCTION_CONFIGURATION | High     | Production secret, database roles, system-principal grants and capability-specific adapters need deployment provisioning and validation.   | Yes for enabled capabilities                                              |
| RR-10 | PRODUCTION_CONFIGURATION | Medium   | Concrete object/artifact storage and scanning adapters are not wired for artifact-dependent workflows.                                     | Conditional on those workflows being in release scope                     |
| RR-11 | OPERATIONAL_GAP          | Medium   | External broker publishing/acknowledgement and poison-event operations are not deployed; current outbox path is local/database-backed.     | Conditional on broker-dependent integrations                              |
| RR-12 | PERFORMANCE_GAP          | Medium   | There is no production dataset load baseline or measured capacity envelope.                                                                | No for a limited RC; required before capacity claims/scale-up             |
| RR-13 | OPERATIONAL_GAP          | Medium   | Production retention/archive operations for growing append-only records are not configured.                                                | No for initial RC; owner/limits required before sustained production      |
| RR-14 | KNOWN_LIMITATION         | Low      | TASK-094 economic repair-cost evidence is intentionally unavailable without a canonical repair-cost ledger.                                | No, unless complete economic scoring is a release promise                 |
| RR-15 | TECH_DEBT                | Low      | A PostgreSQL client-query deprecation warning is emitted by the Operations Overview request path.                                          | No for current pinned runtime; address before incompatible driver upgrade |

Finding definitions, owner, actions, and verification are in
[RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md). Known product limits are in
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Production configuration that must be supplied

The current production guardrails in `packages/config/src/index.ts` require a
production environment, a file-backed database secret reference, PostgreSQL
TLS `verify-full`, and reject debug authentication bypass, debug logging, and
unsafe migration settings. Keep those protections enabled. Before RC, the
deployment must additionally supply and validate:

- a real OIDC/OAuth2 user identity verifier and canonical user/tenant mapping,
  plus a real authorization policy adapter;
- for TASK-091, a mutually authenticated enrolled-Agent identity adapter
  (mTLS or workload identity under the existing contract), credential
  issuance, rotation and revocation;
- secret-manager mounted credentials, dedicated migration/runtime database
  roles, tenant-scoped system-principal grants, and narrow capability
  permissions;
- verified TLS termination and an explicit trusted-proxy boundary, request
  rate limits, request-size limits, and any required cross-origin policy;
- production PostgreSQL endpoint/certificate trust, connection/pool limits,
  backup targets, and operational alert destinations;
- concrete object storage/scanning adapters when artifact-dependent features
  are enabled.

No secret values belong in this document or in source control.

## Recommended remediation order

1. Confirm the launch capability scope. Configure real API identity and
   authorization; configure enrolled-Agent authentication if self-healing is
   included. Validate tenant mapping and negative authorization cases in
   staging.
2. Establish the deployment edge and readiness contract: TLS, trusted proxy,
   rate/size limits, real worker readiness, and process supervision.
3. Produce a signed/traceable immutable application image or artifact and a
   staging-to-production promotion pipeline that uses that same identifier.
4. Rehearse migrations against a production-like previous schema. Measure
   duration/locks, test runtime roles, establish expand/forward-fix behavior,
   and record whether N-1 can operate during/after migration.
5. Set backup/restore ownership and RPO/RTO; perform a restore into an
   isolated database and verify application-level integrity before any
   production data migration.
6. Export metrics/logs, configure actionable alerts, and verify API, DB,
   workers, outbox, execution, Reporting and Recommendation signals.
7. Run the RC checklist, including safe smoke tests, capacity observation,
   security/configuration checks, and explicit release acceptance.

These are proposed `RELEASE-*` work items for approval, not tasks created or
implemented in this reconciliation.
