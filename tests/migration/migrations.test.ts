import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  appendFile,
  readFile,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDatabase } from "../helpers.js";
import { migrate } from "../../database/scripts/runner.js";
test("empty DB applies all migrations; rerun is idempotent and changed migration is rejected", async () => {
  const db = await testDatabase(false);
  let primaryError: unknown;
  try {
    await migrate(db.pool);
    await migrate(db.pool);
    const recommendationTables = await db.pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='problem'
        AND tablename IN ('knowledge_recommendation_sessions','knowledge_recommendation_items','knowledge_recommendation_interactions') ORDER BY tablename`,
    );
    assert.deepEqual(
      recommendationTables.rows.map((row) => row.tablename),
      [
        "knowledge_recommendation_interactions",
        "knowledge_recommendation_items",
        "knowledge_recommendation_sessions",
      ],
    );
    const immutableEvidence = await db.pool.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid IN (
        'problem.knowledge_recommendation_sessions'::regclass,
        'problem.knowledge_recommendation_items'::regclass,
        'problem.knowledge_recommendation_interactions'::regclass
      ) AND NOT tgisinternal ORDER BY tgname`,
    );
    assert.deepEqual(
      immutableEvidence.rows.map((row) => row.tgname),
      [
        "knowledge_recommendation_session_guard",
        "recommendation_interactions_immutable",
        "recommendation_items_immutable",
      ],
    );
    const tables = await db.pool.query(
      "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('identity','platform','audit')",
    );
    // TASK-090-R1 and TASK-092 add explicit Automation/Correlation principals.
    assert.equal(tables.rowCount, 23);
    const domainSchemas = await db.pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[])",
      [
        [
          "communication",
          "control",
          "asset",
          "helpdesk",
          "problem",
          "service",
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
          "procurement",
          "contract",
          "document",
        ],
      ],
    );
    assert.equal(domainSchemas.rowCount, 20);
    const incidentServiceColumns = await db.pool.query(
      "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='incident' AND table_name='incidents' AND column_name IN ('service_id','legacy_service_id')",
    );
    assert.deepEqual(
      incidentServiceColumns.rows.sort((a, b) =>
        a.column_name.localeCompare(b.column_name),
      ),
      [
        { column_name: "legacy_service_id", data_type: "uuid" },
        { column_name: "service_id", data_type: "uuid" },
      ],
    );
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
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await db.close();
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
    }
  }
});

test("canonical Service migration preserves unresolved historical Incident Service values", async () => {
  const db = await testDatabase(false);
  const temp = await mkdtemp(path.join(tmpdir(), "task093-r2a-migration-"));
  const legacyTenant = `legacy-${Date.now()}`;
  const legacyServiceId = "c0000000-0000-4000-8000-000000000001";
  let primaryError: unknown;
  try {
    await cp("database/migrations", temp, { recursive: true });
    await unlink(
      path.join(temp, "service/20260917_001_reference_catalogs.sql"),
    );
    await unlink(
      path.join(temp, "incident/20260917_001_canonical_service_reference.sql"),
    );
    await unlink(
      path.join(temp, "problem/20260918_001_task093_knowledge_foundation.sql"),
    );
    await unlink(
      path.join(temp, "problem/20260918_002_task093_recommendations.sql"),
    );
    await migrate(db.pool, temp);
    await db.pool.query(
      `INSERT INTO incident.incidents
       (id,tenant_id,incident_code,title,source,priority,service_id)
       VALUES($1,$2,'LEGACY-INC','Legacy context','MIGRATION_TEST','P3',$3)`,
      ["c0000000-0000-4000-8000-000000000002", legacyTenant, legacyServiceId],
    );
    await db.pool.query(
      await readFile(
        "database/migrations/service/20260917_001_reference_catalogs.sql",
        "utf8",
      ),
    );
    await db.pool.query(
      await readFile(
        "database/migrations/incident/20260917_001_canonical_service_reference.sql",
        "utf8",
      ),
    );
    const retained = await db.pool.query(
      "SELECT service_id,legacy_service_id FROM incident.incidents WHERE tenant_id=$1 AND incident_code='LEGACY-INC'",
      [legacyTenant],
    );
    assert.deepEqual(retained.rows[0], {
      service_id: null,
      legacy_service_id: legacyServiceId,
    });
    const created = await db.pool.query(
      "SELECT count(*)::int AS n FROM service.services WHERE tenant_id=$1",
      [legacyTenant],
    );
    assert.equal(created.rows[0]!.n, 0);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await db.close();
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
});
