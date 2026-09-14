export const riskProfile = { id: "ASSET_RISK_V1", version: "1" } as const;
export const replacementProfile = {
  id: "ASSET_REPLACEMENT_V1",
  version: "1",
} as const;

export type AssessmentBand = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
export type ReplacementBand =
  "MONITOR" | "REVIEW" | "PLAN" | "PRIORITY" | "UNKNOWN";
export type Evidence = {
  available: boolean;
  score: number;
  details: Record<string, unknown>;
  missing_reason?: string;
};

export const SCORING_ELIGIBLE_LIFECYCLE_STATES = [
  "ASSIGNED",
  "IN_USE",
  "REPAIR",
] as const;

const healthPoints: Record<string, number | null> = {
  HEALTHY: 0,
  WARNING: 20,
  CRITICAL: 40,
  UNKNOWN: null,
};
const operationalPoints: Record<string, number | null> = {
  ONLINE: 0,
  MAINTENANCE: 15,
  OFFLINE: 30,
  UNAVAILABLE: 30,
  UNKNOWN: null,
};

export function currentConditionEvidence(
  health: string,
  operational: string,
): Evidence {
  const healthScore = healthPoints[health] ?? null;
  const operationalScore = operationalPoints[operational] ?? null;
  const known = [healthScore, operationalScore].filter(
    (value): value is number => value !== null,
  );
  return {
    available: healthScore !== null && operationalScore !== null,
    score: known.length ? Math.max(...known) : 0,
    details: {
      health_state: health,
      health_contribution: healthScore,
      operational_state: operational,
      operational_contribution: operationalScore,
      combination: "MAX",
    },
    ...(healthScore === null || operationalScore === null
      ? { missing_reason: "CURRENT_CONDITION_STATE_UNKNOWN" }
      : {}),
  };
}

export function incidentReliabilityContribution(episodes: number): number {
  return episodes === 0 ? 0 : episodes === 1 ? 15 : episodes === 2 ? 25 : 40;
}

export function monitoringReliabilityContribution(episodes: number): number {
  return episodes === 0 ? 0 : episodes <= 2 ? 10 : episodes <= 5 ? 25 : 40;
}

export function maintenanceContribution(repairs: number): number {
  return repairs === 0 ? 0 : repairs === 1 ? 5 : repairs === 2 ? 10 : 20;
}

export function riskBand(score: number, completeness: number): AssessmentBand {
  if (score < 50 && completeness < 70) return "UNKNOWN";
  return score < 25
    ? "LOW"
    : score < 50
      ? "MEDIUM"
      : score < 70
        ? "HIGH"
        : "CRITICAL";
}

export function calculateRisk(input: {
  health: string;
  operational: string;
  incidentEpisodes: number | null;
  monitoringEpisodes: number | null;
  monitoringIdentityAvailable: boolean;
  incidentMonitoringEpisodeIds: readonly string[];
  monitoringEpisodeIds: readonly string[];
  maintenanceCorrectiveCount: number;
  maintenanceUnknownCount: number;
  maintenanceAvailable: boolean;
}) {
  const condition = currentConditionEvidence(input.health, input.operational);
  const incident =
    input.incidentEpisodes === null
      ? null
      : incidentReliabilityContribution(input.incidentEpisodes);
  const monitorCount = input.monitoringEpisodeIds.filter(
    (id) => !input.incidentMonitoringEpisodeIds.includes(id),
  ).length;
  const monitoring =
    input.monitoringIdentityAvailable && input.monitoringEpisodes !== null
      ? monitoringReliabilityContribution(monitorCount)
      : null;
  const reliabilityAvailable = incident !== null && monitoring !== null;
  const reliabilityScore = Math.max(incident ?? 0, monitoring ?? 0);
  const maintenanceAvailable =
    input.maintenanceAvailable && input.maintenanceUnknownCount === 0;
  const maintenanceScore = maintenanceContribution(
    input.maintenanceCorrectiveCount,
  );
  const groups: Record<string, Evidence> = {
    CURRENT_CONDITION: condition,
    RELIABILITY: {
      available: reliabilityAvailable,
      score: reliabilityScore,
      details: {
        incident_episode_count: input.incidentEpisodes,
        incident_contribution: incident,
        monitoring_episode_count_before_overlap: input.monitoringEpisodes,
        monitoring_incident_overlap_excluded:
          input.monitoringEpisodeIds.length - monitorCount,
        monitoring_episode_count: monitorCount,
        monitoring_contribution: monitoring,
        combination: "MAX",
      },
      ...(!reliabilityAvailable
        ? { missing_reason: "RELIABILITY_EVIDENCE_UNAVAILABLE" }
        : {}),
    },
    CORRECTIVE_MAINTENANCE: {
      available: maintenanceAvailable,
      score: maintenanceScore,
      details: {
        corrective_completed_count: input.maintenanceCorrectiveCount,
        unknown_classification_count: input.maintenanceUnknownCount,
        excluded_types: ["PREVENTIVE", "INSPECTION", "OTHER"],
      },
      ...(!maintenanceAvailable
        ? {
            missing_reason: input.maintenanceUnknownCount
              ? "UNKNOWN_MAINTENANCE_CLASSIFICATION"
              : "MAINTENANCE_EVIDENCE_UNAVAILABLE",
          }
        : {}),
    },
  };
  const completeness =
    (condition.available ? 40 : 0) +
    (reliabilityAvailable ? 40 : 0) +
    (maintenanceAvailable ? 20 : 0);
  const score = Math.min(
    100,
    condition.score + reliabilityScore + maintenanceScore,
  );
  return {
    score,
    band: riskBand(score, completeness),
    completeness,
    groups,
    missing_evidence: Object.entries(groups)
      .filter(([, value]) => !value.available)
      .map(([group, value]) => ({ group, reason: value.missing_reason })),
  };
}

export function ageMonthsUtc(acquiredOn: string, asOf: string): number | null {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
      ? date
      : null;
  };
  const start = parse(acquiredOn);
  const end = parse(asOf.slice(0, 10));
  if (!start || !end || start > end) return null;
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  const anniversaryDay = Math.min(
    start.getUTCDate(),
    new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months + 1, 0),
    ).getUTCDate(),
  );
  const anniversary = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + months,
      anniversaryDay,
    ),
  );
  if (anniversary > end) months -= 1;
  return Math.max(0, months);
}

export function ageContribution(ageMonths: number, expectedLifeMonths: number) {
  if (
    !Number.isInteger(ageMonths) ||
    ageMonths < 0 ||
    !Number.isInteger(expectedLifeMonths) ||
    expectedLifeMonths <= 0
  )
    return null;
  const ratio = ageMonths / expectedLifeMonths;
  return {
    ratio,
    score:
      ratio < 0.7
        ? 0
        : ratio < 0.9
          ? 5
          : ratio < 1
            ? 10
            : ratio < 1.2
              ? 15
              : 20,
  };
}

export function warrantyContribution(state: string): number | null {
  return state === "VALID"
    ? 0
    : state === "EXPIRING"
      ? 5
      : state === "EXPIRED"
        ? 15
        : null;
}

export function economicRepairContribution(ratio: number): number | null {
  if (!Number.isFinite(ratio) || ratio < 0) return null;
  return ratio < 0.2
    ? 0
    : ratio < 0.4
      ? 5
      : ratio < 0.6
        ? 10
        : ratio < 0.8
          ? 15
          : 25;
}

export function replacementBand(
  score: number,
  completeness: number,
): ReplacementBand {
  if (score < 60 && completeness < 70) return "UNKNOWN";
  return score < 40
    ? "MONITOR"
    : score < 60
      ? "REVIEW"
      : score < 80
        ? "PLAN"
        : "PRIORITY";
}

export function calculateReplacement(input: {
  riskScore: number | null;
  ageScore: number | null;
  warrantyScore: number | null;
  economicScore: number | null;
  components: Record<string, Evidence>;
}) {
  const available = Object.values(input.components);
  const completeness = available.reduce(
    (sum, item) =>
      sum +
      (item.available ? Number(item.details.availability_weight ?? 0) : 0),
    0,
  );
  const score = Math.min(
    100,
    available.reduce((sum, item) => sum + item.score, 0),
  );
  return {
    score,
    band: replacementBand(score, completeness),
    completeness,
    components: input.components,
    missing_evidence: Object.entries(input.components)
      .filter(([, value]) => !value.available)
      .map(([dimension, value]) => ({
        dimension,
        reason: value.missing_reason,
      })),
  };
}
