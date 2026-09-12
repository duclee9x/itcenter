# TASK-076 Implementation Report

Status: `CODE_COMPLETE` / Phase 4 integration gate passed.

## Implemented

- Added append-only, immutable Contract alert facts and configuration
  exceptions. The worker evaluates the current immutable ContractVersion,
  honors explicit notice-date precedence, derives an explicit notice period,
  creates no default warning, and runs natural expiration independently.
- Added immutable Procurement-owned cost provenance with durable source/target
  identity, canonical source/version/line checks, currency/quantity/source
  amount limits, audit/outbox events and a derived committed/actual/net cost
  summary. Writes serialize on the commercial source line to prevent
  concurrent over-allocation.
- Added idempotent event linking for received Assets, approved Invoices and
  applied Credit Notes. PO committed cost is preserved when actual invoice
  cost arrives. Partial Credit Note releases are assigned deterministically
  to the released received units; ambiguous or exception-only allocations
  create actionable Work Queue records.
- Added an authorized, idempotent cost-provenance command and tenant-scoped
  Asset/License Entitlement/Pool trace reads. License commercial provenance
  can reference an executed ContractVersion and preserve its effective period.
- Added bounded event retry with exponential backoff. After five failed
  attempts the event is parked and an actionable Work Queue item is created;
  successful processing removes retry state in the same transaction as inbox
  completion.
- Added `/api/v1/health/capabilities` reporting for commercial document
  storage. An absent adapter reports `UNAVAILABLE_NOT_READY`; an adapter
  without an explicit production verification signal cannot report production
  readiness.
- Kept procurement, Asset and License canonical writes in their owning
  application/event boundaries. Cost source facts remain immutable; no binary
  document fallback was added.

## Gate evidence

| Gate area | Evidence |
| --- | --- |
| Explicit-date precedence, period derivation, no invented warning, natural expiry, parallel scheduler replay, and recalculation on a new ContractVersion while retaining prior alert facts | `tests/e2e/task076-contract-alerts.test.ts`; `tests/unit/task076.test.ts` |
| Procurement Request → Supplier → PO → POSTED Goods Receipt → received unit → Asset → approved Invoice/PO-version cost lineage | `tests/e2e/task076-cost-provenance.test.ts`; upstream command/eligibility coverage in `tests/e2e/procurement.test.ts`, `tests/e2e/rfq-lifecycle.test.ts`, `tests/e2e/purchase-order-lifecycle.test.ts`, and `tests/e2e/goods-receipt.test.ts` |
| COMMITTED and ACTUAL coexist; partial Credit Note releases one of three received units; replay does not duplicate provenance; retry exhaustion creates human work and successful replay clears retry state | `tests/e2e/task076-cost-provenance.test.ts` |
| License Entitlement traces to an executed ContractVersion through the authorized command/read API; idempotency replay | `tests/e2e/task076-cost-provenance.test.ts` |
| ObjectStore absent and fake adapter present but not production-verified are reported distinctly | `tests/e2e/task076-cost-provenance.test.ts` |
| Invoice matching/Credit Note lifecycle, Contract versions/renewal/document governance and asynchronous Asset registration remain owned by their source tasks | `tests/e2e/invoice-match.test.ts`, `tests/e2e/contract-lifecycle.test.ts`, `tests/e2e/goods-receipt.test.ts` |

The TASK-076 cost E2E seeds tenant-scoped canonical upstream rows as fixtures,
then runs the real alert/cost workers and API to verify the linked lineage.
The upstream E2E suites exercise their owning commands and concurrency rules.
This evidence covers the direct-request PO path; RFQ/Quotation applicability
and award guards are covered by the TASK-071 suite. This is a composed Phase 4
gate across owning-domain tests, not a claim that one API session executes
every upstream command.

The local integration environment has no ObjectStore adapter. Its capability
is explicitly `UNAVAILABLE_NOT_READY`, which is the accepted environment
outcome; this does not establish production storage readiness.

## Verification

- `npm test` — passed, 93 tests across unit, contract, migration, integration
  and PostgreSQL E2E suites.
- `npm run typecheck` — passed.
- `npm run lint` — passed, including repository boundary checks.
- `npm run format:check` — passed.
- `git diff --check` — passed before commit.

PostgreSQL tests used the local `itcenter-postgres` container and disposable
`task000_*` databases, which the test helper removed after each run.

## Remaining deployment capability

No production ObjectStore adapter is configured in the local environment.
Commercial document finalization therefore remains unavailable/not-ready
here; the health capability reports this explicitly. No unresolved runtime
SPEC_CONFLICT or TASK-076 acceptance blocker remains.
