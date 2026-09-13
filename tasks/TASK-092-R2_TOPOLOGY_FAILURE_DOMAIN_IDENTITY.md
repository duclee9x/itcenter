# TASK-092-R2 — Scoped Switch Identity for Correlation Evidence

```yaml
task_id: TASK-092-R2
parent_task: TASK-092
status: CODE_COMPLETE
work_type: IMPLEMENTATION_REMEDIATION
scope: topology failure-domain identity fallback only
```

## Finding

Verification found that TASK-092 treated equal `switch_name` values as
`FRESH_FAILURE_DOMAIN_ANCESTOR` without requiring site or network scope. This
did not satisfy the normative identity rule. The existing freshness gate was
already strict: topology was `FRESH` only when both observations were
classified `FRESH` by TASK-051.

## Change

TASK-051 currently persists no canonical switch/device identity or topology
edge graph. The last-resort fallback now requires:

- identical, non-empty tenant IDs;
- identical, non-empty, unambiguous canonical Site scope for both incidents;
- equal switch names after Unicode NFKC normalization, whitespace trimming /
  collapse and case folding.

The Site resolver now returns a scope only when exactly one canonical Site
ancestor exists. Missing or ambiguous scope cannot set the strong
failure-domain fact. The scorer still requires the combined topology state to
be `FRESH`, which is produced only when both TASK-051 observations are
individually `FRESH`. VLAN/site locality scoring remains in its existing
weaker evidence group. No migration was needed, and TASK-091 behavior was not
changed.

The normative detail is recorded in
[`TASK-092_ADVANCED_INCIDENT_CORRELATION.md`](TASK-092_ADVANCED_INCIDENT_CORRELATION.md)
and `docs/AUDIT_NETWORK_DISCOVERY_VLAN_TOPOLOGY_WORKFLOW.md`. The TASK-092
implementation report now describes the scoped fallback rather than the
previous unscoped assumption.

## Verification

- Regression tests cover normalized matching within one Site, absent scope,
  different Site, different tenant, blank switch identity, and the requirement
  that both observations must be FRESH.
- Targeted incident-correlation unit tests — 11 passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed, including boundary checks.
- `npm run format:check` and `git diff --check` — passed.
- `npm test` reached the migration suite after 48 unit and 2 contract tests
  passed, then stopped because `TEST_DATABASE_URL` is not configured;
  migration, integration and E2E DB-backed suites could not run.
- No TASK-093 implementation or planning-contract work was started. TASK-093
  remains `BLOCKED / NOT_STARTED` because its detailed contract is missing.
- The pre-existing `AGENTS.md` change is unrelated and excluded.
