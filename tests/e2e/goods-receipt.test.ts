import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { processGoodsReceiptAssetizationUnit } from "../../apps/worker/src/goods-receipt-assetizer.js";
import { goodsReceiptAssetizerTask } from "../../apps/worker/src/goods-receipt-assetizer.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";
import { readPostedAcceptedQuantitiesForMatching } from "../../modules/procurement/index.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("TASK-073 posts immutable receipts, serializes PO quantity and assetizes received units", async () => {
  const db = await testDatabase();
  const tenant = "tenant-goods-receipt";
  const supplier = randomUUID();
  const operator = randomUUID();
  const location = randomUUID();
  const category = randomUUID();
  const model = randomUUID();
  await db.pool.query(
    "INSERT INTO procurement.suppliers(id,tenant_id,code,legal_name,state,created_by) VALUES($1,$2,'GR-SUP-1','Receipt Supplier','APPROVED','test')",
    [supplier, tenant],
  );
  await db.pool.query(
    "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,$2,'GR-REC','Goods Receiving','STORAGE')",
    [location, tenant],
  );
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Receipt devices')",
    [category, tenant],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Example','Receipt model',$3)",
    [model, tenant, category],
  );
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
        return { id: operator, tenant_id: tenant, actor_type: "USER" };
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
  const makePo = async (key: string, quantity: number, tracked = false) => {
    const response = await post("/api/v1/purchase-orders", key, {
      supplier_id: supplier,
      currency: "USD",
      reason: "Test receipt PO",
      lines: [
        {
          item_type: tracked ? "ASSET_TRACKED" : "GOODS",
          item_reference_id: tracked ? model : null,
          description: tracked ? "Tracked device" : "Goods",
          quantity,
          unit_price: 10,
        },
      ],
    });
    assert.equal(response.status, 201, await response.clone().text());
    const poId = ((await response.json()) as { data: { id: string } }).data.id;
    const issue = await post(
      `/api/v1/purchase-orders/${poId}/commands/issue`,
      `${key}-issue`,
      { expected_version: 1, reason: "Issue for receiving" },
    );
    assert.equal(issue.status, 200, await issue.clone().text());
    const line = await db.pool.query<{ id: string }>(
      "SELECT id FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=1",
      [tenant, poId],
    );
    return { id: poId, lineId: line.rows[0]!.id };
  };
  const createReceipt = async (
    key: string,
    po: { id: string; lineId: string },
    received: number,
    options: {
      units?: object[];
      exceptions?: object[];
      tracked?: boolean;
    } = {},
  ) => {
    const response = await post("/api/v1/goods-receipts", key, {
      purchase_order_id: po.id,
      location_id: location,
      lines: [
        {
          purchase_order_line_id: po.lineId,
          observed_quantity: received,
          accepted_quantity: received,
          units: options.units ?? [],
        },
      ],
      exceptions: options.exceptions ?? [],
    });
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { data: { id: string } }).data.id;
  };
  const postReceipt = (id: string, key: string, version = 1) =>
    post(`/api/v1/goods-receipts/${id}/commands/post`, key, {
      expected_version: version,
    });

  try {
    const po = await makePo("gr-po-partial", 10);
    const first = await createReceipt("gr-first", po, 8);
    const firstPost = await postReceipt(first, "gr-first-post");
    assert.equal(firstPost.status, 200, await firstPost.clone().text());
    assert.equal(
      (
        (await firstPost.json()) as {
          data: { purchase_order_progress: { receipt_state: string } };
        }
      ).data.purchase_order_progress.receipt_state,
      "PARTIALLY_RECEIVED",
    );
    assert.equal((await postReceipt(first, "gr-first-post")).status, 200);
    assert.equal((await postReceipt(first, "gr-first-post", 2)).status, 409);
    const postedCancel = await post(
      `/api/v1/goods-receipts/${first}/commands/cancel`,
      "gr-posted-cancel",
      { expected_version: 2, reason: "Attempt to cancel posted fact" },
    );
    assert.equal(postedCancel.status, 422);
    await assert.rejects(
      db.pool.query(
        "UPDATE procurement.goods_receipts SET state='DRAFT' WHERE tenant_id=$1 AND id=$2",
        [tenant, first],
      ),
    );
    const second = await createReceipt("gr-second", po, 2);
    const secondPost = await postReceipt(second, "gr-second-post");
    assert.equal(secondPost.status, 200, await secondPost.clone().text());
    assert.equal(
      (
        (await secondPost.json()) as {
          data: { purchase_order_progress: { receipt_state: string } };
        }
      ).data.purchase_order_progress.receipt_state,
      "FULLY_RECEIVED",
    );
    const counters = await db.pool.query<{ count: string; accepted: number }>(
      "SELECT committed_receipt_count AS count,(received_quantities->>$3)::numeric AS accepted FROM procurement.purchase_orders WHERE tenant_id=$1 AND id=$2",
      [tenant, po.id, po.lineId],
    );
    assert.equal(Number(counters.rows[0]!.count), 2);
    assert.equal(Number(counters.rows[0]!.accepted), 10);

    const rejectedPo = await makePo("gr-po-rejected-units", 2);
    const rejectedReceiptResponse = await post(
      "/api/v1/goods-receipts",
      "gr-rejected-units",
      {
        purchase_order_id: rejectedPo.id,
        location_id: location,
        lines: [
          {
            purchase_order_line_id: rejectedPo.lineId,
            observed_quantity: 2,
            accepted_quantity: 1,
            rejected_or_damaged_quantity: 1,
            units: [],
          },
        ],
      },
    );
    assert.equal(rejectedReceiptResponse.status, 201);
    const rejectedReceipt = (
      (await rejectedReceiptResponse.json()) as { data: { id: string } }
    ).data.id;
    assert.equal(
      (await postReceipt(rejectedReceipt, "gr-rejected-units-post")).status,
      200,
    );
    const acceptedOnly = await db.pool.query(
      "SELECT (received_quantities->>$3)::numeric AS accepted,receipt_state FROM procurement.purchase_orders WHERE tenant_id=$1 AND id=$2",
      [tenant, rejectedPo.id, rejectedPo.lineId],
    );
    assert.equal(Number(acceptedOnly.rows[0]!.accepted), 1);
    assert.equal(acceptedOnly.rows[0]!.receipt_state, "PARTIALLY_RECEIVED");

    const overPo = await makePo("gr-po-over", 2);
    const over = await createReceipt("gr-over", overPo, 3);
    const overResponse = await postReceipt(over, "gr-over-post");
    assert.equal(overResponse.status, 422);
    assert.equal(
      ((await overResponse.json()) as { error: { code: string } }).error.code,
      "GOODS_RECEIPT_OVER_ORDERED_QUANTITY",
    );
    const unchanged = await db.pool.query(
      "SELECT state FROM procurement.goods_receipts WHERE tenant_id=$1 AND id=$2",
      [tenant, over],
    );
    assert.equal(unchanged.rows[0]!.state, "DRAFT");
    const overPoUnchanged = await db.pool.query(
      "SELECT receipt_state,committed_receipt_count,received_quantities FROM procurement.purchase_orders WHERE tenant_id=$1 AND id=$2",
      [tenant, overPo.id],
    );
    assert.equal(overPoUnchanged.rows[0]!.receipt_state, "NOT_RECEIVED");
    assert.equal(overPoUnchanged.rows[0]!.committed_receipt_count, 0);
    assert.deepEqual(overPoUnchanged.rows[0]!.received_quantities, {});
    const noPartialEffects = await db.pool.query(
      "SELECT (SELECT count(*) FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='GOODS_RECEIPT.POSTED' AND aggregate_id=$2)::int AS outbox_count,(SELECT count(*) FROM audit.audit_events WHERE tenant_id=$1 AND event_type='GOODS_RECEIPT.POSTED' AND subject->>'entity_id'=$2)::int AS audit_count",
      [tenant, over],
    );
    assert.equal(noPartialEffects.rows[0]!.outbox_count, 0);
    assert.equal(noPartialEffects.rows[0]!.audit_count, 0);
    const matchingIgnoresDraft = await db.uow.run(tenant, (tx) =>
      readPostedAcceptedQuantitiesForMatching(tx, overPo.id),
    );
    assert.equal(Number(matchingIgnoresDraft[0]!.posted_accepted_quantity), 0);
    assert.deepEqual(matchingIgnoresDraft[0]!.posted_receipts, []);

    const racePo = await makePo("gr-po-race", 10);
    const seed = await createReceipt("gr-race-seed", racePo, 8);
    assert.equal((await postReceipt(seed, "gr-race-seed-post")).status, 200);
    const raceA = await createReceipt("gr-race-a", racePo, 2);
    const raceB = await createReceipt("gr-race-b", racePo, 2);
    const race = await Promise.all([
      postReceipt(raceA, "gr-race-a-post"),
      postReceipt(raceB, "gr-race-b-post"),
    ]);
    assert.equal(race.filter((r) => r.status === 200).length, 1);
    assert.equal(race.filter((r) => r.status === 422).length, 1);
    const raceQty = await db.pool.query(
      "SELECT (received_quantities->>$3)::numeric AS accepted FROM procurement.purchase_orders WHERE tenant_id=$1 AND id=$2",
      [tenant, racePo.id, racePo.lineId],
    );
    assert.equal(Number(raceQty.rows[0]!.accepted), 10);

    const draftPoResponse = await post(
      "/api/v1/purchase-orders",
      "gr-po-draft",
      {
        supplier_id: supplier,
        currency: "USD",
        reason: "Draft PO is ineligible for receiving",
        lines: [{ description: "Draft goods", quantity: 1, unit_price: 1 }],
      },
    );
    assert.equal(draftPoResponse.status, 201);
    const draftPoId = (
      (await draftPoResponse.json()) as { data: { id: string } }
    ).data.id;
    const draftReceiptAttempt = await post(
      "/api/v1/goods-receipts",
      "gr-receive-draft-po",
      { purchase_order_id: draftPoId, location_id: location, lines: [] },
    );
    assert.equal(draftReceiptAttempt.status, 409);
    assert.equal(
      ((await draftReceiptAttempt.json()) as { error: { code: string } }).error
        .code,
      "GOODS_RECEIPT_PO_NOT_RECEIVABLE",
    );

    const holdPo = await makePo("gr-po-held", 2);
    const heldReceipt = await createReceipt("gr-held", holdPo, 1);
    assert.equal(
      (
        await post(
          `/api/v1/purchase-orders/${holdPo.id}/commands/hold`,
          "gr-hold-po",
          { expected_version: 2, reason: "Pause receiving" },
        )
      ).status,
      200,
    );
    const heldPost = await postReceipt(heldReceipt, "gr-held-post");
    assert.equal(heldPost.status, 409);
    assert.equal(
      ((await heldPost.json()) as { error: { code: string } }).error.code,
      "GOODS_RECEIPT_PO_NOT_RECEIVABLE",
    );

    const cancelledPo = await makePo("gr-po-cancelled", 1);
    const cancelledReceipt = await createReceipt(
      "gr-cancelled-po-receipt",
      cancelledPo,
      1,
    );
    assert.equal(
      (
        await post(
          `/api/v1/purchase-orders/${cancelledPo.id}/commands/cancel`,
          "gr-cancel-po",
          { expected_version: 2, reason: "Supplier withdrew before receipt" },
        )
      ).status,
      200,
    );
    assert.equal(
      (await postReceipt(cancelledReceipt, "gr-cancelled-po-post")).status,
      409,
    );

    const shortClosePo = await makePo("gr-po-closed", 2);
    const shortCloseSeed = await createReceipt(
      "gr-po-closed-seed",
      shortClosePo,
      1,
    );
    assert.equal(
      (await postReceipt(shortCloseSeed, "gr-po-closed-seed-post")).status,
      200,
    );
    const closedReceipt = await createReceipt(
      "gr-po-closed-pending",
      shortClosePo,
      1,
    );
    assert.equal(
      (
        await post(
          `/api/v1/purchase-orders/${shortClosePo.id}/commands/close-remainder`,
          "gr-po-closed-short-close",
          { expected_version: 3, reason: "Supplier cannot fulfill balance" },
        )
      ).status,
      200,
    );
    const closedPost = await postReceipt(closedReceipt, "gr-closed-post");
    assert.equal(closedPost.status, 409);
    assert.equal(
      ((await closedPost.json()) as { error: { code: string } }).error.code,
      "GOODS_RECEIPT_PO_NOT_RECEIVABLE",
    );

    for (const action of ["cancel", "hold", "amend"] as const) {
      const conflictPo = await makePo(`gr-po-vs-${action}`, 2);
      const conflictReceipt = await createReceipt(
        `gr-receipt-vs-${action}`,
        conflictPo,
        1,
      );
      const poCommand = post(
        `/api/v1/purchase-orders/${conflictPo.id}/commands/${action}`,
        `gr-po-${action}-race`,
        {
          expected_version: 2,
          reason: `Compete receipt posting with PO ${action}`,
          ...(action === "amend" ? { terms: { revised: true } } : {}),
        },
      );
      const [poResponse, receiptResponse] = await Promise.all([
        poCommand,
        postReceipt(conflictReceipt, `gr-receipt-${action}-race`),
      ]);
      assert.equal(
        [poResponse, receiptResponse].filter(
          (response) => response.status === 200,
        ).length,
        1,
        `PO.${action.toUpperCase()} vs GOODS_RECEIPT.POST`,
      );
    }

    const closePo = await makePo("gr-po-close-race", 2);
    const partialBeforeClose = await createReceipt(
      "gr-po-close-partial",
      closePo,
      1,
    );
    assert.equal(
      (await postReceipt(partialBeforeClose, "gr-po-close-partial-post"))
        .status,
      200,
    );
    const closeRaceReceipt = await createReceipt(
      "gr-po-close-competing-receipt",
      closePo,
      1,
    );
    const closeRace = await Promise.all([
      post(
        `/api/v1/purchase-orders/${closePo.id}/commands/close-remainder`,
        "gr-po-close-race-command",
        { expected_version: 3, reason: "Short close remainder" },
      ),
      postReceipt(closeRaceReceipt, "gr-po-close-race-post"),
    ]);
    assert.equal(
      closeRace.filter((response) => response.status === 200).length,
      1,
      "PO.CLOSE_REMAINDER vs GOODS_RECEIPT.POST",
    );

    const assetPo = await makePo("gr-po-asset", 1, true);
    const unitId = randomUUID();
    const assetReceipt = await createReceipt("gr-asset", assetPo, 1, {
      tracked: true,
      units: [
        {
          id: unitId,
          identity_type: "SERIAL",
          identity_value: "SERIAL-GR-001",
          serial_number: "SERIAL-GR-001",
        },
      ],
    });
    const assetPost = await postReceipt(assetReceipt, "gr-asset-post");
    assert.equal(assetPost.status, 200, await assetPost.clone().text());
    const envelope = await db.pool.query<{ payload: never }>(
      "SELECT payload FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='GOODS_RECEIPT.POSTED'",
      [tenant, assetReceipt],
    );
    const event = {
      ...(envelope.rows[0]!.payload as Record<string, unknown>),
      published_at: new Date().toISOString(),
    } as never;
    await processGoodsReceiptAssetizationUnit(db.uow, event, unitId);
    await processGoodsReceiptAssetizationUnit(db.uow, event, unitId);
    const registered = await db.pool.query(
      "SELECT a.lifecycle_state,a.assignment_state,a.current_location_id,count(r.received_unit_id)::int AS registration_count FROM asset.received_unit_registrations r JOIN asset.assets a ON a.tenant_id=r.tenant_id AND a.id=r.asset_id WHERE r.tenant_id=$1 AND r.received_unit_id=$2 GROUP BY a.id",
      [tenant, unitId],
    );
    assert.equal(registered.rows[0]!.lifecycle_state, "RECEIVED");
    assert.equal(registered.rows[0]!.assignment_state, "UNASSIGNED");
    assert.equal(registered.rows[0]!.current_location_id, location);
    assert.equal(registered.rows[0]!.registration_count, 1);
    const assetEvents = await db.pool.query(
      "SELECT count(*) FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='ASSET.CREATED' AND payload->'payload'->>'received_unit_id'=$2",
      [tenant, unitId],
    );
    assert.equal(Number(assetEvents.rows[0]!.count), 1);

    const existingDuplicateSerial = "DUPLICATE-ASSET-SERIAL";
    await db.pool.query(
      "INSERT INTO asset.assets(id,tenant_id,asset_code,serial_number,asset_model_id,current_location_id) VALUES($1,$2,'EXISTING-GR-ASSET',$3,$4,$5)",
      [randomUUID(), tenant, existingDuplicateSerial, model, location],
    );
    const duplicateAssetPo = await makePo("gr-po-existing-asset", 1, true);
    const duplicateUnitId = randomUUID();
    const duplicateAssetReceipt = await createReceipt(
      "gr-existing-asset",
      duplicateAssetPo,
      1,
      {
        units: [
          {
            id: duplicateUnitId,
            serial_number: existingDuplicateSerial,
            identity_value: existingDuplicateSerial,
          },
        ],
      },
    );
    assert.equal(
      (await postReceipt(duplicateAssetReceipt, "gr-existing-asset-post"))
        .status,
      200,
    );
    const assetizerController = new AbortController();
    const assetizer = goodsReceiptAssetizerTask({ pool: db.pool, uow: db.uow });
    const workerRun = assetizer.run(assetizerController.signal);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assetizerController.abort();
    await workerRun;
    const assetizationFailure = await db.pool.query(
      "SELECT status,failure_code FROM procurement.receipt_assetization_state WHERE tenant_id=$1 AND received_unit_id=$2",
      [tenant, duplicateUnitId],
    );
    assert.equal(assetizationFailure.rows[0]!.status, "FAILED");
    const failureWork = await db.pool.query(
      "SELECT id FROM operations.work_items WHERE tenant_id=$1 AND source_type='ASSET_LIFECYCLE' AND source_id=$2",
      [tenant, duplicateUnitId],
    );
    assert.equal(failureWork.rowCount, 1);
    const physicalReceipt = await db.pool.query(
      "SELECT state FROM procurement.goods_receipts WHERE tenant_id=$1 AND id=$2",
      [tenant, duplicateAssetReceipt],
    );
    assert.equal(physicalReceipt.rows[0]!.state, "POSTED");
    const visibleFailure = await get(
      `/api/v1/goods-receipts/${duplicateAssetReceipt}`,
    );
    const visibleFailureBody = (await visibleFailure.json()) as {
      data: { assetization: Array<{ status: string; failure_code: string }> };
    };
    assert.equal(visibleFailureBody.data.assetization[0]!.status, "FAILED");
    assert.equal(
      visibleFailureBody.data.assetization[0]!.failure_code,
      "BUSINESS_RULE_VIOLATION",
    );

    const draftPo = await makePo("gr-po-cancel", 1);
    const draftReceipt = await createReceipt("gr-cancel", draftPo, 1);
    deniedPermission = "goods_receipt.read";
    assert.equal(
      (await get(`/api/v1/goods-receipts/${draftReceipt}`)).status,
      403,
    );
    deniedPermission = "goods_receipt.update";
    assert.equal(
      (
        await post(
          `/api/v1/goods-receipts/${draftReceipt}/commands/update-draft`,
          "gr-deny-update",
          { expected_version: 1, lines: [] },
        )
      ).status,
      403,
    );
    deniedPermission = "goods_receipt.post";
    assert.equal((await postReceipt(draftReceipt, "gr-deny-post")).status, 403);
    deniedPermission = "goods_receipt.cancel";
    assert.equal(
      (
        await post(
          `/api/v1/goods-receipts/${draftReceipt}/commands/cancel`,
          "gr-deny-cancel",
          { expected_version: 1, reason: "Permission test" },
        )
      ).status,
      403,
    );
    deniedPermission = null;
    const cancelled = await post(
      `/api/v1/goods-receipts/${draftReceipt}/commands/cancel`,
      "gr-cancel-command",
      { expected_version: 1, reason: "Delivery was entered in error" },
    );
    assert.equal(cancelled.status, 200, await cancelled.clone().text());

    const createDeniedPo = await makePo("gr-po-create-denied", 1);
    deniedPermission = "goods_receipt.create";
    const deniedCreate = await post(
      "/api/v1/goods-receipts",
      "gr-deny-create",
      {
        purchase_order_id: createDeniedPo.id,
        location_id: location,
        lines: [
          {
            purchase_order_line_id: createDeniedPo.lineId,
            observed_quantity: 1,
            accepted_quantity: 1,
            units: [],
          },
        ],
      },
    );
    assert.equal(deniedCreate.status, 403);
    deniedPermission = null;

    const exceptionPo = await makePo("gr-po-exception", 1);
    const exceptionReceipt = await createReceipt(
      "gr-exception",
      exceptionPo,
      1,
      {
        exceptions: [
          {
            exception_type: "IDENTITY_UNCERTAIN",
            reason: "Unit label is unclear",
          },
        ],
      },
    );
    const workItem = await db.pool.query(
      "SELECT id FROM operations.work_items WHERE tenant_id=$1 AND source_type='GOODS_RECEIPT' AND source_id=$2",
      [tenant, exceptionReceipt],
    );
    assert.equal(workItem.rowCount, 1);
    const blocked = await postReceipt(exceptionReceipt, "gr-exception-post");
    assert.equal(blocked.status, 422);
    assert.equal(
      ((await blocked.json()) as { error: { code: string } }).error.code,
      "GOODS_RECEIPT_BLOCKING_EXCEPTION",
    );
    const updated = await post(
      `/api/v1/goods-receipts/${exceptionReceipt}/commands/update-draft`,
      "gr-exception-update",
      {
        expected_version: 1,
        lines: [
          {
            purchase_order_line_id: exceptionPo.lineId,
            observed_quantity: 1,
            accepted_quantity: 1,
            units: [],
          },
        ],
        exceptions: [],
      },
    );
    assert.equal(updated.status, 200, await updated.clone().text());
    const resolvedWork = await db.pool.query(
      "SELECT state FROM operations.work_items WHERE tenant_id=$1 AND source_type='GOODS_RECEIPT' AND source_id=$2",
      [tenant, exceptionReceipt],
    );
    assert.equal(resolvedWork.rows[0]!.state, "RESOLVED");
    assert.equal(
      (await postReceipt(exceptionReceipt, "gr-exception-post-corrected", 2))
        .status,
      200,
    );

    const duplicatePo = await makePo("gr-po-duplicate", 2, true);
    const duplicate = await post(
      "/api/v1/goods-receipts",
      "gr-duplicate-unit",
      {
        purchase_order_id: duplicatePo.id,
        location_id: location,
        lines: [
          {
            purchase_order_line_id: duplicatePo.lineId,
            observed_quantity: 2,
            accepted_quantity: 2,
            units: [
              { serial_number: "SAME-GR", identity_value: "SAME-GR" },
              { serial_number: "same-gr", identity_value: "same-gr" },
            ],
          },
        ],
      },
    );
    assert.equal(duplicate.status, 409);
    assert.equal(
      ((await duplicate.json()) as { error: { code: string } }).error.code,
      "GOODS_RECEIPT_UNIT_IDENTITY_DUPLICATE",
    );
    const audit = await db.pool.query(
      "SELECT count(*) FROM audit.audit_events WHERE tenant_id=$1 AND event_type='GOODS_RECEIPT.POSTED'",
      [tenant],
    );
    const postedCount = await db.pool.query(
      "SELECT count(*) FROM procurement.goods_receipts WHERE tenant_id=$1 AND state='POSTED'",
      [tenant],
    );
    assert.equal(
      Number(audit.rows[0]!.count),
      Number(postedCount.rows[0]!.count),
    );
    const timeline = await get(`/api/v1/goods-receipts/${first}/timeline`);
    assert.equal(timeline.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
