# Current Task

`TASK-094-R1` — Asset Risk + Replacement Scoring Contract — is
`SATISFIED / CODE_COMPLETE` (normative/specification only). TASK-094 remains
`BLOCKED / NOT_STARTED` due to explicit `SCOPE_DEPENDENCY` items: Maintenance
has no typed corrective/preventive classification; TASK-059 exposes no
reusable candidate application command/port; and Offboarding currently uses
`asset.risk_state = MISSING`, which must be separated before that field can
project assessment bands. Details are in
[`TASK-094_ASSET_RISK_REPLACEMENT_SCORING.md`](tasks/TASK-094_ASSET_RISK_REPLACEMENT_SCORING.md).
No TASK-094 runtime code has started. Stop here; do not begin TASK-095.

The just-completed `TASK-093` — Knowledge Deflection + Self-Service
Recommendations — is `CODE_COMPLETE`. It reuses TASK-037 Knowledge,
TASK-061 Search, TASK-092 context and canonical Ticket intake without changing
Knowledge, Ticket or Incident lifecycle. See
[`TASK-093_IMPLEMENTATION_REPORT.md`](tasks/TASK-093_IMPLEMENTATION_REPORT.md).
