import type { Transaction } from "../../../packages/persistence/src/index.js";

type ScoringType = "RISK_CRITICAL" | "REPLACEMENT_PLAN_PRIORITY";
async function scoringRows(input: {
  tx: Transaction;
  asOf: string;
  dimensions: Record<string, string>;
  type: ScoringType;
  offset?: number;
  limit?: number;
}) {
  const risk = input.type === "RISK_CRITICAL";
  const result = await input.tx.query<{
    asset_id: string;
    assessment_id: string;
    band: string;
    category_id: string;
    generation: string;
  }>(
    `WITH current_assessments AS (
       SELECT l.asset_id,l.${risk ? "risk_assessment_id" : "replacement_assessment_id"} AS assessment_id,
              x.band,m.category_id
         FROM asset.scoring_latest l
         JOIN asset.assets a ON a.tenant_id=l.tenant_id AND a.id=l.asset_id
         JOIN asset.models m ON m.tenant_id=a.tenant_id AND m.id=a.asset_model_id
         JOIN asset.${risk ? "risk_assessments" : "replacement_assessments"} x
           ON x.tenant_id=l.tenant_id AND x.id=l.${risk ? "risk_assessment_id" : "replacement_assessment_id"}
        WHERE l.tenant_id=$1 AND x.valid_until > $2
          AND a.lifecycle_state IN ('ASSIGNED','IN_USE','REPAIR')
          AND (${risk ? "x.band='CRITICAL'" : "x.band IN ('PLAN','PRIORITY')"})
          AND ($3::uuid IS NULL OR m.category_id=$3::uuid)
          AND ($4::text IS NULL OR x.band=$4)
     )
     SELECT asset_id,assessment_id,band,category_id,
       md5(COALESCE(string_agg(asset_id::text || ':' || assessment_id::text || ':' || band,',') OVER (
         ORDER BY asset_id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING),'')) AS generation
       FROM current_assessments ORDER BY asset_id OFFSET $5 LIMIT $6`,
    [
      input.tx.tenantId,
      input.asOf,
      input.dimensions.category_id ?? null,
      input.dimensions.band ?? null,
      input.offset ?? 0,
      input.limit ?? 1000000,
    ],
  );
  return result.rows;
}

/** Latest, fresh and lifecycle-eligible TASK-094 projection only. */
export async function queryAssetScoringForReporting(input: {
  tx: Transaction;
  asOf: string;
  dimensions: Record<string, string>;
  type: ScoringType;
}) {
  const rows = await scoringRows(input);
  return {
    count: BigInt(rows.length),
    rows,
    source: "asset_scoring",
    source_generation: rows[0]?.generation ?? "empty",
  };
}

export async function queryAssetScoringDrilldown(input: {
  tx: Transaction;
  asOf: string;
  dimensions: Record<string, string>;
  type: ScoringType;
  offset: number;
  limit: number;
}) {
  return scoringRows(input);
}
