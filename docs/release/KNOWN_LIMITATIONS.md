# Known Limitations and Non-Blocking Gaps

This list keeps intentional capability limits distinct from release blockers.
Nothing here authorizes weakening security or claiming a capability that the
runtime does not provide.

| ID    | Type             | Severity | Affected capability                                                                      | Production impact                                                                                                                                              | Required action                                                                                                      | Verification                                                  | Owner                           | Release-blocking                          |
| ----- | ---------------- | -------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| RR-12 | PERFORMANCE_GAP  | Medium   | Work Queue, Search, Operations Overview, correlation, scoring, Reporting, Recommendation | No measured production capacity or representative load baseline; capacity claims are unsupported.                                                              | Measure before setting capacity/SLO claims or scaling.                                                               | Reproducible production-like workload and query-plan report.  | SRE / Data Platform             | No for limited RC; before capacity claims |
| RR-13 | OPERATIONAL_GAP  | Medium   | Append-only history and event data                                                       | Retention/archive operations are not configured; storage growth needs an owner. Do not delete history ad hoc.                                                  | Approve retention classes and archive procedure.                                                                     | Non-production archive/restore exercise and growth alert.     | Data Governance / DB Operations | No for initial RC                         |
| RR-14 | KNOWN_LIMITATION | Low      | TASK-094 economic replacement scoring                                                    | No canonical ACTUAL repair-cost ledger exists. Economic Repair Pressure is `UNAVAILABLE`, completeness is reduced; the system does not fabricate repair spend. | None unless complete economic scoring is part of approved launch scope; then contract a canonical ledger separately. | Verify unavailable evidence and completeness in score output. | Asset / Finance                 | No unless promised                        |
| RR-15 | TECH_DEBT        | Low      | Operations Overview / PostgreSQL client                                                  | Current test passes, but the request path emits a `pg` client concurrency deprecation warning scheduled for removal in `pg@9.0`.                               | Serialize transaction-client queries before an incompatible driver upgrade.                                          | Focused E2E on target driver with no warning.                 | API / Persistence               | No for current tested driver              |

## Intentional Phase 5 product limits

These are governed exclusions, not defects to silently fill during release
work:

- **TASK-095 v1:** no custom KPI formulas, scheduled/email reports, cross-
  tenant analytics, FX, external BI warehouse, XLSX/PDF, or bulk underlying-
  record export.
- **TASK-096 v1:** exactly three source-owned recommendation families; no AI/
  LLM explanations, global score, learned ranking, generic accept/execute,
  additional Work Queue items, or additional recommendation families.
- **TASK-090/TASK-091:** execution remains governed and bounded by the
  implemented action contract; production Agent execution remains unavailable
  until the real Agent authentication adapter is provisioned. That missing
  adapter is listed as a conditional release blocker in
  [RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md), not treated as an acceptable
  production mock.

## Infrastructure limitations that remain fail-closed

- RELEASE-001 API authentication and RELEASE-002 Agent mTLS are
  `CODE_COMPLETE`, not `VERIFIED`; production provider/CA configuration and
  staging validation remain release blockers. Keep both adapters fail-closed
  until configured and verified.
- Worker readiness currently remains false. RELEASE-003-R1 now defines the
  approved profiles and all 13 worker policies; RELEASE-003 runtime must
  implement them before deployment. Do not override the current fail-closed
  probe to force an orchestrator rollout.
- Object/artifact storage routes use unavailable adapters unless a concrete
  production adapter is supplied. Keep affected workflows disabled until
  configured and verified.
- No production packaging, broker publisher, or alerting stack is supplied by
  this repository. Conditional capabilities must remain disabled until their
  deployment path is in place.

See [RELEASE_READINESS.md](RELEASE_READINESS.md) for the overall decision and
[RC_CHECKLIST.md](RC_CHECKLIST.md) for staging acceptance evidence.
