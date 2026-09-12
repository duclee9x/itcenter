# IMPLEMENTATION HANDOFF

## Active Task

TASK-053 — Controlled Network Change + Verification + Rollback

Feature: NETWORK-CHANGE
Workflow: WF-012
Branch: master
Status: CODE_COMPLETE_WITH_INTEGRATION_BOUNDARIES

## Delivered

- Added a Network-owned VLAN change record linked by reference to a tenant
  Change record. Start requires an approved Change already transitioned to
  `IMPLEMENTING` by the Change domain.
- Added idempotent, version-checked commands to create, start, record the
  implementation result, verify expected VLAN plus technical/service/monitoring
  checks, and record rollback trigger/steps/result/verification.
- Failed or incomplete verification requires rollback. Confirmed restoration
  ends at `ROLLED_BACK`; unsuccessful restoration ends at `FAILED`.
- Added append-only phase evidence using opaque references and optional SHA-256
  checksums, tenant-composite database constraints, audit/outbox events and the
  `network.vlan.change` permission. High-risk flags are passed to authorization.
- Fixed migration discovery/order to apply all domain migration directories to
  fresh databases, with Network after Operations. This exposed why the previous
  partial owner list could omit Change/Approval/Network schemas on a fresh DB.
- No real switch/controller commands are executed; operation actions and their
  evidence are recorded for an operator until a device connector is provided.
- High-risk commands now require verified OIDC `acr`, `amr` containing `mfa`,
  and a fresh `auth_time`; missing/stale assurance returns an RFC 9470
  `insufficient_user_authentication` challenge. Defaults are
  `urn:itcenter:acr:mfa` and 300 seconds, configurable via environment.
- Defined `NetworkConfigurationPort` snapshot/apply/verify/restore operations
  with a default implementation that performs no I/O and fails closed. Added a
  runbook for the common OIDC + NETCONF/RESTCONF integration profile.

## Verification

PASS: `npm test` — 22 unit, 2 contract, 1 migration, 18 integration and 12 E2E
tests passed against disposable databases created from the running PostgreSQL
container.

PASS: `npm run format:check`, `npm run lint`, `npm run typecheck`,
`npm run build`, and `git diff --check`.

PASS: migration repair preflighted all 33 migrations against a clone of the
local volume, applied them locally, and passed a second idempotent migration
run. `./local serve` connected to that database; `/health/live` and
`/health/ready` both returned HTTP 200. No database reset or asset data change
occurred (the Asset table was empty before migration).

## Remaining Dependencies

SCOPE_DEPENDENCY: Live VLAN changes and post-change rediscovery still require a
known device/controller model, matching protocol/YANG API, scoped secret
reference and an execution worker. NETCONF/RESTCONF are documented candidates,
not a claimed compatible implementation. No device write is made by this task.

SCOPE_DEPENDENCY: The enforcement boundary is implemented, but deployment still
needs an OIDC provider that issues signed `auth_time`, `acr`, and `amr` claims,
maps the configured ACR to MFA, and honors the RFC 9470 challenge. The runtime
currently has no wired OIDC adapter and remains deny-by-default.

MIGRATION_RISK: The pre-existing local database volume previously reported an
applied migration checksum mismatch. RESOLVED: restored the exact original
Asset migrations, moved the lifecycle default change to
`20260912_007_lifecycle_default.sql`, preflighted the full chain on a clone,
then applied all migrations locally. The local DB records 33 migrations and
the runner verified their source checksums. No applied migration metadata was
edited; no Asset rows existed before the migration.

## Exact Next Step

TASK-054 is ready and its task contract has been generated at
`tasks/TASK-054_SOFTWARE_CATALOG_ARTIFACT_REPOSITORY.md`. Implement software
catalog and artifact intake metadata, preserving the object-storage boundary
and leaving unconfigured scan/storage providers in safe pending states.

When a device/controller is selected, implement its `NetworkConfigurationPort`
adapter and worker wiring as a separately scoped task; first verify the model's
protocol capabilities and rollback mechanism against
`docs/runbooks/network-change-adapter.md`.

## Spec Conflicts

None.
