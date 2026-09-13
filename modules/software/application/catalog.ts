import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

const restrictiveClassifications = [
  "UNKNOWN",
  "RESTRICTED",
  "PROHIBITED",
  "DEPRECATED",
  "RETIRED",
] as const;

function requiredText(value: string, field: string, max = 256) {
  if (!value.trim() || value.length > max)
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}

function stringList(value: string[], field: string) {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 128,
    )
  )
    throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return [...new Set(value.map((item) => item.trim()))];
}

/** Minimal tenant-scoped product reference for other domains' query ports. */
export async function readSoftwareProductReference(
  tx: Transaction,
  productId: string,
) {
  const result = await tx.query<{
    id: string;
    tenant_id: string;
    classification: string;
    visibility: string;
  }>(
    `SELECT id,tenant_id,classification,visibility FROM software.software_products
      WHERE tenant_id=$1 AND id=$2`,
    [tx.tenantId, productId],
  );
  const row = result.rows[0];
  return row
    ? {
        ...row,
        active: !["PROHIBITED", "DEPRECATED", "RETIRED"].includes(
          row.classification,
        ),
      }
    : null;
}

export async function createSoftwareProduct(input: {
  tx: Transaction;
  productCode: string;
  name: string;
  vendor: string;
  category: string;
  ownerId: string;
  supportTeam: string;
  supportedOs: string[];
  supportedAssetClasses: string[];
  visibility: "END_USER" | "IT_ONLY" | "HIDDEN";
  licenseRequired: boolean;
}) {
  const productCode = requiredText(input.productCode, "product_code", 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(productCode))
    throw new ApplicationError("VALIDATION_ERROR", "product_code is invalid.");
  if (!["END_USER", "IT_ONLY", "HIDDEN"].includes(input.visibility))
    throw new ApplicationError("VALIDATION_ERROR", "visibility is invalid.");
  if (input.visibility === "END_USER")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Software must be approved and published before it is visible to end users.",
    );
  const id = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO software.software_products(id,tenant_id,product_code,name,vendor,category,owner_id,support_team,supported_os,supported_asset_classes,visibility,license_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        id,
        input.tx.tenantId,
        productCode,
        requiredText(input.name, "name"),
        requiredText(input.vendor, "vendor"),
        requiredText(input.category, "category"),
        requiredText(input.ownerId, "owner_id"),
        requiredText(input.supportTeam, "support_team"),
        stringList(input.supportedOs, "supported_os"),
        stringList(input.supportedAssetClasses, "supported_asset_classes"),
        input.visibility,
        input.licenseRequired,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "VERSION_CONFLICT",
        "A software product with this product_code already exists.",
      );
    throw error;
  }
  return {
    id,
    product_code: productCode,
    classification: "UNKNOWN",
    version: 1,
  };
}

export async function createSoftwareVersion(input: {
  tx: Transaction;
  productId: string;
  versionLabel: string;
  releaseNotes: string;
}) {
  const product = await input.tx.query(
    "SELECT id,classification FROM software.software_products WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.productId],
  );
  if (!product.rowCount)
    throw new ApplicationError("NOT_FOUND", "Software product was not found.");
  if (
    ["PROHIBITED", "RETIRED"].includes(String(product.rows[0]!.classification))
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Versions cannot be added to prohibited or retired software.",
    );
  const versionLabel = requiredText(input.versionLabel, "version", 128);
  const id = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO software.software_versions(id,tenant_id,product_id,version_label,release_notes) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        input.tx.tenantId,
        input.productId,
        versionLabel,
        input.releaseNotes.trim(),
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "VERSION_CONFLICT",
        "This software version already exists.",
      );
    throw error;
  }
  return {
    id,
    product_id: input.productId,
    version: versionLabel,
    state: "DRAFT",
    row_version: 1,
  };
}

export async function assertVersionAcceptsArtifact(input: {
  tx: Transaction;
  softwareVersionId: string;
}) {
  const result = await input.tx.query(
    "SELECT v.state,p.classification FROM software.software_versions v JOIN software.software_products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id WHERE v.tenant_id=$1 AND v.id=$2",
    [input.tx.tenantId, input.softwareVersionId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Software version was not found.");
  if (
    result.rows[0]!.state !== "DRAFT" ||
    ["PROHIBITED", "RETIRED"].includes(String(result.rows[0]!.classification))
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Artifact intake is only allowed for an eligible draft software version.",
    );
}

export async function changeSoftwareClassification(input: {
  tx: Transaction;
  productId: string;
  expectedVersion: number;
  classification: (typeof restrictiveClassifications)[number];
  reason: string;
}) {
  if (!restrictiveClassifications.includes(input.classification))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "APPROVED classification is established only by publishing an approved artifact.",
    );
  const row = await input.tx.query(
    "SELECT id,classification,version FROM software.software_products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.productId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Software product was not found.");
  const product = row.rows[0]!;
  assertVersion(Number(product.version), input.expectedVersion);
  const transitions: Record<string, readonly string[]> = {
    UNKNOWN: ["RESTRICTED", "PROHIBITED", "RETIRED"],
    APPROVED: ["RESTRICTED", "PROHIBITED", "DEPRECATED", "RETIRED"],
    RESTRICTED: ["PROHIBITED", "RETIRED"],
    PROHIBITED: ["RETIRED"],
    DEPRECATED: ["RETIRED"],
    RETIRED: [],
  };
  const reason = requiredText(input.reason, "reason", 2000);
  if (
    !transitions[String(product.classification)]?.includes(input.classification)
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid software classification transition.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE software.software_products SET classification=$1,visibility=CASE WHEN visibility='END_USER' THEN 'IT_ONLY' ELSE visibility END,self_service_allowed=false,version=$2,updated_at=now() WHERE tenant_id=$3 AND id=$4",
    [input.classification, version, input.tx.tenantId, input.productId],
  );
  return {
    id: input.productId,
    from_classification: String(product.classification),
    classification: input.classification,
    reason,
    version,
  };
}

export async function updateSoftwareVisibility(input: {
  tx: Transaction;
  productId: string;
  expectedVersion: number;
  visibility: "END_USER" | "IT_ONLY" | "HIDDEN";
  selfServiceAllowed: boolean;
  reason: string;
}) {
  const row = await input.tx.query(
    "SELECT id,classification,published_version_id,visibility,self_service_allowed,version FROM software.software_products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.productId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Software product was not found.");
  const product = row.rows[0]!;
  assertVersion(Number(product.version), input.expectedVersion);
  const reason = requiredText(input.reason, "reason", 2000);
  const approvedAndPublished =
    product.classification === "APPROVED" && !!product.published_version_id;
  if (
    !["END_USER", "IT_ONLY", "HIDDEN"].includes(input.visibility) ||
    (input.visibility === "END_USER" && !approvedAndPublished) ||
    (input.selfServiceAllowed &&
      (!approvedAndPublished || input.visibility !== "END_USER"))
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "End-user visibility and self-service require an approved, published product.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE software.software_products SET visibility=$1,self_service_allowed=$2,version=$3,updated_at=now() WHERE tenant_id=$4 AND id=$5",
    [
      input.visibility,
      input.selfServiceAllowed,
      version,
      input.tx.tenantId,
      input.productId,
    ],
  );
  return {
    id: input.productId,
    visibility: input.visibility,
    self_service_allowed: input.selfServiceAllowed,
    reason,
    version,
  };
}

export async function publishSoftwareVersion(input: {
  tx: Transaction;
  productId: string;
  softwareVersionId: string;
  artifactVersionId: string;
  expectedVersion: number;
  reason: string;
  assertArtifactPublishable: (input: {
    tx: Transaction;
    artifactVersionId: string;
    softwareVersionId: string;
  }) => Promise<void>;
}) {
  const productResult = await input.tx.query(
    "SELECT id,classification,version FROM software.software_products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.productId],
  );
  if (!productResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Software product was not found.");
  const product = productResult.rows[0]!;
  assertVersion(Number(product.version), input.expectedVersion);
  if (["PROHIBITED", "RETIRED"].includes(String(product.classification)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Prohibited or retired software cannot be published.",
    );
  const versionResult = await input.tx.query(
    "SELECT id,version_label,state,approved_artifact_version_id FROM software.software_versions WHERE tenant_id=$1 AND product_id=$2 AND id=$3 FOR UPDATE",
    [input.tx.tenantId, input.productId, input.softwareVersionId],
  );
  if (!versionResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Software version was not found.");
  const softwareVersion = versionResult.rows[0]!;
  if (softwareVersion.state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a draft software version can be published.",
    );
  await input.assertArtifactPublishable({
    tx: input.tx,
    artifactVersionId: input.artifactVersionId,
    softwareVersionId: input.softwareVersionId,
  });
  const reason = requiredText(input.reason, "reason", 2000);
  const productVersion = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE software.software_versions SET approved_artifact_version_id=$1,state='PUBLISHED',version=version+1,updated_at=now() WHERE tenant_id=$2 AND product_id=$3 AND id=$4",
    [
      input.artifactVersionId,
      input.tx.tenantId,
      input.productId,
      input.softwareVersionId,
    ],
  );
  await input.tx.query(
    "UPDATE software.software_products SET published_version_id=$1,classification='APPROVED',self_service_allowed=false,version=$2,updated_at=now() WHERE tenant_id=$3 AND id=$4",
    [
      input.softwareVersionId,
      productVersion,
      input.tx.tenantId,
      input.productId,
    ],
  );
  return {
    id: input.productId,
    software_version_id: input.softwareVersionId,
    version_label: String(softwareVersion.version_label),
    artifact_version_id: input.artifactVersionId,
    from_classification: String(product.classification),
    classification: "APPROVED",
    version: productVersion,
    reason,
  };
}

export async function listSoftwareProducts(tx: Transaction) {
  const result = await tx.query(
    "SELECT id,product_code,name,vendor,category,classification,owner_id,support_team,supported_os,supported_asset_classes,visibility,self_service_allowed,license_required,published_version_id,version,created_at,updated_at FROM software.software_products WHERE tenant_id=$1 ORDER BY name,id LIMIT 200",
    [tx.tenantId],
  );
  return result.rows;
}

export async function listSoftwareVersions(tx: Transaction, productId: string) {
  const result = await tx.query(
    "SELECT id,product_id,version_label,release_notes,approved_artifact_version_id,state,version,created_at,updated_at FROM software.software_versions WHERE tenant_id=$1 AND product_id=$2 ORDER BY created_at DESC,id LIMIT 200",
    [tx.tenantId, productId],
  );
  return result.rows;
}

/** Software-owned compensation for Artifact restriction or revocation. */
export async function withdrawPublishedArtifact(input: {
  tx: Transaction;
  artifactVersionId: string;
  reason: string;
}) {
  const versionResult = await input.tx.query(
    "SELECT id,product_id FROM software.software_versions WHERE tenant_id=$1 AND approved_artifact_version_id=$2 FOR UPDATE",
    [input.tx.tenantId, input.artifactVersionId],
  );
  if (!versionResult.rowCount) return null;
  const softwareVersion = versionResult.rows[0]!;
  await input.tx.query(
    "UPDATE software.software_versions SET approved_artifact_version_id=NULL,state='RETIRED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, softwareVersion.id],
  );
  const productResult = await input.tx.query(
    "SELECT id,published_version_id,classification,version FROM software.software_products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, softwareVersion.product_id],
  );
  const product = productResult.rows[0]!;
  const isCurrent = product.published_version_id === softwareVersion.id;
  if (isCurrent)
    await input.tx.query(
      "UPDATE software.software_products SET published_version_id=NULL,classification=CASE WHEN classification='APPROVED' THEN 'RESTRICTED' ELSE classification END,visibility=CASE WHEN visibility='END_USER' THEN 'IT_ONLY' ELSE visibility END,self_service_allowed=false,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [input.tx.tenantId, product.id],
    );
  return {
    product_id: String(product.id),
    software_version_id: String(softwareVersion.id),
    artifact_version_id: input.artifactVersionId,
    classification:
      isCurrent && product.classification === "APPROVED"
        ? "RESTRICTED"
        : String(product.classification),
    version: Number(product.version) + (isCurrent ? 1 : 0),
    reason: input.reason,
  };
}
