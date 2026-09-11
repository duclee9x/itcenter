## TASK-000 Implementation Report

### Status

IMPLEMENTED — TASK-000 foundation scope only, including the two review regressions. Feature FOUNDATION; Workflow PLATFORM-BOOTSTRAP; Owner Platform; Phase P0. No TASK-001 or business-domain workflow was implemented. This status does not claim full Phase 0 authentication/RBAC or production readiness.

### Repository Tree Added/Changed

```text
apps/{api,worker,agent-gateway}/       Separate runtime entrypoints
modules/{identity,audit}/             Domain/application/infrastructure/interfaces
packages/shared-kernel/               Clock, IDs and context
packages/{api-contracts,event-contracts}/
packages/{auth,config,observability}/
packages/{persistence,messaging,object-storage,testing}/
database/migrations/{identity,platform,audit}/
database/{scripts,seeds,fixtures}/
contracts/{openapi,asyncapi,json-schema}/
tests/{unit,architecture,migration,integration,contract,e2e}/
scripts/                             Dependency checker, build asset copy
infra/docker/compose.yaml
.github/{workflows/ci.yml,pull_request_template.md}
docs/adr/0001-task000-bootstrap.md
docs/runbooks/{local-development,task000-foundations,TASK-000_IMPLEMENTATION_REPORT}.md
README.md
package.json / package-lock.json / tsconfig.json / eslint.config.js
.env.example / .gitignore / .prettierignore
```

Each package and module has a boundary README; module public indexes expose purposeful extension points. Existing specifications remain the source of truth. No Git repository or commit was created.

### Architecture Decisions

TypeScript and npm workspaces, Node HTTP/test libraries, PostgreSQL driver, AJV for event validation, ESLint/TypeScript dependency checks. No application framework, broker, cache, search engine, additional database or microservice was introduced. See ADR 0001 for scope and precedence decisions.

### Database / Migrations

Three owner-scoped migrations create 13 foundation tables:

- identity: users, external_identities, roles, permissions, role_permissions, role_bindings.
- platform: idempotency_records, outbox_events, inbox_events, operations.
- audit: audit_events, audit_event_relations, audit_evidence_links.

A separate migration_meta.applied table records immutable migration checksums. Migrations serialize with an advisory lock and commit individually. Constraints include tenant-scoped identities/references, operation/idempotency state checks, event/inbox uniqueness, and audit immutability triggers. Clean database creation, all migrations, rerun and checksum rejection passed on PostgreSQL 18. Test databases were disposable; no existing business database was migrated.

### Foundation Interfaces

Clock, IdGenerator, CorrelationContext, ActorContext, UnitOfWork, OutboxWriter, InboxStore, IdempotencyStore, AuthorizationPort, AuditPort, EventPublisher. Also OIDC-compatible authentication, metrics and optional object metadata ports. No generic domain repository or lifecycle status setter.

### APIs

- GET /api/v1/health/live.
- GET /api/v1/health/ready.
- GET /api/v1/me — authentication boundary; default executable returns 401 until a real adapter is configured.
- GET /api/v1/operations/{id} — authentication, operation.read authorization and tenant-filtered query; default executable fails closed.
- Agent Gateway reserves /api/v1/agent/* behind its own authentication port; no heartbeat/inventory implementation.

No public write commands or protected lifecycle transitions were added. OperationRegistry.enqueue is internal, starts QUEUED and must be used inside the caller's idempotent transaction.

### Event / Messaging Foundation

Canonical versioned JSON Schema, transactional outbox writer, publisher port and worker hosting skeleton. Pending events are not published or acknowledged. No real business event is produced/consumed.

Idempotency uses tenant/principal/operation/business-scope/key uniqueness, canonical request hashes, concurrency locks and durable response replay. Failed transactions roll back ledger and effects together. Inbox tracks NOT_PROCESSED/PROCESSED/FAILED; committed NOT_PROCESSED rows are reclaimable, while concurrent duplicate delivery is suppressed. Effects and processed state commit together. UnitOfWork verifies the PostgreSQL COMMIT command tag and rejects a callback that swallowed an aborted-transaction error.

### Audit Foundation

Transaction-bound AuditPort inserts actor, action, subject, correlation, reason, before/after, outcome and classification plus relations/evidence. PostgreSQL rejects UPDATE, DELETE and TRUNCATE on all three audit tables. Known secret field names are rejected before persistence. Timeline is absent and is not used as an audit substitute.

### Security / Authorization Foundation

No password system, default admin, production bypass or unverified role claims. Default authentication is unavailable and default authorization is DENY; tests use explicit synthetic adapters. Tenant mismatch is denied before the authorization adapter. Identity-owned catalog seed registers operation.read, user.read, role_binding.read, rbac.manage and audit.read without granting roles/bindings. Production configuration requires a secret-manager file mount reference and verified PostgreSQL TLS.

### CI / Local Development

PostgreSQL-only Docker Compose, locked npm install, scripts, migration runner, permission seeding and runbooks. CI stages include install, formatting/lint, dependency checks, typecheck, tests, build, dependency audit and artifact upload. Local tests used Node 25.2.1 and PostgreSQL 18; CI specifies Node 22/PostgreSQL 18. Remote CI and Docker Compose were not executed; equivalent checks ran locally against a native temporary PostgreSQL instance.

### Tests Run

| Command                                          | Result                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| npm ci --offline --cache /tmp/itcenter-npm-cache | PASS — clean lockfile install                                           |
| npm ls --depth=0                                 | PASS — all workspace dependencies resolved                              |
| npm run format:check                             | PASS                                                                    |
| npm run lint                                     | PASS — ESLint and dependency graph                                      |
| npm run typecheck                                | PASS                                                                    |
| npm run test:unit                                | PASS — 10 tests including architecture checks                           |
| npm run test:contract                            | PASS — 2 tests                                                          |
| npm run test:migration                           | PASS — 1 PostgreSQL test                                                |
| npm run test:integration                         | PASS — 13 reported tests including inbox/commit regression checks       |
| npm run test:e2e                                 | PASS — 3 HTTP tests, including authorized operation query on PostgreSQL |
| npm test                                         | PASS — 24 reported tests; no failures or skips                          |
| npm run build                                    | PASS — compiled output and contract assets                              |

TEST_DATABASE_URL pointed to an isolated PostgreSQL instance on localhost. Network/IPC/database sandbox restrictions were resolved through approved tool execution. A missing workspace link was fixed with a clean lockfile install. Initial TypeScript errors were corrected before the final successful checks. The last sandboxed test rerun was blocked by tsx IPC permissions; the same suites passed in the approved full run. The last lint rerun was unavailable because the approval reviewer reported the Codex usage limit.

### Remaining Gaps

- Real OIDC/agent authentication and full RBAC/high-risk policy adapters are deferred as permitted by TASK-000; runtime /me is not a working login integration.
- Broker publisher, delivery retries and actual consumers are not enabled; worker readiness is intentionally 503. The task's worker-skeleton option is implemented.
- No production secret manager provisioning, dedicated runtime database roles, RLS, backup/restore drill, ingress TLS, metrics exporter/OpenTelemetry, object-store adapter or deployment has been performed.
- Operation transitions, idempotency expiry cleanup/reconciliation, audit retention/integrity chains and business payload schemas require later scoped tasks. No automatic retry, key reuse or generic state mutation was invented.
- Static dependency checks do not prove arbitrary SQL ownership. Database owners can disable triggers; production role separation is still required.
- Remote CI has not run because this directory has no Git repository/remote. CI's Node 22 environment has not been locally exercised.

### SPEC_CONFLICT

No unresolved conflict blocks this scope. Task precedence determines the six operation states and the API error envelope. Inbox processed state becomes visible together with local effects at commit; broker ACK must follow commit. These interpretations are recorded in ADR 0001 rather than changing specification semantics.

### SCOPE_DEPENDENCY

No material scope expansion. Real OIDC/RBAC and broker integrations remain explicit follow-up dependencies; TASK-001 was not started.

### IMPLEMENTATION_ASSUMPTION

No existing stack was detected. TypeScript/npm and PostgreSQL 18 were selected for this bootstrap. operation.read is a foundation-only permission declaration, not an implicit grant. Idempotency expiry timestamps do not automatically permit reusing an existing successful key. Production file secret references are supplied by the deployment's secret manager.
