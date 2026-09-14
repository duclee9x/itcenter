export const RECOMMENDATION_FAMILIES = [
  "INCIDENT_CORRELATION_REVIEW",
  "KNOWLEDGE_GUIDANCE",
  "ASSET_REPLACEMENT_REVIEW",
] as const;
export type RecommendationFamily = (typeof RECOMMENDATION_FAMILIES)[number];

export const RECOMMENDATION_STATES = [
  "ACTIVE",
  "SUPERSEDED",
  "RESOLVED_BY_SOURCE",
  "EXPIRED",
] as const;
export type RecommendationState = (typeof RECOMMENDATION_STATES)[number];

export const RECOMMENDATION_INTERACTIONS = [
  "VIEWED",
  "DISMISSED",
  "OPENED_SOURCE",
] as const;
export const RECOMMENDATION_PROFILE_ID = "TASK-096-EXPLAINABLE";
export const RECOMMENDATION_PROFILE_VERSION = 1;
export type RecommendationInteractionType =
  (typeof RECOMMENDATION_INTERACTIONS)[number];

export type RecommendationContextType =
  "INCIDENT" | "TICKET" | "RECOMMENDATION_SESSION" | "ASSET";

export type SourceContext = {
  type: RecommendationContextType;
  id: string;
};

export type RecommendationSource = {
  family: RecommendationFamily;
  source_domain: "INCIDENT" | "KNOWLEDGE" | "ASSET";
  source_type: string;
  source_id: string;
  contexts: SourceContext[];
  generation: Record<string, unknown>;
  source_version: Record<string, unknown>;
  profile_id?: string;
  profile_version?: string | number;
  rank?: number;
  score?: number;
  band?: string;
  reason_codes: string[];
  evidence_summary: Record<string, unknown>;
  freshness: Record<string, unknown>;
  valid_until?: string | null;
  initial_provenance:
    "INITIAL_RECONCILIATION" | "SOURCE_EVENT" | "RECONCILIATION";
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

export function canonicalSourceGeneration(value: Record<string, unknown>) {
  return JSON.stringify(canonical(value));
}

export function availableSourceAction(family: RecommendationFamily) {
  switch (family) {
    case "INCIDENT_CORRELATION_REVIEW":
      return {
        action_type: "OPEN_CORRELATION_REVIEW" as const,
        owning_domain: "INCIDENT" as const,
        required_permission: "incident.correlation.read",
        endpoint_id: "GET /api/v1/incidents/{incident_id}/correlations",
      };
    case "KNOWLEDGE_GUIDANCE":
      return {
        action_type: "OPEN_KNOWLEDGE_SESSION" as const,
        owning_domain: "KNOWLEDGE" as const,
        required_permission: "knowledge.recommendation.review",
        endpoint_id:
          "GET /api/v1/knowledge/recommendation-sessions/{session_id}",
      };
    case "ASSET_REPLACEMENT_REVIEW":
      return {
        action_type: "OPEN_REPLACEMENT_REVIEW" as const,
        owning_domain: "ASSET" as const,
        required_permission: "replacement.review",
        endpoint_id: "POST /api/v1/replacements/{candidate_id}/commands/review",
      };
  }
}
