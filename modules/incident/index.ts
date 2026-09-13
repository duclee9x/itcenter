export {
  createIncident,
  transitionIncident,
  readIncidentRecommendationContext,
  incidentRecommendationContextQuery,
} from "./application/incident.js";
export type { IncidentRecommendationContextQuery } from "./application/incident.js";
export { correlateIncident } from "./application/correlation.js";
export {
  detachIncidentAsset,
  linkIncidentAsset,
  queryIncidentAssetHistory,
  recordMonitoringIncidentAssetLink,
  recordExplicitIncidentAssetLink,
  type IncidentAssetSource,
} from "./application/asset-links.js";
export {
  attachIncidentToRoot,
  rejectIncidentCorrelation,
  detachIncidentFromRoot,
  readIncidentCorrelationHistory,
} from "./application/advanced-correlation.js";
export {
  correlationProfile,
  decideCorrelation,
  hasUnambiguousSharedSwitchIdentity,
  sharedTopologyFreshness,
  scoreCorrelationCandidate,
} from "./domain/correlation.js";
export type {
  CorrelationContribution,
  CorrelationEvidenceCode,
  CorrelationEvidenceFacts,
  ScoredCorrelationCandidate,
} from "./domain/correlation.js";
export {
  declareMajor,
  publishCommunication,
} from "./application/communication.js";
export {
  queryActiveIncidentEpisodesAt,
  queryIncidentStateAt,
  isIncidentActiveState,
} from "./application/state-history.js";
