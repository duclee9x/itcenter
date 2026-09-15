import path from "node:path";
import type pg from "pg";
import { readFile } from "node:fs/promises";
import {
  limitMigrationManifest,
  readExpectedMigrationManifest,
} from "../../packages/persistence/src/migration-manifest.js";

export const DEFAULT_MIGRATION_LOCK_TIMEOUT = "10s";
export const DEFAULT_MIGRATION_STATEMENT_TIMEOUT = "10min";

function migrationSetting(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export async function applyMigrationSessionSettings(
  client: Pick<pg.PoolClient, "query">,
): Promise<void> {
  await client.query("SELECT set_config('lock_timeout', $1, false)", [
    migrationSetting("MIGRATION_LOCK_TIMEOUT", DEFAULT_MIGRATION_LOCK_TIMEOUT),
  ]);
  await client.query("SELECT set_config('statement_timeout', $1, false)", [
    migrationSetting(
      "MIGRATION_STATEMENT_TIMEOUT",
      DEFAULT_MIGRATION_STATEMENT_TIMEOUT,
    ),
  ]);
}

export async function migrate(
  pool: pg.Pool,
  root = path.resolve("database/migrations"),
): Promise<void> {
  const allMigrations = await readExpectedMigrationManifest(root);
  const manifest = limitMigrationManifest(allMigrations);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(70911000)");
    await applyMigrationSessionSettings(client);
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
