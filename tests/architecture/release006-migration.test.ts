import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file: string) => readFile(file, "utf8");

test("RELEASE-006 rehearsal is isolated, digest-bound, and Podman-native", async () => {
  const script = await read("deploy/scripts/rehearse-migration.sh");
  const readme = await read("deploy/README.md");
  assert.match(script, /--from <N-1-release\.json>/);
  assert.match(script, /--to <N-release\.json>/);
  assert.match(script, /ISOLATED_STAGING_REQUIRED/);
  assert.match(script, /ISOLATED_COMPOSE_DATABASE_REQUIRED/);
  assert.match(script, /itsm-migration-rehearsal-/);
  assert.match(script, /--volumes --remove-orphans/);
  assert.match(script, /verify_image_digest/);
  assert.match(script, /MIGRATION_MAX_STEPS/);
  assert.match(script, /PRE_MIGRATION_BACKUP_FAILED/);
  assert.match(script, /App N-1 \+ Schema N-1/);
  assert.match(script, /App N \+ Schema N-1/);
  assert.match(script, /App N-1 \+ Schema N/);
  assert.match(script, /App N \+ Schema N/);
  assert.match(readme, /CONTROLLED_MAINTENANCE/);
  assert.match(readme, /lock_timeout=10s/);
  assert.match(readme, /statement_timeout=10m/);
  assert.match(readme, /30-minute overall migration budget/);
  assert.doesNotMatch(script, /docker compose|kubectl|helm|kubernetes/i);
});

test("RELEASE-006 migration runner applies bounded PostgreSQL session settings", async () => {
  const runner = await read("database/scripts/runner.ts");
  const revision = await read("database/scripts/applied-schema-revision.ts");
  const manifest = await read("packages/persistence/src/migration-manifest.ts");
  assert.match(runner, /DEFAULT_MIGRATION_LOCK_TIMEOUT = "10s"/);
  assert.match(runner, /DEFAULT_MIGRATION_STATEMENT_TIMEOUT = "10min"/);
  assert.match(runner, /set_config\('lock_timeout'/);
  assert.match(runner, /set_config\('statement_timeout'/);
  assert.match(runner, /limitMigrationManifest/);
  assert.match(manifest, /MIGRATION_MAX_STEPS_INVALID/);
  assert.match(revision, /schema_revision/);
  assert.match(revision, /SCHEMA_STATE_INCOMPATIBLE/);
});

test("RELEASE-006 deployment wrapper enforces the 30-minute migration budget", async () => {
  const common = await read("deploy/scripts/common.sh");
  const deploy = await read("deploy/scripts/deploy.sh");
  const rollback = await read("deploy/scripts/rollback.sh");
  assert.match(common, /MIGRATION_TIMEOUT_SECONDS:-1800/);
  assert.match(common, /MIGRATION_TIMEOUT_INVALID/);
  assert.match(common, /timeout --signal=TERM/);
  assert.match(deploy, /run_migration_with_budget/);
  assert.match(rollback, /run_migration_with_budget/);
});
