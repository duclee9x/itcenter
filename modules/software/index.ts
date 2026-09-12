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
export {
  createDeploymentCampaign,
  transitionDeploymentCampaign,
  listDeploymentCampaigns,
  readDeploymentCampaign,
  listDeploymentTargets,
  retryDeploymentTarget,
  nextDeploymentCandidate,
  claimDeploymentTarget,
  reportDeploymentResult,
  type DeploymentReport,
} from "./application/deployments.js";
export const permissions = [
  { code: "software.read", resource_type: "software_product", action: "read" },
  {
    code: "software.catalog.manage",
    resource_type: "software_product",
    action: "manage",
  },
  {
    code: "software.deploy",
    resource_type: "software_deployment",
    action: "create",
  },
  {
    code: "software.deployment.read",
    resource_type: "software_deployment",
    action: "read",
  },
  {
    code: "software.deployment.cancel",
    resource_type: "software_deployment",
    action: "cancel",
  },
  {
    code: "software.retry_deployment",
    resource_type: "software_deployment",
    action: "retry",
  },
] as const;
