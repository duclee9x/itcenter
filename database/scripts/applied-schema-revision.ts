import {
  loadConfig,
  databaseUrl,
  EnvironmentSecretProvider,
} from "../../packages/config/src/index.js";
import { createPool } from "../../packages/persistence/src/index.js";
import {
  migrationManifestRevision,
  readExpectedMigrationManifest,
} from "../../packages/persistence/src/migration-manifest.js";

const pool = createPool(
  databaseUrl(
    loadConfig(process.env),
    new EnvironmentSecretProvider(process.env),
  ),
);

try {
  const expected = await readExpectedMigrationManifest();
  const result = await pool.query<{ name: string; checksum: string }>(
    "SELECT name,checksum FROM migration_meta.applied",
  );
  const applied = new Map(
    result.rows.map((entry) => [entry.name, entry.checksum]),
  );
  const count = result.rows.length;
  const prefix = expected.slice(0, count);
  const isPrefix =
    prefix.length === count &&
    prefix.every((entry) => applied.get(entry.name) === entry.checksum) &&
    applied.size === count;
  if (!isPrefix) {
    process.stderr.write("SCHEMA_STATE_INCOMPATIBLE\n");
    process.exitCode = 2;
  } else {
    process.stdout.write(
      JSON.stringify({
        schema_revision: migrationManifestRevision(prefix),
        applied_count: count,
        total_count: expected.length,
        complete: count === expected.length,
      }) + "\n",
    );
  }
} catch {
  process.stderr.write("SCHEMA_STATE_UNAVAILABLE\n");
  process.exitCode = 2;
} finally {
  await pool.end();
}
