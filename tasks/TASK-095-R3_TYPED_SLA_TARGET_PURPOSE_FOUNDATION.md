# TASK-095-R3 — Typed SLA Target Purpose Foundation

**Status:** CODE_COMPLETE. **Parent:** TASK-095 — Advanced Reporting + Governed KPI + Analytics. **Scope:** Control Plane SLA target-purpose semantics and the canonical Resolution outcome query required by KPI-004. This remediation does not
implement KPI calculation, reporting drill-down or TASK-096.

## Normative contract

SLA target purpose is a typed canonical value with exactly these v1 values:
`RESPONSE`, `ACKNOWLEDGE`, `RESOLUTION`, `RESTORE`, `OTHER`, `UNKNOWN`.
Target names, conditions, descriptions and durations are never classification
authority. New target inserts must specify an allowed purpose. Legacy targets
are migrated to `UNKNOWN`; migration performs no text inference. UNKNOWN is
not a Resolution target and remains ambiguity when an in-period final outcome
could belong to a Resolution obligation.

An authorized `SLA.SET_TARGET_PURPOSE` command may classify an UNKNOWN target
once to a known typed purpose. It requires tenant scope, the narrow
`sla.target_purpose.manage` permission, expected target version, reason,
correlation and idempotency key. Immutable classification history, audit and
outbox are committed with the target update. Explicit target purpose is not
overwritten; change requires a new policy/target version.

An SLA instance binds to a same-tenant target and its canonical policy version.
`completed_at`, written by the existing SLA final-outcome transition, is the
period timestamp. No deadline, pause, calendar or breach semantics change.
`ResolutionSlaOutcomeQuery` counts only final MET/BREACHED outcomes for
RESOLUTION targets in UTC `[start_at,end_at)`. It distinguishes available
empty, available, ambiguous target purpose, missing finalization timestamp and
query failure (propagated as a source failure for Reporting to map to
UNAVAILABLE). Reporting consumes this contract rather than target text or
private SLA tables.

Legacy UNKNOWN target classification is an audited correction to the canonical
stable target reference, which historical SLA instances already retain along
with policy version. Classification does not rewrite SLA outcome records.

## Acceptance coverage

- Migration test verifies text-named legacy targets remain UNKNOWN, supported
  values are constrained, and missing/invalid new purposes are rejected.
- PostgreSQL integration tests verify typed-purpose filtering, UTC interval
  boundaries, tenant isolation, ambiguity versus successful empty, final-time
  fail-closed behavior, command idempotency, versioning, authorization and
  append-only classification history.
- E2E verifies API authorization, idempotent classification, and exactly one
  audit/outbox/classification record on replay.

R3 does not complete TASK-095. The main Reporting acceptance work remains
IN_PROGRESS; TASK-096 and TASK-097 remain waiting on TASK-095.
