export const correlationProfile = {
  id: "TASK-092-V1",
  version: 1,
  autoLinkThreshold: 85,
  reviewThreshold: 60,
} as const;

export type CorrelationEvidenceCode =
  | "DETERMINISTIC_SOURCE_KEY"
  | "FRESH_FAILURE_DOMAIN_ANCESTOR"
  | "FRESH_VLAN_OR_SUBNET"
  | "SAME_SITE"
  | "SAME_SERVICE_OR_DEPENDENCY"
  | "SAME_SYMPTOM_FAMILY"
  | "ONSET_WITHIN_5_MINUTES"
  | "ONSET_WITHIN_15_MINUTES";

export interface CorrelationEvidenceFacts {
  exactSourceKey: boolean;
  topologyFreshness: "FRESH" | "STALE" | "UNKNOWN";
  sameFailureDomainAncestor: boolean;
  sameVlanOrSubnet: boolean;
  sameSite: boolean;
  sameServiceOrDependency: boolean;
  sameSymptomFamily: boolean;
  onsetDifferenceMinutes: number | null;
}

export interface CorrelationContribution {
  code: CorrelationEvidenceCode;
  points: number;
  strong: boolean;
  evidenceReferences: string[];
  freshness: "FRESH" | "STALE" | "UNKNOWN" | "NOT_APPLICABLE";
}

export interface ScoredCorrelationCandidate {
  rootIncidentId: string;
  rawScore: number;
  score: number;
  strongSignals: CorrelationEvidenceCode[];
  contributions: CorrelationContribution[];
}

export function scoreCorrelationCandidate(input: {
  rootIncidentId: string;
  facts: CorrelationEvidenceFacts;
  evidenceReferences: Partial<Record<CorrelationEvidenceCode, string[]>>;
}): ScoredCorrelationCandidate {
  const { facts } = input;
  const contributions: CorrelationContribution[] = [];
  const add = (
    code: CorrelationEvidenceCode,
    points: number,
    strong = false,
    freshness: CorrelationContribution["freshness"] = "NOT_APPLICABLE",
  ) => {
    contributions.push({
      code,
      points,
      strong,
      evidenceReferences: input.evidenceReferences[code] ?? [],
      freshness,
    });
  };

  if (facts.exactSourceKey) add("DETERMINISTIC_SOURCE_KEY", 100, true);

  if (facts.topologyFreshness === "FRESH") {
    if (facts.sameFailureDomainAncestor)
      add("FRESH_FAILURE_DOMAIN_ANCESTOR", 60, true, "FRESH");
    else if (facts.sameVlanOrSubnet)
      add("FRESH_VLAN_OR_SUBNET", 15, false, "FRESH");
    else if (facts.sameSite) add("SAME_SITE", 5, false, "FRESH");
  } else if (facts.sameSite) add("SAME_SITE", 5);
  if (facts.sameServiceOrDependency) add("SAME_SERVICE_OR_DEPENDENCY", 20);
  if (facts.sameSymptomFamily) add("SAME_SYMPTOM_FAMILY", 10);
  if (
    facts.onsetDifferenceMinutes !== null &&
    facts.onsetDifferenceMinutes >= 0 &&
    facts.onsetDifferenceMinutes <= 5
  )
    add("ONSET_WITHIN_5_MINUTES", 15);
  else if (
    facts.onsetDifferenceMinutes !== null &&
    facts.onsetDifferenceMinutes > 5 &&
    facts.onsetDifferenceMinutes <= 15
  )
    add("ONSET_WITHIN_15_MINUTES", 10);

  const rawScore = contributions.reduce((sum, item) => sum + item.points, 0);
  return {
    rootIncidentId: input.rootIncidentId,
    rawScore,
    score: Math.min(rawScore, 100),
    strongSignals: contributions
      .filter((item) => item.strong)
      .map((item) => item.code),
    contributions,
  };
}

export function decideCorrelation(input: {
  candidates: readonly ScoredCorrelationCandidate[];
  explicitReviewReason?: string | null;
}): {
  outcome: "AUTO_LINK" | "REVIEW_REQUIRED" | "NO_LINK";
  selectedRootIncidentId: string | null;
  reasonCode: string;
} {
  if (input.explicitReviewReason)
    return {
      outcome: "REVIEW_REQUIRED",
      selectedRootIncidentId: null,
      reasonCode: input.explicitReviewReason,
    };

  const autoCandidates = input.candidates.filter(
    (candidate) =>
      candidate.score >= correlationProfile.autoLinkThreshold &&
      candidate.strongSignals.length > 0,
  );
  const reviewCandidateExists = input.candidates.some(
    (candidate) => candidate.score >= correlationProfile.reviewThreshold,
  );
  if (
    autoCandidates.length === 1 &&
    input.candidates.every(
      (candidate) =>
        candidate.rootIncidentId === autoCandidates[0]!.rootIncidentId ||
        candidate.score < correlationProfile.reviewThreshold,
    )
  )
    return {
      outcome: "AUTO_LINK",
      selectedRootIncidentId: autoCandidates[0]!.rootIncidentId,
      reasonCode: "UNAMBIGUOUS_STRONG_EVIDENCE",
    };

  if (reviewCandidateExists || autoCandidates.length > 1)
    return {
      outcome: "REVIEW_REQUIRED",
      selectedRootIncidentId: null,
      reasonCode:
        autoCandidates.length > 1
          ? "MULTIPLE_AUTO_LINK_CANDIDATES"
          : "CORRELATION_AMBIGUOUS",
    };

  return {
    outcome: "NO_LINK",
    selectedRootIncidentId: null,
    reasonCode: "INSUFFICIENT_CORRELATION_EVIDENCE",
  };
}
