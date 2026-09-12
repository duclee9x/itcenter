import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import type { MalwareScannerPort, PublisherSignaturePort } from "./ports.js";

export type ArtifactScanStatus =
  "PASSED" | "FAILED" | "QUARANTINE" | "NEEDS_REVIEW";
export type ArtifactSignatureStatus = "VALID" | "INVALID" | "UNSIGNED";
const digest = /^[a-f0-9]{64}$/;

function text(value: string, field: string, limit = 1024) {
  if (!value.trim() || value.length > limit)
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}

export async function createArtifactIntake(input: {
  tx: Transaction;
  softwareVersionId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sourceType: string;
  checksumSha256: string;
  storageRef: string;
  uploaderId: string;
  assertSoftwareVersionAcceptsArtifact: (input: {
    tx: Transaction;
    softwareVersionId: string;
  }) => Promise<void>;
}) {
  const checksumSha256 = input.checksumSha256.toLowerCase();
  if (!digest.test(checksumSha256))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "checksum_sha256 must be a SHA-256 digest.",
    );
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1)
    throw new ApplicationError("VALIDATION_ERROR", "size_bytes is invalid.");
  if (
    ![
      "VENDOR_OFFICIAL",
      "INTERNAL_BUILD",
      "APPROVED_MIRROR",
      "PACKAGE_REPOSITORY",
      "MANUAL_UPLOAD",
      "CI_PIPELINE",
    ].includes(input.sourceType)
  )
    throw new ApplicationError("VALIDATION_ERROR", "source_type is invalid.");
  const storageRef = text(input.storageRef, "storage_ref", 512);
  if (/\s|[\r\n]/.test(storageRef))
    throw new ApplicationError("VALIDATION_ERROR", "storage_ref is invalid.");
  await input.assertSoftwareVersionAcceptsArtifact({
    tx: input.tx,
    softwareVersionId: input.softwareVersionId,
  });
  const existing = await input.tx.query(
    "SELECT id,checksum_sha256,storage_ref,state,version FROM artifact.artifact_versions WHERE tenant_id=$1 AND software_version_id=$2 FOR UPDATE",
    [input.tx.tenantId, input.softwareVersionId],
  );
  if (existing.rowCount) {
    const row = existing.rows[0]!;
    if (row.checksum_sha256 !== checksumSha256)
      return {
        kind: "INTEGRITY_CONFLICT" as const,
        id: String(row.id),
        expected_checksum: String(row.checksum_sha256),
        observed_checksum: checksumSha256,
        storage_ref: storageRef,
        version: Number(row.version),
      };
    return {
      kind: "EXISTING" as const,
      id: String(row.id),
      checksum_sha256: checksumSha256,
      state: String(row.state),
      version: Number(row.version),
    };
  }
  const id = randomUUID();
  const filename = text(input.filename, "filename", 512);
  if (/[\\/\u0000-\u001f\u007f]/.test(filename))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "filename must be a plain display name.",
    );
  await input.tx.query(
    "INSERT INTO artifact.artifact_versions(id,tenant_id,software_version_id,filename,media_type,size_bytes,source_type,checksum_sha256,storage_ref,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      id,
      input.tx.tenantId,
      input.softwareVersionId,
      filename,
      text(input.mediaType, "media_type", 256),
      input.sizeBytes,
      input.sourceType,
      checksumSha256,
      storageRef,
      text(input.uploaderId, "uploader_id", 256),
    ],
  );
  return {
    kind: "CREATED" as const,
    id,
    software_version_id: input.softwareVersionId,
    checksum_sha256: checksumSha256,
    signature_status: "PENDING",
    scan_status: "PENDING",
    review_status: "PENDING",
    state: "REVIEW_REQUIRED",
    version: 1,
  };
}

export async function getArtifactScanTarget(tx: Transaction, id: string) {
  const result = await tx.query(
    "SELECT id,software_version_id,storage_ref,checksum_sha256,size_bytes,media_type,scan_status,signature_status,state,uploaded_by,version FROM artifact.artifact_versions WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Artifact was not found.");
  return result.rows[0]!;
}

function safeProviderOutput(value: string, field: string) {
  return text(value, field, 256);
}

export async function recordArtifactScan(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  actorId: string;
  scannerResult: Awaited<ReturnType<MalwareScannerPort["scan"]>>;
  signatureResult?: Awaited<ReturnType<PublisherSignaturePort["verify"]>>;
}) {
  const rowResult = await input.tx.query(
    "SELECT id,scan_status,signature_status,state,version FROM artifact.artifact_versions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.id],
  );
  if (!rowResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Artifact was not found.");
  const row = rowResult.rows[0]!;
  assertVersion(Number(row.version), input.expectedVersion);
  if (!["REVIEW_REQUIRED"].includes(String(row.state)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only artifacts awaiting review can be scanned.",
    );
  if (
    !["PASSED", "FAILED", "QUARANTINE", "NEEDS_REVIEW"].includes(
      input.scannerResult.status,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Scanner result is invalid.",
    );
  const scanner = safeProviderOutput(input.scannerResult.scanner, "scanner");
  const scanReason = `Scanner reported ${input.scannerResult.status}.`;
  const scanEvidence = input.scannerResult.evidenceRef
    ? safeProviderOutput(
        input.scannerResult.evidenceRef,
        "scan evidence reference",
      )
    : null;
  let signatureStatus = String(row.signature_status);
  if (input.signatureResult) {
    signatureStatus = input.signatureResult.status;
    if (!["VALID", "INVALID", "UNSIGNED"].includes(signatureStatus))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Signature result is invalid.",
      );
    await input.tx.query(
      "INSERT INTO artifact.artifact_scan_results(id,tenant_id,artifact_version_id,result_type,status,provider,actor_id,reason,evidence_ref) VALUES($1,$2,$3,'SIGNATURE',$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        input.tx.tenantId,
        input.id,
        signatureStatus,
        safeProviderOutput(
          input.signatureResult.verifier,
          "signature verifier",
        ),
        input.actorId,
        `Signature verifier reported ${signatureStatus}.`,
        input.signatureResult.evidenceRef
          ? safeProviderOutput(
              input.signatureResult.evidenceRef,
              "signature evidence reference",
            )
          : null,
      ],
    );
  }
  const scanResultId = randomUUID();
  await input.tx.query(
    "INSERT INTO artifact.artifact_scan_results(id,tenant_id,artifact_version_id,result_type,status,provider,actor_id,reason,evidence_ref) VALUES($1,$2,$3,'SCAN',$4,$5,$6,$7,$8)",
    [
      scanResultId,
      input.tx.tenantId,
      input.id,
      input.scannerResult.status,
      scanner,
      input.actorId,
      scanReason,
      scanEvidence,
    ],
  );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE artifact.artifact_versions SET scan_status=$1,signature_status=$2,version=$3,updated_at=now() WHERE tenant_id=$4 AND id=$5",
    [
      input.scannerResult.status,
      signatureStatus,
      version,
      input.tx.tenantId,
      input.id,
    ],
  );
  return {
    id: input.id,
    scan_result_id: scanResultId,
    scan_status: input.scannerResult.status,
    signature_status: signatureStatus,
    scanner,
    reason: scanReason,
    evidence_ref: scanEvidence,
    version,
  };
}

export async function reviewArtifact(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  actorId: string;
  decision: "APPROVE" | "WAIVE" | "REJECT";
  reason: string;
  expiresAt?: string;
}) {
  const rowResult = await input.tx.query(
    "SELECT id,uploaded_by,scan_status,signature_status,review_status,state,version FROM artifact.artifact_versions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.id],
  );
  if (!rowResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Artifact was not found.");
  const row = rowResult.rows[0]!;
  assertVersion(Number(row.version), input.expectedVersion);
  if (row.state !== "REVIEW_REQUIRED" || row.review_status !== "PENDING")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Artifact is not awaiting review.",
    );
  if (!["APPROVE", "WAIVE", "REJECT"].includes(input.decision))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Review decision is invalid.",
    );
  const reason = text(input.reason, "reason", 2000);
  if (input.decision !== "REJECT" && row.uploaded_by === input.actorId)
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Artifact uploaders cannot approve their own artifact.",
    );
  if (input.decision === "WAIVE") {
    const expiresAt = input.expiresAt
      ? new Date(input.expiresAt)
      : new Date(NaN);
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "A future scan-waiver expiry is required.",
      );
  } else if (input.expiresAt !== undefined) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expires_at is only valid for a scan waiver.",
    );
  }
  if (input.decision === "APPROVE" && row.scan_status !== "PASSED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a passed scan can be approved without a waiver.",
    );
  if (
    input.decision === "WAIVE" &&
    !["PENDING", "NEEDS_REVIEW"].includes(String(row.scan_status))
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an artifact without a completed scan may use the waiver path.",
    );
  if (input.decision !== "REJECT" && row.signature_status !== "VALID")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "A valid publisher signature is required for approval.",
    );
  const state = input.decision === "REJECT" ? "REJECTED" : "APPROVED";
  const scanStatus =
    input.decision === "WAIVE" ? "WAIVED" : String(row.scan_status);
  const expiresAt = input.decision === "WAIVE" ? input.expiresAt! : null;
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE artifact.artifact_versions SET scan_status=$1,scan_waived_until=$2,review_status=$3,state=$4,reviewed_by=$5,review_notes=$6,version=$7,updated_at=now() WHERE tenant_id=$8 AND id=$9",
    [
      scanStatus,
      expiresAt,
      state === "REJECTED" ? "REJECTED" : "APPROVED",
      state,
      input.actorId,
      reason,
      version,
      input.tx.tenantId,
      input.id,
    ],
  );
  await input.tx.query(
    "INSERT INTO artifact.artifact_scan_results(id,tenant_id,artifact_version_id,result_type,status,provider,actor_id,reason,expires_at) VALUES($1,$2,$3,$4,$5,'human-review',$6,$7,$8)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.id,
      input.decision === "WAIVE" ? "WAIVER" : "REVIEW",
      input.decision,
      input.actorId,
      reason,
      expiresAt,
    ],
  );
  return {
    id: input.id,
    decision: input.decision,
    state,
    scan_status: scanStatus,
    reviewed_by: input.actorId,
    reason,
    expires_at: expiresAt,
    version,
  };
}

async function lockMutableArtifact(
  tx: Transaction,
  id: string,
  expectedVersion: number,
) {
  const result = await tx.query(
    "SELECT id,state,review_status,scan_status,signature_status,scan_waived_until,version FROM artifact.artifact_versions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Artifact was not found.");
  const row = result.rows[0]!;
  assertVersion(Number(row.version), expectedVersion);
  return row;
}

function requiresValidChecks(row: Record<string, unknown>) {
  return (
    row.review_status === "APPROVED" &&
    row.signature_status === "VALID" &&
    (row.scan_status === "PASSED" ||
      (row.scan_status === "WAIVED" &&
        row.scan_waived_until &&
        new Date(String(row.scan_waived_until)).getTime() > Date.now()))
  );
}

export async function activateArtifact(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  reason: string;
}) {
  const row = await lockMutableArtifact(
    input.tx,
    input.id,
    input.expectedVersion,
  );
  if (row.state !== "APPROVED" || !requiresValidChecks(row))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an approved artifact with current scan and signature validation can be activated.",
    );
  const reason = text(input.reason, "reason", 2000);
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE artifact.artifact_versions SET state='ACTIVE',version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
    [version, input.tx.tenantId, input.id],
  );
  return {
    id: input.id,
    from_state: "APPROVED",
    state: "ACTIVE",
    reason,
    version,
  };
}

export async function restrictArtifact(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  reason: string;
}) {
  const row = await lockMutableArtifact(
    input.tx,
    input.id,
    input.expectedVersion,
  );
  if (!["APPROVED", "ACTIVE"].includes(String(row.state)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an approved or active artifact can be restricted.",
    );
  const reason = text(input.reason, "reason", 2000);
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE artifact.artifact_versions SET state='RESTRICTED',version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
    [version, input.tx.tenantId, input.id],
  );
  return {
    id: input.id,
    from_state: String(row.state),
    state: "RESTRICTED",
    reason,
    version,
  };
}

export async function revokeArtifact(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  reason: string;
}) {
  const row = await lockMutableArtifact(
    input.tx,
    input.id,
    input.expectedVersion,
  );
  if (["REVOKED", "REJECTED", "RETIRED"].includes(String(row.state)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Artifact is already terminal.",
    );
  const reason = text(input.reason, "reason", 2000);
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE artifact.artifact_versions SET state='REVOKED',version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
    [version, input.tx.tenantId, input.id],
  );
  return {
    id: input.id,
    from_state: String(row.state),
    state: "REVOKED",
    reason,
    version,
  };
}

export async function assertArtifactPublishable(input: {
  tx: Transaction;
  artifactVersionId: string;
  softwareVersionId: string;
}) {
  const result = await input.tx.query(
    "SELECT state,review_status,scan_status,signature_status,scan_waived_until,software_version_id FROM artifact.artifact_versions WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.artifactVersionId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Artifact was not found.");
  const row = result.rows[0]!;
  if (
    row.software_version_id !== input.softwareVersionId ||
    row.state !== "ACTIVE" ||
    !requiresValidChecks(row)
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a matching active, approved artifact with current validation can be published.",
    );
}

export async function readArtifact(tx: Transaction, id: string) {
  const result = await tx.query(
    "SELECT id,software_version_id,filename,media_type,size_bytes,source_type,checksum_sha256,signature_status,scan_status,review_status,state,uploaded_by,reviewed_by,review_notes,scan_waived_until,version,created_at,updated_at FROM artifact.artifact_versions WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Artifact was not found.");
  return result.rows[0];
}
