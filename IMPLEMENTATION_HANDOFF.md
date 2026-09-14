# IMPLEMENTATION HANDOFF

## Current Task

TASK-096 — Explainable Recommendation Layer — is `READY / NOT_STARTED` after
TASK-096-R1 contract completion and TASK-096-R2 source-adapter completion.
The Recommendation aggregation runtime has not started. See
`tasks/TASK-096_EXPLAINABLE_RECOMMENDATION_LAYER.md` and
`tasks/TASK-096-R2_IMPLEMENTATION_REPORT.md`. Incident/TASK-092 exposes a
tenant-scoped current REVIEW-decision read boundary; Asset/TASK-059/TASK-094
exposes active candidates bound to their current fresh assessments. Knowledge
continues to compose TASK-093 session and eligibility queries. No cross-domain
private-table SQL or Recommendation-owned persistence is used. TASK-097 remains
`WAITING_DEPENDENCY / NOT_STARTED`. TASK-095 is `CODE_COMPLETE`; see
`tasks/TASK-095_IMPLEMENTATION_REPORT.md` for the nine-KPI runtime, R2/R3
source integration, snapshot/backfill, drill-down authorization, CSV and full
verification results.

TASK-094 — Asset Risk + Replacement Scoring — is `CODE_COMPLETE`; see
`tasks/TASK-094_IMPLEMENTATION_REPORT.md`. Scoring uses immutable Risk and
Replacement assessments, owning-domain evidence queries and explicit scoped
authorization. Economic repair evidence is unavailable because no canonical
repair-cost ledger exists; no estimated costs or FX are used.

TASK-095-R1 — Governed KPI + Analytics Contract — is `CODE_COMPLETE`
(specification only). It defines exactly nine governed KPIs, UTC intervals,
source and deduplication semantics, result status/freshness, immutable
historical revisions, controlled dimensions, RBAC drill-down and aggregate CSV.
It explicitly excludes scheduling, custom formulas, cross-tenant analytics, FX,
XLSX/PDF and underlying-record bulk export.

TASK-095-R1 — Governed KPI + Analytics Contract — is `CODE_COMPLETE`
(specification only). TASK-095-R2 historical-state and R3 typed-SLA
prerequisites are `CODE_COMPLETE`. Main TASK-095 runtime and acceptance are
also `CODE_COMPLETE`; TASK-096-R1 and TASK-096-R2 are `CODE_COMPLETE`; TASK-096 is
`READY / NOT_STARTED`. TASK-097 remains `WAITING_DEPENDENCY / NOT_STARTED` on
TASK-096.

TASK-093 is `CODE_COMPLETE`; see
`tasks/TASK-093_IMPLEMENTATION_REPORT.md`.

Deployment note: `apps/agent-gateway/src/main.ts` continues to use the
fail-closed `unavailableAuthentication` adapter. Configure the existing
enrolled-Agent AuthenticationPort before accepting real Agent requests.

TASK-095's authoritative contract is
`tasks/TASK-095_ADVANCED_REPORTING_GOVERNED_KPI_ANALYTICS.md`; its implementation
report records exact verification. Unrelated changes to `AGENTS.md` remain
outside the TASK-095 commit.

## Last Completed Task — TASK-095

Advanced Reporting + Governed KPI + Analytics (`CODE_COMPLETE`). See
`tasks/TASK-095_IMPLEMENTATION_REPORT.md`.

- Implemented exactly the nine governed KPI definitions with domain-owned
  read ports, TASK-095-R2 historical Incident/Work Queue queries and
  TASK-095-R3 typed Resolution SLA evidence.
- Added immutable snapshot revisions, late closed-period materialization,
  source watermarks, scoped `SYSTEM_REPORTING`, validated dimensions, per-row
  RBAC drill-down, aggregate CSV formula protection and export audit.
- Verification passed: `npm test` (185 tests: 68 unit/architecture, 2
  contract, 6 migration, 50 integration, 59 E2E), typecheck, lint/boundary,
  format check, migration tests and `git diff --check`.
- TASK-096-R1 and TASK-096-R2 are `CODE_COMPLETE`; TASK-096 is
  `READY / NOT_STARTED` and
  TASK-097 remains `WAITING_DEPENDENCY / NOT_STARTED`.

## Last Completed Remediation — TASK-096-R2

Recommendation Source Read Adapters Foundation (`CODE_COMPLETE`). See
`tasks/TASK-096-R2_IMPLEMENTATION_REPORT.md`.

- Added tenant- and authorization-scoped, read-only Incident correlation
  REVIEW and active replacement-candidate/current-assessment query ports.
- Preserved source generation, canonical score/profile/reasons and freshness;
  empty results remain distinct from query failures.
- Full verification passed: `npm test` (189 tests: 68 unit/architecture, 2
  contract, 6 migration, 54 integration, 59 E2E), typecheck, lint/boundary,
  format, migration tests and `git diff --check`.
- TASK-096 remains ready; its aggregation runtime is not implemented.

## Previous Remediation — TASK-096-R1

Explainable Recommendation Layer Contract (`CODE_COMPLETE`, specification
only). The detailed v1 contract defines three canonical families, immutable
explainability revisions, actor-scoped interactions, source authorization,
family availability, source-owned actions and explicit no-side-effect
boundaries. TASK-096-R2 has since implemented the two owner-domain read
adapters; R1 itself changed specifications only.

## Last Completed Task — TASK-094

Asset Risk + Replacement Scoring (`CODE_COMPLETE`). See
`tasks/TASK-094_IMPLEMENTATION_REPORT.md`.

- Added separate immutable Risk and Replacement assessment histories and
  exact versioned v1 scoring; current Risk projection becomes UNKNOWN when
  stale or ineligible.
- Added verified acquisition/useful-life policy evidence, scoped scoring
  principal and scheduled recalculation through Incident, Monitoring,
  Maintenance, Warranty and Procurement query boundaries.
- PLAN/PRIORITY uses TASK-059 human review; CRITICAL Risk creates one
  durably deduplicated review item. No Procurement, lifecycle or TASK-091
  action is triggered by score.
- Full verification passed: `npm test` (163 tests), typecheck, lint/boundary,
  format, migration/PostgreSQL integration, E2E and `git diff --check`.

## Last Completed Remediation — TASK-094-R3

Incident–Asset Reliability + Warranty State Foundation (`CODE_COMPLETE`). See
`tasks/TASK-094-R3_IMPLEMENTATION_REPORT.md`. Added deterministic tenant-safe
Incident–Asset links/history and Incident/Monitoring reliability query
boundaries, plus Maintenance-owned `WARRANTY_STATE_V1`, canonical Warranty
query and idempotent scheduled Asset projection refresh. Full `npm test`
passed (153 tests), migration tests, typecheck, lint/boundaries, format check
and `git diff --check`. TASK-094-R3 supplied the evidence foundations consumed
by the subsequent TASK-094 runtime implementation above.

The preceding completed task is TASK-076 — Phase 4 Procurement-to-Asset
Integration Gate (`SATISFIED / CODE_COMPLETE`); see
`tasks/TASK-076_IMPLEMENTATION_REPORT.md`. The local environment reports
commercial-document storage as `UNAVAILABLE_NOT_READY`; production storage is
not asserted ready.

The pre-existing `AGENTS.md` modification remains outside the TASK-092,
TASK-092-R2, TASK-093-R2, TASK-093 and TASK-094 commits.

## Last Completed Task — TASK-093

Knowledge Deflection + Self-Service Recommendations (`CODE_COMPLETE`). See
`tasks/TASK-093_IMPLEMENTATION_REPORT.md`.

- Added durable session, item and append-only interaction history with a
  versioned, explainable score profile, canonical exact-version presentation
  authorization, three-item limit, feedback and explicit resolution.
- Added idempotent self-service escalation through canonical Ticket creation
  with typed recommendation-session provenance; no Ticket/Incident lifecycle
  mutation and no TASK-090/091 remediation path.
- Full verification passed: `npm test` (143 tests), typecheck, lint/boundaries,
  format check, migration/PostgreSQL integration and `git diff --check`.
- TASK-094-R1 completed normative scoring and spec reconciliation. TASK-094-R2
  implemented Maintenance classification/history, the TASK-059 candidate port
  and Offboarding recovery separation. R3 is resolving the remaining
  Incident–Asset and Warranty evidence boundaries; scoring runtime remains
  out of scope until R3 completes.

## Last Completed Remediation — TASK-093-R2

Knowledge Recommendation Foundation (`CODE_COMPLETE`). See
`tasks/TASK-093-R2_IMPLEMENTATION_REPORT.md`.

- Added fail-closed Knowledge audience classification/read authorization,
  tenant-validated typed applicability relationships, TASK-061 Knowledge
  indexing and canonical presentation-time eligibility checks.
- Added a tenant-scoped, read-only Incident recommendation-context query and
  optional immutable `KNOWLEDGE_RECOMMENDATION` source provenance for
  `TICKET.CREATE`.
- Full verification passed: `npm test` (138 tests, including PostgreSQL
  migration, integration and E2E), typecheck, lint/boundaries, format check
  and `git diff --check`.
- TASK-093 runtime subsequently completed as `CODE_COMPLETE`; see the report
  above for the implementation and verification.

## Last Completed Task — TASK-092

Advanced Incident Correlation (`CODE_COMPLETE`). See
`tasks/TASK-092_IMPLEMENTATION_REPORT.md`.

- Added tenant-scoped event evaluation with the versioned 0..100 scoring
  profile, immutable candidate/decision evidence, deterministic-only Root
  creation, automatic high-confidence linking and review fallback.
- Added scoped `SYSTEM_CORRELATION` authorization, manual attach/reject/detach
  APIs, durable Root/cluster uniqueness, detach suppression, audit/outbox/
  timeline and bounded worker retry fallback.
- Verification passed: `npm test` (128 tests), typecheck, lint/boundaries,
  format check and `git diff --check`.

## Last Completed Remediation — TASK-092-R2

Scoped topology switch identity clarification (`CODE_COMPLETE`). The previous
fallback treated matching `switch_name` values as strong without requiring a
scope. It now requires the same tenant, a unique canonical Site scope and
normalized switch names. Missing/ambiguous Site scope cannot produce strong
evidence. Strong topology evidence still requires both observations to be
TASK-051 `FRESH`. TASK-092 remains CODE_COMPLETE. TASK-093 is now
`READY / NOT_STARTED` under the completed TASK-093-R1 contract; its runtime
has not started. See
`tasks/TASK-092-R2_TOPOLOGY_FAILURE_DOMAIN_IDENTITY.md`.
The initial missing test URL was resolved using the existing local PostgreSQL
container without persisting its credential. Full `npm test` passed (130
tests), as did typecheck, lint/boundaries, format and diff checks; no
`VERIFICATION_PENDING_ENVIRONMENT` remains.

## Last Completed Remediation — TASK-092-R1

Advanced Incident Correlation Contract (`CODE_COMPLETE`, specification only).
See `tasks/TASK-092-R1_ADVANCED_INCIDENT_CORRELATION_CONTRACT.md`. The
normative v1 score/evidence profile, high-confidence auto-link gates,
deterministic Root creation, human review, immutable decisions and link
history, attach/detach/suppression, scoped `SYSTEM_CORRELATION` authorization,
events, audit, Work Queue, concurrency and acceptance tests are now explicit.
The remediation itself contained no runtime changes; TASK-092 runtime is now
CODE_COMPLETE as recorded above.

## Last Completed Remediation — TASK-091-R1

Automation Action Execution + Verification Contract (`CODE_COMPLETE`,
specification only). TASK-091 now has an implementation-ready contract with
an authenticated fixed Agent command protocol, a separate execution state
machine and durable attempt history, five-minute positive runtime-marker
verification, safe cancellation/manual-retry rules, at-most-once recovery,
idempotent events, permissions and actionable UNKNOWN fallback. The runtime
completion is recorded in `tasks/TASK-091_IMPLEMENTATION_REPORT.md`.

## Last Completed Task — TASK-090

Advanced Rules Engine + Policy-Gated Automation (`CODE_COMPLETE`). See
`tasks/TASK-090_IMPLEMENTATION_REPORT.md`.

- Preserved the rule/evaluation/intent vertical slice and added the reviewed
  `RESTART_AGENT` capability, immutable tenant Action Policy versions and
  Identity-owned scoped System Automation principal authorization.
- Added explicit policy administration commands, READY evidence constraints,
  fail-closed security checks, approval revalidation, actionable review work
  and policy publication/audit/outbox events. TASK-090 does not call an action
  executor.
- Verification passed: `npm test` (104 tests), typecheck, lint/boundaries,
  format check and `git diff --check`.

## Last Completed Remediation — TASK-090-R1

Automation Action Policy + System Principal Authorization Contract
(`CODE_COMPLETE`, normative/specification only). See
`tasks/TASK-090-R1_AUTOMATION_ACTION_POLICY_SYSTEM_PRINCIPAL_AUTHORIZATION_CONTRACT.md`.

- Defined deny-by-default Action Capability and tenant Action Policy models,
  immutable policy versions, explicit `SYSTEM_AUTOMATION` identity and
  tenant/resource-scoped grants through the canonical AuthorizationPort.
- Separated Rule-author permissions from action authority; specified READY
  gates, policy/grant evidence, explicit blocked-intent re-evaluation and
  TASK-091 execution-time rechecks.
- Updated the normative workflow, permission, data, API, event, audit and
  traceability contracts. No runtime code, wildcard grant or default ALLOW
  was added by the remediation. TASK-090 runtime completion is recorded above.

## Last Completed Task — TASK-076

Phase 4 Procurement-to-Asset Integration Gate (`CODE_COMPLETE`). See
`tasks/TASK-076_IMPLEMENTATION_REPORT.md`.

- Added version-bound Contract alert scheduling and independent natural expiry.
- Added immutable PO/Invoice/Credit Note/Contract cost lineage and derived
  summaries for Assets and License Entitlements/Pools.
- Added idempotent worker linking, five-attempt backoff, Work Queue fallback,
  authenticated cost provenance API and explicit storage capability health.
- Verification passed: `npm test` (93 tests), typecheck, lint, format check
  and `git diff --check`.

## Last Completed Remediation — TASK-076-R1

Contract Alert + Asset/License Cost Provenance Integration Contract
(`CODE_COMPLETE`, specification only). See
`tasks/TASK-076-R1_PHASE4_INTEGRATION_GATE_CONTRACT.md`.

- Established explicit-date precedence and period-derived Contract alert
  triggers, immutable ContractVersion binding, durable alert identity and
  natural expiry independent from notice configuration.
- Defined immutable committed/actual/adjustment cost provenance, canonical
  source/version/line links, deterministic allocation, Credit Note adjustment,
  recurring periods and domain-owned event/projection boundaries.
- Created the detailed TASK-076 gate contract and required E2E evidence.

## Prior Completed Remediation — TASK-075-R1

Contract Lifecycle + Renewal + Commercial Document Governance Contract
(`CODE_COMPLETE`, specification only). See
`tasks/TASK-075-R1_CONTRACT_LIFECYCLE_RENEWAL_DOCUMENT_GOVERNANCE_CONTRACT.md`.

- Separated Contract lifecycle, usage, Renewal Case, immutable ContractVersion,
  document governance and signature/execution evidence; Approval remains an
  independent control gate.
- Defined version-bound signature execution, conditional approval, explicit
  amendment, successor-based Renewal, durable uniqueness, document byte
  immutability, scope permissions, reference-only events, audit and race tests.
- Reconciled workflow/state/data/API/permission/event/storage/audit/retry and
  traceability specifications, generated the detailed TASK-075 contract and
  marked it READY / NOT_STARTED. No runtime code was implemented.

## Last Completed Task — TASK-074

Invoice + Duplicate Protection + 3-Way Match + Credit Note (`CODE_COMPLETE`).
See `tasks/TASK-074_IMPLEMENTATION_REPORT.md`.

- Implemented Procurement-owned Invoice and Credit Note entities, immutable
  submitted snapshots, lifecycle commands, scoped API routes and migrations.
- Added durable duplicate identity reservation, append-only match evidence,
  PO-line capacity allocation, conditional approvals, mismatch exceptions,
  Credit Note applications/releases, audit, outbox, timelines and actionable
  duplicate/mismatch work items.
- Verification passed: `npm test` (87 tests), `npm run typecheck`,
  `npm run lint`, `npm run format:check` and `git diff --check`.

## Last Completed Task — TASK-073

Goods Receipt + Asset Registration + Partial Receipt (`CODE_COMPLETE`). See
`tasks/TASK-073_GOODS_RECEIPT_ASSETIZATION_PARTIAL_RECEIPT.md`.

- Added tenant-scoped Goods Receipt create, draft update, post and cancel
  commands with durable idempotency, expected-version checks, permissions,
  audit, outbox and timeline integration.
- Posting atomically validates and snapshots the receipt, accepted quantities,
  PO receipt progress, history and events; immutable database fences and PO
  row serialization protect over-receipt and PO-command races.
- Added asynchronous Asset-owned registration keyed by immutable
  `received_unit_id`, inbox deduplication, bounded retry and actionable
  fallback. Assets start `RECEIVED`/`UNASSIGNED`; failed assetization does not
  undo a posted receipt.
- Verification: `npm test` passed all 84 tests, including the TASK-073
  PostgreSQL E2E; `npm run typecheck`, `npm run lint`, `npm run format:check`
  and `git diff --check` passed.

## Last Completed Remediation — TASK-073-R1

Goods Receipt + Partial Receipt + PO Receipt Integration Contract
(`CODE_COMPLETE`, specification only). See
`tasks/TASK-073-R1_GOODS_RECEIPT_PARTIAL_RECEIPT_PO_INTEGRATION_CONTRACT.md`.

- Defined separate Goods Receipt, PO lifecycle/receipt and Asset lifecycle
  state machines, including immutable POSTED receipts and explicit PO close.
- Made accepted-only quantity progress and atomic over-receipt rejection
  normative; assigned PO/receipt concurrency and partial-receipt races to
  TASK-073.
- Defined immutable receiving snapshots, permissions, API/events/audit,
  POSTED-only 3-Way Match evidence and async Asset-owned registration by
  stable received-unit ID. Asset failure cannot unpost a receipt.
- Generated the detailed TASK-073 implementation contract and reconciled
  traceability, registry, CURRENT_TASK and handoff. No runtime code was
  implemented.

## Last Completed Remediation — TASK-074-R1

Invoice + Duplicate Protection + 3-Way Match + Credit Note Contract
(`CODE_COMPLETE`, specification only). See
`tasks/TASK-074-R1_INVOICE_DUPLICATE_MATCH_CREDIT_NOTE_CONTRACT.md`.

- Defined independent Invoice lifecycle, match status and derived credit
  status; Credit Notes have their own immutable lifecycle and applications.
- Made POSTED accepted Goods Receipt evidence authoritative, with zero
  business tolerance, partial invoice allocation, normalized durable
  duplicate identity and PO-line concurrency rules.
- Specified conditional Approval Engine binding. An accepted mismatch remains
  `MISMATCHED` and reserves its full approved invoice quantity against later
  invoices; an applied Credit Note releases only explicitly credited quantity
  that previously consumed invoiceable capacity. Amount-only credits do not
  release quantity.
- Added the detailed TASK-074 contract and reconciled registry/current task.
  No runtime Invoice/Credit Note behavior was implemented.

## Last Completed Task — TASK-072

Purchase Order + Approval + Amendment (`CODE_COMPLETE`). See
`tasks/TASK-072_PURCHASE_ORDER_APPROVAL_AMENDMENT.md`.

- Added Procurement-owned PO lifecycle commands, scoped APIs, independently
  stored lifecycle/receipt dimensions, mutable draft lines, immutable
  version-bound commercial lines and append-only history.
- Enforced conditional Approval Engine links for issue and amendment, Supplier
  and RFQ award guards, receipt-aware cancellation/close, audit, outbox,
  timeline and durable idempotency.
- Added database fencing for terminal states, immutable commercial versions,
  held/terminal receipt posting and aggregate concurrency. TASK-073 must lock
  the PO and write its canonical receipt, counter, quantity summaries, receipt
  state, aggregate version and receipt history in the same transaction.
- Verification passed: `npm test` (83 tests), typecheck, lint, format check
  and `git diff --check`. TASK-073 receipt races remain unimplemented.

## Last Completed Remediation — TASK-072-R1

Purchase Order Lifecycle + Approval + Amendment Contract (`CODE_COMPLETE`,
specification only). See
`tasks/TASK-072-R1_PURCHASE_ORDER_LIFECYCLE_APPROVAL_AMENDMENT_CONTRACT.md`.

- Separated PO lifecycle from receipt state and made full/short close,
  cancellation, hold/resume, Supplier and RFQ award guards normative.
- Defined conditional PO_ISSUE/PO_AMENDMENT approval snapshot binding, with no
  blanket approval requirement or automatic request creation.
- Made issued commercial versions immutable, bounded amendments to
  pre-receipt POs, and assigned receipt concurrency tests to TASK-073.
- Updated PO workflow, state machine, permission matrix, event catalog,
  data-model and traceability contracts; generated the TASK-072 implementation
  contract. No TASK-072 or TASK-073 runtime code was implemented.
- Verification: cross-document contract reconciliation, format check and
  `git diff --check`.

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
- RFQ history snapshots retain candidate Supplier IDs; the submit-vs-close
  case races actual submission against close and verifies no event/effect when
  the submission loses.
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
