import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import type { ObjectReference } from "../../../packages/object-storage/src/index.js";

const digest = /^[a-f0-9]{64}$/;
function fail(message: string): never {
  throw new ApplicationError("BUSINESS_RULE_VIOLATION", message);
}
function required(v: unknown, name: string, max = 1024) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new ApplicationError("VALIDATION_ERROR", `${name} is required.`);
  return v.trim();
}
export type DocumentCommand =
  | "DOCUMENT.CREATE"
  | "DOCUMENT.ADD_VERSION"
  | "DOCUMENT.FINALIZE"
  | "DOCUMENT.SUPERSEDE"
  | "DOCUMENT.VOID";

export async function executeCommercialDocumentCommand(input: {
  tx: Transaction;
  command: DocumentCommand;
  id?: string;
  expectedVersion?: number;
  body: Record<string, unknown>;
  actorId: string;
  correlationId: string;
  verifiedObject?: ObjectReference | null;
}) {
  const { tx, command, body } = input;
  let row: Record<string, unknown>, event: string;
  if (command === "DOCUMENT.CREATE") {
    const id = randomUUID(),
      versionId = randomUUID(),
      code = required(body.document_code, "document_code", 100),
      type = required(body.document_type, "document_type", 40),
      resourceType = required(body.resource_type, "resource_type", 80),
      resourceId = required(body.resource_id, "resource_id", 80),
      classification = required(
        body.classification ?? "CONFIDENTIAL",
        "classification",
        40,
      ),
      storage = required(body.storage_ref, "storage_ref"),
      hash = required(body.content_hash, "content_hash", 64).toLowerCase(),
      contentType = required(body.content_type, "content_type", 256),
      size = Number(body.size_bytes),
      signature = String(body.signature_status ?? "NONE");
    if (
      ![
        "CONTRACT",
        "AMENDMENT",
        "RENEWAL",
        "TERMINATION_NOTICE",
        "EXECUTION_EVIDENCE",
        "OTHER_COMMERCIAL_EVIDENCE",
      ].includes(type) ||
      !["INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(classification) ||
      !["NONE", "PENDING", "PARTIALLY_SIGNED", "SIGNED", "DECLINED"].includes(
        signature,
      )
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Commercial document type, classification or signature status is invalid.",
      );
    if (!digest.test(hash) || !Number.isSafeInteger(size) || size < 1)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Document checksum/size is invalid.",
      );
    await tx.query(
      "INSERT INTO document.documents(id,tenant_id,document_code,document_type,classification,resource_type,resource_id,current_version_id,created_by,correlation_id,signature_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        id,
        tx.tenantId,
        code,
        type,
        classification,
        resourceType,
        resourceId,
        versionId,
        input.actorId,
        input.correlationId,
        signature,
      ],
    );
    await tx.query(
      "INSERT INTO document.document_versions(id,tenant_id,document_id,version_number,storage_ref,content_hash,content_type,size_bytes,governance_status,signature_status,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,'DRAFT',$8,$9)",
      [
        versionId,
        tx.tenantId,
        id,
        storage,
        hash,
        contentType,
        size,
        signature,
        input.actorId,
      ],
    );
    await tx.query(
      "INSERT INTO document.document_links(tenant_id,document_id,resource_type,resource_id,relation) VALUES($1,$2,$3,$4,'EVIDENCE') ON CONFLICT DO NOTHING",
      [tx.tenantId, id, resourceType, resourceId],
    );
    row = {
      id,
      tenant_id: tx.tenantId,
      document_code: code,
      document_type: type,
      governance_status: "DRAFT",
      signature_status: signature,
      current_version_id: versionId,
      version: 1,
      resource_type: resourceType,
      resource_id: resourceId,
    };
    event = "COMMERCIAL_DOCUMENT.ADDED";
  } else {
    if (!input.id)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "document id is required.",
      );
    const r = await tx.query(
      "SELECT * FROM document.documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [tx.tenantId, input.id],
    );
    if (!r.rowCount)
      throw new ApplicationError(
        "NOT_FOUND",
        "Commercial document was not found.",
      );
    row = r.rows[0] as Record<string, unknown>;
    assertVersion(Number(row.version), input.expectedVersion!);
    if (command === "DOCUMENT.ADD_VERSION") {
      const current = await tx.query(
        "SELECT * FROM document.document_versions WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, row.current_version_id],
      );
      if (current.rows[0]?.governance_status === "FINAL")
        fail(
          "Final content cannot be overwritten; create a new document identity for successor evidence.",
        );
      const versionId = randomUUID(),
        storage = required(body.storage_ref, "storage_ref"),
        hash = required(body.content_hash, "content_hash", 64).toLowerCase(),
        contentType = required(body.content_type, "content_type", 256),
        size = Number(body.size_bytes);
      if (!digest.test(hash) || !Number.isSafeInteger(size) || size < 1)
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Document checksum/size is invalid.",
        );
      await tx.query(
        "INSERT INTO document.document_versions(id,tenant_id,document_id,version_number,storage_ref,content_hash,content_type,size_bytes,governance_status,signature_status,created_by) VALUES($1,$2,$3,(SELECT COALESCE(max(version_number),0)+1 FROM document.document_versions WHERE tenant_id=$2 AND document_id=$3),$4,$5,$6,$7,'DRAFT',$8,$9)",
        [
          versionId,
          tx.tenantId,
          row.id,
          storage,
          hash,
          contentType,
          size,
          String(body.signature_status ?? row.signature_status),
          input.actorId,
        ],
      );
      await tx.query(
        "UPDATE document.document_versions SET governance_status='SUPERSEDED' WHERE tenant_id=$1 AND id=$2 AND governance_status='DRAFT'",
        [tx.tenantId, row.current_version_id],
      );
      await tx.query(
        "UPDATE document.documents SET current_version_id=$3,governance_status='DRAFT',signature_status=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [
          tx.tenantId,
          row.id,
          versionId,
          String(body.signature_status ?? row.signature_status),
        ],
      );
      row = {
        ...row,
        current_version_id: versionId,
        version: Number(row.version) + 1,
        governance_status: "DRAFT",
      };
      event = "COMMERCIAL_DOCUMENT.ADDED";
    } else if (command === "DOCUMENT.FINALIZE") {
      const v = await tx.query(
        "SELECT * FROM document.document_versions WHERE tenant_id=$1 AND document_id=$2 AND id=$3 FOR UPDATE",
        [tx.tenantId, row.id, row.current_version_id],
      );
      if (!v.rowCount)
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "Current document version is missing.",
        );
      const version = v.rows[0]!,
        observed = input.verifiedObject;
      if (!observed)
        throw new ApplicationError(
          "DEPENDENCY_UNAVAILABLE",
          "Stored object metadata could not be verified.",
          true,
        );
      if (
        observed.key !== String(version.storage_ref) ||
        observed.checksum.toLowerCase() !== String(version.content_hash) ||
        observed.content_type !== version.content_type ||
        observed.size_bytes !== Number(version.size_bytes)
      )
        throw new ApplicationError(
          "COMMERCIAL_DOCUMENT_INTEGRITY_CONFLICT",
          "Stored object metadata does not match the declared immutable document metadata.",
        );
      if (version.governance_status !== "DRAFT")
        fail("Only a DRAFT document version may be finalized.");
      await tx.query(
        "UPDATE document.document_versions SET governance_status='FINAL',finalized_by=$3,finalized_at=now() WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, version.id, input.actorId],
      );
      await tx.query(
        "UPDATE document.documents SET governance_status='FINAL',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, row.id],
      );
      row = {
        ...row,
        governance_status: "FINAL",
        version: Number(row.version) + 1,
      };
      event = "COMMERCIAL_DOCUMENT.FINALIZED";
    } else if (command === "DOCUMENT.SUPERSEDE") {
      if (row.governance_status !== "FINAL")
        fail("Only FINAL commercial documents may be superseded.");
      const successor = required(
        body.successor_document_id,
        "successor_document_id",
      );
      const exists = await tx.query(
        "SELECT id,document_type,resource_type,resource_id FROM document.documents WHERE tenant_id=$1 AND id=$2 AND governance_status='FINAL'",
        [tx.tenantId, successor],
      );
      if (!exists.rowCount)
        fail("Replacement document must be FINAL in the same tenant.");
      const replacement = exists.rows[0]!;
      if (
        String(replacement.document_type) !== String(row.document_type) ||
        String(replacement.resource_type) !== String(row.resource_type) ||
        String(replacement.resource_id) !== String(row.resource_id)
      )
        fail(
          "Replacement document must describe the same commercial evidence and resource.",
        );
      await tx.query(
        "UPDATE document.document_versions SET governance_status='SUPERSEDED' WHERE tenant_id=$1 AND document_id=$2 AND id=$3 AND governance_status='FINAL'",
        [tx.tenantId, row.id, row.current_version_id],
      );
      await tx.query(
        "UPDATE document.documents SET governance_status='SUPERSEDED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, row.id],
      );
      await tx.query(
        "INSERT INTO document.document_relationships(tenant_id,predecessor_document_id,successor_document_id,relationship,created_by) VALUES($1,$2,$3,'SUPERSEDED_BY',$4)",
        [tx.tenantId, row.id, successor, input.actorId],
      );
      row = {
        ...row,
        governance_status: "SUPERSEDED",
        superseded_by_document_id: successor,
        version: Number(row.version) + 1,
      };
      event = "COMMERCIAL_DOCUMENT.SUPERSEDED";
    } else {
      if (
        row.governance_status !== "DRAFT" ||
        row.signature_status === "SIGNED"
      )
        fail("Signed or finalized commercial evidence cannot be voided.");
      await tx.query(
        "UPDATE document.document_versions SET governance_status='VOID' WHERE tenant_id=$1 AND document_id=$2 AND id=$3 AND governance_status='DRAFT'",
        [tx.tenantId, row.id, row.current_version_id],
      );
      await tx.query(
        "UPDATE document.documents SET governance_status='VOID',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, row.id],
      );
      row = {
        ...row,
        governance_status: "VOID",
        version: Number(row.version) + 1,
      };
      event = "COMMERCIAL_DOCUMENT.VOIDED";
    }
  }
  return {
    data: row,
    status: command === "DOCUMENT.CREATE" ? 201 : 200,
    event,
  };
}
export async function readCommercialDocument(tx: Transaction, id: string) {
  const r = await tx.query(
    "SELECT d.*,v.storage_ref,v.content_hash,v.content_type,v.size_bytes,v.id AS version_id,v.version_number FROM document.documents d JOIN document.document_versions v ON v.tenant_id=d.tenant_id AND v.id=d.current_version_id WHERE d.tenant_id=$1 AND d.id=$2",
    [tx.tenantId, id],
  );
  return r.rows[0] ?? null;
}
export async function isFinalSignedDocument(
  tx: Transaction,
  id: string,
  versionId: string,
  contractId: string,
) {
  const r = await tx.query(
    "SELECT 1 FROM document.documents d JOIN document.document_versions v ON v.tenant_id=d.tenant_id AND v.document_id=d.id JOIN document.document_links l ON l.tenant_id=d.tenant_id AND l.document_id=d.id WHERE d.tenant_id=$1 AND d.id=$2 AND v.id=$3 AND v.governance_status='FINAL' AND v.signature_status='SIGNED' AND l.resource_type='CONTRACT' AND l.resource_id=$4",
    [tx.tenantId, id, versionId, contractId],
  );
  return !!r.rowCount;
}
