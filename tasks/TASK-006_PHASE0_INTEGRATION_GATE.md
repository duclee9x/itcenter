# TASK-006 — Phase 0 Integration Gate

```yaml
task_id: TASK-006
feature_id: PHASE-GATE
workflow_id: P0-GATE
phase: P0
priority: P0
status: CODE_COMPLETE
owner_domain: Platform
```

## Objective

Verify that the Phase 0 identity, authorization, command-control and audit
foundations operate together from a clean PostgreSQL database through the
public runtime boundaries.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/MVP_PHASED_IMPLEMENTATION_PLAN.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`

## In Scope

- Clean migration and rebuild verification.
- Identity/session, authorization, idempotency, messaging, operation and audit
  cross-layer verification.
- API health/readiness, authentication boundary and tenant isolation.
- CI-equivalent format, lint, typecheck, tests and build gates.

## Out of Scope

- Asset, Helpdesk, Incident, Monitoring or later business workflows.
- Production deployment, external provider provisioning and remote CI.

## Acceptance Criteria

1. TASK-002 through TASK-005 dependencies are `CODE_COMPLETE`.
2. Clean PostgreSQL migrations apply and rerun safely.
3. Cross-layer transactions preserve idempotency, outbox/inbox, operation and
   audit guarantees.
4. Authentication and authorization fail closed and preserve tenant isolation.
5. Full local verification gates pass without skipped tests.
6. Registry and handoff status accurately record the gate result.
