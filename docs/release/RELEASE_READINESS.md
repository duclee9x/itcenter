# Release Readiness Reconciliation

**Assessment date:** 2026-09-14

**Roadmap baseline reviewed:** `af42b52` — `Complete TASK-097 Phase 5 integration gate`

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
Candidate. The decisive blockers are: the API authentication adapter is
implemented but has not been configured and validated against a real staging
OIDC provider; RELEASE-003 readiness is implemented but has not been validated
against staging deployables/orchestrator probes; no staging/production image and
promotion path is present; no production-like migration compatibility
rehearsal exists; no production backup/restore drill or RPO/RTO is evidenced;
and TLS/rate limiting are not supplied by a checked-in deployment edge. Agent
execution additionally remains fail-closed until its real Agent CA and
credentials are configured and mTLS is validated through staging.

Do not bypass fail-closed behavior to clear these findings. Read
[RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md) for actions and acceptance evidence,
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for non-blocking limits, and
[RC_CHECKLIST.md](RC_CHECKLIST.md) for the proposed staging-to-production
procedure.

## Roadmap freeze

The registry and dependency graph contain no unfinished roadmap task that
should be started next. Phase 5 gate passed. No TASK-098 exists or is created
by this assessment, and Phase 6 is not opened. Future features must enter a
newly approved backlog/roadmap. The later RELEASE-001 implementation fulfills
that already approved remediation item; it creates no product task, feature,
or Phase 6 work.

## Release implementation update — RELEASE-001

RELEASE-001-R1 and RELEASE-001-R2 are normative contracts, and
RELEASE-001 runtime is now `CODE_COMPLETE`. Automated tests verify the
provider-neutral OIDC adapter, tenant selector, membership binding and local
RBAC. This resolves the implementation gap, not RR-01: a real staging issuer,
identity provisioning and staging acceptance evidence remain required before
`VERIFIED`. The global decision therefore remains `BLOCKED_FOR_RC`. The contracts require
one configured trusted OIDC issuer, RFC 9068 JWT access tokens, canonical
`(issuer, sub)` provisioning, exactly one required `X-Tenant-ID` on protected
tenant-scoped requests, an active membership bound to the selected
tenant-local User, local RBAC and fail-closed startup. See the
[R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md) and
[R2](items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md)
and [the implementation report](items/RELEASE-001_IMPLEMENTATION_REPORT.md)
record the contract and automated implementation evidence.

## Release implementation update — RELEASE-002

RELEASE-002 runtime is `CODE_COMPLETE`, not `VERIFIED`. Direct Agent Gateway
mTLS, canonical registration/credential lifecycle, one-time enrollment,
rotation and revocation, server-derived tenant/Asset identity, per-session
message receipts, TASK-091 execution binding, audit and auth readiness pass
automated verification. Real private-CA provisioning and mTLS through the
intended RELEASE-007 staging topology remain open under RR-03. Production
Agent execution remains fail-closed until those deployment checks pass.

## Release implementation update — RELEASE-003

RELEASE-003 runtime is `CODE_COMPLETE`, not `VERIFIED`. API, Agent Gateway, and
Worker now calculate readiness from separate deployable profiles. The Worker
profile registers the exact 13 R1 pollers (3 mandatory, 10 degradable), tracks
independent 15-second heartbeats with a 45-second stale limit and 60-second
startup deadline, and recovers workers through supervision. API readiness
consumes the RELEASE-001 auth readiness port; Agent Gateway separates required
mTLS authentication from degradable certificate issuance. All profiles check
database reachability and exact build migration-manifest compatibility. Drain
marks readiness unavailable before listener closure. The implementation and
local verification are recorded in the
[RELEASE-003 report](items/RELEASE-003_IMPLEMENTATION_REPORT.md). Staging must
still prove real configuration, failure/recovery transitions, issuer-only
degradation, orchestrator HTTP behavior, and drain against the immutable
deployment topology before `VERIFIED`.

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

After RELEASE-001 implementation, the uninterrupted repository suite passed
208/208: 80 unit/architecture, 2 contract, 6 migration, 59 integration, and 61
E2E tests. Typecheck, lint, format, migration verification, and diff checks
were rerun for the implementation. The real provider/staging validation
remains outstanding.

The release item reran the complete suite and migration verification against
the existing local PostgreSQL test mechanism. This demonstrates the tested
fresh bootstrap, rerun, checksum rejection, and listed legacy migrations. It
is not a production-like upgrade, locking-duration, N-1 compatibility,
backup, or restore rehearsal.

The original readiness assessment reviewed `af42b52`; at that assessment's
start, the only working tree change was the unrelated user edit to
`AGENTS.md`. The RELEASE-001 implementation and its verification are recorded
in [the implementation report](items/RELEASE-001_IMPLEMENTATION_REPORT.md).

### Subsequent release-contract reconciliation

The original RR-03 observation that the production Agent authentication
profile was unspecified has been resolved by
[RELEASE-002-R1](items/RELEASE-002-R1_PRODUCTION_AGENT_AUTHENTICATION_CONTRACT.md),
which normatively selects per-Agent mTLS credentials, trusted enrollment,
rotation/revocation, server-derived tenant/Asset binding and replay/session
semantics. RELEASE-002 now implements that contract and passes automated
verification; real production-like credentials and staging-topology
validation remain absent. RR-03 remains a production-configuration blocker
for launch scope including Agent execution. Code completion does not verify
deployment.

## Findings summary

| ID    | Type                     | Severity | Finding                                                                                                                                   | Release-blocking                                                          |
| ----- | ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| RR-01 | RELEASE_BLOCKER          | Critical | RELEASE-001 is implemented, but no real OIDC provider configuration or staging acceptance evidence is recorded.                           | Yes                                                                       |
| RR-02 | OPERATIONAL_GAP          | High     | RELEASE-003 readiness is implemented and automated checks pass; staging/orchestrator verification remains.                                | Yes                                                                       |
| RR-03 | PRODUCTION_CONFIGURATION | High     | RELEASE-002 mTLS code is complete, but private-CA provisioning and staging-topology validation remain; Agent execution stays unavailable. | Yes when Agent execution is in launch scope; assumed in this assessment   |
| RR-04 | OPERATIONAL_GAP          | High     | No production build/image, immutable promotion, staging deployment, or rollback procedure is present.                                     | Yes                                                                       |
| RR-05 | DATA_MIGRATION_GAP       | High     | No production-like prior-schema upgrade, lock/duration measurement, N-1 compatibility, or forward-recovery rehearsal is evidenced.        | Yes                                                                       |
| RR-06 | RECOVERY_GAP             | Critical | No production backup/restore procedure, verified restore, RPO/RTO, or pre-migration backup control is evidenced.                          | Yes                                                                       |
| RR-07 | SECURITY_GAP             | Critical | TLS ingress and rate limiting are not implemented/configured in a deployment edge; no production edge policy is evidenced.                | Yes                                                                       |
| RR-08 | OBSERVABILITY_GAP        | High     | Readiness/worker metrics are still process-local; no exporter, tracing, or alert routing is wired.                                        | Yes for monitored production operation                                    |
| RR-09 | PRODUCTION_CONFIGURATION | High     | Production secret, database roles, system-principal grants and capability-specific adapters need deployment provisioning and validation.  | Yes for enabled capabilities                                              |
| RR-10 | PRODUCTION_CONFIGURATION | Medium   | Concrete object/artifact storage and scanning adapters are not wired for artifact-dependent workflows.                                    | Conditional on those workflows being in release scope                     |
| RR-11 | OPERATIONAL_GAP          | Medium   | External broker publishing/acknowledgement and poison-event operations are not deployed; current outbox path is local/database-backed.    | Conditional on broker-dependent integrations                              |
| RR-12 | PERFORMANCE_GAP          | Medium   | There is no production dataset load baseline or measured capacity envelope.                                                               | No for a limited RC; required before capacity claims/scale-up             |
| RR-13 | OPERATIONAL_GAP          | Medium   | Production retention/archive operations for growing append-only records are not configured.                                               | No for initial RC; owner/limits required before sustained production      |
| RR-14 | KNOWN_LIMITATION         | Low      | TASK-094 economic repair-cost evidence is intentionally unavailable without a canonical repair-cost ledger.                               | No, unless complete economic scoring is a release promise                 |
| RR-15 | TECH_DEBT                | Low      | A PostgreSQL client-query deprecation warning is emitted by the Operations Overview request path.                                         | No for current pinned runtime; address before incompatible driver upgrade |

Finding definitions, owner, actions, and verification are in
[RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md). Known product limits are in
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Production configuration that must be supplied

The current production guardrails in `packages/config/src/index.ts` require a
production environment, a file-backed database secret reference, PostgreSQL
TLS `verify-full`, and reject debug authentication bypass, debug logging, and
unsafe migration settings. Keep those protections enabled. Before RC, the
deployment must additionally supply and validate:

- a configured real OIDC/OAuth2 issuer/audience, explicitly provisioned
  IdentityLink and `X-Tenant-ID`-selected tenant-local membership/RBAC, plus
  staging evidence for the RELEASE-001 adapter;
- for TASK-091, an enrolled Agent identity adapter using per-Agent client
  certificates under the RELEASE-002-R1 mTLS contract, credential
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
2. Validate the implemented RELEASE-003 readiness profiles in staging;
   establish the deployment edge, TLS, trusted proxy, rate/size limits, and
   process supervision.
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
