import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

export interface ProcurementRequestLine {
  item_type: string;
  item_reference_id?: string | null;
  description: string;
  quantity: number;
  estimated_unit_price?: number | null;
}

export interface ProcurementRequestInput {
  requester_user_id: string;
  source_type: string;
  source_id?: string | null;
  business_reason: string;
  target_date: string;
  cost_center_id?: string | null;
  project_id?: string | null;
  estimated_total?: number | null;
  currency?: string | null;
  priority?: string | null;
  lines: ProcurementRequestLine[];
}

function safeRequest(
  row: Record<string, unknown>,
  lines?: Record<string, unknown>[],
) {
  const output = { ...row };
  delete output.tenant_id;
  if (output.target_date instanceof Date) {
    const date = output.target_date;
    output.target_date = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  if (lines) return { ...output, lines };
  return output;
}

async function history(input: {
  tx: Transaction;
  id: string;
  version: number;
  action: string;
  from: string | null;
  to: string;
  actorId: string;
  reason: string;
  correlationId: string;
  before: unknown;
  after: unknown;
}) {
  await input.tx.query(
    `INSERT INTO procurement.request_history
       (id,tenant_id,procurement_request_id,entity_version,action,previous_state,
        new_state,before_snapshot,after_snapshot,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.id,
      input.version,
      input.action,
      input.from,
      input.to,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.actorId,
      input.reason,
      input.correlationId,
    ],
  );
}

export async function createProcurementRequest(input: {
  tx: Transaction;
  actorId: string;
  reason: string;
  correlationId: string;
  request: ProcurementRequestInput;
}) {
  if (!input.request.lines.length)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "At least one request line is required.",
    );
  const id = randomUUID();
  const requestCode = `PR-${id.slice(0, 8).toUpperCase()}`;
  const inserted = await input.tx.query(
    `INSERT INTO procurement.procurement_requests
       (id,tenant_id,request_code,requester_user_id,source_type,source_id,state,
        business_reason,cost_center_id,project_id,target_date,estimated_total,
        currency,priority,created_by)
     VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      id,
      input.tx.tenantId,
      requestCode,
      input.request.requester_user_id,
      input.request.source_type,
      input.request.source_id ?? null,
      input.request.business_reason,
      input.request.cost_center_id ?? null,
      input.request.project_id ?? null,
      input.request.target_date,
      input.request.estimated_total ?? null,
      input.request.currency ?? null,
      input.request.priority ?? null,
      input.actorId,
    ],
  );
  for (const [index, line] of input.request.lines.entries())
    await input.tx.query(
      `INSERT INTO procurement.procurement_request_lines
         (id,tenant_id,procurement_request_id,line_number,item_type,item_reference_id,
          description,quantity,estimated_unit_price)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        input.tx.tenantId,
        id,
        index + 1,
        line.item_type,
        line.item_reference_id ?? null,
        line.description,
        line.quantity,
        line.estimated_unit_price ?? null,
      ],
    );
  const lineRows = await input.tx.query(
    `SELECT line_number,item_type,item_reference_id,description,quantity,estimated_unit_price
       FROM procurement.procurement_request_lines
      WHERE tenant_id=$1 AND procurement_request_id=$2 ORDER BY line_number`,
    [input.tx.tenantId, id],
  );
  const result = safeRequest(inserted.rows[0]!, lineRows.rows);
  await history({
    tx: input.tx,
    id,
    version: 1,
    action: "PROCUREMENT.REQUEST_CREATE",
    from: null,
    to: "DRAFT",
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    before: null,
    after: result,
  });
  return result;
}

export async function submitProcurementRequest(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  correlationId: string;
}) {
  const currentResult = await input.tx.query(
    `SELECT * FROM procurement.procurement_requests
      WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tx.tenantId, input.id],
  );
  if (!currentResult.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Procurement Request was not found.",
    );
  const current = currentResult.rows[0]!;
  assertVersion(Number(current.version), input.expectedVersion);
  if (current.state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a DRAFT request can be submitted.",
    );
  const version = input.expectedVersion + 1;
  const updated = await input.tx.query(
    `UPDATE procurement.procurement_requests
        SET state='SUBMITTED',version=$1,updated_at=now()
      WHERE tenant_id=$2 AND id=$3 AND version=$4 RETURNING *`,
    [version, input.tx.tenantId, input.id, input.expectedVersion],
  );
  if (!updated.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Procurement Request version changed.",
    );
  const lines = await input.tx.query(
    `SELECT line_number,item_type,item_reference_id,description,quantity,estimated_unit_price
       FROM procurement.procurement_request_lines
      WHERE tenant_id=$1 AND procurement_request_id=$2 ORDER BY line_number`,
    [input.tx.tenantId, input.id],
  );
  const result = safeRequest(updated.rows[0]!, lines.rows);
  await history({
    tx: input.tx,
    id: input.id,
    version,
    action: "PROCUREMENT.REQUEST_SUBMIT",
    from: "DRAFT",
    to: "SUBMITTED",
    actorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    before: { state: current.state, version: input.expectedVersion },
    after: { state: "SUBMITTED", version },
  });
  return result;
}

export async function readProcurementRequest(tx: Transaction, id: string) {
  const result = await tx.query(
    "SELECT * FROM procurement.procurement_requests WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Procurement Request was not found.",
    );
  const lines = await tx.query(
    `SELECT line_number,item_type,item_reference_id,description,quantity,estimated_unit_price
       FROM procurement.procurement_request_lines
      WHERE tenant_id=$1 AND procurement_request_id=$2 ORDER BY line_number`,
    [tx.tenantId, id],
  );
  return safeRequest(result.rows[0]!, lines.rows);
}

export async function listProcurementRequests(
  tx: Transaction,
  input: {
    state?: string | null;
    limit: number;
    offset: number;
  },
) {
  const result = await tx.query(
    `SELECT r.* FROM procurement.procurement_requests r
      WHERE r.tenant_id=$1 AND ($2::text IS NULL OR r.state=$2)
      ORDER BY r.created_at DESC,r.id LIMIT $3 OFFSET $4`,
    [tx.tenantId, input.state ?? null, input.limit, input.offset],
  );
  return result.rows.map((row) => safeRequest(row));
}
