# Local development and migration recovery

Use the root README commands. Never commit `.env` or real connection strings. The Compose database binds to loopback only and requires a caller-supplied local password. No destructive reset command is included.

Run migrations before starting apps with `./local start`. When the database already contains the required schema, use `./local serve` to start the API without applying migrations. The local helper detects the published PostgreSQL port from `itcenter-postgres`, including the current `127.0.0.1:15432` mapping. Current API/gateway readiness checks a platform table with a zero-row query; missing schema or unavailable DB returns a sanitized 503. Worker liveness is available, but readiness currently remains 503 because its callback is fixed false. RELEASE-003-R1 now specifies the target profiles and 13-worker policy; those checks are not implemented yet. SIGINT/SIGTERM closes HTTP listeners and pools; shutdown has a 10-second bound. See [the readiness contract](../release/items/RELEASE-003-R1_PRODUCTION_READINESS_CRITICAL_WORKER_CONTRACT.md).

Migrations use immutable filenames and checksums. If an applied file differs, restore the original migration and create a new forward migration. A failed migration rolls back only itself; prior successful versions remain recorded. Production upgrades follow expand/backfill/switch/contract. Do not remove audit immutability triggers as a repair shortcut.

Recovery example: the local volume had applied historical Asset migrations whose source had later been edited. Their exact original contents were recovered from disposable migration-test copies; the historical files were restored byte-for-byte, and the intended lifecycle default change moved into `asset/20260912_007_lifecycle_default.sql`. The complete migration chain was first applied to a clone of the volume, then to the local database. The local database now records 33 migrations with matching checksums. Never repair this condition by changing `migration_meta.applied` directly.

Database tests create disposable databases with randomized `task000_` names. A crashed test can leave one behind; confirm ownership and active sessions before deleting test data. The test account requires CREATE DATABASE, but the production runtime should not have that privilege.

Permission seeds are catalog-only. They neither create an admin user nor grant a role. A seed definition conflict requires a reviewed migration/catalog change.

Production checklist left to deployment work: real OIDC/agent authentication and policy adapters, secret-manager mounts, dedicated migration/runtime database roles, backups and restore drill, monitored broker delivery, verified database TLS, metrics exporter, process supervision and ingress TLS. TASK-000 does not claim a production deployment.
