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

test("TASK-071 RFQ and Quotation commands preserve revisions, eligibility, atomic decisions and concurrency", async () => {
  const db = await testDatabase();
  const tenantId = "tenant-rfq";
  const suppliers = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const [index, supplierId] of suppliers.entries()) {
    await db.pool.query(
      `INSERT INTO procurement.suppliers(id,tenant_id,code,legal_name,state,version,created_by)
       VALUES($1,$2,$3,$4,'APPROVED',2,'rfq-test')`,
      [supplierId, tenantId, `SUP-RFQ-${index}`, `RFQ supplier ${index}`],
    );
  }
  const requesterId = randomUUID();
  await db.pool.query(
    `INSERT INTO identity.users
      (id,tenant_id,display_code,username,display_name,employment_status)
     VALUES($1,$2,'RFQ-REQ','rfq-requester','RFQ Requester','ACTIVE')`,
    [requesterId, tenantId],
  );
  const eligibleRequestId = randomUUID();
  const ineligibleRequestId = randomUUID();
  for (const [requestId, state, suffix] of [
    [eligibleRequestId, "WAITING_RFQ", "eligible"],
    [ineligibleRequestId, "DRAFT", "ineligible"],
  ]) {
    await db.pool.query(
      `INSERT INTO procurement.procurement_requests
        (id,tenant_id,request_code,requester_user_id,source_type,business_reason,target_date,cost_center_id,state,created_by)
       VALUES($1,$2,$3,$4,'MANUAL_REQUEST','Source RFQ workflow request',current_date+30,'CC-OPS',$5,'rfq-test')`,
      [requestId, tenantId, `REQ-${suffix}`, requesterId, state],
    );
  }
  let tenant = tenantId;
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
        return { id: "rfq-admin", tenant_id: tenant, actor_type: "USER" };
      },
    },
    {
      async evaluate(request) {
        return {
          result:
            request.action === deniedAction
              ? ("DENY" as const)
              : ("ALLOW" as const),
          reason: "TASK-071 test",
        };
      },
    },
    db.uow,
  );
  const base = await listen(server);
  const post = (path: string, idem: string, body: object) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": idem,
      },
      body: JSON.stringify(body),
    });
  const get = (path: string) =>
    fetch(base + path, { headers: { authorization: "Bearer test" } });
  const future = () => new Date(Date.now() + 86400000).toISOString();
  const rfqBody = (candidateIds: string[], procurementRequestId?: string) => ({
    title: "Operations equipment RFQ",
    description: "Competitive sourcing",
    currency: "USD",
    submission_deadline: future(),
    terms: { delivery_location: "HQ" },
    supplier_ids: candidateIds,
    ...(procurementRequestId
      ? { procurement_request_id: procurementRequestId }
      : {}),
    reason: "Source equipment for operations",
  });
  const createRfq = async (key: string, candidates: string[]) => {
    const response = await post("/api/v1/rfqs", key, rfqBody(candidates));
    assert.equal(response.status, 201, await response.clone().text());
    return (
      (await response.json()) as {
        data: { id: string; version: number; state: string };
      }
    ).data;
  };
  const command = async (
    path: string,
    key: string,
    expectedVersion: number,
    extra: object = {},
  ) =>
    post(path, key, {
      expected_version: expectedVersion,
      reason: `Test ${key}`,
      ...extra,
    });
  const createQuote = async (
    key: string,
    rfqId: string,
    supplierId: string,
    replaces?: string,
  ) => {
    const response = await post("/api/v1/quotations", key, {
      rfq_id: rfqId,
      supplier_id: supplierId,
      currency: "USD",
      total: 1200,
      valid_until: "2026-12-31",
      lead_time_days: 5,
      payment_terms: "Net 30",
      warranty: "Two years",
      delivery_terms: "Delivered",
      terms: { discount: "standard" },
      lines: [{ description: "Business laptop", quantity: 2, unit_price: 600 }],
      attachments: [],
      ...(replaces ? { replaces_quotation_id: replaces } : {}),
      reason: "Prepare supplier quotation",
    });
    assert.equal(response.status, 201, await response.clone().text());
    return (
      (await response.json()) as {
        data: {
          id: string;
          state: string;
          version: number;
          revision_number: number;
        };
      }
    ).data;
  };

  try {
    const linkedRfqBody = rfqBody([suppliers[0]!], eligibleRequestId);
    const linkedRfq = await post(
      "/api/v1/rfqs",
      "rfq-linked-request",
      linkedRfqBody,
    );
    assert.equal(linkedRfq.status, 201, await linkedRfq.clone().text());
    assert.equal(
      (
        (await linkedRfq.json()) as {
          data: { procurement_request_id: string };
        }
      ).data.procurement_request_id,
      eligibleRequestId,
    );
    const ineligibleRfq = await post(
      "/api/v1/rfqs",
      "rfq-ineligible-request",
      rfqBody([suppliers[0]!], ineligibleRequestId),
    );
    assert.equal(ineligibleRfq.status, 422);

    const createBody = rfqBody(suppliers.slice(0, 3));
    const createResponse = await post("/api/v1/rfqs", "rfq-create", createBody);
    assert.equal(
      createResponse.status,
      201,
      await createResponse.clone().text(),
    );
    const rfq = (
      (await createResponse.json()) as {
        data: { id: string; version: number; state: string };
      }
    ).data;
    const replay = await post("/api/v1/rfqs", "rfq-create", createBody);
    assert.equal(replay.status, 201);
    assert.equal(
      ((await replay.json()) as { data: { id: string } }).data.id,
      rfq.id,
    );

    deniedAction = "rfq.issue";
    const denied = await command(
      `/api/v1/rfqs/${rfq.id}/commands/issue`,
      "rfq-denied-issue",
      1,
    );
    assert.equal(denied.status, 403);
    deniedAction = null;
    const issue = await command(
      `/api/v1/rfqs/${rfq.id}/commands/issue`,
      "rfq-issue",
      1,
    );
    assert.equal(issue.status, 200, await issue.clone().text());

    const firstDraft = await createQuote("quote-first", rfq.id, suppliers[0]!);
    assert.equal(
      (
        await command(
          `/api/v1/quotations/${firstDraft.id}/commands/submit`,
          "quote-submit-first",
          1,
        )
      ).status,
      200,
    );

    const submittedEdit = await command(
      `/api/v1/quotations/${firstDraft.id}/commands/update-draft`,
      "submitted-quotation-edit",
      2,
      { total: 1250 },
    );
    assert.equal(submittedEdit.status, 422);
    assert.equal(
      (
        await command(
          `/api/v1/quotations/${firstDraft.id}/commands/withdraw`,
          "quote-withdraw-first",
          2,
        )
      ).status,
      200,
    );
    const competingDraft = await createQuote(
      "quote-competing",
      rfq.id,
      suppliers[0]!,
      firstDraft.id,
    );
    const parallelDraft = await createQuote(
      "quote-parallel-draft",
      rfq.id,
      suppliers[0]!,
      firstDraft.id,
    );
    const submitRace = await Promise.all([
      command(
        `/api/v1/quotations/${competingDraft.id}/commands/submit`,
        "quote-submit-race-a",
        1,
      ),
      command(
        `/api/v1/quotations/${parallelDraft.id}/commands/submit`,
        "quote-submit-race-b",
        1,
      ),
    ]);
    assert.equal(
      submitRace.filter((response) => response.status === 200).length,
      1,
    );
    assert.equal(
      submitRace.filter((response) => response.status === 422).length,
      1,
    );
    const quoteRows = await db.pool.query(
      "SELECT id,state,version FROM procurement.quotations WHERE tenant_id=$1 AND rfq_id=$2 AND supplier_id=$3 ORDER BY id",
      [tenantId, rfq.id, suppliers[0]],
    );
    const winning = quoteRows.rows.find((row) => row.state === "SUBMITTED")!;
    const draft = quoteRows.rows.find((row) => row.state === "DRAFT")!;

    const withdraw = await command(
      `/api/v1/quotations/${winning.id}/commands/withdraw`,
      "quote-withdraw-for-revision",
      Number(winning.version),
    );
    assert.equal(withdraw.status, 200, await withdraw.clone().text());
    const revised = await createQuote(
      "quote-revision",
      rfq.id,
      suppliers[0]!,
      winning.id,
    );
    assert.equal(revised.revision_number, 4);
    const submitRevision = await command(
      `/api/v1/quotations/${revised.id}/commands/submit`,
      "quote-submit-revision",
      1,
    );
    assert.equal(
      submitRevision.status,
      200,
      await submitRevision.clone().text(),
    );
    const original = await db.pool.query(
      "SELECT state,total,terms,lines FROM procurement.quotations WHERE tenant_id=$1 AND id=$2",
      [tenantId, winning.id],
    );
    assert.equal(original.rows[0]!.state, "WITHDRAWN");
    await assert.rejects(
      db.pool.query(
        "UPDATE procurement.quotations SET total=1 WHERE tenant_id=$1 AND id=$2",
        [tenantId, winning.id],
      ),
      /Submitted quotation commercial data is immutable/,
    );
    const withdrawUnusedDraft = await command(
      `/api/v1/quotations/${draft.id}/commands/withdraw`,
      "quote-withdraw-unused-draft",
      Number(draft.version),
    );
    assert.equal(withdrawUnusedDraft.status, 200);

    const otherQuote = await createQuote(
      "quote-other-supplier",
      rfq.id,
      suppliers[1]!,
    );
    const submitOther = await command(
      `/api/v1/quotations/${otherQuote.id}/commands/submit`,
      "quote-submit-other",
      1,
    );
    assert.equal(submitOther.status, 200, await submitOther.clone().text());
    const awardDraft = await createQuote("award-draft", rfq.id, suppliers[2]!);

    const closing = await Promise.all([
      command(
        `/api/v1/quotations/${otherQuote.id}/commands/withdraw`,
        "race-submit-close-quote",
        2,
      ),
      command(
        `/api/v1/rfqs/${rfq.id}/commands/close-submissions`,
        "race-submit-close-rfq",
        2,
      ),
    ]);
    assert.ok(
      closing.every(
        (response) => response.status === 200 || response.status === 422,
      ),
    );
    assert.equal(closing[1]!.status, 200, await closing[1]!.clone().text());
    const afterClose = await db.pool.query(
      "SELECT state FROM procurement.quotations WHERE tenant_id=$1 AND id=$2",
      [tenantId, otherQuote.id],
    );
    assert.ok(
      ["WITHDRAWN", "SUBMITTED"].includes(String(afterClose.rows[0]!.state)),
    );

    const awardRace = await Promise.all([
      command(`/api/v1/rfqs/${rfq.id}/commands/award`, "race-award", 3, {
        quotation_id: revised.id,
      }),
      command(`/api/v1/rfqs/${rfq.id}/commands/cancel`, "race-cancel", 3),
    ]);
    assert.equal(
      awardRace.filter((response) => response.status === 200).length,
      1,
    );
    assert.equal(
      awardRace.filter(
        (response) => response.status === 409 || response.status === 422,
      ).length,
      1,
    );
    const finalRfq = await db.pool.query(
      "SELECT state,version FROM procurement.rfqs WHERE tenant_id=$1 AND id=$2",
      [tenantId, rfq.id],
    );
    assert.equal(finalRfq.rows[0]!.version, 4);
    if (finalRfq.rows[0]!.state === "AWARDED") {
      const finalQuotes = await db.pool.query(
        "SELECT id,state FROM procurement.quotations WHERE tenant_id=$1 AND rfq_id=$2",
        [tenantId, rfq.id],
      );
      assert.equal(
        finalQuotes.rows.find((row) => row.id === revised.id)!.state,
        "ACCEPTED",
      );
      assert.equal(
        finalQuotes.rows.find((row) => row.id === otherQuote.id)!.state,
        afterClose.rows[0]!.state === "SUBMITTED" ? "REJECTED" : "WITHDRAWN",
      );
      assert.equal(
        finalQuotes.rows.find((row) => row.id === awardDraft.id)!.state,
        "VOID",
      );
    } else {
      const voided = await db.pool.query(
        "SELECT count(*)::int AS count FROM procurement.quotations WHERE tenant_id=$1 AND rfq_id=$2 AND state='VOID'",
        [tenantId, rfq.id],
      );
      assert.equal(
        voided.rows[0]!.count,
        afterClose.rows[0]!.state === "SUBMITTED" ? 3 : 2,
      );
    }

    const noAwardRfq = await createRfq("rfq-no-award", [
      suppliers[3]!,
      suppliers[1]!,
      suppliers[2]!,
    ]);
    assert.equal(
      (
        await command(
          `/api/v1/rfqs/${noAwardRfq.id}/commands/issue`,
          "no-award-issue",
          1,
        )
      ).status,
      200,
    );
    const noAwardDraft = await createQuote(
      "no-award-draft",
      noAwardRfq.id,
      suppliers[3]!,
    );
    const noAwardQuote = await createQuote(
      "no-award-quote",
      noAwardRfq.id,
      suppliers[1]!,
    );
    const eligibilityQuote = await createQuote(
      "eligibility-quote",
      noAwardRfq.id,
      suppliers[2]!,
    );
    await db.pool.query(
      "UPDATE procurement.suppliers SET state='SUSPENDED',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [tenantId, suppliers[2]],
    );
    const ineligibleSubmit = await command(
      `/api/v1/quotations/${eligibilityQuote.id}/commands/submit`,
      "ineligible-quote-submit",
      1,
    );
    assert.equal(ineligibleSubmit.status, 422);
    await db.pool.query(
      "UPDATE procurement.suppliers SET state='PROSPECT',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [tenantId, suppliers[2]],
    );
    assert.equal(
      (
        await command(
          `/api/v1/quotations/${noAwardQuote.id}/commands/submit`,
          "no-award-submit",
          1,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await command(
          `/api/v1/quotations/${eligibilityQuote.id}/commands/submit`,
          "prospect-quote-submit",
          1,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await command(
          `/api/v1/rfqs/${noAwardRfq.id}/commands/close-submissions`,
          "no-award-close-submissions",
          2,
        )
      ).status,
      200,
    );
    const disqualify = await command(
      `/api/v1/quotations/${eligibilityQuote.id}/commands/disqualify`,
      "prospect-quote-disqualify",
      2,
    );
    assert.equal(disqualify.status, 200, await disqualify.clone().text());
    const closed = await command(
      `/api/v1/rfqs/${noAwardRfq.id}/commands/close-no-award`,
      "no-award-close",
      3,
    );
    assert.equal(closed.status, 200, await closed.clone().text());
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM procurement.quotations WHERE tenant_id=$1 AND id=$2",
          [tenantId, noAwardQuote.id],
        )
      ).rows[0]!.state,
      "REJECTED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM procurement.quotations WHERE tenant_id=$1 AND id=$2",
          [tenantId, eligibilityQuote.id],
        )
      ).rows[0]!.state,
      "DISQUALIFIED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM procurement.quotations WHERE tenant_id=$1 AND id=$2",
          [tenantId, noAwardDraft.id],
        )
      ).rows[0]!.state,
      "VOID",
    );

    const approvalRfq = await createRfq("rfq-approval", [suppliers[2]!]);
    assert.equal(
      (
        await command(
          `/api/v1/rfqs/${approvalRfq.id}/commands/issue`,
          "approval-rfq-issue",
          1,
        )
      ).status,
      200,
    );
    const approvalQuote = await createQuote(
      "approval-quote",
      approvalRfq.id,
      suppliers[2]!,
    );
    assert.equal(
      (
        await command(
          `/api/v1/quotations/${approvalQuote.id}/commands/submit`,
          "approval-quote-submit",
          1,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await command(
          `/api/v1/rfqs/${approvalRfq.id}/commands/close-submissions`,
          "approval-rfq-close-submissions",
          2,
        )
      ).status,
      200,
    );
    const approvalPolicyId = randomUUID();
    const pendingApprovalId = randomUUID();
    const cancelledApprovalId = randomUUID();
    await db.pool.query(
      "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,$2,'RFQ-AWARD-TEST',1,'ACTIVE')",
      [approvalPolicyId, tenantId],
    );
    for (const [approvalId, state] of [
      [pendingApprovalId, "PENDING"],
      [cancelledApprovalId, "CANCELLED"],
    ]) {
      await db.pool.query(
        `INSERT INTO control.approval_requests
          (id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state)
         VALUES($1,$2,'RFQ_AWARD',$3,$4,1,$5,$6)`,
        [
          approvalId,
          tenantId,
          approvalRfq.id,
          approvalPolicyId,
          randomUUID(),
          state,
        ],
      );
    }
    const pendingAward = await command(
      `/api/v1/rfqs/${approvalRfq.id}/commands/award`,
      "approval-award-pending",
      3,
      { quotation_id: approvalQuote.id },
    );
    assert.equal(pendingAward.status, 422);
    await db.pool.query(
      "UPDATE control.approval_requests SET state='APPROVED' WHERE tenant_id=$1 AND id IN ($2,$3)",
      [tenantId, pendingApprovalId, cancelledApprovalId],
    );
    const prospectAward = await command(
      `/api/v1/rfqs/${approvalRfq.id}/commands/award`,
      "approval-award-prospect-supplier",
      3,
      { quotation_id: approvalQuote.id, approval_id: pendingApprovalId },
    );
    assert.equal(prospectAward.status, 422);
    await db.pool.query(
      "UPDATE procurement.suppliers SET state='APPROVED',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [tenantId, suppliers[2]],
    );
    const approvedAward = await command(
      `/api/v1/rfqs/${approvalRfq.id}/commands/award`,
      "approval-award-approved",
      3,
      { quotation_id: approvalQuote.id, approval_id: pendingApprovalId },
    );
    assert.equal(approvedAward.status, 200, await approvedAward.clone().text());
    const awardEvent = await db.pool.query(
      "SELECT payload FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='RFQ.AWARDED'",
      [tenantId, approvalRfq.id],
    );
    assert.equal(awardEvent.rowCount, 1);
    assert.equal(
      awardEvent.rows[0]!.payload.payload.approval_reference,
      pendingApprovalId,
    );

    const cancelRfq = await createRfq("rfq-cancel", [
      suppliers[0]!,
      suppliers[1]!,
    ]);
    const updateCancelDraft = await command(
      `/api/v1/rfqs/${cancelRfq.id}/commands/update-draft`,
      "rfq-update-draft",
      1,
      { title: "Updated cancellation RFQ" },
    );
    assert.equal(updateCancelDraft.status, 200);
    assert.equal(
      (
        await command(
          `/api/v1/rfqs/${cancelRfq.id}/commands/issue`,
          "cancel-issue",
          2,
        )
      ).status,
      200,
    );
    const cancelDraft = await createQuote(
      "cancel-draft",
      cancelRfq.id,
      suppliers[0]!,
    );
    const updateQuotationDraft = await command(
      `/api/v1/quotations/${cancelDraft.id}/commands/update-draft`,
      "quotation-update-draft",
      1,
      { total: 25 },
    );
    assert.equal(updateQuotationDraft.status, 200);
    const cancelSubmitted = await post(
      "/api/v1/quotations",
      "cancel-submitted",
      {
        rfq_id: cancelRfq.id,
        supplier_id: suppliers[1],
        currency: "USD",
        total: 10,
        lines: [{ description: "Cable", quantity: 1, unit_price: 10 }],
        reason: "Prepare cancellation test",
      },
    );
    assert.equal(
      cancelSubmitted.status,
      201,
      await cancelSubmitted.clone().text(),
    );
    const cancelQuote = (
      (await cancelSubmitted.json()) as { data: { id: string } }
    ).data;
    assert.equal(
      (
        await command(
          `/api/v1/quotations/${cancelQuote.id}/commands/submit`,
          "cancel-submit",
          1,
        )
      ).status,
      200,
    );
    const cancelled = await command(
      `/api/v1/rfqs/${cancelRfq.id}/commands/cancel`,
      "rfq-cancel",
      3,
    );
    assert.equal(cancelled.status, 200, await cancelled.clone().text());
    const cancelledQuotes = await db.pool.query(
      "SELECT id,state FROM procurement.quotations WHERE tenant_id=$1 AND rfq_id=$2",
      [tenantId, cancelRfq.id],
    );
    assert.deepEqual(cancelledQuotes.rows.map((row) => row.state).sort(), [
      "VOID",
      "VOID",
    ]);
    assert.deepEqual(
      cancelledQuotes.rows.map((row) => String(row.id)).sort(),
      [cancelDraft.id, cancelQuote.id].sort(),
    );

    const timeline = await get(`/api/v1/rfqs/${noAwardRfq.id}/timeline`);
    assert.equal(timeline.status, 200);
    assert.equal(
      ((await timeline.json()) as { data: unknown[] }).data.length,
      4,
    );
    const persistedEffects = await db.pool.query(
      `SELECT
        (SELECT count(*)::int FROM procurement.rfq_history WHERE tenant_id=$1 AND rfq_id=$2) AS rfq_history,
        (SELECT count(*)::int FROM procurement.quotation_history h JOIN procurement.quotations q ON q.tenant_id=h.tenant_id AND q.id=h.quotation_id WHERE h.tenant_id=$1 AND q.rfq_id=$2) AS quote_history,
        (SELECT count(*)::int FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2::text) AS outbox,
        (SELECT count(*)::int FROM audit.audit_events WHERE tenant_id=$1 AND subject->>'entity_id'=$2::text) AS audit`,
      [tenantId, noAwardRfq.id],
    );
    assert.deepEqual(persistedEffects.rows[0], {
      rfq_history: 4,
      quote_history: 8,
      outbox: 4,
      audit: 4,
    });
    const detail = await get(`/api/v1/rfqs/${noAwardRfq.id}`);
    assert.equal(detail.status, 200);
    tenant = "other-tenant";
    assert.equal((await get(`/api/v1/rfqs/${noAwardRfq.id}`)).status, 404);
  } finally {
    server.close();
    await db.close();
  }
});
