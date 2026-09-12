# IMPLEMENTATION HANDOFF

## Current Task — TASK-070

Supplier + Procurement Request

Feature: F-039
Workflow: WF-P01
Phase/Priority: P4 / P0
Readiness: READY
Status: NOT_STARTED

Task contract: `tasks/TASK-070_SUPPLIER_PROCUREMENT_REQUEST.md`

TASK-061 and remediation TASK-070-R1 are `CODE_COMPLETE`. The Supplier
`SPEC_CONFLICT` is resolved normatively: lifecycle transitions, granular
permission mappings, RFQ/PO eligibility, safe event payloads, append-only
history and optimistic concurrency are specified. TASK-070 is derived `READY`
and stays `NOT_STARTED`. No implementation has started; wait for explicit user
instruction before coding TASK-070.

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
- TASK-070 is now derived `READY` after TASK-070-R1; implementation remains
  `NOT_STARTED` pending explicit user instruction.

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
