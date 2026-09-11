# TASK-037 — Problem + Change + Knowledge Foundation

```yaml
task_id: TASK-037
feature_id: PROBLEM/CHANGE/KNOWLEDGE
workflow_id: WF-PC-K
phase: P2
priority: P1
status: CODE_COMPLETE
owner_domain: problem/change/knowledge
```

Implement the durable foundation for problem records, controlled change
requests and publishable knowledge articles.

## In scope

- Problem and change state machines with explicit transitions.
- Knowledge article draft/review/publish lifecycle.
- Tenant-scoped persistence, version checks, outbox and audit.

## Out of scope

- Full RCA editor, change execution worker and knowledge recommendations.

## Acceptance criteria

1. Problem starts NEW, change starts DRAFT, article starts DRAFT.
2. Protected transitions enforce the documented state machines.
3. Knowledge publication requires review content.
4. Change assessment requires risk, impact and implementation plan.
5. Full repository verification passes.
