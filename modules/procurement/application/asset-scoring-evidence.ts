import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";

/** Minimal Asset age/cost provenance; no commercial document data is returned. */
export async function queryAssetScoringEvidence(input: {
  tx: Transaction;
  assetId: string;
  receiptReferences: readonly {
    goods_receipt_id: string;
    received_unit_id: string;
  }[];
  asOf: string;
  principal: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: "goods_receipt.asset_provenance.read",
    resource: {
      type: "goods_receipt_asset_provenance",
      id: input.assetId,
      tenant_id: input.tx.tenantId,
    },
    scope: { asset: input.assetId, tenant: input.tx.tenantId },
    context: { correlation_id: input.correlationId },
  });
  await authorize(input.authorization, {
    principal: input.principal,
    action: "asset.cost_evidence.read",
    resource: {
      type: "asset_cost_evidence",
      id: input.assetId,
      tenant_id: input.tx.tenantId,
    },
    scope: { asset: input.assetId, tenant: input.tx.tenantId },
    context: { correlation_id: input.correlationId },
  });
  const receiptResult = await input.tx.query<{
    received_unit_id: string;
    goods_receipt_id: string;
    received_at: Date | string;
    posted_at: Date | string;
  }>(
    `SELECT ref.received_unit_id,ref.goods_receipt_id,g.received_at,g.posted_at
         FROM unnest($2::uuid[],$3::uuid[]) AS ref(goods_receipt_id,received_unit_id)
         JOIN procurement.goods_receipts g
           ON g.tenant_id=$1 AND g.id=ref.goods_receipt_id
         JOIN procurement.goods_receipt_units u
           ON u.tenant_id=$1 AND u.id=ref.received_unit_id
          AND u.goods_receipt_id=ref.goods_receipt_id AND u.accepted=true
        WHERE g.state='POSTED' AND g.posted_at <= $4
        ORDER BY g.received_at,ref.received_unit_id`,
    [
      input.tx.tenantId,
      input.receiptReferences.map((reference) => reference.goods_receipt_id),
      input.receiptReferences.map((reference) => reference.received_unit_id),
      input.asOf,
    ],
  );
  const costsResult = await input.tx.query<{
    id: string;
    cost_basis: string;
    adjustment_direction: string | null;
    source_type: string;
    source_amount: string;
    source_currency: string;
    effective_from: Date | string | null;
    effective_to: Date | string | null;
  }>(
    `SELECT id,cost_basis,adjustment_direction,source_type,source_amount::text,
              source_currency,effective_from,effective_to
         FROM procurement.cost_provenance
        WHERE tenant_id=$1 AND target_type='ASSET' AND target_id=$2
          AND cost_basis IN ('ACTUAL','ADJUSTMENT')
          AND (effective_from IS NULL OR effective_from <= $3)
          AND (effective_to IS NULL OR effective_to > $3)
        ORDER BY created_at,id`,
    [input.tx.tenantId, input.assetId, input.asOf],
  );
  const acquisition =
    receiptResult.rows.length === 1
      ? {
          available: true as const,
          acquired_on: new Date(String(receiptResult.rows[0]!.received_at))
            .toISOString()
            .slice(0, 10),
          basis: "GOODS_RECEIPT_POSTED" as const,
          reference: String(receiptResult.rows[0]!.goods_receipt_id),
          received_unit_id: String(receiptResult.rows[0]!.received_unit_id),
        }
      : receiptResult.rows.length > 1
        ? {
            available: false as const,
            reason_code: "AMBIGUOUS_RECEIPT_PROVENANCE",
          }
        : {
            available: false as const,
            reason_code: "NO_POSTED_RECEIPT_PROVENANCE",
          };

  const totals = new Map<
    string,
    { amount: number; refs: string[]; actual_count: number }
  >();
  for (const record of costsResult.rows) {
    if (
      record.cost_basis === "ADJUSTMENT" &&
      record.source_type !== "CREDIT_NOTE"
    )
      continue;
    const amount = Number(record.source_amount);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const group = totals.get(record.source_currency) ?? {
      amount: 0,
      refs: [],
      actual_count: 0,
    };
    group.amount +=
      record.cost_basis === "ADJUSTMENT" &&
      record.adjustment_direction === "CREDIT"
        ? -amount
        : amount;
    group.refs.push(String(record.id));
    if (record.cost_basis === "ACTUAL") group.actual_count += 1;
    totals.set(record.source_currency, group);
  }
  return {
    acquisition,
    actual_acquisition_costs: [...totals.entries()].map(
      ([currency, value]) => ({
        currency,
        amount: value.amount.toFixed(6),
        actual_evidence_count: value.actual_count,
        evidence_references: value.refs,
      }),
    ),
    repair_costs: {
      available: false as const,
      reason_code: "NO_CANONICAL_ACTUAL_REPAIR_COST_LEDGER",
    },
  };
}
