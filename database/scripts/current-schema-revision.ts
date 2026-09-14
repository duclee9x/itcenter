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
  if (
    applied.size !== expected.length ||
    expected.some((entry) => applied.get(entry.name) !== entry.checksum)
  ) {
    process.stderr.write("SCHEMA_INCOMPATIBLE\n");
    process.exitCode = 2;
  } else {
    process.stdout.write(`${migrationManifestRevision(expected)}\n`);
  }
} catch {
  process.stderr.write("SCHEMA_INCOMPATIBLE\n");
  process.exitCode = 2;
} finally {
  await pool.end();
}
