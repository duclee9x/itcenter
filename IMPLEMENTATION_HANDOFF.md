# IMPLEMENTATION HANDOFF

## Active Task

TASK-053 — Controlled Network Change + Verification + Rollback

Feature: NETWORK-CHANGE
Workflow: WF-012
Branch: master
Status: CODE_COMPLETE

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

## Verification

PASS: `npm test` — 21 unit, 2 contract, 1 migration, 18 integration and 12 E2E
tests passed against disposable databases created from the running PostgreSQL
container.

PASS: `npm run format:check`, `npm run lint`, `npm run typecheck`,
`npm run build`, and `git diff --check`.

The running local database volume was not reset or migrated by these tests.

## Remaining Dependencies

SCOPE_DEPENDENCY: Live VLAN changes and post-change rediscovery require a
network controller/switch connector, scoped credentials and an execution
worker. No device write is made by this task.

SCOPE_DEPENDENCY: Re-authentication/MFA assurance depends on the authentication
and authorization provider. API commands send the high-risk/MFA/re-auth
requirements to the authorization port; the current repository has no wired
step-up assurance provider, and the default runtime remains deny-by-default.

MIGRATION_RISK: The pre-existing local database volume previously reported an
applied migration checksum mismatch. Do not edit historical migrations or
reset that volume; use a forward migration after reconciling the original
checksum.

## Exact Next Step

TASK-054 is ready and its task contract has been generated at
`tasks/TASK-054_SOFTWARE_CATALOG_ARTIFACT_REPOSITORY.md`. Implement software
catalog and artifact intake metadata, preserving the object-storage boundary
and leaving unconfigured scan/storage providers in safe pending states.

## Spec Conflicts

None.
