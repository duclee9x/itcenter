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

export const permissions = [
  { code: "license.read", resource_type: "license", action: "read" },
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
