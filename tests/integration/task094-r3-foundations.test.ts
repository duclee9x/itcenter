import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  detachIncidentAsset,
  recordExplicitIncidentAssetLink,
  linkIncidentAsset,
  queryIncidentAssetHistory,
  recordMonitoringIncidentAssetLink,
} from "../../modules/incident/index.js";
import { projectWarrantyState } from "../../modules/asset/index.js";
import {
  queryMonitoringAssetReliability,
  resolveMonitoringEpisodeForEvent,
  resolveMonitoringEventForIncident,
} from "../../modules/monitoring/index.js";
import {
  queryWarrantyAsset,
  warrantyStatePolicy,
} from "../../modules/maintenance/index.js";
import { testDatabase } from "../helpers.js";

const allowed = {
  async evaluate() {
    return { result: "ALLOW" as const, reason: "test scoped grant" };
  },
};

async function createAsset(
  db: Awaited<ReturnType<typeof testDatabase>>,
  tenant: string,
  name: string,
) {
  const category = randomUUID();
  const model = randomUUID();
  const asset = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,$3)",
    [category, tenant, `Category ${name}`],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Maker',$3,$4)",
    [model, tenant, `Model ${name}`, category],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id) VALUES($1,$2,$3,$4)",
    [asset, tenant, name, model],
  );
  return asset;
}

async function createIncident(
  db: Awaited<ReturnType<typeof testDatabase>>,
  tenant: string,
  code: string,
  monitoringEventId?: string,
) {
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO incident.incidents
      (id,tenant_id,incident_code,title,source,monitoring_event_id,priority)
     VALUES($1,$2,$3,$4,'TEST',$5,'P2')`,
    [id, tenant, code, code, monitoringEventId ?? null],
  );
  return id;
}

test("Incident Asset links are tenant-scoped, auditable, detachable and queried without Root sibling propagation", async () => {
  const db = await testDatabase();
  const tenant = `task094-r3-incident-${randomUUID()}`;
  const otherTenant = `task094-r3-other-${randomUUID()}`;
  try {
    const assetA = await createAsset(db, tenant, "A");
    const assetB = await createAsset(db, tenant, "B");
    const foreignAsset = await createAsset(db, otherTenant, "FOREIGN");
    const rootId = await createIncident(db, tenant, "ROOT");
    const childOne = await createIncident(db, tenant, "CHILD-1");
    const childTwo = await createIncident(db, tenant, "CHILD-2");
    const childOtherAsset = await createIncident(db, tenant, "CHILD-B");
    for (const childId of [childOne, childTwo, childOtherAsset])
      await db.pool.query(
        "UPDATE incident.incidents SET root_incident_id=$1 WHERE tenant_id=$2 AND id=$3",
        [rootId, tenant, childId],
      );
    const incidentActor = {
      id: randomUUID(),
      tenant_id: tenant,
      actor_type: "USER",
    };
    const manual = await db.uow.run(tenant, (tx) =>
      linkIncidentAsset({
        tx,
        incidentId: childOne,
        assetId: assetA,
        reason: "Operator verified affected Asset",
        idempotencyKey: "manual-link-1",
        actor: incidentActor,
        authorization: allowed,
        assetExists: async (id) => {
          const found = await tx.query(
            "SELECT id FROM asset.assets WHERE tenant_id=$1 AND id=$2",
            [tenant, id],
          );
          if (!found.rowCount) throw new Error("Asset missing");
        },
        correlationId: "corr-link-1",
      }),
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE incident.asset_links SET asset_id=$1 WHERE tenant_id=$2 AND id=$3",
        [assetB, tenant, manual.id],
      ),
      /only one audited detach transition/,
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE incident.asset_link_history SET reason='rewritten' WHERE tenant_id=$1 AND link_id=$2",
        [tenant, manual.id],
      ),
      /history is immutable/,
    );
    await db.uow.run(tenant, (tx) =>
      linkIncidentAsset({
        tx,
        incidentId: childTwo,
        assetId: assetA,
        reason: "same Root episode",
        idempotencyKey: "manual-link-2",
        actor: incidentActor,
        authorization: allowed,
        assetExists: async () => undefined,
        correlationId: "corr-link-2",
      }),
    );
    await db.uow.run(tenant, (tx) =>
      linkIncidentAsset({
        tx,
        incidentId: childOtherAsset,
        assetId: assetB,
        reason: "different Asset",
        idempotencyKey: "manual-link-b",
        actor: incidentActor,
        authorization: allowed,
        assetExists: async () => undefined,
        correlationId: "corr-link-b",
      }),
    );
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        linkIncidentAsset({
          tx,
          incidentId: childOne,
          assetId: foreignAsset,
          reason: "cross tenant must fail",
          idempotencyKey: "cross-tenant-link",
          actor: incidentActor,
          authorization: allowed,
          assetExists: async (id) => {
            const found = await tx.query(
              "SELECT id FROM asset.assets WHERE tenant_id=$1 AND id=$2",
              [tenant, id],
            );
            if (!found.rowCount) throw new Error("Asset missing");
          },
          correlationId: "corr-cross",
        }),
      ),
      /Asset missing/,
    );
    await assert.rejects(
      db.pool.query(
        `INSERT INTO incident.asset_links
          (id,tenant_id,incident_id,asset_id,source_type,actor_type,actor_id,reason)
         VALUES($1,$2,$3,$4,'MANUAL_AUTHORIZED','USER',$5,'Cross-tenant FK test')`,
        [randomUUID(), tenant, childOne, foreignAsset, incidentActor.id],
      ),
      { code: "23503" },
    );
    const history = await db.uow.run(tenant, (tx) =>
      queryIncidentAssetHistory({
        tx,
        assetId: assetA,
        from: "2000-01-01T00:00:00.000Z",
        to: "2100-01-01T00:00:00.000Z",
        principal: incidentActor,
        authorization: allowed,
        correlationId: "corr-history",
      }),
    );
    assert.equal(history.availability, "AVAILABLE");
    assert.equal(history.incidents.length, 2);
    assert.deepEqual(
      new Set(history.incidents.map((row) => row.episode_id)),
      new Set([rootId]),
    );
    assert.ok(
      history.incidents.every((row) => row.incident_id !== childOtherAsset),
    );
    await db.uow.run(tenant, (tx) =>
      detachIncidentAsset({
        tx,
        incidentId: childOne,
        linkId: manual.id,
        expectedVersion: 1,
        reason: "Corrected affected Asset",
        actor: incidentActor,
        authorization: allowed,
        correlationId: "corr-detach",
      }),
    );
    const state = await db.pool.query(
      "SELECT state,detach_reason FROM incident.asset_links WHERE tenant_id=$1 AND id=$2",
      [tenant, manual.id],
    );
    assert.deepEqual(state.rows[0], {
      state: "DETACHED",
      detach_reason: "Corrected affected Asset",
    });
    const historyEvents = await db.pool.query(
      "SELECT event_type FROM incident.asset_link_history WHERE tenant_id=$1 AND link_id=$2 ORDER BY occurred_at,id",
      [tenant, manual.id],
    );
    assert.deepEqual(
      historyEvents.rows.map((row) => row.event_type),
      ["LINKED", "DETACHED"],
    );
    const empty = await db.uow.run(tenant, (tx) =>
      queryIncidentAssetHistory({
        tx,
        assetId: foreignAsset,
        from: "2000-01-01T00:00:00.000Z",
        to: "2100-01-01T00:00:00.000Z",
        principal: incidentActor,
        authorization: allowed,
        correlationId: "corr-empty",
      }),
    );
    assert.deepEqual(empty, { availability: "AVAILABLE", incidents: [] });

    const monitoringEventId = randomUUID();
    const monitoringIncidentId = await createIncident(
      db,
      tenant,
      "MONITORING-ASSET-LINK",
      monitoringEventId,
    );
    await db.pool.query(
      `INSERT INTO monitoring.events
        (id,tenant_id,source,provider_event_id,source_correlation_key,asset_id,
         asset_reference_validated,metric,observed_value,severity,observed_at)
       VALUES($1,$2,'agent','monitoring-link','episode-link',$3,true,'cpu','99','CRITICAL',now())`,
      [monitoringEventId, tenant, assetA],
    );
    const monitoringLink = await db.uow.run(tenant, (tx) =>
      recordMonitoringIncidentAssetLink({
        tx,
        incidentId: monitoringIncidentId,
        assetId: assetA,
        monitoringEventId,
        actorType: "SYSTEM",
        actorId: "monitor-test",
        correlationId: "monitor-link-correlation",
      }),
    );
    assert.equal(monitoringLink.created, true);
    const sourceWithoutAsset = randomUUID();
    await db.pool.query(
      `INSERT INTO monitoring.events
        (id,tenant_id,source,provider_event_id,source_correlation_key,asset_id,
         asset_reference_validated,metric,observed_value,severity,observed_at)
       VALUES($1,$2,'agent','monitoring-no-asset','episode-no-asset',NULL,false,'cpu','99','CRITICAL',now())`,
      [sourceWithoutAsset, tenant],
    );
    const noAssetIncident = await createIncident(
      db,
      tenant,
      "MONITORING-NO-ASSET",
      sourceWithoutAsset,
    );
    const noAssetSource = await db.uow.run(tenant, (tx) =>
      resolveMonitoringEventForIncident({ tx, eventId: sourceWithoutAsset }),
    );
    assert.equal(noAssetSource.asset_id, null);
    const noAssetLinks = await db.pool.query(
      "SELECT count(*)::int AS count FROM incident.asset_links WHERE tenant_id=$1 AND incident_id=$2",
      [tenant, noAssetIncident],
    );
    assert.equal(noAssetLinks.rows[0]!.count, 0);
    const explicitIncidentId = await createIncident(
      db,
      tenant,
      "EXPLICIT-INTAKE-ASSET",
    );
    const explicit = await db.uow.run(tenant, (tx) =>
      recordExplicitIncidentAssetLink({
        tx,
        incidentId: explicitIncidentId,
        assetId: assetA,
        sourceReference: randomUUID(),
        actorType: "USER",
        actorId: incidentActor.id,
        actor: incidentActor,
        authorization: allowed,
        reason: "Explicitly selected in intake",
        correlationId: "explicit-link-correlation",
        assetExists: async (id) => {
          const found = await tx.query(
            "SELECT id FROM asset.assets WHERE tenant_id=$1 AND id=$2",
            [tenant, id],
          );
          if (!found.rowCount) throw new Error("Asset missing");
        },
      }),
    );
    assert.equal(explicit.created, true);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM incident.asset_link_history WHERE tenant_id=$1 AND incident_id=$2 AND event_type='LINKED'",
          [tenant, explicitIncidentId],
        )
      ).rows[0]!.count,
      1,
    );
  } finally {
    await db.close();
  }
});

test("Monitoring reliability deduplicates canonical episodes and reports unresolved identities as unavailable", async () => {
  const db = await testDatabase();
  const tenant = `task094-r3-monitor-${randomUUID()}`;
  try {
    const assetId = await createAsset(db, tenant, "MONITOR");
    const eventIds = [randomUUID(), randomUUID(), randomUUID()];
    await db.pool.query(
      `INSERT INTO monitoring.events
        (id,tenant_id,source,provider_event_id,source_correlation_key,asset_id,
         asset_reference_validated,metric,observed_value,severity,observed_at)
       VALUES
        ($1,$2,'agent','p1','corr-episode-1',$3,true,'cpu','95','CRITICAL','2026-09-01T00:00:00Z'),
        ($4,$2,'agent','p2','corr-episode-1',$3,true,'cpu','96','CRITICAL','2026-09-01T00:01:00Z'),
        ($5,$2,'agent','p3',NULL,$3,true,'cpu','97','CRITICAL','2026-09-01T00:02:00Z')`,
      [eventIds[0], tenant, assetId, eventIds[1], eventIds[2]],
    );
    const result = await db.uow.run(tenant, (tx) =>
      queryMonitoringAssetReliability({
        tx,
        assetId,
        from: "2026-08-01T00:00:00Z",
        to: "2026-10-01T00:00:00Z",
        principal: {
          id: randomUUID(),
          tenant_id: tenant,
          actor_type: "SYSTEM",
        },
        authorization: allowed,
        correlationId: "corr-monitor-query",
      }),
    );
    assert.equal(result.availability, "UNAVAILABLE");
    assert.equal(result.reason_code, "UNRESOLVED_EPISODE_IDENTITY");
    assert.equal(result.episodes.length, 1);
    assert.equal(result.episodes[0]!.event_ids.length, 2);
    const resolved = await db.uow.run(tenant, (tx) =>
      resolveMonitoringEpisodeForEvent({
        tx,
        eventId: eventIds[0]!,
        assetId,
        principal: {
          id: randomUUID(),
          tenant_id: tenant,
          actor_type: "SYSTEM",
        },
        authorization: allowed,
        correlationId: "corr-monitor-resolver",
      }),
    );
    assert.equal(
      resolved.episode?.episode_id,
      JSON.stringify(["agent", "corr-episode-1"]),
    );
    assert.equal(resolved.episode?.event_ids.length, 2);
  } finally {
    await db.close();
  }
});

test("Warranty query is canonical and Asset projection refresh is idempotent across time boundaries", async () => {
  const db = await testDatabase();
  const tenant = `task094-r3-warranty-${randomUUID()}`;
  try {
    const assetId = await createAsset(db, tenant, "WARRANTY");
    const actor = { id: randomUUID(), tenant_id: tenant, actor_type: "USER" };
    const beforeWarranty = await db.uow.run(tenant, (tx) =>
      queryWarrantyAsset({
        tx,
        assetId,
        asOf: "2026-01-01T00:00:00Z",
        principal: actor,
        authorization: allowed,
        correlationId: "corr-no-warranty",
      }),
    );
    assert.equal(beforeWarranty.availability, "AVAILABLE");
    assert.equal(beforeWarranty.state, "UNKNOWN");
    assert.equal(beforeWarranty.reason_code, "NO_WARRANTY");

    const warrantyId = randomUUID();
    await db.pool.query(
      `INSERT INTO maintenance.warranties
        (id,tenant_id,asset_id,provider,starts_at,ends_at,coverage)
       VALUES($1,$2,$3,'Provider','2025-01-01','2026-04-01','Parts')`,
      [warrantyId, tenant, assetId],
    );
    const exact90 = await db.uow.run(tenant, (tx) =>
      queryWarrantyAsset({
        tx,
        assetId,
        asOf: "2026-01-01T00:00:00Z",
        principal: actor,
        authorization: allowed,
        correlationId: "corr-exact-90",
      }),
    );
    assert.equal(exact90.state, "EXPIRING");
    assert.equal(exact90.state_policy_id, warrantyStatePolicy.id);

    const refreshed = await db.uow.run(tenant, (tx) =>
      projectWarrantyState({
        tx,
        assetId,
        state: exact90.state,
        evaluatedOn: "2026-01-01",
        policyVersion: `${exact90.state_policy_id}:v${exact90.state_policy_version}`,
        evidenceReference: exact90.warranty_id,
        reasonCode: exact90.reason_code,
        serviceName: "test",
        correlationId: "corr-projection-1",
      }),
    );
    assert.equal(refreshed.updated, true);
    const repeated = await db.uow.run(tenant, (tx) =>
      projectWarrantyState({
        tx,
        assetId,
        state: exact90.state,
        evaluatedOn: "2026-01-01",
        policyVersion: `${exact90.state_policy_id}:v${exact90.state_policy_version}`,
        evidenceReference: exact90.warranty_id,
        reasonCode: exact90.reason_code,
        serviceName: "test",
        correlationId: "corr-projection-2",
      }),
    );
    assert.deepEqual(repeated, { updated: false, reason: "CURRENT" });
    const projected = await db.pool.query(
      "SELECT warranty_state,warranty_state_policy_version,warranty_state_evidence_ref FROM asset.assets WHERE tenant_id=$1 AND id=$2",
      [tenant, assetId],
    );
    assert.deepEqual(projected.rows[0], {
      warranty_state: "EXPIRING",
      warranty_state_policy_version: "WARRANTY_STATE_V1:v1",
      warranty_state_evidence_ref: warrantyId,
    });
    const expired = await db.uow.run(tenant, (tx) =>
      queryWarrantyAsset({
        tx,
        assetId,
        asOf: "2026-04-01T00:00:00Z",
        principal: actor,
        authorization: allowed,
        correlationId: "corr-expired-boundary",
      }),
    );
    assert.equal(expired.state, "EXPIRED");
    const boundaryRefresh = await db.uow.run(tenant, (tx) =>
      projectWarrantyState({
        tx,
        assetId,
        state: expired.state,
        evaluatedOn: "2026-04-01",
        policyVersion: `${expired.state_policy_id}:v${expired.state_policy_version}`,
        evidenceReference: expired.warranty_id,
        reasonCode: expired.reason_code,
        serviceName: "test",
        correlationId: "corr-expired-boundary-project",
      }),
    );
    assert.equal(boundaryRefresh.updated, true);
    const repeatedBoundaryRefresh = await db.uow.run(tenant, (tx) =>
      projectWarrantyState({
        tx,
        assetId,
        state: expired.state,
        evaluatedOn: "2026-04-01",
        policyVersion: `${expired.state_policy_id}:v${expired.state_policy_version}`,
        evidenceReference: expired.warranty_id,
        reasonCode: expired.reason_code,
        serviceName: "test",
        correlationId: "corr-expired-boundary-project-replay",
      }),
    );
    assert.deepEqual(repeatedBoundaryRefresh, {
      updated: false,
      reason: "CURRENT",
    });
    const projectionEvents = await db.pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='ASSET.WARRANTY_STATE_PROJECTED' AND aggregate_id=$2",
      [tenant, assetId],
    );
    assert.equal(projectionEvents.rows[0]!.count, 2);

    await db.pool.query(
      `INSERT INTO maintenance.warranties
        (id,tenant_id,asset_id,provider,starts_at,ends_at,coverage)
       VALUES($1,$2,$3,'Provider 2','2025-01-01','2026-05-01','Parts')`,
      [randomUUID(), tenant, assetId],
    );
    const ambiguous = await db.uow.run(tenant, (tx) =>
      queryWarrantyAsset({
        tx,
        assetId,
        asOf: "2026-01-01T00:00:00Z",
        principal: actor,
        authorization: allowed,
        correlationId: "corr-ambiguous",
      }),
    );
    assert.equal(ambiguous.state, "UNKNOWN");
    assert.equal(ambiguous.reason_code, "AMBIGUOUS_WARRANTY_EVIDENCE");
  } finally {
    await db.close();
  }
});

test("TASK-094 scoring persistence is added by the later scoring task", async () => {
  const db = await testDatabase();
  try {
    const result = await db.pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='asset'
        AND tablename IN ('risk_assessments','replacement_assessments','replacement_policies')`,
    );
    assert.equal(result.rowCount, 3);
  } finally {
    await db.close();
  }
});
