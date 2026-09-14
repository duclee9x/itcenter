# Current Task

TASK-096 — Explainable Recommendation Layer — is `READY / NOT_STARTED`.
TASK-096-R1's normative aggregation contract and TASK-096-R2's Incident and
Asset source read adapters are complete. The Recommendation aggregation
runtime has not started. See `tasks/TASK-096_EXPLAINABLE_RECOMMENDATION_LAYER.md`
and `tasks/TASK-096-R2_IMPLEMENTATION_REPORT.md`. TASK-097 remains
`WAITING_DEPENDENCY / NOT_STARTED`.

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

TASK-096-R2 — Recommendation Source Read Adapters Foundation — is
`CODE_COMPLETE`; see `tasks/TASK-096-R2_IMPLEMENTATION_REPORT.md`. It adds
read-only Incident/TASK-092 and Asset/TASK-059/TASK-094 query boundaries
within their owning domains. Knowledge continues to use existing TASK-093
session and eligibility queries. No Recommendation aggregation or persistence
was added.

TASK-097 remains `WAITING_DEPENDENCY / NOT_STARTED` until TASK-096 completes.
The unrelated `AGENTS.md` change remains outside the TASK-096-R2 commit.
