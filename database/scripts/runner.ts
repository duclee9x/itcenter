import path from "node:path";
import type pg from "pg";
import { readFile } from "node:fs/promises";
import { readExpectedMigrationManifest } from "../../packages/persistence/src/migration-manifest.js";
export async function migrate(
  pool: pg.Pool,
  root = path.resolve("database/migrations"),
): Promise<void> {
  const manifest = await readExpectedMigrationManifest(root);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(70911000)");
    await client.query("CREATE SCHEMA IF NOT EXISTS migration_meta");
    await client.query(
      "CREATE TABLE IF NOT EXISTS migration_meta.applied(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const { name, checksum } of manifest) {
      const sql = await readFile(path.join(root, name), "utf8");
      const applied = await client.query(
        "SELECT checksum FROM migration_meta.applied WHERE name=$1",
        [name],
      );
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO migration_meta.applied(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(70911000)");
    } finally {
      client.release();
    }
  }
}
