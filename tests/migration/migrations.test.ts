import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
    // TASK-090-R1, TASK-092 and TASK-094-R2 add canonical principal/recovery storage.
    assert.equal(tables.rowCount, 25);
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

test("TASK-094-R2 migration moves legacy Asset MISSING evidence out of risk_state without guessing", async () => {
  const db = await testDatabase(false);
  const temp = await mkdtemp(path.join(tmpdir(), "task094-r2-migration-"));
  const tenant = `task094-r2-legacy-${Date.now()}`;
  const userId = "c0000000-0000-4000-8000-000000000011";
  const caseId = "c0000000-0000-4000-8000-000000000012";
  const categoryId = "c0000000-0000-4000-8000-000000000013";
  const modelId = "c0000000-0000-4000-8000-000000000014";
  const linkedAsset = "c0000000-0000-4000-8000-000000000015";
  const unlinkedAsset = "c0000000-0000-4000-8000-000000000016";
  const clearanceId = "c0000000-0000-4000-8000-000000000017";
  let primaryError: unknown;
  try {
    await cp("database/migrations", temp, { recursive: true });
    await unlink(
      path.join(temp, "identity/20260919_001_offboarding_asset_recovery.sql"),
    );
    await unlink(
      path.join(temp, "asset/20260919_002_normalize_legacy_missing_risk.sql"),
    );
    await migrate(db.pool, temp);
    await db.pool.query(
      "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,$2,'USR-R2-LEGACY','usr-r2-legacy','Legacy Recovery','TERMINATING')",
      [userId, tenant],
    );
    await db.pool.query(
      "INSERT INTO identity.offboarding_cases(id,tenant_id,user_id,state,pre_offboarding_user_state,termination_request_id,version) VALUES($1,$2,$3,'IN_PROGRESS','ACTIVE','TERM-R2-LEGACY',2)",
      [caseId, tenant, userId],
    );
    await db.pool.query(
      "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Legacy category')",
      [categoryId, tenant],
    );
    await db.pool.query(
      "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Example','Legacy model',$3)",
      [modelId, tenant, categoryId],
    );
    for (const [id, code] of [
      [linkedAsset, "AST-R2-LINKED"],
      [unlinkedAsset, "AST-R2-UNLINKED"],
    ])
      await db.pool.query(
        "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state,risk_state) VALUES($1,$2,$3,$4,'ASSIGNED','MISSING')",
        [id, tenant, code, modelId],
      );
    await db.pool.query(
      "INSERT INTO identity.offboarding_clearance_tasks(id,tenant_id,offboarding_case_id,clearance_type,resource_id,state,detail) VALUES($1,$2,$3,'ASSET_RETURN',$4,'BLOCKED','Existing exact Asset recovery reference')",
      [clearanceId, tenant, caseId, linkedAsset],
    );
    await cp(
      "database/migrations/identity/20260919_001_offboarding_asset_recovery.sql",
      path.join(temp, "identity/20260919_001_offboarding_asset_recovery.sql"),
    );
    await migrate(db.pool, temp);
    await db.pool.query(
      "UPDATE identity.offboarding_clearance_tasks SET asset_recovery_state='PENDING_RETURN' WHERE tenant_id=$1 AND id=$2",
      [tenant, clearanceId],
    );
    await cp(
      "database/migrations/asset/20260919_002_normalize_legacy_missing_risk.sql",
      path.join(temp, "asset/20260919_002_normalize_legacy_missing_risk.sql"),
    );
    await migrate(db.pool, temp);
    const assets = await db.pool.query(
      "SELECT id,risk_state FROM asset.assets WHERE tenant_id=$1 ORDER BY id",
      [tenant],
    );
    assert.deepEqual(assets.rows, [
      { id: linkedAsset, risk_state: "UNKNOWN" },
      { id: unlinkedAsset, risk_state: "UNKNOWN" },
    ]);
    const recovery = await db.pool.query(
      "SELECT asset_recovery_state,state FROM identity.offboarding_clearance_tasks WHERE tenant_id=$1 AND id=$2",
      [tenant, clearanceId],
    );
    assert.deepEqual(recovery.rows[0], {
      asset_recovery_state: "MISSING",
      state: "BLOCKED",
    });
    const recoveryHistory = await db.pool.query(
      "SELECT from_state,to_state FROM identity.offboarding_asset_recovery_history WHERE tenant_id=$1 AND clearance_id=$2",
      [tenant, clearanceId],
    );
    assert.deepEqual(recoveryHistory.rows[0], {
      from_state: "PENDING_RETURN",
      to_state: "MISSING",
    });
    const evidence = await db.pool.query(
      "SELECT asset_id,evidence_type,payload->>'reconciliation_required' AS reconciliation_required FROM asset.lifecycle_evidence_history WHERE tenant_id=$1 ORDER BY asset_id",
      [tenant],
    );
    assert.deepEqual(evidence.rows, [
      {
        asset_id: linkedAsset,
        evidence_type: "LEGACY_RISK_MISSING_RECOVERY_MIGRATED",
        reconciliation_required: "false",
      },
      {
        asset_id: unlinkedAsset,
        evidence_type: "LEGACY_RISK_MISSING_UNLINKED",
        reconciliation_required: "true",
      },
    ]);
    await assert.rejects(
      db.pool.query(
        "UPDATE asset.assets SET risk_state='MISSING' WHERE tenant_id=$1 AND id=$2",
        [tenant, unlinkedAsset],
      ),
    );
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

test("TASK-094-R3 backfills only deterministic same-tenant Incident Asset evidence and normalizes Warranty projection", async () => {
  const db = await testDatabase(false);
  const temp = await mkdtemp(path.join(tmpdir(), "task094-r3-migration-"));
  const tenant = `task094-r3-legacy-${Date.now()}`;
  const foreignTenant = `${tenant}-foreign`;
  const localAsset = "c0000000-0000-4000-8000-000000000031";
  const foreignAsset = "c0000000-0000-4000-8000-000000000032";
  const localEvent = "c0000000-0000-4000-8000-000000000033";
  const foreignEvent = "c0000000-0000-4000-8000-000000000034";
  const localIncident = "c0000000-0000-4000-8000-000000000035";
  const foreignIncident = "c0000000-0000-4000-8000-000000000036";
  let primaryError: unknown;
  try {
    await cp("database/migrations", temp, { recursive: true });
    for (const file of [
      "asset/20260920_001_task094_warranty_projection.sql",
      "identity/20260920_001_task094_r3_permissions.sql",
      "incident/20260920_001_task094_asset_links.sql",
      "incident/20260920_002_task094_monitoring_asset_link_backfill.sql",
      "monitoring/20260920_001_task094_asset_reliability.sql",
    ])
      await unlink(path.join(temp, file));
    await migrate(db.pool, temp);
    const category = randomUUID();
    const model = randomUUID();
    await db.pool.query(
      "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Legacy')",
      [category, tenant],
    );
    await db.pool.query(
      "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Maker','Legacy',$3)",
      [model, tenant, category],
    );
    for (const [id, owner, code] of [
      [localAsset, tenant, "R3-LOCAL"],
      [foreignAsset, foreignTenant, "R3-FOREIGN"],
    ]) {
      const ownerCategory = owner === tenant ? category : randomUUID();
      const ownerModel = owner === tenant ? model : randomUUID();
      if (owner !== tenant) {
        await db.pool.query(
          "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Foreign')",
          [ownerCategory, owner],
        );
        await db.pool.query(
          "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Maker','Foreign',$3)",
          [ownerModel, owner, ownerCategory],
        );
      }
      await db.pool.query(
        "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,warranty_state) VALUES($1,$2,$3,$4,'LEGACY_UNKNOWN')",
        [id, owner, code, ownerModel],
      );
    }
    for (const [eventId, incidentId, assetId, code, owner] of [
      [localEvent, localIncident, localAsset, "R3-LOCAL-INC", tenant],
      [foreignEvent, foreignIncident, foreignAsset, "R3-FOREIGN-INC", tenant],
    ]) {
      await db.pool.query(
        `INSERT INTO monitoring.events
          (id,tenant_id,source,provider_event_id,asset_id,metric,observed_value,severity,observed_at)
         VALUES($1,$2,'legacy-monitoring',$3,$4,'cpu','95','CRITICAL','2026-09-01T00:00:00Z')`,
        [eventId, owner, `provider-${code}`, assetId],
      );
      await db.pool.query(
        `INSERT INTO incident.incidents
          (id,tenant_id,incident_code,title,source,monitoring_event_id,priority)
         VALUES($1,$2,$3,$3,'MONITORING',$4,'P2')`,
        [incidentId, tenant, code, eventId],
      );
    }
    for (const file of [
      "asset/20260920_001_task094_warranty_projection.sql",
      "identity/20260920_001_task094_r3_permissions.sql",
      "incident/20260920_001_task094_asset_links.sql",
      "incident/20260920_002_task094_monitoring_asset_link_backfill.sql",
      "monitoring/20260920_001_task094_asset_reliability.sql",
    ])
      await cp(path.join("database/migrations", file), path.join(temp, file));
    await migrate(db.pool, temp);
    const appliedR3Incident = await db.pool.query(
      "SELECT name FROM migration_meta.applied WHERE name LIKE '%20260920%' ORDER BY name",
    );
    assert.ok(
      appliedR3Incident.rows.some(
        (row) => row.name === "incident/20260920_001_task094_asset_links.sql",
      ),
      JSON.stringify(appliedR3Incident.rows),
    );
    const incidentReadPermission = await db.pool.query(
      `SELECT p.code,count(rp.permission_id)::int AS role_grants
         FROM identity.permissions p
         LEFT JOIN identity.role_permissions rp ON rp.permission_id=p.id
        WHERE p.code='incident.asset_history.read'
        GROUP BY p.code`,
    );
    assert.deepEqual(incidentReadPermission.rows, [
      { code: "incident.asset_history.read", role_grants: 0 },
    ]);
    const links = await db.pool.query(
      "SELECT incident_id,asset_id FROM incident.asset_links WHERE tenant_id=$1 ORDER BY incident_id",
      [tenant],
    );
    assert.deepEqual(links.rows, [
      { incident_id: localIncident, asset_id: localAsset },
    ]);
    const legacyStatus = await db.pool.query(
      `SELECT a.warranty_state,m.asset_reference_validated
         FROM asset.assets a JOIN monitoring.events m ON m.tenant_id=a.tenant_id AND m.asset_id=a.id
        WHERE a.tenant_id=$1 AND a.id=$2`,
      [tenant, localAsset],
    );
    assert.deepEqual(legacyStatus.rows[0], {
      warranty_state: "UNKNOWN",
      asset_reference_validated: true,
    });
    const foreignReference = await db.pool.query(
      "SELECT asset_reference_validated FROM monitoring.events WHERE tenant_id=$1 AND id=$2",
      [tenant, foreignEvent],
    );
    assert.equal(foreignReference.rows[0]!.asset_reference_validated, false);
    await assert.rejects(
      db.pool.query(
        "UPDATE asset.assets SET warranty_state='MISSING' WHERE tenant_id=$1 AND id=$2",
        [tenant, localAsset],
      ),
      /asset_warranty_state_canonical/,
    );
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
