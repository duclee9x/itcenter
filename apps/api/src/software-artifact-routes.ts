import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import {
  ApplicationError,
  errorResponse,
} from "../../../packages/api-contracts/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  assertArtifactPublishable,
  activateArtifact,
  createArtifactIntake,
  getArtifactScanTarget,
  readArtifact,
  recordArtifactScan,
  restrictArtifact,
  reviewArtifact,
  revokeArtifact,
  unavailableArtifactStorage,
  type ArtifactObjectStoragePort,
  type MalwareScannerPort,
  type PublisherSignaturePort,
} from "../../../modules/artifact/index.js";
import {
  assertVersionAcceptsArtifact as assertSoftwareVersionAcceptsArtifact,
  changeSoftwareClassification,
  createSoftwareProduct,
  createSoftwareVersion,
  listSoftwareProducts,
  listSoftwareVersions,
  publishSoftwareVersion,
  updateSoftwareVisibility,
  withdrawPublishedArtifact,
} from "../../../modules/software/index.js";
import { json } from "../../../packages/observability/src/index.js";

export interface SoftwareArtifactAdapters {
  storage?: ArtifactObjectStoragePort;
  scanner?: MalwareScannerPort;
  signatureVerifier?: PublisherSignaturePort;
}

type EventFact = { type: string; payload: Record<string, unknown> };

async function parseBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 65536)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
    chunks.push(part);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError("VALIDATION_ERROR", "JSON object is required.");
  return value as Record<string, unknown>;
}

function string(
  input: Record<string, unknown>,
  field: string,
  fallback?: string,
) {
  const value = input[field];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string")
    throw new ApplicationError("VALIDATION_ERROR", `${field} must be text.`);
  return value;
}

function integer(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (!Number.isSafeInteger(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be an integer.`,
    );
  return value as number;
}

function boolean(
  input: Record<string, unknown>,
  field: string,
  fallback = false,
) {
  const value = input[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new ApplicationError("VALIDATION_ERROR", `${field} must be boolean.`);
  return value;
}

function stringArray(input: Record<string, unknown>, field: string) {
  const value = input[field] ?? [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be a string array.`,
    );
  return value as string[];
}

function assertOnlyFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
) {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request contains unsupported fields.",
    );
}

async function authorizeRequest(
  authorization: AuthorizationPort,
  principal: Awaited<ReturnType<typeof authenticate>>,
  action: string,
  resourceType: string,
  id: string,
  context: CorrelationContext,
  highRisk = false,
) {
  await authorize(authorization, {
    principal,
    action,
    resource: { type: resourceType, id, tenant_id: principal.tenant_id },
    scope: {},
    context: { ...context, ...(highRisk ? { high_risk: true } : {}) },
  });
}

async function appendMutation(input: {
  tx: Transaction;
  config: Config;
  principal: { id: string; actor_type: string; tenant_id: string };
  context: CorrelationContext;
  idempotencyKey: string;
  operation: string;
  aggregateType: "SOFTWARE_PRODUCT" | "SOFTWARE_VERSION" | "ARTIFACT_VERSION";
  aggregateId: string;
  version: number;
  facts: EventFact[];
  reason: string;
  before: unknown;
  after: unknown;
  classification?: "INTERNAL" | "SECURITY";
  outcome?: "SUCCESS" | "FAILURE";
}) {
  const now = new Date().toISOString();
  for (const [index, fact] of input.facts.entries())
    await new PostgresOutboxWriter(input.tx).append({
      event_id: randomUUID(),
      event_type: fact.type,
      schema_version: 1,
      occurred_at: now,
      producer: { service: input.config.serviceName, instance: "api" },
      aggregate: {
        type: input.aggregateType,
        id: input.aggregateId,
        version: input.version,
      },
      actor: { type: input.principal.actor_type, id: input.principal.id },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      tenant_id: input.principal.tenant_id,
      organization_id: input.principal.tenant_id,
      idempotency_key: `${input.idempotencyKey}:${index}`,
      payload: fact.payload as never,
    });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.facts[0]!.type,
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.operation },
    subject: { entity_type: input.aggregateType, entity_id: input.aggregateId },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.operation, text: input.reason },
    before: input.before as never,
    after: input.after as never,
    outcome: { status: input.outcome ?? "SUCCESS" },
    classification: input.classification ?? "INTERNAL",
    relations: [],
    evidence: [],
  });
}

async function executeWrite(input: {
  uow: UnitOfWork;
  tenantId: string;
  principalId: string;
  operation: string;
  businessScope: string;
  key: string;
  semanticRequest: Record<string, unknown>;
  work: (tx: Transaction) => Promise<{ status: number; body: unknown }>;
}) {
  return input.uow.run(input.tenantId, (tx) =>
    new PostgresIdempotencyStore(tx).execute(
      {
        principalId: input.principalId,
        operation: input.operation,
        businessScope: input.businessScope,
        key: input.key,
        semanticRequest: input.semanticRequest as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        const result = await input.work(tx);
        return { status: result.status, body: result.body as never };
      },
    ),
  );
}

function sendResult(
  res: ServerResponse,
  result: { status: number; body: unknown },
  context: CorrelationContext,
) {
  if (
    result.body &&
    typeof result.body === "object" &&
    "error" in result.body
  ) {
    json(res, result.status, result.body);
    return;
  }
  json(res, result.status, { data: result.body, meta: context });
}

function failure(error: ApplicationError, context: CorrelationContext) {
  const mapped = errorResponse(error, context);
  return { status: mapped.status, body: mapped.body };
}

export async function handleSoftwareArtifactRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
  adapters?: SoftwareArtifactAdapters;
}): Promise<boolean> {
  const { req, res, context, config, authentication, authorization, uow } =
    input;
  const method = req.method ?? "";
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const productsPath = path === "/api/v1/software/products";
  const versionsPath =
    /^\/api\/v1\/software\/products\/([^/]+)\/versions$/.exec(path);
  const classificationPath =
    /^\/api\/v1\/software\/products\/([^/]+)\/commands\/classification$/.exec(
      path,
    );
  const visibilityPath =
    /^\/api\/v1\/software\/products\/([^/]+)\/commands\/visibility$/.exec(path);
  const publishPath =
    /^\/api\/v1\/software\/products\/([^/]+)\/versions\/([^/]+)\/commands\/publish$/.exec(
      path,
    );
  const artifactsPath = path === "/api/v1/artifacts";
  const artifactReadPath = /^\/api\/v1\/artifacts\/([^/]+)$/.exec(path);
  const artifactCommandPath =
    /^\/api\/v1\/artifacts\/([^/]+)\/commands\/(scan|review|activate|restrict|revoke)$/.exec(
      path,
    );
  const isRead =
    method === "GET" && (productsPath || versionsPath || artifactReadPath);
  const isWrite =
    method === "POST" &&
    (productsPath ||
      versionsPath ||
      classificationPath ||
      visibilityPath ||
      publishPath ||
      artifactsPath ||
      artifactCommandPath);
  if (!isRead && !isWrite) return false;

  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  if (isRead) {
    const isArtifact = !!artifactReadPath;
    const productList = productsPath;
    const productVersions = !!versionsPath;
    await authorizeRequest(
      authorization,
      principal,
      isArtifact ? "artifact.read" : "software.read",
      isArtifact ? "artifact_version" : "software_product",
      isArtifact
        ? artifactReadPath![1]!
        : productVersions
          ? versionsPath![1]!
          : "catalog",
      context,
    );
    const body = await uow.run(principal.tenant_id, async (tx) => {
      if (isArtifact) return readArtifact(tx, artifactReadPath![1]!);
      if (productVersions) return listSoftwareVersions(tx, versionsPath![1]!);
      if (productList) return listSoftwareProducts(tx);
      return [];
    });
    json(res, 200, { data: body, meta: context });
    return true;
  }

  const artifactAction = artifactCommandPath?.[2];
  const action = artifactsPath
    ? "artifact.upload"
    : artifactAction === "scan"
      ? "artifact.scan.review"
      : artifactAction === "review"
        ? "artifact.approve"
        : artifactAction === "revoke" || artifactAction === "restrict"
          ? "artifact.revoke"
          : artifactAction === "activate"
            ? "artifact.approve"
            : "software.catalog.manage";
  const resourceType =
    artifactsPath || artifactCommandPath
      ? "artifact_version"
      : "software_product";
  const resourceId = artifactsPath
    ? "new"
    : (artifactCommandPath?.[1] ??
      publishPath?.[1] ??
      classificationPath?.[1] ??
      visibilityPath?.[1] ??
      versionsPath?.[1] ??
      "new");
  await authorizeRequest(
    authorization,
    principal,
    action,
    resourceType,
    resourceId,
    context,
    action === "artifact.approve" || action === "artifact.revoke",
  );
  const keyHeader = req.headers["idempotency-key"];
  if (typeof keyHeader !== "string" || !keyHeader.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  const body = await parseBody(req);
  const allowedFields = productsPath
    ? [
        "product_code",
        "name",
        "vendor",
        "category",
        "owner_id",
        "support_team",
        "supported_os",
        "supported_asset_classes",
        "visibility",
        "license_required",
      ]
    : versionsPath
      ? ["version", "release_notes"]
      : classificationPath
        ? ["expected_version", "classification", "reason"]
        : visibilityPath
          ? ["expected_version", "visibility", "self_service_allowed", "reason"]
          : publishPath
            ? ["expected_version", "artifact_version_id", "reason"]
            : artifactsPath
              ? [
                  "software_version_id",
                  "filename",
                  "media_type",
                  "size_bytes",
                  "source_type",
                  "checksum_sha256",
                  "storage_ref",
                ]
              : artifactAction === "scan"
                ? ["expected_version"]
                : artifactAction === "review"
                  ? ["expected_version", "decision", "reason", "expires_at"]
                  : ["expected_version", "reason"];
  assertOnlyFields(body, allowedFields);
  const operation = artifactsPath
    ? "ARTIFACT.INTAKE"
    : artifactCommandPath
      ? `ARTIFACT.${artifactAction!.replaceAll("-", "_").toUpperCase()}`
      : publishPath
        ? "SOFTWARE.CATALOG.PUBLISH_VERSION"
        : classificationPath
          ? "SOFTWARE.CATALOG.CHANGE_CLASSIFICATION"
          : visibilityPath
            ? "SOFTWARE.CATALOG.CHANGE_VISIBILITY"
            : versionsPath
              ? "SOFTWARE.CATALOG.CREATE_VERSION"
              : "SOFTWARE.CATALOG.CREATE_PRODUCT";
  const scope = artifactsPath
    ? String(body.software_version_id ?? "new")
    : (artifactCommandPath?.[1] ??
      publishPath?.[1] ??
      classificationPath?.[1] ??
      visibilityPath?.[1] ??
      versionsPath?.[1] ??
      String(body.product_code ?? "new"));

  if (artifactAction === "scan") {
    const previous = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).findPrevious({
        principalId: principal.id,
        operation,
        businessScope: scope,
        key: keyHeader,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      }),
    );
    if (previous) {
      sendResult(res, previous, context);
      return true;
    }
  }

  if (artifactsPath) {
    const storageRef = string(body, "storage_ref");
    const checksum = string(body, "checksum_sha256").toLowerCase();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(storageRef) ||
      storageRef.split("/").includes("..")
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "storage_ref must be an opaque object reference.",
      );
    if (!/^[a-f0-9]{64}$/.test(checksum))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "checksum_sha256 must be SHA-256.",
      );
    const storage = input.adapters?.storage ?? unavailableArtifactStorage;
    const stored = await storage.inspect(
      storageRef,
      AbortSignal.timeout(10000),
    );
    if (!stored)
      throw new ApplicationError(
        "NOT_FOUND",
        "Artifact object was not found in storage.",
      );
    if (
      stored.checksumSha256.toLowerCase() !== checksum ||
      stored.sizeBytes !== integer(body, "size_bytes") ||
      stored.mediaType !== string(body, "media_type")
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Artifact metadata does not match the stored object.",
      );
  }

  let externalScan:
    | {
        scannerResult: Awaited<ReturnType<MalwareScannerPort["scan"]>>;
        signatureResult?: Awaited<ReturnType<PublisherSignaturePort["verify"]>>;
      }
    | undefined;
  if (artifactAction === "scan") {
    const target = await uow.run(principal.tenant_id, (tx) =>
      getArtifactScanTarget(tx, artifactCommandPath![1]!),
    );
    const expectedVersion = integer(body, "expected_version");
    assertVersionForExternalScan(Number(target.version), expectedVersion);
    const storage = input.adapters?.storage ?? unavailableArtifactStorage;
    const stored = await storage.inspect(
      String(target.storage_ref),
      AbortSignal.timeout(10000),
    );
    if (
      !stored ||
      stored.checksumSha256.toLowerCase() !== String(target.checksum_sha256) ||
      stored.sizeBytes !== Number(target.size_bytes) ||
      stored.mediaType !== String(target.media_type)
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Stored artifact no longer matches its immutable checksum.",
      );
    const scanner = input.adapters?.scanner;
    if (!scanner)
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Malware scanner is not configured.",
        true,
      );
    const timeout = AbortSignal.timeout(30000);
    const scannerResult = await scanner.scan({
      storageRef: String(target.storage_ref),
      checksumSha256: String(target.checksum_sha256),
      signal: timeout,
    });
    const signatureResult = input.adapters?.signatureVerifier
      ? await input.adapters.signatureVerifier.verify({
          storageRef: String(target.storage_ref),
          checksumSha256: String(target.checksum_sha256),
          signal: timeout,
        })
      : undefined;
    externalScan = {
      scannerResult,
      ...(signatureResult ? { signatureResult } : {}),
    };
  }

  const semanticRequest = body;
  const result = await executeWrite({
    uow,
    tenantId: principal.tenant_id,
    principalId: principal.id,
    operation,
    businessScope: scope,
    key: keyHeader,
    semanticRequest,
    work: async (tx) => {
      if (productsPath) {
        const product = await createSoftwareProduct({
          tx,
          productCode: string(body, "product_code"),
          name: string(body, "name"),
          vendor: string(body, "vendor"),
          category: string(body, "category"),
          ownerId: string(body, "owner_id"),
          supportTeam: string(body, "support_team"),
          supportedOs: stringArray(body, "supported_os"),
          supportedAssetClasses: stringArray(body, "supported_asset_classes"),
          visibility: string(body, "visibility", "IT_ONLY") as
            "END_USER" | "IT_ONLY" | "HIDDEN",
          licenseRequired: boolean(body, "license_required"),
        });
        await appendMutation({
          tx,
          config,
          principal,
          context,
          idempotencyKey: keyHeader,
          operation,
          aggregateType: "SOFTWARE_PRODUCT",
          aggregateId: product.id,
          version: 1,
          facts: [
            {
              type: "SOFTWARE.CATALOG_ITEM_CREATED",
              payload: {
                software_product_id: product.id,
                product_code: product.product_code,
                classification: product.classification,
                visibility: string(body, "visibility", "IT_ONLY"),
                self_service_allowed: false,
              },
            },
          ],
          reason: "Software catalog item created",
          before: null,
          after: product,
        });
        return { status: 201, body: product };
      }
      if (versionsPath) {
        const version = await createSoftwareVersion({
          tx,
          productId: versionsPath[1]!,
          versionLabel: string(body, "version"),
          releaseNotes: string(body, "release_notes", ""),
        });
        await appendMutation({
          tx,
          config,
          principal,
          context,
          idempotencyKey: keyHeader,
          operation,
          aggregateType: "SOFTWARE_VERSION",
          aggregateId: version.id,
          version: 1,
          facts: [
            {
              type: "SOFTWARE.VERSION_CREATED",
              payload: {
                software_product_id: versionsPath[1]!,
                software_version_id: version.id,
                version: version.version,
              },
            },
          ],
          reason: "Software version created",
          before: null,
          after: version,
        });
        return { status: 201, body: version };
      }
      if (classificationPath) {
        const changed = await changeSoftwareClassification({
          tx,
          productId: classificationPath[1]!,
          expectedVersion: integer(body, "expected_version"),
          classification: string(body, "classification") as
            "UNKNOWN" | "RESTRICTED" | "PROHIBITED" | "DEPRECATED" | "RETIRED",
          reason: string(body, "reason"),
        });
        await appendMutation({
          tx,
          config,
          principal,
          context,
          idempotencyKey: keyHeader,
          operation,
          aggregateType: "SOFTWARE_PRODUCT",
          aggregateId: changed.id,
          version: changed.version,
          facts: [
            {
              type: "SOFTWARE.CLASSIFICATION_CHANGED",
              payload: {
                software_product_id: changed.id,
                from_classification: changed.from_classification,
                classification: changed.classification,
                self_service_allowed: false,
                reason: changed.reason,
              },
            },
          ],
          reason: changed.reason,
          before: {
            classification: changed.from_classification,
            version: changed.version - 1,
          },
          after: changed,
        });
        return { status: 200, body: changed };
      }
      if (visibilityPath) {
        const changed = await updateSoftwareVisibility({
          tx,
          productId: visibilityPath[1]!,
          expectedVersion: integer(body, "expected_version"),
          visibility: string(body, "visibility") as
            "END_USER" | "IT_ONLY" | "HIDDEN",
          selfServiceAllowed: boolean(body, "self_service_allowed"),
          reason: string(body, "reason"),
        });
        await appendMutation({
          tx,
          config,
          principal,
          context,
          idempotencyKey: keyHeader,
          operation,
          aggregateType: "SOFTWARE_PRODUCT",
          aggregateId: changed.id,
          version: changed.version,
          facts: [
            {
              type: "SOFTWARE.CATALOG_VISIBILITY_CHANGED",
              payload: {
                software_product_id: changed.id,
                visibility: changed.visibility,
                self_service_allowed: changed.self_service_allowed,
                reason: changed.reason,
              },
            },
          ],
          reason: changed.reason,
          before: { version: changed.version - 1 },
          after: changed,
        });
        return { status: 200, body: changed };
      }
      if (publishPath) {
        const published = await publishSoftwareVersion({
          tx,
          productId: publishPath[1]!,
          softwareVersionId: publishPath[2]!,
          artifactVersionId: string(body, "artifact_version_id"),
          expectedVersion: integer(body, "expected_version"),
          reason: string(body, "reason"),
          assertArtifactPublishable,
        });
        await appendMutation({
          tx,
          config,
          principal,
          context,
          idempotencyKey: keyHeader,
          operation,
          aggregateType: "SOFTWARE_PRODUCT",
          aggregateId: published.id,
          version: published.version,
          facts: [
            {
              type: "SOFTWARE.CATALOG_VERSION_PUBLISHED",
              payload: {
                software_product_id: published.id,
                software_version_id: published.software_version_id,
                artifact_version_id: published.artifact_version_id,
                approved_by: principal.id,
              },
            },
          ],
          reason: published.reason,
          before: {
            classification: published.from_classification,
            version: published.version - 1,
          },
          after: published,
        });
        return { status: 200, body: published };
      }
      if (artifactsPath) {
        const intake = await createArtifactIntake({
          tx,
          softwareVersionId: string(body, "software_version_id"),
          filename: string(body, "filename"),
          mediaType: string(body, "media_type"),
          sizeBytes: integer(body, "size_bytes"),
          sourceType: string(body, "source_type"),
          checksumSha256: string(body, "checksum_sha256"),
          storageRef: string(body, "storage_ref"),
          uploaderId: principal.id,
          assertSoftwareVersionAcceptsArtifact,
        });
        if (intake.kind === "INTEGRITY_CONFLICT") {
          const event = {
            type: "ARTIFACT.INTEGRITY_MISMATCH",
            payload: {
              artifact_version_id: intake.id,
              expected_checksum: intake.expected_checksum,
              observed_checksum: intake.observed_checksum,
              storage_object_key: intake.storage_ref,
            },
          };
          await appendMutation({
            tx,
            config,
            principal,
            context,
            idempotencyKey: keyHeader,
            operation,
            aggregateType: "ARTIFACT_VERSION",
            aggregateId: intake.id,
            version: intake.version,
            facts: [event],
            reason: "Immutable software version checksum mismatch",
            before: { checksum_sha256: intake.expected_checksum },
            after: { checksum_sha256: intake.observed_checksum },
            classification: "SECURITY",
            outcome: "FAILURE",
          });
          return failure(
            new ApplicationError(
              "VERSION_CONFLICT",
              "This software version already has a different immutable checksum.",
            ),
            context,
          );
        }
        if (intake.kind === "EXISTING") return { status: 200, body: intake };
        await appendMutation({
          tx,
          config,
          principal,
          context,
          idempotencyKey: keyHeader,
          operation,
          aggregateType: "ARTIFACT_VERSION",
          aggregateId: intake.id,
          version: 1,
          facts: [
            {
              type: "ARTIFACT.UPLOADED",
              payload: {
                artifact_version_id: intake.id,
                software_version_id: intake.software_version_id,
                filename: string(body, "filename"),
                checksum_sha256: intake.checksum_sha256,
                source_type: string(body, "source_type"),
              },
            },
          ],
          reason: "Artifact metadata intake",
          before: null,
          after: intake,
        });
        return { status: 201, body: intake };
      }
      const artifactId = artifactCommandPath![1]!;
      const expectedVersion = integer(body, "expected_version");
      if (artifactAction === "scan") {
        const scanned = await recordArtifactScan({
          tx,
          id: artifactId,
          expectedVersion,
          actorId: principal.id,
          scannerResult: externalScan!.scannerResult,
          ...(externalScan!.signatureResult
            ? { signatureResult: externalScan!.signatureResult }
            : {}),
        });
        const scanEvent =
          scanned.scan_status === "PASSED"
            ? {
                type: "ARTIFACT.SCAN_PASSED",
                payload: {
                  artifact_version_id: scanned.id,
                  scan_result_id: scanned.scan_result_id,
                  scanner: scanned.scanner,
                },
              }
            : ["FAILED", "QUARANTINE"].includes(scanned.scan_status)
              ? {
                  type: "ARTIFACT.SCAN_FAILED",
                  payload: {
                    artifact_version_id: scanned.id,
                    scan_result_id: scanned.scan_result_id,
                    severity: scanned.scan_status,
                    reason: scanned.reason,
                  },
                }
              : {
                  type: "ARTIFACT.SCAN_REVIEW_REQUIRED",
                  payload: {
                    artifact_version_id: scanned.id,
                    scan_result_id: scanned.scan_result_id,
                    reason: scanned.reason,
                  },
                };
        const facts: EventFact[] = [scanEvent];
        if (externalScan!.signatureResult)
          facts.push({
            type: "ARTIFACT.SIGNATURE_VALIDATED",
            payload: {
              artifact_version_id: scanned.id,
              signature_status: scanned.signature_status,
              verifier: externalScan!.signatureResult.verifier,
            },
          });
        await appendMutation({
          tx,
          config,
          principal,
          context,
          idempotencyKey: keyHeader,
          operation,
          aggregateType: "ARTIFACT_VERSION",
          aggregateId: scanned.id,
          version: scanned.version,
          facts,
          reason: scanned.reason || "Artifact validation completed",
          before: { version: expectedVersion },
          after: scanned,
        });
        return { status: 200, body: scanned };
      }
      if (artifactAction === "review") {
        const reviewed = await reviewArtifact({
          tx,
          id: artifactId,
          expectedVersion,
          actorId: principal.id,
          decision: string(body, "decision") as "APPROVE" | "WAIVE" | "REJECT",
          reason: string(body, "reason"),
          ...(typeof body.expires_at === "string"
            ? { expiresAt: body.expires_at }
            : {}),
        });
        const event =
          reviewed.decision === "REJECT"
            ? {
                type: "ARTIFACT.REJECTED",
                payload: {
                  artifact_version_id: reviewed.id,
                  rejected_by: principal.id,
                  reason: reviewed.reason,
                },
              }
            : {
                type: "ARTIFACT.APPROVED",
                payload: {
                  artifact_version_id: reviewed.id,
                  approved_by: principal.id,
                  approved_at: new Date().toISOString(),
                },
              };
        await appendMutation({
          tx,
          config,
          principal,
          context,
          idempotencyKey: keyHeader,
          operation,
          aggregateType: "ARTIFACT_VERSION",
          aggregateId: reviewed.id,
          version: reviewed.version,
          facts: [event],
          reason: reviewed.reason,
          before: { state: "REVIEW_REQUIRED", version: expectedVersion },
          after: reviewed,
        });
        return { status: 200, body: reviewed };
      }
      const reason = string(body, "reason");
      const changed =
        artifactAction === "activate"
          ? await activateArtifact({
              tx,
              id: artifactId,
              expectedVersion,
              reason,
            })
          : artifactAction === "restrict"
            ? await restrictArtifact({
                tx,
                id: artifactId,
                expectedVersion,
                reason,
              })
            : await revokeArtifact({
                tx,
                id: artifactId,
                expectedVersion,
                reason,
              });
      const eventType =
        artifactAction === "activate"
          ? "ARTIFACT.ACTIVATED"
          : artifactAction === "restrict"
            ? "ARTIFACT.RESTRICTED"
            : "ARTIFACT.REVOKED";
      const payload =
        artifactAction === "activate"
          ? {
              artifact_version_id: changed.id,
              activated_by: principal.id,
              activated_at: new Date().toISOString(),
            }
          : artifactAction === "restrict"
            ? {
                artifact_version_id: changed.id,
                restricted_by: principal.id,
                reason: changed.reason,
              }
            : {
                artifact_version_id: changed.id,
                reason: changed.reason,
                revoked_by: principal.id,
              };
      await appendMutation({
        tx,
        config,
        principal,
        context,
        idempotencyKey: keyHeader,
        operation,
        aggregateType: "ARTIFACT_VERSION",
        aggregateId: changed.id,
        version: changed.version,
        facts: [{ type: eventType, payload }],
        reason: changed.reason,
        before: { state: changed.from_state, version: expectedVersion },
        after: changed,
        classification: artifactAction === "revoke" ? "SECURITY" : "INTERNAL",
      });
      if (artifactAction === "restrict" || artifactAction === "revoke") {
        const withdrawn = await withdrawPublishedArtifact({
          tx,
          artifactVersionId: changed.id,
          reason: changed.reason,
        });
        if (withdrawn)
          await appendMutation({
            tx,
            config,
            principal,
            context,
            idempotencyKey: `${keyHeader}:catalog-withdrawal`,
            operation: "SOFTWARE.CATALOG.WITHDRAW_REVOKED_ARTIFACT",
            aggregateType: "SOFTWARE_PRODUCT",
            aggregateId: withdrawn.product_id,
            version: withdrawn.version,
            facts: [
              {
                type: "SOFTWARE.CATALOG_VERSION_WITHDRAWN",
                payload: {
                  software_product_id: withdrawn.product_id,
                  software_version_id: withdrawn.software_version_id,
                  artifact_version_id: withdrawn.artifact_version_id,
                  classification: withdrawn.classification,
                  reason: withdrawn.reason,
                },
              },
            ],
            reason: withdrawn.reason,
            before: { published_version_id: withdrawn.software_version_id },
            after: withdrawn,
            classification: "SECURITY",
          });
      }
      return { status: 200, body: changed };
    },
  });
  sendResult(res, result, context);
  return true;
}

function assertVersionForExternalScan(actual: number, expected: number) {
  if (actual !== expected)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Artifact version has changed.",
    );
}
