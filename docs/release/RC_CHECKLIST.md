# Release Candidate Checklist

This procedure is proposed for a future RC. Do not run it against production
until all release blockers in [RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md) are
closed and the release scope is approved. Smoke operations below are read-only
or use explicitly disposable staging fixtures.

## Entry gate

- [ ] Approved launch scope lists enabled capabilities, including whether
      TASK-091 Agent execution, artifact workflows and external broker
      integrations are included.
- [ ] `RELEASE_READINESS.md` decision is `READY_FOR_RC`; no unresolved
      release-blocking finding remains for the enabled scope.
- [ ] Phase 5 remains verified at the selected source commit; changes since
      `af42b52` have their own reviewed test evidence.
- [ ] Release owner, security reviewer, DB operator, service owner and rollback
      decision-maker are named.

## Build and artifact identity

- [ ] Build from a reviewed immutable commit.
- [ ] Record commit SHA, image/artifact digest, dependency lockfile, build
      provenance and SBOM/signature where the chosen platform supports them.
- [ ] Use one immutable digest across migration rehearsal, staging and
      production promotion; do not rebuild between environments.
- [ ] Confirm environment configuration and secret references are injected at
      deploy time and are absent from the artifact/logs.

## Migration rehearsal and recovery

- [ ] Create an isolated, production-like PostgreSQL environment from the
      expected previous schema/data shape using approved sanitized data.
- [ ] Take and identify a pre-migration backup.
- [ ] Apply the exact release migrations with the production migration role;
      record order, elapsed time, lock impact and any blocked queries.
- [ ] Verify constraints, indexes, tenant ownership and legacy UNKNOWN/coverage
      semantics; confirm no history or classification was fabricated.
- [ ] Test old/new application compatibility at each rollout boundary. If
      N-1 is incompatible after migration, use the approved coordinated
      forward-fix plan; do not assume binary rollback is safe.
- [ ] Restore the pre-migration backup to an isolated database and verify
      schema, sample tenant-scoped reads, append-only evidence and application
      health. Record measured recovery time/data point against approved RTO/RPO.

## Staging deployment

- [ ] Provision TLS ingress, trusted proxy settings, rate and request-size
      limits, named CORS origins if needed, and restricted direct listener
      access.
- [ ] Provision verified PostgreSQL TLS, separate least-privilege migration
      and runtime roles, secret-manager mounts and credential rotation path.
- [ ] Configure the RELEASE-001-R1 provider-neutral OIDC issuer and API
      audience. Verify only RFC 9068 JWT access tokens are accepted (never ID
      or refresh tokens), RS256 signature/JWKS rotation, exact issuer/audience,
      `exp`/`nbf`, 30-second default and 60-second maximum clock tolerance,
      and the recommended 10-minute maximum token lifetime.
- [ ] Verify explicit IdentityLink provisioning by `(issuer, sub)`, active
      canonical user status, explicit requested tenant plus active local
      TenantMembership, and local RBAC/resource authorization. Prove email or
      IdP role/group/tenant claims cannot grant or transfer platform access;
      verify local permission/membership revocation while a token remains
      cryptographically valid.
- [ ] Verify OIDC configuration failure keeps startup/readiness fail-closed;
      unknown `kid` performs only bounded trusted-JWKS refresh; unavailable
      JWKS without a valid cached key fails closed; no mock, anonymous,
      default-admin or local-password fallback is enabled.
- [ ] If TASK-091 is enabled, provision real enrolled-Agent mTLS/workload
      identity. Exercise rotation/revocation and negative identities. Never use
      fake/test authentication in staging or production.
- [ ] Configure only approved tenant-scoped system principals and narrow
      capabilities; review effective grants and absence of wildcard/tenantless
      authority.
- [ ] Configure concrete object storage/scanning and/or external event
      publishing only if those capabilities are in scope. Otherwise keep the
      affected routes/integrations disabled and fail-closed.
- [ ] Confirm DB/API/Agent Gateway/Worker readiness reflects actual dependency
      health. Worker must not be marked ready while its required adapters are
      absent.

## Health and safe smoke tests

Record environment, build digest, timestamp, operator and result for each
check. Use a dedicated staging tenant and disposable fixtures; no destructive
production tests are allowed.

- [ ] Authentication: valid user succeeds; missing, expired, invalid and
      wrong-audience credentials fail closed.
- [ ] Authorization and tenant isolation: permitted same-tenant read succeeds;
      insufficient permission and cross-tenant access fail without metadata
      leakage.
- [ ] Ticket lifecycle: read a disposable fixture and verify the canonical
      lifecycle summary; do not resolve/close production tickets as a smoke
      test.
- [ ] Incident lifecycle: read an authorized fixture and correlation history;
      do not attach/detach or transition a production incident.
- [ ] Asset query: read an authorized asset fixture; do not assign, dispose or
      trigger replacement.
- [ ] Work Queue: read tenant-scoped actionable work and confirm no duplicate
      source records; do not resolve production work.
- [ ] SLA: read a known fixture/evaluation and verify canonical final outcome
      and typed target purpose; do not alter target configuration.
- [ ] Search: query an authorized fixture and verify tenant/RBAC filtering;
      do not use Search as a canonical write or KPI source.
- [ ] Reporting: query one governed KPI and verify definition version,
      as-of/freshness, source status and tenant scope. Use a disposable test
      period where data mutation is required.
- [ ] Recommendation: read a permitted feed and verify family availability,
      source authorization and no source-side mutation. Interactions only on a
      disposable actor/recommendation fixture.
- [ ] Worker health: verify worker readiness, scheduled/reconciliation job
      heartbeat, graceful stop and safe restart/recovery.

## Security and configuration checks

- [ ] No secret values are present in repository, image, environment dump,
      startup output or logs.
- [ ] Production configuration rejects debug auth bypass, debug logging,
      unverified PostgreSQL TLS and development defaults.
- [ ] Database endpoints require verified TLS; credentials rotate successfully
      without a code change.
- [ ] Rate limiting, body/header limits, TLS and trusted proxy behavior pass
      staging tests. Forwarded headers from untrusted clients are ignored.
- [ ] API errors contain no SQL, stack trace, token or provider-secret data.
- [ ] Cross-tenant negative tests cover user, Agent, Reporting, Recommendation,
      scoring and financial aggregate paths enabled by the release.
- [ ] Narrow financial permission is used for cost metrics; it does not imply
      procurement mutation.

## Observability and operational readiness

- [ ] Logs include request/correlation/operation identity and exclude
      credentials, raw tokens and sensitive evidence.
- [ ] Metrics and traces are visible in the production monitoring system.
- [ ] Alerts are routed and acknowledged for API unavailable, DB unavailable,
      worker stopped, outbox backlog, repeated job failure, stale Reporting,
      Recommendation source/reconciliation failure, execution `UNKNOWN` rate,
      and disk/storage risk.
- [ ] Exercise one controlled failure for each enabled worker path and verify
      detection, alert routing, recovery and no duplicate business effect.
- [ ] Confirm UTC/time-sensitive work survives restart, missed schedule and
      non-UTC host timezone; verify late Reporting snapshots retain the
      original UTC period and expose actual generation/freshness.
- [ ] Check DB connections, query latency, worker lag and storage growth against
      the approved initial workload. Record measured values; do not infer
      capacity from unit tests.
- [ ] Name retention/archive owners and verify no history is removed outside
      an approved policy.

## Acceptance and promotion

- [ ] All staging health, migration, smoke, security, observability and
      recovery checks have evidence attached to the release record.
- [ ] No unresolved `RELEASE_BLOCKER` remains. Any accepted known limitation
      is documented, observable, safe, and explicitly accepted by the release
      owner.
- [ ] Security, database operations, service owner and release owner approve
      the exact artifact digest.
- [ ] Promote the same immutable digest and compatible configuration to
      production; apply migrations in the approved order with pre-migration
      backup and health gates.
- [ ] Monitor health, authorization failures, worker status, outbox/job lag,
      Reporting freshness, Recommendation source availability and storage
      after rollout.
- [ ] If rollback is unsafe after schema migration, execute the documented
      forward-fix path; do not roll back to an incompatible N-1 binary.

## Final decision

- [ ] `READY_FOR_RC` — no unresolved release blocker for the approved scope.
- [ ] `BLOCKED_FOR_RC` — at least one release blocker remains; list IDs and
      owners: ________________________________________________

Decision owner: ____________________ Date/time: ____________________
Commit/image digest: ______________________________________________
