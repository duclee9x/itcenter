# IMPLEMENTATION HANDOFF

## Current Task — TASK-072 (Blocked, Not Started)

Purchase Order + Approval + Amendment

Feature: F-041
Workflow: WF-P03
Phase/Priority: P4 / P0
Readiness: BLOCKED
Status: NOT_STARTED

Task contract: `GENERATE_ON_READY` (not generated because readiness is
blocked).

TASK-036 and TASK-071 are `CODE_COMPLETE`. Registry reconciliation found a
`SPEC_CONFLICT`: PO states are listed but there is no normative transition and
command matrix; approval request linkage and whether approval is mandatory or
conditional are unspecified; and the event catalog lacks a complete PO
lifecycle contract. Do not infer business rules or begin implementation until
these are resolved.

## Last Completed Task — TASK-071

RFQ + Quotation + Supplier Selection (`CODE_COMPLETE`). See
`tasks/TASK-071_RFQ_QUOTATION_SUPPLIER_SELECTION.md` for the implementation
report.

- Added Procurement-owned RFQ and Quotation migrations, tenant-bound references,
  versioned histories, DB invariants and one-current-submission uniqueness.
- Implemented lifecycle commands and scoped APIs with permission checks,
  idempotency, expected-version handling, audit, outbox and timeline facts.
- Enforced both user clarifications: terminal RFQs terminalize all remaining
  quotations; linked RFQ_AWARD approvals are validated when present, with no
  automatic approval request creation or blanket approval requirement.
- PostgreSQL E2E coverage exercises supplier eligibility, approval guards,
  terminal child transitions, audit/outbox/timeline and the three specified
  concurrency races.
- Verification passed: `npm test` (82 tests), `npm run typecheck`,
  `npm run lint`, `npm run format:check` and `git diff --check`.

## Last Completed Remediation — TASK-071-R1

RFQ + Quotation Lifecycle Contract (`CODE_COMPLETE`). See
`tasks/TASK-071-R1_RFQ_QUOTATION_LIFECYCLE_CONTRACT.md`.

- Defined the exact RFQ and Quotation state machines, terminal states,
  supplier eligibility, granular command permissions and supplier scope.
- Made award, close-no-award and cancellation side effects atomic; submitted
  quotations are immutable and revisions retain prior values through a linked
  new record.
- Added event payloads, tenant/RFQ/Supplier current-submission uniqueness,
  approval separation and required concurrency cases.
- Generated the TASK-071 implementation contract from
  `CODEX_TASK_TEMPLATE.md`; updated registry and current task. No TASK-071
  runtime code was implemented.
- Verification: cross-document consistency, targeted Prettier and
  `git diff --check`.

## Last Completed Task — TASK-070

Supplier + Procurement Request (`CODE_COMPLETE`). See
`tasks/TASK-070_SUPPLIER_PROCUREMENT_REQUEST.md` for the implementation report.

- Added tenant-scoped Procurement-owned Supplier and Procurement Request
  persistence, history, constraints, application contracts and APIs.
- Implemented all normative Supplier lifecycle commands and Procurement
  Request draft creation/submission with permissions, durable idempotency,
  expected-version concurrency, audit, outbox and Operations timeline.
- Protected tax and bank-reference fields from default DTOs, audit, event and
  timeline payloads; mutation reasons containing protected values are rejected.
  Requalified Suppliers are subject to canonical RFQ/PO eligibility.
- Verification passed: 81 tests (`npm test`), typecheck, lint, targeted format
  check and `git diff --check`.
- Procurement Request review/budget transitions remain out of scope because
  the normative commands are unspecified. Cross-domain source and
  cost-center/project references remain tenant-scoped opaque IDs until their
  owning integrations exist.

## Last Completed Remediation — TASK-070-R1

Supplier Lifecycle + Permission Contract (`CODE_COMPLETE`). See
`tasks/TASK-070-R1_SUPPLIER_LIFECYCLE_PERMISSION_CONTRACT.md`.

- Made the exact Supplier state machine and forbidden transitions normative;
  `INACTIVE` is reactivatable and Supplier records are never hard-deleted.
- Added granular command permissions, RFQ candidate and PO issue eligibility,
  eleven Supplier master event contracts, versioned append-only history and
  competing-transition concurrency requirements.
- Updated TASK-070 acceptance criteria, registry readiness, CURRENT_TASK and
  handoff. TASK-070 runtime implementation was not started.
- Verification: cross-document consistency review, formatting and
  `git diff --check`; runtime tests are not applicable to this
  specification-only remediation.

## Last Completed Task — TASK-061

Advanced Search + Phase 3 Integration Gate (`CODE_COMPLETE`). See
`tasks/TASK-061_ADVANCED_SEARCH_PHASE3_INTEGRATION_GATE.md` for the full report.

- Added authorized, tenant-scoped search for Asset, User, Ticket, Incident,
  Network observations, Software products and License entitlements, with exact
  identifier ranking, prefix/fuzzy/full-text search and Vietnamese/IP/MAC/
  serial normalization.
- Added source-versioned outbox/inbox indexing, tombstones, durable retry
  backoff, bounded reindex, cursor-bound result pagination and exact canonical
  fallback. Search rechecks owning-domain read permissions and scopes.
- Updated the search projection migration, API/worker wiring, permission
  catalog, search/event/permission/traceability specifications and module docs.
- Verification passed: `npm test` (77 tests), typecheck, lint, format check
  and `git diff --check`.

## Earlier Completed Task — TASK-059

Replacement + Retirement + Disposal + Data Wipe (`CODE_COMPLETE`). See
`tasks/TASK-059_REPLACEMENT_RETIREMENT_DISPOSAL_DATA_WIPE.md` for the full
implementation report.

- Added durable Asset-owned replacement plans, retirement decisions, versioned
  wipe jobs, disposal records and immutable evidence history with tenant and
  state constraints.
- Added tenant-scoped replacement, retirement, wipe, disposal and approved
  internal reactivation commands. Verified cutover assigns the prepared
  replacement through Asset-owned commands while preserving the old Asset
  until cutover succeeds.
- Added agent-bound wipe claim/report flow, capability-scoped symbolic methods,
  evidence checks, bounded retries, approval recipient routing, actionable
  Work Queue items, audit/outbox, timeline and notifications.
- Updated lifecycle, data-model, event, permission and traceability specs; added
  five database-backed E2E scenarios.
- Verification passed: `npm test` (70 tests), `npm run format:check`,
  `npm run typecheck`, `npm run lint` and `git diff --check`.
- Remaining operational setup: configure supported wipe and evidence-storage
  adapters; unavailable adapters fail closed. Procurement execution is outside
  TASK-059. Required external clearances are currently recorded as authorized
  operator attestations.

## Earlier Completed Task — TASK-056

Unauthorized Software Detection + Resolution (`CODE_COMPLETE`; commit
`89857bd`). See `tasks/TASK-056_UNAUTHORIZED_SOFTWARE_DETECTION_RESOLUTION.md`.

- Implemented tenant-scoped software inventory normalization, deterministic
  catalog aliases, unauthorized detection, exceptions and actionable Work
  Queue references.
- Added approval and policy decisions, bounded safe symbolic removal jobs,
  agent claims/reports, retries and later complete-inventory verification.
- Added migrations, tenant-scoped APIs, audit/outbox events, permissions,
  specifications/traceability and database-backed E2E tests.
- Assumptions: UNKNOWN grace defaults to 72 hours; OS-specific uninstall
  adapters are out of scope and unsupported adapters fail closed.

## Earlier Completed Task — TASK-060

TASK-060 — User Offboarding Orchestration (`CODE_COMPLETE`)

- Added durable Identity-owned cases, independent User Lifecycle transitions,
  case/clearance/recovery history, session and access revocation, and
  permissioned, idempotent, versioned commands. Case reconciliation uses a
  short lease to serialize cross-domain work against cancellation/finalization.
- Added Asset return request/cancellation through the Asset application
  contract and License cleanup through License-owned cancellation/reclaim
  commands. Failures and pending actions remain actionable in Operations work
  items and cannot satisfy close conditions.
- Added explicit cancellation and recovery, request-withdrawal evidence,
  authorized exceptions, terminal User guard, audit/outbox events, migrations,
  traceability and command documentation.
- E2E covers Asset return and compensation, both License paths, duplicate start,
  missing-asset blocking/retry, access revocation, actionable pending work,
  cancellation recovery, denial, and the COMPLETE-vs-REQUEST_CANCEL race.
- Verification passed: `npm test` (62 tests), typecheck, lint, format check,
  migration tests, focused Offboarding E2E, and `git diff --check`.
- Assumption: without an HRIS provider, an authorized operator attests
  termination and withdrawal references; external verification is out of scope.

## Previous Specification Remediation

TASK-060-R1 — Define Normative Offboarding State Machine (`CODE_COMPLETE`)

- Made case/user state machines, cancellation/recovery rules, terminal
  invariants, events and COMPLETE-vs-REQUEST_CANCEL concurrency normative.
- TASK-060 implementation began only after a later explicit user request.
