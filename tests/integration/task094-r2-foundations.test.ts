import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createMaintenance,
  queryMaintenanceAssetHistory,
  transitionMaintenance,
  updateMaintenanceClassification,
} from "../../modules/maintenance/index.js";
import { recommendReplacementCandidate } from "../../modules/asset/index.js";
import { permissions, seedPermissions } from "../../modules/identity/index.js";
import { testDatabase } from "../helpers.js";

async function assetFixture(
  db: Awaited<ReturnType<typeof testDatabase>>,
  tenant: string,
  code: string,
) {
  const categoryId = randomUUID();
  const modelId = randomUUID();
  const assetId = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,$3)",
    [categoryId, tenant, `Category ${code}`],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Example',$3,$4)",
    [modelId, tenant, `Model ${code}`, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state) VALUES($1,$2,$3,$4,'IN_USE')",
    [assetId, tenant, code, modelId],
  );
  return assetId;
}

async function completeMaintenance(
  tx: Parameters<typeof createMaintenance>[0]["tx"],
  id: string,
  initialVersion = 1,
) {
  let version = initialVersion;
  for (const targetState of [
    "OPEN",
    "DIAGNOSING",
    "IN_REPAIR",
    "VERIFYING",
    "COMPLETED",
  ]) {
    const result = await transitionMaintenance({
      tx,
      id,
      expectedVersion: version,
      targetState,
      reason: `Advance to ${targetState}`,
    });
    version = result.version;
  }
}

test("TASK-094-R2 Maintenance evidence, TASK-059 recommendation port and typed source contract foundations", async () => {
  const db = await testDatabase();
  const tenant = `task094-r2-${randomUUID()}`;
  try {
    await db.uow.run(tenant, (tx) => seedPermissions(tx, permissions));
    const maintenanceRead = await db.pool.query(
      "SELECT code,resource_type,action FROM identity.permissions WHERE code='maintenance.read'",
    );
    assert.deepEqual(maintenanceRead.rows[0], {
      code: "maintenance.read",
      resource_type: "maintenance",
      action: "read",
    });
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM identity.role_bindings WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0]!.count,
      0,
    );
    const assetId = await assetFixture(db, tenant, "AST-R2-MAINT");
    const created = await db.uow.run(tenant, (tx) =>
      createMaintenance({
        tx,
        assetId,
        title: "Corrective repair",
        description:
          "Typed fixture; classification does not derive from this text.",
        classification: "CORRECTIVE",
      }),
    );
    assert.equal(created.state, "DRAFT");
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        createMaintenance({
          tx,
          assetId,
          title: "Unclassified new order",
          description: "UNKNOWN is reserved for legacy/controlled import.",
          classification: "UNKNOWN" as never,
        }),
      ),
      /explicit supported classification/,
    );
    const corrected = await db.uow.run(tenant, (tx) =>
      createMaintenance({
        tx,
        assetId,
        title: "Classification is typed",
        description: "No text inference",
        classification: "OTHER",
      }),
    );
    const classificationChange = await db.uow.run(tenant, (tx) =>
      updateMaintenanceClassification({
        tx,
        id: corrected.id,
        expectedVersion: 1,
        classification: "CORRECTIVE",
        reason: "Work order review confirmed a fault repair",
      }),
    );
    assert.equal(classificationChange.from_classification, "OTHER");
    assert.equal(classificationChange.classification, "CORRECTIVE");
    await db.uow.run(tenant, (tx) => completeMaintenance(tx, corrected.id, 2));
    await db.uow.run(tenant, (tx) => completeMaintenance(tx, created.id));
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        updateMaintenanceClassification({
          tx,
          id: created.id,
          expectedVersion: 6,
          classification: "PREVENTIVE",
          reason: "Completed evidence is immutable",
        }),
      ),
      /terminal/,
    );

    const preventive = await db.uow.run(tenant, (tx) =>
      createMaintenance({
        tx,
        assetId,
        title: "Failure response wording is irrelevant",
        description: "No text inference is allowed.",
        classification: "PREVENTIVE",
      }),
    );
    await db.uow.run(tenant, (tx) => completeMaintenance(tx, preventive.id));
    const inspection = await db.uow.run(tenant, (tx) =>
      createMaintenance({
        tx,
        assetId,
        title: "Inspection",
        description: "Diagnostic check",
        classification: "INSPECTION",
      }),
    );
    await db.uow.run(tenant, (tx) => completeMaintenance(tx, inspection.id));
    const legacyId = randomUUID();
    await db.pool.query(
      "INSERT INTO maintenance.orders(id,tenant_id,asset_id,title,description,state,completed_at) VALUES($1,$2,$3,'Legacy repair','Unclassified legacy record','COMPLETED',now())",
      [legacyId, tenant, assetId],
    );
    const history = await db.uow.run(tenant, (tx) =>
      queryMaintenanceAssetHistory({
        tx,
        assetId,
        from: "2000-01-01T00:00:00.000Z",
        to: "2100-01-01T00:00:00.000Z",
        principal: {
          id: "maintenance-reader",
          tenant_id: tenant,
          actor_type: "SYSTEM",
        },
        authorization: {
          async evaluate() {
            return { result: "ALLOW" as const, reason: "scoped history read" };
          },
        },
        context: { correlation_id: randomUUID() },
      }),
    );
    assert.equal(history.availability, "AVAILABLE");
    assert.equal(history.orders.length, 5);
    assert.equal(history.unknown_classification_count, 1);
    assert.equal(
      history.orders.find((row) => row.id === created.id)?.classification,
      "CORRECTIVE",
    );
    assert.equal(
      history.orders.find((row) => row.id === corrected.id)?.classification,
      "CORRECTIVE",
    );
    assert.equal(
      history.orders.find((row) => row.id === preventive.id)?.classification,
      "PREVENTIVE",
    );
    assert.equal(
      history.orders.find((row) => row.id === inspection.id)?.classification,
      "INSPECTION",
    );
    assert.equal(
      history.orders.find((row) => row.id === legacyId)?.classification,
      "UNKNOWN",
    );
    const empty = await db.uow.run(`other-${tenant}`, (tx) =>
      queryMaintenanceAssetHistory({
        tx,
        assetId,
        from: "2000-01-01T00:00:00.000Z",
        to: "2100-01-01T00:00:00.000Z",
        principal: {
          id: "maintenance-reader-other-tenant",
          tenant_id: `other-${tenant}`,
          actor_type: "SYSTEM",
        },
        authorization: {
          async evaluate() {
            return { result: "ALLOW" as const, reason: "scoped history read" };
          },
        },
        context: { correlation_id: randomUUID() },
      }),
    );
    assert.equal(empty.availability, "AVAILABLE");
    assert.equal(empty.orders.length, 0);
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        queryMaintenanceAssetHistory({
          tx,
          assetId,
          from: "2000-01-01T00:00:00.000Z",
          to: "2100-01-01T00:00:00.000Z",
          principal: {
            id: "maintenance-reader-denied",
            tenant_id: tenant,
            actor_type: "SYSTEM",
          },
          authorization: {
            async evaluate() {
              return { result: "DENY" as const, reason: "grant missing" };
            },
          },
          context: { correlation_id: randomUUID() },
        }),
      ),
      /Access denied/i,
    );

    const candidateAsset = await assetFixture(db, tenant, "AST-R2-CANDIDATE");
    const recommendation = (assessmentId: string) => ({
      tenant_id: tenant,
      asset_id: candidateAsset,
      replacement_assessment_id: assessmentId,
      score: 72,
      band: "PLAN" as const,
      scoring_profile_id: "ASSET_REPLACEMENT_V1",
      scoring_profile_version: "1",
      reasons: ["Verified scoring assessment reference"],
      evidence_summary: { completeness: 80, profile: "ASSET_REPLACEMENT_V1" },
      principal: {
        id: "SYSTEM_ASSET_SCORING:tenant-test",
        tenant_id: tenant,
        actor_type: "SYSTEM",
      },
      authorization: {
        async evaluate() {
          return {
            result: "ALLOW" as const,
            reason: "explicit scoring test grant",
          };
        },
      },
      service_name: "integration-test",
      reason: "Review recommendation only",
      context: { correlation_id: randomUUID(), causation_id: randomUUID() },
      idempotency_key: randomUUID(),
    });
    const firstRequest = recommendation("assessment-1");
    const first = await db.uow.run(tenant, (tx) =>
      recommendReplacementCandidate(tx, firstRequest),
    );
    assert.equal(first.outcome, "CREATED");
    const replay = await db.uow.run(tenant, (tx) =>
      recommendReplacementCandidate(tx, firstRequest),
    );
    assert.deepEqual(replay, first);
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        recommendReplacementCandidate(tx, {
          ...firstRequest,
          score: 75,
        }),
      ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "IDEMPOTENCY_KEY_CONFLICT",
    );
    const denyAsset = await assetFixture(db, tenant, "AST-R2-DENIED");
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        recommendReplacementCandidate(tx, {
          ...recommendation("assessment-denied"),
          asset_id: denyAsset,
          authorization: {
            async evaluate() {
              return {
                result: "DENY" as const,
                reason: "scoped grant missing",
              };
            },
          },
        }),
      ),
      /Access denied/i,
    );
    const updated = await db.uow.run(tenant, (tx) =>
      recommendReplacementCandidate(tx, recommendation("assessment-2")),
    );
    assert.equal(updated.outcome, "UPDATED_ACTIVE");
    const stateAfterUpdate = await db.pool.query(
      "SELECT state,recommendation_assessment_id,scoring_profile_id FROM asset.replacement_plans WHERE tenant_id=$1 AND id=$2",
      [tenant, first.candidate_id],
    );
    assert.equal(stateAfterUpdate.rows[0]!.state, "UNDER_REVIEW");
    assert.equal(
      stateAfterUpdate.rows[0]!.recommendation_assessment_id,
      "assessment-2",
    );
    await db.pool.query(
      "UPDATE asset.replacement_plans SET state='APPROVED' WHERE tenant_id=$1 AND id=$2",
      [tenant, first.candidate_id],
    );
    const reviewConflict = await db.uow.run(tenant, (tx) =>
      recommendReplacementCandidate(
        tx,
        recommendation("assessment-review-conflict"),
      ),
    );
    assert.equal(reviewConflict.outcome, "CONFLICT");
    await db.pool.query(
      "UPDATE asset.replacement_plans SET state='CANCELLED' WHERE tenant_id=$1 AND id=$2",
      [tenant, first.candidate_id],
    );
    const suppressed = await db.uow.run(tenant, (tx) =>
      recommendReplacementCandidate(tx, recommendation("assessment-3")),
    );
    assert.equal(suppressed.outcome, "TERMINAL_DISPOSITION_EXISTS");

    const concurrentAsset = await assetFixture(db, tenant, "AST-R2-CONCURRENT");
    const concurrentInput = (assessmentId: string) => ({
      ...recommendation(assessmentId),
      asset_id: concurrentAsset,
      context: { correlation_id: randomUUID(), causation_id: randomUUID() },
      idempotency_key: randomUUID(),
    });
    const concurrent = await Promise.all(
      ["assessment-a", "assessment-b"].map((assessmentId) =>
        db.uow.run(tenant, (tx) =>
          recommendReplacementCandidate(tx, concurrentInput(assessmentId)),
        ),
      ),
    );
    assert.ok(concurrent.some((result) => result.outcome === "CREATED"));
    const count = await db.pool.query(
      "SELECT count(*)::int AS count FROM asset.replacement_plans WHERE tenant_id=$1 AND asset_id=$2 AND state NOT IN ('REPLACED','CANCELLED')",
      [tenant, concurrentAsset],
    );
    assert.equal(count.rows[0]!.count, 1);
    const emitted = await db.pool.query(
      "SELECT event_type,count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 GROUP BY event_type ORDER BY event_type",
      [tenant, first.candidate_id],
    );
    assert.deepEqual(emitted.rows, [
      { event_type: "REPLACEMENT.CANDIDATE_CREATED", count: 1 },
      { event_type: "REPLACEMENT.CANDIDATE_RECOMMENDATION_UPDATED", count: 1 },
    ]);
  } finally {
    await db.close();
  }
});
