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
    `SELECT EXISTS(
       SELECT 1 FROM control.sla_instances i
       LEFT JOIN control.sla_targets t
         ON t.tenant_id=i.tenant_id AND t.id=i.target_id
       LEFT JOIN control.sla_policies p
         ON p.tenant_id=t.tenant_id AND p.id=t.sla_policy_id
       WHERE i.tenant_id=$1 AND i.object_type='TICKET'
         AND i.state IN ('MET','BREACHED') AND i.completed_at IS NULL
         AND (t.target_purpose IS NULL OR t.target_purpose='UNKNOWN'
           OR p.version IS DISTINCT FROM i.policy_version
           OR t.target_purpose='RESOLUTION')
     ) AS present`,
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
    obligation_id: string;
    ticket_id: string;
    target_id: string;
    policy_version: number;
    outcome: "MET" | "BREACHED";
    completed_at: Date | string;
    target_purpose: string | null;
    target_policy_version: number | null;
  }>(
    `SELECT i.id AS obligation_id,i.object_id AS ticket_id,i.target_id,
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
        ORDER BY i.completed_at,i.id`,
    [input.tx.tenantId, input.startAt, input.endAt],
  );
  const obligations = result.rows;
  const ambiguous = obligations.some(
    (row) =>
      row.target_purpose === null ||
      row.target_purpose === "UNKNOWN" ||
      row.target_policy_version !== row.policy_version,
  );
  const resolutions = ambiguous
    ? []
    : obligations.filter((row) => row.target_purpose === "RESOLUTION");
  const generation = obligations
    .map(
      (row) =>
        `${row.obligation_id}:${row.target_id}:${row.policy_version}:${row.target_policy_version ?? "?"}:${row.target_purpose ?? "?"}:${row.outcome}:${new Date(row.completed_at).toISOString()}`,
    )
    .join("|");
  return {
    numerator: BigInt(
      resolutions.filter((row) => row.outcome === "MET").length,
    ),
    denominator: BigInt(resolutions.length),
    obligations,
    source_generation: generation || "empty",
    source: "sla_resolution_outcomes",
    coverage: ambiguous
      ? ("AMBIGUOUS_TARGET_PURPOSE" as const)
      : resolutions.length === 0
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
