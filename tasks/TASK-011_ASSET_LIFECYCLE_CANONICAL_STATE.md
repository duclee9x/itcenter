# TASK-011 — Asset Lifecycle + Canonical State Constraints

Feature: F-005  
Workflow: WF-A01  
Owner: Asset

## Scope

Implement the canonical asset lifecycle vocabulary, transition validation, optimistic concurrency, append-only transition history, and the authorized `ASSET.RETIRE` command. Receiving, reservation, assignment, return, and disposal remain dependent tasks.

## Acceptance

- Lifecycle values follow the master state machine.
- Invalid transitions and version mismatches are rejected.
- Independent asset state dimensions are preserved.
- Retirement is authorized, idempotent, audited, and emitted through outbox after commit.
- Transition history is durable and tenant scoped.

## Verification

Run `npm test`, `npm run build`, and `git diff --check`.
