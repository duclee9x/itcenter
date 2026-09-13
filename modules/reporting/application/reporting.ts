import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  queryOpenTicketDrilldown,
  queryOpenTicketsForReporting,
  queryTicketPrioritiesForReporting,
} from "../../ticket/index.js";
import {
  queryActiveIncidentEpisodesForReporting,
  queryIncidentEpisodeDrilldown,
} from "../../incident/index.js";
import {
  queryActionableWorkItemsForReporting,
  queryWorkItemDrilldown,
} from "../../work-queue/index.js";
import { queryResolutionSlaOutcome } from "../../control-plane/index.js";
import {
  queryKnowledgeDrilldown,
  queryKnowledgeReporting,
} from "../../problem/index.js";
import {
  queryAssetScoringDrilldown,
  queryAssetScoringForReporting,
} from "../../asset/index.js";
import {
  queryActualSpendDrilldown,
  queryNetActualSpendForReporting,
} from "../../procurement/index.js";

export const KPI_CATALOG = {
  OPS_OPEN_TICKETS_COUNT: {
    version: 1,
    semantic_name: "Open tickets",
    mode: "LIVE_COUNT",
    formula: "Unique Tickets non-terminal at as_of",
    sources: ["Ticket"],
    inclusion: [
      "same tenant",
      "created_at <= as_of",
      "domain lifecycle is non-terminal",
    ],
    exclusion: ["canonical terminal Ticket states"],
    timestamp_semantics: "point-in-time UTC",
    dimensions: ["priority"],
    unit: "COUNT",
    freshness_policy: "DIRECT_CANONICAL",
    access_classification: "TENANT_OPERATIONAL",
  },
  OPS_ACTIVE_INCIDENT_EPISODES_COUNT: {
    version: 1,
    semantic_name: "Active Incident episodes",
    mode: "LIVE_COUNT",
    formula:
      "Distinct active Root episode id or standalone Incident id at as_of",
    sources: ["IncidentStateAt", "RootRelationshipHistory"],
    inclusion: ["Incident active at as_of", "Root relation active at as_of"],
    exclusion: ["terminal Incident episodes", "duplicate Root children"],
    timestamp_semantics: "point-in-time UTC",
    dimensions: [],
    unit: "COUNT",
    freshness_policy: "DIRECT_CANONICAL",
    access_classification: "TENANT_OPERATIONAL",
  },
  OPS_ACTIONABLE_WORK_QUEUE_COUNT: {
    version: 1,
    semantic_name: "Actionable Work Queue items",
    mode: "LIVE_COUNT",
    formula: "Unique actionable Work Items at as_of",
    sources: ["WorkItemStateAt"],
    inclusion: [
      "same tenant",
      "created_at <= as_of",
      "domain state is actionable",
    ],
    exclusion: ["canonical terminal Work Items"],
    timestamp_semantics: "point-in-time UTC",
    dimensions: ["priority", "source_type"],
    unit: "COUNT",
    freshness_policy: "DIRECT_CANONICAL",
    access_classification: "TENANT_OPERATIONAL",
  },
  HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT: {
    version: 1,
    semantic_name: "Resolution SLA compliance",
    mode: "PERIOD_RATIO",
    formula: "MET final evaluable resolution obligations / (MET + BREACHED)",
    sources: ["Canonical SLA outcomes"],
    inclusion: ["final MET or BREACHED", "completed_at in [start,end)"],
    exclusion: [
      "pending",
      "no SLA",
      "not applicable",
      "cancelled/non-evaluable",
    ],
    timestamp_semantics:
      "canonical SLA finalization timestamp, UTC [start,end)",
    dimensions: ["priority"],
    unit: "PERCENT",
    freshness_policy: "DIRECT_CANONICAL",
    access_classification: "TENANT_OPERATIONAL",
  },
  KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT: {
    version: 1,
    semantic_name: "Confirmed Knowledge self-service resolution",
    mode: "PERIOD_RATIO",
    formula:
      "USER_RESOLVED KNOWLEDGE_RESOLUTION / eligible pre-Ticket terminal sessions",
    sources: ["TASK-093 RecommendationSession"],
    inclusion: [
      "pre-Ticket",
      "at least one presented Knowledge item",
      "USER_RESOLVED, NOT_HELPFUL or ESCALATED",
    ],
    exclusion: [
      "KNOWN_INCIDENT_DEFLECTION",
      "click/open/selection",
      "HELPFUL alone",
    ],
    timestamp_semantics: "canonical outcome time, UTC [start,end)",
    dimensions: [],
    unit: "PERCENT",
    freshness_policy: "DIRECT_CANONICAL",
    access_classification: "TENANT_OPERATIONAL",
  },
  KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT: {
    version: 1,
    semantic_name: "Confirmed Known Incident deflection",
    mode: "PERIOD_COUNT",
    formula: "Confirmed KNOWN_INCIDENT_DEFLECTION sessions",
    sources: ["TASK-093 RecommendationSession"],
    inclusion: [
      "USER_RESOLVED",
      "KNOWN_INCIDENT_DEFLECTION",
      "resolved_at in [start,end)",
    ],
    exclusion: ["Root context/presentation/click without confirmation"],
    timestamp_semantics: "canonical confirmation time, UTC [start,end)",
    dimensions: [],
    unit: "COUNT",
    freshness_policy: "DIRECT_CANONICAL",
    access_classification: "TENANT_OPERATIONAL",
  },
  ASSET_CRITICAL_RISK_COUNT: {
    version: 1,
    semantic_name: "Current Critical Asset Risk",
    mode: "LIVE_COUNT",
    formula:
      "Eligible Assets with latest valid non-stale CRITICAL Risk assessment",
    sources: ["TASK-094 RiskAssessment"],
    inclusion: ["current eligible Asset lifecycle", "valid_until > as_of"],
    exclusion: [
      "stale assessment",
      "non-CRITICAL band",
      "ineligible lifecycle",
    ],
    timestamp_semantics: "point-in-time UTC",
    dimensions: ["category_id"],
    unit: "COUNT",
    freshness_policy: "TASK-094_ASSESSMENT_VALIDITY",
    access_classification: "TENANT_OPERATIONAL",
  },
  ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT: {
    version: 1,
    semantic_name: "Current Replacement PLAN/PRIORITY assessments",
    mode: "LIVE_COUNT",
    formula:
      "Eligible Assets with latest valid non-stale PLAN or PRIORITY assessment",
    sources: ["TASK-094 ReplacementAssessment"],
    inclusion: [
      "current eligible Asset lifecycle",
      "valid_until > as_of",
      "PLAN or PRIORITY",
    ],
    exclusion: ["stale assessment", "human disposition is not a scoring band"],
    timestamp_semantics: "point-in-time UTC",
    dimensions: ["band", "category_id"],
    unit: "COUNT",
    freshness_policy: "TASK-094_ASSESSMENT_VALIDITY",
    access_classification: "TENANT_OPERATIONAL",
  },
  PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY: {
    version: 1,
    semantic_name: "Net actual spend by currency",
    mode: "PERIOD_SUM",
    formula: "ACTUAL + signed ADJUSTMENT, grouped by currency",
    sources: ["CostProvenance"],
    inclusion: ["ACTUAL", "ADJUSTMENT", "effective_from in [start,end)"],
    exclusion: ["COMMITTED", "cross-currency aggregation", "FX"],
    timestamp_semantics: "canonical financial effective time, UTC [start,end)",
    dimensions: ["currency"],
    unit: "MONEY_MICRO",
    freshness_policy: "DIRECT_CANONICAL",
    access_classification: "FINANCIAL_AGGREGATE",
  },
} as const;
export type KpiId = keyof typeof KPI_CATALOG;
export type KpiStatus =
  "COMPLETE" | "COMPLETE_EMPTY" | "PARTIAL" | "STALE" | "UNAVAILABLE";
export interface KpiResult {
  kpi_id: KpiId;
  kpi_version: number;
  mode: string;
  period_start: string;
  period_end: string;
  dimensions: Record<string, string>;
  numerator: number | null;
  denominator: number | null;
  value:
    | number
    | null
    | { currency: string; amount_minor: string; minor_unit_scale: number }[];
  unit: string;
  status: KpiStatus;
  freshness: "CURRENT" | "STALE" | "UNAVAILABLE";
  completeness: number;
  as_of: string;
  generated_at: string;
  source_lineage: Record<string, unknown>;
}
export type KpiDrilldownCandidate = {
  resource_type: string;
  resource_id: string;
  permission: string;
  metadata: Record<string, unknown>;
  related_knowledge_ids?: string[];
};

const asSafeCount = (value: bigint) => {
  const count = Number(value);
  if (!Number.isSafeInteger(count))
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "KPI count exceeds the supported integer range.",
    );
  return count;
};
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};
const hash = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");
function assertKpi(value: string): asserts value is KpiId {
  if (!Object.hasOwn(KPI_CATALOG, value))
    throw new ApplicationError(
      "NOT_FOUND",
      "Governed KPI definition was not found.",
    );
}
export function validateDimensions(
  kpi: KpiId,
  dimensions: Record<string, string>,
) {
  const allowed = KPI_CATALOG[kpi].dimensions as readonly string[];
  for (const [key, value] of Object.entries(dimensions)) {
    if (!allowed.includes(key))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `Dimension ${key} is not supported by ${kpi}.`,
      );
    if (!value.trim() || value.length > 100)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `Dimension value for ${key} is invalid.`,
      );
    if (
      key === "priority" &&
      kpi === "OPS_OPEN_TICKETS_COUNT" &&
      !["P1", "P2", "P3", "P4"].includes(value)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "priority must be a canonical Ticket priority.",
      );
    if (
      key === "priority" &&
      kpi === "OPS_ACTIONABLE_WORK_QUEUE_COUNT" &&
      !/^[A-Z][A-Z0-9_]{0,31}$/.test(value)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "priority must be a canonical Work Queue priority code.",
      );
    if (
      key === "category_id" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "category_id must be a canonical UUID.",
      );
    if (
      key === "band" &&
      !["MONITOR", "REVIEW", "PLAN", "PRIORITY"].includes(value)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "band is not a canonical Replacement band.",
      );
    if (key === "currency" && !/^[A-Z]{3}$/.test(value))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "currency must be an uppercase ISO currency code.",
      );
    if (key === "source_type" && !/^[A-Z][A-Z0-9_]{0,63}$/.test(value))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "source_type must be a canonical code.",
      );
  }
}
export async function listKpiDefinitions(tx?: Transaction) {
  if (!tx)
    return Object.entries(KPI_CATALOG).map(([kpi_id, value]) => ({
      kpi_id,
      ...value,
    }));
  const result = await tx.query(
    `SELECT kpi_id,version,semantic_name,mode,definition,effective_from,superseded_by_version
       FROM reporting.kpi_definitions ORDER BY kpi_id,version`,
  );
  return result.rows.map((row) => ({
    ...row,
    ...(KPI_CATALOG[row.kpi_id as KpiId] ?? {}),
    version: row.version,
    effective_from: row.effective_from,
    superseded_by_version: row.superseded_by_version,
  }));
}
const sourceInfo = (source: string, generation: string) => ({
  sources: [{ name: source, generation, access: "DIRECT_CANONICAL" }],
  source_generation: hash({ source, generation }),
});
const unavailable = (
  base: Omit<
    KpiResult,
    | "numerator"
    | "denominator"
    | "value"
    | "unit"
    | "status"
    | "freshness"
    | "completeness"
    | "source_lineage"
  >,
  reason: string,
  source: string,
): KpiResult => ({
  ...base,
  numerator: null,
  denominator: null,
  value: null,
  unit: "UNKNOWN",
  status: "UNAVAILABLE",
  freshness: "UNAVAILABLE",
  completeness: 0,
  source_lineage: {
    sources: [{ name: source, status: "UNAVAILABLE" }],
    reason,
  },
});
function assertUtcPeriod(from: string, to: string) {
  const utc = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
  if (
    !utc.test(from) ||
    !utc.test(to) ||
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(from) >= Date.parse(to)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "KPI period must be a UTC [start,end) interval.",
    );
}
function assertUtcTimestamp(value: string) {
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "as_of must be a UTC timestamp.",
    );
}

export async function calculateKpi(input: {
  tx: Transaction;
  kpiId: string;
  from: string;
  to: string;
  asOf?: string;
  dimensions?: Record<string, string>;
}): Promise<KpiResult> {
  assertKpi(input.kpiId);
  assertUtcPeriod(input.from, input.to);
  const kpi = input.kpiId;
  const dimensions = input.dimensions ?? {};
  validateDimensions(kpi, dimensions);
  const asOf = input.asOf ?? new Date().toISOString();
  assertUtcTimestamp(asOf);
  const definition = KPI_CATALOG[kpi];
  const base = {
    kpi_id: kpi,
    kpi_version: definition.version,
    mode: definition.mode,
    period_start: input.from,
    period_end: input.to,
    dimensions,
    as_of: asOf,
    generated_at: new Date().toISOString(),
  };
  const countResult = (
    value: bigint,
    source: string,
    generation: string,
  ): KpiResult => ({
    ...base,
    numerator: null,
    denominator: null,
    value: asSafeCount(value),
    unit: "COUNT",
    status: "COMPLETE",
    freshness: "CURRENT",
    completeness: 100,
    source_lineage: sourceInfo(source, generation),
  });
  const savepoint = `report_kpi_${randomUUID().replaceAll("-", "")}`;
  await input.tx.query(`SAVEPOINT ${savepoint}`);
  try {
    if (kpi === "OPS_OPEN_TICKETS_COUNT") {
      const q = await queryOpenTicketsForReporting({
        tx: input.tx,
        asOf,
        dimensions,
      });
      if (q.coverage !== "COMPLETE")
        return unavailable(base, "INSUFFICIENT_HISTORICAL_COVERAGE", q.source);
      return countResult(q.count, q.source, q.source_generation);
    }
    if (kpi === "OPS_ACTIVE_INCIDENT_EPISODES_COUNT") {
      const q = await queryActiveIncidentEpisodesForReporting({
        tx: input.tx,
        asOf,
        dimensions,
      });
      if (q.coverage !== "COMPLETE")
        return unavailable(base, "INSUFFICIENT_HISTORICAL_COVERAGE", q.source);
      return countResult(
        q.count,
        q.source,
        hash({ coverage: q.coverage, episode_ids: [...q.episodeIds].sort() }),
      );
    }
    if (kpi === "OPS_ACTIONABLE_WORK_QUEUE_COUNT") {
      const q = await queryActionableWorkItemsForReporting({
        tx: input.tx,
        asOf,
        dimensions,
      });
      if (q.coverage !== "COMPLETE")
        return unavailable(base, "INSUFFICIENT_HISTORICAL_COVERAGE", q.source);
      return countResult(
        q.count,
        q.source,
        hash({
          coverage: q.coverage,
          work_item_ids: [...q.workItemIds].sort(),
        }),
      );
    }
    if (kpi === "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT") {
      const q = await queryResolutionSlaOutcome({
        tx: input.tx,
        startAt: input.from,
        endAt: input.to,
      });
      if (q.coverage === "FINALIZATION_TIMESTAMP_UNAVAILABLE")
        return unavailable(
          base,
          "FINALIZATION_TIMESTAMP_UNAVAILABLE",
          q.source,
        );
      let obligations = q.obligations;
      if (dimensions.priority) {
        const priorities = await queryTicketPrioritiesForReporting({
          tx: input.tx,
          ticketIds: [...new Set(obligations.map((row) => row.ticket_id))],
        });
        obligations = obligations.filter(
          (row) => priorities.get(row.ticket_id) === dimensions.priority,
        );
      }
      const ambiguous = obligations.some(
        (row) =>
          row.target_purpose === null ||
          row.target_purpose === "UNKNOWN" ||
          row.target_policy_version !== row.policy_version,
      );
      if (ambiguous)
        return unavailable(base, "AMBIGUOUS_TARGET_PURPOSE", q.source);
      const resolution = obligations.filter(
        (row) => row.target_purpose === "RESOLUTION",
      );
      const d = asSafeCount(BigInt(resolution.length));
      const n = asSafeCount(
        BigInt(resolution.filter((row) => row.outcome === "MET").length),
      );
      return {
        ...base,
        numerator: n,
        denominator: d,
        value: d ? (n * 100) / d : null,
        unit: "PERCENT",
        status: d ? "COMPLETE" : "COMPLETE_EMPTY",
        freshness: "CURRENT",
        completeness: 100,
        source_lineage: sourceInfo(q.source, q.source_generation),
      };
    }
    if (kpi === "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT") {
      const q = await queryKnowledgeReporting({
        tx: input.tx,
        from: input.from,
        to: input.to,
      });
      if (q.coverage !== "COMPLETE")
        return unavailable(base, "PRE_TICKET_ORIGIN_AMBIGUOUS", q.source);
      const d = asSafeCount(q.resolutionDenominator),
        n = asSafeCount(q.resolutionNumerator);
      return {
        ...base,
        numerator: n,
        denominator: d,
        value: d ? (n * 100) / d : null,
        unit: "PERCENT",
        status: d ? "COMPLETE" : "COMPLETE_EMPTY",
        freshness: "CURRENT",
        completeness: 100,
        source_lineage: sourceInfo(q.source, q.source_generation),
      };
    }
    if (kpi === "KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT") {
      const q = await queryKnowledgeReporting({
        tx: input.tx,
        from: input.from,
        to: input.to,
      });
      return countResult(
        q.knownIncidentDeflections,
        q.source,
        q.source_generation,
      );
    }
    if (
      kpi === "ASSET_CRITICAL_RISK_COUNT" ||
      kpi === "ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT"
    ) {
      const q = await queryAssetScoringForReporting({
        tx: input.tx,
        asOf,
        dimensions,
        type:
          kpi === "ASSET_CRITICAL_RISK_COUNT"
            ? "RISK_CRITICAL"
            : "REPLACEMENT_PLAN_PRIORITY",
      });
      return countResult(q.count, q.source, q.source_generation);
    }
    const q = await queryNetActualSpendForReporting({
      tx: input.tx,
      from: input.from,
      to: input.to,
      ...(dimensions.currency ? { currency: dimensions.currency } : {}),
    });
    if (q.coverage !== "COMPLETE")
      return unavailable(base, "COST_EFFECTIVE_TIME_UNAVAILABLE", q.source);
    return {
      ...base,
      numerator: null,
      denominator: null,
      value: q.values,
      unit: "MONEY_MICRO",
      status: q.values.length ? "COMPLETE" : "COMPLETE_EMPTY",
      freshness: "CURRENT",
      completeness: 100,
      source_lineage: sourceInfo(q.source, q.source_generation),
    };
  } catch (error) {
    await input.tx.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await input.tx.query(`RELEASE SAVEPOINT ${savepoint}`);
    const reason =
      error instanceof ApplicationError
        ? error.code
        : "SOURCE_QUERY_UNAVAILABLE";
    const source = definition.sources[0] ?? "canonical_source";
    return unavailable(base, reason, source);
  }
}

export async function queryKpiDrilldownCandidates(input: {
  tx: Transaction;
  kpiId: string;
  from: string;
  to: string;
  asOf: string;
  dimensions?: Record<string, string>;
  offset: number;
  limit: number;
}): Promise<KpiDrilldownCandidate[]> {
  assertKpi(input.kpiId);
  const kpi = input.kpiId,
    dimensions = input.dimensions ?? {};
  validateDimensions(kpi, dimensions);
  const { tx, from, to, asOf, offset, limit } = input;
  if (kpi === "OPS_OPEN_TICKETS_COUNT") {
    const q = await queryOpenTicketDrilldown({
      tx,
      asOf,
      dimensions,
      offset,
      limit,
    });
    if (q.coverage !== "COMPLETE")
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Ticket history coverage is insufficient.",
      );
    return q.ids.map((id) => ({
      resource_type: "ticket",
      resource_id: id,
      permission: "ticket.read",
      metadata: {},
    }));
  }
  if (kpi === "OPS_ACTIVE_INCIDENT_EPISODES_COUNT") {
    const q = await queryIncidentEpisodeDrilldown({ tx, asOf, offset, limit });
    if (q.coverage !== "COMPLETE")
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Incident history coverage is insufficient.",
      );
    return q.episode_ids.map((id) => ({
      resource_type: "incident",
      resource_id: id,
      permission: "incident.read",
      metadata: {},
    }));
  }
  if (kpi === "OPS_ACTIONABLE_WORK_QUEUE_COUNT") {
    const q = await queryWorkItemDrilldown({
      tx,
      asOf,
      dimensions,
      offset,
      limit,
    });
    if (q.coverage !== "COMPLETE")
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Work Queue history coverage is insufficient.",
      );
    return q.work_item_ids.map((id) => ({
      resource_type: "work_item",
      resource_id: id,
      permission: "work_item.read",
      metadata: {},
    }));
  }
  if (kpi === "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT") {
    const source = await queryResolutionSlaOutcome({
      tx,
      startAt: from,
      endAt: to,
    });
    if (source.coverage === "FINALIZATION_TIMESTAMP_UNAVAILABLE")
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        `Resolution SLA drill-down is unavailable: ${source.coverage}.`,
      );
    let rows = source.obligations;
    if (dimensions.priority) {
      const priorities = await queryTicketPrioritiesForReporting({
        tx,
        ticketIds: [...new Set(rows.map((row) => row.ticket_id))],
      });
      rows = rows.filter(
        (row) => priorities.get(row.ticket_id) === dimensions.priority,
      );
    }
    if (
      rows.some(
        (row) =>
          row.target_purpose === null ||
          row.target_purpose === "UNKNOWN" ||
          row.target_policy_version !== row.policy_version,
      )
    )
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Resolution SLA drill-down is unavailable: target purpose is ambiguous.",
      );
    rows = rows.filter((row) => row.target_purpose === "RESOLUTION");
    rows = rows.slice(offset, offset + limit);
    return rows.map((row) => ({
      resource_type: "ticket",
      resource_id: row.ticket_id,
      permission: "ticket.read",
      metadata: { sla_outcome: row.outcome },
    }));
  }
  if (
    kpi === "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT" ||
    kpi === "KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT"
  ) {
    if (kpi === "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT") {
      const source = await queryKnowledgeReporting({ tx, from, to });
      if (source.coverage !== "COMPLETE")
        throw new ApplicationError(
          "DEPENDENCY_UNAVAILABLE",
          "Knowledge outcome evidence is ambiguous.",
        );
    }
    const rows = await queryKnowledgeDrilldown({
      tx,
      kpiId: kpi,
      from,
      to,
      offset,
      limit,
    });
    return rows.map((row) => ({
      resource_type: "knowledge_recommendation_session",
      resource_id: row.session_id,
      permission: "knowledge.recommendation.read",
      related_knowledge_ids: row.knowledge_ids,
      metadata: { outcome: row.outcome },
    }));
  }
  if (
    kpi === "ASSET_CRITICAL_RISK_COUNT" ||
    kpi === "ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT"
  ) {
    const rows = await queryAssetScoringDrilldown({
      tx,
      asOf,
      dimensions,
      type:
        kpi === "ASSET_CRITICAL_RISK_COUNT"
          ? "RISK_CRITICAL"
          : "REPLACEMENT_PLAN_PRIORITY",
      offset,
      limit,
    });
    return rows.map((row) => ({
      resource_type: "asset",
      resource_id: row.asset_id,
      permission: "asset.read",
      metadata: {
        assessment_id: row.assessment_id,
        band: row.band,
        category_id: row.category_id,
      },
    }));
  }
  const rows = await queryActualSpendDrilldown({
    tx,
    from,
    to,
    ...(dimensions.currency ? { currency: dimensions.currency } : {}),
    offset,
    limit,
  });
  return rows.map((row) => ({
    resource_type: "procurement_cost",
    resource_id: row.id,
    permission: "procurement.cost.read",
    metadata: {
      currency: row.currency,
      cost_basis: row.cost_basis,
      amount_minor: row.amount_minor,
      minor_unit_scale: row.minor_unit_scale,
    },
  }));
}

export async function persistKpiSnapshot(input: {
  tx: Transaction;
  result: KpiResult;
  snapshotType: "DAILY_POINT_IN_TIME" | "PERIOD";
}) {
  const r = input.result,
    fingerprint = hash(r.dimensions);
  const sourceGeneration =
    (r.source_lineage.source_generation as string | undefined) ??
    hash({
      source_lineage: r.source_lineage,
      value: r.value,
      numerator: r.numerator,
      denominator: r.denominator,
    });
  const lineage = { ...r.source_lineage, source_generation: sourceGeneration };
  const lockIdentity = `${r.kpi_id}:${r.kpi_version}:${r.period_start}:${r.period_end}:${input.snapshotType}:${fingerprint}`;
  await input.tx.query(
    "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
    [input.tx.tenantId, lockIdentity],
  );
  const existing = await input.tx.query<{
    revision: number;
    source_lineage: unknown;
  }>(
    `SELECT revision,source_lineage FROM reporting.kpi_result_snapshots
      WHERE tenant_id=$1 AND kpi_id=$2 AND kpi_version=$3 AND period_start=$4 AND period_end=$5
        AND snapshot_type=$6 AND dimension_fingerprint=$7 ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
    [
      input.tx.tenantId,
      r.kpi_id,
      r.kpi_version,
      r.period_start,
      r.period_end,
      input.snapshotType,
      fingerprint,
    ],
  );
  const previousLineage = existing.rows[0]?.source_lineage as
    { source_generation?: string } | undefined;
  if (
    existing.rowCount &&
    previousLineage?.source_generation === sourceGeneration
  )
    return { revision: existing.rows[0]!.revision, created: false };
  const revision = (existing.rows[0]?.revision ?? 0) + 1;
  await input.tx.query(
    `INSERT INTO reporting.kpi_result_snapshots(id,tenant_id,kpi_id,kpi_version,period_start,period_end,snapshot_type,dimensions,dimension_fingerprint,numerator,denominator,value,unit,status,completeness,source_lineage,as_of,generated_at,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      randomUUID(),
      input.tx.tenantId,
      r.kpi_id,
      r.kpi_version,
      r.period_start,
      r.period_end,
      input.snapshotType,
      JSON.stringify(r.dimensions),
      fingerprint,
      r.numerator,
      r.denominator,
      JSON.stringify(r.value),
      r.unit,
      r.status,
      r.completeness,
      JSON.stringify(lineage),
      r.as_of,
      r.generated_at,
      revision,
    ],
  );
  return { revision, created: true };
}

export async function readKpiSnapshots(input: {
  tx: Transaction;
  kpiId: string;
  kpiVersion?: number;
  from: string;
  to: string;
  dimensions?: Record<string, string>;
  revision?: number;
}) {
  assertKpi(input.kpiId);
  const dimensions = input.dimensions ?? {};
  validateDimensions(input.kpiId, dimensions);
  const fingerprint = hash(dimensions);
  const result = await input.tx.query(
    `WITH candidates AS (
       SELECT *,row_number() OVER (PARTITION BY kpi_version,period_start,period_end,snapshot_type,dimension_fingerprint ORDER BY revision DESC) AS latest_rank
        FROM reporting.kpi_result_snapshots
       WHERE tenant_id=$1 AND kpi_id=$2 AND ($3::integer IS NULL OR kpi_version=$3)
         AND period_start >= $4 AND period_end <= $5
         AND dimension_fingerprint=$6
     ) SELECT * FROM candidates
       WHERE ($7::integer IS NOT NULL AND revision=$7) OR ($7::integer IS NULL AND latest_rank=1)
       ORDER BY period_start,snapshot_type,kpi_version`,
    [
      input.tx.tenantId,
      input.kpiId,
      input.kpiVersion ?? null,
      input.from,
      input.to,
      fingerprint,
      input.revision ?? null,
    ],
  );
  return result.rows;
}

/** Additive ranges sum components; ratios sum numerator/denominator; stocks stay time series. */
export function aggregateKpiSnapshots(
  kpiId: string,
  rows: Array<Record<string, unknown>>,
) {
  const definition = KPI_CATALOG[kpiId as KpiId];
  if (definition.mode === "LIVE_COUNT") {
    const unavailable = rows.find((row) => row.status === "UNAVAILABLE");
    const stale = rows.some((row) => row.status === "STALE");
    const partial = rows.some((row) => row.status === "PARTIAL");
    return {
      mode: "DAILY_POINT_IN_TIME",
      time_series: rows,
      status: unavailable
        ? "UNAVAILABLE"
        : stale
          ? "STALE"
          : partial
            ? "PARTIAL"
            : rows.length
              ? "COMPLETE"
              : "UNAVAILABLE",
      ...(unavailable
        ? { source_lineage: unavailable.source_lineage }
        : rows.length
          ? {}
          : { reason: "NO_SNAPSHOT_AVAILABLE" }),
    };
  }
  if (rows.length === 0)
    return {
      status: "UNAVAILABLE",
      value: null,
      reason: "NO_SNAPSHOT_AVAILABLE",
    };
  const unavailable = rows.find((row) => row.status === "UNAVAILABLE");
  if (unavailable)
    return {
      status: "UNAVAILABLE",
      value: null,
      source_lineage: unavailable.source_lineage,
    };
  if (rows.some((row) => row.status === "STALE"))
    return { status: "STALE", value: null };
  if (rows.some((row) => row.status === "PARTIAL"))
    return { status: "PARTIAL", value: null };
  if (definition.mode === "PERIOD_RATIO") {
    const numerator = rows.reduce(
      (sum, row) => sum + Number(row.numerator ?? 0),
      0,
    );
    const denominator = rows.reduce(
      (sum, row) => sum + Number(row.denominator ?? 0),
      0,
    );
    return {
      numerator,
      denominator,
      value: denominator ? (numerator * 100) / denominator : null,
      unit: "PERCENT",
      status: denominator ? "COMPLETE" : "COMPLETE_EMPTY",
    };
  }
  if (definition.mode === "PERIOD_SUM") {
    const currencies = new Map<string, bigint>();
    for (const row of rows)
      for (const amount of (row.value as Array<{
        currency: string;
        amount_minor: string;
      }> | null) ?? [])
        currencies.set(
          amount.currency,
          (currencies.get(amount.currency) ?? 0n) + BigInt(amount.amount_minor),
        );
    return {
      value: [...currencies]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, amount_minor]) => ({
          currency,
          amount_minor: amount_minor.toString(),
          minor_unit_scale: 6,
        })),
      unit: "MONEY_MICRO",
      status: "COMPLETE",
    };
  }
  const value = rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
  return {
    value,
    unit: "COUNT",
    status: "COMPLETE",
  };
}
