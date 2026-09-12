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

test("network exceptions dedupe, create work references and resolve with source controls", async () => {
  const db = await testDatabase();
  const categoryId = randomUUID();
  const modelId = randomUUID();
  const assetId = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,'tenant-a','Network devices')",
    [categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,'tenant-a','Example','Switchable endpoint',$2)",
    [modelId, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id) VALUES($1,'tenant-a','AST-EXCEPTION-1',$2)",
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
    const start = await post(
      "/api/v1/network/discovery-jobs",
      "exception-job",
      { source_type: "AGENT" },
    );
    const job = ((await start.json()) as { data: { id: string } }).data;
    const addObservation = (key: string, eventId: string, mac: string) =>
      post(`/api/v1/network/discovery-jobs/${job.id}/observations`, key, {
        source_type: "AGENT",
        source: "agent",
        source_event_id: eventId,
        ip: "198.51.100.8",
        mac,
        vlan: "users",
        confidence: "MEDIUM",
        observed_at: new Date().toISOString(),
      });
    const first = await addObservation(
      "unknown-one",
      "unknown-1",
      "00:11:22:33:44:01",
    );
    assert.equal(first.status, 200);
    const firstBody = ((await first.json()) as { data: { id: string } }).data;
    const second = await addObservation(
      "unknown-two",
      "unknown-2",
      "00:11:22:33:44:02",
    );
    assert.equal(second.status, 200);
    const secondBody = ((await second.json()) as { data: { id: string } }).data;
    const repeat = await post(
      `/api/v1/network/discovery-jobs/${job.id}/observations`,
      "unknown-repeat",
      {
        source_type: "AGENT",
        source: "agent",
        source_event_id: "unknown-1b",
        ip: "198.51.100.9",
        mac: "00:11:22:33:44:01",
        vlan: "users",
        confidence: "MEDIUM",
        observed_at: new Date().toISOString(),
      },
    );
    assert.equal(repeat.status, 200);
    const listed = await fetch(url + "/api/v1/network/exceptions?state=OPEN", {
      headers: { authorization: "Bearer test" },
    });
    const open = (
      (await listed.json()) as {
        data: Array<{
          id: string;
          exception_type: string;
          source_observation_id: string;
          version: number;
        }>;
      }
    ).data;
    assert.equal(
      open.filter((item) => item.exception_type === "UNKNOWN_DEVICE").length,
      2,
    );
    assert.equal(
      open.filter((item) => item.exception_type === "IP_CONFLICT").length,
      1,
    );
    const matchingVlan = await post(
      `/api/v1/network/observations/${firstBody.id}/commands/check-vlan`,
      "vlan-match",
      { expected_vlan: "users" },
    );
    assert.equal(matchingVlan.status, 200);
    assert.equal(
      ((await matchingVlan.json()) as { data: { mismatch: boolean } }).data
        .mismatch,
      false,
    );
    const vlan = await post(
      `/api/v1/network/observations/${secondBody.id}/commands/check-vlan`,
      "vlan-check",
      { expected_vlan: "servers" },
    );
    assert.equal(vlan.status, 201);
    const exceptions = (
      (await (
        await fetch(url + "/api/v1/network/exceptions", {
          headers: { authorization: "Bearer test" },
        })
      ).json()) as { data: typeof open }
    ).data;
    assert.equal(exceptions.length, 4);
    const unknown = exceptions.find(
      (item) =>
        item.exception_type === "UNKNOWN_DEVICE" &&
        item.source_observation_id === firstBody.id,
    )!;
    const resolved = await post(
      `/api/v1/network/exceptions/${unknown.id}/commands/resolve`,
      "link-unknown",
      {
        expected_version: unknown.version,
        action: "LINK_TO_ASSET",
        asset_id: assetId,
        reason: "Matched inventory serial and owner confirmation",
      },
    );
    assert.equal(resolved.status, 200);
    const asset = await db.pool.query(
      "SELECT lifecycle_state,version FROM asset.assets WHERE tenant_id='tenant-a' AND id=$1",
      [assetId],
    );
    assert.deepEqual(asset.rows[0], { lifecycle_state: "PLANNED", version: 1 });
    const afterLink = await post(
      `/api/v1/network/discovery-jobs/${job.id}/observations`,
      "linked-device-reseen",
      {
        source_type: "AGENT",
        source: "agent",
        source_event_id: "unknown-1c",
        ip: "198.51.100.10",
        mac: "00:11:22:33:44:01",
        vlan: "users",
        confidence: "HIGH",
        observed_at: new Date().toISOString(),
      },
    );
    assert.equal(afterLink.status, 200);
    const currentTopology = await fetch(url + "/api/v1/network/topology", {
      headers: { authorization: "Bearer test" },
    });
    const topologyRows = (
      (await currentTopology.json()) as {
        data: Array<{ mac: string; asset_id: string | null }>;
      }
    ).data;
    assert.equal(
      topologyRows.find((row) => row.mac === "00:11:22:33:44:01")?.asset_id,
      assetId,
    );
    const queue = await db.pool.query(
      "SELECT state FROM operations.work_items WHERE tenant_id='tenant-a' AND source_type='NETWORK_EXCEPTION' AND source_id=$1",
      [unknown.id],
    );
    assert.equal(queue.rows[0]!.state, "RESOLVED");
    const directWorkItem = await db.pool.query(
      "SELECT id FROM operations.work_items WHERE tenant_id='tenant-a' AND source_type='NETWORK_EXCEPTION' AND source_id=$1",
      [unknown.id],
    );
    const genericResolve = await post(
      `/api/v1/work-items/${directWorkItem.rows[0]!.id}/commands/resolve`,
      "bad-queue-resolve",
      { expected_version: 2, reason: "skip source command" },
    );
    assert.equal(genericResolve.status, 422);
    const events = await db.pool.query(
      "SELECT event_type FROM platform.outbox_events WHERE tenant_id='tenant-a' AND event_type IN ('NETWORK.UNKNOWN_DEVICE','NETWORK.IP_CONFLICT','NETWORK.VLAN_MISMATCH','NETWORK.EXCEPTION_RESOLVED')",
    );
    assert.equal(events.rowCount, 5);
    const queueCount = await db.pool.query(
      "SELECT count(*)::int AS count FROM operations.work_items WHERE tenant_id='tenant-a' AND source_type='NETWORK_EXCEPTION'",
    );
    assert.equal(queueCount.rows[0]!.count, 4);
    const auditCount = await db.pool.query(
      "SELECT count(*)::int AS count FROM audit.audit_events WHERE tenant_id='tenant-a' AND event_type IN ('NETWORK.UNKNOWN_DEVICE','NETWORK.IP_CONFLICT','NETWORK.VLAN_MISMATCH','NETWORK.EXCEPTION_RESOLVED')",
    );
    assert.equal(auditCount.rows[0]!.count, 5);
    tenant = "tenant-b";
    const isolated = await fetch(url + "/api/v1/network/exceptions", {
      headers: { authorization: "Bearer test" },
    });
    assert.deepEqual(((await isolated.json()) as { data: unknown[] }).data, []);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
