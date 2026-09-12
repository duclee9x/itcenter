# TASK-075 Implementation Report

## Status

`CODE_COMPLETE` — Contract lifecycle, immutable commercial versions, execution
evidence, in-term amendments, Renewal Cases/successor Contracts and commercial
document governance are implemented against TASK-075-R1.

## Delivered

- Added Contract and Renewal application/domain modules with tenant-scoped
  commands, independent legal/usage state dimensions, immutable version and
  history rows, expected-version locking, conditional source-bound approval
  checks, Supplier eligibility, version-bound execution evidence, amendments,
  termination/expiry and successor-based renewals.
- Added durable uniqueness for one OPEN Renewal Case per predecessor and one
  canonical successor per case. Renewal creates an immutable successor DRAFT;
  proposal changes create a new successor version and never rewrite the
  predecessor.
- Added central commercial-document metadata/version governance with separate
  signature status, SHA-256/object metadata checks, immutable FINAL versions,
  supersession relationships and resource links. Object metadata is checked
  outside the database transaction through the shared `ObjectStore` boundary.
- Added explicit API command routes, granular permissions, approval-source
  reads, append-only audit/history, outbox/timeline events and actionable
  Renewal Work Queue items. Events carry references and lifecycle metadata;
  commercial snapshots remain in protected canonical storage.
- Added version, renewal uniqueness, execution evidence, amendment evidence,
  document immutability, document relationships and Work Queue source
  migrations; registered permission codes durably.
- Added unit and PostgreSQL E2E coverage for state-machine guards, lifecycle,
  evidence-bound amendment, usage hold/resume, amendment-vs-termination,
  duplicate concurrent Renewal opening, document finalization and durable
  audit/outbox/history.

## Main files

- API: `apps/api/src/contract-routes.ts`, `apps/api/src/server.ts`
- Contract: `modules/contract/`
- Commercial documents: `modules/document/`
- Approval reads: `modules/control-plane/application/approval-queries.ts`
- Renewal Work Queue: `modules/work-queue/application/work-queue.ts`
- Migrations: `database/migrations/contract/`,
  `database/migrations/document/`,
  `database/migrations/operations/20260914_001_contract_document_sources.sql`
- Tests: `tests/unit/contract-lifecycle.test.ts`,
  `tests/e2e/contract-lifecycle.test.ts`

## Verification

- `npm test` with the local PostgreSQL container configured as
  `TEST_DATABASE_URL`: **89 passed** (30 unit/architecture, 2 contract,
  1 migration, 21 integration, 35 E2E).
- `npm run typecheck`: passed.
- `npm run lint`: passed, including dependency-boundary checks.
- `npm run format:check`: passed.
- `git diff --check`: passed.

## Operational integration dependency

The shared object-storage package currently has an interface but no configured
provider. The API therefore fails closed when finalizing a commercial document
until deployment injects a central `ObjectStore` adapter. E2E tests inject a
metadata-verifying adapter. This leaves no domain-specific binary store or
unverified finalize path.
