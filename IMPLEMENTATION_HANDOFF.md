# IMPLEMENTATION HANDOFF

## Next Task

TASK-058 — License Assignment + Reclaim + Compliance

Feature: F-035/F-036

Workflow: WF-015

Phase/Priority: P3 / P0

Readiness: READY

Status: NOT_STARTED

Task contract: `tasks/TASK-058_LICENSE_ASSIGNMENT_RECLAIM_COMPLIANCE.md`

## Previous Task Completed

TASK-057 — License Entitlement + Pool Model (`CODE_COMPLETE`)

- Added License-owned tenant-scoped pools, entitlements, versioned validity
  terms, append-only term/history records, and derived effective state.
- Added authenticated create/read/list/update/renew routes with stable
  permissions, tenant isolation, idempotency, expected versions, audit, and
  transactional outbox events.
- Added worker facts for configured renewal warnings and expired entitlement
  terms, each deduplicated by term version.
- Applied the migration and permission seed to local PostgreSQL.
- `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `git diff --check`, and `npm test` passed (22 unit, 2 contract, 1 migration,
  18 integration, 15 E2E tests).

## TASK-058 Readiness

Prerequisites TASK-031 and TASK-057 are satisfied. TASK-054 provides catalog
identity; TASK-055 has a fail-closed license-required deployment path awaiting
an authoritative reservation application contract. No external appliance,
vendor API, IdP, or credential is required for the repository's generic
implementation.

The task contract sets two guardrails before implementation: Software must call
a narrow License reservation contract rather than write License tables, and
compliance must report `UNKNOWN` when a license model lacks a supported
consumption rule or authoritative usage evidence. This avoids guessing for
concurrent, site, enterprise, and other non-seat models.

## Repository State

- Branch: `master`
- TASK-057 implementation and completion report are committed.
- Next: begin TASK-058 only after the TASK-057 commit is recorded.
