import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import { readApprovalRequest } from "../../control-plane/index.js";

export type PurchaseOrderCommand =
  | "PO.CREATE"
  | "PO.UPDATE_DRAFT"
  | "PO.ISSUE"
  | "PO.HOLD"
  | "PO.RESUME"
  | "PO.AMEND"
  | "PO.CANCEL"
  | "PO.CLOSE"
  | "PO.CLOSE_REMAINDER";

export type PurchaseOrderEvent = {
  type: string;
  aggregateType: "PURCHASE_ORDER";
  aggregateId: string;
  version: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type PurchaseOrderCommandResult = {
  data: Record<string, unknown>;
  status: number;
  events: PurchaseOrderEvent[];
};

type Snapshot = {
  supplier_id: string;
  procurement_request_id: string | null;
  rfq_id: string | null;
  source_quotation_id: string | null;
  currency: string;
  expected_delivery: string | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  delivery_location: string | null;
  terms: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
};

function fail(message: string): never {
  throw new ApplicationError("BUSINESS_RULE_VIOLATION", message);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function snapshotHash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => canonical(before[field]) !== canonical(after[field]))
    .sort();
}

function normalizedSnapshot(body: Record<string, unknown>): Snapshot {
  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "lines must contain between 1 and 200 entries.",
    );
  const normalizedLines = lines.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new ApplicationError("VALIDATION_ERROR", "PO line is invalid.");
    const line = entry as Record<string, unknown>;
    const itemType = line.item_type ?? "GOODS";
    const expectedDelivery = line.expected_delivery ?? null;
    if (
      typeof line.description !== "string" ||
      !line.description.trim() ||
      line.description.trim().length > 1000 ||
      typeof line.quantity !== "number" ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isInteger(line.quantity * 10000) ||
      typeof line.unit_price !== "number" ||
      !Number.isFinite(line.unit_price) ||
      line.unit_price < 0 ||
      !Number.isInteger(line.unit_price * 100) ||
      (line.tax_amount !== undefined &&
        (typeof line.tax_amount !== "number" ||
          !Number.isFinite(line.tax_amount) ||
          line.tax_amount < 0 ||
          !Number.isInteger(line.tax_amount * 100))) ||
      (line.discount_amount !== undefined &&
        (typeof line.discount_amount !== "number" ||
          !Number.isFinite(line.discount_amount) ||
          line.discount_amount < 0 ||
          !Number.isInteger(line.discount_amount * 100))) ||
      typeof itemType !== "string" ||
      !itemType.trim() ||
      itemType.trim().length > 80 ||
      (line.item_reference_id !== undefined &&
        line.item_reference_id !== null &&
        (typeof line.item_reference_id !== "string" ||
          line.item_reference_id.length > 120)) ||
      (line.unit !== undefined &&
        line.unit !== null &&
        (typeof line.unit !== "string" || line.unit.length > 40)) ||
      (expectedDelivery !== null &&
        (typeof expectedDelivery !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(expectedDelivery) ||
          Number.isNaN(Date.parse(expectedDelivery)) ||
          new Date(expectedDelivery).toISOString().slice(0, 10) !==
            expectedDelivery)) ||
      line.quantity * line.unit_price +
        (typeof line.tax_amount === "number" ? line.tax_amount : 0) -
        (typeof line.discount_amount === "number" ? line.discount_amount : 0) <
        0
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `PO line ${index + 1} requires description, positive quantity and non-negative unit_price.`,
      );
    return {
      line_number: index + 1,
      item_type: itemType.trim(),
      description: line.description.trim(),
      item_reference_id:
        typeof line.item_reference_id === "string"
          ? line.item_reference_id
          : null,
      unit: typeof line.unit === "string" ? line.unit : null,
      quantity: line.quantity,
      unit_price: line.unit_price,
      tax_amount:
        typeof line.tax_amount === "number" && Number.isFinite(line.tax_amount)
          ? line.tax_amount
          : 0,
      discount_amount:
        typeof line.discount_amount === "number" &&
        Number.isFinite(line.discount_amount)
          ? line.discount_amount
          : 0,
      expected_delivery: expectedDelivery,
      total:
        Math.round(
          (line.quantity * line.unit_price +
            (typeof line.tax_amount === "number" ? line.tax_amount : 0) -
            (typeof line.discount_amount === "number"
              ? line.discount_amount
              : 0)) *
            100,
        ) / 100,
    };
  });
  const currency = body.currency;
  const supplierId = body.supplier_id;
  if (
    typeof supplierId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      supplierId,
    ) ||
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "supplier_id and uppercase ISO currency are required.",
    );
  const terms = body.terms ?? {};
  if (!terms || typeof terms !== "object" || Array.isArray(terms))
    throw new ApplicationError("VALIDATION_ERROR", "terms must be an object.");
  const nullableUuid = (name: string) => {
    const value = body[name];
    if (value === undefined || value === null || value === "") return null;
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new ApplicationError("VALIDATION_ERROR", `${name} must be a UUID.`);
    return value;
  };
  const rfqId = nullableUuid("rfq_id");
  const quotationId = nullableUuid("source_quotation_id");
  const expectedDelivery = body.expected_delivery ?? null;
  if (
    expectedDelivery !== null &&
    (typeof expectedDelivery !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expectedDelivery) ||
      Number.isNaN(Date.parse(expectedDelivery)) ||
      new Date(expectedDelivery).toISOString().slice(0, 10) !==
        expectedDelivery)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_delivery must be a valid ISO calendar date.",
    );
  if ((rfqId === null) !== (quotationId === null))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "rfq_id and source_quotation_id must be provided together.",
    );
  return {
    supplier_id: supplierId,
    procurement_request_id: nullableUuid("procurement_request_id"),
    rfq_id: rfqId,
    source_quotation_id: quotationId,
    currency,
    expected_delivery: expectedDelivery,
    payment_terms:
      typeof body.payment_terms === "string" ? body.payment_terms : null,
    delivery_terms:
      typeof body.delivery_terms === "string" ? body.delivery_terms : null,
    delivery_location:
      typeof body.delivery_location === "string"
        ? body.delivery_location
        : null,
    terms: terms as Record<string, unknown>,
    lines: normalizedLines,
  };
}

function safe(row: Record<string, unknown>) {
  const output = { ...row };
  delete output.tenant_id;
  output.aggregate_version = Number(row.aggregate_version);
  output.current_commercial_version =
    row.current_commercial_version === null
      ? null
      : Number(row.current_commercial_version);
  output.committed_receipt_count = Number(row.committed_receipt_count);
  return output;
}

async function getPo(tx: Transaction, id: string, lock = false) {
  const result = await tx.query(
    `SELECT * FROM procurement.purchase_orders WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Purchase order was not found.");
  return result.rows[0]!;
}

async function snapshotFor(tx: Transaction, row: Record<string, unknown>) {
  if (row.lifecycle_state === "DRAFT") return row.draft_snapshot as Snapshot;
  const result = await tx.query(
    `SELECT snapshot FROM procurement.purchase_order_versions
      WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=$3`,
    [tx.tenantId, row.id, row.current_commercial_version],
  );
  return result.rows[0]?.snapshot as Snapshot;
}

async function insertHistory(input: {
  tx: Transaction;
  row: Record<string, unknown>;
  before: Record<string, unknown> | null;
  beforeLifecycle: string | null;
  beforeReceipt: string | null;
  command: string;
  actorId: string;
  reason: string;
  correlationId: string;
}) {
  const after = safe(input.row);
  await input.tx.query(
    `INSERT INTO procurement.purchase_order_history
      (id,tenant_id,purchase_order_id,aggregate_version,action,previous_lifecycle_state,lifecycle_state,
       previous_receipt_state,receipt_state,commercial_version,before_snapshot,after_snapshot,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.row.id,
      input.row.aggregate_version,
      input.command,
      input.beforeLifecycle,
      input.row.lifecycle_state,
      input.beforeReceipt,
      input.row.receipt_state,
      input.row.current_commercial_version,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(after),
      input.actorId,
      input.reason,
      input.correlationId,
    ],
  );
  return after;
}

function makeEvent(input: {
  eventType: string;
  id: string;
  version: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  reason: string;
}) {
  return {
    type: input.eventType,
    aggregateType: "PURCHASE_ORDER" as const,
    aggregateId: input.id,
    version: input.version,
    before: input.before,
    after: input.after,
    payload: {
      purchase_order_id: input.id,
      previous_lifecycle_state: input.before?.lifecycle_state ?? null,
      lifecycle_state: input.after.lifecycle_state,
      previous_receipt_state: input.before?.receipt_state ?? null,
      receipt_state: input.after.receipt_state,
      aggregate_version: input.version,
      commercial_version: input.after.current_commercial_version,
      reason: input.reason,
    } as Record<string, unknown>,
  };
}

async function currentApproval(input: {
  tx: Transaction;
  poId: string;
  sourceType: "PO_ISSUE" | "PO_AMENDMENT";
  requestId: string | null;
}) {
  if (!input.requestId) return null;
  const request = await readApprovalRequest({
    tx: input.tx,
    requestId: input.requestId,
  });
  if (
    !request ||
    request.tenant_id !== input.tx.tenantId ||
    request.source_id !== input.poId ||
    request.source_type !== input.sourceType
  )
    fail(
      "The current linked approval request is missing or targets a different PO context.",
    );
  return request as Record<string, unknown>;
}

/** Approval Engine calls this Procurement-owned contract when it creates/replaces a PO approval link. */
export async function linkPurchaseOrderApproval(input: {
  tx: Transaction;
  poId: string;
  requestId: string;
  sourceType: "PO_ISSUE" | "PO_AMENDMENT";
}) {
  const po = await getPo(input.tx, input.poId, true);
  const request = await readApprovalRequest({
    tx: input.tx,
    requestId: input.requestId,
  });
  if (
    !request ||
    request.tenant_id !== input.tx.tenantId ||
    request.source_id !== po.id ||
    request.source_type !== input.sourceType
  )
    fail("Approval request tenant, source type and target must match the PO.");
  const context = request.context as Record<string, unknown>;
  if (!context || typeof context !== "object" || Array.isArray(context))
    fail("Approval request must contain a canonical PO context snapshot.");
  if (input.sourceType === "PO_ISSUE") {
    if (po.lifecycle_state !== "DRAFT")
      fail("PO_ISSUE approval can only be linked to a DRAFT PO.");
    const draft = po.draft_snapshot as Snapshot;
    if (
      context.aggregate_version !== Number(po.aggregate_version) ||
      context.commercial_snapshot_hash !== snapshotHash(draft)
    )
      fail(
        "PO_ISSUE approval context must bind the current draft version and commercial snapshot.",
      );
    await input.tx.query(
      "UPDATE procurement.purchase_orders SET issue_approval_request_id=$1 WHERE tenant_id=$2 AND id=$3",
      [input.requestId, input.tx.tenantId, po.id],
    );
  } else {
    if (
      !["ISSUED", "ON_HOLD"].includes(String(po.lifecycle_state)) ||
      po.receipt_state !== "NOT_RECEIVED" ||
      Number(po.committed_receipt_count) !== 0
    )
      fail(
        "PO_AMENDMENT approval can only be linked to an unreceived issued PO.",
      );
    const current = await snapshotFor(input.tx, po);
    if (
      context.base_aggregate_version !== Number(po.aggregate_version) ||
      context.base_commercial_version !==
        Number(po.current_commercial_version) ||
      context.base_commercial_snapshot_hash !== snapshotHash(current) ||
      typeof context.proposed_commercial_snapshot_hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(context.proposed_commercial_snapshot_hash)
    )
      fail(
        "PO_AMENDMENT approval must bind the current base and a proposed commercial snapshot.",
      );
    await input.tx.query(
      "UPDATE procurement.purchase_orders SET amendment_approval_request_id=$1 WHERE tenant_id=$2 AND id=$3",
      [input.requestId, input.tx.tenantId, po.id],
    );
  }
  return {
    purchase_order_id: po.id,
    approval_request_id: input.requestId,
    source_type: input.sourceType,
  };
}

function approvalContextMatches(
  request: Record<string, unknown>,
  expected: Record<string, unknown>,
) {
  const context = request.context as Record<string, unknown>;
  if (!context || typeof context !== "object" || Array.isArray(context))
    return false;
  return Object.entries(expected).every(
    ([key, value]) => context[key] === value,
  );
}

async function appendCommercialVersion(input: {
  tx: Transaction;
  po: Record<string, unknown>;
  snapshot: Snapshot;
  version: number;
  baseAggregateVersion: number;
  reason: string;
  actorId: string;
  correlationId: string;
  approvalRequestId: string | null;
}) {
  const hash = snapshotHash(input.snapshot);
  await input.tx.query(
    `INSERT INTO procurement.purchase_order_versions
      (tenant_id,purchase_order_id,commercial_version,base_aggregate_version,snapshot,snapshot_hash,reason,approval_request_id,actor_id,correlation_id)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
    [
      input.tx.tenantId,
      input.po.id,
      input.version,
      input.baseAggregateVersion,
      JSON.stringify(input.snapshot),
      hash,
      input.reason,
      input.approvalRequestId,
      input.actorId,
      input.correlationId,
    ],
  );
  await writeCommercialLines({
    tx: input.tx,
    poId: String(input.po.id),
    commercialVersion: input.version,
    lines: input.snapshot.lines,
  });
  return hash;
}

async function writeCommercialLines(input: {
  tx: Transaction;
  poId: string;
  commercialVersion: number | null;
  lines: Array<Record<string, unknown>>;
}) {
  for (const line of input.lines)
    await input.tx.query(
      "INSERT INTO procurement.purchase_order_lines(id,tenant_id,purchase_order_id,commercial_version,line_no,item_type,item_reference_id,description,unit,quantity,unit_price,tax_amount,discount_amount,total,expected_delivery) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [
        randomUUID(),
        input.tx.tenantId,
        input.poId,
        input.commercialVersion,
        line.line_number,
        line.item_type,
        line.item_reference_id,
        line.description,
        line.unit,
        line.quantity,
        line.unit_price,
        line.tax_amount,
        line.discount_amount,
        line.total,
        line.expected_delivery,
      ],
    );
}

async function replaceDraftLines(
  tx: Transaction,
  poId: string,
  lines: Array<Record<string, unknown>>,
) {
  await tx.query(
    "DELETE FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version IS NULL",
    [tx.tenantId, poId],
  );
  await writeCommercialLines({ tx, poId, commercialVersion: null, lines });
}

export async function executePurchaseOrderCommand(input: {
  tx: Transaction;
  actorId: string;
  correlationId: string;
  reason: string;
  command: PurchaseOrderCommand;
  id?: string;
  expectedVersion?: number;
  body: Record<string, unknown>;
}): Promise<PurchaseOrderCommandResult> {
  const reason = input.reason.trim();
  if (!reason)
    throw new ApplicationError("VALIDATION_ERROR", "reason is required.");
  if (input.command === "PO.CREATE") {
    const snapshot = normalizedSnapshot(input.body);
    const id = randomUUID();
    const code = `PO-${id.slice(0, 8).toUpperCase()}`;
    const inserted = await input.tx.query(
      `INSERT INTO procurement.purchase_orders
        (id,tenant_id,code,procurement_request_id,rfq_id,supplier_id,source_quotation_id,currency,expected_delivery,draft_snapshot,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
      [
        id,
        input.tx.tenantId,
        code,
        snapshot.procurement_request_id,
        snapshot.rfq_id,
        snapshot.supplier_id,
        snapshot.source_quotation_id,
        snapshot.currency,
        snapshot.expected_delivery,
        JSON.stringify(snapshot),
        input.actorId,
      ],
    );
    const row = inserted.rows[0]!;
    await replaceDraftLines(input.tx, id, snapshot.lines);
    const after = await insertHistory({
      tx: input.tx,
      row,
      before: null,
      beforeLifecycle: null,
      beforeReceipt: null,
      command: input.command,
      actorId: input.actorId,
      reason,
      correlationId: input.correlationId,
    });
    const createdEvent = makeEvent({
      eventType: "PO.CREATED",
      id,
      version: 1,
      before: null,
      after,
      reason,
    });
    Object.assign(createdEvent.payload, {
      po_code: after.code,
      supplier_id: after.supplier_id,
      procurement_request_id: after.procurement_request_id,
      rfq_id: after.rfq_id,
      accepted_quotation_id: after.source_quotation_id,
      aggregate_version: 1,
    });
    return {
      data: after,
      status: 201,
      events: [createdEvent],
    };
  }

  const po = await getPo(input.tx, input.id!, true);
  assertVersion(po.aggregate_version, input.expectedVersion!);
  const before = safe(po);
  const beforeLifecycle = String(po.lifecycle_state);
  const beforeReceipt = String(po.receipt_state);
  const nextVersion = Number(po.aggregate_version) + 1;
  let eventType: string;

  switch (input.command) {
    case "PO.UPDATE_DRAFT": {
      if (po.lifecycle_state !== "DRAFT")
        fail("Only a DRAFT purchase order can be updated.");
      const snapshot = normalizedSnapshot({
        ...(po.draft_snapshot as object),
        ...input.body,
      });
      await input.tx.query(
        `UPDATE procurement.purchase_orders SET supplier_id=$1,rfq_id=$2,source_quotation_id=$3,
          procurement_request_id=$4,currency=$5,expected_delivery=$6,draft_snapshot=$7::jsonb,aggregate_version=$8,updated_at=now()
          WHERE tenant_id=$9 AND id=$10 AND aggregate_version=$11`,
        [
          snapshot.supplier_id,
          snapshot.rfq_id,
          snapshot.source_quotation_id,
          snapshot.procurement_request_id,
          snapshot.currency,
          snapshot.expected_delivery,
          JSON.stringify(snapshot),
          nextVersion,
          input.tx.tenantId,
          po.id,
          input.expectedVersion,
        ],
      );
      await replaceDraftLines(input.tx, String(po.id), snapshot.lines);
      eventType = "PO.UPDATED";
      break;
    }
    case "PO.ISSUE": {
      if (po.lifecycle_state !== "DRAFT")
        fail("Only a DRAFT purchase order can be issued.");
      const snapshot = po.draft_snapshot as Snapshot;
      const supplier = await input.tx.query(
        "SELECT state FROM procurement.suppliers WHERE tenant_id=$1 AND id=$2 FOR SHARE",
        [input.tx.tenantId, po.supplier_id],
      );
      if (
        !supplier.rowCount ||
        !["APPROVED", "PREFERRED"].includes(String(supplier.rows[0]!.state))
      )
        fail("PO issue requires an APPROVED or PREFERRED supplier.");
      if (po.rfq_id) {
        const source = await input.tx.query(
          `SELECT r.state,r.awarded_quotation_id,q.supplier_id,q.state AS quotation_state
             FROM procurement.rfqs r JOIN procurement.quotations q
               ON q.tenant_id=r.tenant_id AND q.rfq_id=r.id AND q.id=r.awarded_quotation_id
            WHERE r.tenant_id=$1 AND r.id=$2 AND q.id=$3`,
          [input.tx.tenantId, po.rfq_id, po.source_quotation_id],
        );
        if (
          !source.rowCount ||
          source.rows[0]!.state !== "AWARDED" ||
          source.rows[0]!.quotation_state !== "ACCEPTED" ||
          source.rows[0]!.supplier_id !== po.supplier_id ||
          source.rows[0]!.awarded_quotation_id !== po.source_quotation_id
        )
          fail(
            "RFQ-linked PO must use its awarded RFQ, winning supplier and accepted quotation.",
          );
      }
      const hash = snapshotHash(snapshot);
      const approval = await currentApproval({
        tx: input.tx,
        poId: String(po.id),
        sourceType: "PO_ISSUE",
        requestId: po.issue_approval_request_id
          ? String(po.issue_approval_request_id)
          : null,
      });
      if (
        approval &&
        (approval.state !== "APPROVED" ||
          !approvalContextMatches(approval, {
            aggregate_version: Number(po.aggregate_version),
            commercial_snapshot_hash: hash,
          }))
      )
        fail(
          "Linked PO_ISSUE approval is not approved for the current PO version and commercial context.",
        );
      const commercialVersion = 1;
      const approvalId = approval ? String(approval.id) : null;
      await appendCommercialVersion({
        tx: input.tx,
        po,
        snapshot,
        version: commercialVersion,
        baseAggregateVersion: Number(po.aggregate_version),
        reason,
        actorId: input.actorId,
        correlationId: input.correlationId,
        approvalRequestId: approvalId,
      });
      await input.tx.query(
        "DELETE FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version IS NULL",
        [input.tx.tenantId, po.id],
      );
      await input.tx.query(
        `UPDATE procurement.purchase_orders SET lifecycle_state='ISSUED',current_commercial_version=1,
          issued_at=now(),aggregate_version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3 AND aggregate_version=$4`,
        [nextVersion, input.tx.tenantId, po.id, input.expectedVersion],
      );
      eventType = "PO.ISSUED";
      break;
    }
    case "PO.HOLD":
      if (po.lifecycle_state !== "ISSUED")
        fail("Only an ISSUED purchase order can be put on hold.");
      await input.tx.query(
        "UPDATE procurement.purchase_orders SET lifecycle_state='ON_HOLD',aggregate_version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
        [nextVersion, input.tx.tenantId, po.id],
      );
      eventType = "PO.HELD";
      break;
    case "PO.RESUME":
      if (po.lifecycle_state !== "ON_HOLD")
        fail("Only an ON_HOLD purchase order can be resumed.");
      await input.tx.query(
        "UPDATE procurement.purchase_orders SET lifecycle_state='ISSUED',aggregate_version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
        [nextVersion, input.tx.tenantId, po.id],
      );
      eventType = "PO.RESUMED";
      break;
    case "PO.AMEND": {
      if (
        !["ISSUED", "ON_HOLD"].includes(String(po.lifecycle_state)) ||
        po.receipt_state !== "NOT_RECEIVED" ||
        Number(po.committed_receipt_count) !== 0
      )
        fail("Only an unreceived ISSUED or ON_HOLD PO can be amended.");
      const current = await snapshotFor(input.tx, po);
      const proposed = normalizedSnapshot({ ...current, ...input.body });
      if (proposed.supplier_id !== po.supplier_id)
        fail("Supplier cannot change after PO issue.");
      const baseVersion = Number(po.current_commercial_version);
      const baseHash = snapshotHash(current);
      const proposedHash = snapshotHash(proposed);
      const approval = await currentApproval({
        tx: input.tx,
        poId: String(po.id),
        sourceType: "PO_AMENDMENT",
        requestId: po.amendment_approval_request_id
          ? String(po.amendment_approval_request_id)
          : null,
      });
      if (
        input.body.approval_request_id !== undefined &&
        (!approval || input.body.approval_request_id !== approval.id)
      )
        fail(
          "approval_request_id does not identify the current linked PO_AMENDMENT request.",
        );
      if (
        approval &&
        (approval.state !== "APPROVED" ||
          !approvalContextMatches(approval, {
            base_aggregate_version: Number(po.aggregate_version),
            base_commercial_version: baseVersion,
            base_commercial_snapshot_hash: baseHash,
            proposed_commercial_snapshot_hash: proposedHash,
          }))
      )
        fail(
          "Linked PO_AMENDMENT approval is not approved for this base version and proposed context.",
        );
      const commercialVersion = baseVersion + 1;
      await appendCommercialVersion({
        tx: input.tx,
        po,
        snapshot: proposed,
        version: commercialVersion,
        baseAggregateVersion: Number(po.aggregate_version),
        reason,
        actorId: input.actorId,
        correlationId: input.correlationId,
        approvalRequestId: approval ? String(approval.id) : null,
      });
      await input.tx.query(
        `UPDATE procurement.purchase_orders SET current_commercial_version=$1,aggregate_version=$2,updated_at=now()
          WHERE tenant_id=$3 AND id=$4 AND aggregate_version=$5`,
        [
          commercialVersion,
          nextVersion,
          input.tx.tenantId,
          po.id,
          input.expectedVersion,
        ],
      );
      eventType = "PO.AMENDED";
      break;
    }
    case "PO.CANCEL":
      if (!["DRAFT", "ISSUED", "ON_HOLD"].includes(String(po.lifecycle_state)))
        fail(
          "This purchase order cannot be cancelled from its current lifecycle state.",
        );
      if (
        po.receipt_state !== "NOT_RECEIVED" ||
        Number(po.committed_receipt_count) !== 0
      )
        fail(
          "A purchase order with any committed receipt cannot be cancelled.",
        );
      if (po.lifecycle_state === "DRAFT")
        await input.tx.query(
          "DELETE FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version IS NULL",
          [input.tx.tenantId, po.id],
        );
      await input.tx.query(
        "UPDATE procurement.purchase_orders SET lifecycle_state='CANCELLED',aggregate_version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
        [nextVersion, input.tx.tenantId, po.id],
      );
      eventType = "PO.CANCELLED";
      break;
    case "PO.CLOSE":
      if (
        !["ISSUED", "ON_HOLD"].includes(String(po.lifecycle_state)) ||
        po.receipt_state !== "FULLY_RECEIVED"
      )
        fail(
          "PO.CLOSE requires an ISSUED or ON_HOLD PO that is FULLY_RECEIVED.",
        );
      await input.tx.query(
        "UPDATE procurement.purchase_orders SET lifecycle_state='CLOSED',aggregate_version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
        [nextVersion, input.tx.tenantId, po.id],
      );
      eventType = "PO.CLOSED";
      break;
    case "PO.CLOSE_REMAINDER":
      if (
        !["ISSUED", "ON_HOLD"].includes(String(po.lifecycle_state)) ||
        po.receipt_state !== "PARTIALLY_RECEIVED"
      )
        fail(
          "PO.CLOSE_REMAINDER requires an ISSUED or ON_HOLD PO that is PARTIALLY_RECEIVED.",
        );
      await input.tx.query(
        "UPDATE procurement.purchase_orders SET lifecycle_state='CLOSED',aggregate_version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
        [nextVersion, input.tx.tenantId, po.id],
      );
      eventType = "PO.REMAINDER_CLOSED";
      break;
  }

  const refreshed = await getPo(input.tx, String(po.id));
  const after = await insertHistory({
    tx: input.tx,
    row: refreshed,
    before,
    beforeLifecycle,
    beforeReceipt,
    command: input.command,
    actorId: input.actorId,
    reason,
    correlationId: input.correlationId,
  });
  const event = makeEvent({
    eventType: eventType!,
    id: String(po.id),
    version: nextVersion,
    before,
    after,
    reason,
  });
  if (input.command === "PO.UPDATE_DRAFT")
    event.payload.changed_fields = changedFields(
      po.draft_snapshot as Record<string, unknown>,
      refreshed.draft_snapshot as Record<string, unknown>,
    );
  if (input.command === "PO.ISSUE") {
    event.payload.commercial_version = 1;
    event.payload.supplier_id = refreshed.supplier_id;
    event.payload.issued_at = refreshed.issued_at;
    event.payload.expected_delivery = refreshed.expected_delivery;
    event.payload.approval_reference =
      refreshed.issue_approval_request_id ?? null;
    event.payload.commercial_snapshot_hash = snapshotHash(
      await snapshotFor(input.tx, refreshed),
    );
  }
  if (input.command === "PO.AMEND") {
    const oldSnapshot = await snapshotFor(input.tx, po);
    const newSnapshot = await snapshotFor(input.tx, refreshed);
    event.payload.base_commercial_version = Number(
      po.current_commercial_version,
    );
    event.payload.commercial_version = Number(
      refreshed.current_commercial_version,
    );
    event.payload.new_commercial_version = Number(
      refreshed.current_commercial_version,
    );
    event.payload.approval_reference =
      refreshed.amendment_approval_request_id ?? null;
    event.payload.commercial_snapshot_hash = snapshotHash(newSnapshot);
    event.payload.material_changes = changedFields(
      oldSnapshot as Record<string, unknown>,
      newSnapshot as Record<string, unknown>,
    );
  }
  if (input.command === "PO.CLOSE")
    event.payload.completed_at = refreshed.updated_at;
  if (input.command === "PO.CLOSE_REMAINDER") {
    event.payload.received_quantities = refreshed.received_quantities;
    event.payload.remaining_quantities = refreshed.remaining_quantities;
  }
  return { data: after, status: 200, events: [event] };
}

export async function readPurchaseOrder(tx: Transaction, id: string) {
  const po = await getPo(tx, id);
  const snapshot = await snapshotFor(tx, po);
  const versions = await tx.query(
    `SELECT commercial_version,base_aggregate_version,snapshot_hash,reason,approval_request_id,actor_id,correlation_id,created_at
       FROM procurement.purchase_order_versions WHERE tenant_id=$1 AND purchase_order_id=$2 ORDER BY commercial_version`,
    [tx.tenantId, id],
  );
  return {
    ...safe(po),
    commercial_snapshot: snapshot,
    commercial_versions: versions.rows,
  };
}

export async function listPurchaseOrders(
  tx: Transaction,
  input: {
    limit: number;
    offset: number;
    state?: string | null;
  },
) {
  const result = await tx.query(
    `SELECT id,code,procurement_request_id,rfq_id,supplier_id,source_quotation_id,lifecycle_state,receipt_state,
            aggregate_version,current_commercial_version,created_at,updated_at
       FROM procurement.purchase_orders WHERE tenant_id=$1 AND ($2::text IS NULL OR lifecycle_state=$2)
      ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,
    [tx.tenantId, input.state ?? null, input.limit, input.offset],
  );
  return result.rows.map(safe);
}
