import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

export type RfqEvent = {
  type: string;
  aggregateType: "RFQ" | "QUOTATION";
  aggregateId: string;
  version: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type RfqCommandResult = {
  data: Record<string, unknown>;
  status: number;
  events: RfqEvent[];
};

export type RfqCommandInput = {
  tx: Transaction;
  actorId: string;
  correlationId: string;
  reason: string;
  command: string;
  id?: string;
  expectedVersion?: number;
  body: Record<string, unknown>;
};

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeRfq(row: Record<string, unknown>, suppliers: string[] = []) {
  return {
    id: String(row.id),
    code: String(row.code),
    procurement_request_id: row.procurement_request_id ?? null,
    title: String(row.title),
    description: row.description ?? null,
    state: String(row.state),
    currency: String(row.currency).trim(),
    submission_deadline: row.submission_deadline,
    issued_at: row.issued_at ?? null,
    terms: row.terms,
    supplier_ids: suppliers,
    awarded_quotation_id: row.awarded_quotation_id ?? null,
    award_approval_id: row.award_approval_id ?? null,
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeQuotation(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    rfq_id: String(row.rfq_id),
    supplier_id: String(row.supplier_id),
    revision_number: Number(row.revision_number),
    replaces_quotation_id: row.replaces_quotation_id ?? null,
    state: String(row.state),
    currency: String(row.currency).trim(),
    quote_number: String(row.quote_number),
    total: String(row.total),
    valid_until: row.valid_until ?? null,
    lead_time_days: row.lead_time_days ?? null,
    payment_terms: row.payment_terms ?? null,
    warranty: row.warranty ?? null,
    delivery_terms: row.delivery_terms ?? null,
    terms: row.terms,
    lines: row.lines,
    attachments: row.attachments,
    submitted_at: row.submitted_at ?? null,
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function snapshot(row: Record<string, unknown>, kind: "RFQ" | "QUOTATION") {
  return kind === "RFQ" ? safeRfq(row) : safeQuotation(row);
}

async function suppliersFor(tx: Transaction, rfqId: string) {
  const result = await tx.query(
    "SELECT supplier_id FROM procurement.rfq_suppliers WHERE tenant_id=$1 AND rfq_id=$2 ORDER BY supplier_id",
    [tx.tenantId, rfqId],
  );
  return result.rows.map((row) => String(row.supplier_id));
}

async function writeHistory(input: {
  tx: Transaction;
  kind: "RFQ" | "QUOTATION";
  id: string;
  version: number;
  command: string;
  previousState: string | null;
  newState: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  actorId: string;
  reason: string;
  correlationId: string;
}) {
  const table = input.kind === "RFQ" ? "rfq_history" : "quotation_history";
  const idColumn = input.kind === "RFQ" ? "rfq_id" : "quotation_id";
  await input.tx.query(
    `INSERT INTO procurement.${table}
       (id,tenant_id,${idColumn},entity_version,action,previous_state,new_state,before_snapshot,after_snapshot,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.id,
      input.version,
      input.command,
      input.previousState,
      input.newState,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.actorId,
      input.reason,
      input.correlationId,
    ],
  );
}

function event(
  kind: "RFQ" | "QUOTATION",
  type: string,
  id: string,
  version: number,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  reason: string,
): RfqEvent {
  return {
    type,
    aggregateType: kind,
    aggregateId: id,
    version,
    before,
    after,
    payload: {
      [kind === "RFQ" ? "rfq_id" : "quotation_id"]: id,
      state: after.state,
      previous_state: before?.state ?? null,
      new_state: after.state,
      version,
      reason,
      ...(kind === "QUOTATION"
        ? { rfq_id: after.rfq_id, supplier_id: after.supplier_id }
        : {}),
    },
  };
}

async function appendStateEvent(input: {
  tx: Transaction;
  kind: "RFQ" | "QUOTATION";
  id: string;
  row: Record<string, unknown>;
  command: string;
  type: string;
  previousState: string | null;
  actorId: string;
  reason: string;
  correlationId: string;
  before: Record<string, unknown> | null;
}) {
  const after = snapshot(input.row, input.kind);
  await writeHistory({
    tx: input.tx,
    kind: input.kind,
    id: input.id,
    version: Number(input.row.version),
    command: input.command,
    previousState: input.previousState,
    newState: String(input.row.state),
    before: input.before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return event(
    input.kind,
    input.type,
    input.id,
    Number(input.row.version),
    input.before,
    after,
    input.reason,
  );
}

async function getRfq(tx: Transaction, id: string, lock = false) {
  const result = await tx.query(
    `SELECT * FROM procurement.rfqs WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "RFQ was not found.");
  return result.rows[0]!;
}

async function getQuotation(tx: Transaction, id: string, lock = false) {
  const result = await tx.query(
    `SELECT * FROM procurement.quotations WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Quotation was not found.");
  return result.rows[0]!;
}

async function validateSupplier(
  tx: Transaction,
  supplierId: string,
  award = false,
) {
  const result = await tx.query(
    "SELECT state FROM procurement.suppliers WHERE tenant_id=$1 AND id=$2 FOR SHARE",
    [tx.tenantId, supplierId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Supplier was not found.");
  const state = String(result.rows[0]!.state);
  const eligible = award
    ? ["APPROVED", "PREFERRED"].includes(state)
    : ["PROSPECT", "APPROVED", "PREFERRED"].includes(state);
  if (!eligible)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      award
        ? "Only APPROVED or PREFERRED suppliers can be awarded."
        : "Supplier is not eligible to participate in this RFQ.",
    );
  return state;
}

function requireState(actual: unknown, expected: string, entity: string) {
  if (actual !== expected)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      `${entity} must be ${expected} for this command.`,
    );
}

async function insertQuotationState(input: {
  tx: Transaction;
  row: Record<string, unknown>;
  state: string;
  command: string;
  eventType: string;
  actorId: string;
  reason: string;
  correlationId: string;
  before: Record<string, unknown>;
}) {
  const previousState = String(input.row.state);
  const result = await input.tx.query(
    "UPDATE procurement.quotations SET state=$1,version=version+1,updated_at=now(),submitted_at=CASE WHEN $1='SUBMITTED' THEN now() ELSE submitted_at END WHERE tenant_id=$2 AND id=$3 RETURNING *",
    [input.state, input.tx.tenantId, input.row.id],
  );
  return appendStateEvent({
    tx: input.tx,
    kind: "QUOTATION",
    id: String(input.row.id),
    row: result.rows[0]!,
    command: input.command,
    type: input.eventType,
    previousState,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    before: input.before,
  });
}

export async function executeRfqCommand(
  input: RfqCommandInput,
): Promise<RfqCommandResult> {
  const { tx, command, body } = input;
  const now = new Date();
  if (command === "RFQ.CREATE") {
    const id = randomUUID();
    const title = String(body.title ?? "").trim();
    const currency = String(body.currency ?? "")
      .trim()
      .toUpperCase();
    const deadline = new Date(String(body.submission_deadline ?? ""));
    const supplierIds = Array.isArray(body.supplier_ids)
      ? [...new Set(body.supplier_ids.map(String))]
      : [];
    if (
      !title ||
      title.length > 240 ||
      !/^[A-Z]{3}$/.test(currency) ||
      !Number.isFinite(deadline.getTime()) ||
      deadline <= now ||
      !supplierIds.length
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "RFQ title, future submission deadline, currency and at least one candidate Supplier are required.",
      );
    if (body.procurement_request_id) {
      const request = await tx.query(
        "SELECT id,state FROM procurement.procurement_requests WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, body.procurement_request_id],
      );
      if (!request.rowCount)
        throw new ApplicationError(
          "NOT_FOUND",
          "Procurement Request was not found.",
        );
      if (request.rows[0]!.state !== "WAITING_RFQ")
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "RFQ can only be created for a Procurement Request in WAITING_RFQ.",
        );
    }
    for (const supplierId of supplierIds)
      await validateSupplier(tx, supplierId);
    const code = `RFQ-${id.toUpperCase()}`;
    const inserted = await tx.query(
      `INSERT INTO procurement.rfqs(id,tenant_id,code,procurement_request_id,title,description,currency,submission_deadline,terms,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
      [
        id,
        tx.tenantId,
        code,
        body.procurement_request_id ?? null,
        title,
        body.description ?? null,
        currency,
        deadline.toISOString(),
        JSON.stringify(asObject(body.terms)),
        input.actorId,
      ],
    );
    for (const supplierId of supplierIds)
      await tx.query(
        "INSERT INTO procurement.rfq_suppliers(tenant_id,rfq_id,supplier_id) VALUES($1,$2,$3)",
        [tx.tenantId, id, supplierId],
      );
    const row = inserted.rows[0]!;
    const after = safeRfq(row, supplierIds);
    const created = await appendStateEvent({
      tx,
      kind: "RFQ",
      id,
      row,
      command,
      type: "RFQ.CREATED",
      previousState: null,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      before: null,
    });
    created.after = after;
    Object.assign(created.payload, {
      procurement_request_id: after.procurement_request_id,
      supplier_ids: supplierIds,
      due_at: after.submission_deadline,
    });
    return { data: after, status: 201, events: [created] };
  }

  if (command.startsWith("RFQ.")) {
    const rfqId = input.id!;
    const current = await getRfq(tx, rfqId, true);
    assertVersion(Number(current.version), input.expectedVersion!);
    const before = safeRfq(current, await suppliersFor(tx, rfqId));
    let targetState = String(current.state);
    let eventType = "";
    if (command === "RFQ.UPDATE_DRAFT") {
      requireState(current.state, "DRAFT", "RFQ");
      const title =
        body.title === undefined ? current.title : String(body.title).trim();
      const deadline =
        body.submission_deadline === undefined
          ? current.submission_deadline
          : new Date(String(body.submission_deadline));
      const currency =
        body.currency === undefined
          ? String(current.currency).trim()
          : String(body.currency).trim().toUpperCase();
      const suppliers =
        body.supplier_ids === undefined
          ? (before.supplier_ids as string[])
          : [...new Set((body.supplier_ids as unknown[]).map(String))];
      if (
        !title ||
        title.length > 240 ||
        !/^[A-Z]{3}$/.test(currency) ||
        !Number.isFinite(new Date(deadline).getTime()) ||
        new Date(deadline) <= now ||
        !suppliers.length
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "RFQ draft fields are invalid.",
        );
      for (const sid of suppliers) await validateSupplier(tx, sid);
      const changed = await tx.query(
        `UPDATE procurement.rfqs SET title=$1,description=$2,currency=$3,submission_deadline=$4,terms=$5::jsonb,version=version+1,updated_at=now()
         WHERE tenant_id=$6 AND id=$7 RETURNING *`,
        [
          title,
          body.description === undefined
            ? current.description
            : body.description,
          currency,
          deadline,
          JSON.stringify(
            body.terms === undefined ? current.terms : asObject(body.terms),
          ),
          tx.tenantId,
          rfqId,
        ],
      );
      if (body.supplier_ids !== undefined) {
        await tx.query(
          "DELETE FROM procurement.rfq_suppliers WHERE tenant_id=$1 AND rfq_id=$2",
          [tx.tenantId, rfqId],
        );
        for (const sid of suppliers)
          await tx.query(
            "INSERT INTO procurement.rfq_suppliers(tenant_id,rfq_id,supplier_id) VALUES($1,$2,$3)",
            [tx.tenantId, rfqId, sid],
          );
      }
      const row = changed.rows[0]!;
      const after = safeRfq(row, suppliers);
      const fact = await appendStateEvent({
        tx,
        kind: "RFQ",
        id: rfqId,
        row,
        command,
        type: "RFQ.UPDATED",
        previousState: "DRAFT",
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId,
        before,
      });
      fact.after = after;
      fact.payload.changed_fields = Object.keys(body)
        .filter((field) => field !== "reason")
        .sort();
      return { data: after, status: 200, events: [fact] };
    }
    if (command === "RFQ.ISSUE") {
      requireState(current.state, "DRAFT", "RFQ");
      const candidates = await suppliersFor(tx, rfqId);
      if (!candidates.length)
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "RFQ must have at least one candidate Supplier.",
        );
      for (const sid of candidates) await validateSupplier(tx, sid);
      targetState = "OPEN";
      eventType = "RFQ.ISSUED";
    } else if (command === "RFQ.CLOSE_SUBMISSIONS") {
      requireState(current.state, "OPEN", "RFQ");
      targetState = "EVALUATING";
      eventType = "RFQ.SUBMISSIONS_CLOSED";
    } else if (command === "RFQ.CANCEL") {
      if (!["DRAFT", "OPEN", "EVALUATING"].includes(String(current.state)))
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "RFQ cannot be cancelled from its current state.",
        );
      targetState = "CANCELLED";
      eventType = "RFQ.CANCELLED";
    } else if (command === "RFQ.CLOSE_NO_AWARD") {
      requireState(current.state, "EVALUATING", "RFQ");
      targetState = "CLOSED_NO_AWARD";
      eventType = "RFQ.CLOSED_NO_AWARD";
    } else if (command !== "RFQ.AWARD") {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unsupported RFQ command.",
      );
    }
    let selectedId: string | null = null;
    let approvalId: string | null = null;
    if (command === "RFQ.AWARD") {
      requireState(current.state, "EVALUATING", "RFQ");
      selectedId = String(body.quotation_id ?? "");
      if (!selectedId)
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "quotation_id is required for award.",
        );
      const approvalRows = await tx.query(
        `SELECT id,state,tenant_id,source_type,source_id FROM control.approval_requests WHERE tenant_id=$1 AND source_type='RFQ_AWARD' AND source_id=$2 ORDER BY created_at DESC FOR UPDATE`,
        [tx.tenantId, rfqId],
      );
      if (approvalRows.rows.length) {
        const suppliedId = body.approval_id ? String(body.approval_id) : null;
        const approval = approvalRows.rows.find(
          (row) => !suppliedId || String(row.id) === suppliedId,
        );
        if (
          !approval ||
          approvalRows.rows.some(
            (row) =>
              row.state !== "APPROVED" ||
              row.tenant_id !== tx.tenantId ||
              row.source_type !== "RFQ_AWARD" ||
              String(row.source_id) !== rfqId,
          )
        )
          throw new ApplicationError(
            "BUSINESS_RULE_VIOLATION",
            "Every approval request linked to this RFQ award must be APPROVED.",
          );
        approvalId = String(approval.id);
      } else if (body.approval_id) {
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "The supplied approval is not an approval for this RFQ award.",
        );
      }
      const selected = await getQuotation(tx, selectedId, true);
      if (String(selected.rfq_id) !== rfqId)
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "Selected quotation does not belong to this RFQ.",
        );
      requireState(selected.state, "SUBMITTED", "Selected quotation");
      await validateSupplier(tx, String(selected.supplier_id), true);
      targetState = "AWARDED";
      eventType = "RFQ.AWARDED";
    }
    const quotes =
      command === "RFQ.CANCEL" ||
      command === "RFQ.CLOSE_NO_AWARD" ||
      command === "RFQ.AWARD"
        ? await tx.query(
            "SELECT * FROM procurement.quotations WHERE tenant_id=$1 AND rfq_id=$2 AND state IN ('DRAFT','SUBMITTED') ORDER BY id FOR UPDATE",
            [tx.tenantId, rfqId],
          )
        : { rows: [] as Record<string, unknown>[] };
    if (command === "RFQ.AWARD") {
      const selected =
        quotes.rows.find((row) => String(row.id) === selectedId) ??
        (await getQuotation(tx, selectedId!, true));
      if (selected.state !== "SUBMITTED")
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "Selected quotation is not submitted.",
        );
    }
    const facts: RfqEvent[] = [];
    for (const quote of quotes.rows) {
      const quoteBefore = safeQuotation(quote);
      let next: string | null = null;
      let type = "";
      if (
        command === "RFQ.CANCEL" ||
        ((command === "RFQ.AWARD" || command === "RFQ.CLOSE_NO_AWARD") &&
          quote.state === "DRAFT")
      ) {
        next = "VOID";
        type = "QUOTATION.VOIDED";
      } else if (
        command === "RFQ.CLOSE_NO_AWARD" &&
        quote.state === "SUBMITTED"
      ) {
        next = "REJECTED";
        type = "QUOTATION.REJECTED";
      } else if (command === "RFQ.AWARD" && quote.state === "SUBMITTED") {
        next = String(quote.id) === selectedId ? "ACCEPTED" : "REJECTED";
        type = `QUOTATION.${next}`;
      }
      if (next)
        facts.push(
          await insertQuotationState({
            tx,
            row: quote,
            state: next,
            command,
            eventType: type,
            actorId: input.actorId,
            reason: input.reason,
            correlationId: input.correlationId,
            before: quoteBefore,
          }),
        );
    }
    const updated = await tx.query(
      "UPDATE procurement.rfqs SET state=$1,awarded_quotation_id=$2,award_approval_id=$3,issued_at=CASE WHEN $1='OPEN' THEN now() ELSE issued_at END,version=version+1,updated_at=now() WHERE tenant_id=$4 AND id=$5 RETURNING *",
      [targetState, selectedId, approvalId, tx.tenantId, rfqId],
    );
    const row = updated.rows[0]!;
    const fact = await appendStateEvent({
      tx,
      kind: "RFQ",
      id: rfqId,
      row,
      command,
      type: eventType,
      previousState: String(current.state),
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      before,
    });
    if (command === "RFQ.ISSUE") {
      Object.assign(fact.payload, {
        procurement_request_id: current.procurement_request_id,
        supplier_ids: before.supplier_ids,
        issued_at: row.updated_at,
        due_at: row.submission_deadline,
      });
    }
    if (command === "RFQ.CANCEL")
      fact.payload.voided_quotation_ids = facts.map((item) => item.aggregateId);
    if (command === "RFQ.CLOSE_NO_AWARD")
      Object.assign(fact.payload, {
        rejected_quotation_ids: facts
          .filter((item) => item.type === "QUOTATION.REJECTED")
          .map((item) => item.aggregateId),
        voided_quotation_ids: facts
          .filter((item) => item.type === "QUOTATION.VOIDED")
          .map((item) => item.aggregateId),
      });
    if (command === "RFQ.AWARD") {
      const selectedQuote = quotes.rows.find(
        (quote) => String(quote.id) === selectedId,
      )!;
      Object.assign(fact.payload, {
        selected_quotation_id: selectedId,
        selected_supplier_id: selectedQuote.supplier_id,
        approval_reference: approvalId,
        rejected_quotation_ids: facts
          .filter((item) => item.type === "QUOTATION.REJECTED")
          .map((item) => item.aggregateId),
        voided_quotation_ids: facts
          .filter((item) => item.type === "QUOTATION.VOIDED")
          .map((item) => item.aggregateId),
      });
    }
    const after = safeRfq(row, before.supplier_ids as string[]);
    fact.after = after;
    return { data: after, status: 200, events: [fact, ...facts] };
  }

  if (command === "QUOTATION.CREATE") {
    const rfqId = String(body.rfq_id ?? "");
    const supplierId = String(body.supplier_id ?? "");
    if (!rfqId || !supplierId)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "rfq_id and supplier_id are required.",
      );
    const rfq = await getRfq(tx, rfqId, true);
    requireState(rfq.state, "OPEN", "RFQ");
    if (!(await suppliersFor(tx, rfqId)).includes(supplierId))
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Supplier is not an RFQ candidate.",
      );
    await validateSupplier(tx, supplierId);
    const previousId = body.replaces_quotation_id
      ? String(body.replaces_quotation_id)
      : null;
    let revision = 1;
    if (previousId) {
      const previous = await getQuotation(tx, previousId, true);
      if (
        String(previous.rfq_id) !== rfqId ||
        String(previous.supplier_id) !== supplierId ||
        previous.state !== "WITHDRAWN"
      )
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "A revision must replace a withdrawn quotation for the same RFQ and Supplier.",
        );
      const latest = await tx.query(
        "SELECT COALESCE(MAX(revision_number),0)::int AS revision FROM procurement.quotations WHERE tenant_id=$1 AND rfq_id=$2 AND supplier_id=$3",
        [tx.tenantId, rfqId, supplierId],
      );
      revision = Number(latest.rows[0]!.revision) + 1;
    }
    const currency = String(body.currency ?? rfq.currency)
      .trim()
      .toUpperCase();
    const total = Number(body.total);
    if (
      !/^[A-Z]{3}$/.test(currency) ||
      !Number.isFinite(total) ||
      total < 0 ||
      !Array.isArray(body.lines)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Quotation currency, non-negative total and lines are required.",
      );
    const id = randomUUID();
    const quoteNumber = `QUO-${id.toUpperCase()}`;
    const inserted = await tx.query(
      `INSERT INTO procurement.quotations(id,tenant_id,rfq_id,supplier_id,quote_number,revision_number,replaces_quotation_id,currency,total,valid_until,lead_time_days,payment_terms,warranty,delivery_terms,terms,lines,attachments,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18) RETURNING *`,
      [
        id,
        tx.tenantId,
        rfqId,
        supplierId,
        quoteNumber,
        revision,
        previousId,
        currency,
        total,
        body.valid_until ?? null,
        body.lead_time_days ?? null,
        body.payment_terms ?? null,
        body.warranty ?? null,
        body.delivery_terms ?? null,
        JSON.stringify(asObject(body.terms)),
        JSON.stringify(body.lines),
        JSON.stringify(Array.isArray(body.attachments) ? body.attachments : []),
        input.actorId,
      ],
    );
    const row = inserted.rows[0]!;
    const after = safeQuotation(row);
    const fact = await appendStateEvent({
      tx,
      kind: "QUOTATION",
      id,
      row,
      command,
      type: "QUOTATION.CREATED",
      previousState: null,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      before: null,
    });
    fact.after = after;
    Object.assign(fact.payload, {
      rfq_id: after.rfq_id,
      supplier_id: after.supplier_id,
      replaces_quotation_id: after.replaces_quotation_id,
      revision_number: after.revision_number,
    });
    return { data: after, status: 201, events: [fact] };
  }

  const quotationId = input.id!;
  const hint = await getQuotation(tx, quotationId);
  const rfq = await getRfq(tx, String(hint.rfq_id), true);
  const current = await getQuotation(tx, quotationId, true);
  assertVersion(Number(current.version), input.expectedVersion!);
  const before = safeQuotation(current);
  let target: string;
  let eventType: string;
  if (command === "QUOTATION.UPDATE_DRAFT") {
    requireState(current.state, "DRAFT", "Quotation");
    const currency =
      body.currency === undefined
        ? String(current.currency).trim()
        : String(body.currency).trim().toUpperCase();
    const total =
      body.total === undefined ? Number(current.total) : Number(body.total);
    const lines = body.lines === undefined ? current.lines : body.lines;
    if (
      !/^[A-Z]{3}$/.test(currency) ||
      !Number.isFinite(total) ||
      total < 0 ||
      !Array.isArray(lines)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Quotation draft fields are invalid.",
      );
    const updated = await tx.query(
      "UPDATE procurement.quotations SET currency=$1,total=$2,valid_until=$3,lead_time_days=$4,payment_terms=$5,warranty=$6,delivery_terms=$7,terms=$8::jsonb,lines=$9::jsonb,attachments=$10::jsonb,version=version+1,updated_at=now() WHERE tenant_id=$11 AND id=$12 RETURNING *",
      [
        currency,
        total,
        body.valid_until === undefined ? current.valid_until : body.valid_until,
        body.lead_time_days === undefined
          ? current.lead_time_days
          : body.lead_time_days,
        body.payment_terms === undefined
          ? current.payment_terms
          : body.payment_terms,
        body.warranty === undefined ? current.warranty : body.warranty,
        body.delivery_terms === undefined
          ? current.delivery_terms
          : body.delivery_terms,
        JSON.stringify(
          body.terms === undefined ? current.terms : asObject(body.terms),
        ),
        JSON.stringify(lines),
        JSON.stringify(
          body.attachments === undefined
            ? current.attachments
            : body.attachments,
        ),
        tx.tenantId,
        quotationId,
      ],
    );
    const after = safeQuotation(updated.rows[0]!);
    const fact = await appendStateEvent({
      tx,
      kind: "QUOTATION",
      id: quotationId,
      row: updated.rows[0]!,
      command,
      type: "QUOTATION.UPDATED",
      previousState: "DRAFT",
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      before,
    });
    fact.after = after;
    fact.payload.changed_fields = Object.keys(body)
      .filter((field) => field !== "reason")
      .sort();
    return { data: after, status: 200, events: [fact] };
  }
  if (command === "QUOTATION.SUBMIT") {
    requireState(current.state, "DRAFT", "Quotation");
    requireState(rfq.state, "OPEN", "RFQ");
    if (new Date(String(rfq.submission_deadline)) <= now)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "RFQ submission deadline has passed.",
      );
    if (
      !(await suppliersFor(tx, String(rfq.id))).includes(
        String(current.supplier_id),
      )
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Supplier is no longer an RFQ candidate.",
      );
    await validateSupplier(tx, String(current.supplier_id));
    target = "SUBMITTED";
    eventType = "QUOTATION.SUBMITTED";
    const active = await tx.query(
      "SELECT id FROM procurement.quotations WHERE tenant_id=$1 AND rfq_id=$2 AND supplier_id=$3 AND state='SUBMITTED' AND id<>$4",
      [tx.tenantId, current.rfq_id, current.supplier_id, current.id],
    );
    if (active.rowCount)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "This Supplier already has a current submitted quotation for this RFQ.",
      );
  } else if (command === "QUOTATION.WITHDRAW") {
    if (
      !["DRAFT", "SUBMITTED"].includes(String(current.state)) ||
      !["OPEN", "EVALUATING"].includes(String(rfq.state))
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Quotation cannot be withdrawn from its current state or parent RFQ.",
      );
    target = "WITHDRAWN";
    eventType = "QUOTATION.WITHDRAWN";
  } else if (command === "QUOTATION.DISQUALIFY") {
    requireState(current.state, "SUBMITTED", "Quotation");
    requireState(rfq.state, "EVALUATING", "RFQ");
    target = "DISQUALIFIED";
    eventType = "QUOTATION.DISQUALIFIED";
  } else
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported Quotation command.",
    );
  const updated = await tx.query(
    "UPDATE procurement.quotations SET state=$1,version=version+1,updated_at=now(),submitted_at=CASE WHEN $1='SUBMITTED' THEN now() ELSE submitted_at END WHERE tenant_id=$2 AND id=$3 RETURNING *",
    [target, tx.tenantId, quotationId],
  );
  const after = safeQuotation(updated.rows[0]!);
  const fact = await appendStateEvent({
    tx,
    kind: "QUOTATION",
    id: quotationId,
    row: updated.rows[0]!,
    command,
    type: eventType,
    previousState: String(current.state),
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    before,
  });
  fact.after = after;
  Object.assign(fact.payload, {
    rfq_id: current.rfq_id,
    supplier_id: current.supplier_id,
  });
  if (command === "QUOTATION.SUBMIT")
    fact.payload.revision_number = current.revision_number;
  return { data: after, status: 200, events: [fact] };
}

export async function readRfq(tx: Transaction, id: string) {
  const row = await getRfq(tx, id);
  return safeRfq(row, await suppliersFor(tx, id));
}

export async function readQuotation(tx: Transaction, id: string) {
  return safeQuotation(await getQuotation(tx, id));
}

export async function listRfqs(
  tx: Transaction,
  limit: number,
  offset: number,
  state?: string | null,
) {
  const result = await tx.query(
    "SELECT * FROM procurement.rfqs WHERE tenant_id=$1 AND ($2::text IS NULL OR state=$2) ORDER BY created_at DESC,id LIMIT $3 OFFSET $4",
    [tx.tenantId, state ?? null, limit, offset],
  );
  const rows = [];
  for (const row of result.rows)
    rows.push(safeRfq(row, await suppliersFor(tx, String(row.id))));
  return rows;
}

export async function listQuotations(
  tx: Transaction,
  limit: number,
  offset: number,
  rfqId?: string | null,
  state?: string | null,
) {
  const result = await tx.query(
    "SELECT * FROM procurement.quotations WHERE tenant_id=$1 AND ($2::uuid IS NULL OR rfq_id=$2) AND ($3::text IS NULL OR state=$3) ORDER BY created_at DESC,id LIMIT $4 OFFSET $5",
    [tx.tenantId, rfqId ?? null, state ?? null, limit, offset],
  );
  return result.rows.map(safeQuotation);
}
