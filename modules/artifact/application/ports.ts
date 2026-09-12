import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

export interface StoredArtifactObject {
  checksumSha256: string;
  sizeBytes: number;
  mediaType: string;
}

export interface ArtifactObjectStoragePort {
  inspect(
    storageRef: string,
    signal?: AbortSignal,
  ): Promise<StoredArtifactObject | null>;
}

export interface MalwareScannerPort {
  scan(input: {
    storageRef: string;
    checksumSha256: string;
    signal?: AbortSignal;
  }): Promise<{
    status: "PASSED" | "FAILED" | "QUARANTINE" | "NEEDS_REVIEW";
    scanner: string;
    reason: string;
    evidenceRef?: string;
  }>;
}

export interface PublisherSignaturePort {
  verify(input: {
    storageRef: string;
    checksumSha256: string;
    signal?: AbortSignal;
  }): Promise<{
    status: "VALID" | "INVALID" | "UNSIGNED";
    verifier: string;
    reason: string;
    evidenceRef?: string;
  }>;
}

export const unavailableArtifactStorage: ArtifactObjectStoragePort = {
  async inspect() {
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "Artifact object storage is not configured.",
      true,
    );
  },
};
