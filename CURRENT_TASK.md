# Current Task

TASK-096 — Explainable Recommendation Layer — is `READY / NOT_STARTED` after
TASK-096-R1 completed the normative aggregation contract. See
`tasks/TASK-096_EXPLAINABLE_RECOMMENDATION_LAYER.md`. Runtime work has not
started. Incident and Asset require minimal owner-domain read adapters noted as
potential implementation-time `SCOPE_DEPENDENCY`; no direct cross-domain SQL
is permitted. TASK-097 remains `WAITING_DEPENDENCY / NOT_STARTED`.

TASK-094 — Asset Risk + Replacement Scoring — is `CODE_COMPLETE`; see
`tasks/TASK-094_IMPLEMENTATION_REPORT.md`.

TASK-095-R1 — Governed KPI + Analytics Contract — is `CODE_COMPLETE`; the
governed nine-KPI v1 contract is persisted. TASK-095-R2 adds append-only
Incident and Work Queue history with forward-only legacy coverage and
point-in-time query ports. See
`tasks/TASK-095-R2_IMPLEMENTATION_REPORT.md`.
TASK-095-R3 — Typed SLA Target Purpose Foundation — is `CODE_COMPLETE`; see
`tasks/TASK-095-R3_IMPLEMENTATION_REPORT.md`. Legacy target purpose is UNKNOWN
until explicitly classified; text inference is forbidden.
TASK-095 — Advanced Reporting + Governed KPI + Analytics — is
`CODE_COMPLETE`; all nine governed KPI families, domain boundaries, historical
snapshot/backfill, authorized drill-down and aggregate CSV are implemented and
verified. See `tasks/TASK-095_IMPLEMENTATION_REPORT.md`.

TASK-097 remains `WAITING_DEPENDENCY / NOT_STARTED` until TASK-096 completes.
The unrelated `AGENTS.md` change remains outside the TASK-096-R1 commit.
