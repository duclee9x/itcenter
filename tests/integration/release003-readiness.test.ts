import test from "node:test";
import assert from "node:assert/strict";
import {
  PostgresReadiness,
  readExpectedMigrationManifest,
} from "../../packages/persistence/src/index.js";
import { testDatabase } from "../helpers.js";

test("PostgreSQL readiness checks exact schema manifest and recovers without migration", async () => {
  const db = await testDatabase();
  try {
    const manifest = await readExpectedMigrationManifest();
    const readiness = new PostgresReadiness(db.pool, manifest, Date.now, 0);
    const before = await db.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM migration_meta.applied",
    );
    assert.deepEqual(
      (await readiness.components()).map(({ id, state }) => [id, state]),
      [
        ["database", "READY"],
        ["schema", "READY"],
      ],
    );
    await readiness.components();
    const afterProbes = await db.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM migration_meta.applied",
    );
    assert.equal(afterProbes.rows[0]?.count, before.rows[0]?.count);

    await db.pool.query(
      "INSERT INTO migration_meta.applied(name,checksum) VALUES($1,$2)",
      ["release003/unexpected.sql", "unrecognized"],
    );
    assert.equal(
      (await readiness.components())[1]?.reasonCode,
      "SCHEMA_INCOMPATIBLE",
    );

    await db.pool.query("DELETE FROM migration_meta.applied WHERE name=$1", [
      "release003/unexpected.sql",
    ]);
    assert.equal((await readiness.components())[1]?.state, "READY");
  } finally {
    await db.close();
  }
});
