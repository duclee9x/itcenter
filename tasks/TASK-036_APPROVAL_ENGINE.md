# TASK-036 — Approval Engine

```yaml
task_id: TASK-036
feature_id: F-022
workflow_id: WF-APR01
phase: P2
priority: P0
status: CODE_COMPLETE
owner_domain: control-plane
```

Implement durable approval requests and explicit approve/reject decisions with
segregation of duties and immutable decision history.

## In scope

- Approval policy and request persistence.
- `APPROVAL.CREATE`, `APPROVAL.APPROVE`, `APPROVAL.REJECT`.
- Requester cannot approve own request.
- Idempotency, optimistic concurrency, outbox and audit.

## Out of scope

- Delegation, escalation and quorum routing.
- Automatic policy evaluation for every business domain.

## Acceptance criteria

1. An approval request starts in `PENDING`.
2. Requester self-approval is rejected.
3. Only `PENDING` requests accept approve/reject decisions.
4. Decisions are append-only and replay-safe.
5. Full repository verification passes.
