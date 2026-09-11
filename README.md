# IT Operations Hub — TASK-000

Feature: FOUNDATION · Workflow: PLATFORM-BOOTSTRAP · Owner: Platform · Phase: P0.

Modular monolith with API, Worker and Agent Gateway processes. This repository implements TASK-000 only. Identity lifecycle, full OIDC/RBAC, domain workflows and TASK-001 are not implemented.

## Development

Requires Node.js 22 or newer, npm, and PostgreSQL 18 (or Docker Compose). No broker, cache, or object-store service is required.

```sh
npm ci
# Supply a local-only password in your environment:
export ITCENTER_LOCAL_DB_PASSWORD='<local-only-password>'
docker compose -f infra/docker/compose.yaml up -d
export APP_ENV=local
export DATABASE_SECRET_REF=env:ITCENTER_DATABASE_URL
export ITCENTER_DATABASE_URL='postgres://itcenter:<URL-encoded-local-password>@127.0.0.1:5432/itcenter'
npm run db:migrate
npm run db:seed
npm run start:api
```

Run the other processes in separate terminals with the same database settings:

```sh
npm run start:agent-gateway
npm run start:worker
```

Default ports: API 3000, gateway 3001, worker 3002. `PORT` overrides the port for the process. `HOST` defaults to loopback. `LOG_LEVEL` defaults to info. Secrets must not be committed; production uses a `file:/run/secrets/...` reference to a secret-manager mount, with verified PostgreSQL TLS.

## HTTP behavior

| Route                       | API                                                    | Agent Gateway                               | Worker                                  |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------- | --------------------------------------- |
| GET /api/v1/health/live     | 200                                                    | 200                                         | 200                                     |
| GET /api/v1/health/ready    | DB-dependent                                           | DB-dependent                                | 503 until worker adapters are installed |
| GET /api/v1/me              | Authenticated principal contract; default 401          | 404                                         | 404                                     |
| GET /api/v1/operations/{id} | Authentication + authorization + tenant-filtered query | 404                                         | 404                                     |
| /api/v1/agent/*             | 404                                                    | Authentication boundary; no business routes | 404                                     |

No authentication provider is wired by this task. `/me` and operation queries therefore fail closed in the executable API. Tests inject verified principal/policy adapters; runtime has no development bypass or trusted client role headers.

## Verification

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:contract
export TEST_DATABASE_URL='postgres://<test-user>:<test-password>@127.0.0.1:5432/postgres'
npm run test:migration
npm run test:integration
npm run test:e2e
npm run build
```

`npm test` runs all test layers. Database tests require CREATE DATABASE permission on a disposable instance. Each suite creates a unique database and drops only that database afterward; tests never reset the database named by `TEST_DATABASE_URL`. Missing test infrastructure causes failure, not a silently skipped gate.

Build output is under `dist/`, including contract schemas. Run `node dist/apps/api/src/main.js` (or the other entrypoints) after installing dependencies. A CI build artifact is a code bundle, not a production deployment.

## Architecture and extension points

- [Architecture decisions](docs/adr/0001-task000-bootstrap.md)
- [Foundation ownership and traceability](docs/runbooks/task000-foundations.md)
- [Migration and operational recovery](docs/runbooks/local-development.md)
- [Task acceptance criteria](tasks/TASK-000_PHASE0_BOOTSTRAP.md)

Never publish an event from a transaction callback. Transaction-bound stores write idempotency, canonical changes, outbox and required audit together; failures must propagate to UnitOfWork. Inbox effects and processed markers commit together. No durable broker acknowledgement is implemented or simulated.
