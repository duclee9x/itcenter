export {
  createProblem,
  createChange,
  createKnowledge,
  transitionRecord,
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_APPLICABILITY_TYPES,
  readKnowledgeArticle,
  readKnowledgeRecommendationEligibility,
  queryKnowledgeRecommendationEligibility,
  isKnowledgeSearchCandidateCurrent,
  updateKnowledgeAudience,
  replaceKnowledgeApplicability,
} from "./application/problem.js";
export type {
  KnowledgeAudience,
  KnowledgeApplicabilityType,
  KnowledgeApplicabilityTarget,
  KnowledgeApplicabilityResolver,
  KnowledgeApplicabilityTargetStatus,
} from "./application/problem.js";
