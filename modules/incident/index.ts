export { createIncident, transitionIncident } from "./application/incident.js";
export { correlateIncident } from "./application/correlation.js";
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
