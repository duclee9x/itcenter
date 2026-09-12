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

test("Supplier lifecycle and Procurement Requests enforce authorization, history, idempotency and concurrency", async () => {
  const db = await testDatabase();
  const tenantId = "tenant-procurement";
  const requesterId = randomUUID();
  await db.pool.query(
    `INSERT INTO identity.users
       (id,tenant_id,display_code,username,display_name,employment_status)
     VALUES($1,$2,'PROC-REQ','procurement-requester','Procurement Requester','ACTIVE')`,
    [requesterId, tenantId],
  );
  let tenant = tenantId;
  const allowed = true;
  let deniedAction: string | null = null;
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
          id: "procurement-admin",
          tenant_id: tenant,
          actor_type: "USER",
        };
      },
    },
    {
      async evaluate(request) {
        return {
          result:
            allowed && request.action !== deniedAction
              ? ("ALLOW" as const)
              : ("DENY" as const),
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
    const supplierBody = {
      legal_name: "Northwind Equipment Ltd",
      tax_identifier: "TAX-PRIVATE-44991",
      address: "1 Harbor Road",
      categories: ["LAPTOP", "MONITOR"],
      risk_state: "REVIEWED",
      bank_info_reference: "vault://private-bank-ref",
      contacts: [
        { name: "Procurement Contact", email: "contact@example.test" },
      ],
      reason: "Register a new supplier for qualification",
    };
    const protectedReason = await post(
      "/api/v1/suppliers",
      "supplier-create-protected-reason",
      {
        ...supplierBody,
        reason: "Register tax identifier TAX-PRIVATE-44991",
      },
    );
    assert.equal(protectedReason.status, 400);
    const createdResponse = await post(
      "/api/v1/suppliers",
      "supplier-create",
      supplierBody,
    );
    assert.equal(
      createdResponse.status,
      201,
      await createdResponse.clone().text(),
    );
    const supplier = (
      (await createdResponse.json()) as { data: Record<string, unknown> }
    ).data;
    assert.equal(supplier.state, "PROSPECT");
    assert.equal(supplier.version, 1);
    assert.equal(supplier.tax_identifier_present, true);
    assert.equal(supplier.bank_info_reference_present, true);
    assert.equal("tax_identifier" in supplier, false);
    assert.equal("bank_info_reference" in supplier, false);

    const createReplay = await post(
      "/api/v1/suppliers",
      "supplier-create",
      supplierBody,
    );
    assert.equal(createReplay.status, 201);
    assert.equal(
      ((await createReplay.json()) as { data: { id: string } }).data.id,
      supplier.id,
    );
    const keyConflict = await post("/api/v1/suppliers", "supplier-create", {
      ...supplierBody,
      legal_name: "Changed supplier semantics",
    });
    assert.equal(keyConflict.status, 409);

    const detail = await get(`/api/v1/suppliers/${supplier.id}`);
    assert.equal(detail.status, 200);
    assert.equal(
      "tax_identifier" in ((await detail.json()) as { data: object }).data,
      false,
    );
    deniedAction = "supplier.approve";
    const deniedTransition = await post(
      `/api/v1/suppliers/${supplier.id}/commands/approve`,
      "supplier-denied-approve",
      { expected_version: 1, reason: "Try denied transition" },
    );
    assert.equal(deniedTransition.status, 403);
    deniedAction = null;

    const transition = async (
      command: string,
      expectedVersion: number,
      key: string,
      expectedState: string,
    ) => {
      const response = await post(
        `/api/v1/suppliers/${supplier.id}/commands/${command}`,
        key,
        { expected_version: expectedVersion, reason: `Test ${command}` },
      );
      assert.equal(response.status, 200, await response.clone().text());
      const result = (await response.json()) as {
        data: { state: string; version: number };
      };
      assert.equal(result.data.state, expectedState);
      return result.data.version;
    };
    let version = await transition(
      "approve",
      1,
      "supplier-approve",
      "APPROVED",
    );
    version = await transition(
      "mark-preferred",
      version,
      "supplier-preferred",
      "PREFERRED",
    );
    version = await transition(
      "suspend",
      version,
      "supplier-suspend",
      "SUSPENDED",
    );
    version = await transition(
      "resume",
      version,
      "supplier-resume",
      "APPROVED",
    );
    version = await transition("block", version, "supplier-block", "BLOCKED");
    const forbidden = await post(
      `/api/v1/suppliers/${supplier.id}/commands/approve`,
      "supplier-forbidden-blocked-approve",
      { expected_version: version, reason: "Forbidden direct requalification" },
    );
    assert.equal(forbidden.status, 422);
    version = await transition(
      "unblock",
      version,
      "supplier-unblock",
      "PROSPECT",
    );
    version = await transition(
      "deactivate",
      version,
      "supplier-deactivate",
      "INACTIVE",
    );
    version = await transition(
      "reactivate",
      version,
      "supplier-reactivate",
      "PROSPECT",
    );

    const protectedUpdateReason = await post(
      `/api/v1/suppliers/${supplier.id}/commands/update-profile`,
      "supplier-profile-protected-reason",
      {
        expected_version: version,
        address: "2 Harbor Road",
        reason: "Correct record for TAX-PRIVATE-44991",
      },
    );
    assert.equal(protectedUpdateReason.status, 400);
    const update = await post(
      `/api/v1/suppliers/${supplier.id}/commands/update-profile`,
      "supplier-profile-update",
      {
        expected_version: version,
        address: "2 Harbor Road",
        reason: "Correct registered address",
      },
    );
    assert.equal(update.status, 200, await update.clone().text());
    version++;
    const approveReplayAfterLaterTransitions = await post(
      `/api/v1/suppliers/${supplier.id}/commands/approve`,
      "supplier-approve",
      { expected_version: 1, reason: "Test approve" },
    );
    assert.equal(approveReplayAfterLaterTransitions.status, 200);
    assert.equal(
      (
        (await approveReplayAfterLaterTransitions.json()) as {
          data: { state: string; version: number };
        }
      ).data.state,
      "APPROVED",
    );
    const approvedEventCount = await db.pool.query(
      `SELECT count(*)::int AS count FROM platform.outbox_events
        WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='SUPPLIER.APPROVED'`,
      [tenantId, supplier.id],
    );
    assert.equal(approvedEventCount.rows[0]!.count, 1);
    const stale = await post(
      `/api/v1/suppliers/${supplier.id}/commands/block`,
      "supplier-stale-version",
      { expected_version: 1, reason: "Stale command must fail" },
    );
    assert.equal(stale.status, 409);

    const raceSupplier = (
      (await (
        await post("/api/v1/suppliers", "supplier-race-create", {
          legal_name: "Concurrent Supplier",
          reason: "Create for race test",
        })
      ).json()) as { data: { id: string } }
    ).data;
    const competing = await Promise.all([
      post(
        `/api/v1/suppliers/${raceSupplier.id}/commands/approve`,
        "race-approve",
        {
          expected_version: 1,
          reason: "Approve competitor",
        },
      ),
      post(
        `/api/v1/suppliers/${raceSupplier.id}/commands/block`,
        "race-block",
        {
          expected_version: 1,
          reason: "Block competitor",
        },
      ),
    ]);
    assert.deepEqual(
      competing.map((response) => response.status).sort(),
      [200, 409],
    );
    const raceHistory = await db.pool.query(
      "SELECT entity_version FROM procurement.supplier_history WHERE tenant_id=$1 AND supplier_id=$2 ORDER BY entity_version",
      [tenantId, raceSupplier.id],
    );
    assert.deepEqual(
      raceHistory.rows.map((row) => row.entity_version),
      [1, 2],
    );

    const requestBody = {
      requester_user_id: requesterId,
      source_type: "MANUAL_REQUEST",
      source_id: `manual-${randomUUID()}`,
      business_reason: "Replace equipment for the operations team",
      target_date: "2026-12-01",
      cost_center_id: "CC-OPS",
      estimated_total: 1200,
      currency: "USD",
      priority: "P2",
      lines: [
        {
          item_type: "ASSET",
          description: "Business laptop",
          quantity: 2,
          estimated_unit_price: 600,
        },
      ],
    };
    const requestResponse = await post(
      "/api/v1/procurement-requests",
      "request-create",
      requestBody,
    );
    assert.equal(
      requestResponse.status,
      201,
      await requestResponse.clone().text(),
    );
    const request = (
      (await requestResponse.json()) as { data: Record<string, unknown> }
    ).data;
    assert.equal(request.state, "DRAFT");
    assert.equal(request.version, 1);
    assert.equal((request.lines as unknown[]).length, 1);
    const requestReplay = await post(
      "/api/v1/procurement-requests",
      "request-create",
      requestBody,
    );
    assert.equal(requestReplay.status, 201);
    assert.equal(
      ((await requestReplay.json()) as { data: { id: string } }).data.id,
      request.id,
    );
    const submittedResponse = await post(
      `/api/v1/procurement-requests/${request.id}/commands/submit`,
      "request-submit",
      { expected_version: 1, reason: "Submit for procurement review" },
    );
    assert.equal(
      submittedResponse.status,
      200,
      await submittedResponse.clone().text(),
    );
    const submitted = (
      (await submittedResponse.json()) as {
        data: { state: string; version: number };
      }
    ).data;
    assert.equal(submitted.state, "SUBMITTED");
    assert.equal(submitted.version, 2);
    const submitReplay = await post(
      `/api/v1/procurement-requests/${request.id}/commands/submit`,
      "request-submit",
      { expected_version: 1, reason: "Submit for procurement review" },
    );
    assert.equal(submitReplay.status, 200);

    const duplicateSource = await post(
      "/api/v1/procurement-requests",
      "request-duplicate-source",
      requestBody,
    );
    assert.equal(duplicateSource.status, 422);

    const requestRead = await get(`/api/v1/procurement-requests/${request.id}`);
    assert.equal(requestRead.status, 200);
    const requestTimeline = await get(
      `/api/v1/procurement-requests/${request.id}/timeline`,
    );
    assert.equal(requestTimeline.status, 200);
    assert.equal(
      ((await requestTimeline.json()) as { data: unknown[] }).data.length,
      2,
    );
    const supplierTimeline = await get(
      `/api/v1/suppliers/${supplier.id}/timeline`,
    );
    assert.equal(supplierTimeline.status, 200);
    assert.ok(
      ((await supplierTimeline.json()) as { data: unknown[] }).data.length >=
        10,
    );
    tenant = "tenant-other";
    const crossTenantSupplier = await get(`/api/v1/suppliers/${supplier.id}`);
    assert.equal(crossTenantSupplier.status, 404);
    const crossTenantRequest = await get(
      `/api/v1/procurement-requests/${request.id}`,
    );
    assert.equal(crossTenantRequest.status, 404);
    tenant = tenantId;

    const secrets = await db.pool.query(
      `SELECT
         EXISTS(SELECT 1 FROM platform.outbox_events WHERE tenant_id=$1 AND payload::text LIKE '%TAX-PRIVATE-44991%') AS tax_in_outbox,
         EXISTS(SELECT 1 FROM platform.outbox_events WHERE tenant_id=$1 AND payload::text LIKE '%vault://private-bank-ref%') AS bank_in_outbox,
         EXISTS(SELECT 1 FROM audit.audit_events WHERE tenant_id=$1 AND after::text LIKE '%TAX-PRIVATE-44991%') AS tax_in_audit,
         EXISTS(SELECT 1 FROM audit.audit_events WHERE tenant_id=$1 AND after::text LIKE '%vault://private-bank-ref%') AS bank_in_audit`,
      [tenantId],
    );
    assert.deepEqual(secrets.rows[0], {
      tax_in_outbox: false,
      bank_in_outbox: false,
      tax_in_audit: false,
      bank_in_audit: false,
    });

    const eventCounts = await db.pool.query(
      "SELECT event_type,count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 GROUP BY event_type ORDER BY event_type",
      [tenantId],
    );
    const counts = Object.fromEntries(
      eventCounts.rows.map((row) => [row.event_type, row.count]),
    );
    assert.equal(counts["SUPPLIER.CREATED"], 2);
    assert.equal(counts["SUPPLIER.RESUMED"], 1);
    assert.equal(counts["PROCUREMENT.REQUEST_CREATED"], 1);
    assert.equal(counts["PROCUREMENT.REQUESTED"], 1);
    await assert.rejects(
      db.pool.query(
        "DELETE FROM procurement.suppliers WHERE tenant_id=$1 AND id=$2",
        [tenantId, supplier.id],
      ),
      /Procurement history is append-only/,
    );
  } finally {
    server.close();
    await db.close();
  }
});
