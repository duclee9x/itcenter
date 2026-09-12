export {
  createLicenseEntitlement,
  updateLicenseEntitlement,
  renewLicenseEntitlement,
  readLicenseEntitlement,
  listLicenseEntitlements,
  createLicensePool,
  updateLicensePool,
  readLicensePool,
  listLicensePools,
  recordDueEntitlementExpiryFacts,
  recordUpcomingEntitlementExpiringFacts,
  licenseTypes,
  poolTypes,
} from "./application/entitlements.js";
export {
  reserveLicenseForDeployment,
  releaseDeploymentReservation,
  activateDeploymentReservation,
  createLicenseAssignment,
  transitionLicenseAssignment,
  recordLicenseUsageObservation,
  listLicenseCompliance,
  readLicenseAvailability,
  readLicenseAssignment,
  recordLicenseComplianceFacts,
} from "./application/assignments.js";

export const permissions = [
  { code: "license.read", resource_type: "license", action: "read" },
  {
    code: "license.assign",
    resource_type: "license_assignment",
    action: "assign",
  },
  {
    code: "license.reclaim",
    resource_type: "license_assignment",
    action: "reclaim",
  },
  {
    code: "license.compliance.resolve",
    resource_type: "license_compliance",
    action: "resolve",
  },
  {
    code: "license.entitlement.manage",
    resource_type: "license_entitlement",
    action: "manage",
  },
  {
    code: "license.pool.manage",
    resource_type: "license_pool",
    action: "manage",
  },
] as const;
