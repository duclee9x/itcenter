import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

test("TASK-095-R3 target classification API is authorized, idempotent and emits one audit/outbox", async () => {
  const db = await testDatabase();
  const tenant = `task095-r3-api-${randomUUID()}`;
  const actor = randomUUID();
  const policyId = randomUUID();
  const targetId = randomUUID();
  await db.pool.query(
    `INSERT INTO control.sla_policies(id,tenant_id,code,object_type,version,state)
     VALUES($1,$2,$3,'TICKET',1,'ACTIVE')`,
    [policyId, tenant, `p-${policyId}`],
  );
  await db.pool.query(
    `INSERT INTO control.sla_targets(id,tenant_id,sla_policy_id,name,duration_minutes,start_condition,stop_condition,target_purpose)
     VALUES($1,$2,$3,'Legacy target',60,'start','stop','UNKNOWN')`,
    [targetId, tenant, policyId],
  );
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return { id: actor, tenant_id: tenant, actor_type: "USER" };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW", reason: "test" };
      },
    },
    db.uow,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/v1/sla-targets/${targetId}/commands/set-purpose`;
  const key = `purpose-${randomUUID()}`;
  const request = () =>
    fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify({
        target_purpose: "RESOLUTION",
        expected_version: 1,
        reason: "Verified against approved configuration.",
      }),
    });
  try {
    const first = await request();
    assert.equal(first.status, 200, await first.clone().text());
    const replay = await request();
    assert.equal(replay.status, 200);
    const firstBody = (await first.json()) as { data: unknown };
    const replayBody = (await replay.json()) as { data: unknown };
    assert.deepEqual(replayBody.data, firstBody.data);
    const counts = await db.pool.query<{
      history: number;
      audit: number;
      outbox: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM control.sla_target_purpose_changes WHERE tenant_id=$1 AND sla_target_id=$2) AS history,
         (SELECT count(*)::int FROM audit.audit_events WHERE tenant_id=$1 AND event_type='SLA.TARGET_PURPOSE_CLASSIFIED') AS audit,
         (SELECT count(*)::int FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='SLA.TARGET_PURPOSE_CLASSIFIED') AS outbox`,
      [tenant, targetId],
    );
    assert.deepEqual(counts.rows[0], { history: 1, audit: 1, outbox: 1 });
    const deniedServer = apiServer(
      loadConfig({
        DATABASE_SECRET_REF: "env:TEST",
        APP_ENV: "test",
        LOG_LEVEL: "error",
      }),
      async () => true,
      {
        async authenticate() {
          return { id: actor, tenant_id: tenant, actor_type: "USER" };
        },
      },
      {
        async evaluate() {
          return { result: "DENY", reason: "no classification grant" };
        },
      },
      db.uow,
    );
    await new Promise<void>((resolve) =>
      deniedServer.listen(0, "127.0.0.1", resolve),
    );
    try {
      const deniedAddress = deniedServer.address() as AddressInfo;
      const denied = await fetch(
        `http://127.0.0.1:${deniedAddress.port}/api/v1/sla-targets/${randomUUID()}/commands/set-purpose`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
            "idempotency-key": randomUUID(),
          },
          body: JSON.stringify({
            target_purpose: "RESPONSE",
            expected_version: 1,
            reason: "test",
          }),
        },
      );
      assert.equal(denied.status, 403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        deniedServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      (server as Server).close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
