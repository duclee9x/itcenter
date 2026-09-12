export {
  createSoftwareProduct,
  createSoftwareVersion,
  assertVersionAcceptsArtifact,
  changeSoftwareClassification,
  updateSoftwareVisibility,
  publishSoftwareVersion,
  listSoftwareProducts,
  listSoftwareVersions,
  withdrawPublishedArtifact,
} from "./application/catalog.js";
export const permissions = [
  { code: "software.read", resource_type: "software_product", action: "read" },
  {
    code: "software.catalog.manage",
    resource_type: "software_product",
    action: "manage",
  },
] as const;
