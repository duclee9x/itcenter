# TASK-012 — Basic Warehouse Receiving + Reservation

Feature: F-005  
Workflow: WF-005/WF-006  
Owner: Asset/Warehouse

## Scope

Provide the first warehouse slice: an available asset can be reserved for an active request with an expiry. Reservation remains tenant scoped and uses the canonical lifecycle.

## Acceptance

- Active reservations are unique per asset and have an expiry.
- Reservation commands require authorization, idempotency and expected version.
- Successful changes emit outbox events and durable audit records.
- Invalid state, duplicate reservation and version conflicts are rejected.
