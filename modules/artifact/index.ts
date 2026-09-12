export {
  createArtifactIntake,
  getArtifactScanTarget,
  recordArtifactScan,
  reviewArtifact,
  activateArtifact,
  restrictArtifact,
  revokeArtifact,
  assertArtifactPublishable,
  readArtifact,
} from "./application/artifacts.js";
export type {
  ArtifactObjectStoragePort,
  MalwareScannerPort,
  PublisherSignaturePort,
  StoredArtifactObject,
} from "./application/ports.js";
export { unavailableArtifactStorage } from "./application/ports.js";
export const permissions = [
  { code: "artifact.read", resource_type: "artifact_version", action: "read" },
  {
    code: "artifact.upload",
    resource_type: "artifact_version",
    action: "upload",
  },
  {
    code: "artifact.scan.review",
    resource_type: "artifact_version",
    action: "scan.review",
  },
  {
    code: "artifact.approve",
    resource_type: "artifact_version",
    action: "approve",
  },
  {
    code: "artifact.revoke",
    resource_type: "artifact_version",
    action: "revoke",
  },
] as const;
