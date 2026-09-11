# Local development and migration recovery

Use the root README commands. Never commit `.env` or real connection strings. The Compose database binds to loopback only and requires a caller-supplied local password. No destructive reset command is included.

Run migrations before starting apps with `./local start`. When the database already contains the required schema, use `./local serve` to start the API without applying migrations. The local helper detects the published PostgreSQL port from `itcenter-postgres`, including the current `127.0.0.1:15432` mapping. API/gateway readiness checks a platform table with a zero-row query; missing schema or unavailable DB returns a sanitized 503. Worker liveness is available, but readiness is 503 until delivery adapters are configured. SIGINT/SIGTERM closes HTTP listeners and pools; shutdown has a 10-second bound.

Migrations use immutable filenames and checksums. If an applied file differs, restore the original migration and create a new forward migration. A failed migration rolls back only itself; prior successful versions remain recorded. Production upgrades follow expand/backfill/switch/contract. Do not remove audit immutability triggers as a repair shortcut.

Database tests create disposable databases with randomized `task000_` names. A crashed test can leave one behind; confirm ownership and active sessions before deleting test data. The test account requires CREATE DATABASE, but the production runtime should not have that privilege.

Permission seeds are catalog-only. They neither create an admin user nor grant a role. A seed definition conflict requires a reviewed migration/catalog change.

Production checklist left to deployment work: real OIDC/agent authentication and policy adapters, secret-manager mounts, dedicated migration/runtime database roles, backups and restore drill, monitored broker delivery, verified database TLS, metrics exporter, process supervision and ingress TLS. TASK-000 does not claim a production deployment.
