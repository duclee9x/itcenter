import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("network discovery writes observations and serves tenant-scoped fresh topology", async () => {
  const db = await testDatabase();
  const categoryId = randomUUID();
  const modelId = randomUUID();
  const assetId = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,'tenant-a','Network endpoint')",
    [categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,'tenant-a','Example','Endpoint',$2)",
    [modelId, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id) VALUES($1,'tenant-a','AST-NET-1',$2)",
    [assetId, modelId],
  );
  let tenant = "tenant-a";
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return {
          id: "network-operator",
          tenant_id: tenant,
          actor_type: "USER",
        };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW", reason: "test adapter" };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  const post = (path: string, key: string, body: object) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
  try {
    const started = await post("/api/v1/network/discovery-jobs", "start-job", {
      source_type: "AGENT",
      scope: { site: "hq" },
      freshness_threshold_seconds: 3600,
    });
    assert.equal(
      started.status,
      201,
      JSON.stringify(await started.clone().json()),
    );
    const job = ((await started.json()) as { data: { id: string } }).data;
    const observation = {
      source_type: "AGENT",
      source: "endpoint-agent",
      source_event_id: "scan-1",
      asset_id: assetId,
      ip: "192.0.2.11",
      mac: "00:11:22:33:44:55",
      hostname: "workstation-1",
      vlan: "users",
      confidence: "HIGH",
      observed_at: new Date().toISOString(),
    };
    const recorded = await post(
      `/api/v1/network/discovery-jobs/${job.id}/observations`,
      "record-1",
      observation,
    );
    assert.equal(recorded.status, 200);
    const recordedBody = (
      (await recorded.json()) as { data: { id: string; duplicate: boolean } }
    ).data;
    assert.equal(recordedBody.duplicate, false);
    const duplicate = await post(
      `/api/v1/network/discovery-jobs/${job.id}/observations`,
      "record-2",
      observation,
    );
    assert.equal(
      ((await duplicate.json()) as { data: { duplicate: boolean } }).data
        .duplicate,
      true,
    );
    const completed = await post(
      `/api/v1/network/discovery-jobs/${job.id}/commands/transition`,
      "finish-job",
      { target_state: "COMPLETED" },
    );
    assert.equal(completed.status, 200);
    const topology = await fetch(url + "/api/v1/network/topology", {
      headers: { authorization: "Bearer test" },
    });
    assert.equal(topology.status, 200);
    const rows = (
      (await topology.json()) as {
        data: Array<{
          asset_id: string;
          freshness: string;
          confidence: string;
        }>;
      }
    ).data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.asset_id, assetId);
    assert.equal(rows[0]!.freshness, "FRESH");
    assert.equal(rows[0]!.confidence, "HIGH");
    const asset = await db.pool.query(
      "SELECT lifecycle_state,version FROM asset.assets WHERE tenant_id='tenant-a' AND id=$1",
      [assetId],
    );
    assert.deepEqual(asset.rows[0], { lifecycle_state: "PLANNED", version: 1 });
    tenant = "tenant-b";
    const isolated = await fetch(url + "/api/v1/network/topology", {
      headers: { authorization: "Bearer test" },
    });
    assert.deepEqual(((await isolated.json()) as { data: unknown[] }).data, []);
    const effects = await db.pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id='tenant-a' AND event_type='NETWORK.DEVICE_DISCOVERED'",
    );
    assert.equal(effects.rows[0]!.count, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
