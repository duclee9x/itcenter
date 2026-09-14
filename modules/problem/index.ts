export {
  createProblem,
  createChange,
  createKnowledge,
  transitionRecord,
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_APPLICABILITY_TYPES,
  readKnowledgeArticle,
  readProblemRecommendationReference,
  readKnowledgeRecommendationEligibility,
  queryKnowledgeRecommendationEligibility,
  isKnowledgeSearchCandidateCurrent,
  updateKnowledgeAudience,
  replaceKnowledgeApplicability,
} from "./application/problem.js";
export {
  RECOMMENDATION_PROFILE_ID,
  RECOMMENDATION_PROFILE_VERSION,
  RECOMMENDATION_MAX_ITEMS,
  RECOMMENDATION_MIN_SCORE,
  normalizeRecommendationText,
  normalizeRecommendationContext,
  recommendationContextHash,
  scoreKnowledgeRecommendation,
  createRecommendationSession,
  readRecommendationSession,
  lockRecommendationSession,
  appendRecommendationInteraction,
  transitionRecommendationSession,
  readKnowledgeApplicabilityForRecommendation,
} from "./application/recommendations.js";
export {
  queryRecommendationSourceSessions,
  type RecommendationSourceContext,
} from "./application/recommendation-source.js";
export type {
  RecommendationContext,
  RecommendationApplicability,
  RecommendationEvidence,
} from "./application/recommendations.js";
export {
  queryKnowledgeReporting,
  queryKnowledgeDrilldown,
} from "./application/reporting.js";
export type {
  KnowledgeAudience,
  KnowledgeApplicabilityType,
  KnowledgeApplicabilityTarget,
  KnowledgeApplicabilityResolver,
  KnowledgeApplicabilityTargetStatus,
} from "./application/problem.js";
