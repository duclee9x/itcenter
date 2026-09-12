import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import { normalizeSupplierDocumentNumber } from "../domain/invoice.js";
import {
  canonicalJson,
  currencyDigits,
  fingerprint,
  roundCurrency,
  validDecimal,
  validIsoDate,
} from "./invoice-primitives.js";
import { readApprovalRequestForSource } from "../../control-plane/index.js";

export type InvoiceCommand =
  | "INVOICE.CREATE"
  | "INVOICE.UPDATE_DRAFT"
  | "INVOICE.CANCEL"
  | "INVOICE.SUBMIT"
  | "INVOICE.REEVALUATE_MATCH"
  | "INVOICE.APPROVE"
  | "INVOICE.REJECT"
  | "CREDIT_NOTE.CREATE"
  | "CREDIT_NOTE.UPDATE_DRAFT"
  | "CREDIT_NOTE.CANCEL"
  | "CREDIT_NOTE.SUBMIT"
  | "CREDIT_NOTE.APPLY"
  | "CREDIT_NOTE.REJECT";

export type InvoiceEvent = {
  type: string;
  aggregateType: "INVOICE" | "CREDIT_NOTE";
  aggregateId: string;
  version: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type InvoiceCommandResult = {
  data: Record<string, unknown>;
  status: number;
  events: InvoiceEvent[];
};

type InvoiceLineInput = {
  purchase_order_line_id: string | null;
  item_reference_id: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  tax_amount: number;
  discount_amount: number;
  charge_amount: number;
  line_total: number;
  evidence_document_refs: unknown[];
};

type CreditLineInput = {
  invoice_line_id: string;
  credited_quantity: number;
  credited_amount: number;
  reason: string | null;
};

type DraftInput = {
  supplier_id: string;
  supplier_document_number_original: string;
  supplier_document_number_normalized: string;
  invoice_date: string;
  currency: string;
  tax_amount: number;
  charge_amount: number;
  charges: Array<{ code: string; amount: number }>;
  gross_amount: number;
  purchase_order_id: string;
  lines: InvoiceLineInput[];
};

function error(
  code: ConstructorParameters<typeof ApplicationError>[0],
  message: string,
): never {
  throw new ApplicationError(code, message);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return error("VALIDATION_ERROR", `${name} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    return error("VALIDATION_ERROR", `${name} is invalid or missing.`);
  return value.trim();
}

function optionalText(value: unknown, name: string, max = 2000): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max)
    return error(
      "VALIDATION_ERROR",
      `${name} must be text of at most ${max} characters.`,
    );
  return value.trim() || null;
}

function uuid(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return error("VALIDATION_ERROR", `${name} must be a UUID.`);
  return value;
}

function currency(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value))
    return error("VALIDATION_ERROR", "currency must be an uppercase ISO code.");
  currencyDigits(value);
  return value;
}

function references(value: unknown, name: string): unknown[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 40 ||
    value.some(
      (item) => typeof item !== "string" && (!item || typeof item !== "object"),
    )
  )
    return error(
      "VALIDATION_ERROR",
      `${name} must be a bounded array of references.`,
    );
  return value;
}

function normalizeCharges(value: unknown, moneyCurrency: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 40)
    return error(
      "VALIDATION_ERROR",
      "charges must be an array of at most 40 entries.",
    );
  const seen = new Set<string>();
  return value.map((entry) => {
    const charge = record(entry, "charge");
    const code = text(charge.code, "charge.code", 80).toUpperCase();
    if (seen.has(code))
      return error("VALIDATION_ERROR", "Charge codes must be unique.");
    seen.add(code);
    return {
      code,
      amount: validDecimal(charge.amount, "charge.amount", {
        maxScale: Math.max(currencyDigits(moneyCurrency), 4),
      }),
    };
  });
}

function normalizeInvoiceLines(
  value: unknown,
  moneyCurrency: string,
): InvoiceLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200)
    return error(
      "VALIDATION_ERROR",
      "lines must contain between 1 and 200 entries.",
    );
  return value.map((entry) => {
    const line = record(entry, "invoice line");
    const poLineId =
      line.purchase_order_line_id === undefined ||
      line.purchase_order_line_id === null
        ? null
        : uuid(line.purchase_order_line_id, "purchase_order_line_id");
    const itemRef = optionalText(
      line.item_reference_id,
      "item_reference_id",
      256,
    );
    const quantity = validDecimal(line.quantity, "quantity", {
      min: 0.0001,
      maxScale: 4,
    });
    const unitPrice = validDecimal(line.unit_price, "unit_price", {
      maxScale: 6,
    });
    const tax = validDecimal(line.tax_amount ?? 0, "tax_amount", {
      maxScale: 4,
    });
    const discount = validDecimal(
      line.discount_amount ?? 0,
      "discount_amount",
      { maxScale: 4 },
    );
    const charges = validDecimal(line.charge_amount ?? 0, "charge_amount", {
      maxScale: 4,
    });
    const derived = roundCurrency(
      quantity * unitPrice - discount + tax + charges,
      moneyCurrency,
    );
    const lineTotal =
      line.line_total === undefined
        ? derived
        : validDecimal(line.line_total, "line_total", { maxScale: 4 });
    return {
      purchase_order_line_id: poLineId,
      item_reference_id: itemRef,
      description: text(line.description, "description", 1000),
      quantity,
      unit: optionalText(line.unit, "unit", 40),
      unit_price: unitPrice,
      tax_amount: tax,
      discount_amount: discount,
      charge_amount: charges,
      line_total: lineTotal,
      evidence_document_refs: references(
        line.evidence_document_refs,
        "evidence_document_refs",
      ),
    };
  });
}

function normalizeDraft(input: Record<string, unknown>): DraftInput {
  const moneyCurrency = currency(input.currency);
  const original = text(
    input.supplier_document_number,
    "supplier_document_number",
    240,
  );
  const lines = normalizeInvoiceLines(input.lines, moneyCurrency);
  const charges = normalizeCharges(input.charges, moneyCurrency);
  return {
    supplier_id: uuid(input.supplier_id, "supplier_id"),
    supplier_document_number_original: original,
    supplier_document_number_normalized:
      normalizeSupplierDocumentNumber(original),
    invoice_date: validIsoDate(input.invoice_date, "invoice_date"),
    currency: moneyCurrency,
    tax_amount: validDecimal(input.tax_amount ?? 0, "tax_amount", {
      maxScale: 4,
    }),
    charge_amount: charges.reduce((sum, item) => sum + item.amount, 0),
    charges,
    gross_amount: validDecimal(input.gross_amount, "gross_amount", {
      maxScale: 4,
    }),
    purchase_order_id: uuid(input.purchase_order_id, "purchase_order_id"),
    lines,
  };
}

function normalizeCreditLines(value: unknown): CreditLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200)
    return error(
      "VALIDATION_ERROR",
      "lines must contain between 1 and 200 entries.",
    );
  const seen = new Set<string>();
  return value.map((entry) => {
    const line = record(entry, "credit note line");
    const invoiceLineId = uuid(line.invoice_line_id, "invoice_line_id");
    if (seen.has(invoiceLineId))
      return error(
        "VALIDATION_ERROR",
        "An invoice line may appear only once per Credit Note.",
      );
    seen.add(invoiceLineId);
    const quantity = validDecimal(
      line.credited_quantity ?? 0,
      "credited_quantity",
      { maxScale: 4 },
    );
    const amount = validDecimal(line.credited_amount ?? 0, "credited_amount", {
      maxScale: 4,
    });
    if (quantity === 0 && amount === 0)
      return error(
        "VALIDATION_ERROR",
        "Each Credit Note line must credit quantity or amount.",
      );
    return {
      invoice_line_id: invoiceLineId,
      credited_quantity: quantity,
      credited_amount: amount,
      reason: optionalText(line.reason, "reason", 1000),
    };
  });
}

function safe(row: Record<string, unknown>) {
  const result = { ...row };
  delete result.tenant_id;
  for (const field of ["aggregate_version", "current_commercial_version"])
    if (result[field] !== undefined && result[field] !== null)
      result[field] = Number(result[field]);
  return result;
}

function snapshotSummary(row: Record<string, unknown>) {
  return {
    id: row.id,
    code: row.invoice_code ?? row.credit_note_code,
    lifecycle_state: row.lifecycle_state,
    match_status: row.match_status,
    aggregate_version: Number(row.aggregate_version),
  };
}

function event(
  type: string,
  aggregateType: InvoiceEvent["aggregateType"],
  aggregateId: string,
  version: number,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  payload: Record<string, unknown>,
): InvoiceEvent {
  return { type, aggregateType, aggregateId, version, before, after, payload };
}

async function invoiceRow(tx: Transaction, id: string, lock = false) {
  const result = await tx.query(
    `SELECT i.*,s.legal_name AS supplier_current_name
       FROM procurement.invoices i
       JOIN procurement.suppliers s ON s.tenant_id=i.tenant_id AND s.id=i.supplier_id
      WHERE i.tenant_id=$1 AND i.id=$2${lock ? " FOR UPDATE OF i" : ""}`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Invoice was not found.");
  return result.rows[0]! as Record<string, unknown>;
}

async function creditNoteRow(tx: Transaction, id: string, lock = false) {
  const result = await tx.query(
    `SELECT c.*,i.invoice_code,i.lifecycle_state AS invoice_lifecycle_state,
            i.purchase_order_id,i.purchase_order_code_snapshot
       FROM procurement.credit_notes c
       JOIN procurement.invoices i ON i.tenant_id=c.tenant_id AND i.id=c.invoice_id
      WHERE c.tenant_id=$1 AND c.id=$2${lock ? " FOR UPDATE OF c" : ""}`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Credit Note was not found.");
  return result.rows[0]! as Record<string, unknown>;
}

async function poSnapshot(tx: Transaction, poId: string, lock: boolean) {
  const result = await tx.query(
    `SELECT p.id,p.code,p.lifecycle_state,p.receipt_state,p.aggregate_version,
            p.current_commercial_version,p.currency,p.supplier_id,
            s.legal_name AS supplier_display_snapshot
       FROM procurement.purchase_orders p
       JOIN procurement.suppliers s ON s.tenant_id=p.tenant_id AND s.id=p.supplier_id
      WHERE p.tenant_id=$1 AND p.id=$2${lock ? " FOR UPDATE OF p" : ""}`,
    [tx.tenantId, poId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Purchase Order was not found.");
  return result.rows[0]! as Record<string, unknown>;
}

async function validatePoDraft(tx: Transaction, draft: DraftInput) {
  const po = await poSnapshot(tx, draft.purchase_order_id, true);
  if (po.current_commercial_version === null)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invoice requires a PO with an issued commercial version.",
    );
  const version = await tx.query(
    "SELECT snapshot FROM procurement.purchase_order_versions WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=$3",
    [tx.tenantId, draft.purchase_order_id, po.current_commercial_version],
  );
  if (!version.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "PO commercial version was not found.",
    );
  const poLineIds = draft.lines.map((line) => line.purchase_order_line_id);
  if (poLineIds.some((lineId) => !lineId))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Every Invoice line must reference a line from its Purchase Order.",
    );
  const poLines = await tx.query(
    `SELECT id FROM procurement.purchase_order_lines
      WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=$3 AND id=ANY($4::uuid[])`,
    [
      tx.tenantId,
      draft.purchase_order_id,
      po.current_commercial_version,
      poLineIds,
    ],
  );
  if (poLines.rowCount !== new Set(poLineIds).size)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Invoice lines must reference valid lines from the selected PO commercial version.",
    );
  const supplier = await tx.query(
    "SELECT legal_name FROM procurement.suppliers WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, draft.supplier_id],
  );
  if (!supplier.rowCount)
    throw new ApplicationError("NOT_FOUND", "Supplier was not found.");
  return {
    po,
    version: Number(po.current_commercial_version),
    poSnapshot: version.rows[0]!.snapshot as Record<string, unknown>,
    supplierName: String(supplier.rows[0]!.legal_name),
  };
}

async function invoiceLines(tx: Transaction, id: string) {
  return (
    await tx.query(
      "SELECT * FROM procurement.invoice_lines WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY line_number",
      [tx.tenantId, id],
    )
  ).rows as Record<string, unknown>[];
}

async function replaceInvoiceLines(
  tx: Transaction,
  id: string,
  lines: InvoiceLineInput[],
) {
  await tx.query(
    "DELETE FROM procurement.invoice_lines WHERE tenant_id=$1 AND invoice_id=$2",
    [tx.tenantId, id],
  );
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    await tx.query(
      `INSERT INTO procurement.invoice_lines
        (id,tenant_id,invoice_id,line_number,purchase_order_line_id,item_reference_id,description,quantity,unit,unit_price,tax_amount,discount_amount,charge_amount,line_total,evidence_document_refs)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
      [
        randomUUID(),
        tx.tenantId,
        id,
        index + 1,
        line.purchase_order_line_id,
        line.item_reference_id,
        line.description,
        line.quantity,
        line.unit,
        line.unit_price,
        line.tax_amount,
        line.discount_amount,
        line.charge_amount,
        line.line_total,
        JSON.stringify(line.evidence_document_refs),
      ],
    );
  }
}

async function invoiceDetail(tx: Transaction, id: string) {
  const row = await invoiceRow(tx, id);
  const lines = await invoiceLines(tx, id);
  const evaluations = await tx.query(
    "SELECT id,evaluation_version,match_status,reason_codes,expected_values,observed_values,evaluation_fingerprint,evaluated_at FROM procurement.invoice_match_evaluations WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY evaluation_version",
    [tx.tenantId, id],
  );
  const exceptions = await tx.query(
    "SELECT id,evaluation_id,reason_codes,evaluation_fingerprint,status,approval_request_id,created_at FROM procurement.invoice_match_exceptions WHERE tenant_id=$1 AND invoice_id=$2 ORDER BY created_at",
    [tx.tenantId, id],
  );
  const candidates = await tx.query(
    "SELECT candidate_document_id,status,created_at FROM procurement.invoice_duplicate_candidates WHERE tenant_id=$1 AND document_type='INVOICE' AND document_id=$2 ORDER BY created_at",
    [tx.tenantId, id],
  );
  const credits = await tx.query(
    `SELECT COALESCE(sum(cl.credited_quantity),0) AS credited_quantity,
            COALESCE(sum(cl.credited_amount),0) AS credited_amount,
            count(DISTINCT c.id) AS applied_count
       FROM procurement.credit_note_lines cl
       JOIN procurement.credit_notes c ON c.tenant_id=cl.tenant_id AND c.id=cl.credit_note_id AND c.lifecycle_state='APPLIED'
      WHERE cl.tenant_id=$1 AND cl.invoice_id=$2`,
    [tx.tenantId, id],
  );
  const creditQuantity = Number(credits.rows[0]!.credited_quantity);
  const creditAmount = Number(credits.rows[0]!.credited_amount);
  const originalQuantity = lines.reduce(
    (sum, line) => sum + Number(line.quantity),
    0,
  );
  const originalAmount = Number(row.gross_amount);
  const appliedCount = Number(credits.rows[0]!.applied_count);
  const creditStatus =
    appliedCount === 0
      ? "NONE"
      : creditAmount >= originalAmount && creditQuantity >= originalQuantity
        ? "FULLY_CREDITED"
        : "PARTIALLY_CREDITED";
  return {
    ...safe(row),
    aggregate_version: Number(row.aggregate_version),
    gross_amount: Number(row.gross_amount),
    tax_amount: Number(row.tax_amount),
    charge_amount: Number(row.charge_amount),
    charges: row.charges,
    lines: lines.map((line) => ({
      ...line,
      quantity: Number(line.quantity),
      unit_price: Number(line.unit_price),
      tax_amount: Number(line.tax_amount),
      discount_amount: Number(line.discount_amount),
      charge_amount: Number(line.charge_amount),
      line_total: Number(line.line_total),
    })),
    current_match_evaluation:
      evaluations.rows.find(
        (item) => item.id === row.current_match_evaluation_id,
      ) ?? null,
    match_evaluations: evaluations.rows,
    match_exceptions: exceptions.rows,
    duplicate_candidates: candidates.rows,
    derived_credit_status: creditStatus,
    credit_summary: {
      credited_quantity: creditQuantity,
      credited_amount: creditAmount,
    },
  };
}

async function noteLines(tx: Transaction, id: string) {
  return (
    await tx.query(
      "SELECT * FROM procurement.credit_note_lines WHERE tenant_id=$1 AND credit_note_id=$2 ORDER BY line_number",
      [tx.tenantId, id],
    )
  ).rows as Record<string, unknown>[];
}

async function noteDetail(tx: Transaction, id: string) {
  const row = await creditNoteRow(tx, id);
  return {
    ...safe(row),
    aggregate_version: Number(row.aggregate_version),
    total_amount: Number(row.total_amount),
    lines: (await noteLines(tx, id)).map((line) => ({
      ...line,
      credited_quantity: Number(line.credited_quantity),
      credited_amount: Number(line.credited_amount),
    })),
  };
}

async function history(input: {
  tx: Transaction;
  entity: "INVOICE" | "CREDIT_NOTE";
  id: string;
  version: number;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  actorId: string;
  reason: string | null;
  correlationId: string;
}) {
  const invoice = input.entity === "INVOICE";
  if (invoice)
    await input.tx.query(
      `INSERT INTO procurement.invoice_history(id,tenant_id,invoice_id,aggregate_version,action,previous_lifecycle_state,lifecycle_state,previous_match_status,match_status,before_snapshot,after_snapshot,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)`,
      [
        randomUUID(),
        input.tx.tenantId,
        input.id,
        input.version,
        input.action,
        input.before?.lifecycle_state ?? null,
        input.after.lifecycle_state,
        input.before?.match_status ?? null,
        input.after.match_status,
        input.before ? JSON.stringify(input.before) : null,
        JSON.stringify(input.after),
        input.actorId,
        input.reason,
        input.correlationId,
      ],
    );
  else
    await input.tx.query(
      `INSERT INTO procurement.credit_note_history(id,tenant_id,credit_note_id,aggregate_version,action,previous_state,state,before_snapshot,after_snapshot,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
      [
        randomUUID(),
        input.tx.tenantId,
        input.id,
        input.version,
        input.action,
        input.before?.lifecycle_state ?? null,
        input.after.lifecycle_state,
        input.before ? JSON.stringify(input.before) : null,
        JSON.stringify(input.after),
        input.actorId,
        input.reason,
        input.correlationId,
      ],
    );
}

function invoiceEventPayload(
  row: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    invoice_id: row.id,
    invoice_code: row.invoice_code,
    lifecycle_state: row.lifecycle_state,
    match_status: row.match_status,
    purchase_order_id: row.purchase_order_id,
    aggregate_version: Number(row.aggregate_version),
    reason_reference: extra.reason ? "audit" : undefined,
    ...extra,
  };
}

function creditEventPayload(
  row: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    credit_note_id: row.id,
    credit_note_code: row.credit_note_code,
    invoice_id: row.invoice_id,
    purchase_order_id: row.purchase_order_id,
    lifecycle_state: row.lifecycle_state,
    aggregate_version: Number(row.aggregate_version),
    ...extra,
  };
}

async function createInvoice(input: {
  tx: Transaction;
  body: Record<string, unknown>;
  actorId: string;
  correlationId: string;
  reason: string | null;
}) {
  const draft = normalizeDraft(input.body);
  const refs = await validatePoDraft(input.tx, draft);
  const id = randomUUID();
  const code = `INV-${id.slice(0, 8).toUpperCase()}`;
  const duplicateFp = fingerprint({
    supplier_id: draft.supplier_id,
    invoice_date: draft.invoice_date,
    currency: draft.currency,
    gross_amount: draft.gross_amount,
    purchase_order_id: draft.purchase_order_id,
  });
  await input.tx.query(
    `INSERT INTO procurement.invoices(id,tenant_id,invoice_code,supplier_id,supplier_display_snapshot,supplier_document_number_original,supplier_document_number_normalized,invoice_date,currency,tax_amount,charge_amount,charges,gross_amount,purchase_order_id,purchase_order_code_snapshot,po_commercial_version,duplicate_fingerprint,created_by,correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)`,
    [
      id,
      input.tx.tenantId,
      code,
      draft.supplier_id,
      refs.supplierName,
      draft.supplier_document_number_original,
      draft.supplier_document_number_normalized,
      draft.invoice_date,
      draft.currency,
      draft.tax_amount,
      draft.charge_amount,
      JSON.stringify(draft.charges),
      draft.gross_amount,
      draft.purchase_order_id,
      refs.po.code,
      refs.version,
      duplicateFp,
      input.actorId,
      input.correlationId,
    ],
  );
  await replaceInvoiceLines(input.tx, id, draft.lines);
  const row = await invoiceRow(input.tx, id);
  const detail = await invoiceDetail(input.tx, id);
  const summary = snapshotSummary(row);
  await history({
    tx: input.tx,
    entity: "INVOICE",
    id,
    version: 1,
    action: "INVOICE.CREATE",
    before: null,
    after: summary,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: detail,
    status: 201,
    events: [
      event(
        "INVOICE.CREATED",
        "INVOICE",
        id,
        1,
        null,
        summary,
        invoiceEventPayload(row, {
          purchase_order_id: draft.purchase_order_id,
          supplier_id: draft.supplier_id,
        }),
      ),
    ],
  } satisfies InvoiceCommandResult;
}

async function updateInvoice(input: {
  tx: Transaction;
  id: string;
  body: Record<string, unknown>;
  actorId: string;
  expectedVersion: number;
  correlationId: string;
  reason: string | null;
}) {
  const draft = normalizeDraft(input.body);
  const refs = await validatePoDraft(input.tx, draft);
  const current = await invoiceRow(input.tx, input.id, true);
  assertVersion(Number(current.aggregate_version), input.expectedVersion);
  if (current.lifecycle_state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a DRAFT Invoice can be updated.",
    );
  const version = input.expectedVersion + 1;
  const fp = fingerprint({
    supplier_id: draft.supplier_id,
    invoice_date: draft.invoice_date,
    currency: draft.currency,
    gross_amount: draft.gross_amount,
    purchase_order_id: draft.purchase_order_id,
  });
  await replaceInvoiceLines(input.tx, input.id, draft.lines);
  await input.tx.query(
    `UPDATE procurement.invoices SET supplier_id=$1,supplier_display_snapshot=$2,supplier_document_number_original=$3,supplier_document_number_normalized=$4,invoice_date=$5,currency=$6,tax_amount=$7,charge_amount=$8,charges=$9::jsonb,gross_amount=$10,purchase_order_id=$11,purchase_order_code_snapshot=$12,po_commercial_version=$13,duplicate_fingerprint=$14,aggregate_version=$15,updated_at=now()
      WHERE tenant_id=$16 AND id=$17 AND aggregate_version=$18`,
    [
      draft.supplier_id,
      refs.supplierName,
      draft.supplier_document_number_original,
      draft.supplier_document_number_normalized,
      draft.invoice_date,
      draft.currency,
      draft.tax_amount,
      draft.charge_amount,
      JSON.stringify(draft.charges),
      draft.gross_amount,
      draft.purchase_order_id,
      refs.po.code,
      refs.version,
      fp,
      version,
      input.tx.tenantId,
      input.id,
      input.expectedVersion,
    ],
  );
  const row = await invoiceRow(input.tx, input.id);
  const detail = await invoiceDetail(input.tx, input.id);
  const after = snapshotSummary(row);
  const before = snapshotSummary(current);
  await history({
    tx: input.tx,
    entity: "INVOICE",
    id: input.id,
    version,
    action: "INVOICE.UPDATE_DRAFT",
    before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: detail,
    status: 200,
    events: [
      event(
        "INVOICE.UPDATED",
        "INVOICE",
        input.id,
        version,
        before,
        after,
        invoiceEventPayload(row, {
          changed_fields: [
            "supplier",
            "document_number",
            "invoice_date",
            "currency",
            "purchase_order",
            "lines",
            "tax",
            "charges",
            "total",
          ],
        }),
      ),
    ],
  } satisfies InvoiceCommandResult;
}

async function submitInvoice(input: {
  tx: Transaction;
  id: string;
  actorId: string;
  expectedVersion: number;
  correlationId: string;
  reason: string | null;
}) {
  const preview = await invoiceRow(input.tx, input.id);
  const po = await poSnapshot(
    input.tx,
    String(preview.purchase_order_id),
    true,
  );
  const current = await invoiceRow(input.tx, input.id, true);
  assertVersion(Number(current.aggregate_version), input.expectedVersion);
  if (current.lifecycle_state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a DRAFT Invoice can be submitted.",
    );
  const lines = await invoiceLines(input.tx, input.id);
  const snapshot = {
    invoice_id: input.id,
    invoice_code: current.invoice_code,
    supplier_id: current.supplier_id,
    supplier_display_reference: current.supplier_display_snapshot,
    supplier_document_number_original:
      current.supplier_document_number_original,
    supplier_document_number_normalized:
      current.supplier_document_number_normalized,
    invoice_date: current.invoice_date,
    currency: current.currency,
    tax_amount: Number(current.tax_amount),
    charge_amount: Number(current.charge_amount),
    charges: current.charges,
    gross_amount: Number(current.gross_amount),
    purchase_order_id: current.purchase_order_id,
    purchase_order_code: current.purchase_order_code_snapshot,
    po_commercial_version: Number(current.po_commercial_version),
    lines: lines.map((line) => ({ ...line, tenant_id: undefined })),
  };
  const snapshotFp = fingerprint(snapshot);
  const version = input.expectedVersion + 1;
  const reservation = await input.tx.query(
    `INSERT INTO procurement.invoice_document_identity_reservations(id,tenant_id,supplier_id,document_type,supplier_document_number_normalized,document_id)
     VALUES($1,$2,$3,'INVOICE',$4,$5) ON CONFLICT(tenant_id,supplier_id,document_type,supplier_document_number_normalized) DO NOTHING RETURNING id`,
    [
      randomUUID(),
      input.tx.tenantId,
      current.supplier_id,
      current.supplier_document_number_normalized,
      input.id,
    ],
  );
  if (!reservation.rowCount) {
    const summary = snapshotSummary(current);
    const matches = await input.tx.query(
      "SELECT document_id FROM procurement.invoice_document_identity_reservations WHERE tenant_id=$1 AND supplier_id=$2 AND document_type='INVOICE' AND supplier_document_number_normalized=$3",
      [
        input.tx.tenantId,
        current.supplier_id,
        current.supplier_document_number_normalized,
      ],
    );
    return {
      data: {
        error_code: "INVOICE_DUPLICATE",
        message:
          "A submitted Invoice already uses this Supplier document identity.",
        duplicate_document_id: matches.rows[0]?.document_id,
      },
      status: 409,
      events: [
        event(
          "INVOICE.DUPLICATE_DETECTED",
          "INVOICE",
          input.id,
          Number(current.aggregate_version),
          summary,
          summary,
          invoiceEventPayload(current, { reason_code: "DUPLICATE_INVOICE" }),
        ),
      ],
    } satisfies InvoiceCommandResult;
  }
  await input.tx.query(
    "UPDATE procurement.invoices SET lifecycle_state='SUBMITTED',submitted_at=now(),submitted_snapshot=$1::jsonb,snapshot_fingerprint=$2,aggregate_version=$3,updated_at=now() WHERE tenant_id=$4 AND id=$5 AND aggregate_version=$6",
    [
      JSON.stringify(snapshot),
      snapshotFp,
      version,
      input.tx.tenantId,
      input.id,
      input.expectedVersion,
    ],
  );
  const candidateRows = await input.tx.query(
    `SELECT id,invoice_code FROM procurement.invoices
      WHERE tenant_id=$1 AND id<>$2 AND supplier_id=$3 AND duplicate_fingerprint=$4 AND lifecycle_state IN ('SUBMITTED','APPROVED','REJECTED')`,
    [
      input.tx.tenantId,
      input.id,
      current.supplier_id,
      current.duplicate_fingerprint,
    ],
  );
  for (const candidate of candidateRows.rows)
    await input.tx.query(
      `INSERT INTO procurement.invoice_duplicate_candidates(id,tenant_id,document_type,document_id,candidate_document_id,fingerprint)
     VALUES($1,$2,'INVOICE',$3,$4,$5) ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        input.tx.tenantId,
        input.id,
        candidate.id,
        current.duplicate_fingerprint,
      ],
    );
  const row = await invoiceRow(input.tx, input.id);
  const before = snapshotSummary(current);
  const after = snapshotSummary(row);
  const evaluated = await evaluateMatch({
    tx: input.tx,
    invoice: row,
    po,
    actorId: input.actorId,
    correlationId: input.correlationId,
    reason: input.reason,
    version,
  });
  return {
    data: await invoiceDetail(input.tx, input.id),
    status: 200,
    events: [
      event(
        "INVOICE.SUBMITTED",
        "INVOICE",
        input.id,
        version,
        before,
        after,
        invoiceEventPayload(row, {
          purchase_order_id: row.purchase_order_id,
          supplier_id: row.supplier_id,
          snapshot_fingerprint: snapshotFp,
        }),
      ),
      ...(candidateRows.rowCount
        ? [
            event(
              "INVOICE.DUPLICATE_DETECTED",
              "INVOICE",
              input.id,
              version,
              before,
              after,
              invoiceEventPayload(row, {
                candidate_document_ids: candidateRows.rows.map(
                  (candidate) => candidate.id,
                ),
                reason_code: "POTENTIAL_DUPLICATE",
              }),
            ),
          ]
        : []),
      ...evaluated.events,
    ],
  } satisfies InvoiceCommandResult;
}

async function readCapacity(
  tx: Transaction,
  poLineId: string,
  excludeInvoiceId: string,
) {
  const accepted = await tx.query(
    `SELECT COALESCE(sum(gl.accepted_quantity),0) AS accepted
       FROM procurement.goods_receipt_lines gl JOIN procurement.goods_receipts g ON g.tenant_id=gl.tenant_id AND g.id=gl.goods_receipt_id
      WHERE gl.tenant_id=$1 AND gl.purchase_order_line_id=$2 AND g.state='POSTED'`,
    [tx.tenantId, poLineId],
  );
  const used = await tx.query(
    `SELECT COALESCE(sum(GREATEST(0,a.quantity
            - COALESCE((SELECT sum(r.released_quantity) FROM procurement.invoice_match_allocation_releases r WHERE r.tenant_id=a.tenant_id AND r.allocation_id=a.id),0)
            - COALESCE((SELECT sum(cr.released_quantity) FROM procurement.credit_note_allocation_releases cr WHERE cr.tenant_id=a.tenant_id AND cr.allocation_id=a.id),0))),0) AS used
       FROM procurement.invoice_match_allocations a
      WHERE a.tenant_id=$1 AND a.purchase_order_line_id=$2 AND a.invoice_id<>$3`,
    [tx.tenantId, poLineId, excludeInvoiceId],
  );
  return {
    accepted: Number(accepted.rows[0]!.accepted),
    used: Math.max(0, Number(used.rows[0]!.used)),
  };
}

async function receiptLinesForCapacity(
  tx: Transaction,
  poLineId: string,
  excludeInvoiceId: string,
) {
  const result = await tx.query(
    `SELECT gl.id AS goods_receipt_line_id,gl.goods_receipt_id,gl.accepted_quantity,
       COALESCE((SELECT sum(a.quantity) FROM procurement.invoice_match_allocations a WHERE a.tenant_id=gl.tenant_id AND a.goods_receipt_line_id=gl.id AND a.allocation_type='RECEIPT_MATCHED' AND a.invoice_id<>$3),0)
       - COALESCE((SELECT sum(r.released_quantity) FROM procurement.invoice_match_allocation_releases r JOIN procurement.invoice_match_allocations a ON a.tenant_id=r.tenant_id AND a.id=r.allocation_id WHERE r.tenant_id=gl.tenant_id AND a.goods_receipt_line_id=gl.id AND a.invoice_id<>$3),0)
       - COALESCE((SELECT sum(r.released_quantity) FROM procurement.credit_note_allocation_releases r JOIN procurement.invoice_match_allocations a ON a.tenant_id=r.tenant_id AND a.id=r.allocation_id WHERE r.tenant_id=gl.tenant_id AND a.goods_receipt_line_id=gl.id AND a.invoice_id<>$3),0) AS allocated
       FROM procurement.goods_receipt_lines gl JOIN procurement.goods_receipts g ON g.tenant_id=gl.tenant_id AND g.id=gl.goods_receipt_id
      WHERE gl.tenant_id=$1 AND gl.purchase_order_line_id=$2 AND g.state='POSTED'
      ORDER BY g.posted_at,gl.id`,
    [tx.tenantId, poLineId, excludeInvoiceId],
  );
  return result.rows as Record<string, unknown>[];
}

async function allocateReceiptQuantity(input: {
  tx: Transaction;
  invoice: Record<string, unknown>;
  line: Record<string, unknown>;
  evaluationId: string;
  actorId: string;
  correlationId: string;
}) {
  const quantity = Number(input.line.quantity);
  const receiptLines = await receiptLinesForCapacity(
    input.tx,
    String(input.line.purchase_order_line_id),
    String(input.invoice.id),
  );
  let remaining = quantity;
  for (const receipt of receiptLines) {
    const available = Math.max(
      0,
      Number(receipt.accepted_quantity) - Number(receipt.allocated),
    );
    const taken = Math.min(available, remaining);
    if (taken <= 0) continue;
    await input.tx.query(
      `INSERT INTO procurement.invoice_match_allocations(id,tenant_id,invoice_id,invoice_line_id,purchase_order_line_id,evaluation_id,allocation_type,goods_receipt_id,goods_receipt_line_id,quantity)
       VALUES($1,$2,$3,$4,$5,$6,'RECEIPT_MATCHED',$7,$8,$9)`,
      [
        randomUUID(),
        input.tx.tenantId,
        input.invoice.id,
        input.line.id,
        input.line.purchase_order_line_id,
        input.evaluationId,
        receipt.goods_receipt_id,
        receipt.goods_receipt_line_id,
        taken,
      ],
    );
    remaining -= taken;
    if (remaining <= 0) break;
  }
  if (remaining > 0.00001)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Receiving capacity changed while matching; retry against current receipt evidence.",
      true,
    );
}

async function matchEvaluation(input: {
  tx: Transaction;
  invoice: Record<string, unknown>;
  po: Record<string, unknown>;
  version: number;
  actorId: string;
  correlationId: string;
  reason: string | null;
  isReevaluation: boolean;
}) {
  const invoiceId = String(input.invoice.id);
  const lines = await invoiceLines(input.tx, invoiceId);
  const currentVersion = Number(input.invoice.po_commercial_version);
  const poVersion = await input.tx.query(
    "SELECT snapshot,snapshot_hash FROM procurement.purchase_order_versions WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=$3",
    [input.tx.tenantId, input.invoice.purchase_order_id, currentVersion],
  );
  const currentPoVersion = Number(input.po.current_commercial_version);
  const poSnapshot = poVersion.rows[0]?.snapshot as
    Record<string, unknown> | undefined;
  const poLines = await input.tx.query(
    `SELECT id,line_no,item_reference_id,description,quantity,unit,unit_price,tax_amount,discount_amount
       FROM procurement.purchase_order_lines
      WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=$3
      ORDER BY line_no`,
    [input.tx.tenantId, input.invoice.purchase_order_id, currentVersion],
  );
  const byId = new Map(
    (poLines.rows as Record<string, unknown>[]).map((line) => [
      String(line.id),
      line,
    ]),
  );
  const acceptedByPoLine = new Map<
    string,
    { accepted: number; used: number }
  >();
  const reasons = new Set<string>();
  const expected: Record<string, unknown> = {};
  const observed: Record<string, unknown> = {};
  if (
    !poSnapshot ||
    currentPoVersion !== currentVersion ||
    !["ISSUED", "CLOSED"].includes(String(input.po.lifecycle_state))
  )
    reasons.add("PO_NOT_ELIGIBLE");
  if (String(input.invoice.supplier_id) !== String(input.po.supplier_id))
    reasons.add("SUPPLIER_MISMATCH");
  if (String(input.invoice.currency) !== String(input.po.currency))
    reasons.add("CURRENCY_MISMATCH");
  let anyPending = false;
  let expectedGross = 0;
  let expectedHeaderTax = 0;
  for (const line of lines) {
    const poLineId = String(line.purchase_order_line_id ?? "");
    const poLine = byId.get(poLineId);
    const prefix = String(line.line_number);
    if (!poLineId || !poLine) {
      reasons.add("PO_LINE_NOT_FOUND");
      expected[prefix] = { purchase_order_line_id: poLineId || null };
      observed[prefix] = {
        invoice_line_id: line.id,
        quantity: Number(line.quantity),
      };
      continue;
    }
    if (
      String(line.item_reference_id ?? "") !==
      String(poLine.item_reference_id ?? "")
    )
      reasons.add("ITEM_MISMATCH");
    if (Number(line.unit_price) !== Number(poLine.unit_price))
      reasons.add("UNIT_PRICE_MISMATCH");
    const ordered = Number(poLine.quantity);
    const ratio = Number(line.quantity) / ordered;
    const expectedTax = roundCurrency(
      Number(poLine.tax_amount ?? 0) * ratio,
      String(input.invoice.currency),
    );
    const expectedDiscount = roundCurrency(
      Number(poLine.discount_amount ?? 0) * ratio,
      String(input.invoice.currency),
    );
    if (
      roundCurrency(Number(line.tax_amount), String(input.invoice.currency)) !==
      expectedTax
    )
      reasons.add("TAX_MISMATCH");
    expectedHeaderTax += Number(line.tax_amount);
    if (
      roundCurrency(
        Number(line.discount_amount),
        String(input.invoice.currency),
      ) !== expectedDiscount
    )
      reasons.add("TOTAL_MISMATCH");
    if (Number(line.quantity) > ordered + 0.0000001)
      reasons.add("QUANTITY_EXCEEDS_ORDERED");
    const capacity =
      acceptedByPoLine.get(poLineId) ??
      (await readCapacity(input.tx, poLineId, invoiceId));
    acceptedByPoLine.set(poLineId, capacity);
    const usedForLine = lines
      .filter(
        (other) => String(other.purchase_order_line_id ?? "") === poLineId,
      )
      .reduce((sum, other) => sum + Number(other.quantity), 0);
    if (capacity.used + usedForLine > ordered + 0.0000001)
      reasons.add("QUANTITY_EXCEEDS_ORDERED");
    if (Number(line.quantity) > capacity.accepted - capacity.used + 0.0000001) {
      if (
        capacity.used + usedForLine <= ordered + 0.0000001 &&
        input.po.lifecycle_state === "ISSUED" &&
        input.po.receipt_state !== "FULLY_RECEIVED"
      )
        anyPending = true;
      else reasons.add("QUANTITY_EXCEEDS_RECEIVED");
    }
    const computed = roundCurrency(
      Number(line.quantity) * Number(line.unit_price) -
        Number(line.discount_amount) +
        Number(line.tax_amount) +
        Number(line.charge_amount),
      String(input.invoice.currency),
    );
    if (Number(line.charge_amount) > 0) reasons.add("UNEXPECTED_CHARGE");
    const roundingUnit =
      1 / 10 ** currencyDigits(String(input.invoice.currency));
    if (Math.abs(computed - Number(line.line_total)) > roundingUnit + 0.0000001)
      reasons.add("TOTAL_MISMATCH");
    expectedGross += Number(line.line_total);
    expected[prefix] = {
      purchase_order_line_id: poLineId,
      ordered_quantity: ordered,
      unit_price: Number(poLine.unit_price),
      tax_amount: expectedTax,
      discount_amount: expectedDiscount,
      accepted_quantity: capacity.accepted,
      already_allocated_quantity: capacity.used,
    };
    observed[prefix] = {
      quantity: Number(line.quantity),
      unit_price: Number(line.unit_price),
      tax_amount: Number(line.tax_amount),
      discount_amount: Number(line.discount_amount),
      line_total: Number(line.line_total),
    };
  }
  expectedGross = roundCurrency(
    expectedGross + Number(input.invoice.charge_amount),
    String(input.invoice.currency),
  );
  const suppliedGross = Number(input.invoice.gross_amount);
  if (
    Math.abs(expectedGross - suppliedGross) >
    1 / 10 ** currencyDigits(String(input.invoice.currency)) + 0.0000001
  )
    reasons.add("TOTAL_MISMATCH");
  const termCharges = (poSnapshot?.terms as Record<string, unknown> | undefined)
    ?.charges;
  const invoiceCharges = input.invoice.charges as Array<{
    code: string;
    amount: number;
  }>;
  if (invoiceCharges.length) {
    if (
      !Array.isArray(termCharges) ||
      canonicalJson(termCharges) !== canonicalJson(invoiceCharges)
    )
      reasons.add("UNEXPECTED_CHARGE");
  }
  if (Number(input.invoice.charge_amount) > 0 && invoiceCharges.length === 0)
    reasons.add("UNEXPECTED_CHARGE");
  if (
    roundCurrency(
      Number(input.invoice.tax_amount),
      String(input.invoice.currency),
    ) !== roundCurrency(expectedHeaderTax, String(input.invoice.currency))
  )
    reasons.add("TAX_MISMATCH");
  const hasBlocking = [...reasons].some(
    (reason) => reason !== "QUANTITY_EXCEEDS_RECEIVED",
  );
  const status = hasBlocking
    ? "MISMATCHED"
    : anyPending
      ? "PENDING_RECEIPT"
      : "MATCHED";
  if (status === "PENDING_RECEIPT") reasons.add("QUANTITY_EXCEEDS_RECEIVED");
  const receipts = await input.tx.query(
    `SELECT gl.id,gl.goods_receipt_id,gl.purchase_order_line_id,gl.accepted_quantity,g.posted_at
       FROM procurement.goods_receipt_lines gl JOIN procurement.goods_receipts g ON g.tenant_id=gl.tenant_id AND g.id=gl.goods_receipt_id
      WHERE gl.tenant_id=$1 AND gl.purchase_order_id=$2 AND gl.commercial_version=$3 AND g.state='POSTED' ORDER BY g.posted_at,gl.id`,
    [input.tx.tenantId, input.invoice.purchase_order_id, currentVersion],
  );
  const receiptFp = fingerprint(
    receipts.rows.map((row) => ({
      id: row.id,
      goods_receipt_id: row.goods_receipt_id,
      purchase_order_line_id: row.purchase_order_line_id,
      accepted_quantity: String(row.accepted_quantity),
    })),
  );
  const evaluationVersion = Number(
    (
      await input.tx.query(
        "SELECT COALESCE(max(evaluation_version),0)+1 AS next FROM procurement.invoice_match_evaluations WHERE tenant_id=$1 AND invoice_id=$2",
        [input.tx.tenantId, invoiceId],
      )
    ).rows[0]!.next,
  );
  const evaluationPayload = {
    invoice_snapshot_fingerprint: input.invoice.snapshot_fingerprint,
    po_commercial_version: currentVersion,
    receipt_evidence_fingerprint: receiptFp,
    match_status: status,
    reason_codes: [...reasons].sort(),
    expected_values: expected,
    observed_values: observed,
  };
  const evaluationFp = fingerprint(evaluationPayload);
  const evaluationId = randomUUID();
  await input.tx.query(
    `INSERT INTO procurement.invoice_match_evaluations(id,tenant_id,invoice_id,evaluation_version,invoice_snapshot_fingerprint,po_commercial_version,receipt_evidence_fingerprint,match_status,reason_codes,expected_values,observed_values,evaluation_fingerprint,correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)`,
    [
      evaluationId,
      input.tx.tenantId,
      invoiceId,
      evaluationVersion,
      input.invoice.snapshot_fingerprint,
      currentVersion,
      receiptFp,
      status,
      JSON.stringify([...reasons].sort()),
      JSON.stringify(expected),
      JSON.stringify(observed),
      evaluationFp,
      input.correlationId,
    ],
  );
  if (status === "MATCHED") {
    const existing = await input.tx.query(
      "SELECT 1 FROM procurement.invoice_match_allocations WHERE tenant_id=$1 AND invoice_id=$2 LIMIT 1",
      [input.tx.tenantId, invoiceId],
    );
    if (!existing.rowCount)
      for (const line of lines)
        await allocateReceiptQuantity({
          tx: input.tx,
          invoice: input.invoice,
          line,
          evaluationId,
          actorId: input.actorId,
          correlationId: input.correlationId,
        });
  }
  let exceptionId: string | null = null;
  if (status === "MISMATCHED") {
    exceptionId = randomUUID();
    await input.tx.query(
      `INSERT INTO procurement.invoice_match_exceptions(id,tenant_id,invoice_id,evaluation_id,reason_codes,expected_values,observed_values,evaluation_fingerprint)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)`,
      [
        exceptionId,
        input.tx.tenantId,
        invoiceId,
        evaluationId,
        JSON.stringify([...reasons].sort()),
        JSON.stringify(expected),
        JSON.stringify(observed),
        evaluationFp,
      ],
    );
    await input.tx.query(
      `INSERT INTO procurement.invoice_match_exception_history(id,tenant_id,match_exception_id,invoice_id,action,actor_id,reason,correlation_id)
       VALUES($1,$2,$3,$4,'CREATED',$5,$6,$7)`,
      [
        randomUUID(),
        input.tx.tenantId,
        exceptionId,
        invoiceId,
        input.actorId,
        input.reason,
        input.correlationId,
      ],
    );
  }
  await input.tx.query(
    "UPDATE procurement.invoices SET match_status=$1,current_match_evaluation_id=$2,aggregate_version=$3,updated_at=now() WHERE tenant_id=$4 AND id=$5",
    [status, evaluationId, input.version, input.tx.tenantId, invoiceId],
  );
  const row = await invoiceRow(input.tx, invoiceId);
  const summary = snapshotSummary(row);
  const matchEvent =
    status === "MATCHED"
      ? "INVOICE.MATCHED"
      : status === "PENDING_RECEIPT"
        ? "INVOICE.PENDING_RECEIPT"
        : "INVOICE.MISMATCHED";
  const events = [
    event(
      "INVOICE.MATCH_EVALUATED",
      "INVOICE",
      invoiceId,
      input.version,
      null,
      summary,
      {
        invoice_id: invoiceId,
        purchase_order_id: input.invoice.purchase_order_id,
        match_evaluation_id: evaluationId,
        match_status: status,
        reason_codes: [...reasons].sort(),
        evaluation_fingerprint: evaluationFp,
      },
    ),
    event(matchEvent, "INVOICE", invoiceId, input.version, null, summary, {
      invoice_id: invoiceId,
      purchase_order_id: input.invoice.purchase_order_id,
      match_evaluation_id: evaluationId,
      reason_codes: [...reasons].sort(),
    }),
    ...(exceptionId
      ? [
          event(
            "INVOICE.MATCH_EXCEPTION_CREATED",
            "INVOICE",
            invoiceId,
            input.version,
            null,
            summary,
            {
              invoice_id: invoiceId,
              purchase_order_id: input.invoice.purchase_order_id,
              match_exception_id: exceptionId,
              match_evaluation_id: evaluationId,
              reason_codes: [...reasons].sort(),
            },
          ),
        ]
      : []),
  ];
  return { events, evaluationId, evaluationFp, exceptionId, status };
}

async function evaluateMatch(input: {
  tx: Transaction;
  invoice: Record<string, unknown>;
  po: Record<string, unknown>;
  actorId: string;
  correlationId: string;
  reason: string | null;
  version: number;
}) {
  const current = await invoiceRow(input.tx, String(input.invoice.id), true);
  if (current.lifecycle_state !== "SUBMITTED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a SUBMITTED Invoice can be match-evaluated.",
    );
  const evaluated = await matchEvaluation({
    ...input,
    invoice: current,
    isReevaluation: false,
  });
  const after = snapshotSummary(await invoiceRow(input.tx, String(current.id)));
  await history({
    tx: input.tx,
    entity: "INVOICE",
    id: String(current.id),
    version: input.version,
    action: "INVOICE.SUBMIT",
    before: snapshotSummary(current),
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return evaluated;
}

async function reevaluateInvoice(input: {
  tx: Transaction;
  id: string;
  actorId: string;
  expectedVersion: number;
  correlationId: string;
  reason: string | null;
}) {
  const preview = await invoiceRow(input.tx, input.id);
  const po = await poSnapshot(
    input.tx,
    String(preview.purchase_order_id),
    true,
  );
  const row = await invoiceRow(input.tx, input.id, true);
  assertVersion(Number(row.aggregate_version), input.expectedVersion);
  if (row.lifecycle_state !== "SUBMITTED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a SUBMITTED Invoice can be re-evaluated.",
    );
  const version = input.expectedVersion + 1;
  const evaluation = await matchEvaluation({
    tx: input.tx,
    invoice: row,
    po,
    version,
    actorId: input.actorId,
    correlationId: input.correlationId,
    reason: input.reason,
    isReevaluation: true,
  });
  const after = snapshotSummary(await invoiceRow(input.tx, input.id));
  const before = snapshotSummary(row);
  await history({
    tx: input.tx,
    entity: "INVOICE",
    id: input.id,
    version,
    action: "INVOICE.REEVALUATE_MATCH",
    before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: await invoiceDetail(input.tx, input.id),
    status: 200,
    events: evaluation.events,
  } satisfies InvoiceCommandResult;
}

async function approvalFor(
  tx: Transaction,
  sourceType: string,
  sourceId: string,
) {
  const result = await readApprovalRequestForSource({
    tx,
    sourceType,
    sourceId,
  });
  return result as Record<string, unknown> | null;
}

function approvalContextMatches(
  request: Record<string, unknown>,
  invoice: Record<string, unknown>,
  evaluation: Record<string, unknown>,
  exception?: Record<string, unknown>,
) {
  const context = (request.context ?? {}) as Record<string, unknown>;
  return (
    String(context.invoice_snapshot_fingerprint ?? "") ===
      String(invoice.snapshot_fingerprint) &&
    String(context.match_evaluation_id ?? "") === String(evaluation.id) &&
    String(context.match_evaluation_fingerprint ?? "") ===
      String(evaluation.evaluation_fingerprint) &&
    (!exception ||
      (String(context.match_exception_id ?? "") === String(exception.id) &&
        String(context.exception_fingerprint ?? "") ===
          String(exception.evaluation_fingerprint)))
  );
}

async function approveInvoice(input: {
  tx: Transaction;
  id: string;
  actorId: string;
  expectedVersion: number;
  correlationId: string;
  reason: string | null;
}) {
  const preview = await invoiceRow(input.tx, input.id);
  const po = await poSnapshot(
    input.tx,
    String(preview.purchase_order_id),
    true,
  );
  void po;
  const row = await invoiceRow(input.tx, input.id, true);
  assertVersion(Number(row.aggregate_version), input.expectedVersion);
  if (row.lifecycle_state !== "SUBMITTED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a SUBMITTED Invoice can be approved.",
    );
  if (!["MATCHED", "MISMATCHED"].includes(String(row.match_status)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invoice approval is blocked until match evaluation is complete.",
    );
  const evaluationResult = await input.tx.query(
    "SELECT * FROM procurement.invoice_match_evaluations WHERE tenant_id=$1 AND invoice_id=$2 AND id=$3",
    [input.tx.tenantId, input.id, row.current_match_evaluation_id],
  );
  if (!evaluationResult.rowCount)
    throw new ApplicationError(
      "INVOICE_APPROVAL_STALE",
      "Current match evaluation is unavailable.",
    );
  const evaluation = evaluationResult.rows[0] as Record<string, unknown>;
  let approval: Record<string, unknown> | undefined;
  let exception: Record<string, unknown> | undefined;
  if (row.match_status === "MATCHED") {
    approval =
      (await approvalFor(input.tx, "INVOICE_APPROVAL", input.id)) ?? undefined;
    if (approval && approval.state !== "APPROVED")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Linked INVOICE_APPROVAL must be APPROVED.",
      );
    if (approval && !approvalContextMatches(approval, row, evaluation))
      throw new ApplicationError(
        "INVOICE_APPROVAL_STALE",
        "Linked invoice approval is bound to stale or different evidence.",
      );
  } else {
    const result = await input.tx.query(
      "SELECT * FROM procurement.invoice_match_exceptions WHERE tenant_id=$1 AND invoice_id=$2 AND evaluation_id=$3 AND status='OPEN'",
      [input.tx.tenantId, input.id, evaluation.id],
    );
    exception = result.rows[0] as Record<string, unknown> | undefined;
    approval =
      (await approvalFor(input.tx, "INVOICE_MATCH_EXCEPTION", input.id)) ??
      undefined;
    if (!exception || !approval || approval.state !== "APPROVED")
      throw new ApplicationError(
        "INVOICE_MATCH_EXCEPTION_REQUIRED",
        "MISMATCHED Invoice requires an approved linked INVOICE_MATCH_EXCEPTION.",
      );
    if (!approvalContextMatches(approval, row, evaluation, exception))
      throw new ApplicationError(
        "INVOICE_APPROVAL_STALE",
        "Match exception approval is stale or bound to different mismatch evidence.",
      );
    if (!input.reason)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Accepting an Invoice match exception requires a reason.",
      );
  }
  const version = input.expectedVersion + 1;
  if (
    exception &&
    evaluation.reason_codes &&
    Array.isArray(evaluation.reason_codes)
  ) {
    const lines = await invoiceLines(input.tx, input.id);
    for (const line of lines)
      await input.tx.query(
        `INSERT INTO procurement.invoice_match_allocations(id,tenant_id,invoice_id,invoice_line_id,purchase_order_line_id,evaluation_id,allocation_type,quantity)
       VALUES($1,$2,$3,$4,$5,$6,'APPROVED_EXCEPTION',$7)`,
        [
          randomUUID(),
          input.tx.tenantId,
          input.id,
          line.id,
          line.purchase_order_line_id,
          evaluation.id,
          line.quantity,
        ],
      );
    await input.tx.query(
      "UPDATE procurement.invoice_match_exceptions SET status='ACCEPTED',approval_request_id=$1 WHERE tenant_id=$2 AND id=$3",
      [approval!.id, input.tx.tenantId, exception.id],
    );
    await input.tx.query(
      "INSERT INTO procurement.invoice_match_exception_history(id,tenant_id,match_exception_id,invoice_id,action,approval_request_id,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,'ACCEPTED',$5,$6,$7,$8)",
      [
        randomUUID(),
        input.tx.tenantId,
        exception.id,
        input.id,
        approval!.id,
        input.actorId,
        input.reason,
        input.correlationId,
      ],
    );
  }
  await input.tx.query(
    "UPDATE procurement.invoices SET lifecycle_state='APPROVED',approved_at=now(),aggregate_version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3 AND aggregate_version=$4",
    [version, input.tx.tenantId, input.id, input.expectedVersion],
  );
  const after = snapshotSummary(await invoiceRow(input.tx, input.id));
  const before = snapshotSummary(row);
  await history({
    tx: input.tx,
    entity: "INVOICE",
    id: input.id,
    version,
    action: "INVOICE.APPROVE",
    before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: await invoiceDetail(input.tx, input.id),
    status: 200,
    events: [
      ...(exception
        ? [
            event(
              "INVOICE.MATCH_EXCEPTION_ACCEPTED",
              "INVOICE",
              input.id,
              version,
              before,
              after,
              {
                invoice_id: input.id,
                purchase_order_id: row.purchase_order_id,
                match_exception_id: exception.id,
                approval_request_id: approval!.id,
                match_evaluation_id: evaluation.id,
              },
            ),
          ]
        : []),
      event(
        "INVOICE.APPROVED",
        "INVOICE",
        input.id,
        version,
        before,
        after,
        invoiceEventPayload(after, {
          purchase_order_id: row.purchase_order_id,
          approval_request_id: approval?.id ?? null,
          match_exception_id: exception?.id ?? null,
        }),
      ),
    ],
  } satisfies InvoiceCommandResult;
}

async function cancelOrRejectInvoice(input: {
  tx: Transaction;
  id: string;
  command: "INVOICE.CANCEL" | "INVOICE.REJECT";
  actorId: string;
  expectedVersion: number;
  correlationId: string;
  reason: string | null;
}) {
  const preview = await invoiceRow(input.tx, input.id);
  if (input.command === "INVOICE.REJECT")
    await poSnapshot(input.tx, String(preview.purchase_order_id), true);
  const row = await invoiceRow(input.tx, input.id, true);
  assertVersion(Number(row.aggregate_version), input.expectedVersion);
  const cancel = input.command === "INVOICE.CANCEL";
  if (cancel && row.lifecycle_state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "INVOICE.CANCEL is allowed only from DRAFT.",
    );
  if (!cancel && row.lifecycle_state !== "SUBMITTED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "INVOICE.REJECT is allowed only from SUBMITTED.",
    );
  const before = snapshotSummary(row);
  const version = input.expectedVersion + 1;
  const state = cancel ? "CANCELLED" : "REJECTED";
  if (!cancel) {
    const allocations = await input.tx.query(
      "SELECT id,quantity FROM procurement.invoice_match_allocations WHERE tenant_id=$1 AND invoice_id=$2 AND allocation_type='RECEIPT_MATCHED'",
      [input.tx.tenantId, input.id],
    );
    for (const allocation of allocations.rows)
      await input.tx.query(
        "INSERT INTO procurement.invoice_match_allocation_releases(id,tenant_id,invoice_id,allocation_id,release_type,released_quantity,actor_id,correlation_id) VALUES($1,$2,$3,$4,'INVOICE_REJECTED',$5,$6,$7)",
        [
          randomUUID(),
          input.tx.tenantId,
          input.id,
          allocation.id,
          allocation.quantity,
          input.actorId,
          input.correlationId,
        ],
      );
  }
  await input.tx.query(
    "UPDATE procurement.invoices SET lifecycle_state=$1,rejected_at=CASE WHEN $1='REJECTED' THEN now() END,cancelled_at=CASE WHEN $1='CANCELLED' THEN now() END,cancellation_reason=CASE WHEN $1='CANCELLED' THEN $2 END,aggregate_version=$3,updated_at=now() WHERE tenant_id=$4 AND id=$5 AND aggregate_version=$6",
    [
      state,
      input.reason,
      version,
      input.tx.tenantId,
      input.id,
      input.expectedVersion,
    ],
  );
  const after = snapshotSummary(await invoiceRow(input.tx, input.id));
  await history({
    tx: input.tx,
    entity: "INVOICE",
    id: input.id,
    version,
    action: input.command,
    before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: await invoiceDetail(input.tx, input.id),
    status: 200,
    events: [
      event(
        cancel ? "INVOICE.CANCELLED" : "INVOICE.REJECTED",
        "INVOICE",
        input.id,
        version,
        before,
        after,
        invoiceEventPayload(after, {
          purchase_order_id: row.purchase_order_id,
          reason_reference: input.reason ? "audit" : null,
          reason_code: input.reason ? "OPERATOR_REASON" : null,
        }),
      ),
    ],
  } satisfies InvoiceCommandResult;
}

async function createCreditNote(input: {
  tx: Transaction;
  body: Record<string, unknown>;
  actorId: string;
  correlationId: string;
  reason: string | null;
}) {
  const invoiceId = uuid(input.body.invoice_id, "invoice_id");
  const invoice = await invoiceRow(input.tx, invoiceId);
  if (
    invoice.lifecycle_state != "APPROVED" &&
    invoice.lifecycle_state != "SUBMITTED"
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Credit Note must reference a submitted or approved Invoice.",
    );
  const supplierId =
    input.body.supplier_id === undefined
      ? String(invoice.supplier_id)
      : uuid(input.body.supplier_id, "supplier_id");
  if (supplierId !== String(invoice.supplier_id))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Credit Note Supplier must match its Invoice.",
    );
  const currencyCode = currency(input.body.currency ?? invoice.currency);
  if (currencyCode !== String(invoice.currency))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Credit Note currency must match its Invoice.",
    );
  const date = validIsoDate(input.body.document_date, "document_date");
  const original = text(
    input.body.supplier_document_number,
    "supplier_document_number",
    240,
  );
  const normalized = normalizeSupplierDocumentNumber(original);
  const lines = normalizeCreditLines(input.body.lines);
  const total = lines.reduce((sum, line) => sum + line.credited_amount, 0);
  const id = randomUUID();
  const code = `CN-${id.slice(0, 8).toUpperCase()}`;
  const fp = fingerprint({
    supplier_id: supplierId,
    document_date: date,
    currency: currencyCode,
    total_amount: total,
    invoice_id: invoiceId,
  });
  const supplier = await input.tx.query(
    "SELECT legal_name FROM procurement.suppliers WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, supplierId],
  );
  await input.tx.query(
    "INSERT INTO procurement.credit_notes(id,tenant_id,credit_note_code,supplier_id,supplier_display_snapshot,supplier_document_number_original,supplier_document_number_normalized,document_date,currency,total_amount,invoice_id,duplicate_fingerprint,created_by,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [
      id,
      input.tx.tenantId,
      code,
      supplierId,
      supplier.rows[0]!.legal_name,
      original,
      normalized,
      date,
      currencyCode,
      total,
      invoiceId,
      fp,
      input.actorId,
      input.correlationId,
    ],
  );
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const exists = await input.tx.query(
      "SELECT 1 FROM procurement.invoice_lines WHERE tenant_id=$1 AND invoice_id=$2 AND id=$3",
      [input.tx.tenantId, invoiceId, line.invoice_line_id],
    );
    if (!exists.rowCount)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Credit Note line must reference a line on its Invoice.",
      );
    await input.tx.query(
      "INSERT INTO procurement.credit_note_lines(id,tenant_id,credit_note_id,invoice_id,invoice_line_id,line_number,credited_quantity,credited_amount,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        randomUUID(),
        input.tx.tenantId,
        id,
        invoiceId,
        line.invoice_line_id,
        index + 1,
        line.credited_quantity,
        line.credited_amount,
        line.reason,
      ],
    );
  }
  const detail = await noteDetail(input.tx, id);
  const summary = snapshotSummary(await creditNoteRow(input.tx, id));
  await history({
    tx: input.tx,
    entity: "CREDIT_NOTE",
    id,
    version: 1,
    action: "CREDIT_NOTE.CREATE",
    before: null,
    after: summary,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: detail,
    status: 201,
    events: [
      event(
        "CREDIT_NOTE.CREATED",
        "CREDIT_NOTE",
        id,
        1,
        null,
        summary,
        creditEventPayload(summary, {
          invoice_id: invoiceId,
          purchase_order_id: invoice.purchase_order_id,
          supplier_id: supplierId,
        }),
      ),
    ],
  } satisfies InvoiceCommandResult;
}

async function replaceCreditLines(
  tx: Transaction,
  id: string,
  invoiceId: string,
  lines: CreditLineInput[],
) {
  await tx.query(
    "DELETE FROM procurement.credit_note_lines WHERE tenant_id=$1 AND credit_note_id=$2",
    [tx.tenantId, id],
  );
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const valid = await tx.query(
      "SELECT 1 FROM procurement.invoice_lines WHERE tenant_id=$1 AND invoice_id=$2 AND id=$3",
      [tx.tenantId, invoiceId, line.invoice_line_id],
    );
    if (!valid.rowCount)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Credit Note line must reference a line on its Invoice.",
      );
    await tx.query(
      "INSERT INTO procurement.credit_note_lines(id,tenant_id,credit_note_id,invoice_id,invoice_line_id,line_number,credited_quantity,credited_amount,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        randomUUID(),
        tx.tenantId,
        id,
        invoiceId,
        line.invoice_line_id,
        index + 1,
        line.credited_quantity,
        line.credited_amount,
        line.reason,
      ],
    );
  }
}

async function updateCreditNote(input: {
  tx: Transaction;
  id: string;
  body: Record<string, unknown>;
  actorId: string;
  expectedVersion: number;
  correlationId: string;
  reason: string | null;
}) {
  const current = await creditNoteRow(input.tx, input.id, true);
  assertVersion(Number(current.aggregate_version), input.expectedVersion);
  if (current.lifecycle_state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a DRAFT Credit Note can be updated.",
    );
  const original = text(
    input.body.supplier_document_number,
    "supplier_document_number",
    240,
  );
  const normalized = normalizeSupplierDocumentNumber(original);
  const date = validIsoDate(input.body.document_date, "document_date");
  const lines = normalizeCreditLines(input.body.lines);
  const total = lines.reduce((sum, line) => sum + line.credited_amount, 0);
  const fp = fingerprint({
    supplier_id: current.supplier_id,
    document_date: date,
    currency: current.currency,
    total_amount: total,
    invoice_id: current.invoice_id,
  });
  const version = input.expectedVersion + 1;
  await replaceCreditLines(
    input.tx,
    input.id,
    String(current.invoice_id),
    lines,
  );
  await input.tx.query(
    "UPDATE procurement.credit_notes SET supplier_document_number_original=$1,supplier_document_number_normalized=$2,document_date=$3,total_amount=$4,duplicate_fingerprint=$5,aggregate_version=$6,updated_at=now() WHERE tenant_id=$7 AND id=$8 AND aggregate_version=$9",
    [
      original,
      normalized,
      date,
      total,
      fp,
      version,
      input.tx.tenantId,
      input.id,
      input.expectedVersion,
    ],
  );
  const row = await creditNoteRow(input.tx, input.id);
  const before = snapshotSummary(current);
  const after = snapshotSummary(row);
  await history({
    tx: input.tx,
    entity: "CREDIT_NOTE",
    id: input.id,
    version,
    action: "CREDIT_NOTE.UPDATE_DRAFT",
    before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: await noteDetail(input.tx, input.id),
    status: 200,
    events: [
      event(
        "CREDIT_NOTE.UPDATED",
        "CREDIT_NOTE",
        input.id,
        version,
        before,
        after,
        creditEventPayload(after, {
          invoice_id: current.invoice_id,
          purchase_order_id: current.purchase_order_id,
          version,
          changed_fields: [
            "document_number",
            "document_date",
            "lines",
            "total",
          ],
        }),
      ),
    ],
  } satisfies InvoiceCommandResult;
}

async function submitCreditNote(input: {
  tx: Transaction;
  id: string;
  actorId: string;
  expectedVersion: number;
  correlationId: string;
  reason: string | null;
}) {
  const row = await creditNoteRow(input.tx, input.id, true);
  assertVersion(Number(row.aggregate_version), input.expectedVersion);
  if (row.lifecycle_state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a DRAFT Credit Note can be submitted.",
    );
  const lines = await noteLines(input.tx, input.id);
  const snapshot = {
    credit_note_id: input.id,
    credit_note_code: row.credit_note_code,
    supplier_id: row.supplier_id,
    supplier_display_reference: row.supplier_display_snapshot,
    supplier_document_number_original: row.supplier_document_number_original,
    supplier_document_number_normalized:
      row.supplier_document_number_normalized,
    document_date: row.document_date,
    currency: row.currency,
    invoice_id: row.invoice_id,
    total_amount: Number(row.total_amount),
    lines,
  };
  const snapshotFp = fingerprint(snapshot);
  const version = input.expectedVersion + 1;
  const reservation = await input.tx.query(
    "INSERT INTO procurement.invoice_document_identity_reservations(id,tenant_id,supplier_id,document_type,supplier_document_number_normalized,document_id) VALUES($1,$2,$3,'CREDIT_NOTE',$4,$5) ON CONFLICT(tenant_id,supplier_id,document_type,supplier_document_number_normalized) DO NOTHING RETURNING id",
    [
      randomUUID(),
      input.tx.tenantId,
      row.supplier_id,
      row.supplier_document_number_normalized,
      input.id,
    ],
  );
  if (!reservation.rowCount) {
    const match = await input.tx.query(
      "SELECT document_id FROM procurement.invoice_document_identity_reservations WHERE tenant_id=$1 AND supplier_id=$2 AND document_type='CREDIT_NOTE' AND supplier_document_number_normalized=$3",
      [
        input.tx.tenantId,
        row.supplier_id,
        row.supplier_document_number_normalized,
      ],
    );
    const summary = snapshotSummary(row);
    return {
      data: {
        error_code: "INVOICE_DUPLICATE",
        message:
          "A submitted Credit Note already uses this Supplier document identity.",
        duplicate_document_id: match.rows[0]?.document_id,
      },
      status: 409,
      events: [
        event(
          "INVOICE.DUPLICATE_DETECTED",
          "CREDIT_NOTE",
          input.id,
          Number(row.aggregate_version),
          summary,
          summary,
          { credit_note_id: input.id, reason_code: "DUPLICATE_INVOICE" },
        ),
      ],
    } satisfies InvoiceCommandResult;
  }
  await input.tx.query(
    "UPDATE procurement.credit_notes SET lifecycle_state='SUBMITTED',submitted_at=now(),submitted_snapshot=$1::jsonb,snapshot_fingerprint=$2,aggregate_version=$3,updated_at=now() WHERE tenant_id=$4 AND id=$5 AND aggregate_version=$6",
    [
      JSON.stringify(snapshot),
      snapshotFp,
      version,
      input.tx.tenantId,
      input.id,
      input.expectedVersion,
    ],
  );
  const candidates = await input.tx.query(
    "SELECT id FROM procurement.credit_notes WHERE tenant_id=$1 AND id<>$2 AND supplier_id=$3 AND duplicate_fingerprint=$4 AND lifecycle_state IN ('SUBMITTED','APPLIED','REJECTED')",
    [input.tx.tenantId, input.id, row.supplier_id, row.duplicate_fingerprint],
  );
  for (const candidate of candidates.rows)
    await input.tx.query(
      "INSERT INTO procurement.invoice_duplicate_candidates(id,tenant_id,document_type,document_id,candidate_document_id,fingerprint) VALUES($1,$2,'CREDIT_NOTE',$3,$4,$5) ON CONFLICT DO NOTHING",
      [
        randomUUID(),
        input.tx.tenantId,
        input.id,
        candidate.id,
        row.duplicate_fingerprint,
      ],
    );
  const before = snapshotSummary(row);
  const updated = await creditNoteRow(input.tx, input.id);
  const after = snapshotSummary(updated);
  await history({
    tx: input.tx,
    entity: "CREDIT_NOTE",
    id: input.id,
    version,
    action: "CREDIT_NOTE.SUBMIT",
    before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: await noteDetail(input.tx, input.id),
    status: 200,
    events: [
      event(
        "CREDIT_NOTE.SUBMITTED",
        "CREDIT_NOTE",
        input.id,
        version,
        before,
        after,
        creditEventPayload(updated, {
          supplier_id: row.supplier_id,
          snapshot_fingerprint: snapshotFp,
        }),
      ),
      ...(candidates.rowCount
        ? [
            event(
              "INVOICE.DUPLICATE_DETECTED",
              "CREDIT_NOTE",
              input.id,
              version,
              before,
              after,
              creditEventPayload(updated, {
                candidate_document_ids: candidates.rows.map(
                  (candidate) => candidate.id,
                ),
                reason_code: "POTENTIAL_DUPLICATE",
              }),
            ),
          ]
        : []),
    ],
  } satisfies InvoiceCommandResult;
}

async function cancelOrRejectCreditNote(input: {
  tx: Transaction;
  id: string;
  command: "CREDIT_NOTE.CANCEL" | "CREDIT_NOTE.REJECT";
  actorId: string;
  expectedVersion: number;
  correlationId: string;
  reason: string | null;
}) {
  const preview = await creditNoteRow(input.tx, input.id);
  if (input.command === "CREDIT_NOTE.REJECT") {
    const invoice = await invoiceRow(input.tx, String(preview.invoice_id));
    await poSnapshot(input.tx, String(invoice.purchase_order_id), true);
  }
  const row = await creditNoteRow(input.tx, input.id, true);
  assertVersion(Number(row.aggregate_version), input.expectedVersion);
  const cancel = input.command === "CREDIT_NOTE.CANCEL";
  if (cancel && row.lifecycle_state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "CREDIT_NOTE.CANCEL is allowed only from DRAFT.",
    );
  if (!cancel && row.lifecycle_state !== "SUBMITTED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "CREDIT_NOTE.REJECT is allowed only from SUBMITTED.",
    );
  const version = input.expectedVersion + 1;
  const state = cancel ? "CANCELLED" : "REJECTED";
  await input.tx.query(
    "UPDATE procurement.credit_notes SET lifecycle_state=$1,rejected_at=CASE WHEN $1='REJECTED' THEN now() END,cancelled_at=CASE WHEN $1='CANCELLED' THEN now() END,cancellation_reason=CASE WHEN $1='CANCELLED' THEN $2 END,aggregate_version=$3,updated_at=now() WHERE tenant_id=$4 AND id=$5 AND aggregate_version=$6",
    [
      state,
      input.reason,
      version,
      input.tx.tenantId,
      input.id,
      input.expectedVersion,
    ],
  );
  const after = snapshotSummary(await creditNoteRow(input.tx, input.id));
  const before = snapshotSummary(row);
  await history({
    tx: input.tx,
    entity: "CREDIT_NOTE",
    id: input.id,
    version,
    action: input.command,
    before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: await noteDetail(input.tx, input.id),
    status: 200,
    events: [
      event(
        cancel ? "CREDIT_NOTE.CANCELLED" : "CREDIT_NOTE.REJECTED",
        "CREDIT_NOTE",
        input.id,
        version,
        before,
        after,
        creditEventPayload(after, {
          invoice_id: row.invoice_id,
          purchase_order_id: row.purchase_order_id,
          reason_reference: input.reason ? "audit" : null,
          reason_code: input.reason ? "OPERATOR_REASON" : null,
        }),
      ),
    ],
  } satisfies InvoiceCommandResult;
}

async function applyCreditNote(input: {
  tx: Transaction;
  id: string;
  actorId: string;
  expectedVersion: number;
  correlationId: string;
  reason: string | null;
}) {
  const preview = await creditNoteRow(input.tx, input.id);
  const invoice = await invoiceRow(input.tx, String(preview.invoice_id));
  const po = await poSnapshot(
    input.tx,
    String(invoice.purchase_order_id),
    true,
  );
  void po;
  const invoiceLocked = await invoiceRow(
    input.tx,
    String(preview.invoice_id),
    true,
  );
  const row = await creditNoteRow(input.tx, input.id, true);
  assertVersion(Number(row.aggregate_version), input.expectedVersion);
  if (row.lifecycle_state !== "SUBMITTED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a SUBMITTED Credit Note can be applied.",
    );
  if (invoiceLocked.lifecycle_state !== "APPROVED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Credit Note may be applied only to an APPROVED Invoice.",
    );
  const lines = await noteLines(input.tx, input.id);
  const applicationId = randomUUID();
  for (const line of lines) {
    await input.tx.query(
      "SELECT id FROM procurement.invoice_lines WHERE tenant_id=$1 AND invoice_id=$2 AND id=$3 FOR UPDATE",
      [input.tx.tenantId, row.invoice_id, line.invoice_line_id],
    );
    const prior = await input.tx.query(
      "SELECT COALESCE(sum(cl.credited_quantity),0) AS quantity,COALESCE(sum(cl.credited_amount),0) AS amount FROM procurement.credit_note_lines cl JOIN procurement.credit_notes c ON c.tenant_id=cl.tenant_id AND c.id=cl.credit_note_id AND c.lifecycle_state='APPLIED' WHERE cl.tenant_id=$1 AND cl.invoice_line_id=$2",
      [input.tx.tenantId, line.invoice_line_id],
    );
    const invoiceLine = (
      await input.tx.query(
        "SELECT quantity,line_total FROM procurement.invoice_lines WHERE tenant_id=$1 AND invoice_id=$2 AND id=$3",
        [input.tx.tenantId, row.invoice_id, line.invoice_line_id],
      )
    ).rows[0]!;
    if (
      Number(prior.rows[0]!.quantity) + Number(line.credited_quantity) >
        Number(invoiceLine.quantity) + 0.0000001 ||
      Number(prior.rows[0]!.amount) + Number(line.credited_amount) >
        Number(invoiceLine.line_total) + 0.0001
    )
      throw new ApplicationError(
        "CREDIT_NOTE_OVER_CREDITABLE_AMOUNT",
        "Credit Note exceeds the remaining creditable Invoice line quantity or amount.",
      );
  }
  await input.tx.query(
    "INSERT INTO procurement.credit_note_applications(id,tenant_id,credit_note_id,invoice_id,actor_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6)",
    [
      applicationId,
      input.tx.tenantId,
      input.id,
      row.invoice_id,
      input.actorId,
      input.correlationId,
    ],
  );
  for (const line of lines) {
    let remaining = Number(line.credited_quantity);
    if (remaining <= 0) continue;
    const allocations = await input.tx.query(
      "SELECT id,quantity FROM procurement.invoice_match_allocations WHERE tenant_id=$1 AND invoice_id=$2 AND invoice_line_id=$3 ORDER BY created_at,id FOR UPDATE",
      [input.tx.tenantId, row.invoice_id, line.invoice_line_id],
    );
    for (const allocation of allocations.rows) {
      if (remaining <= 0) break;
      const releases = await input.tx.query(
        "SELECT COALESCE((SELECT sum(released_quantity) FROM procurement.invoice_match_allocation_releases WHERE tenant_id=$1 AND allocation_id=$2),0)+COALESCE((SELECT sum(released_quantity) FROM procurement.credit_note_allocation_releases WHERE tenant_id=$1 AND allocation_id=$2),0) AS released",
        [input.tx.tenantId, allocation.id],
      );
      const available = Math.max(
        0,
        Number(allocation.quantity) - Number(releases.rows[0]!.released),
      );
      const released = Math.min(remaining, available);
      if (released <= 0) continue;
      await input.tx.query(
        "INSERT INTO procurement.credit_note_allocation_releases(id,tenant_id,application_id,credit_note_id,credit_note_line_id,invoice_id,invoice_line_id,allocation_id,released_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          input.tx.tenantId,
          applicationId,
          input.id,
          line.id,
          row.invoice_id,
          line.invoice_line_id,
          allocation.id,
          released,
        ],
      );
      remaining -= released;
    }
  }
  await input.tx.query(
    "UPDATE procurement.credit_notes SET lifecycle_state='APPLIED',applied_at=now(),aggregate_version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3 AND aggregate_version=$4",
    [
      input.expectedVersion + 1,
      input.tx.tenantId,
      input.id,
      input.expectedVersion,
    ],
  );
  const after = snapshotSummary(await creditNoteRow(input.tx, input.id));
  const before = snapshotSummary(row);
  await history({
    tx: input.tx,
    entity: "CREDIT_NOTE",
    id: input.id,
    version: input.expectedVersion + 1,
    action: "CREDIT_NOTE.APPLY",
    before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  return {
    data: await noteDetail(input.tx, input.id),
    status: 200,
    events: [
      event(
        "CREDIT_NOTE.APPLIED",
        "CREDIT_NOTE",
        input.id,
        input.expectedVersion + 1,
        before,
        after,
        creditEventPayload(after, {
          invoice_id: row.invoice_id,
          purchase_order_id: row.purchase_order_id,
          application_id: applicationId,
          credited_line_reference_ids: lines.map((line) => line.id),
        }),
      ),
    ],
  } satisfies InvoiceCommandResult;
}

export async function executeInvoiceCommand(input: {
  tx: Transaction;
  command: InvoiceCommand;
  id?: string | null;
  body: Record<string, unknown>;
  actorId: string;
  expectedVersion?: number;
  correlationId: string;
  reason?: string | null;
}): Promise<InvoiceCommandResult> {
  const common = {
    tx: input.tx,
    actorId: input.actorId,
    correlationId: input.correlationId,
    reason: input.reason ?? null,
  };
  switch (input.command) {
    case "INVOICE.CREATE":
      return createInvoice({ ...common, body: input.body });
    case "INVOICE.UPDATE_DRAFT":
      return updateInvoice({
        ...common,
        id: input.id!,
        body: input.body,
        expectedVersion: input.expectedVersion!,
      });
    case "INVOICE.SUBMIT":
      return submitInvoice({
        ...common,
        id: input.id!,
        expectedVersion: input.expectedVersion!,
      });
    case "INVOICE.REEVALUATE_MATCH":
      return reevaluateInvoice({
        ...common,
        id: input.id!,
        expectedVersion: input.expectedVersion!,
      });
    case "INVOICE.APPROVE":
      return approveInvoice({
        ...common,
        id: input.id!,
        expectedVersion: input.expectedVersion!,
      });
    case "INVOICE.REJECT":
      return cancelOrRejectInvoice({
        ...common,
        id: input.id!,
        command: input.command,
        expectedVersion: input.expectedVersion!,
      });
    case "INVOICE.CANCEL":
      return cancelOrRejectInvoice({
        ...common,
        id: input.id!,
        command: input.command,
        expectedVersion: input.expectedVersion!,
      });
    case "CREDIT_NOTE.CREATE":
      return createCreditNote({ ...common, body: input.body });
    case "CREDIT_NOTE.UPDATE_DRAFT":
      return updateCreditNote({
        ...common,
        id: input.id!,
        body: input.body,
        expectedVersion: input.expectedVersion!,
      });
    case "CREDIT_NOTE.SUBMIT":
      return submitCreditNote({
        ...common,
        id: input.id!,
        expectedVersion: input.expectedVersion!,
      });
    case "CREDIT_NOTE.APPLY":
      return applyCreditNote({
        ...common,
        id: input.id!,
        expectedVersion: input.expectedVersion!,
      });
    case "CREDIT_NOTE.REJECT":
      return cancelOrRejectCreditNote({
        ...common,
        id: input.id!,
        command: input.command,
        expectedVersion: input.expectedVersion!,
      });
    case "CREDIT_NOTE.CANCEL":
      return cancelOrRejectCreditNote({
        ...common,
        id: input.id!,
        command: input.command,
        expectedVersion: input.expectedVersion!,
      });
  }
}

export async function readInvoice(tx: Transaction, id: string) {
  return invoiceDetail(tx, id);
}
export async function readCreditNote(tx: Transaction, id: string) {
  return noteDetail(tx, id);
}
export async function listInvoices(
  tx: Transaction,
  input: {
    limit: number;
    offset: number;
    lifecycleState?: string | null;
    purchaseOrderId?: string | null;
  },
) {
  const result = await tx.query(
    "SELECT id,invoice_code,supplier_id,supplier_display_snapshot,supplier_document_number_original,invoice_date,currency,gross_amount,purchase_order_id,purchase_order_code_snapshot,lifecycle_state,match_status,aggregate_version,created_at FROM procurement.invoices WHERE tenant_id=$1 AND ($2::text IS NULL OR lifecycle_state=$2) AND ($3::uuid IS NULL OR purchase_order_id=$3) ORDER BY created_at DESC,id LIMIT $4 OFFSET $5",
    [
      tx.tenantId,
      input.lifecycleState ?? null,
      input.purchaseOrderId ?? null,
      input.limit,
      input.offset,
    ],
  );
  return result.rows;
}
export async function listCreditNotes(
  tx: Transaction,
  input: {
    limit: number;
    offset: number;
    lifecycleState?: string | null;
    invoiceId?: string | null;
  },
) {
  const result = await tx.query(
    "SELECT id,credit_note_code,supplier_id,supplier_display_snapshot,supplier_document_number_original,document_date,currency,total_amount,invoice_id,lifecycle_state,aggregate_version,created_at FROM procurement.credit_notes WHERE tenant_id=$1 AND ($2::text IS NULL OR lifecycle_state=$2) AND ($3::uuid IS NULL OR invoice_id=$3) ORDER BY created_at DESC,id LIMIT $4 OFFSET $5",
    [
      tx.tenantId,
      input.lifecycleState ?? null,
      input.invoiceId ?? null,
      input.limit,
      input.offset,
    ],
  );
  return result.rows;
}
