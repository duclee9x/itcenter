import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
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
import { createApproval } from "../../../modules/control-plane/index.js";
import {
  approveTemporaryException,
  approveUninstallProfile,
  createProductAlias,
  createUninstallProfile,
  ignoreExceptionByPolicy,
  inspectExceptionForReview,
  listSoftwareExceptions,
  listSoftwareInventory,
  markFalsePositive,
  readSoftwareException,
  requestExceptionApproval,
  requestExceptionInvestigation,
  requestExceptionRemoval,
} from "../../../modules/software/index.js";
import {
  createSoftwareExceptionWorkItem,
  resolveSoftwareExceptionWorkItem,
} from "../../../modules/work-queue/index.js";
import { json } from "../../../packages/observability/src/index.js";

function uuid(value: string, field: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return value;
}

async function parseBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 262144)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ApplicationError("VALIDATION_ERROR", "JSON object is required.");
  return parsed as Record<string, unknown>;
}

function only(body: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request contains unsupported fields.",
    );
}

function text(body: Record<string, unknown>, field: string, max = 2000) {
  const value = body[field];
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}

function integer(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be a positive integer.`,
    );
  return Number(value);
}

async function authorizeRequest(input: {
  authorization: AuthorizationPort;
  principal: Awaited<ReturnType<typeof authenticate>>;
  permission: string;
  resourceType: string;
  resourceId: string;
  context: CorrelationContext;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.permission,
    resource: {
      type: input.resourceType,
      id: input.resourceId,
      tenant_id: input.principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
}

async function effects(input: {
  tx: Transaction;
  config: Config;
  context: CorrelationContext;
  principal: { id: string; actor_type: string; tenant_id: string };
  key: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  version: number;
  reason: string;
  before: unknown;
  after: unknown;
}) {
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: input.eventType,
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
    idempotency_key: input.key,
    payload: input.after as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.eventType,
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.eventType },
    subject: { entity_type: input.aggregateType, entity_id: input.aggregateId },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.eventType, text: input.reason },
    before: input.before as never,
    after: input.after as never,
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
}

export async function handleSoftwareComplianceRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}): Promise<boolean> {
  const { req, res, context, config, authentication, authorization, uow } =
    input;
  const method = req.method ?? "";
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const inventoryCollection = path === "/api/v1/software/inventory";
  const exceptionsCollection = path === "/api/v1/software/exceptions";
  const exceptionOne = /^\/api\/v1\/software\/exceptions\/([^/]+)$/.exec(path);
  const productAliases =
    /^\/api\/v1\/software\/products\/([^/]+)\/aliases$/.exec(path);
  const uninstallProfiles =
    /^\/api\/v1\/software\/products\/([^/]+)\/uninstall-profiles$/.exec(path);
  const profileApprove =
    /^\/api\/v1\/software\/uninstall-profiles\/([^/]+)\/commands\/approve$/.exec(
      path,
    );
  const review =
    /^\/api\/v1\/software\/inventory\/([^/]+)\/commands\/review$/.exec(path);
  const command =
    /^\/api\/v1\/software\/exceptions\/([^/]+)\/commands\/(request-approval|approve-temporary|mark-false-positive|investigate|request-removal|ignore-by-policy)$/.exec(
      path,
    );
  const read =
    method === "GET" &&
    (inventoryCollection || exceptionsCollection || !!exceptionOne);
  const write =
    method === "POST" &&
    (!!productAliases ||
      !!uninstallProfiles ||
      !!profileApprove ||
      !!review ||
      !!command);
  if (!read && !write) return false;

  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  const action = read
    ? exceptionOne || exceptionsCollection
      ? "software.exception.read"
      : "software.inventory.read"
    : profileApprove
      ? "software.exception.approve"
      : uninstallProfiles
        ? "software.removal.manage"
        : command?.[2] === "approve-temporary"
          ? "software.exception.approve"
          : command?.[2] === "request-removal"
            ? "software.removal.manage"
            : "software.exception.manage";
  const resourceType =
    exceptionOne || exceptionsCollection || command
      ? "software_exception"
      : profileApprove || uninstallProfiles
        ? "software_uninstall_profile"
        : productAliases
          ? "software_product"
          : "software_inventory";
  const resourceId =
    exceptionOne?.[1] ??
    command?.[1] ??
    productAliases?.[1] ??
    uninstallProfiles?.[1] ??
    profileApprove?.[1] ??
    review?.[1] ??
    "collection";
  await authorizeRequest({
    authorization,
    principal,
    permission: action,
    resourceType,
    resourceId,
    context,
  });
  if (command?.[2] === "request-approval")
    await authorizeRequest({
      authorization,
      principal,
      permission: "approval.create",
      resourceType: "approval",
      resourceId: command[1]!,
      context,
    });

  if (read) {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      if (exceptionOne)
        return await readSoftwareException(
          tx,
          uuid(exceptionOne[1]!, "exception_id"),
        );
      if (exceptionsCollection)
        return await listSoftwareExceptions(
          tx,
          url.searchParams.get("state") ?? undefined,
        );
      const assetId = url.searchParams.get("asset_id");
      const state = url.searchParams.get("state");
      return await listSoftwareInventory(tx, {
        ...(assetId ? { assetId } : {}),
        ...(state ? { state } : {}),
      });
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  const body = await parseBody(req);
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  const targetId = uuid(resourceId, "resource_id");
  const actionName = profileApprove
    ? "SOFTWARE.UNINSTALL_PROFILE_APPROVED"
    : uninstallProfiles
      ? "SOFTWARE.UNINSTALL_PROFILE_CREATED"
      : productAliases
        ? "SOFTWARE.PRODUCT_ALIAS_CREATED"
        : command?.[2] === "request-approval"
          ? "SOFTWARE.EXCEPTION_UPDATED"
          : command?.[2] === "approve-temporary"
            ? "SOFTWARE.EXCEPTION_UPDATED"
            : command?.[2] === "mark-false-positive"
              ? "SOFTWARE.EXCEPTION_UPDATED"
              : command?.[2] === "investigate"
                ? "SOFTWARE.EXCEPTION_UPDATED"
                : review
                  ? "SOFTWARE.UNAUTHORIZED_DETECTED"
                  : command?.[2] === "ignore-by-policy"
                    ? "SOFTWARE.EXCEPTION_UPDATED"
                    : "SOFTWARE.REMOVAL_REQUESTED";
  const operationScope = targetId;
  const result = await uow.run(principal.tenant_id, (tx) =>
    new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: actionName,
        businessScope: operationScope,
        key,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        let value: Record<string, unknown>;
        let aggregateId = targetId;
        let aggregateType = "SOFTWARE_EXCEPTION";
        let eventType = actionName;
        let before: unknown = null;
        let reason = "Software compliance command.";
        if (productAliases) {
          only(body, ["alias", "reason"]);
          reason = text(body, "reason");
          value = (await createProductAlias({
            tx,
            productId: targetId,
            alias: text(body, "alias", 256),
            actorId: principal.id,
            reason,
          })) as Record<string, unknown>;
          aggregateType = "SOFTWARE_PRODUCT";
          aggregateId = targetId;
          eventType = "SOFTWARE.PRODUCT_ALIAS_CREATED";
        } else if (uninstallProfiles) {
          only(body, [
            "symbolic_method",
            "auto_removal_allowed",
            "no_business_dependency_attested",
            "owner_id",
            "reason",
          ]);
          if (
            typeof body.auto_removal_allowed !== "boolean" ||
            typeof body.no_business_dependency_attested !== "boolean"
          )
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "Removal policy flags must be boolean.",
            );
          reason = text(body, "reason");
          value = await createUninstallProfile({
            tx,
            productId: targetId,
            symbolicMethod: text(body, "symbolic_method", 64) as
              "MSI_PRODUCT_CODE" | "PACKAGE_IDENTIFIER" | "MANAGED_PACKAGE",
            autoRemovalAllowed: body.auto_removal_allowed,
            noBusinessDependencyAttested: body.no_business_dependency_attested,
            ownerId: text(body, "owner_id", 256),
            reason,
          });
          aggregateId = String(value.id);
          aggregateType = "SOFTWARE_UNINSTALL_PROFILE";
          eventType = "SOFTWARE.UNINSTALL_PROFILE_CREATED";
        } else if (profileApprove) {
          only(body, ["expected_version", "approval_request_id", "reason"]);
          reason = text(body, "reason");
          value = await approveUninstallProfile({
            tx,
            profileId: targetId,
            expectedVersion: integer(body, "expected_version"),
            approvalRequestId: uuid(
              text(body, "approval_request_id", 64),
              "approval_request_id",
            ),
            reason,
          });
          aggregateType = "SOFTWARE_UNINSTALL_PROFILE";
        } else if (review) {
          only(body, ["reason"]);
          reason = text(body, "reason");
          const detection = await inspectExceptionForReview({
            tx,
            installationId: targetId,
            actorId: principal.id,
          });
          value = detection;
          aggregateId = String(detection.exception_id);
          if (detection.kind === "CREATED" || detection.kind === "REOPENED")
            await createSoftwareExceptionWorkItem({
              tx,
              exceptionId: String(detection.exception_id),
              title: `Review unauthorized software installation`,
              priority: "HIGH",
            });
          aggregateType = "SOFTWARE_EXCEPTION";
          eventType = "SOFTWARE.UNAUTHORIZED_DETECTED";
        } else {
          const exceptionId = targetId;
          const current = (await readSoftwareException(
            tx,
            exceptionId,
          )) as Record<string, unknown>;
          before = { state: current.state, version: current.version };
          const expectedVersion = integer(body, "expected_version");
          reason = text(body, "reason");
          switch (command?.[2]) {
            case "request-approval": {
              only(body, [
                "expected_version",
                "reason",
                "policy_id",
                "policy_version",
              ]);
              const approval = await createApproval({
                tx,
                sourceType: "SOFTWARE_EXCEPTION",
                sourceId: exceptionId,
                policyId: uuid(text(body, "policy_id", 64), "policy_id"),
                policyVersion: integer(body, "policy_version"),
                requesterId: principal.id,
                context: { exception_id: exceptionId, reason },
              });
              const changed = await requestExceptionApproval({
                tx,
                exceptionId,
                expectedVersion,
                actorId: principal.id,
                reason,
                approvalRequestId: approval.id,
              });
              value = { ...changed, approval_request_id: approval.id };
              await effects({
                tx,
                config,
                context,
                principal,
                key: `${key}:approval`,
                eventType: "APPROVAL.CREATED",
                aggregateType: "APPROVAL",
                aggregateId: approval.id,
                version: 1,
                reason,
                before: null,
                after: approval,
              });
              break;
            }
            case "approve-temporary": {
              only(body, [
                "expected_version",
                "reason",
                "approval_request_id",
                "approved_until",
              ]);
              value = await approveTemporaryException({
                tx,
                exceptionId,
                expectedVersion,
                actorId: principal.id,
                reason,
                approvalRequestId: uuid(
                  text(body, "approval_request_id", 64),
                  "approval_request_id",
                ),
                approvedUntil: text(body, "approved_until", 64),
              });
              await resolveSoftwareExceptionWorkItem({ tx, exceptionId });
              break;
            }
            case "mark-false-positive": {
              only(body, ["expected_version", "reason", "evidence_reference"]);
              value = await markFalsePositive({
                tx,
                exceptionId,
                expectedVersion,
                actorId: principal.id,
                reason,
                evidenceReference: text(body, "evidence_reference", 512),
              });
              await resolveSoftwareExceptionWorkItem({ tx, exceptionId });
              break;
            }
            case "investigate": {
              only(body, ["expected_version", "reason"]);
              value = await requestExceptionInvestigation({
                tx,
                exceptionId,
                expectedVersion,
                actorId: principal.id,
                reason,
              });
              break;
            }
            case "ignore-by-policy": {
              only(body, ["expected_version", "reason", "policy_reference"]);
              value = await ignoreExceptionByPolicy({
                tx,
                exceptionId,
                expectedVersion,
                actorId: principal.id,
                reason,
                policyReference: text(body, "policy_reference", 256),
              });
              await resolveSoftwareExceptionWorkItem({ tx, exceptionId });
              break;
            }
            case "request-removal": {
              only(body, ["expected_version", "reason"]);
              value = await requestExceptionRemoval({
                tx,
                exceptionId,
                expectedVersion,
                actorId: principal.id,
                reason,
              });
              eventType = "SOFTWARE.REMOVAL_REQUESTED";
              break;
            }
            default:
              throw new ApplicationError(
                "NOT_FOUND",
                "Software command was not found.",
              );
          }
          if (
            command?.[2] === "request-approval" ||
            command?.[2] === "approve-temporary" ||
            command?.[2] === "mark-false-positive" ||
            command?.[2] === "investigate" ||
            command?.[2] === "ignore-by-policy"
          )
            eventType = "SOFTWARE.EXCEPTION_UPDATED";
        }

        let eventPayload: unknown = value;
        if (aggregateType === "SOFTWARE_EXCEPTION") {
          const exception = (await readSoftwareException(
            tx,
            aggregateId,
          )) as Record<string, unknown>;
          if (eventType === "SOFTWARE.UNAUTHORIZED_DETECTED") {
            eventPayload = {
              software_exception_id: aggregateId,
              asset_id: exception.asset_id,
              software_product_id: exception.product_id ?? null,
              detected_version: exception.version_label,
              classification: exception.classification,
              installation_id: exception.installation_id,
            };
          } else if (eventType === "SOFTWARE.REMOVAL_REQUESTED") {
            eventPayload = {
              software_exception_id: aggregateId,
              removal_job_id: value.removal_job_id ?? null,
              state: value.state,
              automatic_dispatch: value.automatic_dispatch,
              version: value.version,
            };
          } else if (eventType === "SOFTWARE.EXCEPTION_UPDATED") {
            eventPayload = {
              software_exception_id: aggregateId,
              state: value.state ?? exception.state,
              version: value.version ?? exception.version,
              reason: value.reason ?? reason,
              approval_request_id:
                value.approval_request_id ??
                exception.approval_request_id ??
                null,
              approved_until:
                value.approved_until ?? exception.approved_until ?? null,
            };
          }
        } else if (aggregateType === "SOFTWARE_UNINSTALL_PROFILE") {
          const profile = await tx.query(
            `SELECT id,product_id,symbolic_method,auto_removal_allowed,
                    approval_request_id,version
               FROM software.uninstall_profiles
              WHERE tenant_id=$1 AND id=$2`,
            [principal.tenant_id, aggregateId],
          );
          const row = profile.rows[0]!;
          eventPayload = {
            uninstall_profile_id: String(row.id),
            software_product_id: String(row.product_id),
            symbolic_method: String(row.symbolic_method),
            auto_removal_allowed: Boolean(row.auto_removal_allowed),
            approval_request_id: row.approval_request_id
              ? String(row.approval_request_id)
              : null,
            version: Number(row.version),
          };
        } else if (eventType === "SOFTWARE.PRODUCT_ALIAS_CREATED") {
          eventPayload = {
            software_product_id: String(value.product_id),
            alias_id: String(value.id),
            alias: String(value.alias),
            normalized_alias: String(value.normalized_alias),
          };
        }

        if (aggregateType === "SOFTWARE_EXCEPTION" && !review) {
          const current = (await readSoftwareException(
            tx,
            aggregateId,
          )) as Record<string, unknown>;
          const state = String(current.state);
          if (["OPEN", "WAITING_APPROVAL", "REMOVAL_PENDING"].includes(state))
            await createSoftwareExceptionWorkItem({
              tx,
              exceptionId: aggregateId,
              title: `Unauthorized software: ${String(current.normalized_name)}`,
              priority:
                current.risk === "HIGH" || current.risk === "CRITICAL"
                  ? "HIGH"
                  : "NORMAL",
            });
          await effects({
            tx,
            config,
            context,
            principal,
            key,
            eventType,
            aggregateType,
            aggregateId,
            version: Number(value.version ?? current.version),
            reason,
            before,
            after: eventPayload,
          });
          if (
            command?.[2] === "request-removal" &&
            typeof value.removal_job_id === "string"
          )
            await effects({
              tx,
              config,
              context,
              principal,
              key: `${key}:queued`,
              eventType: "SOFTWARE.REMOVAL_JOB_QUEUED",
              aggregateType: "SOFTWARE_REMOVAL_JOB",
              aggregateId: value.removal_job_id,
              version: 1,
              reason,
              before: null,
              after: {
                software_exception_id: aggregateId,
                removal_job_id: value.removal_job_id,
                asset_id: value.asset_id,
                state: "QUEUED",
                automatic_dispatch: true,
                version: 1,
              },
            });
        } else {
          await effects({
            tx,
            config,
            context,
            principal,
            key,
            eventType,
            aggregateType,
            aggregateId,
            version: Number(value.version ?? 1),
            reason,
            before,
            after: eventPayload,
          });
        }
        return {
          status: productAliases || uninstallProfiles ? 201 : 200,
          body: value as never,
        };
      },
    ),
  );
  json(res, result.status, { data: result.body, meta: context });
  return true;
}
