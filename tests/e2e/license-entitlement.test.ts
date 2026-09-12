import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";
import { licenseExpiryTask } from "../../apps/worker/src/license-expiry.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("license entitlements and pools retain terms, scope, audit and expiry facts", async () => {
  const db = await testDatabase();
  const tenantId = "tenant-license";
  const productId = randomUUID();
  await db.pool.query(
    `INSERT INTO software.software_products
       (id,tenant_id,product_code,name,vendor,category,owner_id,support_team)
     VALUES($1,$2,'LICENSE-REF','Licensed Product','Example','TOOLS','owner','support')`,
    [productId, tenantId],
  );
  let tenant = tenantId;
  let allowed = true;
  let requiredDepartment: string | null = null;
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return { id: "license-admin", tenant_id: tenant, actor_type: "USER" };
      },
    },
    {
      async evaluate(request) {
        const inDepartment =
          requiredDepartment === null ||
          request.scope.department === requiredDepartment;
        return {
          result:
            allowed && inDepartment ? ("ALLOW" as const) : ("DENY" as const),
          reason: "test policy",
        };
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
  const get = (path: string) =>
    fetch(url + path, { headers: { authorization: "Bearer test" } });
  try {
    const poolBody = {
      name: "Marketing seats",
      pool_type: "DEPARTMENT",
      scope_reference: "marketing",
      contract_reference: "PO-42",
      reason: "Separate marketing entitlement accounting",
    };
    const poolCreated = await post(
      "/api/v1/license-pools",
      "pool-create",
      poolBody,
    );
    assert.equal(poolCreated.status, 201, await poolCreated.clone().text());
    const pool = ((await poolCreated.json()) as { data: { id: string } }).data;
    requiredDepartment = "finance";
    const outOfScopePool = await get(`/api/v1/license-pools/${pool.id}`);
    assert.equal(outOfScopePool.status, 403);
    const scopedPoolList = await get("/api/v1/license-pools");
    assert.deepEqual(
      ((await scopedPoolList.json()) as { data: unknown[] }).data,
      [],
    );
    requiredDepartment = null;
    const poolReplay = await post(
      "/api/v1/license-pools",
      "pool-create",
      poolBody,
    );
    assert.equal(poolReplay.status, 201);
    assert.equal(
      ((await poolReplay.json()) as { data: { id: string } }).data.id,
      pool.id,
    );
    const poolKeyConflict = await post("/api/v1/license-pools", "pool-create", {
      ...poolBody,
      name: "Changed name",
    });
    assert.equal(poolKeyConflict.status, 409);

    const now = Date.now();
    const entitlementBody = {
      software_product_id: productId,
      pool_id: pool.id,
      license_type: "PER_USER",
      quantity: 50,
      purchased_at: new Date(now - 60 * 86400000).toISOString(),
      valid_from: new Date(now - 30 * 86400000).toISOString(),
      valid_until: new Date(now - 86400000).toISOString(),
      contract_reference: "SUB-2026-17",
      supplier_reference: "VENDOR-ACME",
      cost: 1250.5,
      currency: "USD",
      renewal_notice_days: 45,
      restrictions: ["Commercial use only"],
      reason: "Register purchased seats",
    };
    allowed = false;
    const deniedBody = await post(
      "/api/v1/license-entitlements",
      "denied-create",
      entitlementBody,
    );
    assert.equal(deniedBody.status, 403);
    allowed = true;
    const created = await post(
      "/api/v1/license-entitlements",
      "entitlement-create",
      entitlementBody,
    );
    assert.equal(created.status, 201, await created.clone().text());
    const entitlement = (
      (await created.json()) as {
        data: { id: string; effective_state: string; term_version: number };
      }
    ).data;
    assert.equal(entitlement.effective_state, "EXPIRED");
    assert.equal(entitlement.term_version, 1);
    const createdReplay = await post(
      "/api/v1/license-entitlements",
      "entitlement-create",
      entitlementBody,
    );
    assert.equal(createdReplay.status, 201);
    assert.equal(
      ((await createdReplay.json()) as { data: { id: string } }).data.id,
      entitlement.id,
    );

    const detail = await get(`/api/v1/license-entitlements/${entitlement.id}`);
    assert.equal(detail.status, 200);
    assert.equal(
      ((await detail.json()) as { data: { effective_state: string } }).data
        .effective_state,
      "EXPIRED",
    );
    const poolRead = await get(`/api/v1/license-pools/${pool.id}`);
    const poolData = (
      (await poolRead.json()) as {
        data: { entitlement_count: number; entitled_quantity: string };
      }
    ).data;
    assert.equal(poolData.entitlement_count, 1);
    assert.equal(poolData.entitled_quantity, "50");

    const updated = await post(
      `/api/v1/license-entitlements/${entitlement.id}/commands/update`,
      "entitlement-update",
      {
        expected_version: 1,
        quantity: 52,
        reason: "Correct contract seat count",
      },
    );
    assert.equal(updated.status, 200, await updated.clone().text());
    const updatedData = (await updated.json()) as {
      data: { quantity: number; version: number; effective_state: string };
    };
    assert.equal(updatedData.data.quantity, 52);
    assert.equal(updatedData.data.version, 2);
    assert.equal(updatedData.data.effective_state, "EXPIRED");

    const renewedFrom = new Date(Date.now() - 60_000).toISOString();
    const renewedUntil = new Date(Date.now() + 30 * 86400000).toISOString();
    const renewed = await post(
      `/api/v1/license-entitlements/${entitlement.id}/commands/renew`,
      "entitlement-renew",
      {
        expected_version: 2,
        valid_from: renewedFrom,
        valid_until: renewedUntil,
        reason: "Renew subscription term",
      },
    );
    assert.equal(renewed.status, 200, await renewed.clone().text());
    const renewedData = (await renewed.json()) as {
      data: {
        effective_state: string;
        current_term_version: number;
        version: number;
      };
    };
    assert.equal(renewedData.data.effective_state, "ACTIVE");
    assert.equal(renewedData.data.current_term_version, 2);
    assert.equal(renewedData.data.version, 3);

    const invalidCost = await post(
      "/api/v1/license-entitlements",
      "invalid-cost",
      { ...entitlementBody, cost: -1, reason: "Invalid amount" },
    );
    assert.equal(invalidCost.status, 400);
    const secretRejected = await post(
      "/api/v1/license-entitlements",
      "secret-rejected",
      { ...entitlementBody, restrictions: ["license_key=DO_NOT_STORE"] },
    );
    assert.equal(secretRejected.status, 400);
    const badRenewal = await post(
      `/api/v1/license-entitlements/${entitlement.id}/commands/renew`,
      "bad-renewal",
      {
        expected_version: 3,
        valid_from: new Date(Date.now() + 100000).toISOString(),
        valid_until: new Date(Date.now()).toISOString(),
        reason: "Inverted period",
      },
    );
    assert.equal(badRenewal.status, 400);
    const staleUpdate = await post(
      `/api/v1/license-entitlements/${entitlement.id}/commands/update`,
      "stale-update",
      { expected_version: 2, quantity: 53, reason: "Stale version" },
    );
    assert.equal(staleUpdate.status, 409);

    tenant = "tenant-other";
    const isolated = await get(
      `/api/v1/license-entitlements/${entitlement.id}`,
    );
    assert.equal(isolated.status, 404);
    tenant = tenantId;
    const invalidProduct = await post(
      "/api/v1/license-entitlements",
      "other-tenant-product",
      { ...entitlementBody, software_product_id: randomUUID() },
    );
    assert.equal(invalidProduct.status, 404);

    const history = await db.pool.query(
      "SELECT entity_version,term_version,action FROM license.entitlement_history WHERE tenant_id=$1 AND entitlement_id=$2 ORDER BY entity_version",
      [tenantId, entitlement.id],
    );
    assert.deepEqual(history.rows, [
      { entity_version: 1, term_version: 1, action: "CREATED" },
      { entity_version: 2, term_version: 1, action: "UPDATED" },
      { entity_version: 3, term_version: 2, action: "RENEWED" },
    ]);
    const expiryController = new AbortController();
    const expiryFailures: number[] = [];
    const expiry = licenseExpiryTask({
      pool: db.pool,
      uow: db.uow,
      config: loadConfig({
        DATABASE_SECRET_REF: "env:TEST",
        APP_ENV: "test",
        LOG_LEVEL: "error",
      }),
      reportFailure: () => expiryFailures.push(1),
    });
    const expiryRun = expiry.run(expiryController.signal);
    const expiredEvent = await waitForExpiryEvent(
      db.pool,
      tenantId,
      entitlement.id,
    );
    expiryController.abort();
    await expiryRun;
    assert.equal(expiryFailures.length, 0);
    assert.equal(expiredEvent.rows[0]!.count, 1);
    const expiringEvent = await db.pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='LICENSE.EXPIRING' AND aggregate_id=$2",
      [tenantId, entitlement.id],
    );
    assert.equal(expiringEvent.rows[0]!.count, 1);
    const expiryFact = await db.pool.query(
      "SELECT term_version FROM license.entitlement_expiry_facts WHERE tenant_id=$1 AND entitlement_id=$2",
      [tenantId, entitlement.id],
    );
    assert.deepEqual(expiryFact.rows, [{ term_version: 1 }]);
    const expiringFact = await db.pool.query(
      "SELECT term_version,notice_days FROM license.entitlement_expiring_facts WHERE tenant_id=$1 AND entitlement_id=$2",
      [tenantId, entitlement.id],
    );
    assert.deepEqual(expiringFact.rows, [{ term_version: 2, notice_days: 45 }]);
    const outbox = await db.pool.query(
      "SELECT payload->'payload'->>'term_version' AS term_version FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='LICENSE.EXPIRED'",
      [tenantId],
    );
    assert.deepEqual(outbox.rows, [{ term_version: "1" }]);
    const audits = await db.pool.query(
      "SELECT count(*)::int AS count FROM audit.audit_events WHERE tenant_id=$1 AND event_type='LICENSE.EXPIRED'",
      [tenantId],
    );
    assert.equal(audits.rows[0]!.count, 1);
    const expiringAudits = await db.pool.query(
      "SELECT count(*)::int AS count FROM audit.audit_events WHERE tenant_id=$1 AND event_type='LICENSE.EXPIRING'",
      [tenantId],
    );
    assert.equal(expiringAudits.rows[0]!.count, 1);
    const appendOnly = await db.pool
      .query(
        "UPDATE license.entitlement_terms SET reason='mutated' WHERE tenant_id=$1 AND entitlement_id=$2",
        [tenantId, entitlement.id],
      )
      .then(
        () => false,
        (error: Error) => /append-only/.test(error.message),
      );
    assert.equal(appendOnly, true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});

async function waitForExpiryEvent(
  pool: {
    query(
      sql: string,
      values: unknown[],
    ): Promise<{ rows: Array<{ count: number }> }>;
  },
  tenantId: string,
  entitlementId: string,
) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='LICENSE.EXPIRED' AND aggregate_id=$2",
      [tenantId, entitlementId],
    );
    if (result.rows[0]!.count > 0) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Worker did not emit LICENSE.EXPIRED in time.");
}
