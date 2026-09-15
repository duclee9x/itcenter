# RELEASE-006-R1 — PostgreSQL Migration Compatibility & Rehearsal Contract

| Field | Value |
| --- | --- |
| Release item | RELEASE-006 — PostgreSQL Migration Rehearsal + N-1 Compatibility |
| Type | Planning/specification only |
| Status | `BLOCKED / NOT_STARTED` |
| Blocker | `SPEC_GAP / OPERATIONAL_DECISION` |
| Runtime | Lima VM, rootless Podman, `podman compose` |
| Depends on | RELEASE-004 and RELEASE-005 implementation inputs; their verification remains open |

## Purpose

RELEASE-006 must produce evidence that a production-like PostgreSQL database
can move from the immediately previous compatible release to the candidate
release, and that application behavior at each schema boundary is known.
Fresh-install migration tests are necessary but do not answer that question.

This document records the contract gap found during state recovery. It does
not implement migration rehearsal automation and does not authorize RELEASE-007.

## Current repository facts

- The runtime PostgreSQL version observed in the local environment is 18.6.
- The repository contains 100 SQL migration files.
- `packages/persistence/src/migration-manifest.ts` defines deterministic owner
  and file ordering. The manifest revision is the SHA-256 of the ordered
  migration entries and their file checksums.
- `database/scripts/runner.ts` serializes migration execution with advisory
  lock `70911000`, records applied names/checksums in
  `migration_meta.applied`, and runs each migration in its own transaction.
  The complete migration chain is not one transaction.
- The shared pool currently has a 5-second connection timeout and a 10-second
  statement timeout. No migration-specific lock timeout or migration duration
  budget is normatively defined.
- `current-schema-revision.ts` accepts only an exact match between the
  expected manifest and `migration_meta.applied`. RELEASE-003 therefore keeps
  the supported schema range exact; it must not be widened by rehearsal code.
- RELEASE-004 rollback checks the target artifact's schema revision against the
  current database and rejects an incompatible application rollback. There is
  no automatic database down-migration.
- The chain contains data transformations and compatibility-sensitive DDL,
  including legacy SLA-purpose normalization, asset-risk normalization,
  monitoring/incident link backfill, state-history baselines, column rename,
  constraint replacement, and Agent mTLS schema changes. These operations
  require explicit classification during rehearsal.

## Definitions that must be fixed

`N` is the candidate release represented by an exact immutable OCI artifact and
its exact migration manifest. `N-1` is the immediately previous
production-compatible release artifact and schema, not an arbitrary old Git
commit. If no prior immutable RC exists, the contract must approve a
deterministic application/schema fixture and record that limitation rather than
inventing a registry digest.

The rehearsal must report all four combinations:

| Application | Schema | Required result |
| --- | --- | --- |
| N-1 | N-1 | `SUPPORTED`, baseline validity |
| N | N-1 | `SUPPORTED` or `UNSUPPORTED`, with evidence |
| N-1 | N | `SUPPORTED` or `UNSUPPORTED`, with evidence |
| N | N | `SUPPORTED`, target validation |

The current repository does not provide a normative result for these four
combinations. Exact-schema readiness and the rollback guard prove only that
the current application expects the current manifest; they do not prove
cross-version compatibility.

## Decisions required before implementation

The following decisions are material and unresolved. RELEASE-006 remains
blocked until they are approved in a completed R1 contract:

1. **N-1 identity:** identify the exact prior OCI release/schema or approve a
   deterministic fixture and define how its provenance is recorded.
2. **Compatibility policy:** approve the result and operational meaning of all
   four matrix cells, including whether `N-1 + Schema N` permits application
   rollback.
3. **Migration boundary:** decide whether the current chain requires a
   controlled maintenance window, and define rollout order when `N + Schema
   N-1` is unsupported.
4. **Destructive and expand/contract policy:** classify the existing rename,
   constraint, nullability, data-transform and backfill operations; define when
   expand/contract is required for future changes.
5. **Timeout and lock policy:** set a migration duration budget and, where
   applicable, `lock_timeout`, `statement_timeout`, and handling of blocked
   application work. The incidental 10-second pool setting is not a release
   decision.
6. **Failure and retry policy:** define evidence and operator action for a
   failed migration, a failed transaction, a non-transactional/partially
   applied operation, and a safe retry. Blind rerun and automatic down
   migration are not acceptable defaults.
7. **Rehearsal scale and concurrency:** define the sanitized representative
   dataset, required row-count/size envelope, concurrent operations, and lock
   observations required to support the conclusion. A small fixture cannot
   prove production-scale safety.
8. **Validation and approval evidence:** define required data-integrity checks,
   API/Worker/Agent Gateway smoke paths, machine-readable rehearsal evidence,
   human report, production approval, and acceptance thresholds.
9. **Forward-fix boundary:** define when an incompatible N-1 rollback becomes
   `FORWARD_FIX_REQUIRED` and when the RELEASE-005 restore path is the approved
   recovery action. No automatic database rollback is implied.

## Evidence required after the contract is complete

The implementation phase must use the exact RELEASE-004 migration command and
the same immutable candidate image. It must exercise the RELEASE-005
pre-migration backup gate in an isolated environment, record source/target
schema, PostgreSQL version, artifact digest, migration duration, lock impact,
data validation, application validation, failure behavior, and the four-cell
compatibility matrix. It must also test a fresh install and an N-1 upgrade.

The local RELEASE-005 gaps remain dependencies for production-like evidence:
the actual Lima runtime still lacks verified `age` availability and a writable
HOST_PROTECTED mount, and no production-like backup/restore rehearsal has been
accepted. A fixture-based RELEASE-006 test may be implementation evidence but
cannot mark RELEASE-005 `VERIFIED`, RPO `MET`, or RTO `MET`.

## Status decision

`RELEASE-006-R1` is planning-only and incomplete until the decisions above are
made. Therefore:

- `RELEASE-006 = BLOCKED / NOT_STARTED`;
- blocker = `SPEC_GAP / OPERATIONAL_DECISION`;
- no RELEASE-006 runtime or rehearsal automation is introduced here;
- RELEASE-007 is not started;
- the overall release remains `BLOCKED_FOR_RC`.
