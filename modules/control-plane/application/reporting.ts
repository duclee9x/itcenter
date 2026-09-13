import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

export type ResolutionSlaCoverage =
  | "AVAILABLE"
  | "AVAILABLE_EMPTY"
  | "AMBIGUOUS_TARGET_PURPOSE"
  | "FINALIZATION_TIMESTAMP_UNAVAILABLE";

/** Canonical SLA-owned outcome boundary; Reporting does not inspect target text or calculate clocks. */
export async function queryResolutionSlaOutcome(input: {
  tx: Transaction;
  startAt: string;
  endAt: string;
}) {
  const untimed = await input.tx.query<{ present: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM control.sla_instances
      WHERE tenant_id=$1 AND object_type='TICKET' AND state IN ('MET','BREACHED')
        AND completed_at IS NULL) AS present`,
    [input.tx.tenantId],
  );
  if (untimed.rows[0]?.present)
    return {
      numerator: 0n,
      denominator: 0n,
      source_generation: "finalization-timestamp-unavailable",
      source: "sla_resolution_outcomes",
      coverage: "FINALIZATION_TIMESTAMP_UNAVAILABLE" as const,
    };

  const result = await input.tx.query<{
    met: string;
    total: string;
    ambiguous: boolean;
    generation: string;
  }>(
    `WITH final_outcomes AS (
       SELECT i.id AS obligation_id,i.object_id AS ticket_id,i.target_id,
              i.policy_version,i.state AS outcome,i.completed_at,
              t.target_purpose,p.version AS target_policy_version
         FROM control.sla_instances i
         LEFT JOIN control.sla_targets t
           ON t.tenant_id=i.tenant_id AND t.id=i.target_id
         LEFT JOIN control.sla_policies p
           ON p.tenant_id=t.tenant_id AND p.id=t.sla_policy_id
        WHERE i.tenant_id=$1 AND i.object_type='TICKET'
          AND i.state IN ('MET','BREACHED')
          AND i.completed_at >= $2 AND i.completed_at < $3
     ), resolution AS (
       SELECT * FROM final_outcomes
        WHERE target_purpose='RESOLUTION' AND target_policy_version=policy_version
     )
     SELECT (SELECT count(*) FROM resolution WHERE outcome='MET')::text AS met,
            (SELECT count(*) FROM resolution)::text AS total,
            COALESCE(bool_or(target_purpose IS NULL OR target_purpose='UNKNOWN'
              OR target_policy_version IS DISTINCT FROM policy_version),false) AS ambiguous,
            md5(COALESCE(string_agg(obligation_id::text || ':' || target_id::text || ':' ||
              policy_version::text || ':' || COALESCE(target_policy_version::text,'?') || ':' ||
              COALESCE(target_purpose,'?') || ':' || outcome || ':' || completed_at::text,
              ',' ORDER BY obligation_id),'')) AS generation
       FROM final_outcomes`,
    [input.tx.tenantId, input.startAt, input.endAt],
  );
  const row = result.rows[0]!;
  const ambiguous = row.ambiguous;
  const resolutionCount = ambiguous ? 0n : BigInt(row.total ?? "0");
  return {
    numerator: ambiguous ? 0n : BigInt(row.met ?? "0"),
    denominator: ambiguous ? 0n : resolutionCount,
    source_generation: row.generation ?? "empty",
    source: "sla_resolution_outcomes",
    coverage: ambiguous
      ? ("AMBIGUOUS_TARGET_PURPOSE" as const)
      : resolutionCount === 0n
        ? ("AVAILABLE_EMPTY" as const)
        : ("AVAILABLE" as const),
  };
}

/** Minimal authorized-domain candidate basis for denominator-contributing outcomes. */
export async function queryResolutionSlaDrilldown(input: {
  tx: Transaction;
  startAt: string;
  endAt: string;
  offset: number;
  limit: number;
}) {
  const source = await queryResolutionSlaOutcome({
    tx: input.tx,
    startAt: input.startAt,
    endAt: input.endAt,
  });
  if (
    source.coverage === "AMBIGUOUS_TARGET_PURPOSE" ||
    source.coverage === "FINALIZATION_TIMESTAMP_UNAVAILABLE"
  )
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      `Resolution SLA drill-down is unavailable: ${source.coverage}.`,
    );
  const result = await input.tx.query<{
    obligation_id: string;
    ticket_id: string;
    outcome: "MET" | "BREACHED";
    completed_at: Date | string;
    target_id: string;
    policy_version: number;
    target_purpose: "RESOLUTION";
  }>(
    `SELECT i.id AS obligation_id,i.object_id AS ticket_id,i.state AS outcome,
            i.completed_at,i.target_id,i.policy_version,t.target_purpose
       FROM control.sla_instances i
       JOIN control.sla_targets t ON t.tenant_id=i.tenant_id AND t.id=i.target_id
       JOIN control.sla_policies p ON p.tenant_id=t.tenant_id AND p.id=t.sla_policy_id
      WHERE i.tenant_id=$1 AND i.object_type='TICKET' AND i.state IN ('MET','BREACHED')
        AND t.target_purpose='RESOLUTION' AND p.version=i.policy_version
        AND i.completed_at >= $2 AND i.completed_at < $3
      ORDER BY i.completed_at,i.id OFFSET $4 LIMIT $5`,
    [input.tx.tenantId, input.startAt, input.endAt, input.offset, input.limit],
  );
  return result.rows;
}
