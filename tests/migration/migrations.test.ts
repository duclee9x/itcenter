import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDatabase } from "../helpers.js";
import { migrate } from "../../database/scripts/runner.js";
test("empty DB applies all migrations; rerun is idempotent and changed migration is rejected", async () => {
  const db = await testDatabase(false);
  try {
    await migrate(db.pool);
    await migrate(db.pool);
    const tables = await db.pool.query(
      "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('identity','platform','audit')",
    );
    // TASK-002 adds identity.sessions to the foundation schema.
    assert.equal(tables.rowCount, 15);
    const domainSchemas = await db.pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[])",
      [
        [
          "communication",
          "control",
          "asset",
          "helpdesk",
          "problem",
          "audit_ops",
          "incident",
          "maintenance",
          "monitoring",
          "agent",
          "automation",
          "operations",
          "network",
          "software",
          "artifact",
          "license",
        ],
      ],
    );
    assert.equal(domainSchemas.rowCount, 16);
    const invalid = await db.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='platform' AND table_name='outbox_events'",
    );
    for (const name of [
      "event_id",
      "event_type",
      "schema_version",
      "aggregate_version",
      "correlation_id",
      "causation_id",
      "attempt_count",
      "status",
    ])
      assert.ok(invalid.rows.some((r) => r.column_name === name));
    const temp = await mkdtemp(path.join(tmpdir(), "task000-migration-"));
    await cp("database/migrations", temp, { recursive: true });
    await appendFile(
      path.join(temp, "platform/20260911_001_platform.sql"),
      "\n-- modified",
    );
    await assert.rejects(migrate(db.pool, temp), /Applied migration changed/);
  } finally {
    await db.close();
  }
});
