import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  processCostProvenanceEvent,
  recordCostProvenanceRetryFailure,
} from "../../apps/worker/src/cost-provenance.js";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import type { EventEnvelope } from "../../packages/event-contracts/src/index.js";
import { recordCostProvenance } from "../../modules/procurement/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("TASK-076 links a received Asset to immutable PO cost and deduplicates event redelivery", async () => {
  const db = await testDatabase();
  const tenant = `tenant-task076-cost-${randomUUID()}`;
  const supplierId = randomUUID();
  const requesterId = randomUUID();
  const procurementRequestId = randomUUID();
  const poId = randomUUID();
  const poLineId = randomUUID();
  const receiptId = randomUUID();
  const receiptLineId = randomUUID();
  const receivedUnitId = randomUUID();
  const assetId = randomUUID();
  const extraReceivedUnits = [randomUUID(), randomUUID()];
  const extraAssetIds = [randomUUID(), randomUUID()];
  const locationId = randomUUID();
  const categoryId = randomUUID();
  const modelId = randomUUID();
  const eventId = randomUUID();
  const invoiceId = randomUUID();
  const invoiceLineId = randomUUID();
  const evaluationId = randomUUID();
  const invoiceAllocationId = randomUUID();
  const creditNoteId = randomUUID();
  const creditLineId = randomUUID();
  const creditApplicationId = randomUUID();
  const creditReleaseId = randomUUID();
  const contractId = randomUUID();
  const contractVersionId = randomUUID();
  const productId = randomUUID();
  const entitlementId = randomUUID();
  let api: Server | undefined;
  const poSnapshot = {
    supplier_id: supplierId,
    currency: "USD",
    lines: [{ description: "Tracked device", quantity: 3, unit_price: 1250 }],
  };
  const fingerprint = "b".repeat(64);
  try {
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,$2,'T076-REQUESTER','task076-requester','TASK-076 Requester','ACTIVE')",
        [requesterId, tenant],
      );
      await tx.query(
        "INSERT INTO procurement.suppliers(id,tenant_id,code,legal_name,state,created_by) VALUES($1,$2,'T076-COST-SUP','Cost Supplier','APPROVED','test')",
        [supplierId, tenant],
      );
      await tx.query(
        "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,$2,'T076-LOC','Receiving','STORAGE')",
        [locationId, tenant],
      );
      await tx.query(
        "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'T076 Category')",
        [categoryId, tenant],
      );
      await tx.query(
        "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Example','T076 Model',$3)",
        [modelId, tenant, categoryId],
      );
      await tx.query(
        `INSERT INTO procurement.procurement_requests(id,tenant_id,request_code,requester_user_id,source_type,state,business_reason,cost_center_id,target_date,estimated_total,currency,created_by)
         VALUES($1,$2,'T076-REQUEST',$3,'TEST','ORDERED','Phase 4 traceability fixture','IT-OPS',CURRENT_DATE,3750,'USD','test')`,
        [procurementRequestId, tenant, requesterId],
      );
      await tx.query(
        `INSERT INTO procurement.purchase_orders(id,tenant_id,code,procurement_request_id,supplier_id,lifecycle_state,receipt_state,committed_receipt_count,currency,draft_snapshot,current_commercial_version,created_by)
         VALUES($1,$2,'T076-PO',$3,$4,'ISSUED','FULLY_RECEIVED',1,'USD','{}',1,'test')`,
        [poId, tenant, procurementRequestId, supplierId],
      );
      await tx.query(
        `INSERT INTO procurement.purchase_order_versions(tenant_id,purchase_order_id,commercial_version,base_aggregate_version,snapshot,snapshot_hash,reason,actor_id,correlation_id)
         VALUES($1,$2,1,1,$3,$4,'Test cost provenance','test','task076')`,
        [tenant, poId, JSON.stringify(poSnapshot), fingerprint],
      );
      await tx.query(
        `INSERT INTO procurement.purchase_order_lines(id,tenant_id,purchase_order_id,commercial_version,line_no,item_type,item_reference_id,description,quantity,unit_price,total)
         VALUES($1,$2,$3,1,1,'ASSET_TRACKED',$4,'Tracked device',3,1250,3750)`,
        [poLineId, tenant, poId, modelId],
      );
      await tx.query(
        `INSERT INTO procurement.goods_receipts(id,tenant_id,receipt_code,state,aggregate_version,purchase_order_id,purchase_order_code_snapshot,purchase_order_commercial_version,supplier_id,supplier_display_snapshot,location_id,receiving_actor_id,received_at,correlation_id)
         VALUES($1,$2,'T076-GR','DRAFT',1,$3,'T076-PO',1,$4,'Cost Supplier',$5,'test',now(),'task076')`,
        [receiptId, tenant, poId, supplierId, locationId],
      );
      await tx.query(
        `INSERT INTO procurement.goods_receipt_lines(id,tenant_id,goods_receipt_id,purchase_order_id,purchase_order_line_id,commercial_version,ordered_quantity_snapshot,observed_quantity,accepted_quantity,item_type,item_reference_id,description_snapshot)
         VALUES($1,$2,$3,$4,$5,1,3,3,3,'ASSET_TRACKED',$6,'Tracked device')`,
        [receiptLineId, tenant, receiptId, poId, poLineId, modelId],
      );
      const unitRows = [receivedUnitId, ...extraReceivedUnits];
      const assetRows = [assetId, ...extraAssetIds];
      for (let index = 0; index < unitRows.length; index++) {
        const unitId = unitRows[index]!;
        const registeredAssetId = assetRows[index]!;
        const serial = `T076-SERIAL-${index}`;
        await tx.query(
          `INSERT INTO procurement.goods_receipt_units(id,tenant_id,goods_receipt_id,goods_receipt_line_id,identity_type,identity_value,serial_number,accepted)
           VALUES($1,$2,$3,$4,'SERIAL',$5,$5,true)`,
          [unitId, tenant, receiptId, receiptLineId, serial],
        );
        await tx.query(
          "INSERT INTO asset.assets(id,tenant_id,asset_code,serial_number,asset_model_id,lifecycle_state,current_location_id) VALUES($1,$2,$3,$4,$5,'RECEIVED',$6)",
          [
            registeredAssetId,
            tenant,
            `T076-ASSET-${index}`,
            serial,
            modelId,
            locationId,
          ],
        );
        await tx.query(
          "INSERT INTO asset.received_unit_registrations(tenant_id,received_unit_id,asset_id,goods_receipt_id,asset_model_id,serial_number) VALUES($1,$2,$3,$4,$5,$6)",
          [tenant, unitId, registeredAssetId, receiptId, modelId, serial],
        );
      }
      await tx.query(
        "UPDATE procurement.goods_receipts SET state='POSTED',aggregate_version=2,posted_at=now(),immutable_posted_snapshot='{}' WHERE tenant_id=$1 AND id=$2",
        [tenant, receiptId],
      );
    });
    const event: EventEnvelope = {
      event_id: eventId,
      event_type: "ASSET.CREATED",
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      producer: { service: "test", instance: "task076" },
      aggregate: { type: "ASSET", id: assetId, version: 1 },
      actor: { type: "SYSTEM", id: "test" },
      correlation_id: "task076-cost-test",
      causation_id: "test-source",
      tenant_id: tenant,
      organization_id: tenant,
      idempotency_key: `asset:${receivedUnitId}`,
      payload: {
        asset_id: assetId,
        received_unit_id: receivedUnitId,
        goods_receipt_id: receiptId,
      },
    };
    await processCostProvenanceEvent(db.uow, event);
    await processCostProvenanceEvent(db.uow, event);
    const provenance = await db.pool.query(
      `SELECT source_type,source_document_id,source_document_version_ref,source_line_id,cost_basis,source_amount,source_currency,quantity_basis
         FROM procurement.cost_provenance WHERE tenant_id=$1 AND target_type='ASSET' AND target_id=$2`,
      [tenant, assetId],
    );
    assert.equal(provenance.rowCount, 1);
    assert.equal(provenance.rows[0]!.source_type, "PURCHASE_ORDER");
    assert.equal(provenance.rows[0]!.source_document_id, poId);
    assert.equal(provenance.rows[0]!.source_document_version_ref, `${poId}:v1`);
    assert.equal(provenance.rows[0]!.source_line_id, poLineId);
    assert.equal(provenance.rows[0]!.cost_basis, "COMMITTED");
    assert.equal(Number(provenance.rows[0]!.source_amount), 1250);
    assert.equal(provenance.rows[0]!.source_currency, "USD");
    const summary = await db.pool.query(
      "SELECT committed_amount,actual_amount,net_amount FROM procurement.cost_provenance_summary WHERE tenant_id=$1 AND target_id=$2",
      [tenant, assetId],
    );
    assert.equal(Number(summary.rows[0]!.committed_amount), 1250);
    assert.equal(summary.rows[0]!.actual_amount, null);
    assert.equal(Number(summary.rows[0]!.net_amount), 1250);

    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        `INSERT INTO procurement.invoices(id,tenant_id,invoice_code,supplier_id,supplier_display_snapshot,supplier_document_number_original,supplier_document_number_normalized,invoice_date,currency,tax_amount,charge_amount,gross_amount,purchase_order_id,purchase_order_code_snapshot,po_commercial_version,lifecycle_state,match_status,aggregate_version,duplicate_fingerprint,created_by,correlation_id)
         VALUES($1,$2,'T076-INV',$3,'Cost Supplier','T076-INVOICE','T076-INVOICE',CURRENT_DATE,'USD',0,0,3750,$4,'T076-PO',1,'DRAFT','NOT_EVALUATED',1,$5,'test','task076')`,
        [invoiceId, tenant, supplierId, poId, "d".repeat(64)],
      );
      await tx.query(
        `INSERT INTO procurement.invoice_lines(id,tenant_id,invoice_id,line_number,purchase_order_line_id,item_reference_id,description,quantity,unit,unit_price,line_total)
         VALUES($1,$2,$3,1,$4,$5,'Tracked device',3,'EA',1250,3750)`,
        [invoiceLineId, tenant, invoiceId, poLineId, modelId],
      );
      await tx.query(
        `UPDATE procurement.invoices SET lifecycle_state='SUBMITTED',aggregate_version=2,submitted_snapshot='{}',snapshot_fingerprint=$3,submitted_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenant, invoiceId, "c".repeat(64)],
      );
      await tx.query(
        `INSERT INTO procurement.invoice_match_evaluations(id,tenant_id,invoice_id,evaluation_version,invoice_snapshot_fingerprint,po_commercial_version,receipt_evidence_fingerprint,match_status,reason_codes,expected_values,observed_values,evaluation_fingerprint,correlation_id)
         VALUES($1,$2,$3,1,$4,1,$5,'MATCHED','[]','{}','{}',$6,'task076')`,
        [
          evaluationId,
          tenant,
          invoiceId,
          "c".repeat(64),
          "e".repeat(64),
          "f".repeat(64),
        ],
      );
      await tx.query(
        `INSERT INTO procurement.invoice_match_allocations(id,tenant_id,invoice_id,invoice_line_id,purchase_order_line_id,evaluation_id,allocation_type,goods_receipt_id,goods_receipt_line_id,quantity)
         VALUES($1,$2,$3,$4,$5,$6,'RECEIPT_MATCHED',$7,$8,3)`,
        [
          invoiceAllocationId,
          tenant,
          invoiceId,
          invoiceLineId,
          poLineId,
          evaluationId,
          receiptId,
          receiptLineId,
        ],
      );
      await tx.query(
        "UPDATE procurement.invoices SET match_status='MATCHED',current_match_evaluation_id=$3 WHERE tenant_id=$1 AND id=$2",
        [tenant, invoiceId, evaluationId],
      );
      await tx.query(
        "UPDATE procurement.invoices SET lifecycle_state='APPROVED',aggregate_version=3,approved_at=now() WHERE tenant_id=$1 AND id=$2",
        [tenant, invoiceId],
      );
      await tx.query(
        `INSERT INTO procurement.credit_notes(id,tenant_id,credit_note_code,supplier_id,supplier_display_snapshot,supplier_document_number_original,supplier_document_number_normalized,document_date,currency,total_amount,invoice_id,lifecycle_state,aggregate_version,duplicate_fingerprint,created_by,correlation_id)
         VALUES($1,$2,'T076-CN',$3,'Cost Supplier','T076-CREDIT','T076-CREDIT',CURRENT_DATE,'USD',100,$4,'DRAFT',1,$5,'test','task076')`,
        [creditNoteId, tenant, supplierId, invoiceId, "2".repeat(64)],
      );
      await tx.query(
        `INSERT INTO procurement.credit_note_lines(id,tenant_id,credit_note_id,invoice_id,invoice_line_id,line_number,credited_quantity,credited_amount)
         VALUES($1,$2,$3,$4,$5,1,1,100)`,
        [creditLineId, tenant, creditNoteId, invoiceId, invoiceLineId],
      );
      await tx.query(
        `UPDATE procurement.credit_notes SET lifecycle_state='SUBMITTED',aggregate_version=2,submitted_snapshot='{}',snapshot_fingerprint=$3,submitted_at=now() WHERE tenant_id=$1 AND id=$2`,
        [tenant, creditNoteId, "1".repeat(64)],
      );
      await tx.query(
        `INSERT INTO procurement.credit_note_applications(id,tenant_id,credit_note_id,invoice_id,actor_id,correlation_id)
         VALUES($1,$2,$3,$4,'test','task076')`,
        [creditApplicationId, tenant, creditNoteId, invoiceId],
      );
      await tx.query(
        `INSERT INTO procurement.credit_note_allocation_releases(id,tenant_id,application_id,credit_note_id,credit_note_line_id,invoice_id,invoice_line_id,allocation_id,released_quantity)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)`,
        [
          creditReleaseId,
          tenant,
          creditApplicationId,
          creditNoteId,
          creditLineId,
          invoiceId,
          invoiceLineId,
          invoiceAllocationId,
        ],
      );
      await tx.query(
        "UPDATE procurement.credit_notes SET lifecycle_state='APPLIED',aggregate_version=3,applied_at=now() WHERE tenant_id=$1 AND id=$2",
        [tenant, creditNoteId],
      );
    });
    const invoiceEvent = {
      ...event,
      event_id: randomUUID(),
      event_type: "INVOICE.APPROVED",
      aggregate: { type: "INVOICE", id: invoiceId, version: 3 },
      payload: { invoice_id: invoiceId },
    };
    await processCostProvenanceEvent(db.uow, invoiceEvent);
    const creditEvent = {
      ...event,
      event_id: randomUUID(),
      event_type: "CREDIT_NOTE.APPLIED",
      aggregate: { type: "CREDIT_NOTE", id: creditNoteId, version: 3 },
      payload: { credit_note_id: creditNoteId },
    };
    await processCostProvenanceEvent(db.uow, creditEvent);
    const lineage = await db.pool.query(
      `SELECT req.id AS request_id,s.id AS supplier_id,po.id AS purchase_order_id,
              gr.id AS goods_receipt_id,u.id AS received_unit_id,r.asset_id,
              i.id AS invoice_id,pol.id AS purchase_order_line_id,
              pol.commercial_version AS source_commercial_version,
              cp.source_document_version_ref AS provenance_source_version
         FROM procurement.cost_provenance cp
         JOIN asset.received_unit_registrations r ON r.tenant_id=cp.tenant_id AND r.asset_id=cp.target_id
         JOIN procurement.goods_receipt_units u ON u.tenant_id=r.tenant_id AND u.id=r.received_unit_id
         JOIN procurement.goods_receipt_lines gl ON gl.tenant_id=u.tenant_id AND gl.goods_receipt_id=u.goods_receipt_id AND gl.id=u.goods_receipt_line_id
         JOIN procurement.goods_receipts gr ON gr.tenant_id=gl.tenant_id AND gr.id=gl.goods_receipt_id
         JOIN procurement.purchase_orders po ON po.tenant_id=gr.tenant_id AND po.id=gr.purchase_order_id
         JOIN procurement.procurement_requests req ON req.tenant_id=po.tenant_id AND req.id=po.procurement_request_id
         JOIN procurement.suppliers s ON s.tenant_id=po.tenant_id AND s.id=po.supplier_id
         JOIN procurement.purchase_order_lines pol ON pol.tenant_id=gl.tenant_id AND pol.id=gl.purchase_order_line_id
         LEFT JOIN procurement.invoice_match_allocations ma ON ma.tenant_id=gl.tenant_id AND ma.purchase_order_line_id=pol.id AND ma.goods_receipt_line_id=gl.id
         LEFT JOIN procurement.invoices i ON i.tenant_id=ma.tenant_id AND i.id=ma.invoice_id AND i.lifecycle_state='APPROVED'
        WHERE cp.tenant_id=$1 AND cp.target_type='ASSET' AND cp.target_id=$2
          AND cp.source_type='PURCHASE_ORDER'`,
      [tenant, assetId],
    );
    assert.equal(lineage.rowCount, 1);
    assert.deepEqual(
      [
        lineage.rows[0]!.request_id,
        lineage.rows[0]!.supplier_id,
        lineage.rows[0]!.purchase_order_id,
        lineage.rows[0]!.goods_receipt_id,
        lineage.rows[0]!.received_unit_id,
        lineage.rows[0]!.asset_id,
        lineage.rows[0]!.invoice_id,
        lineage.rows[0]!.purchase_order_line_id,
        lineage.rows[0]!.source_commercial_version,
        lineage.rows[0]!.provenance_source_version,
      ],
      [
        procurementRequestId,
        supplierId,
        poId,
        receiptId,
        receivedUnitId,
        assetId,
        invoiceId,
        poLineId,
        1,
        `${poId}:v1`,
      ],
    );
    const financial = await db.pool.query(
      `SELECT target_id,cost_basis,source_type,source_amount,adjustment_direction FROM procurement.cost_provenance
        WHERE tenant_id=$1 AND target_type='ASSET' ORDER BY target_id,cost_basis`,
      [tenant],
    );
    assert.equal(financial.rowCount, 7);
    assert.equal(
      financial.rows.filter(
        (row) =>
          row.cost_basis === "COMMITTED" &&
          row.source_type === "PURCHASE_ORDER" &&
          Number(row.source_amount) === 1250,
      ).length,
      3,
    );
    assert.equal(
      financial.rows.filter(
        (row) =>
          row.cost_basis === "ACTUAL" &&
          row.source_type === "INVOICE" &&
          Number(row.source_amount) === 1250,
      ).length,
      3,
    );
    const creditAdjustment = financial.rows.filter(
      (row) => row.cost_basis === "ADJUSTMENT",
    );
    assert.equal(creditAdjustment.length, 1);
    assert.deepEqual(
      [
        creditAdjustment[0]!.source_type,
        Number(creditAdjustment[0]!.source_amount),
        creditAdjustment[0]!.adjustment_direction,
      ],
      ["CREDIT_NOTE", 100, "CREDIT"],
    );
    const firstReleasedUnit = await db.pool.query<{ asset_id: string }>(
      `SELECT r.asset_id FROM procurement.goods_receipt_units u
       JOIN asset.received_unit_registrations r ON r.tenant_id=u.tenant_id AND r.received_unit_id=u.id
       WHERE u.tenant_id=$1 AND u.goods_receipt_line_id=$2 AND u.accepted ORDER BY u.id LIMIT 1`,
      [tenant, receiptLineId],
    );
    assert.equal(
      creditAdjustment[0]!.target_id,
      firstReleasedUnit.rows[0]!.asset_id,
    );
    const net = await db.pool.query(
      "SELECT target_id,net_amount FROM procurement.cost_provenance_summary WHERE tenant_id=$1 AND target_type='ASSET' ORDER BY target_id",
      [tenant],
    );
    assert.deepEqual(
      net.rows.map((row) => [row.target_id, Number(row.net_amount)]),
      [assetId, ...extraAssetIds]
        .sort()
        .map((id) => [
          id,
          id === firstReleasedUnit.rows[0]!.asset_id ? 1150 : 1250,
        ]),
    );
    const beforeReplay = await db.pool.query(
      "SELECT count(*)::int AS count FROM procurement.cost_provenance WHERE tenant_id=$1 AND target_id=$2",
      [tenant, assetId],
    );
    await db.uow.run(tenant, (tx) =>
      recordCostProvenance({
        tx,
        actorId: "test",
        correlationId: "task076-replay",
        causationId: "same-invoice",
        value: {
          targetType: "ASSET",
          targetId: assetId,
          sourceType: "INVOICE",
          sourceDocumentId: invoiceId,
          sourceVersionRef: "c".repeat(64),
          sourceLineId: invoiceLineId,
          basis: "ACTUAL",
          amount: 1250,
          currency: "USD",
          quantity: 1,
          allocationMethod: "INVOICE_MATCH_UNIT_PRICE",
          allocationRole: `RECEIPT:${receiptLineId}:UNIT:${receivedUnitId}`,
        },
      }),
    );
    const afterReplay = await db.pool.query(
      "SELECT count(*)::int AS count FROM procurement.cost_provenance WHERE tenant_id=$1 AND target_id=$2",
      [tenant, assetId],
    );
    assert.equal(afterReplay.rows[0]!.count, beforeReplay.rows[0]!.count);
    const retryEvent = {
      ...event,
      event_id: randomUUID(),
      payload: {
        asset_id: assetId,
        received_unit_id: receivedUnitId,
        goods_receipt_id: receiptId,
      },
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      await recordCostProvenanceRetryFailure({
        uow: db.uow,
        event: retryEvent,
        failureCode: "COST_PROVENANCE_LINK_FAILED",
      });
    }
    const exhausted = await db.pool.query(
      "SELECT attempt_count,status,failure_code FROM procurement.cost_provenance_retries WHERE tenant_id=$1 AND event_id=$2",
      [tenant, retryEvent.event_id],
    );
    assert.deepEqual(exhausted.rows[0], {
      attempt_count: 5,
      status: "FAILED",
      failure_code: "COST_PROVENANCE_LINK_FAILED",
    });
    const fallback = await db.pool.query(
      "SELECT title FROM operations.work_items WHERE tenant_id=$1 AND source_type='COST_PROVENANCE' AND source_id=$2",
      [tenant, retryEvent.event_id],
    );
    assert.equal(fallback.rowCount, 1);
    assert.match(String(fallback.rows[0]!.title), /failed after 5 attempts/);
    await processCostProvenanceEvent(db.uow, retryEvent);
    const clearedRetry = await db.pool.query(
      "SELECT 1 FROM procurement.cost_provenance_retries WHERE tenant_id=$1 AND event_id=$2",
      [tenant, retryEvent.event_id],
    );
    assert.equal(clearedRetry.rowCount, 0);
    const stillSingle = await db.pool.query(
      "SELECT count(*)::int AS count FROM procurement.cost_provenance WHERE tenant_id=$1 AND target_id=$2",
      [tenant, assetId],
    );
    assert.equal(stillSingle.rows[0]!.count, beforeReplay.rows[0]!.count);
    await assert.rejects(
      db.pool.query(
        "UPDATE procurement.cost_provenance SET source_amount=1 WHERE tenant_id=$1 AND target_id=$2",
        [tenant, assetId],
      ),
      /Cost provenance is immutable/,
    );
    await assert.rejects(
      db.pool.query("TRUNCATE procurement.cost_provenance"),
      /Cost provenance is immutable/,
    );

    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        `INSERT INTO contract.contracts(id,tenant_id,contract_code,supplier_id,supplier_display_snapshot,lifecycle_state,effective_at,end_at,current_version_id,current_version_number,created_by,correlation_id)
         VALUES($1,$2,'T076-LICENSE-CTR',$3,'Cost Supplier','EXECUTED',now()-interval '1 day',now()+interval '365 days',$4,1,'test','task076')`,
        [contractId, tenant, supplierId, contractVersionId],
      );
      await tx.query(
        `INSERT INTO contract.contract_versions(id,tenant_id,contract_id,version_number,commercial_snapshot,fingerprint,source,created_by)
         VALUES($1,$2,$3,1,$4,$5,'CREATE','test')`,
        [
          contractVersionId,
          tenant,
          contractId,
          JSON.stringify({ cost_amount: 12000, currency: "USD" }),
          "3".repeat(64),
        ],
      );
      await tx.query(
        `INSERT INTO contract.execution_evidence(id,tenant_id,contract_id,contract_version_id,evidence_type,external_reference,recorded_by)
         VALUES($1,$2,$3,$4,'EXTERNAL_REFERENCE','offline:task076-contract','test')`,
        [randomUUID(), tenant, contractId, contractVersionId],
      );
      await tx.query(
        `INSERT INTO software.software_products(id,tenant_id,product_code,name,vendor,category,owner_id,support_team)
         VALUES($1,$2,'T076-LIC','Phase 4 License','Example','APPLICATION','test','IT')`,
        [productId, tenant],
      );
      await tx.query(
        `INSERT INTO license.license_entitlements(id,tenant_id,software_product_id,license_type,quantity,created_by)
         VALUES($1,$2,$3,'SUBSCRIPTION',10,'test')`,
        [entitlementId, tenant, productId],
      );
      await tx.query(
        `INSERT INTO license.entitlement_terms(id,tenant_id,entitlement_id,term_version,valid_from,valid_until,recorded_by,reason)
         VALUES($1,$2,$3,1,now(),now()+interval '365 days','test','Task-076 integration test')`,
        [randomUUID(), tenant, entitlementId],
      );
    });
    api = apiServer(
      loadConfig({
        DATABASE_SECRET_REF: "env:TEST",
        APP_ENV: "test",
        LOG_LEVEL: "error",
      }),
      async () => true,
      {
        async authenticate() {
          return {
            id: "task076-operator",
            tenant_id: tenant,
            actor_type: "USER",
          };
        },
      },
      {
        async evaluate() {
          return { result: "ALLOW" as const, reason: "test" };
        },
      },
      db.uow,
    );
    const base = await listen(api);
    const costRequest = {
      target_type: "LICENSE_ENTITLEMENT",
      target_id: entitlementId,
      source_type: "CONTRACT_VERSION",
      source_document_id: contractVersionId,
      source_document_version_ref: contractVersionId,
      cost_basis: "COMMITTED",
      amount: 12000,
      currency: "USD",
      quantity_basis: 1,
      allocation_method: "CONTRACT_PERIOD_TOTAL",
      allocation_role: "ENTITLEMENT_TERM:1",
      effective_from: new Date().toISOString(),
      effective_to: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      reason: "Link entitlement to its executed Contract version",
    };
    const recorded = await fetch(`${base}/api/v1/cost-provenance`, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": "task076-license-cost",
      },
      body: JSON.stringify(costRequest),
    });
    assert.equal(recorded.status, 201, await recorded.clone().text());
    const repeated = await fetch(`${base}/api/v1/cost-provenance`, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": "task076-license-cost",
      },
      body: JSON.stringify(costRequest),
    });
    assert.equal(repeated.status, 201, await repeated.clone().text());
    const licenseProvenance = await fetch(
      `${base}/api/v1/cost-provenance/license-entitlements/${entitlementId}`,
      {
        headers: { authorization: "Bearer test" },
      },
    );
    assert.equal(
      licenseProvenance.status,
      200,
      await licenseProvenance.clone().text(),
    );
    const licenseCost = (await licenseProvenance.json()) as {
      data: {
        records: Array<Record<string, unknown>>;
        summary: Array<Record<string, unknown>>;
      };
    };
    assert.equal(licenseCost.data.records.length, 1);
    assert.equal(licenseCost.data.records[0]!.source_type, "CONTRACT_VERSION");
    assert.equal(
      licenseCost.data.records[0]!.source_document_id,
      contractVersionId,
    );
    assert.equal(Number(licenseCost.data.summary[0]!.committed_amount), 12000);
    const objectStoreCapability = await fetch(
      `${base}/api/v1/health/capabilities`,
      { headers: { authorization: "Bearer test", "X-Tenant-ID": tenant } },
    );
    assert.equal(objectStoreCapability.status, 200);
    const capability = (await objectStoreCapability.json()) as {
      data: {
        commercial_document_storage: {
          status: string;
          production_ready: boolean;
        };
      };
    };
    assert.equal(
      capability.data.commercial_document_storage.status,
      "UNAVAILABLE_NOT_READY",
    );
    assert.equal(
      capability.data.commercial_document_storage.production_ready,
      false,
    );
    const fakeApi = apiServer(
      loadConfig({
        DATABASE_SECRET_REF: "env:TEST",
        APP_ENV: "test",
        LOG_LEVEL: "error",
      }),
      async () => true,
      {
        async authenticate() {
          return {
            id: "task076-operator",
            tenant_id: tenant,
            actor_type: "USER",
          };
        },
      },
      {
        async evaluate() {
          return { result: "ALLOW" as const, reason: "test" };
        },
      },
      db.uow,
      undefined,
      {
        async head() {
          return null;
        },
      },
    );
    try {
      const fakeBase = await listen(fakeApi);
      const fakeCapabilityResponse = await fetch(
        `${fakeBase}/api/v1/health/capabilities`,
        { headers: { authorization: "Bearer test", "X-Tenant-ID": tenant } },
      );
      const fakeCapability = (await fakeCapabilityResponse.json()) as {
        data: {
          commercial_document_storage: {
            status: string;
            adapter_present: boolean;
            production_ready: boolean;
          };
        };
      };
      assert.equal(
        fakeCapability.data.commercial_document_storage.status,
        "ADAPTER_PRESENT_NOT_PRODUCTION_VERIFIED",
      );
      assert.equal(
        fakeCapability.data.commercial_document_storage.adapter_present,
        true,
      );
      assert.equal(
        fakeCapability.data.commercial_document_storage.production_ready,
        false,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        fakeApi.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    if (api)
      await new Promise<void>((resolve, reject) =>
        api!.close((error) => (error ? reject(error) : resolve())),
      );
    await db.close();
  }
});
