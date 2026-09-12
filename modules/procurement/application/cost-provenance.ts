import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../audit/index.js";

export type CostTargetType = "ASSET" | "LICENSE_ENTITLEMENT" | "LICENSE_POOL";
export type CostSourceType =
  | "PURCHASE_ORDER"
  | "INVOICE"
  | "CREDIT_NOTE"
  | "CONTRACT"
  | "CONTRACT_VERSION";
export type CostBasis = "COMMITTED" | "ACTUAL" | "ADJUSTMENT";

export interface CostProvenanceInput {
  targetType: CostTargetType;
  targetId: string;
  sourceType: CostSourceType;
  sourceDocumentId: string;
  sourceVersionRef: string;
  sourceLineId?: string | null;
  basis: CostBasis;
  adjustmentDirection?: "CREDIT" | "DEBIT" | null;
  amount: string | number;
  currency: string;
  quantity: string | number;
  allocationMethod: string;
  allocationRole: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

function invalid(message: string): never {
  throw new ApplicationError("VALIDATION_ERROR", message);
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function positive(value: string | number, field: string, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0))
    invalid(`${field} must be ${allowZero ? "non-negative" : "positive"}.`);
  return number.toFixed(6);
}
function micros(value: string | number) {
  const fixed = Number(value).toFixed(6);
  const [whole, fraction = ""] = fixed.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

async function assertTarget(tx: Transaction, type: CostTargetType, id: string) {
  const table =
    type === "ASSET"
      ? "asset.assets"
      : type === "LICENSE_ENTITLEMENT"
        ? "license.license_entitlements"
        : "license.license_pools";
  const result = await tx.query(
    `SELECT id FROM ${table} WHERE tenant_id=$1 AND id=$2`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Cost target was not found in this tenant.",
    );
}

async function assertSource(
  tx: Transaction,
  input: CostProvenanceInput,
  lineId: string | null,
) {
  let valid = false;
  switch (input.sourceType) {
    case "PURCHASE_ORDER": {
      const result = await tx.query(
        `SELECT 1 FROM procurement.purchase_orders po
          JOIN procurement.purchase_order_versions v
            ON v.tenant_id=po.tenant_id AND v.purchase_order_id=po.id
         WHERE po.tenant_id=$1 AND po.id=$2
           AND v.commercial_version=substring($3 from ':v([0-9]+)$')::integer
           AND ($4::uuid IS NULL OR EXISTS (
             SELECT 1 FROM procurement.purchase_order_lines l
              WHERE l.tenant_id=po.tenant_id AND l.purchase_order_id=po.id
                AND l.commercial_version=v.commercial_version AND l.id=$4))`,
        [tx.tenantId, input.sourceDocumentId, input.sourceVersionRef, lineId],
      );
      valid = Boolean(result.rowCount);
      break;
    }
    case "INVOICE": {
      const result = await tx.query(
        `SELECT 1 FROM procurement.invoices i
         WHERE i.tenant_id=$1 AND i.id=$2 AND i.lifecycle_state='APPROVED'
           AND i.snapshot_fingerprint=$3
           AND ($4::uuid IS NULL OR EXISTS (
             SELECT 1 FROM procurement.invoice_lines l
              WHERE l.tenant_id=i.tenant_id AND l.invoice_id=i.id AND l.id=$4))`,
        [tx.tenantId, input.sourceDocumentId, input.sourceVersionRef, lineId],
      );
      valid = Boolean(result.rowCount);
      break;
    }
    case "CREDIT_NOTE": {
      const result = await tx.query(
        `SELECT 1 FROM procurement.credit_notes c
         WHERE c.tenant_id=$1 AND c.id=$2 AND c.lifecycle_state='APPLIED'
           AND c.snapshot_fingerprint=$3
           AND ($4::uuid IS NULL OR EXISTS (
             SELECT 1 FROM procurement.credit_note_lines l
              WHERE l.tenant_id=c.tenant_id AND l.credit_note_id=c.id AND l.id=$4))`,
        [tx.tenantId, input.sourceDocumentId, input.sourceVersionRef, lineId],
      );
      valid = Boolean(result.rowCount);
      break;
    }
    case "CONTRACT": {
      const result = await tx.query(
        `SELECT 1 FROM contract.contracts c JOIN contract.contract_versions v
           ON v.tenant_id=c.tenant_id AND v.contract_id=c.id AND v.id=c.current_version_id
         LEFT JOIN contract.execution_evidence e ON e.tenant_id=v.tenant_id AND e.contract_id=v.contract_id AND e.contract_version_id=v.id
         WHERE c.tenant_id=$1 AND c.id=$2 AND v.id::text=$3
           AND c.lifecycle_state IN ('EXECUTED','ACTIVE','EXPIRED','TERMINATED')
           AND (e.id IS NOT NULL OR v.evidence_document_id IS NOT NULL)`,
        [tx.tenantId, input.sourceDocumentId, input.sourceVersionRef],
      );
      valid = Boolean(result.rowCount);
      break;
    }
    case "CONTRACT_VERSION": {
      const result = await tx.query(
        `SELECT 1 FROM contract.contract_versions v
         JOIN contract.contracts c ON c.tenant_id=v.tenant_id AND c.id=v.contract_id
         LEFT JOIN contract.execution_evidence e ON e.tenant_id=v.tenant_id AND e.contract_id=v.contract_id AND e.contract_version_id=v.id
         WHERE v.tenant_id=$1 AND v.id=$2 AND v.id::text=$3
           AND c.lifecycle_state IN ('EXECUTED','ACTIVE','EXPIRED','TERMINATED')
           AND (e.id IS NOT NULL OR v.evidence_document_id IS NOT NULL)`,
        [tx.tenantId, input.sourceDocumentId, input.sourceVersionRef],
      );
      valid = Boolean(result.rowCount);
      break;
    }
  }
  if (!valid)
    throw new ApplicationError(
      "COST_SOURCE_NOT_EFFECTIVE",
      "Cost source, immutable version, or source line is not valid in this tenant.",
    );
}

export async function recordCostProvenance(input: {
  tx: Transaction;
  value: CostProvenanceInput;
  actorId: string;
  actorType?: "USER" | "SYSTEM" | "SERVICE";
  correlationId: string;
  causationId: string;
  reason?: string;
}): Promise<{ id: string; created: boolean }> {
  const { tx, value } = input;
  if (
    !/^[0-9a-f-]{36}$/i.test(value.targetId) ||
    !/^[0-9a-f-]{36}$/i.test(value.sourceDocumentId)
  )
    invalid("Cost target and source IDs must be canonical UUIDs.");
  if (!/^[A-Z]{3}$/.test(value.currency))
    invalid("currency must be an ISO currency code.");
  if (!value.sourceVersionRef.trim() || value.sourceVersionRef.length > 300)
    invalid("source version reference is required.");
  if (!value.allocationMethod.trim() || !value.allocationRole.trim())
    invalid("allocation_method and allocation_role are required.");
  const amount = positive(value.amount, "amount", true);
  const quantity = positive(value.quantity, "quantity");
  const lineId = value.sourceLineId ?? null;
  if ((value.basis === "ADJUSTMENT") !== Boolean(value.adjustmentDirection))
    invalid("Only ADJUSTMENT provenance requires an adjustment direction.");
  await assertTarget(tx, value.targetType, value.targetId);
  await assertSource(tx, value, lineId);
  const identity = digest({
    tenant_id: tx.tenantId,
    target_type: value.targetType,
    target_id: value.targetId,
    source_type: value.sourceType,
    source_document_id: value.sourceDocumentId,
    source_version_ref: value.sourceVersionRef,
    source_line_id: lineId,
    allocation_role: value.allocationRole,
    cost_basis: value.basis,
  });
  const sourceLock = [
    tx.tenantId,
    value.sourceType,
    value.sourceDocumentId,
    value.sourceVersionRef,
    lineId ?? "",
    value.basis,
  ].join(":");
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    sourceLock,
  ]);
  let capacity:
    | {
        source_amount: string;
        source_currency: string;
        quantity: string | null;
      }
    | undefined;
  if (value.sourceType === "PURCHASE_ORDER" && lineId) {
    const result = await tx.query(
      `SELECT l.total AS source_amount,p.currency AS source_currency,l.quantity::text AS quantity
         FROM procurement.purchase_order_lines l JOIN procurement.purchase_orders p
           ON p.tenant_id=l.tenant_id AND p.id=l.purchase_order_id
        WHERE l.tenant_id=$1 AND l.purchase_order_id=$2 AND l.id=$3
          AND l.commercial_version=substring($4 from ':v([0-9]+)$')::integer`,
      [tx.tenantId, value.sourceDocumentId, lineId, value.sourceVersionRef],
    );
    capacity = result.rows[0] as typeof capacity;
  } else if (value.sourceType === "INVOICE" && lineId) {
    const result = await tx.query(
      `SELECT l.line_total AS source_amount,i.currency AS source_currency,l.quantity::text AS quantity
         FROM procurement.invoice_lines l JOIN procurement.invoices i
           ON i.tenant_id=l.tenant_id AND i.id=l.invoice_id
        WHERE i.tenant_id=$1 AND i.id=$2 AND l.id=$3 AND i.snapshot_fingerprint=$4`,
      [tx.tenantId, value.sourceDocumentId, lineId, value.sourceVersionRef],
    );
    capacity = result.rows[0] as typeof capacity;
  } else if (value.sourceType === "CREDIT_NOTE" && lineId) {
    const result = await tx.query(
      `SELECT l.credited_amount AS source_amount,c.currency AS source_currency,l.credited_quantity::text AS quantity
         FROM procurement.credit_note_lines l JOIN procurement.credit_notes c
           ON c.tenant_id=l.tenant_id AND c.id=l.credit_note_id
        WHERE c.tenant_id=$1 AND c.id=$2 AND l.id=$3 AND c.snapshot_fingerprint=$4`,
      [tx.tenantId, value.sourceDocumentId, lineId, value.sourceVersionRef],
    );
    capacity = result.rows[0] as typeof capacity;
  } else if (
    value.sourceType === "CONTRACT" ||
    value.sourceType === "CONTRACT_VERSION"
  ) {
    const result =
      value.sourceType === "CONTRACT"
        ? await tx.query(
            `SELECT v.commercial_snapshot->>'cost_amount' AS source_amount,v.commercial_snapshot->>'currency' AS source_currency,'1' AS quantity
             FROM contract.contracts c JOIN contract.contract_versions v ON v.tenant_id=c.tenant_id AND v.contract_id=c.id AND v.id=c.current_version_id
            WHERE c.tenant_id=$1 AND c.id=$2 AND v.id::text=$3`,
            [tx.tenantId, value.sourceDocumentId, value.sourceVersionRef],
          )
        : await tx.query(
            `SELECT commercial_snapshot->>'cost_amount' AS source_amount,commercial_snapshot->>'currency' AS source_currency,'1' AS quantity
             FROM contract.contract_versions WHERE tenant_id=$1 AND id=$2 AND id::text=$3`,
            [tx.tenantId, value.sourceDocumentId, value.sourceVersionRef],
          );
    capacity = result.rows[0] as typeof capacity;
  }
  if (!capacity || !capacity.source_amount || !capacity.source_currency)
    throw new ApplicationError(
      "COST_SOURCE_NOT_EFFECTIVE",
      "Cost source must expose canonical amount, currency and line context; header-level or unstructured costs cannot be allocated.",
    );
  if (String(capacity.source_currency).trim() !== value.currency)
    throw new ApplicationError(
      "COST_SOURCE_NOT_EFFECTIVE",
      "Allocation currency differs from its canonical source.",
    );
  const prior = await tx.query(
    `SELECT COALESCE(sum(source_amount),0)::text AS amount,COALESCE(sum(quantity_basis),0)::text AS quantity
       FROM procurement.cost_provenance
      WHERE tenant_id=$1 AND source_type=$2 AND source_document_id=$3
        AND source_document_version_ref=$4 AND source_line_id IS NOT DISTINCT FROM $5::uuid
        AND cost_basis=$6 AND idempotency_identity<>$7`,
    [
      tx.tenantId,
      value.sourceType,
      value.sourceDocumentId,
      value.sourceVersionRef,
      lineId,
      value.basis,
      identity,
    ],
  );
  if (
    micros(prior.rows[0]!.amount) + micros(amount) >
      micros(capacity.source_amount) ||
    (capacity.quantity !== null &&
      micros(prior.rows[0]!.quantity) + micros(quantity) >
        micros(capacity.quantity))
  )
    throw new ApplicationError(
      "COST_PROVENANCE_IDENTITY_CONFLICT",
      "Cost allocations would exceed the canonical commercial source line.",
    );
  const id = randomUUID();
  const inserted = await tx.query(
    `INSERT INTO procurement.cost_provenance
      (id,tenant_id,target_type,target_id,source_type,source_document_id,source_document_version_ref,source_line_id,
       cost_basis,adjustment_direction,source_amount,source_currency,quantity_basis,allocation_method,allocation_role,
       effective_from,effective_to,idempotency_identity,correlation_id,audit_reference)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT(tenant_id,idempotency_identity) DO NOTHING RETURNING id`,
    [
      id,
      tx.tenantId,
      value.targetType,
      value.targetId,
      value.sourceType,
      value.sourceDocumentId,
      value.sourceVersionRef,
      lineId,
      value.basis,
      value.adjustmentDirection ?? null,
      amount,
      value.currency,
      quantity,
      value.allocationMethod,
      value.allocationRole,
      value.effectiveFrom ?? null,
      value.effectiveTo ?? null,
      identity,
      input.correlationId,
      input.causationId,
    ],
  );
  if (!inserted.rowCount) {
    const existing = await tx.query(
      `SELECT id,source_amount,source_currency,quantity_basis FROM procurement.cost_provenance
       WHERE tenant_id=$1 AND idempotency_identity=$2`,
      [tx.tenantId, identity],
    );
    const row = existing.rows[0]!;
    if (
      Number(row.source_amount) !== Number(amount) ||
      row.source_currency !== value.currency ||
      Number(row.quantity_basis) !== Number(quantity)
    )
      throw new ApplicationError(
        "COST_PROVENANCE_IDENTITY_CONFLICT",
        "The same cost source identity produced different immutable allocation facts.",
      );
    return { id: String(row.id), created: false };
  }
  const eventType =
    value.basis === "ADJUSTMENT"
      ? "COST_ADJUSTMENT.RECORDED"
      : "COST_PROVENANCE.RECORDED";
  const eventId = randomUUID();
  const at = new Date().toISOString();
  const payload = {
    cost_provenance_id: id,
    target_type: value.targetType,
    target_id: value.targetId,
    source_type: value.sourceType,
    source_document_id: value.sourceDocumentId,
    source_document_version_ref: value.sourceVersionRef,
    source_line_id: lineId,
    cost_basis: value.basis,
    adjustment_direction: value.adjustmentDirection ?? null,
    amount,
    currency: value.currency,
    quantity_basis: quantity,
  };
  await new PostgresOutboxWriter(tx).append({
    event_id: eventId,
    event_type: eventType,
    schema_version: 1,
    occurred_at: at,
    producer: {
      service: input.actorType === "USER" ? "api" : "worker",
      instance: "cost-provenance",
    },
    aggregate: { type: "COST_PROVENANCE", id, version: 1 },
    actor: { type: input.actorType ?? "SYSTEM", id: input.actorId },
    correlation_id: input.correlationId,
    causation_id: input.causationId,
    tenant_id: tx.tenantId,
    organization_id: tx.tenantId,
    idempotency_key: identity,
    payload,
  });
  await new PostgresAudit(tx).append({
    id: randomUUID(),
    tenant_id: tx.tenantId,
    event_type: eventType,
    occurred_at: at,
    actor: { type: input.actorType ?? "SYSTEM", id: input.actorId },
    action: { command_type: eventType, idempotency_key: identity },
    subject: { entity_type: "COST_PROVENANCE", entity_id: id },
    correlation_id: input.correlationId,
    causation_id: input.causationId,
    reason: {
      code: value.basis,
      text: input.reason ?? "Canonical commercial cost source linked.",
    },
    before: null,
    after: payload,
    outcome: { status: "SUCCESS" },
    classification: "CONFIDENTIAL",
    relations: [
      {
        entity_type: value.targetType,
        entity_id: value.targetId,
        relation: "COST_FOR",
      },
      {
        entity_type: value.sourceType,
        entity_id: value.sourceDocumentId,
        relation: "DERIVED_FROM",
      },
    ],
    evidence: [],
  });
  return { id, created: true };
}

export async function readCostProvenance(
  tx: Transaction,
  targetType: CostTargetType,
  targetId: string,
) {
  await assertTarget(tx, targetType, targetId);
  const [records, summary] = await Promise.all([
    tx.query(
      `SELECT id,target_type,target_id,source_type,source_document_id,source_document_version_ref,source_line_id,
              cost_basis,adjustment_direction,source_amount,source_currency,quantity_basis,allocation_method,
              allocation_role,effective_from,effective_to,created_at
         FROM procurement.cost_provenance WHERE tenant_id=$1 AND target_type=$2 AND target_id=$3
        ORDER BY created_at,id`,
      [tx.tenantId, targetType, targetId],
    ),
    tx.query(
      `SELECT source_currency,committed_amount,actual_amount,adjustment_amount,net_amount
         FROM procurement.cost_provenance_summary WHERE tenant_id=$1 AND target_type=$2 AND target_id=$3
        ORDER BY source_currency`,
      [tx.tenantId, targetType, targetId],
    ),
  ]);
  return { records: records.rows, summary: summary.rows };
}
