import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return "http://127.0.0.1:" + (server.address() as AddressInfo).port;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(object)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(object[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value) ?? "null";
}

test("TASK-072 PO commands enforce independent states, approvals, immutable versions and races", async () => {
  const db = await testDatabase();
  const tenant = "tenant-po";
  const supplier = randomUUID();
  const operatorId = randomUUID();
  await db.pool.query(
    "INSERT INTO procurement.suppliers(id,tenant_id,code,legal_name,state,created_by) VALUES($1,$2,'PO-SUP-1','PO Supplier','APPROVED','test')",
    [supplier, tenant],
  );
  let actorTenant = tenant;
  let deniedPermission: string | null = null;
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
          id: operatorId,
          tenant_id: actorTenant,
          actor_type: "USER",
        };
      },
    },
    {
      async evaluate(request) {
        return {
          result:
            request.action === deniedPermission
              ? ("DENY" as const)
              : ("ALLOW" as const),
          reason: "test",
        };
      },
    },
    db.uow,
  );
  const base = await listen(server);
  const post = (path: string, key: string, body: object) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
  const get = (path: string) =>
    fetch(base + path, { headers: { authorization: "Bearer test" } });
  const makeBody = (extra: object = {}) => ({
    supplier_id: supplier,
    currency: "USD",
    terms: { incoterm: "DAP" },
    lines: [{ description: "Switch", quantity: 2, unit_price: 100 }],
    reason: "Create operational PO",
    ...extra,
  });
  const create = async (key: string, body = makeBody()) => {
    const response = await post("/api/v1/purchase-orders", key, body);
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: { id: string } }).data.id;
  };
  const command = (
    id: string,
    action: string,
    key: string,
    version: number,
    extra: object = {},
  ) =>
    post("/api/v1/purchase-orders/" + id + "/commands/" + action, key, {
      expected_version: version,
      reason: "Test " + action,
      ...extra,
    });

  try {
    const id = await create("po-create");
    const replay = await post(
      "/api/v1/purchase-orders",
      "po-create",
      makeBody(),
    );
    assert.equal(replay.status, 201);
    assert.equal(
      ((await replay.json()) as { data: { id: string } }).data.id,
      id,
    );
    const keyConflict = await post(
      "/api/v1/purchase-orders",
      "po-create",
      makeBody({ terms: { changed: true } }),
    );
    assert.equal(keyConflict.status, 409);
    const draft = (
      (await (await get("/api/v1/purchase-orders/" + id)).json()) as {
        data: { lifecycle_state: string; receipt_state: string };
      }
    ).data;
    assert.equal(draft.lifecycle_state, "DRAFT");
    assert.equal(draft.receipt_state, "NOT_RECEIVED");
    deniedPermission = "po.read";
    assert.equal((await get("/api/v1/purchase-orders/" + id)).status, 403);
    deniedPermission = null;
    const permissionCases: Array<[string, string, string, object]> = [
      ["po.create", "POST", "/api/v1/purchase-orders", makeBody()],
      [
        "po.update",
        "update-draft",
        "update-draft",
        { lines: [{ description: "Denied", quantity: 1, unit_price: 1 }] },
      ],
      ["po.issue", "issue", "issue", {}],
      ["po.hold", "hold", "hold", {}],
      ["po.hold", "resume", "resume", {}],
      ["po.amend", "amend", "amend", { terms: { denied: true } }],
      ["po.cancel", "cancel", "cancel", {}],
      ["po.close", "close", "close", {}],
      ["po.close", "close-remainder", "close-remainder", {}],
    ];
    for (const [permission, action, routeAction, extra] of permissionCases) {
      deniedPermission = permission;
      const denied =
        action === "POST"
          ? await post(routeAction, "po-denied-" + permission, extra)
          : await command(
              id,
              routeAction,
              "po-denied-" + routeAction,
              1,
              extra,
            );
      assert.equal(denied.status, 403, permission + " / " + routeAction);
    }
    deniedPermission = null;
    const update = await command(id, "update-draft", "po-update", 1, {
      lines: [{ description: "Revised switch", quantity: 3, unit_price: 90 }],
    });
    assert.equal(update.status, 200, await update.text());
    const updateEvent = await db.pool.query(
      "SELECT payload FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='PO.UPDATED'",
      [tenant, id],
    );
    assert.ok(
      (
        updateEvent.rows[0]!.payload.payload.changed_fields as string[]
      ).includes("lines"),
    );

    const id2 = await create("po-create-issue");
    const policyId = randomUUID();
    await db.pool.query(
      "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,$2,'PO-ISSUE-TEST',1,'ACTIVE')",
      [policyId, tenant],
    );
    const issueHash = createHash("sha256")
      .update(
        canonical({
          supplier_id: supplier,
          procurement_request_id: null,
          rfq_id: null,
          source_quotation_id: null,
          currency: "USD",
          expected_delivery: null,
          payment_terms: null,
          delivery_terms: null,
          delivery_location: null,
          terms: { incoterm: "DAP" },
          lines: [
            {
              line_number: 1,
              item_type: "GOODS",
              description: "Switch",
              item_reference_id: null,
              unit: null,
              quantity: 2,
              unit_price: 100,
              tax_amount: 0,
              discount_amount: 0,
              expected_delivery: null,
              total: 200,
            },
          ],
        }),
      )
      .digest("hex");
    const approvalCreate = await post(
      "/api/v1/approvals",
      "po-approval-create",
      {
        source_type: "PO_ISSUE",
        source_id: id2,
        policy_id: policyId,
        policy_version: 1,
        context: {
          aggregate_version: 1,
          commercial_snapshot_hash: issueHash,
        },
      },
    );
    assert.equal(
      approvalCreate.status,
      201,
      await approvalCreate.clone().text(),
    );
    const approvalId = (
      (await approvalCreate.json()) as { data: { id: string } }
    ).data.id;
    const pending = await command(id2, "issue", "po-pending", 1);
    assert.equal(pending.status, 422);
    await db.pool.query(
      "UPDATE control.approval_requests SET state='APPROVED' WHERE tenant_id=$1 AND id=$2",
      [tenant, approvalId],
    );
    const linkedApprovedIssue = await command(
      id2,
      "issue",
      "po-approved-issue",
      1,
    );
    assert.equal(
      linkedApprovedIssue.status,
      200,
      await linkedApprovedIssue.clone().text(),
    );
    const issueEvent = await db.pool.query(
      "SELECT payload FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='PO.ISSUED'",
      [tenant, id2],
    );
    assert.equal(
      issueEvent.rows[0]!.payload.payload.approval_reference,
      approvalId,
    );
    assert.equal(
      issueEvent.rows[0]!.payload.payload.commercial_snapshot_hash,
      issueHash,
    );
    const linkedCommercialLines = await db.pool.query(
      "SELECT commercial_version,count(*)::int AS line_count FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 GROUP BY commercial_version ORDER BY commercial_version NULLS FIRST",
      [tenant, id2],
    );
    assert.deepEqual(
      linkedCommercialLines.rows.map((row) => [
        row.commercial_version,
        row.line_count,
      ]),
      [[1, 1]],
    );

    const id3 = await create("po-create-amend");
    const issue = await command(id3, "issue", "po-issue", 1);
    assert.equal(issue.status, 200, await issue.clone().text());
    const beforeAmendment = (
      (await (await get("/api/v1/purchase-orders/" + id3)).json()) as {
        data: {
          commercial_snapshot: Record<string, unknown>;
        };
      }
    ).data.commercial_snapshot;
    const proposedAmendment = {
      ...beforeAmendment,
      terms: { delivery: "insured" },
    };
    const amendmentApprovalCreate = await post(
      "/api/v1/approvals",
      "po-amendment-approval-create",
      {
        source_type: "PO_AMENDMENT",
        source_id: id3,
        policy_id: policyId,
        policy_version: 1,
        context: {
          base_aggregate_version: 2,
          base_commercial_version: 1,
          base_commercial_snapshot_hash: createHash("sha256")
            .update(canonical(beforeAmendment))
            .digest("hex"),
          proposed_commercial_snapshot_hash: createHash("sha256")
            .update(canonical(proposedAmendment))
            .digest("hex"),
        },
      },
    );
    assert.equal(
      amendmentApprovalCreate.status,
      201,
      await amendmentApprovalCreate.clone().text(),
    );
    const amendmentApprovalId = (
      (await amendmentApprovalCreate.json()) as { data: { id: string } }
    ).data.id;
    const pendingAmendment = await command(
      id3,
      "amend",
      "po-amend-pending",
      2,
      { terms: { delivery: "insured" } },
    );
    assert.equal(pendingAmendment.status, 422);
    await db.pool.query(
      "UPDATE control.approval_requests SET state='APPROVED' WHERE tenant_id=$1 AND id=$2",
      [tenant, amendmentApprovalId],
    );
    const amend = await command(id3, "amend", "po-amend", 2, {
      terms: { delivery: "insured" },
      approval_request_id: amendmentApprovalId,
    });
    assert.equal(amend.status, 200, await amend.clone().text());
    const amendEvent = await db.pool.query(
      "SELECT payload FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='PO.AMENDED'",
      [tenant, id3],
    );
    assert.equal(
      amendEvent.rows[0]!.payload.payload.approval_reference,
      amendmentApprovalId,
    );
    assert.ok(
      (
        amendEvent.rows[0]!.payload.payload.material_changes as string[]
      ).includes("terms"),
    );
    const detail = (
      (await (await get("/api/v1/purchase-orders/" + id3)).json()) as {
        data: {
          current_commercial_version: number;
          commercial_versions: unknown[];
        };
      }
    ).data;
    assert.equal(detail.current_commercial_version, 2);
    assert.equal(detail.commercial_versions.length, 2);
    const versionLines = await db.pool.query(
      "SELECT commercial_version,count(*)::int AS line_count FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 GROUP BY commercial_version ORDER BY commercial_version",
      [tenant, id3],
    );
    assert.deepEqual(
      versionLines.rows.map((row) => [row.commercial_version, row.line_count]),
      [
        [1, 1],
        [2, 1],
      ],
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE procurement.purchase_order_lines SET unit_price=1 WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=1",
        [tenant, id3],
      ),
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE procurement.purchase_order_versions SET reason='rewrite' WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=1",
        [tenant, id3],
      ),
    );
    const hold = await command(id3, "hold", "po-hold", 3);
    assert.equal(hold.status, 200);
    await assert.rejects(
      db.pool.query(
        "UPDATE procurement.purchase_orders SET receipt_state='PARTIALLY_RECEIVED',committed_receipt_count=1,aggregate_version=aggregate_version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, id3],
      ),
    );
    const resume = await command(id3, "resume", "po-resume", 4);
    assert.equal(resume.status, 200);
    await db.pool.query(
      "UPDATE procurement.purchase_orders SET receipt_state='PARTIALLY_RECEIVED',committed_receipt_count=1,received_quantities=jsonb_build_object('1',1),remaining_quantities=jsonb_build_object('1',1),aggregate_version=aggregate_version+1 WHERE tenant_id=$1 AND id=$2",
      [tenant, id3],
    );
    const amendReceived = await command(id3, "amend", "po-amend-received", 6, {
      terms: { changed: true },
    });
    assert.equal(amendReceived.status, 422);
    const shortClose = await command(
      id3,
      "close-remainder",
      "po-close-remainder",
      6,
    );
    assert.equal(shortClose.status, 200, await shortClose.text());
    const remainderEvent = await db.pool.query(
      "SELECT payload FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='PO.REMAINDER_CLOSED'",
      [tenant, id3],
    );
    assert.deepEqual(
      remainderEvent.rows[0]!.payload.payload.received_quantities,
      { "1": 1 },
    );
    assert.deepEqual(
      remainderEvent.rows[0]!.payload.payload.remaining_quantities,
      { "1": 1 },
    );
    const closed = (
      (await (await get("/api/v1/purchase-orders/" + id3)).json()) as {
        data: { lifecycle_state: string; receipt_state: string };
      }
    ).data;
    assert.equal(closed.lifecycle_state, "CLOSED");
    assert.equal(closed.receipt_state, "PARTIALLY_RECEIVED");

    const receiptCancelId = await create("po-receipt-cancel-create");
    assert.equal(
      (await command(receiptCancelId, "issue", "po-receipt-cancel-issue", 1))
        .status,
      200,
    );
    await db.pool.query(
      "UPDATE procurement.purchase_orders SET receipt_state='PARTIALLY_RECEIVED',committed_receipt_count=1,aggregate_version=aggregate_version+1 WHERE tenant_id=$1 AND id=$2",
      [tenant, receiptCancelId],
    );
    const cancelReceived = await command(
      receiptCancelId,
      "cancel",
      "po-cancel-after-receipt",
      3,
    );
    assert.equal(cancelReceived.status, 422);

    const fullId = await create("po-full-close-create");
    assert.equal(
      (await command(fullId, "issue", "po-full-close-issue", 1)).status,
      200,
    );
    await db.pool.query(
      "UPDATE procurement.purchase_orders SET receipt_state='FULLY_RECEIVED',committed_receipt_count=2,aggregate_version=aggregate_version+1 WHERE tenant_id=$1 AND id=$2",
      [tenant, fullId],
    );
    const fullClose = await command(fullId, "close", "po-full-close", 3);
    assert.equal(fullClose.status, 200, await fullClose.text());

    const ineligibleSupplier = randomUUID();
    await db.pool.query(
      "INSERT INTO procurement.suppliers(id,tenant_id,code,legal_name,state,created_by) VALUES($1,$2,'PO-SUP-2','Prospect Supplier','PROSPECT','test')",
      [ineligibleSupplier, tenant],
    );
    const ineligibleId = await create(
      "po-ineligible-create",
      makeBody({ supplier_id: ineligibleSupplier }),
    );
    const ineligibleIssue = await command(
      ineligibleId,
      "issue",
      "po-ineligible-issue",
      1,
    );
    assert.equal(ineligibleIssue.status, 422);

    const raceId = await create("po-race-create");
    const race = await Promise.all([
      command(raceId, "update-draft", "po-race-update", 1, {
        lines: [{ description: "Changed", quantity: 1, unit_price: 75 }],
      }),
      command(raceId, "issue", "po-race-issue", 1),
    ]);
    assert.equal(race.filter((response) => response.status === 200).length, 1);
    assert.equal(
      race.filter(
        (response) => response.status === 409 || response.status === 422,
      ).length,
      1,
    );

    const raceId2 = await create("po-amend-cancel-create");
    assert.equal(
      (await command(raceId2, "issue", "po-amend-cancel-issue", 1)).status,
      200,
    );
    const amendCancel = await Promise.all([
      command(raceId2, "amend", "po-amend-race", 2, {
        terms: { offer: "updated" },
      }),
      command(raceId2, "cancel", "po-cancel-race", 2),
    ]);
    assert.equal(
      amendCancel.filter((response) => response.status === 200).length,
      1,
    );
    assert.equal(
      amendCancel.filter(
        (response) => response.status === 409 || response.status === 422,
      ).length,
      1,
    );

    const outbox = await db.pool.query(
      "SELECT count(*) FROM platform.outbox_events WHERE tenant_id=$1 AND event_type LIKE 'PO.%'",
      [tenant],
    );
    const audit = await db.pool.query(
      "SELECT count(*) FROM audit.audit_events WHERE tenant_id=$1 AND event_type LIKE 'PO.%'",
      [tenant],
    );
    assert.ok(Number(outbox.rows[0]!.count) >= 8);
    assert.ok(Number(audit.rows[0]!.count) >= 8);
    actorTenant = "tenant-other";
    assert.equal((await get("/api/v1/purchase-orders/" + id3)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
