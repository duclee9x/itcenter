export {
  assertAssetExists,
  assertAssetEligibleForLicense,
  assertAssetEligibleForMaintenance,
  createAsset,
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
