import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  expireAssetRiskProjections,
  readAssetAssessments,
  recalculateAssetAssessments,
  recordVerifiedAcquisitionDate,
  saveAssetReplacementPolicy,
} from "../../modules/asset/index.js";
import { testDatabase } from "../helpers.js";
import {
  permissions as permissionCatalog,
  seedPermissions,
} from "../../modules/identity/index.js";
import { upsertAssetRiskReviewWorkItem } from "../../modules/work-queue/index.js";

const requiredPermissions = [
  ["asset.scoring.recalculate", "asset"],
  ["incident.asset_history.read", "incident_asset_history"],
  ["monitoring.asset_reliability.read", "monitoring_asset"],
  ["maintenance.read", "maintenance"],
  ["warranty.read", "warranty"],
  ["goods_receipt.asset_provenance.read", "goods_receipt_asset_provenance"],
  ["asset.cost_evidence.read", "asset_cost_evidence"],
  ["replacement.create_candidate", "replacement"],
] as const;

const allow = {
  async evaluate() {
    return {
      result: "ALLOW" as const,
      reason: "controlled integration test grant",
    };
  },
};

test("TASK-094 persists immutable separate assessments, scope-checks source reads and deduplicates repeated calculation", async () => {
  const db = await testDatabase();
  const tenant = `task094-score-${randomUUID()}`;
  try {
    await db.uow.run(tenant, (tx) => seedPermissions(tx, permissionCatalog));
    const categoryId = randomUUID();
    const modelId = randomUUID();
    const assetId = randomUUID();
    const principalId = randomUUID();
    const roleId = randomUUID();
    const actor = {
      id: principalId,
      tenant_id: tenant,
      actor_type: "SYSTEM_ASSET_SCORING",
    };
    await db.pool.query(
      "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Scoring category')",
      [categoryId, tenant],
    );
    await db.pool.query(
      "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Maker','Model',$3)",
      [modelId, tenant, categoryId],
    );
    await db.pool.query(
      `INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state,health_state,operational_state)
       VALUES($1,$2,'SCORING-1',$3,'IN_USE','CRITICAL','OFFLINE')`,
      [assetId, tenant, modelId],
    );
    await db.pool.query(
      "INSERT INTO identity.asset_scoring_principals(id,tenant_id,service_identity) VALUES($1,$2,'asset-scoring')",
      [principalId, tenant],
    );
    await db.pool.query(
      "INSERT INTO identity.roles(id,tenant_id,code,name,type,status) VALUES($1,$2,'ASSET_SCORING_TEST','Asset scoring test','SYSTEM','ACTIVE')",
      [roleId, tenant],
    );
    for (const [code] of requiredPermissions) {
      const permissionId = (
        await db.pool.query<{ id: string }>(
          "SELECT id FROM identity.permissions WHERE code=$1",
          [code],
        )
      ).rows[0]?.id;
      assert.ok(permissionId, `permission ${code} is seeded`);
      await db.pool.query(
        "INSERT INTO identity.role_permissions(tenant_id,role_id,permission_id) VALUES($1,$2,$3)",
        [tenant, roleId, permissionId],
      );
    }
    await db.pool.query(
      `INSERT INTO identity.role_bindings
        (id,tenant_id,principal_type,principal_id,role_id,scope_type,scope_id,source,valid_from,reason,created_by)
       VALUES($1,$2,'SYSTEM_ASSET_SCORING',$3,$4,'ASSET',$5,'TASK-094_TEST',now(),'Scoped scoring test grant',$6)`,
      [randomUUID(), tenant, principalId, roleId, assetId, randomUUID()],
    );

    const operator = {
      id: randomUUID(),
      tenant_id: tenant,
      actor_type: "USER",
    };
    await db.uow.run(tenant, (tx) =>
      saveAssetReplacementPolicy({
        tx,
        categoryId,
        expectedLifeMonths: 12,
        expectedVersion: 0,
        idempotencyKey: "task094-policy-v1",
        reason: "Verified category planning policy",
        actor: operator,
        authorization: allow,
        correlationId: "task094-policy",
        serviceName: "integration-test",
      }),
    );
    await db.uow.run(tenant, (tx) =>
      recordVerifiedAcquisitionDate({
        tx,
        assetId,
        acquiredOn: "2024-09-13",
        expectedAssetVersion: 1,
        sourceReference: "verified-import:task094-fixture",
        reason: "Verified import record",
        idempotencyKey: "task094-acquisition-v1",
        actor: operator,
        authorization: allow,
        correlationId: "task094-acquisition",
        serviceName: "integration-test",
      }),
    );

    const asOf = "2026-09-13T08:00:00.000Z";
    const first = await db.uow.run(
      tenant,
      async (tx) => {
        return recalculateAssetAssessments({
          tx,
          assetId,
          actor,
          asOf,
          trigger: "TEST",
          correlationId: "task094-scoring-test",
          serviceName: "integration-test",
        });
      },
      { isolationLevel: "REPEATABLE READ" },
    );
    assert.equal(first.outcome, "ASSESSED");
    assert.equal(first.risk.score, 40);
    assert.equal(first.risk.band, "MEDIUM");
    assert.equal(first.risk.completeness, 100);
    assert.equal(first.replacement.score, 36);
    assert.equal(first.replacement.band, "UNKNOWN");
    assert.equal(first.replacement.completeness, 60);
    assert.equal(first.replacement.components.AGE_USEFUL_LIFE?.score, 20);

    const replay = await db.uow.run(
      tenant,
      async (tx) => {
        return recalculateAssetAssessments({
          tx,
          assetId,
          actor,
          asOf,
          trigger: "TEST",
          correlationId: "task094-scoring-test",
          serviceName: "integration-test",
        });
      },
      { isolationLevel: "REPEATABLE READ" },
    );
    if (replay.outcome !== "ASSESSED")
      throw new Error("Expected an assessment on replay");
    assert.equal(replay.risk.assessment_id, first.risk.assessment_id);
    assert.equal(replay.risk.created, false);
    assert.equal(
      replay.replacement.assessment_id,
      first.replacement.assessment_id,
    );
    assert.equal(replay.replacement.created, false);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM asset.risk_assessments WHERE tenant_id=$1 AND asset_id=$2",
          [tenant, assetId],
        )
      ).rows[0]!.n,
      1,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM asset.replacement_assessments WHERE tenant_id=$1 AND asset_id=$2",
          [tenant, assetId],
        )
      ).rows[0]!.n,
      1,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT risk_state FROM asset.assets WHERE tenant_id=$1 AND id=$2",
          [tenant, assetId],
        )
      ).rows[0]!.risk_state,
      "MEDIUM",
    );

    await assert.rejects(
      db.pool.query(
        "UPDATE asset.risk_assessments SET score=0 WHERE tenant_id=$1 AND asset_id=$2",
        [tenant, assetId],
      ),
      /append-only/,
    );
    const read = await db.uow.run(tenant, (tx) =>
      readAssetAssessments({
        tx,
        assetId,
        principal: { id: randomUUID(), tenant_id: tenant, actor_type: "USER" },
        authorization: allow,
        correlationId: "read-scoring-test",
      }),
    );
    assert.equal(read.effective_risk_state, "MEDIUM");
    assert.equal(read.risk_history[0]?.profile_id, "ASSET_RISK_V1");
    assert.equal(
      read.replacement_history[0]?.profile_id,
      "ASSET_REPLACEMENT_V1",
    );
    assert.equal(read.replacement_history[0]?.policy_version, 1);
  } finally {
    await db.close();
  }
});

test("TASK-094 stale/ineligible risk projections become UNKNOWN without deleting history", async () => {
  const db = await testDatabase();
  const tenant = `task094-stale-${randomUUID()}`;
  try {
    await db.uow.run(tenant, (tx) => seedPermissions(tx, permissionCatalog));
    const category = randomUUID();
    const model = randomUUID();
    const asset = randomUUID();
    await db.pool.query(
      "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Stale category')",
      [category, tenant],
    );
    await db.pool.query(
      "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Maker','Stale model',$3)",
      [model, tenant, category],
    );
    const principalId = randomUUID();
    await db.pool.query(
      "INSERT INTO identity.asset_scoring_principals(id,tenant_id,service_identity) VALUES($1,$2,'asset-scoring')",
      [principalId, tenant],
    );
    await db.pool.query(
      "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state,health_state,operational_state,risk_state,risk_assessment_valid_until) VALUES($1,$2,'STALE-1',$3,'RETIRED','HEALTHY','ONLINE','CRITICAL',now()-interval '1 second')",
      [asset, tenant, model],
    );
    const expired = await db.uow.run(tenant, (tx) =>
      expireAssetRiskProjections({
        tx,
        serviceName: "integration-test",
        actorId: principalId,
        correlationId: "stale-reset",
      }),
    );
    assert.equal(expired, 1);
    const projection = await db.pool.query(
      "SELECT risk_state,risk_assessment_id FROM asset.assets WHERE tenant_id=$1 AND id=$2",
      [tenant, asset],
    );
    assert.equal(projection.rows[0]!.risk_state, "UNKNOWN");
    assert.equal(projection.rows[0]!.risk_assessment_id, null);
  } finally {
    await db.close();
  }
});

test("TASK-094 deduplicates unresolved CRITICAL risk review across different assessments", async () => {
  const db = await testDatabase();
  const tenant = `task094-review-${randomUUID()}`;
  const assetId = randomUUID();
  try {
    await Promise.all([
      db.uow.run(tenant, (tx) =>
        upsertAssetRiskReviewWorkItem({
          tx,
          assetId,
          assessmentId: randomUUID(),
          score: 82,
          correlationId: "risk-review-1",
        }),
      ),
      db.uow.run(tenant, (tx) =>
        upsertAssetRiskReviewWorkItem({
          tx,
          assetId,
          assessmentId: randomUUID(),
          score: 91,
          correlationId: "risk-review-2",
        }),
      ),
    ]);
    const items = await db.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM operations.work_items
        WHERE tenant_id=$1 AND source_type='ASSET_RISK_REVIEW'
          AND context_json->>'asset_id'=$2 AND state NOT IN ('RESOLVED','CLOSED')`,
      [tenant, assetId],
    );
    assert.equal(items.rows[0]!.count, 1);
  } finally {
    await db.close();
  }
});
