import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("TASK-074 submits immutable invoices, reserves partial match capacity, protects duplicate identity, and applies credit", async () => {
  const db = await testDatabase();
  const tenant = "tenant-invoice-match";
  const supplier = randomUUID();
  const operator = randomUUID();
  const location = randomUUID();
  await db.pool.query(
    "INSERT INTO procurement.suppliers(id,tenant_id,code,legal_name,state,created_by) VALUES($1,$2,'INV-SUP-1','Invoice Supplier','APPROVED','test')",
    [supplier, tenant],
  );
  await db.pool.query(
    "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,$2,'INV-REC','Invoice test receiving','STORAGE')",
    [location, tenant],
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

  try {
    const poResponse = await post(
      "/api/v1/purchase-orders",
      "invoice-po-create",
      {
        supplier_id: supplier,
        currency: "USD",
        reason: "Invoice match test",
        lines: [{ description: "Switch", quantity: 10, unit_price: 10 }],
      },
    );
    assert.equal(poResponse.status, 201, await poResponse.clone().text());
    const poId = ((await poResponse.json()) as { data: { id: string } }).data
      .id;
    const issue = await post(
      `/api/v1/purchase-orders/${poId}/commands/issue`,
      "invoice-po-issue",
      { expected_version: 1, reason: "Issue PO" },
    );
    assert.equal(issue.status, 200, await issue.clone().text());
    const lineResult = await db.pool.query<{ id: string }>(
      "SELECT id FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=1",
      [tenant, poId],
    );
    const poLineId = lineResult.rows[0]!.id;
    const receipt = await post("/api/v1/goods-receipts", "invoice-gr-create", {
      purchase_order_id: poId,
      location_id: location,
      lines: [
        {
          purchase_order_line_id: poLineId,
          observed_quantity: 10,
          accepted_quantity: 10,
        },
      ],
    });
    assert.equal(receipt.status, 201, await receipt.clone().text());
    const receiptId = ((await receipt.json()) as { data: { id: string } }).data
      .id;
    const receiptPost = await post(
      `/api/v1/goods-receipts/${receiptId}/commands/post`,
      "invoice-gr-post",
      { expected_version: 1 },
    );
    assert.equal(receiptPost.status, 200, await receiptPost.clone().text());

    const createInvoice = async (
      key: string,
      number: string,
      quantity: number,
      unitPrice = 10,
      targetPoId = poId,
      targetPoLineId = poLineId,
    ) => {
      const response = await post("/api/v1/invoices", `${key}-create`, {
        supplier_id: supplier,
        supplier_document_number: number,
        invoice_date: "2026-09-13",
        currency: "USD",
        gross_amount: quantity * unitPrice,
        purchase_order_id: targetPoId,
        lines: [
          {
            purchase_order_line_id: targetPoLineId,
            description: "Switch",
            quantity,
            unit_price: unitPrice,
            line_total: quantity * unitPrice,
          },
        ],
      });
      assert.equal(response.status, 201, await response.clone().text());
      return (
        (await response.json()) as {
          data: {
            id: string;
            aggregate_version: number;
            lines: Array<{ id: string }>;
          };
        }
      ).data;
    };
    const submit = (id: string, key: string, version: number) =>
      post(`/api/v1/invoices/${id}/commands/submit`, key, {
        expected_version: version,
      });
    const approve = (id: string, key: string, version: number) =>
      post(`/api/v1/invoices/${id}/commands/approve`, key, {
        expected_version: version,
      });

    const first = await createInvoice("invoice-a", "INV 001", 4);
    deniedPermission = "invoice.update";
    const deniedUpdate = await post(
      `/api/v1/invoices/${first.id}/commands/update-draft`,
      "invoice-a-update-denied",
      {
        expected_version: first.aggregate_version,
        supplier_id: supplier,
        supplier_document_number: "INV 001",
        invoice_date: "2026-09-13",
        currency: "USD",
        gross_amount: 40,
        purchase_order_id: poId,
        lines: [
          {
            purchase_order_line_id: poLineId,
            description: "Switch",
            quantity: 4,
            unit_price: 10,
            line_total: 40,
          },
        ],
      },
    );
    assert.equal(deniedUpdate.status, 403);
    deniedPermission = null;
    const firstUpdate = await post(
      `/api/v1/invoices/${first.id}/commands/update-draft`,
      "invoice-a-update",
      {
        expected_version: first.aggregate_version,
        supplier_id: supplier,
        supplier_document_number: "INV 001",
        invoice_date: "2026-09-13",
        currency: "USD",
        gross_amount: 40,
        purchase_order_id: poId,
        lines: [
          {
            purchase_order_line_id: poLineId,
            description: "Switch",
            quantity: 4,
            unit_price: 10,
            line_total: 40,
          },
        ],
      },
    );
    assert.equal(firstUpdate.status, 200, await firstUpdate.clone().text());
    const updatedFirst = (await firstUpdate.json()) as {
      data: { aggregate_version: number };
    };
    const changedRequest = await post("/api/v1/invoices", "invoice-a-create", {
      supplier_id: supplier,
      supplier_document_number: "INV 001",
      invoice_date: "2026-09-13",
      currency: "USD",
      gross_amount: 41,
      purchase_order_id: poId,
      lines: [
        {
          purchase_order_line_id: poLineId,
          description: "Switch",
          quantity: 4,
          unit_price: 10,
          line_total: 40,
        },
      ],
    });
    assert.equal(changedRequest.status, 409);
    const firstSubmitted = await submit(
      first.id,
      "invoice-a-submit",
      updatedFirst.data.aggregate_version,
    );
    assert.equal(
      firstSubmitted.status,
      200,
      await firstSubmitted.clone().text(),
    );
    const firstData = (await firstSubmitted.json()) as {
      data: {
        match_status: string;
        aggregate_version: number;
        lines: Array<{ id: string }>;
      };
    };
    assert.equal(firstData.data.match_status, "MATCHED");
    const successfulEffects = await db.pool.query<{ events: string[] }>(
      `SELECT array_agg(DISTINCT event_type ORDER BY event_type) AS events
         FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2`,
      [tenant, first.id],
    );
    assert.deepEqual(successfulEffects.rows[0]!.events, [
      "INVOICE.CREATED",
      "INVOICE.MATCHED",
      "INVOICE.MATCH_EVALUATED",
      "INVOICE.SUBMITTED",
      "INVOICE.UPDATED",
    ]);
    const invoiceAudit = await db.pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM audit.audit_events WHERE tenant_id=$1 AND subject->>'entity_id'=$2",
      [tenant, first.id],
    );
    assert.ok(Number(invoiceAudit.rows[0]!.count) >= 3);
    const poTimeline = (await (
      await get(`/api/v1/purchase-orders/${poId}/timeline`)
    ).json()) as {
      data: Array<{ event_type: string }>;
    };
    assert.ok(
      poTimeline.data.some((entry) => entry.event_type === "INVOICE.SUBMITTED"),
    );
    assert.equal(
      (
        await approve(
          first.id,
          "invoice-a-approve",
          firstData.data.aggregate_version,
        )
      ).status,
      200,
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE procurement.invoice_lines SET unit_price=11 WHERE tenant_id=$1 AND invoice_id=$2",
        [tenant, first.id],
      ),
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE procurement.invoices SET gross_amount=41 WHERE tenant_id=$1 AND id=$2",
        [tenant, first.id],
      ),
    );

    const second = await createInvoice("invoice-b", "INV 002", 6);
    const secondSubmitted = await submit(
      second.id,
      "invoice-b-submit",
      second.aggregate_version,
    );
    assert.equal(
      secondSubmitted.status,
      200,
      await secondSubmitted.clone().text(),
    );
    const secondData = (await secondSubmitted.json()) as {
      data: {
        match_status: string;
        aggregate_version: number;
        snapshot_fingerprint: string;
        current_match_evaluation: {
          id: string;
          evaluation_fingerprint: string;
        };
      };
    };
    assert.equal(secondData.data.match_status, "MATCHED");
    const invoiceApprovalPolicy = randomUUID();
    await db.pool.query(
      "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,$2,'INVOICE-APPROVAL-TEST',1,'ACTIVE')",
      [invoiceApprovalPolicy, tenant],
    );
    const linkedInvoiceApproval = await post(
      "/api/v1/approvals",
      "invoice-linked-approval-create",
      {
        source_type: "INVOICE_APPROVAL",
        source_id: second.id,
        policy_id: invoiceApprovalPolicy,
        policy_version: 1,
        context: {
          invoice_snapshot_fingerprint: secondData.data.snapshot_fingerprint,
          match_evaluation_id: secondData.data.current_match_evaluation.id,
          match_evaluation_fingerprint:
            secondData.data.current_match_evaluation.evaluation_fingerprint,
        },
      },
    );
    assert.equal(
      linkedInvoiceApproval.status,
      201,
      await linkedInvoiceApproval.clone().text(),
    );
    const linkedApprovalId = (
      (await linkedInvoiceApproval.json()) as { data: { id: string } }
    ).data.id;
    const pendingApproval = await approve(
      second.id,
      "invoice-linked-approval-pending",
      secondData.data.aggregate_version,
    );
    assert.equal(pendingApproval.status, 422);
    await db.pool.query(
      "UPDATE control.approval_requests SET state='APPROVED' WHERE tenant_id=$1 AND id=$2",
      [tenant, linkedApprovalId],
    );
    const linkedApprovalUsed = await approve(
      second.id,
      "invoice-linked-approval-approved",
      secondData.data.aggregate_version,
    );
    assert.equal(
      linkedApprovalUsed.status,
      200,
      await linkedApprovalUsed.clone().text(),
    );

    const candidateInvoice = await createInvoice(
      "invoice-fuzzy-candidate",
      "INV-CANDIDATE",
      4,
    );
    const candidateSubmit = await submit(
      candidateInvoice.id,
      "invoice-fuzzy-candidate-submit",
      candidateInvoice.aggregate_version,
    );
    assert.equal(
      candidateSubmit.status,
      200,
      await candidateSubmit.clone().text(),
    );
    const candidateRecord = await db.pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM procurement.invoice_duplicate_candidates WHERE tenant_id=$1 AND document_id=$2",
      [tenant, candidateInvoice.id],
    );
    assert.ok(Number(candidateRecord.rows[0]!.count) >= 1);
    const candidateWorkItem = await db.pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM operations.work_items WHERE tenant_id=$1 AND source_type='INVOICE_DUPLICATE' AND source_id=$2 AND state='NEW'",
      [tenant, candidateInvoice.id],
    );
    assert.equal(Number(candidateWorkItem.rows[0]!.count), 1);

    const duplicate = await createInvoice("invoice-duplicate", "INV 001", 1);
    const duplicateResponse = await submit(
      duplicate.id,
      "invoice-duplicate-submit",
      duplicate.aggregate_version,
    );
    assert.equal(
      duplicateResponse.status,
      409,
      await duplicateResponse.clone().text(),
    );
    assert.equal(
      ((await duplicateResponse.json()) as { error: { code: string } }).error
        .code,
      "INVOICE_DUPLICATE",
    );
    const draftToCancel = await createInvoice(
      "invoice-draft-cancel",
      "INV-CANCEL-DRAFT",
      1,
    );
    const cancelledDraft = await post(
      `/api/v1/invoices/${draftToCancel.id}/commands/cancel`,
      "invoice-draft-cancel-command",
      { expected_version: draftToCancel.aggregate_version },
    );
    assert.equal(
      cancelledDraft.status,
      200,
      await cancelledDraft.clone().text(),
    );
    assert.equal(
      ((await cancelledDraft.json()) as { data: { lifecycle_state: string } })
        .data.lifecycle_state,
      "CANCELLED",
    );

    const draftCredit = await post(
      "/api/v1/credit-notes",
      "invoice-draft-credit",
      {
        invoice_id: first.id,
        supplier_document_number: "CN-DRAFT-CANCEL",
        document_date: "2026-09-13",
        currency: "USD",
        lines: [
          {
            invoice_line_id: firstData.data.lines[0]!.id,
            credited_quantity: 1,
            credited_amount: 10,
          },
        ],
      },
    );
    assert.equal(draftCredit.status, 201, await draftCredit.clone().text());
    const draftCreditData = (await draftCredit.json()) as {
      data: { id: string; aggregate_version: number };
    };
    const draftCreditUpdate = await post(
      `/api/v1/credit-notes/${draftCreditData.data.id}/commands/update-draft`,
      "invoice-draft-credit-update",
      {
        expected_version: draftCreditData.data.aggregate_version,
        supplier_document_number: "CN-DRAFT-CANCEL",
        document_date: "2026-09-13",
        lines: [
          {
            invoice_line_id: firstData.data.lines[0]!.id,
            credited_quantity: 1,
            credited_amount: 10,
          },
        ],
      },
    );
    assert.equal(
      draftCreditUpdate.status,
      200,
      await draftCreditUpdate.clone().text(),
    );
    const updatedDraftCredit = (await draftCreditUpdate.json()) as {
      data: { aggregate_version: number };
    };
    const cancelledCredit = await post(
      `/api/v1/credit-notes/${draftCreditData.data.id}/commands/cancel`,
      "invoice-draft-credit-cancel",
      { expected_version: updatedDraftCredit.data.aggregate_version },
    );
    assert.equal(
      cancelledCredit.status,
      200,
      await cancelledCredit.clone().text(),
    );

    const credit = await post("/api/v1/credit-notes", "invoice-credit-create", {
      invoice_id: first.id,
      supplier_document_number: "CN 001",
      document_date: "2026-09-13",
      currency: "USD",
      lines: [
        {
          invoice_line_id: firstData.data.lines[0]!.id,
          credited_quantity: 1,
          credited_amount: 10,
        },
      ],
    });
    assert.equal(credit.status, 201, await credit.clone().text());
    const creditData = (await credit.json()) as {
      data: { id: string; aggregate_version: number };
    };
    const creditSubmit = await post(
      `/api/v1/credit-notes/${creditData.data.id}/commands/submit`,
      "invoice-credit-submit",
      { expected_version: creditData.data.aggregate_version },
    );
    assert.equal(creditSubmit.status, 200, await creditSubmit.clone().text());
    const submittedCredit = (await creditSubmit.json()) as {
      data: { aggregate_version: number };
    };
    await assert.rejects(
      db.pool.query(
        "UPDATE procurement.credit_notes SET total_amount=11 WHERE tenant_id=$1 AND id=$2",
        [tenant, creditData.data.id],
      ),
    );
    const creditApply = await post(
      `/api/v1/credit-notes/${creditData.data.id}/commands/apply`,
      "invoice-credit-apply",
      { expected_version: submittedCredit.data.aggregate_version },
    );
    assert.equal(creditApply.status, 200, await creditApply.clone().text());
    const replayCreditApply = await post(
      `/api/v1/credit-notes/${creditData.data.id}/commands/apply`,
      "invoice-credit-apply",
      { expected_version: submittedCredit.data.aggregate_version },
    );
    assert.equal(replayCreditApply.status, 200);
    const appliedOnce = await db.pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM procurement.credit_note_applications WHERE tenant_id=$1 AND credit_note_id=$2",
      [tenant, creditData.data.id],
    );
    assert.equal(Number(appliedOnce.rows[0]!.count), 1);
    const invoiceTimelineAfterCredit = (await (
      await get(`/api/v1/invoices/${first.id}/timeline`)
    ).json()) as {
      data: Array<{ event_type: string }>;
    };
    assert.ok(
      invoiceTimelineAfterCredit.data.some(
        (entry) => entry.event_type === "CREDIT_NOTE.APPLIED",
      ),
    );
    const duplicateCredit = await post(
      "/api/v1/credit-notes",
      "invoice-duplicate-credit-create",
      {
        invoice_id: first.id,
        supplier_document_number: "CN 001",
        document_date: "2026-09-13",
        currency: "USD",
        lines: [
          {
            invoice_line_id: firstData.data.lines[0]!.id,
            credited_quantity: 1,
            credited_amount: 10,
          },
        ],
      },
    );
    assert.equal(
      duplicateCredit.status,
      201,
      await duplicateCredit.clone().text(),
    );
    const duplicateCreditData = (await duplicateCredit.json()) as {
      data: { id: string; aggregate_version: number };
    };
    const duplicateCreditSubmit = await post(
      `/api/v1/credit-notes/${duplicateCreditData.data.id}/commands/submit`,
      "invoice-duplicate-credit-submit",
      { expected_version: duplicateCreditData.data.aggregate_version },
    );
    assert.equal(duplicateCreditSubmit.status, 409);
    assert.equal(
      ((await duplicateCreditSubmit.json()) as { error: { code: string } })
        .error.code,
      "INVOICE_DUPLICATE",
    );

    const excessiveCredit = await post(
      "/api/v1/credit-notes",
      "invoice-excess-credit-create",
      {
        invoice_id: first.id,
        supplier_document_number: "CN-EXCESS",
        document_date: "2026-09-13",
        currency: "USD",
        lines: [
          {
            invoice_line_id: firstData.data.lines[0]!.id,
            credited_quantity: 4,
            credited_amount: 40,
          },
        ],
      },
    );
    assert.equal(
      excessiveCredit.status,
      201,
      await excessiveCredit.clone().text(),
    );
    const excessiveCreditData = (
      (await excessiveCredit.json()) as {
        data: { id: string; aggregate_version: number };
      }
    ).data;
    const excessiveCreditSubmit = await post(
      `/api/v1/credit-notes/${excessiveCreditData.id}/commands/submit`,
      "invoice-excess-credit-submit",
      { expected_version: excessiveCreditData.aggregate_version },
    );
    assert.equal(
      excessiveCreditSubmit.status,
      200,
      await excessiveCreditSubmit.clone().text(),
    );
    const excessiveSubmitted = (await excessiveCreditSubmit.json()) as {
      data: { aggregate_version: number };
    };
    const excessiveApply = await post(
      `/api/v1/credit-notes/${excessiveCreditData.id}/commands/apply`,
      "invoice-excess-credit-apply",
      { expected_version: excessiveSubmitted.data.aggregate_version },
    );
    assert.equal(
      excessiveApply.status,
      422,
      await excessiveApply.clone().text(),
    );

    const replacement = await createInvoice(
      "invoice-replacement",
      "INV 003",
      1,
    );
    const replacementSubmit = await submit(
      replacement.id,
      "invoice-replacement-submit",
      replacement.aggregate_version,
    );
    assert.equal(
      replacementSubmit.status,
      200,
      await replacementSubmit.clone().text(),
    );
    assert.equal(
      ((await replacementSubmit.json()) as { data: { match_status: string } })
        .data.match_status,
      "MATCHED",
    );
    const amountOnlyCredit = await post(
      "/api/v1/credit-notes",
      "invoice-amount-only-credit",
      {
        invoice_id: first.id,
        supplier_document_number: "CN-AMOUNT-ONLY",
        document_date: "2026-09-13",
        currency: "USD",
        lines: [
          {
            invoice_line_id: firstData.data.lines[0]!.id,
            credited_quantity: 0,
            credited_amount: 10,
          },
        ],
      },
    );
    assert.equal(
      amountOnlyCredit.status,
      201,
      await amountOnlyCredit.clone().text(),
    );
    const amountOnlyData = (await amountOnlyCredit.json()) as {
      data: { id: string; aggregate_version: number };
    };
    const amountOnlySubmit = await post(
      `/api/v1/credit-notes/${amountOnlyData.data.id}/commands/submit`,
      "invoice-amount-only-submit",
      { expected_version: amountOnlyData.data.aggregate_version },
    );
    assert.equal(
      amountOnlySubmit.status,
      200,
      await amountOnlySubmit.clone().text(),
    );
    const amountOnlySubmitted = (await amountOnlySubmit.json()) as {
      data: { aggregate_version: number };
    };
    const amountOnlyApply = await post(
      `/api/v1/credit-notes/${amountOnlyData.data.id}/commands/apply`,
      "invoice-amount-only-apply",
      { expected_version: amountOnlySubmitted.data.aggregate_version },
    );
    assert.equal(
      amountOnlyApply.status,
      200,
      await amountOnlyApply.clone().text(),
    );
    const noReleasedQuantity = await createInvoice(
      "invoice-amount-only-replacement",
      "INV-AMOUNT-ONLY-REPLACEMENT",
      1,
    );
    const noReleaseSubmit = await submit(
      noReleasedQuantity.id,
      "invoice-amount-only-replacement-submit",
      noReleasedQuantity.aggregate_version,
    );
    assert.equal(
      noReleaseSubmit.status,
      200,
      await noReleaseSubmit.clone().text(),
    );
    assert.equal(
      ((await noReleaseSubmit.json()) as { data: { match_status: string } })
        .data.match_status,
      "MISMATCHED",
    );

    const pendingPoResponse = await post(
      "/api/v1/purchase-orders",
      "invoice-pending-po",
      {
        supplier_id: supplier,
        currency: "USD",
        reason: "Pending receipt test",
        lines: [{ description: "Cable", quantity: 2, unit_price: 5 }],
      },
    );
    assert.equal(
      pendingPoResponse.status,
      201,
      await pendingPoResponse.clone().text(),
    );
    const pendingPoId = (
      (await pendingPoResponse.json()) as { data: { id: string } }
    ).data.id;
    assert.equal(
      (
        await post(
          `/api/v1/purchase-orders/${pendingPoId}/commands/issue`,
          "invoice-pending-po-issue",
          { expected_version: 1, reason: "Issue PO" },
        )
      ).status,
      200,
    );
    const pendingPoLine = (
      await db.pool.query<{ id: string }>(
        "SELECT id FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=1",
        [tenant, pendingPoId],
      )
    ).rows[0]!.id;
    const draftEvidence = await post(
      "/api/v1/goods-receipts",
      "invoice-draft-gr-evidence",
      {
        purchase_order_id: pendingPoId,
        location_id: location,
        lines: [
          {
            purchase_order_line_id: pendingPoLine,
            observed_quantity: 1,
            accepted_quantity: 1,
          },
        ],
      },
    );
    assert.equal(draftEvidence.status, 201, await draftEvidence.clone().text());
    const pendingInvoiceResponse = await post(
      "/api/v1/invoices",
      "invoice-pending-create",
      {
        supplier_id: supplier,
        supplier_document_number: "INV-PENDING",
        invoice_date: "2026-09-13",
        currency: "USD",
        gross_amount: 5,
        purchase_order_id: pendingPoId,
        lines: [
          {
            purchase_order_line_id: pendingPoLine,
            description: "Cable",
            quantity: 1,
            unit_price: 5,
            line_total: 5,
          },
        ],
      },
    );
    assert.equal(
      pendingInvoiceResponse.status,
      201,
      await pendingInvoiceResponse.clone().text(),
    );
    const pendingInvoice = (
      (await pendingInvoiceResponse.json()) as {
        data: { id: string; aggregate_version: number };
      }
    ).data;
    const pendingSubmit = await post(
      `/api/v1/invoices/${pendingInvoice.id}/commands/submit`,
      "invoice-pending-submit",
      { expected_version: pendingInvoice.aggregate_version },
    );
    assert.equal(pendingSubmit.status, 200, await pendingSubmit.clone().text());
    const pendingData = (await pendingSubmit.json()) as {
      data: {
        match_status: string;
        aggregate_version: number;
        snapshot_fingerprint: string;
        current_match_evaluation: {
          id: string;
          evaluation_fingerprint: string;
        };
      };
    };
    assert.equal(pendingData.data.match_status, "PENDING_RECEIPT");
    const staleApprovalPolicy = randomUUID();
    await db.pool.query(
      "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,$2,'INVOICE-STALE-TEST',1,'ACTIVE')",
      [staleApprovalPolicy, tenant],
    );
    const pendingLinkedApproval = await post(
      "/api/v1/approvals",
      "invoice-pending-linked-approval",
      {
        source_type: "INVOICE_APPROVAL",
        source_id: pendingInvoice.id,
        policy_id: staleApprovalPolicy,
        policy_version: 1,
        context: {
          invoice_snapshot_fingerprint: pendingData.data.snapshot_fingerprint,
          match_evaluation_id: pendingData.data.current_match_evaluation.id,
          match_evaluation_fingerprint:
            pendingData.data.current_match_evaluation.evaluation_fingerprint,
        },
      },
    );
    assert.equal(
      pendingLinkedApproval.status,
      201,
      await pendingLinkedApproval.clone().text(),
    );
    const pendingApprovalId = (
      (await pendingLinkedApproval.json()) as { data: { id: string } }
    ).data.id;
    await db.pool.query(
      "UPDATE control.approval_requests SET state='APPROVED' WHERE tenant_id=$1 AND id=$2",
      [tenant, pendingApprovalId],
    );
    const pendingReceipt = await post(
      "/api/v1/goods-receipts",
      "invoice-pending-gr",
      {
        purchase_order_id: pendingPoId,
        location_id: location,
        lines: [
          {
            purchase_order_line_id: pendingPoLine,
            observed_quantity: 2,
            accepted_quantity: 1,
            rejected_or_damaged_quantity: 1,
          },
        ],
      },
    );
    assert.equal(
      pendingReceipt.status,
      201,
      await pendingReceipt.clone().text(),
    );
    const pendingReceiptId = (
      (await pendingReceipt.json()) as { data: { id: string } }
    ).data.id;
    const [receiptPosted, racedEvaluation] = await Promise.all([
      post(
        `/api/v1/goods-receipts/${pendingReceiptId}/commands/post`,
        "invoice-pending-gr-post",
        { expected_version: 1 },
      ),
      post(
        `/api/v1/invoices/${pendingInvoice.id}/commands/reevaluate-match`,
        "invoice-pending-reevaluate",
        { expected_version: pendingData.data.aggregate_version },
      ),
    ]);
    assert.equal(receiptPosted.status, 200, await receiptPosted.clone().text());
    assert.equal(
      racedEvaluation.status,
      200,
      await racedEvaluation.clone().text(),
    );
    const pendingCurrent = (await (
      await get(`/api/v1/invoices/${pendingInvoice.id}`)
    ).json()) as {
      data: {
        match_status: string;
        aggregate_version: number;
        match_evaluations: unknown[];
      };
    };
    const finalEvaluation = await post(
      `/api/v1/invoices/${pendingInvoice.id}/commands/reevaluate-match`,
      "invoice-pending-reevaluate-final",
      { expected_version: pendingCurrent.data.aggregate_version },
    );
    assert.equal(
      finalEvaluation.status,
      200,
      await finalEvaluation.clone().text(),
    );
    const finalEvaluationData = (await finalEvaluation.json()) as {
      data: { match_status: string; aggregate_version: number };
    };
    assert.equal(finalEvaluationData.data.match_status, "MATCHED");
    const staleApproval = await approve(
      pendingInvoice.id,
      "invoice-stale-approval-use",
      finalEvaluationData.data.aggregate_version,
    );
    assert.equal(staleApproval.status, 409, await staleApproval.clone().text());
    assert.equal(
      ((await staleApproval.json()) as { error: { code: string } }).error.code,
      "INVOICE_APPROVAL_STALE",
    );
    assert.ok(pendingCurrent.data.match_evaluations.length >= 1);

    const exceptionPoResponse = await post(
      "/api/v1/purchase-orders",
      "invoice-exception-po",
      {
        supplier_id: supplier,
        currency: "USD",
        reason: "Mismatch exception test",
        lines: [{ description: "Router", quantity: 2, unit_price: 10 }],
      },
    );
    assert.equal(
      exceptionPoResponse.status,
      201,
      await exceptionPoResponse.clone().text(),
    );
    const exceptionPoId = (
      (await exceptionPoResponse.json()) as { data: { id: string } }
    ).data.id;
    assert.equal(
      (
        await post(
          `/api/v1/purchase-orders/${exceptionPoId}/commands/issue`,
          "invoice-exception-po-issue",
          { expected_version: 1, reason: "Issue PO" },
        )
      ).status,
      200,
    );
    const exceptionPoLine = (
      await db.pool.query<{ id: string }>(
        "SELECT id FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=1",
        [tenant, exceptionPoId],
      )
    ).rows[0]!.id;
    const exceptionReceipt = await post(
      "/api/v1/goods-receipts",
      "invoice-exception-gr",
      {
        purchase_order_id: exceptionPoId,
        location_id: location,
        lines: [
          {
            purchase_order_line_id: exceptionPoLine,
            observed_quantity: 2,
            accepted_quantity: 2,
          },
        ],
      },
    );
    assert.equal(
      exceptionReceipt.status,
      201,
      await exceptionReceipt.clone().text(),
    );
    const exceptionReceiptId = (
      (await exceptionReceipt.json()) as { data: { id: string } }
    ).data.id;
    assert.equal(
      (
        await post(
          `/api/v1/goods-receipts/${exceptionReceiptId}/commands/post`,
          "invoice-exception-gr-post",
          { expected_version: 1 },
        )
      ).status,
      200,
    );
    const mismatchInvoiceResponse = await post(
      "/api/v1/invoices",
      "invoice-exception-create",
      {
        supplier_id: supplier,
        supplier_document_number: "INV-MISMATCH",
        invoice_date: "2026-09-13",
        currency: "USD",
        gross_amount: 18,
        purchase_order_id: exceptionPoId,
        lines: [
          {
            purchase_order_line_id: exceptionPoLine,
            description: "Router",
            quantity: 2,
            unit_price: 9,
            line_total: 18,
          },
        ],
      },
    );
    assert.equal(
      mismatchInvoiceResponse.status,
      201,
      await mismatchInvoiceResponse.clone().text(),
    );
    const mismatchInvoice = (
      (await mismatchInvoiceResponse.json()) as {
        data: { id: string; aggregate_version: number };
      }
    ).data;
    const mismatchSubmit = await post(
      `/api/v1/invoices/${mismatchInvoice.id}/commands/submit`,
      "invoice-exception-submit",
      { expected_version: mismatchInvoice.aggregate_version },
    );
    assert.equal(
      mismatchSubmit.status,
      200,
      await mismatchSubmit.clone().text(),
    );
    const mismatchData = (await mismatchSubmit.json()) as {
      data: {
        match_status: string;
        aggregate_version: number;
        snapshot_fingerprint: string;
        current_match_evaluation: {
          id: string;
          evaluation_fingerprint: string;
        };
        match_exceptions: Array<{ id: string; evaluation_fingerprint: string }>;
      };
    };
    assert.equal(mismatchData.data.match_status, "MISMATCHED");
    const normalMismatchApproval = await post(
      `/api/v1/invoices/${mismatchInvoice.id}/commands/approve`,
      "invoice-mismatch-normal-approve",
      { expected_version: mismatchData.data.aggregate_version },
    );
    assert.equal(
      normalMismatchApproval.status,
      409,
      await normalMismatchApproval.clone().text(),
    );
    const policyId = randomUUID();
    await db.pool.query(
      "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,$2,'INVOICE-EXCEPTION-TEST',1,'ACTIVE')",
      [policyId, tenant],
    );
    const exception = mismatchData.data.match_exceptions[0]!;
    const evaluation = mismatchData.data.current_match_evaluation;
    const approvalResponse = await post(
      "/api/v1/approvals",
      "invoice-exception-approval",
      {
        source_type: "INVOICE_MATCH_EXCEPTION",
        source_id: mismatchInvoice.id,
        policy_id: policyId,
        policy_version: 1,
        context: {
          invoice_snapshot_fingerprint: mismatchData.data.snapshot_fingerprint,
          match_evaluation_id: evaluation.id,
          match_evaluation_fingerprint: evaluation.evaluation_fingerprint,
          match_exception_id: exception.id,
          exception_fingerprint: exception.evaluation_fingerprint,
        },
      },
    );
    assert.equal(
      approvalResponse.status,
      201,
      await approvalResponse.clone().text(),
    );
    const approvalId = (
      (await approvalResponse.json()) as { data: { id: string } }
    ).data.id;
    await db.pool.query(
      "UPDATE control.approval_requests SET state='APPROVED' WHERE tenant_id=$1 AND id=$2",
      [tenant, approvalId],
    );
    const exceptionApproval = await post(
      `/api/v1/invoices/${mismatchInvoice.id}/commands/approve`,
      "invoice-exception-approve",
      {
        expected_version: mismatchData.data.aggregate_version,
        reason: "Accept documented variance",
      },
    );
    assert.equal(
      exceptionApproval.status,
      200,
      await exceptionApproval.clone().text(),
    );
    assert.equal(
      (
        (await exceptionApproval.json()) as {
          data: { lifecycle_state: string; match_status: string };
        }
      ).data.match_status,
      "MISMATCHED",
    );
    const reservation = await db.pool.query<{ quantity: string }>(
      "SELECT sum(quantity) AS quantity FROM procurement.invoice_match_allocations WHERE tenant_id=$1 AND invoice_id=$2 AND allocation_type='APPROVED_EXCEPTION'",
      [tenant, mismatchInvoice.id],
    );
    assert.equal(Number(reservation.rows[0]!.quantity), 2);
    const reservedInvoiceResponse = await post(
      "/api/v1/invoices",
      "invoice-reserved-capacity",
      {
        supplier_id: supplier,
        supplier_document_number: "INV-RESERVED",
        invoice_date: "2026-09-13",
        currency: "USD",
        gross_amount: 10,
        purchase_order_id: exceptionPoId,
        lines: [
          {
            purchase_order_line_id: exceptionPoLine,
            description: "Router",
            quantity: 1,
            unit_price: 10,
            line_total: 10,
          },
        ],
      },
    );
    assert.equal(
      reservedInvoiceResponse.status,
      201,
      await reservedInvoiceResponse.clone().text(),
    );
    const reservedInvoice = (
      (await reservedInvoiceResponse.json()) as {
        data: { id: string; aggregate_version: number };
      }
    ).data;
    const reservedSubmit = await post(
      `/api/v1/invoices/${reservedInvoice.id}/commands/submit`,
      "invoice-reserved-submit",
      { expected_version: reservedInvoice.aggregate_version },
    );
    assert.equal(
      reservedSubmit.status,
      200,
      await reservedSubmit.clone().text(),
    );
    const reservedResult = (await reservedSubmit.json()) as {
      data: {
        match_status: string;
        current_match_evaluation: { reason_codes: string[] };
      };
    };
    assert.equal(reservedResult.data.match_status, "MISMATCHED");
    assert.ok(
      reservedResult.data.current_match_evaluation.reason_codes.includes(
        "QUANTITY_EXCEEDS_ORDERED",
      ),
    );

    const racingOne = await createInvoice("invoice-race-one", "INV-RACE", 1);
    const racingTwo = await createInvoice("invoice-race-two", "INV-RACE", 1);
    const raceResponses = await Promise.all([
      submit(
        racingOne.id,
        "invoice-race-one-submit",
        racingOne.aggregate_version,
      ),
      submit(
        racingTwo.id,
        "invoice-race-two-submit",
        racingTwo.aggregate_version,
      ),
    ]);
    assert.deepEqual(
      raceResponses.map((response) => response.status).sort(),
      [200, 409],
    );

    const capacityPoResponse = await post(
      "/api/v1/purchase-orders",
      "invoice-capacity-race-po",
      {
        supplier_id: supplier,
        currency: "USD",
        reason: "Concurrent invoice allocation test",
        lines: [{ description: "Firewall", quantity: 2, unit_price: 10 }],
      },
    );
    assert.equal(
      capacityPoResponse.status,
      201,
      await capacityPoResponse.clone().text(),
    );
    const capacityPoId = (
      (await capacityPoResponse.json()) as { data: { id: string } }
    ).data.id;
    assert.equal(
      (
        await post(
          `/api/v1/purchase-orders/${capacityPoId}/commands/issue`,
          "invoice-capacity-race-issue",
          { expected_version: 1, reason: "Issue PO" },
        )
      ).status,
      200,
    );
    const capacityPoLine = (
      await db.pool.query<{ id: string }>(
        "SELECT id FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=1",
        [tenant, capacityPoId],
      )
    ).rows[0]!.id;
    const capacityReceipt = await post(
      "/api/v1/goods-receipts",
      "invoice-capacity-race-gr",
      {
        purchase_order_id: capacityPoId,
        location_id: location,
        lines: [
          {
            purchase_order_line_id: capacityPoLine,
            observed_quantity: 2,
            accepted_quantity: 2,
          },
        ],
      },
    );
    assert.equal(
      capacityReceipt.status,
      201,
      await capacityReceipt.clone().text(),
    );
    const capacityReceiptId = (
      (await capacityReceipt.json()) as { data: { id: string } }
    ).data.id;
    assert.equal(
      (
        await post(
          `/api/v1/goods-receipts/${capacityReceiptId}/commands/post`,
          "invoice-capacity-race-gr-post",
          { expected_version: 1 },
        )
      ).status,
      200,
    );
    const competitorOne = await createInvoice(
      "invoice-capacity-one",
      "INV-CAP-1",
      2,
      10,
      capacityPoId,
      capacityPoLine,
    );
    const competitorTwo = await createInvoice(
      "invoice-capacity-two",
      "INV-CAP-2",
      2,
      10,
      capacityPoId,
      capacityPoLine,
    );
    const capacityRace = await Promise.all([
      submit(
        competitorOne.id,
        "invoice-capacity-one-submit",
        competitorOne.aggregate_version,
      ),
      submit(
        competitorTwo.id,
        "invoice-capacity-two-submit",
        competitorTwo.aggregate_version,
      ),
    ]);
    assert.deepEqual(
      capacityRace.map((response) => response.status),
      [200, 200],
    );
    const capacityResults = await Promise.all(
      capacityRace.map(
        async (response) =>
          (await response.json()) as {
            data: {
              match_status: string;
              aggregate_version: number;
              lines: Array<{ id: string }>;
            };
          },
      ),
    );
    assert.deepEqual(
      capacityResults.map((result) => result.data.match_status).sort(),
      ["MATCHED", "MISMATCHED"],
    );
    const winningIndex = capacityResults.findIndex(
      (result) => result.data.match_status === "MATCHED",
    );
    const winningInvoice = [competitorOne, competitorTwo][winningIndex]!;
    const winningData = capacityResults[winningIndex]!.data;
    const winnerApproval = await post(
      `/api/v1/invoices/${winningInvoice.id}/commands/approve`,
      "invoice-capacity-winner-approve",
      { expected_version: winningData.aggregate_version },
    );
    assert.equal(
      winnerApproval.status,
      200,
      await winnerApproval.clone().text(),
    );
    const createCredit = async (key: string, number: string) => {
      const response = await post("/api/v1/credit-notes", `${key}-create`, {
        invoice_id: winningInvoice.id,
        supplier_document_number: number,
        document_date: "2026-09-13",
        currency: "USD",
        lines: [
          {
            invoice_line_id: winningData.lines[0]!.id,
            credited_quantity: 2,
            credited_amount: 20,
          },
        ],
      });
      assert.equal(response.status, 201, await response.clone().text());
      const note = (
        (await response.json()) as {
          data: { id: string; aggregate_version: number };
        }
      ).data;
      const submitted = await post(
        `/api/v1/credit-notes/${note.id}/commands/submit`,
        `${key}-submit`,
        { expected_version: note.aggregate_version },
      );
      assert.equal(submitted.status, 200, await submitted.clone().text());
      return {
        id: note.id,
        version: (
          (await submitted.json()) as { data: { aggregate_version: number } }
        ).data.aggregate_version,
      };
    };
    const [creditRaceOne, creditRaceTwo] = await Promise.all([
      createCredit("invoice-credit-race-one", "CN-CAP-1"),
      createCredit("invoice-credit-race-two", "CN-CAP-2"),
    ]);
    const competingCredits = await Promise.all([
      post(
        `/api/v1/credit-notes/${creditRaceOne.id}/commands/apply`,
        "invoice-credit-race-one-apply",
        { expected_version: creditRaceOne.version },
      ),
      post(
        `/api/v1/credit-notes/${creditRaceTwo.id}/commands/apply`,
        "invoice-credit-race-two-apply",
        { expected_version: creditRaceTwo.version },
      ),
    ]);
    assert.deepEqual(
      competingCredits.map((response) => response.status).sort(),
      [200, 422],
    );

    const timeline = await get(`/api/v1/invoices/${first.id}/timeline`);
    assert.equal(timeline.status, 200);
    const allocations = await db.pool.query<{ quantity: string }>(
      "SELECT sum(quantity) AS quantity FROM procurement.invoice_match_allocations WHERE tenant_id=$1 AND purchase_order_line_id=$2",
      [tenant, poLineId],
    );
    assert.equal(Number(allocations.rows[0]!.quantity), 11);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
