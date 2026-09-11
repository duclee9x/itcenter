import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { agentServer } from "../../apps/agent-gateway/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import {
  denyAll,
  unavailableAuthentication,
} from "../../packages/auth/src/index.js";
import type { UnitOfWork } from "../../packages/persistence/src/index.js";
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
const config = loadConfig({
  DATABASE_SECRET_REF: "env:TEST",
  APP_ENV: "test",
  LOG_LEVEL: "error",
});
const uow: UnitOfWork = {
  async run() {
    throw new Error("Unreachable without auth");
  },
};
test("API health, correlation, unavailable readiness and unauthenticated data routes", async () => {
  let ready = false;
  const server = apiServer(
      config,
      async () => ready,
      unavailableAuthentication,
      denyAll,
      uow,
    ),
    url = await listen(server);
  try {
    const live = await fetch(url + "/api/v1/health/live", {
      headers: { "x-correlation-id": "test-corr" },
    });
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("x-correlation-id"), "test-corr");
    assert.ok(live.headers.get("x-request-id"));
    assert.equal((await fetch(url + "/api/v1/health/ready")).status, 503);
    ready = true;
    assert.equal((await fetch(url + "/api/v1/health/ready")).status, 200);
    for (const path of [
      "/api/v1/me",
      "/api/v1/operations/00000000-0000-0000-0000-000000000001",
    ])
      assert.equal((await fetch(url + path)).status, 401);
    assert.equal(
      (
        await fetch(url + "/api/v1/me", {
          headers: { authorization: "Bearer forged" },
        })
      ).status,
      401,
    );
    assert.equal((await fetch(url + "/api/v1/assets")).status, 404);
  } finally {
    await close(server);
  }
});
test("agent boundary authenticates agent namespace and exposes no user administration", async () => {
  const server = agentServer(
      config,
      async () => true,
      unavailableAuthentication,
    ),
    url = await listen(server);
  try {
    assert.equal((await fetch(url + "/api/v1/agent/heartbeat")).status, 401);
    assert.equal((await fetch(url + "/api/v1/me")).status, 404);
  } finally {
    await close(server);
  }
});

test("operation API applies authorization and tenant filtering with real PostgreSQL", async () => {
  const { testDatabase } = await import("../helpers.js");
  const { OperationRegistry } =
    await import("../../packages/persistence/src/operations.js");
  const { randomUUID } = await import("node:crypto");
  const db = await testDatabase();
  let tenant = "a",
    allowed = true;
  const id = randomUUID();
  await db.uow.run("a", (tx) =>
    new OperationRegistry(tx).enqueue({
      operation_id: id,
      type: "TEST",
      target_type: "TEST",
      target_id: "one",
      correlation_id: "corr",
    }),
  );
  const server = apiServer(
    config,
    async () => true,
    {
      async authenticate() {
        return {
          id: "verified-test-user",
          tenant_id: tenant,
          actor_type: "USER",
        };
      },
    },
    {
      async evaluate() {
        return { result: allowed ? "ALLOW" : "DENY", reason: "test adapter" };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  const read = () =>
    fetch(`${url}/api/v1/operations/${id}`, {
      headers: { authorization: "Bearer synthetic-test-token" },
    });
  try {
    assert.equal((await read()).status, 200);
    allowed = false;
    assert.equal((await read()).status, 403);
    allowed = true;
    tenant = "b";
    assert.equal((await read()).status, 404);
  } finally {
    await close(server);
    await db.close();
  }
});
