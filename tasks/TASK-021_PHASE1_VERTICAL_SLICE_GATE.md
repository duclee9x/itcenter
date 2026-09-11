# TASK-021 — Phase 1 Vertical Slice + Integration Gate

```yaml
task_id: TASK-021
feature_id: PHASE-GATE
workflow_id: P1-E2E
phase: P1
priority: P0
status: CODE_COMPLETE
owner_domain: platform/integration
```

Validate the completed asset, helpdesk, work queue, timeline, notification, and basic search vertical slice from clean migrations through public API boundaries.

## Acceptance criteria

- TASK-012 through TASK-020 are `CODE_COMPLETE`.
- Clean migrations and rerun are safe.
- Asset, ticket, work queue, timeline, notification, and search E2E paths pass.
- Tenant-scoped authorization, idempotency, outbox, and audit behavior pass.
- Typecheck, format, lint, tests, and build pass.
