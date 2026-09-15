# Release Findings and Blockers

Each finding has exactly one primary classification from the release
reconciliation taxonomy. A conditional blocker is blocking when its capability
is included in the approved release scope.

## RR-01 — Production OIDC provider and staging acceptance are not verified

- **Type:** `RELEASE_BLOCKER`
- **Severity:** Critical
- **Affected capability:** API authentication, authorization, all protected user APIs
- **Production impact:** RELEASE-001 runtime is `CODE_COMPLETE` and automated PostgreSQL tests pass, but no production OIDC issuer/audience, IdentityLink provisioning, or local authorization grants have been supplied and validated in staging. Runtime intentionally fails startup or denies access without valid trust configuration; the API is therefore not yet usable for production users.
- **Required action:** Configure the approved provider-neutral OIDC profile using a real staging IdP, provision test identities and tenant-local memberships/RBAC through governed operations, and retain fail-closed behavior for missing or invalid configuration.
- **Verification:** In staging, exercise R1 token, issuer, audience, key rotation and clock-tolerance cases; verify R2 missing/malformed/duplicate header errors, selected-tenant membership and local permission; deny provisioning/tenant/permission negative cases; prove User/membership/permission revocation takes effect; and confirm IdP role/tenant claims grant nothing. RR-01 remains open until staging evidence is recorded.
- **Owner/domain:** Identity / Platform API
- **Release-blocking:** Yes
- **Evidence:** [RELEASE-001 implementation report](items/RELEASE-001_IMPLEMENTATION_REPORT.md); `apps/api/src/main.ts`; `modules/identity/infrastructure/oidc-authentication.ts`; [R1](items/RELEASE-001-R1_PRODUCTION_AUTHENTICATION_CONTRACT.md); [R2](items/RELEASE-001-R2_EXPLICIT_TENANT_CONTEXT_MEMBERSHIP_FOUNDATION.md). Automated implementation evidence does not replace provider/staging verification.

## RR-02 — Deployable readiness has not been validated in staging

- **Type:** `OPERATIONAL_GAP`
- **Severity:** High
- **Affected capability:** Worker deployment, job execution, rollout health
- **Production impact:** RELEASE-003 implements separate API, Agent Gateway, and Worker readiness profiles, exact migration-manifest checks, OIDC/mTLS readiness, the 13-worker registry and readiness-first drain. Automated tests pass, but no staging/orchestrator evidence proves probe behavior, configured production dependencies, or failure/recovery behavior against deployed processes.
- **Required action:** Deploy the same immutable candidate to staging and complete the RELEASE-003 section of the RC checklist for API, Agent Gateway and Worker. Preserve fail-closed semantics and the exact R1 worker policy.
- **Verification:** Record staging evidence for profile isolation; exact schema; mandatory/degradable startup, heartbeat and crash behavior; issuer-only degradation where safe; dependency recovery; readiness-first drain; and side-effect-free probes. RELEASE-003 remains `CODE_COMPLETE`, not `VERIFIED`, until this evidence is accepted.
- **Owner/domain:** Platform / Worker runtime
- **Release-blocking:** Yes
- **Evidence:** [RELEASE-003 implementation report](items/RELEASE-003_IMPLEMENTATION_REPORT.md); `apps/worker/src/main.ts`; `apps/worker/src/host.ts`; [RELEASE-003-R1](items/RELEASE-003-R1_PRODUCTION_READINESS_CRITICAL_WORKER_CONTRACT.md); [RC checklist](RC_CHECKLIST.md).

## RR-03 — Production Agent mTLS and credentials are not verified in staging

- **Type:** `PRODUCTION_CONFIGURATION`
- **Severity:** High
- **Affected capability:** Agent Gateway and self-healing execution
- **Production impact:** RELEASE-002 implements direct Gateway mTLS, Agent registration/credential lifecycle, enrollment, rotation/revocation, server-derived tenant/Asset binding, per-session message receipts, TASK-091 execution binding, audit and fail-closed readiness. No real private Agent CA or staging topology has yet been configured and validated; production Agent execution remains unavailable until that is done.
- **Required action:** Provision the operator-controlled private Agent CA and server/Agent certificates through the approved secret/PKI process. Configure the immutable staging release and validate direct mTLS through the intended RELEASE-007 topology. Keep production fail-closed behavior enabled.
- **Verification:** In staging, prove end-to-end mTLS through the promoted RELEASE-007 topology; test valid/invalid/expired/revoked/unknown Agent, enrollment and rotation, wrong tenant/Asset/execution, message replay, existing-connection revocation, late TASK-091 evidence, audit and readiness. Prove test authentication is rejected.
- **Owner/domain:** Agent Gateway / Automation (TASK-091)
- **Release-blocking:** Yes when Agent execution is in scope; assumed in this assessment
- **Evidence:** [RELEASE-002 item](items/RELEASE-002_PRODUCTION_AGENT_AUTH.md); [implementation report](items/RELEASE-002_IMPLEMENTATION_REPORT.md); [R1 mTLS contract](items/RELEASE-002-R1_PRODUCTION_AGENT_AUTHENTICATION_CONTRACT.md); `apps/agent-gateway/src/main.ts`; `tasks/TASK-091_IMPLEMENTATION_REPORT.md`; `docs/HELPDESK_INCIDENT_MONITORING_AGENT_WORKFLOW.md`.

## RR-04 — Immutable deployment pipeline lacks staging verification

- **Type:** `OPERATIONAL_GAP`
- **Severity:** High
- **Affected capability:** Release packaging and deployment of API, Worker, Agent Gateway
- **Production impact:** RELEASE-004 provides one multi-process OCI image, protected GitHub Actions publication, and digest-based Podman Compose deployment inside Lima Linux, with isolated environment projects, one-shot migration, readiness/smoke gates, staging attestation, exact-schema rollback guard, and guest systemd integration. Podman/Lima compatibility checks are tracked in R2. A clean CI-published digest has not been deployed on a real staging topology, and the registry/approval environment remains to be configured.
- **Required action:** Configure the protected `release-publish` environment and registry secrets; publish an RC from a clean protected commit; provision isolated staging OIDC, Agent CA, database and TLS material; deploy the exact image digest; complete and review RELEASE-001/002/003 evidence; issue the staging attestation. Production migration/promotion remains subject to RELEASE-005/006 readiness and release-owner approval.
- **Verification:** Deploy the clean RC digest to Podman Compose staging in the intended Lima/Linux topology, prove API/Gateway/Worker readiness, real OIDC and Agent mTLS plus tenant/RBAC and drain checks, verify migration and smoke, record acceptance evidence, and confirm any production promotion consumes that identical digest. Exercise exact-digest rollback only when the schema guard permits it; no database rollback claim is made.
- **Owner/domain:** Platform / Release Engineering
- **Release-blocking:** Yes
- **Evidence:** [RELEASE-004 item](items/RELEASE-004_IMMUTABLE_BUILD_STAGING_PROMOTION_ROLLBACK.md); [implementation report](items/RELEASE-004_IMPLEMENTATION_REPORT.md); [R1 contract](items/RELEASE-004-R1_IMMUTABLE_ARTIFACT_DEPLOYMENT_PROMOTION_CONTRACT.md); [R2 alignment](items/RELEASE-004-R2_PODMAN_LIMA_RUNTIME_ALIGNMENT.md); `Dockerfile`; `deploy/compose.yaml`; `.github/workflows/ci.yml`.

## RR-05 — Production migration compatibility is unproven

- **Type:** `DATA_MIGRATION_GAP`
- **Severity:** High
- **Affected capability:** PostgreSQL schema deployment and application rollback
- **Production impact:** The migration runner uses deterministic owner ordering, checksums, an advisory lock and one transaction per migration. Existing tests cover fresh bootstrap, rerun and selected legacy cases, but no production-like prior-schema upgrade, migration duration/lock measurement, N-1 compatibility, deployment ordering, or forward-recovery rehearsal is recorded. A failed migration rolls back that migration; earlier successful migrations remain applied. No down-migration system is established.
- **Required action:** Run `deploy/scripts/rehearse-migration.sh` in the Lima guest with exact N and N-1 metadata, then capture the isolated fresh-install/N-1 upgrade evidence. For RC verification, repeat it with a qualifying candidate artifact, protected pre-migration backup, production-like data shape and accepted runtime/secret provisioning. Measure lock/duration and explicitly test whether N-1 can run after Schema N; if not, use the coordinated rollout and forward recovery already implemented.
- **Contract:** [RELEASE-006-R1](items/RELEASE-006-R1_POSTGRESQL_MIGRATION_COMPATIBILITY_CONTRACT.md) is complete. It fixes controlled maintenance, exact-schema defaults, the four-cell matrix, timeout/lock budgets, destructive/expand-contract classification, partial-failure/retry policy and evidence requirements.
- **Verification:** Capture before/after schema checks, migration logs and timings; test fresh bootstrap and prior-version upgrade; start old/new binaries at each intended rollout boundary; restore the pre-migration backup into isolation and validate.
- **Owner/domain:** Data Platform / Migration owners
- **Release-blocking:** Yes
- **Evidence:** [RELEASE-006 implementation report](items/RELEASE-006_IMPLEMENTATION_REPORT.md); `deploy/scripts/rehearse-migration.sh`; `database/scripts/runner.ts`; `tests/architecture/release006-migration.test.ts`; `tests/migration/migrations.test.ts`. The real qualifying rehearsal remains pending.

## RR-06 — Production backup and restore policy and evidence are incomplete

- **Type:** `RECOVERY_GAP`
- **Severity:** Critical
- **Affected capability:** PostgreSQL data protection and disaster recovery
- **Production impact:** RELEASE-005 now implements the approved six-hour `pg_dump -Fc` schedule, `age` encryption, HOST_PROTECTED off-Lima copies, retention, restore authorization, escrow-reference checks and the pre-migration gate. No production-like protected backup/restore rehearsal or measured RPO/RTO evidence exists yet.
- **Required action:** Provision the writable Lima host mount, age tooling/identity custody and Agent-CA escrow; execute the backup and fresh isolated restore procedure, validate the compatible application image and record measured RPO/RTO.
- **Verification:** Dated restore-drill record with source backup identifier, measured recovery time/data point, integrity checks and application smoke results. Repeat on the agreed cadence and after material storage/migration changes.
- **Owner/domain:** Database Operations / Service Owner
- **Release-blocking:** Yes
- **Evidence:** [RELEASE-005-R1](items/RELEASE-005-R1_POSTGRESQL_BACKUP_RESTORE_RECOVERY_CONTRACT.md); [implementation report](items/RELEASE-005_IMPLEMENTATION_REPORT.md); `deploy/scripts/backup.sh`; `deploy/scripts/restore.sh`; production-like rehearsal remains pending.

## RR-07 — Production network edge controls are not configured

- **Type:** `SECURITY_GAP`
- **Severity:** Critical
- **Affected capability:** Public and internal HTTP endpoints
- **Production impact:** API and Agent Gateway use Node HTTP listeners. No checked-in production ingress/reverse-proxy configuration proves TLS termination, trusted proxy handling or rate limiting. API contract specifications require rate limits, but no application limiter or configured edge policy was found. There is no CORS policy (which is acceptable if no cross-origin browser client is exposed, but must be decided), nor a deployment-level request-size policy. App code does not consume forwarded headers as trusted identity, which should remain the default until proxy trust is explicitly configured.
- **Required action:** Provide a reviewed TLS ingress policy, restrict direct listener exposure, define trusted proxy hops/headers, implement edge or API rate limiting and request-size limits, and configure CORS only for named browser origins if applicable. Keep authentication failure and error responses sanitized.
- **Verification:** External staging scan and positive/negative TLS tests; spoofed forwarded-header test; rate-limit behavior and `429` response; oversized-body rejection; CORS preflight/denial tests if browser access is enabled; ensure no direct unencrypted listener is reachable.
- **Owner/domain:** Security Engineering / Platform Networking
- **Release-blocking:** Yes
- **Evidence:** `apps/api/src/server.ts`; `apps/agent-gateway/src/server.ts`; `packages/observability/src/index.ts`; `docs/API_COMMAND_CONTRACT_SPEC.md` rate-limit and transport requirements; absence of production ingress configuration.

## RR-08 — Metrics, traces, and actionable alerts are not production-wired

- **Type:** `OBSERVABILITY_GAP`
- **Severity:** High
- **Affected capability:** Service operations and incident response
- **Production impact:** `packages/observability/src/index.ts` provides structured console logs and an in-process metrics map, including bounded readiness/worker signals, but no metrics exporter or OpenTelemetry tracer is wired. No alert routing/policies were found for API/DB availability, worker stopped, outbox backlog, repeated job failures, stale Reporting, Recommendation reconciliation failure, execution `UNKNOWN` rate, or disk/storage risk. Readiness implementation does not provide production monitoring/alert delivery by itself.
- **Required action:** Export the existing signals through the organization’s chosen stack; define dashboards and actionable alert routes/owners for the listed failure modes. Validate log retention and request/correlation IDs without recording secrets. This does not require a second observability stack.
- **Verification:** Staging fault-injection/runbook exercise: stop DB/worker, create a controlled job failure and backlog, force a stale projection, and confirm alert delivery, routing, links and recovery signal.
- **Owner/domain:** SRE / Platform Observability
- **Release-blocking:** Yes for monitored production operation
- **Evidence:** `packages/observability/src/index.ts`; `apps/worker/src/main.ts`; no exporter, tracing backend or alert policy found.

## RR-09 — Production identities, permissions, and runtime credentials need provisioning

- **Type:** `PRODUCTION_CONFIGURATION`
- **Severity:** High
- **Affected capability:** Database and system-principal access for Automation, Scoring, Reporting, Recommendation and Procurement read
- **Production impact:** Code/specs preserve tenant-scoped principals and narrow capabilities (including `procurement.cost.read`); the gate found no broad wildcard task grants. However, the repository does not provision production database roles, secret-manager access, or tenant-specific system-principal grants. Permission seeds register permission definitions; they are not a production user/role binding plan.
- **Required action:** Provision distinct migration and runtime DB roles with least privilege; configure secret mounts and rotation; provision only approved, tenant-scoped system principals and capability grants; verify user role assignment and admin bootstrap procedure. Never add a wildcard grant or tenantless principal to work around setup.
- **Verification:** Review deployed grants/roles without exposing credentials; automated effective-permission tests for normal users, administrators and each system principal; cross-tenant negative tests; rotate a staging credential and verify recovery.
- **Owner/domain:** Identity / Database Operations / each domain owner
- **Release-blocking:** Yes for each enabled capability until provisioned
- **Evidence:** `docs/PERMISSION_MATRIX_AUTHORIZATION_POLICY_SPEC.md`; `tasks/TASK-097_IMPLEMENTATION_REPORT.md`; `docs/adr/0001-task000-bootstrap.md`.

## RR-10 — Artifact-dependent workflows have no production object-store/scanner adapters

- **Type:** `PRODUCTION_CONFIGURATION`
- **Severity:** Medium
- **Affected capability:** Software artifacts, contract documents and other evidence/object storage flows
- **Production impact:** Executable wiring uses unavailable object/artifact storage defaults; the bootstrap report explicitly defers object storage. Workflows requiring upload, download, malware scanning or evidence retention cannot be represented as production-ready by local/test adapters.
- **Required action:** If these workflows are in launch scope, configure an approved object-storage adapter, private access policy, scanner, size/type limits, retention and audit controls. Keep unavailable behavior fail-closed until ready.
- **Verification:** Staging upload/download authorization, tenant isolation, scan rejection, size/type rejection, checksum and restore tests; verify no public object access.
- **Owner/domain:** Platform Storage / Software Catalog / Procurement
- **Release-blocking:** Conditional on artifact-dependent workflows being in release scope
- **Evidence:** `apps/api/src/software-artifact-routes.ts`; `apps/api/src/contract-routes.ts`; `apps/agent-gateway/src/server.ts`; `docs/runbooks/TASK-000_IMPLEMENTATION_REPORT.md`.

## RR-11 — External broker delivery operations are not deployed

- **Type:** `OPERATIONAL_GAP`
- **Severity:** Medium
- **Affected capability:** External event publishing, outbox delivery and broker-dependent integrations
- **Production impact:** Transactional outbox/inbox and idempotent consumers exist, but `EventPublisher` has no broker adapter. The repository does not prove broker ACK, retry/backoff, poison-event handling, dead-letter operations or backlog alerting. Database-backed internal polling is not proof of external delivery.
- **Required action:** If release integrations depend on external events, implement/configure the approved publisher and operational policy under its existing contract; otherwise explicitly keep those integrations disabled and document the internal delivery boundary.
- **Verification:** Staging broker outage/restart, duplicate delivery, poison message, retry exhaustion, backlog recovery and consumer idempotency exercises.
- **Owner/domain:** Platform Messaging / Integration owners
- **Release-blocking:** Conditional on broker-dependent integrations
- **Evidence:** `packages/messaging/README.md`; `packages/messaging/src/index.ts`; `docs/adr/0001-task000-bootstrap.md`.

## RR-12 — No production performance baseline

- **Type:** `PERFORMANCE_GAP`
- **Severity:** Medium
- **Affected capability:** Work Queue, Operations Overview, Search, correlation, scoring, Reporting, Recommendation and workers
- **Production impact:** Schema indexes and unit/integration tests exist, but no load profile, production-like dataset query plan or capacity test establishes safe concurrency/latency. No capacity numbers should be claimed.
- **Required action:** Define the intended initial workload and SLOs; test representative reads, writes and workers using sanitized data at expected volume; inspect query plans and connection pool behavior; size with headroom.
- **Verification:** Reproducible load-test report with dataset shape, concurrency, p50/p95/p99, DB utilization, queue/worker lag and acceptance thresholds.
- **Owner/domain:** SRE / Data Platform / domain owners
- **Release-blocking:** No for a limited RC; required before capacity claims or scale-up
- **Evidence:** Repository test inventory and absence of load/benchmark tooling.

## RR-13 — Production retention and archive operations are not configured

- **Type:** `OPERATIONAL_GAP`
- **Severity:** Medium
- **Affected capability:** Audit, outbox, Incident and Work Queue history, assessments, KPI snapshots, Recommendation revisions/interactions
- **Production impact:** Append-only data grows. Normative storage specifications discuss retention/archive, but no production retention schedule, archive execution/verification, partitioning policy or capacity owner was found. Deleting records ad hoc could violate immutable evidence requirements.
- **Required action:** Assign retention classes/owners and define approved archive/hold processes, storage limits, monitoring and restore access. Preserve immutable history; no deletion until a normative retention policy authorizes it.
- **Verification:** Review signed retention schedule; exercise archive/restore on non-production data; alert on growth and capacity thresholds.
- **Owner/domain:** Data Governance / Database Operations / domain owners
- **Release-blocking:** No for initial RC; operational ownership and thresholds required before sustained production
- **Evidence:** `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`; absence of production retention runbook/jobs.

## RR-14 — Repair-cost evidence is intentionally unavailable

- **Type:** `KNOWN_LIMITATION`
- **Severity:** Low
- **Affected capability:** TASK-094 economic replacement scoring
- **Production impact:** No canonical ACTUAL repair-cost ledger exists. TASK-094 returns Economic Repair Pressure as `UNAVAILABLE` and lowers completeness; it does not fabricate spend. Operators must not interpret the score as complete economic evidence.
- **Required action:** No action for release unless complete economic replacement scoring is a launch promise. If required, define a separate canonical cost-source contract and integrate it before making that promise.
- **Verification:** Confirm representative Asset scoring responses expose unavailable evidence and completeness; verify no synthetic repair amount is persisted.
- **Owner/domain:** Asset / Finance
- **Release-blocking:** No, unless complete economic scoring is in approved release scope
- **Evidence:** `tasks/TASK-094_IMPLEMENTATION_REPORT.md`; TASK-094 assessment contract and tests.

## RR-15 — PostgreSQL client-query deprecation in Operations Overview

- **Type:** `TECH_DEBT`
- **Severity:** Low
- **Affected capability:** `GET /api/v1/operations/overview`
- **Production impact:** The Phase 5 full test run emitted PostgreSQL's warning that `client.query()` while the client is already executing a query is deprecated and scheduled for removal in `pg@9.0`. `apps/api/src/server.ts` runs independent `tx.query()` calls with `Promise.all()` inside one `PostgresUnitOfWork`; `packages/persistence/src/index.ts` uses one client per transaction. The focused compatibility E2E passed (1/1, exit 0) while `NODE_OPTIONS=--trace-deprecation` located the call path. The observed current-driver behavior completed successfully, so this is not evidence of a present incorrect result; future driver behavior is the risk.
- **Required action:** Before upgrading to an incompatible `pg` major, serialize queries on a transaction client or provide a transaction-safe query scheduling contract, then retain the Operations Overview regression check.
- **Verification:** Run the focused E2E with deprecation tracing; verify no warning after remediation and pass against the intended PostgreSQL driver major.
- **Owner/domain:** API / Persistence
- **Release-blocking:** No for the currently tested/pinned driver; address before a driver major that removes the behavior
- **Evidence:** `apps/api/src/server.ts` (`/api/v1/operations/overview` uses `Promise.all`); `packages/persistence/src/index.ts`; `tests/e2e/task095-reporting-overview-compatibility.test.ts`; TASK-097 full-suite warning.
