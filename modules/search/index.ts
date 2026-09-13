export {
  SEARCH_ENTITY_TYPES,
  exactCanonicalFallback,
  findSearchCandidates,
  normalizeExactTerm,
  normalizeSearchText,
  refreshSearchEntity,
  refreshKnowledgeByApplicabilityTarget,
  reindexSearchPage,
  searchTypeForAggregate,
} from "./application/search.js";
export type {
  SearchCandidate,
  SearchDocument,
  SearchEntityType,
} from "./application/search.js";
