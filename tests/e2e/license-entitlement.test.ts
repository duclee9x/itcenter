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

    const userId = randomUUID();
    await db.pool.query(
      `INSERT INTO identity.users
         (id,tenant_id,display_code,username,primary_email,display_name,employment_status)
       VALUES($1,$2,'USR-LICENSE-1','license.user','license@example.test','License User','ACTIVE')`,
      [userId, tenantId],
    );
    const assigned = await post(
      `/api/v1/license-entitlements/${entitlement.id}/commands/assign`,
      "license-assign",
      {
        principal_type: "USER",
        principal_id: userId,
        reason: "Assign subscription to active user",
      },
    );
    assert.equal(assigned.status, 201, await assigned.clone().text());
    const assignment = (
      (await assigned.json()) as {
        data: { assignment_id: string; state: string };
      }
    ).data;
    assert.equal(assignment.state, "ASSIGNED");
    const activated = await post(
      `/api/v1/license-assignments/${assignment.assignment_id}/commands/activate`,
      "license-activate",
      { expected_version: 1, reason: "Activate assigned seat" },
    );
    assert.equal(activated.status, 200, await activated.clone().text());
    const allocatedTypeChange = await post(
      `/api/v1/license-entitlements/${entitlement.id}/commands/update`,
      "allocated-type-change",
      {
        expected_version: 3,
        license_type: "PERPETUAL",
        reason: "Attempt to change model with a live assignment",
      },
    );
    assert.equal(allocatedTypeChange.status, 422);
    const availability = await get(
      `/api/v1/license-entitlements/${entitlement.id}/availability`,
    );
    assert.deepEqual(
      (
        (await availability.json()) as {
          data: { assigned: number; available: number };
        }
      ).data,
      {
        entitlement_id: entitlement.id,
        license_type: "PER_USER",
        quantity: 52,
        assigned: 1,
        reserved: 0,
        consumption_rule_supported: true,
        available: 51,
        effective_state: "ACTIVE",
      },
    );
    const reclaimPending = await post(
      `/api/v1/license-assignments/${assignment.assignment_id}/commands/reclaim`,
      "license-reclaim",
      { expected_version: 2, reason: "User no longer requires the software" },
    );
    assert.equal(reclaimPending.status, 200);
    const incompleteReclaim = await post(
      `/api/v1/license-assignments/${assignment.assignment_id}/commands/complete-reclaim`,
      "license-reclaim-incomplete",
      { expected_version: 3, reason: "Reclaim verified" },
    );
    assert.equal(incompleteReclaim.status, 400);
    const reclaimed = await post(
      `/api/v1/license-assignments/${assignment.assignment_id}/commands/complete-reclaim`,
      "license-reclaim-complete",
      {
        expected_version: 3,
        verification_reference: "uninstall-check-2026-001",
        reason: "Uninstall confirmed and seat returned",
      },
    );
    assert.equal(reclaimed.status, 200, await reclaimed.clone().text());
    assert.equal(
      ((await reclaimed.json()) as { data: { state: string } }).data.state,
      "RECLAIMED",
    );

    const underusedUserId = randomUUID();
    await db.pool.query(
      `INSERT INTO identity.users
         (id,tenant_id,display_code,username,primary_email,display_name,employment_status)
       VALUES($1,$2,'USR-LICENSE-2','license.user2','license2@example.test','License User 2','ACTIVE')`,
      [underusedUserId, tenantId],
    );
    const evidenceEntitlement = await post(
      "/api/v1/license-entitlements",
      "underuse-entitlement",
      {
        ...entitlementBody,
        pool_id: null,
        valid_from: new Date(Date.now() - 60_000).toISOString(),
        valid_until: new Date(Date.now() + 365 * 86400000).toISOString(),
        renewal_notice_days: 0,
        quantity: 2,
        reason: "Register second test entitlement",
      },
    );
    assert.equal(
      evidenceEntitlement.status,
      201,
      await evidenceEntitlement.clone().text(),
    );
    const evidenceEntitlementId = (
      (await evidenceEntitlement.json()) as { data: { id: string } }
    ).data.id;
    const evidenceAssignment = await post(
      `/api/v1/license-entitlements/${evidenceEntitlementId}/commands/assign`,
      "underuse-assignment",
      {
        principal_type: "USER",
        principal_id: underusedUserId,
        reason: "Assign seat for usage compliance test",
      },
    );
    assert.equal(evidenceAssignment.status, 201);
    const evidenceAssignmentId = (
      (await evidenceAssignment.json()) as { data: { assignment_id: string } }
    ).data.assignment_id;
    const evidenceActivation = await post(
      `/api/v1/license-assignments/${evidenceAssignmentId}/commands/activate`,
      "underuse-activation",
      { expected_version: 1, reason: "Activate usage compliance test seat" },
    );
    assert.equal(evidenceActivation.status, 200);
    const usageObservation = await post(
      `/api/v1/license-entitlements/${evidenceEntitlementId}/commands/usage-observation`,
      "usage-observation",
      {
        source: "MANUAL_ATTESTATION",
        active_usage: 0,
        observed_at: new Date().toISOString(),
        inactivity_threshold_days: 30,
        evidence_reference: "provider-snapshot-001",
        reason: "Provider usage synchronization",
      },
    );
    assert.equal(usageObservation.status, 201);
    const compliance = await get("/api/v1/license-compliance");
    assert.equal(compliance.status, 200, await compliance.clone().text());
    const complianceRows = (
      (await compliance.json()) as {
        data: Array<{ entitlement_id: string; compliance_state: string }>;
      }
    ).data;
    assert.equal(
      complianceRows.find((row) => row.entitlement_id === evidenceEntitlementId)
        ?.compliance_state,
      "UNDERUSED",
    );

    const singleSeat = await post(
      "/api/v1/license-entitlements",
      "single-seat-entitlement",
      {
        ...entitlementBody,
        pool_id: null,
        quantity: 1,
        valid_from: new Date(Date.now() - 60_000).toISOString(),
        valid_until: new Date(Date.now() + 365 * 86400000).toISOString(),
        renewal_notice_days: 0,
        reason: "Register a single seat for concurrency test",
      },
    );
    assert.equal(singleSeat.status, 201, await singleSeat.clone().text());
    const singleSeatId = ((await singleSeat.json()) as { data: { id: string } })
      .data.id;
    const concurrentUserIds = [randomUUID(), randomUUID()];
    await db.pool.query(
      `INSERT INTO identity.users
         (id,tenant_id,display_code,username,primary_email,display_name,employment_status)
       VALUES($1,$3,'USR-LICENSE-RACE-1','license.race1','race1@example.test','License Race 1','ACTIVE'),
             ($2,$3,'USR-LICENSE-RACE-2','license.race2','race2@example.test','License Race 2','ACTIVE')`,
      [...concurrentUserIds, tenantId],
    );
    const concurrentAssignments = await Promise.all(
      concurrentUserIds.map((principalId, index) =>
        post(
          `/api/v1/license-entitlements/${singleSeatId}/commands/assign`,
          `license-race-${index}`,
          {
            principal_type: "USER",
            principal_id: principalId,
            reason: "Race for the final available seat",
          },
        ),
      ),
    );
    assert.deepEqual(
      concurrentAssignments.map((response) => response.status).sort(),
      [201, 422],
    );
    const singleSeatAvailability = await get(
      `/api/v1/license-entitlements/${singleSeatId}/availability`,
    );
    assert.equal(singleSeatAvailability.status, 200);
    assert.equal(
      ((await singleSeatAvailability.json()) as { data: { available: number } })
        .data.available,
      0,
    );
    const winningIndex = concurrentAssignments.findIndex(
      (response) => response.status === 201,
    );
    // Represent a legacy/imported allocation discovered after a contract change.
    // Application commands cannot create this over-allocation; the compliance
    // worker must still detect and audit the authoritative database facts.
    await db.pool.query(
      `INSERT INTO license.assignments
         (id,tenant_id,entitlement_id,principal_type,principal_id,state,
          activated_at,created_by)
       VALUES($1,$2,$3,'USER',$4,'ACTIVE',now(),'legacy-import')`,
      [
        randomUUID(),
        tenantId,
        singleSeatId,
        concurrentUserIds[1 - winningIndex],
      ],
    );

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
    const overusedEvent = await waitForComplianceEvent(
      db.pool,
      tenantId,
      singleSeatId,
      "LICENSE.OVERUSED",
    );
    expiryController.abort();
    await expiryRun;
    assert.equal(expiryFailures.length, 0);
    assert.equal(expiredEvent.rows[0]!.count, 1);
    assert.equal(overusedEvent.rows[0]!.count, 1);
    const overuseFact = await db.pool.query(
      "SELECT compliance_state,(payload->>'overage')::int AS overage FROM license.compliance_facts WHERE tenant_id=$1 AND entitlement_id=$2",
      [tenantId, singleSeatId],
    );
    assert.deepEqual(overuseFact.rows, [
      { compliance_state: "OVERUSED", overage: 1 },
    ]);
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
    const underuseEvents = await db.pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='LICENSE.UNDERUSED' AND payload->'payload'->>'entitlement_id'=$2",
      [tenantId, evidenceEntitlementId],
    );
    assert.equal(underuseEvents.rows[0]!.count, 1);
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

async function waitForComplianceEvent(
  pool: {
    query(
      sql: string,
      values: unknown[],
    ): Promise<{ rows: Array<{ count: number }> }>;
  },
  tenantId: string,
  entitlementId: string,
  eventType: "LICENSE.OVERUSED" | "LICENSE.UNDERUSED",
) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND event_type=$2 AND payload->'payload'->>'entitlement_id'=$3",
      [tenantId, eventType, entitlementId],
    );
    if (result.rows[0]!.count > 0) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Worker did not emit ${eventType} in time.`);
}
