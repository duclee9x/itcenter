import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

export type GoodsReceiptCommand =
  | "GOODS_RECEIPT.CREATE"
  | "GOODS_RECEIPT.UPDATE_DRAFT"
  | "GOODS_RECEIPT.POST"
  | "GOODS_RECEIPT.CANCEL";
export type GoodsReceiptEvent = {
  type: string;
  aggregateType: "GOODS_RECEIPT" | "PURCHASE_ORDER";
  aggregateId: string;
  version: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  payload: Record<string, unknown>;
};
export type GoodsReceiptResult = {
  data: Record<string, unknown>;
  status: number;
  events: GoodsReceiptEvent[];
};

type ReceiptLineInput = {
  purchase_order_line_id: string;
  observed_quantity: number;
  accepted_quantity: number;
  rejected_or_damaged_quantity?: number;
  evidence_document_refs?: unknown[];
  units?: Array<{
    id?: string;
    identity_type?: string;
    identity_value?: string;
    serial_number: string;
    condition?: string;
    evidence_refs?: unknown[];
  }>;
};

function fail(
  message: string,
  code:
    | "BUSINESS_RULE_VIOLATION"
    | "VALIDATION_ERROR"
    | "GOODS_RECEIPT_OVER_ORDERED_QUANTITY"
    | "GOODS_RECEIPT_PO_NOT_RECEIVABLE"
    | "GOODS_RECEIPT_BLOCKING_EXCEPTION"
    | "GOODS_RECEIPT_UNIT_IDENTITY_DUPLICATE"
    | "VERSION_CONFLICT" = "BUSINESS_RULE_VIOLATION",
): never {
  throw new ApplicationError(code, message);
}
function quantity(value: unknown, label: string, allowZero = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value * 10000) ||
    value < (allowZero ? 0 : 0.0001)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${label} must be a ${allowZero ? "non-negative" : "positive"} quantity with at most 4 decimal places.`,
    );
  return value;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${label} must be an object.`,
    );
  return value as Record<string, unknown>;
}
function arr(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${label} must be an array.`,
    );
  return value;
}
function json(value: unknown) {
  return JSON.stringify(value ?? []);
}
function safe(row: Record<string, unknown>) {
  const result = { ...row };
  delete result.tenant_id;
  result.aggregate_version = Number(row.aggregate_version);
  return result;
}
async function getReceipt(tx: Transaction, id: string, lock = false) {
  const result = await tx.query(
    `SELECT * FROM procurement.goods_receipts WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Goods Receipt was not found.");
  return result.rows[0]! as Record<string, unknown>;
}
async function receiptSnapshot(tx: Transaction, id: string) {
  const header = await getReceipt(tx, id);
  const lines = await tx.query(
    "SELECT * FROM procurement.goods_receipt_lines WHERE tenant_id=$1 AND goods_receipt_id=$2 ORDER BY id",
    [tx.tenantId, id],
  );
  const units = await tx.query(
    "SELECT * FROM procurement.goods_receipt_units WHERE tenant_id=$1 AND goods_receipt_id=$2 ORDER BY id",
    [tx.tenantId, id],
  );
  const exceptions = await tx.query(
    "SELECT id,goods_receipt_line_id,received_unit_id,exception_type,blocking,status,reason,observed_facts,evidence_refs FROM procurement.receiving_exceptions WHERE tenant_id=$1 AND goods_receipt_id=$2 ORDER BY id",
    [tx.tenantId, id],
  );
  const assetization = await tx.query(
    "SELECT received_unit_id,status,attempt_count,failure_code,asset_id,updated_at FROM procurement.receipt_assetization_state WHERE tenant_id=$1 AND goods_receipt_id=$2 ORDER BY received_unit_id",
    [tx.tenantId, id],
  );
  return {
    ...safe(header),
    lines: lines.rows,
    units: units.rows,
    exceptions: exceptions.rows,
    assetization: assetization.rows,
  };
}
async function addHistory(input: {
  tx: Transaction;
  row: Record<string, unknown>;
  action: string;
  before: unknown;
  after: unknown;
  actorId: string;
  reason: string;
  correlationId: string;
}) {
  await input.tx.query(
    "INSERT INTO procurement.goods_receipt_history(id,tenant_id,goods_receipt_id,aggregate_version,action,before_snapshot,after_snapshot,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.row.id,
      input.row.aggregate_version,
      input.action,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.actorId,
      input.reason || input.action,
      input.correlationId,
    ],
  );
}
function receiptEvent(
  type: string,
  id: string,
  version: number,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  payload: Record<string, unknown>,
): GoodsReceiptEvent {
  return {
    type,
    aggregateType: "GOODS_RECEIPT",
    aggregateId: id,
    version,
    before,
    after,
    payload,
  };
}

async function replaceDraft(input: {
  tx: Transaction;
  receiptId: string;
  lines: unknown;
  exceptions: unknown;
}) {
  const lines = arr(input.lines, "lines");
  if (!lines.length || lines.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "lines must contain between 1 and 200 entries.",
    );
  await input.tx.query(
    "DELETE FROM procurement.receiving_exceptions WHERE tenant_id=$1 AND goods_receipt_id=$2",
    [input.tx.tenantId, input.receiptId],
  );
  await input.tx.query(
    "DELETE FROM procurement.goods_receipt_units WHERE tenant_id=$1 AND goods_receipt_id=$2",
    [input.tx.tenantId, input.receiptId],
  );
  await input.tx.query(
    "DELETE FROM procurement.goods_receipt_lines WHERE tenant_id=$1 AND goods_receipt_id=$2",
    [input.tx.tenantId, input.receiptId],
  );
  const seenUnitKeys = new Set<string>();
  const seenSerials = new Set<string>();
  const seenPoLineIds = new Set<string>();
  for (const entry of lines) {
    const line = object(entry, "receipt line");
    const poLineId = String(line.purchase_order_line_id ?? "");
    if (seenPoLineIds.has(poLineId))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "A PO line may appear only once in a Goods Receipt.",
      );
    seenPoLineIds.add(poLineId);
    const observed = quantity(
      line.observed_quantity,
      "observed_quantity",
      true,
    );
    const accepted = quantity(
      line.accepted_quantity,
      "accepted_quantity",
      true,
    );
    const rejected = quantity(
      line.rejected_or_damaged_quantity ?? 0,
      "rejected_or_damaged_quantity",
      true,
    );
    if (!poLineId || accepted + rejected > observed)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Receipt quantities must satisfy accepted + rejected/damaged <= observed.",
      );
    const poLine = await input.tx.query(
      `SELECT l.id,l.purchase_order_id,l.commercial_version,l.quantity,l.unit,l.item_type,l.item_reference_id,l.description
      FROM procurement.purchase_order_lines l JOIN procurement.goods_receipts g ON g.tenant_id=l.tenant_id AND g.purchase_order_id=l.purchase_order_id
      WHERE g.tenant_id=$1 AND g.id=$2 AND l.id=$3 AND l.commercial_version=g.purchase_order_commercial_version`,
      [input.tx.tenantId, input.receiptId, poLineId],
    );
    if (!poLine.rowCount)
      fail(
        "Receipt line must reference a line in the pinned PO commercial version.",
        "VALIDATION_ERROR",
      );
    const source = poLine.rows[0]!;
    const lineId = randomUUID();
    const evidence = arr(
      line.evidence_document_refs ?? [],
      "evidence_document_refs",
    );
    await input.tx.query(
      `INSERT INTO procurement.goods_receipt_lines
      (id,tenant_id,goods_receipt_id,purchase_order_id,purchase_order_line_id,commercial_version,ordered_quantity_snapshot,observed_quantity,accepted_quantity,rejected_or_damaged_quantity,unit,item_reference_id,item_type,description_snapshot,evidence_document_refs)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
      [
        lineId,
        input.tx.tenantId,
        input.receiptId,
        source.purchase_order_id,
        source.id,
        source.commercial_version,
        source.quantity,
        observed,
        accepted,
        rejected,
        source.unit,
        source.item_reference_id,
        source.item_type,
        source.description,
        json(evidence),
      ],
    );
    const units = arr(line.units ?? [], "units") as ReceiptLineInput["units"];
    if (
      accepted > 0 &&
      ["ASSET", "ASSET_TRACKED"].includes(
        String(source.item_type).toUpperCase(),
      )
    ) {
      if (
        !source.item_reference_id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          String(source.item_reference_id),
        )
      )
        fail("Asset-tracked PO line must reference an Asset model UUID.");
      if (!Number.isInteger(accepted) || units!.length !== accepted)
        fail(
          "Every accepted Asset-tracked unit requires one stable identity and serial number.",
        );
    }
    if (units!.length > accepted)
      fail(
        "Received units cannot exceed accepted quantity.",
        "VALIDATION_ERROR",
      );
    for (const unitValue of units!) {
      const unit = object(unitValue, "received unit");
      const id = typeof unit.id === "string" ? unit.id : randomUUID();
      const identityType =
        typeof unit.identity_type === "string"
          ? unit.identity_type.trim().toUpperCase()
          : "SERIAL";
      const identityValue =
        typeof unit.identity_value === "string"
          ? unit.identity_value.trim()
          : typeof unit.serial_number === "string"
            ? unit.serial_number.trim()
            : "";
      const serial =
        typeof unit.serial_number === "string" ? unit.serial_number.trim() : "";
      if (!identityValue || !serial)
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Received unit identity and serial_number are required.",
        );
      const dedupe = `${identityType}:${identityValue.toLocaleLowerCase()}`;
      if (seenUnitKeys.has(dedupe))
        fail(
          "Duplicate serialized unit identity within this receipt.",
          "GOODS_RECEIPT_UNIT_IDENTITY_DUPLICATE",
        );
      seenUnitKeys.add(dedupe);
      const normalizedSerial = serial.toLocaleLowerCase();
      if (seenSerials.has(normalizedSerial))
        fail(
          "Duplicate serial identity within this receipt.",
          "GOODS_RECEIPT_UNIT_IDENTITY_DUPLICATE",
        );
      seenSerials.add(normalizedSerial);
      await input.tx.query(
        "INSERT INTO procurement.goods_receipt_units(id,tenant_id,goods_receipt_id,goods_receipt_line_id,identity_type,identity_value,serial_number,accepted,condition,evidence_refs) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9::jsonb)",
        [
          id,
          input.tx.tenantId,
          input.receiptId,
          lineId,
          identityType,
          identityValue,
          serial,
          String(unit.condition ?? "ACCEPTED"),
          json(unit.evidence_refs),
        ],
      );
    }
  }
  const exceptions = arr(input.exceptions ?? [], "exceptions");
  for (const value of exceptions) {
    const e = object(value, "receiving exception");
    if (typeof e.reason !== "string" || !e.reason.trim())
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Receiving exception requires reason.",
      );
    await input.tx.query(
      `INSERT INTO procurement.receiving_exceptions(id,tenant_id,goods_receipt_id,goods_receipt_line_id,received_unit_id,exception_type,blocking,status,reason,observed_facts,evidence_refs)
      VALUES($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9::jsonb,$10::jsonb)`,
      [
        randomUUID(),
        input.tx.tenantId,
        input.receiptId,
        e.goods_receipt_line_id ?? null,
        e.received_unit_id ?? null,
        String(e.exception_type ?? "RECEIVING_EXCEPTION"),
        e.blocking !== false,
        e.reason.trim(),
        JSON.stringify(e.observed_facts ?? {}),
        json(e.evidence_refs),
      ],
    );
  }
}

export async function executeGoodsReceiptCommand(input: {
  tx: Transaction;
  actorId: string;
  actorType: string;
  correlationId: string;
  command: GoodsReceiptCommand;
  id?: string;
  expectedVersion?: number;
  body: Record<string, unknown>;
  reason: string;
}): Promise<GoodsReceiptResult> {
  const { tx } = input;
  if (input.command === "GOODS_RECEIPT.CREATE") {
    const poId = String(input.body.purchase_order_id ?? "");
    if (!poId)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "purchase_order_id is required.",
      );
    const poResult = await tx.query(
      "SELECT p.*,s.legal_name AS supplier_name FROM procurement.purchase_orders p JOIN procurement.suppliers s ON s.tenant_id=p.tenant_id AND s.id=p.supplier_id WHERE p.tenant_id=$1 AND p.id=$2 FOR UPDATE OF p",
      [tx.tenantId, poId],
    );
    if (!poResult.rowCount)
      throw new ApplicationError("NOT_FOUND", "Purchase order was not found.");
    const po = poResult.rows[0]!;
    if (po.lifecycle_state !== "ISSUED")
      fail(
        "Goods Receipt may be created only for an ISSUED PO.",
        "GOODS_RECEIPT_PO_NOT_RECEIVABLE",
      );
    const id = randomUUID(),
      code = `GR-${id.slice(0, 8).toUpperCase()}`;
    const inserted = await tx.query(
      `INSERT INTO procurement.goods_receipts(id,tenant_id,receipt_code,purchase_order_id,purchase_order_code_snapshot,purchase_order_commercial_version,supplier_id,supplier_display_snapshot,warehouse_id,location_id,receiving_actor_id,received_at,correlation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,now()),$13) RETURNING *`,
      [
        id,
        tx.tenantId,
        code,
        po.id,
        po.code,
        po.current_commercial_version,
        po.supplier_id,
        po.supplier_name,
        input.body.warehouse_id ?? null,
        input.body.location_id ?? null,
        input.actorId,
        input.body.received_at ?? null,
        input.correlationId,
      ],
    );
    await replaceDraft({
      tx,
      receiptId: id,
      lines: input.body.lines,
      exceptions: input.body.exceptions ?? [],
    });
    const after = await receiptSnapshot(tx, id);
    await addHistory({
      tx,
      row: inserted.rows[0]!,
      action: input.command,
      before: null,
      after,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
    });
    return {
      data: after,
      status: 201,
      events: [
        receiptEvent("GOODS_RECEIPT.CREATED", id, 1, null, after, {
          goods_receipt_id: id,
          receipt_code: code,
          purchase_order_id: po.id,
          supplier_id: po.supplier_id,
          warehouse_id: input.body.warehouse_id ?? null,
          location_id: input.body.location_id ?? null,
          state: "DRAFT",
          aggregate_version: 1,
        }),
      ],
    };
  }
  const id = input.id!;
  const receipt = await getReceipt(tx, id, true);
  assertVersion(Number(receipt.aggregate_version), input.expectedVersion!);
  if (receipt.state !== "DRAFT")
    fail("Only a DRAFT Goods Receipt can be changed.");
  const before = await receiptSnapshot(tx, id),
    version = Number(receipt.aggregate_version) + 1;
  if (input.command === "GOODS_RECEIPT.UPDATE_DRAFT") {
    await replaceDraft({
      tx,
      receiptId: id,
      lines: input.body.lines,
      exceptions: input.body.exceptions ?? [],
    });
    await tx.query(
      "UPDATE procurement.goods_receipts SET warehouse_id=$1,location_id=$2,received_at=$3,aggregate_version=$4,updated_at=now() WHERE tenant_id=$5 AND id=$6 AND aggregate_version=$7",
      [
        input.body.warehouse_id ?? receipt.warehouse_id,
        input.body.location_id ?? receipt.location_id,
        input.body.received_at ?? receipt.received_at,
        version,
        tx.tenantId,
        id,
        input.expectedVersion,
      ],
    );
    const after = await receiptSnapshot(tx, id);
    await addHistory({
      tx,
      row: { ...receipt, aggregate_version: version },
      action: input.command,
      before,
      after,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
    });
    return {
      data: after,
      status: 200,
      events: [
        receiptEvent("GOODS_RECEIPT.UPDATED", id, version, before, after, {
          goods_receipt_id: id,
          purchase_order_id: receipt.purchase_order_id,
          state: "DRAFT",
          aggregate_version: version,
          changed_fields: [
            "lines",
            "warehouse_id",
            "location_id",
            "received_at",
          ],
        }),
      ],
    };
  }
  if (input.command === "GOODS_RECEIPT.CANCEL") {
    await tx.query(
      "UPDATE procurement.goods_receipts SET state='CANCELLED',cancelled_at=now(),cancellation_reason=$1,aggregate_version=$2,updated_at=now() WHERE tenant_id=$3 AND id=$4 AND aggregate_version=$5",
      [input.reason, version, tx.tenantId, id, input.expectedVersion],
    );
    const after = await receiptSnapshot(tx, id);
    await addHistory({
      tx,
      row: { ...receipt, state: "CANCELLED", aggregate_version: version },
      action: input.command,
      before,
      after,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
    });
    return {
      data: after,
      status: 200,
      events: [
        receiptEvent("GOODS_RECEIPT.CANCELLED", id, version, before, after, {
          goods_receipt_id: id,
          purchase_order_id: receipt.purchase_order_id,
          aggregate_version: version,
          reason: input.reason,
          cancelled_at: new Date().toISOString(),
        }),
      ],
    };
  }
  // Lock PO after receipt, serializing receipt posting with every PO state command.
  const poResult = await tx.query(
    "SELECT * FROM procurement.purchase_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, receipt.purchase_order_id],
  );
  if (!poResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Purchase order was not found.");
  const po = poResult.rows[0]!;
  if (po.lifecycle_state !== "ISSUED")
    fail(
      "Only an ISSUED PO may receive goods.",
      "GOODS_RECEIPT_PO_NOT_RECEIVABLE",
    );
  if (String(receipt.supplier_id) !== String(po.supplier_id))
    fail("Goods Receipt supplier must match the PO.");
  if (
    Number(receipt.purchase_order_commercial_version) !==
    Number(po.current_commercial_version)
  )
    fail(
      "Goods Receipt must reference the current PO commercial version.",
      "VERSION_CONFLICT",
    );
  const blocking = await tx.query(
    "SELECT id FROM procurement.receiving_exceptions WHERE tenant_id=$1 AND goods_receipt_id=$2 AND blocking AND status='OPEN' LIMIT 1",
    [tx.tenantId, id],
  );
  if (blocking.rowCount)
    fail(
      "Unresolved blocking receiving exception prevents POST.",
      "GOODS_RECEIPT_BLOCKING_EXCEPTION",
    );
  const lines = await tx.query(
    `SELECT gl.*,pl.quantity AS ordered_quantity,pl.commercial_version AS po_commercial_version
    FROM procurement.goods_receipt_lines gl JOIN procurement.purchase_order_lines pl ON pl.id=gl.purchase_order_line_id AND pl.tenant_id=gl.tenant_id
    WHERE gl.tenant_id=$1 AND gl.goods_receipt_id=$2 ORDER BY gl.purchase_order_line_id FOR UPDATE OF gl`,
    [tx.tenantId, id],
  );
  const currentReceived = (po.received_quantities ?? {}) as Record<
      string,
      number
    >,
    nextReceived = { ...currentReceived };
  let acceptedTotal = 0;
  for (const line of lines.rows) {
    if (Number(line.accepted_quantity) <= 0)
      fail(
        "Every posted receipt line requires accepted_quantity > 0.",
        "VALIDATION_ERROR",
      );
    if (
      Number(line.commercial_version) !== Number(po.current_commercial_version)
    )
      fail("Receipt line is pinned to a stale PO version.", "VERSION_CONFLICT");
    const previous = Number(
        currentReceived[String(line.purchase_order_line_id)] ?? 0,
      ),
      accepted = Number(line.accepted_quantity),
      ordered = Number(line.ordered_quantity);
    if (previous + accepted > ordered)
      fail(
        "Cumulative accepted quantity exceeds the PO line quantity.",
        "GOODS_RECEIPT_OVER_ORDERED_QUANTITY",
      );
    await tx.query(
      "UPDATE procurement.goods_receipt_lines SET previously_accepted_quantity_at_post=$1 WHERE tenant_id=$2 AND id=$3",
      [previous, tx.tenantId, line.id],
    );
    nextReceived[String(line.purchase_order_line_id)] = previous + accepted;
    acceptedTotal += accepted;
  }
  if (!lines.rowCount)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Goods Receipt must contain at least one line.",
    );
  const units = await tx.query(
    `SELECT u.id,u.goods_receipt_line_id,u.serial_number,l.item_type,l.item_reference_id FROM procurement.goods_receipt_units u JOIN procurement.goods_receipt_lines l ON l.tenant_id=u.tenant_id AND l.id=u.goods_receipt_line_id WHERE u.tenant_id=$1 AND u.goods_receipt_id=$2 AND u.accepted ORDER BY u.id`,
    [tx.tenantId, id],
  );
  for (const line of lines.rows.filter(
    (l) =>
      Number(l.accepted_quantity) > 0 &&
      ["ASSET", "ASSET_TRACKED"].includes(String(l.item_type).toUpperCase()),
  )) {
    const count = units.rows.filter(
      (u) => u.goods_receipt_line_id === line.id,
    ).length;
    if (count !== Number(line.accepted_quantity))
      fail(
        "Serialized Asset-tracked accepted units must each have a received-unit identity and serial number.",
      );
    if (!receipt.location_id)
      fail("Asset-tracked Goods Receipt requires a receiving location.");
    const model = await tx.query(
      "SELECT id FROM asset.models WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, line.item_reference_id],
    );
    if (!model.rowCount)
      fail("Asset-tracked PO line references a missing Asset model.");
  }
  const remaining = await tx.query(
    `SELECT id,quantity FROM procurement.purchase_order_lines WHERE tenant_id=$1 AND purchase_order_id=$2 AND commercial_version=$3`,
    [tx.tenantId, po.id, po.current_commercial_version],
  );
  const nextRemaining: Record<string, number> = {};
  let fullyReceived = true;
  for (const row of remaining.rows) {
    const value =
      Number(row.quantity) - Number(nextReceived[String(row.id)] ?? 0);
    nextRemaining[String(row.id)] = value;
    if (value > 0) fullyReceived = false;
  }
  const previousReceipt = String(po.receipt_state),
    nextReceipt = fullyReceived ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED";
  const poBefore = {
    lifecycle_state: po.lifecycle_state,
    receipt_state: po.receipt_state,
    aggregate_version: Number(po.aggregate_version),
    current_commercial_version: Number(po.current_commercial_version),
    committed_receipt_count: Number(po.committed_receipt_count),
    received_quantities: currentReceived,
    remaining_quantities: po.remaining_quantities,
  };
  const poVersion = Number(po.aggregate_version) + 1;
  await tx.query(
    `UPDATE procurement.purchase_orders SET receipt_state=$1,committed_receipt_count=committed_receipt_count+1,received_quantities=$2::jsonb,remaining_quantities=$3::jsonb,aggregate_version=$4,updated_at=now()
    WHERE tenant_id=$5 AND id=$6 AND aggregate_version=$7 AND lifecycle_state='ISSUED'`,
    [
      nextReceipt,
      JSON.stringify(nextReceived),
      JSON.stringify(nextRemaining),
      poVersion,
      tx.tenantId,
      po.id,
      po.aggregate_version,
    ],
  );
  const poAfter = {
    ...poBefore,
    receipt_state: nextReceipt,
    aggregate_version: poVersion,
    committed_receipt_count: Number(po.committed_receipt_count) + 1,
    received_quantities: nextReceived,
    remaining_quantities: nextRemaining,
  };
  await tx.query(
    `INSERT INTO procurement.purchase_order_history(id,tenant_id,purchase_order_id,aggregate_version,action,previous_lifecycle_state,lifecycle_state,previous_receipt_state,receipt_state,commercial_version,before_snapshot,after_snapshot,actor_id,reason,correlation_id)
    VALUES($1,$2,$3,$4,'GOODS_RECEIPT.POST',$5,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,'Goods receipt posted',$12)`,
    [
      randomUUID(),
      tx.tenantId,
      po.id,
      poVersion,
      po.lifecycle_state,
      previousReceipt,
      nextReceipt,
      po.current_commercial_version,
      JSON.stringify(poBefore),
      JSON.stringify(poAfter),
      input.actorId,
      input.correlationId,
    ],
  );
  const postedAt = new Date().toISOString();
  const postedSnapshot = {
    ...before,
    state: "POSTED",
    aggregate_version: version,
    posted_at: postedAt,
    purchase_order_code: po.code,
    purchase_order_commercial_version: Number(po.current_commercial_version),
    supplier_display_reference: receipt.supplier_display_snapshot,
    po_receipt_state_before: previousReceipt,
    po_receipt_state_after: nextReceipt,
    po_received_quantities_before: currentReceived,
    po_received_quantities_after: nextReceived,
    accepted_quantities: lines.rows.map((l) => ({
      purchase_order_line_id: l.purchase_order_line_id,
      accepted_quantity: Number(l.accepted_quantity),
      unit: l.unit,
    })),
  };
  await tx.query(
    "UPDATE procurement.goods_receipts SET state='POSTED',posted_at=$1,immutable_posted_snapshot=$2::jsonb,aggregate_version=$3,updated_at=now() WHERE tenant_id=$4 AND id=$5 AND aggregate_version=$6",
    [
      postedAt,
      JSON.stringify(postedSnapshot),
      version,
      tx.tenantId,
      id,
      input.expectedVersion,
    ],
  );
  for (const unit of units.rows.filter((u) =>
    ["ASSET", "ASSET_TRACKED"].includes(String(u.item_type).toUpperCase()),
  ))
    await tx.query(
      "INSERT INTO procurement.receipt_assetization_state(tenant_id,received_unit_id,goods_receipt_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [tx.tenantId, unit.id, id],
    );
  const after = await receiptSnapshot(tx, id);
  await addHistory({
    tx,
    row: { ...receipt, state: "POSTED", aggregate_version: version },
    action: input.command,
    before,
    after,
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
  });
  const acceptedLineReferences = lines.rows.map((l) => ({
    receipt_line_id: l.id,
    purchase_order_line_id: l.purchase_order_line_id,
    accepted_quantity: Number(l.accepted_quantity),
    unit: l.unit,
  }));
  const grEvent = receiptEvent(
    "GOODS_RECEIPT.POSTED",
    id,
    version,
    before,
    after,
    {
      goods_receipt_id: id,
      receipt_code: receipt.receipt_code,
      purchase_order_id: po.id,
      purchase_order_code: po.code,
      purchase_order_commercial_version: Number(po.current_commercial_version),
      supplier_id: po.supplier_id,
      supplier_display_reference: receipt.supplier_display_snapshot,
      warehouse_id: receipt.warehouse_id,
      location_id: receipt.location_id,
      aggregate_version: version,
      posted_at: postedAt,
      received_unit_ids: units.rows
        .filter((u) =>
          ["ASSET", "ASSET_TRACKED"].includes(
            String(u.item_type).toUpperCase(),
          ),
        )
        .map((u) => u.id),
      accepted_line_references: acceptedLineReferences,
      evidence_references: lines.rows.flatMap((l) =>
        Array.isArray(l.evidence_document_refs) ? l.evidence_document_refs : [],
      ),
      correlation_id: input.correlationId,
    },
  );
  const poEvent: GoodsReceiptEvent = {
    type:
      nextReceipt === "FULLY_RECEIVED"
        ? "PO.FULLY_RECEIVED"
        : "PO.PARTIALLY_RECEIVED",
    aggregateType: "PURCHASE_ORDER",
    aggregateId: String(po.id),
    version: poVersion,
    before: poBefore,
    after: poAfter,
    payload: {
      purchase_order_id: po.id,
      po_code: po.code,
      goods_receipt_id: id,
      previous_receipt_state: previousReceipt,
      receipt_state: nextReceipt,
      aggregate_version: poVersion,
      accepted_quantities: acceptedLineReferences,
    },
  };
  return {
    data: {
      ...after,
      purchase_order_progress: poAfter,
      accepted_quantity_total: acceptedTotal,
    },
    status: 200,
    events: [grEvent, poEvent],
  };
}

export async function readGoodsReceipt(tx: Transaction, id: string) {
  return receiptSnapshot(tx, id);
}
export async function listGoodsReceipts(
  tx: Transaction,
  input: { limit: number; offset: number; state?: string | null },
) {
  const result = await tx.query(
    `SELECT id,receipt_code,state,aggregate_version,purchase_order_id,purchase_order_code_snapshot,supplier_id,warehouse_id,location_id,received_at,posted_at,created_at FROM procurement.goods_receipts WHERE tenant_id=$1 AND ($2::text IS NULL OR state=$2) ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,
    [tx.tenantId, input.state ?? null, input.limit, input.offset],
  );
  return result.rows;
}

/** Procurement-owned receiving evidence contract for the future Invoice/3-Way Match flow. */
export async function readPostedAcceptedQuantitiesForMatching(
  tx: Transaction,
  purchaseOrderId: string,
) {
  const result = await tx.query(
    `SELECT pol.id AS purchase_order_line_id,pol.quantity AS ordered_quantity,
        COALESCE(sum(grl.accepted_quantity) FILTER (WHERE gr.state='POSTED'),0)::numeric AS posted_accepted_quantity,
        COALESCE(jsonb_agg(jsonb_build_object('goods_receipt_id',gr.id,'goods_receipt_line_id',grl.id,'accepted_quantity',grl.accepted_quantity)) FILTER (WHERE gr.state='POSTED'),'[]'::jsonb) AS posted_receipts
       FROM procurement.purchase_order_lines pol
       JOIN procurement.purchase_orders po ON po.tenant_id=pol.tenant_id AND po.id=pol.purchase_order_id
       LEFT JOIN procurement.goods_receipt_lines grl ON grl.tenant_id=pol.tenant_id AND grl.purchase_order_line_id=pol.id
       LEFT JOIN procurement.goods_receipts gr ON gr.tenant_id=grl.tenant_id AND gr.id=grl.goods_receipt_id
      WHERE po.tenant_id=$1 AND po.id=$2 AND pol.commercial_version=po.current_commercial_version
      GROUP BY pol.id,pol.quantity ORDER BY pol.id`,
    [tx.tenantId, purchaseOrderId],
  );
  return result.rows;
}
export async function readReceivedUnitForAssetRegistration(
  tx: Transaction,
  receivedUnitId: string,
) {
  const result = await tx.query(
    `SELECT u.id AS received_unit_id,u.serial_number,u.identity_value,u.goods_receipt_id,l.item_reference_id AS asset_model_id,g.location_id,g.receipt_code
    FROM procurement.goods_receipt_units u JOIN procurement.goods_receipt_lines l ON l.tenant_id=u.tenant_id AND l.id=u.goods_receipt_line_id
    JOIN procurement.goods_receipts g ON g.tenant_id=u.tenant_id AND g.id=u.goods_receipt_id
    WHERE u.tenant_id=$1 AND u.id=$2 AND u.accepted AND g.state='POSTED' AND upper(l.item_type) IN ('ASSET','ASSET_TRACKED')`,
    [tx.tenantId, receivedUnitId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Posted Asset-tracked received unit was not found.",
    );
  return result.rows[0]!;
}
export async function recordAssetization(
  tx: Transaction,
  input: {
    receivedUnitId: string;
    status: "REGISTERED" | "FAILED";
    assetId?: string;
    failureCode?: string;
  },
) {
  await tx.query(
    "UPDATE procurement.receipt_assetization_state SET status=$1,asset_id=$2,failure_code=$3,updated_at=now() WHERE tenant_id=$4 AND received_unit_id=$5",
    [
      input.status,
      input.assetId ?? null,
      input.failureCode ?? null,
      tx.tenantId,
      input.receivedUnitId,
    ],
  );
}
