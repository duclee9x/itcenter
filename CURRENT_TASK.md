# CURRENT TASK

Task: `TASK-053`

Task specification: `tasks/TASK-053_CONTROLLED_NETWORK_CHANGE.md`

Status: `CODE_COMPLETE_WITH_INTEGRATION_BOUNDARIES`

Branch: `master`

Controlled VLAN changes now require a tenant-owned Change in `IMPLEMENTING`
with an approved approval request. Network commands record implementation,
technical/service/monitoring verification, and rollback evidence with
idempotency, optimistic concurrency, authorization, audit and outbox effects.
The API records operator evidence and does not configure live devices.

Next ready task: `TASK-054` — Software Catalog + Artifact Repository.

High-risk VLAN commands now require verified OIDC `acr`/`amr`/`auth_time`
assurance and return an RFC 9470 step-up challenge when assurance is missing or
stale. A provider-neutral network adapter port is defined with a no-I/O,
fail-closed default; no live device protocol is enabled without a known model.
Local PostgreSQL migration history was reconciled without editing applied
checksums; all 33 repository migrations are applied and API readiness returned
HTTP 200.
