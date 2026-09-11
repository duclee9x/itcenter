# TASK-050 — Asset Audit: Expected vs Observed

```yaml
task_id: TASK-050
feature_id: F-026
workflow_id: WF-010
phase: P3
priority: P0
status: CODE_COMPLETE
owner_domain: audit
```

Implement an append-only asset observation and exception foundation.

## In scope

- Audit sessions, expected asset values, observations and exceptions.
- Record observation with expected-vs-observed comparison.
- Resolve exception with reason and audit/outbox effects.

## Out of scope

- QR/mobile scanning UI and network discovery.

## Acceptance criteria

1. Observations never overwrite canonical asset state.
2. Mismatches create durable exceptions with expected and observed values.
3. Exception resolution is explicit, tenant-scoped and auditable.
4. Full repository verification passes.
