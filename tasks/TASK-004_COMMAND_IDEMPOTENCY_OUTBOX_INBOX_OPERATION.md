# TASK-004 — Command, Idempotency, Outbox, Inbox + Operation Hardening

```yaml
task_id: TASK-004
feature_id: FOUNDATION
workflow_id: PLATFORM-CONTROL
phase: P0
priority: P0
status: CODE_COMPLETE
owner_domain: Platform
```

## Objective

Harden command-control foundations so retryable writes, outbox publication,
inbox consumption and operation state are durable, tenant-scoped and safe.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/ERROR_RETRY_IDEMPOTENCY_STANDARD.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/EVENT_CATALOG_EVENT_PAYLOAD_CONTRACT.md`

## In Scope

- Idempotency replay, conflict and expiry behavior.
- Outbox claim/publish retry semantics.
- Inbox deduplication and failed-effect retry semantics.
- Versioned operation state transitions and tenant filtering.
- Canonical command/error failure-path tests.

## Out of Scope

- New business-domain commands.
- Audit query/read models (TASK-005).
- Approval, notification or broker deployment.

## Acceptance Criteria

1. Same key and semantic request replays the prior result.
2. Same key with changed request returns `IDEMPOTENCY_KEY_CONFLICT`.
3. Idempotency scope includes tenant and principal.
4. Outbox rows commit atomically and publication is retry-safe.
5. Inbox processing is deduplicated and failed effects retry safely.
6. Operation transitions enforce valid state and expected version.
7. All applicable unit, integration, contract, E2E, migration, format, lint,
   typecheck and build gates pass.
