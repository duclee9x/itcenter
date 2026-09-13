import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

test("TASK-095 preserves TASK-039 Operations Overview response contract", async () => {
  const db = await testDatabase();
  const tenant = `task095-overview-${randomUUID()}`;
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return { id: "overview-reader", tenant_id: tenant, actor_type: "USER" };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW", reason: "TASK-095 compatibility test" };
      },
    },
    db.uow,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/operations/overview`,
      { headers: { authorization: "Bearer test" } },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: Record<string, unknown>;
      meta: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(body.data).sort(), [
      "actionable_work",
      "active_maintenance",
      "automation_attention",
      "generated_at",
      "open_incidents",
      "pending_approvals",
      "sla_at_risk",
    ]);
    assert.equal(typeof body.data.generated_at, "string");
    assert.ok(body.meta.request_id);
  } finally {
    await new Promise<void>((resolve, reject) =>
      (server as Server).close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
