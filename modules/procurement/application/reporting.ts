import type { Transaction } from "../../../packages/persistence/src/index.js";

function scaled(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  const negative = whole.startsWith("-");
  const magnitude =
    BigInt(whole.replace("-", "") || "0") * 1_000_000n +
    BigInt(fraction.padEnd(6, "0").slice(0, 6));
  return (negative ? -magnitude : magnitude).toString();
}

/** ACTUAL plus immutable signed ADJUSTMENT, grouped strictly by currency. */
export async function queryNetActualSpendForReporting(input: {
  tx: Transaction;
  from: string;
  to: string;
  currency?: string;
}) {
  const result = await input.tx.query<{
    currency: string;
    actual: string;
    adjustments: string;
    generation: string;
  }>(
    `WITH in_period AS (
       SELECT id,source_currency,cost_basis,adjustment_direction,source_amount
         FROM procurement.cost_provenance
        WHERE tenant_id=$1 AND cost_basis IN ('ACTUAL','ADJUSTMENT')
          AND effective_from >= $2 AND effective_from < $3
          AND ($4::text IS NULL OR source_currency=$4)
     ), grouped AS (
       SELECT source_currency AS currency,
         COALESCE(sum(source_amount) FILTER (WHERE cost_basis='ACTUAL'),0)::text AS actual,
         COALESCE(sum(CASE WHEN cost_basis='ADJUSTMENT' AND adjustment_direction='CREDIT' THEN -source_amount
                           WHEN cost_basis='ADJUSTMENT' AND adjustment_direction='DEBIT' THEN source_amount ELSE 0 END),0)::text AS adjustments,
         md5(COALESCE(string_agg(id::text || ':' || cost_basis || ':' || adjustment_direction || ':' || source_amount::text,',' ORDER BY id),'')) AS generation
        FROM in_period GROUP BY source_currency
     )
     SELECT * FROM grouped ORDER BY currency`,
    [input.tx.tenantId, input.from, input.to, input.currency ?? null],
  );
  const unknownTime = await input.tx.query<{ unknown: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM procurement.cost_provenance p
      WHERE p.tenant_id=$1 AND p.cost_basis IN ('ACTUAL','ADJUSTMENT')
        AND p.effective_from IS NULL AND p.created_at < $2
        AND ($3::text IS NULL OR p.source_currency=$3)) AS unknown`,
    [input.tx.tenantId, input.to, input.currency ?? null],
  );
  const ambiguous = unknownTime.rows[0]?.unknown === true;
  return {
    values: result.rows.map((row) => ({
      currency: row.currency,
      amount_minor: (
        BigInt(scaled(row.actual)) + BigInt(scaled(row.adjustments))
      ).toString(),
      minor_unit_scale: 6,
    })),
    coverage: ambiguous ? "PARTIAL" : "COMPLETE",
    source_generation: `${result.rows.map((row) => `${row.currency}:${row.generation}`).join("|") || "empty"}|unknown_effective_time:${ambiguous}`,
    source: "cost_provenance",
  };
}

export async function queryActualSpendDrilldown(input: {
  tx: Transaction;
  from: string;
  to: string;
  currency?: string;
  offset: number;
  limit: number;
}) {
  const result = await input.tx.query<{
    id: string;
    currency: string;
    cost_basis: string;
    adjustment_direction: string | null;
    source_amount: string;
  }>(
    `SELECT id,source_currency AS currency,cost_basis,adjustment_direction,source_amount::text
       FROM procurement.cost_provenance
      WHERE tenant_id=$1 AND cost_basis IN ('ACTUAL','ADJUSTMENT')
        AND effective_from >= $2 AND effective_from < $3
        AND ($4::text IS NULL OR source_currency=$4)
      ORDER BY effective_from,id OFFSET $5 LIMIT $6`,
    [
      input.tx.tenantId,
      input.from,
      input.to,
      input.currency ?? null,
      input.offset,
      input.limit,
    ],
  );
  return result.rows.map((row) => ({
    id: row.id,
    currency: row.currency,
    cost_basis: row.cost_basis,
    amount_minor: (row.cost_basis === "ADJUSTMENT" &&
    row.adjustment_direction === "CREDIT"
      ? -BigInt(scaled(row.source_amount))
      : BigInt(scaled(row.source_amount))
    ).toString(),
    minor_unit_scale: 6,
  }));
}
