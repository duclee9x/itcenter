import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("Service Reference commands are scoped, versioned, idempotent and auditable", async () => {
  const db = await testDatabase();
  let tenant = "reference-tenant-a";
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return { id: "catalog-admin", tenant_id: tenant, actor_type: "USER" };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW" as const, reason: "test" };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  const post = (path: string, key: string, value: object) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(value),
    });
  try {
    const createBody = {
      key: "ERP",
      name: "ERP",
      reason: "Add canonical Service",
    };
    const createdResponse = await post(
      "/api/v1/services",
      "service-create-a",
      createBody,
    );
    assert.equal(
      createdResponse.status,
      201,
      await createdResponse.clone().text(),
    );
    const created = (
      (await createdResponse.json()) as {
        data: { id: string; version: number };
      }
    ).data;
    const replay = await post(
      "/api/v1/services",
      "service-create-a",
      createBody,
    );
    assert.equal(replay.status, 201);
    assert.equal(
      ((await replay.json()) as { data: { id: string } }).data.id,
      created.id,
    );
    assert.equal(
      (
        await post("/api/v1/services", "service-create-a", {
          ...createBody,
          name: "Changed",
        })
      ).status,
      409,
    );

    const detail = await fetch(`${url}/api/v1/services/${created.id}`, {
      headers: { authorization: "Bearer test" },
    });
    assert.equal(detail.status, 200);
    const changed = await post(
      `/api/v1/services/${created.id}/commands/update`,
      "service-update-a",
      {
        expected_version: 1,
        name: "ERP Core",
        reason: "Clarify service display name",
      },
    );
    assert.equal(changed.status, 200, await changed.clone().text());
    assert.equal(
      ((await changed.json()) as { data: { version: number; name: string } })
        .data.version,
      2,
    );

    const platformResponse = await post(
      "/api/v1/platforms",
      "platform-create-a",
      {
        key: "LINUX_UBUNTU_24",
        family: "LINUX",
        name: "Ubuntu 24",
        major_version: "24",
        reason: "Register canonical platform",
      },
    );
    assert.equal(
      platformResponse.status,
      201,
      await platformResponse.clone().text(),
    );
    const platform = (
      (await platformResponse.json()) as { data: { id: string } }
    ).data;
    assert.equal(
      (
        await fetch(`${url}/api/v1/platforms/${platform.id}`, {
          headers: { authorization: "Bearer test" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post(
          `/api/v1/platforms/${platform.id}/commands/update`,
          "platform-update-a",
          {
            expected_version: 1,
            family: "LINUX",
            name: "Ubuntu 24 LTS",
            reason: "Clarify canonical label",
          },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await post(
          `/api/v1/platforms/${platform.id}/commands/deactivate`,
          "platform-deactivate-a",
          {
            expected_version: 2,
            reason: "Retire platform reference",
          },
        )
      ).status,
      200,
    );

    const environmentResponse = await post(
      "/api/v1/service-environments",
      "environment-create-a",
      {
        service_id: created.id,
        key: "PRODUCTION",
        name: "Production",
        reason: "Register Service environment",
      },
    );
    assert.equal(
      environmentResponse.status,
      201,
      await environmentResponse.clone().text(),
    );
    const environment = (
      (await environmentResponse.json()) as { data: { id: string } }
    ).data;
    assert.equal(
      (
        await fetch(`${url}/api/v1/service-environments/${environment.id}`, {
          headers: { authorization: "Bearer test" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post(
          `/api/v1/service-environments/${environment.id}/commands/update`,
          "environment-update-a",
          {
            expected_version: 1,
            name: "Production EU",
            reason: "Clarify environment label",
          },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await post(
          `/api/v1/service-environments/${environment.id}/commands/deactivate`,
          "environment-deactivate-a",
          {
            expected_version: 2,
            reason: "Retire environment reference",
          },
        )
      ).status,
      200,
    );

    tenant = "reference-tenant-b";
    const hidden = await fetch(`${url}/api/v1/services/${created.id}`, {
      headers: { authorization: "Bearer test" },
    });
    assert.equal(hidden.status, 404);
    const wrongParent = await post(
      "/api/v1/service-environments",
      "environment-cross-tenant",
      {
        service_id: created.id,
        key: "PROD",
        name: "Production",
        reason: "Test isolation",
      },
    );
    assert.equal(wrongParent.status, 404);
    tenant = "reference-tenant-a";

    const inactive = await post(
      `/api/v1/services/${created.id}/commands/deactivate`,
      "service-deactivate-a",
      {
        expected_version: 2,
        reason: "Retire obsolete Service reference",
      },
    );
    assert.equal(inactive.status, 200, await inactive.clone().text());
    assert.equal(
      ((await inactive.json()) as { data: { state: string } }).data.state,
      "INACTIVE",
    );
    const effects = await db.pool.query(
      "SELECT event_type FROM platform.outbox_events WHERE tenant_id=$1 AND event_type LIKE 'SERVICE.%' ORDER BY occurred_at",
      [tenant],
    );
    assert.deepEqual(
      effects.rows.map((row) => row.event_type),
      ["SERVICE.CREATED", "SERVICE.UPDATED", "SERVICE.DEACTIVATED"],
    );
    const audit = await db.pool.query(
      "SELECT count(*)::int AS n FROM audit.audit_events WHERE tenant_id=$1 AND event_type LIKE 'SERVICE.%'",
      [tenant],
    );
    assert.equal(audit.rows[0]!.n, 3);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
