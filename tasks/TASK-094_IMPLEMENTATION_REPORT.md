# TASK-094 Implementation Report

**Status:** `CODE_COMPLETE`

**Scope:** Asset Risk + Replacement Scoring runtime only. TASK-095 was not
started.

## Implemented

- Added separate append-only `AssetRiskAssessment` and
  `AssetReplacementAssessment` histories, versioned v1 profiles, evidence
  summaries, completeness/missing reasons, timestamps and a latest projection.
- Implemented the exact TASK-094-R1 score groups, thresholds and UNKNOWN
  completeness behavior. Incident Root episodes and Monitoring episodes are
  deduplicated through their owning-domain queries; unknown corrective
  Maintenance evidence reduces completeness.
- Added explicit tenant/category replacement useful-life policy versions and
  append-only verified acquisition-date evidence. Posted Goods Receipt age
  provenance is resolved from Asset-owned received-unit references through a
  Procurement-owned query. `Asset.created_at` is never used as age evidence.
- Consumed canonical `WarrantyAssetQuery`; warranty policy remains
  `WARRANTY_STATE_V1`. No actual repair-cost ledger exists, so Economic Repair
  Pressure is recorded as unavailable. No FX or estimated repair cost is
  introduced.
- Added scoped `SYSTEM_ASSET_SCORING`, Asset assessment/recalculation routes,
  scheduled reconciliation and stale Risk projection clearing. Scoring
  transactions begin at REPEATABLE READ; evidence/source domains remain behind
  their application query ports.
- PLAN/PRIORITY recommendations use the TASK-059 application port. Current
  CRITICAL Risk creates one unresolved `ASSET_RISK_REVIEW`, protected by a
  durable partial unique index. Neither path approves replacement or mutates
  Procurement, Asset lifecycle, assignment or TASK-091 execution.
- Updated the normative workflow, data/storage/API/event/permission/audit/
  retry/state/reporting/traceability documents and the TASK registry.

## Persistence and interfaces

New migrations add immutable assessment histories, the rebuildable latest
projection, replacement policy versions, verified acquisition evidence, a
tenant-scoped scoring principal and the Risk Work Queue source/uniqueness
constraint. API commands support authorized recalculation with expected
Asset version and idempotency, policy versioning and verified acquisition
dates. An authorized Asset-scoped query returns assessment history and marks
current freshness.

## Verification

- `npm test`: passed, 163 tests across unit, contract, migration,
  PostgreSQL integration and E2E.
- `npm run typecheck`: passed.
- `npm run lint`: passed, including boundary checks.
- `npm run format:check`: passed.
- `git diff --check`: passed.
- PostgreSQL test environment was configured through the repository's local
  `TEST_DATABASE_URL` mechanism; credentials were not printed or persisted.

## Readiness reconciliation

TASK-094 is `CODE_COMPLETE`. TASK-095's declared dependencies (TASK-039,
TASK-061 and TASK-076) are satisfied, so TASK-095 is `READY / NOT_STARTED`.
TASK-096 and TASK-097 remain `WAITING_DEPENDENCY / NOT_STARTED` because
TASK-095 is not complete. No later task was started.

The pre-existing `AGENTS.md` change was kept outside the TASK-094 commit.
