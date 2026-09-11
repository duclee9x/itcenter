# TASK-015 — Asset Return + Handover/Return Documents

```yaml
task_id: TASK-015
feature_id: F-008/F-016
workflow_id: WF-008
phase: P1
priority: P0
status: CODE_COMPLETE
owner_domain: asset
```

## Objective

Implement return request and physical return receipt with immutable return documentation.

## In scope

- `ASSET.REQUEST_RETURN` and `ASSET.RECEIVE_RETURN` commands.
- Pending return state, assignment closure, return movement, condition grade, and return document.
- Idempotency, version checks, authorization, outbox events, audit, and E2E tests.

## Out of scope

Document signing providers, data wipe, repair routing, replacement, and UI.
