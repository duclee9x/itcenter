# TASK-095-R3 Implementation Report — Typed SLA Target Purpose Foundation

**Status:** CODE_COMPLETE. **Scope:** SLA target-purpose typing and the canonical Resolution SLA outcome
query needed by TASK-095 KPI-004. TASK-095 Reporting remains IN_PROGRESS; R3
does not implement other KPI work, drill-down completion or TASK-096.

## Implemented

- Added constrained `target_purpose` values: `RESPONSE`, `ACKNOWLEDGE`,
  `RESOLUTION`, `RESTORE`, `OTHER` and `UNKNOWN`. New target inserts must
  provide a valid value. Existing targets migrate to `UNKNOWN`; no names,
  conditions or duration heuristics are used.
- Added tenant-composite target/policy and instance/target constraints. New
  SLA instances are checked against the exact owning policy version. SLA start
  reads and returns typed purpose and persists the actual numeric policy
  version; deadline and state-transition behavior is unchanged.
- Added append-only `sla_target_purpose_changes` and the authorized
  `SLA.SET_TARGET_PURPOSE` command/API. It requires a known typed purpose,
  tenant scope, expected version, reason and idempotency key. UNKNOWN can be
  classified once; explicit purposes require a new policy/target version.
  The target update, immutable history, audit and outbox are transactional.
- Added the Control Plane `ResolutionSlaOutcomeQuery`. Only typed RESOLUTION
  obligations with final MET/BREACHED outcomes count. The query uses canonical
  `completed_at` in UTC `[start_at,end_at)`, does not reimplement SLA clocks,
  and distinguishes an available empty population from UNKNOWN-purpose
  ambiguity and missing finalization time. Query infrastructure failures
  propagate and Reporting maps them to UNAVAILABLE.
- Reporting KPI-004 now consumes the Control Plane query. Its drill-down uses
  the same typed-purpose and final-outcome boundary.
- Updated SLA/Reporting/data/storage/API/event/permission/audit/idempotency and
  traceability documentation. TASK-095-R3 task and implementation artifacts
  record that no Reporting or TASK-096 scope is completed here.

## Persistence and security

Migration `control/20260924_001_task095_r3_sla_target_purpose.sql` adds the
typed field, target version, composite tenant constraints, immutable
classification history and permission `sla.target_purpose.manage`. Database
guards guarantee purpose-history immutability and target/policy binding; they
do not implement authorization or business policy. No role receives an
implicit grant. The command applies the existing AuthorizationPort and locks
the target with an expected-version check. Cross-tenant classification is
denied before target existence is disclosed.

SLA instances keep the canonical target reference and policy version that
already bind each obligation. Legacy purpose classification is recorded as an
audited correction against that stable target reference; outcome records are
not rewritten. `completed_at` is set by the existing final outcome transition
and is the canonical period timestamp.

## Acceptance and verification

Dedicated tests are in:

- `tests/migration/task095-r3-sla-target-purpose.test.ts`
- `tests/integration/task095-r3-sla-target-purpose.test.ts`
- `tests/e2e/task095-r3-sla-target-purpose.test.ts`

They cover legacy UNKNOWN migration without name inference; all five
classifiable purposes; rejected invalid/omitted purpose; RESOLUTION-only KPI
filtering despite misleading names; UTC start-inclusive/end-exclusive
membership; successful empty versus UNKNOWN ambiguity versus query failure;
missing finalization-time fail-closed behavior; tenant composite constraints;
SLA-start policy-version binding; manual classification idempotency,
authorization, expected version and immutable history; and API replay with
exactly one audit/outbox effect.

Successful verification:

- `npm test` — **174 passed, 0 failed**: 61 unit/architecture, 2 contract,
  6 migration, 47 integration and 58 E2E tests. E2E process exited with status
  0.
- `npm run typecheck` — passed.
- `npm run lint` — ESLint and boundary checks passed.
- `npm run format:check` — passed.
- `npm run test:migration` — 6 passed, 0 failed against local PostgreSQL.
- `git diff --check` — passed.

Local PostgreSQL credentials were supplied through the existing
`TEST_DATABASE_URL` wrapper and were not printed or persisted.

## Remaining scope

TASK-095 is returned to `READY / IN_PROGRESS` with R3's prerequisite cleared.
Its remaining KPI acceptance, historical snapshot, API/drill-down and closure
work is not completed by this report. TASK-096 and TASK-097 remain
`WAITING_DEPENDENCY / NOT_STARTED`.
