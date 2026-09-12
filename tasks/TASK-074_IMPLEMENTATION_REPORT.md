# TASK-074 Implementation Report

## Status

`CODE_COMPLETE` — Invoice, duplicate protection, 3-Way Match, mismatch
exception handling and Credit Note workflows are implemented. This task does
not implement payment settlement.

## Delivered

- Added Procurement-owned Invoice and Credit Note persistence, draft lines,
  immutable submitted snapshots, append-only lifecycle/match/application
  evidence, durable supplier-document identity reservations, match allocations
  and credit releases.
- Added command APIs for Invoice and Credit Note create, draft update, draft
  cancellation, submit, match re-evaluation, approve/reject and Credit Note
  apply. Commands enforce tenant/resource authorization, granular permissions,
  expected versions and idempotency.
- Implemented 3-Way Match against the current PO commercial version, submitted
  Invoice snapshot and POSTED accepted Goods Receipt quantities. PO-line
  serialization prevents concurrent invoices from consuming the same capacity.
  Business quantity and unit-price tolerance remain zero.
- Added context-bound optional approval validation, explicit mismatch
  exceptions that retain `MISMATCHED` evidence and reserve approved quantities,
  and Credit Note application with quantity/amount limits. Amount-only Credit
  Notes do not release invoiceable quantity.
- Added audit/outbox effects, Invoice/Credit Note and related PO/Invoice
  timeline entries, duplicate/mismatch Work Queue references, API error codes,
  and approval-source lookup through the Control Plane query contract.
- Added PostgreSQL-backed E2E coverage for duplicate races, partial allocation
  races, receipt re-evaluation, approvals, mismatch exceptions, idempotent
  Credit Note application, over-credit races and downstream evidence
  immutability.

## Main files

- API: `apps/api/src/invoice-routes.ts`, `apps/api/src/server.ts`
- Procurement: `modules/procurement/application/invoices.ts`,
  `modules/procurement/application/invoice-primitives.ts`,
  `modules/procurement/domain/invoice.ts`
- Migrations:
  `database/migrations/procurement/20260913_001_invoice_credit_note.sql`,
  `database/migrations/control/20260913_001_invoice_approval_identity.sql`
- Tests: `tests/unit/invoice-domain.test.ts`,
  `tests/e2e/invoice-match.test.ts`

## Verification

- `npm test` with the local PostgreSQL container configured as
  `TEST_DATABASE_URL`: **87 passed** (29 unit/architecture, 2 contract,
  1 migration, 21 integration, 34 E2E).
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed after formatting the new E2E test.
- `git diff --check`: passed.

## Follow-up state

TASK-074 dependencies and acceptance criteria are satisfied. TASK-075 remains
`BLOCKED / NOT_STARTED` with `SPEC_GAP / PLANNING_REQUIRED`: its detailed
normative Contract, Renewal and Commercial Document Governance implementation
contract is missing. No TASK-075 runtime implementation has started.
