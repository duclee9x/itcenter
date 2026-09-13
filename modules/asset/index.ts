export {
  assertAssetExists,
  assertAssetEligibleForLicense,
  assertAssetEligibleForMaintenance,
  createAsset,
  registerReceivedAsset,
} from "./application/registry.js";
export {
  assignAsset,
  reserveAsset,
  requestReturn,
  receiveReturn,
  listUserAssetsForOffboarding,
  cancelReturnRequest,
  readReturnRequestState,
  transferAsset,
  transitionLifecycle,
} from "./application/lifecycle.js";
export {
  recommendReplacementCandidate,
  type ReplacementCandidateRecommendation,
  type ReplacementCandidateRecommendationResult,
} from "./application/replacement-candidate.js";
export {
  listScoringAssetIds,
  expireAssetRiskProjections,
  readAssetAssessments,
  recalculateAssetAssessments,
  type ScoringActor,
} from "./application/scoring.js";
export {
  recordVerifiedAcquisitionDate,
  saveAssetReplacementPolicy,
} from "./application/scoring-governance.js";
export {
  listWarrantyProjectionAssetIds,
  projectWarrantyState,
  type AssetWarrantyProjectionState,
} from "./application/warranty-projection.js";
