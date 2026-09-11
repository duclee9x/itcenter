# TASK-005 — Audit Foundation + Query + Integrity Controls

```yaml
task_id: TASK-005
feature_id: AUDIT-FOUNDATION
workflow_id: AUDIT-CONTROL
phase: P0
priority: P0
status: CODE_COMPLETE
owner_domain: Audit
```

## Objective

Provide tenant-scoped audit querying and tamper evidence for immutable audit
records while preserving append-only storage and the separation from timeline.

## Required Specifications

- `AGENTS.md`
- `docs/MASTER_IMPLEMENTATION_TRACEABILITY_MATRIX.md`
- `docs/AUDIT_LOG_TIMELINE_DATA_MODEL_SPEC.md`
- `docs/API_COMMAND_CONTRACT_SPEC.md`
- `docs/DATABASE_STORAGE_BOUNDARY_SPEC.md`

## In Scope

- Audit checksum and previous-hash metadata.
- Tenant-scoped audit query with bounded pagination and filters.
- Hash-chain integrity verification.
- Append-only and secret-redaction enforcement.
- Unit, migration, integration and contract tests.

## Out of Scope

- Operator timeline projection.
- Audit retention/archive jobs and external signing.
- New business-domain audit events or permissions beyond `audit.read`.

## Acceptance Criteria

1. Audit records remain append-only and reject update/delete/truncate.
2. Audit query always requires tenant context and never returns another tenant.
3. Query limits are bounded and filters are parameterized.
4. New audit rows contain checksum and previous-hash metadata.
5. Integrity verification detects modified or broken chain records.
6. Secrets remain rejected from audit payloads.
7. All applicable tests and build gates pass.
