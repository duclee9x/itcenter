export {
  RECOMMENDATION_FAMILIES,
  RECOMMENDATION_INTERACTIONS,
  RECOMMENDATION_PROFILE_ID,
  RECOMMENDATION_PROFILE_VERSION,
  RECOMMENDATION_STATES,
  availableSourceAction,
  canonicalSourceGeneration,
  type RecommendationContextType,
  type RecommendationFamily,
  type RecommendationInteractionType,
  type RecommendationSource,
  type RecommendationState,
  type SourceContext,
} from "./domain/recommendation.js";
export {
  applyCurrentSourceEligibility,
  markRecommendationSourceMissing,
  materializeRecommendationSource,
  readRecommendationById,
  readRecommendationFamily,
  readRecommendationRevisions,
  recordRecommendationInteraction,
  sourceUnavailableReason,
  writeRecommendationWatermark,
} from "./application/recommendation.js";
export {
  reconcileRecommendationSources,
  recommendationServiceAuthorization,
  requireRecommendationReconcileGrant,
  collectIncident,
  collectKnowledge,
  collectReplacement,
  incidentSource,
  replacementSource,
  queryCurrentRecommendationFamilySources,
} from "./application/reconciliation.js";
export { recommendationGenerationKey } from "./application/recommendation.js";
