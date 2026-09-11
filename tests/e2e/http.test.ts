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

test("temporary grant commands enforce idempotency, version and tenant scope", async () => {
  const { testDatabase } = await import("../helpers.js");
  const { seedPermissions } = await import("../../modules/identity/index.js");
  const { randomUUID } = await import("node:crypto");
  const db = await testDatabase();
  const userId = randomUUID();
  let tenant = "tenant-a";
  try {
    await db.pool.query(
      "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,'tenant-a','U-1','user-a','User A','ACTIVE')",
      [userId],
    );
    await db.uow.run("tenant-a", (tx) =>
      seedPermissions(tx, [
        { code: "asset.read", resource_type: "asset", action: "read" },
      ]),
    );
    const permission = await db.pool.query(
      "SELECT id FROM identity.permissions WHERE code='asset.read'",
    );
    const server = apiServer(
      config,
      async () => true,
      {
        async authenticate() {
          return { id: userId, tenant_id: tenant, actor_type: "USER" };
        },
      },
      {
        async evaluate() {
          return { result: "ALLOW", reason: "test" };
        },
      },
      db.uow,
    );
    const url = await listen(server);
    const request = (key: string, body: object) =>
      fetch(url + "/api/v1/temporary-grants", {
        method: "POST",
        headers: {
          authorization: "Bearer verified",
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify(body),
      });
    const body = {
      principal_id: userId,
      permission_id: permission.rows[0].id,
      scope_type: "SITE",
      scope_id: "site-a",
      valid_from: new Date(Date.now() - 1000).toISOString(),
      valid_until: new Date(Date.now() + 60000).toISOString(),
      reason: "incident response",
    };
    try {
      const first = await request("grant-key", body);
      assert.equal(first.status, 201);
      const created = (
        (await first.json()) as { data: { id: string; version: number } }
      ).data;
      const replay = await request("grant-key", body);
      assert.equal(replay.status, 201);
      assert.deepEqual(
        ((await replay.json()) as { data: unknown }).data,
        created,
      );
      const conflict = await request("grant-key", {
        ...body,
        reason: "changed",
      });
      assert.equal(conflict.status, 409);
      const revoke = await fetch(
        `${url}/api/v1/temporary-grants/${created.id}/commands/revoke`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer verified",
            "content-type": "application/json",
            "idempotency-key": "revoke-key",
          },
          body: JSON.stringify({ expected_version: created.version }),
        },
      );
      assert.equal(revoke.status, 200);
      tenant = "tenant-b";
      const crossTenant = await fetch(
        `${url}/api/v1/temporary-grants/${created.id}/commands/revoke`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer verified",
            "content-type": "application/json",
            "idempotency-key": "cross-tenant-key",
          },
          body: JSON.stringify({ expected_version: 2 }),
        },
      );
      // The tenant-scoped command cannot see the other tenant's row and
      // returns a conflict without disclosing its existence.
      assert.equal(crossTenant.status, 409);
    } finally {
      await close(server);
    }
  } finally {
    await db.close();
  }
});

test("asset registry creates an asset idempotently with audit and outbox", async () => {
  const { testDatabase } = await import("../helpers.js");
  const { randomUUID } = await import("node:crypto");
  const db = await testDatabase();
  const userId = randomUUID(),
    categoryId = randomUUID(),
    modelId = randomUUID();
  try {
    await db.pool.query(
      "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,'tenant-a','U-1','user-a','User A','ACTIVE')",
      [userId],
    );
    await db.pool.query(
      "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,'tenant-a','Laptop')",
      [categoryId],
    );
    await db.pool.query(
      "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,'tenant-a','Vendor','Model X',$2)",
      [modelId, categoryId],
    );
    const server = apiServer(
      config,
      async () => true,
      {
        async authenticate() {
          return { id: userId, tenant_id: "tenant-a", actor_type: "USER" };
        },
      },
      {
        async evaluate() {
          return { result: "ALLOW", reason: "test" };
        },
      },
      db.uow,
    );
    const url = await listen(server);
    try {
      const payload = {
        asset_code: "AST-1",
        asset_tag: "TAG-1",
        model_id: modelId,
      };
      const send = () =>
        fetch(url + "/api/v1/assets", {
          method: "POST",
          headers: {
            authorization: "Bearer verified",
            "content-type": "application/json",
            "idempotency-key": "asset-key",
          },
          body: JSON.stringify(payload),
        });
      const first = await send();
      assert.equal(first.status, 201);
      const created = ((await first.json()) as { data: { id: string } }).data;
      const replay = await send();
      assert.equal(replay.status, 201);
      assert.equal(
        ((await replay.json()) as { data: { id: string } }).data.id,
        created.id,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM asset.assets WHERE id=$1",
            [created.id],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM platform.outbox_events WHERE aggregate_id=$1",
            [created.id],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM audit.audit_events WHERE subject->>'entity_id'=$1",
            [created.id],
          )
        ).rows[0].count,
        1,
      );
    } finally {
      await close(server);
    }
  } finally {
    await db.close();
  }
});
