# RELEASE-006 Implementation Report

| Field            | Value                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| Status           | `CODE_COMPLETE / NOT VERIFIED`                                                  |
| Contract         | [RELEASE-006-R1](RELEASE-006-R1_POSTGRESQL_MIGRATION_COMPATIBILITY_CONTRACT.md) |
| Runtime          | Lima VM, rootless Podman, `podman compose`                                      |
| Deployment mode  | `CONTROLLED_MAINTENANCE`, `SINGLE_HOST`, `NO_HA`                                |
| Migration budget | 30 minutes overall; `lock_timeout=10s`; `statement_timeout=10m`                 |

## Implementation

`deploy/scripts/rehearse-migration.sh` is the deterministic operator entry
point. It accepts exact N-1 and N release metadata, rejects production
configuration, creates a unique isolated Compose project, uses a fresh
PostgreSQL volume, runs the pre-migration backup gate, applies the migration
chain, validates schema revisions, starts the candidate API, Agent Gateway,
Worker and Caddy profiles, and reuses the RELEASE-004 smoke path. It writes a
per-run JSON result and cleans the temporary project and work directory on
success or failure unless `--keep` is supplied.

The rehearsal uses the same OCI image generation for the candidate migration
and candidate application. A historical N-1 release must provide an immutable
image reference. A transitional N-1 reference is accepted only when its
source commit, schema revision, migration-step count and artifact provenance
are recorded; no historical digest is fabricated.

The four-cell matrix is persisted for every completed run:

| Combination          | Default v1 result                      |
| -------------------- | -------------------------------------- |
| App N-1 + Schema N-1 | `SUPPORTED` after baseline smoke       |
| App N + Schema N-1   | `UNSUPPORTED` unless separately proven |
| App N-1 + Schema N   | `UNSUPPORTED` unless separately proven |
| App N + Schema N     | `SUPPORTED` after candidate smoke      |

The current exact-schema default therefore derives
`FORWARD_FIX_REQUIRED` for application rollback. The guard remains explicit
and release-pair scoped; no automatic down migration or database restore is
introduced.

## Migration controls

The migration runner applies session-local PostgreSQL settings before reading
or applying migrations. `MIGRATION_LOCK_TIMEOUT` defaults to `10s` and
`MIGRATION_STATEMENT_TIMEOUT` defaults to `10min`. The rehearsal and RELEASE-004
deployment wrapper enforce `MIGRATION_TIMEOUT_SECONDS`, defaulting to 1800
seconds. Test runs may shorten the wrapper value through the environment; the
production default is unchanged.

The existing runner keeps the advisory lock and one transaction per migration.
The migration manifest can be deterministically limited with
`MIGRATION_MAX_STEPS`, which is used to establish an N-1 schema prefix. The
new schema-state helper verifies that the applied migrations are an exact
manifest prefix and reports its checksum-derived revision. A successful
rerun is therefore a no-op for already applied migrations; failed migrations
are not retried automatically.

The inspected migration set contains transactional DDL/data work under the
existing per-migration transaction model. No `CREATE INDEX CONCURRENTLY`,
`VACUUM`, explicit transaction boundary, or other known framework-level
non-transactional operation was found. The transition inventory includes
data backfills in `incident/20260920_002_task094_monitoring_asset_link_backfill.sql`,
`asset/20260919_002_normalize_legacy_missing_risk.sql`, and the state-history
migrations. Compatibility-sensitive constraint and nullability changes are
present in `agent/20260928_001_release002_mtls_credentials.sql` and
`control/20260924_001_task095_r3_sla_target_purpose.sql`; these remain subject
to the rehearsal evidence rather than being declared online-compatible.

The fixture database is intentionally synthetic. The evidence records timings
and validation for the tested data, but it does not claim production-scale
performance. Migrations whose cost depends on table size retain the
`PERFORMANCE_LIMITATION` operational qualification until representative data
is available.

## Evidence and recovery boundaries

Evidence is immutable per run under the configured release state directory.
It records release identities, source and target schema, candidate digest,
backup reference, durations, timeout fields, compatibility matrix, data,
Worker and Gateway validation, rollback result, and final `PASS` or `FAIL`.
The rehearsal's backup gate must emit a backup reference; `--test-mode` uses an
isolated test reference only and is explicitly classified as `ISOLATED_TEST`.

The implementation exercises the RELEASE-005 gate semantics without changing
RELEASE-005's status. It does not claim age encryption, a writable
HOST_PROTECTED Lima-to-macOS mount, measured RPO/RTO, or recovery escrow
evidence. Those requirements remain pending before RELEASE-005 can be
verified.

The production sequence remains:

```text
controlled maintenance and drain
→ protected pre-migration backup
→ candidate migration
→ schema validation
→ candidate API/Gateway/Worker readiness
→ smoke validation
→ leave maintenance
```

The rehearsal itself is never allowed to target production. Its Compose
configuration must be staging and Compose-managed PostgreSQL, and it uses a
unique project, network and volume for each run.

## Verification

Automated tests cover the rehearsal interface and isolation rules, immutable
image requirements, Podman-only runtime selection, timeout defaults and
session-setting application. Repository migration, integration, E2E,
typecheck and lint checks pass. The full production-like N-1 rehearsal has
not been executed because the repository has no genuine previous immutable RC
metadata and the RELEASE-005 age/HOST_PROTECTED environment gaps remain.

Therefore RELEASE-006 is `CODE_COMPLETE / NOT VERIFIED`, RELEASE-005 remains
`CODE_COMPLETE / NOT VERIFIED` with RPO/RTO `UNVERIFIED`, and the overall
release remains `BLOCKED_FOR_RC`.
