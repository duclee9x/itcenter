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
  createDeploymentCampaign,
  listDeploymentCampaigns,
  listDeploymentTargets,
  readDeploymentCampaign,
  retryDeploymentTarget,
  transitionDeploymentCampaign,
} from "../../../modules/software/index.js";
import { json } from "../../../packages/observability/src/index.js";

async function parseBody(req: IncomingMessage) {
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

function only(input: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(input).some((key) => !fields.includes(key)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request contains unsupported fields.",
    );
}

function text(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (typeof value !== "string" || !value.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}

function integer(
  input: Record<string, unknown>,
  field: string,
  fallback?: number,
) {
  const value = input[field] ?? fallback;
  if (!Number.isSafeInteger(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be an integer.`,
    );
  return value as number;
}

function bool(
  input: Record<string, unknown>,
  field: string,
  fallback: boolean,
) {
  const value = input[field] ?? fallback;
  if (typeof value !== "boolean")
    throw new ApplicationError("VALIDATION_ERROR", `${field} must be boolean.`);
  return value;
}

async function authorizeRequest(input: {
  authorization: AuthorizationPort;
  principal: Awaited<ReturnType<typeof authenticate>>;
  action: string;
  resourceId: string;
  resourceType?: string;
  context: CorrelationContext;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: {
      type: input.resourceType ?? "software_deployment",
      id: input.resourceId,
      tenant_id: input.principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
}

async function appendEffects(input: {
  tx: Transaction;
  config: Config;
  principal: { id: string; actor_type: string; tenant_id: string };
  context: CorrelationContext;
  key: string;
  eventType: string;
  campaignId: string;
  aggregateType?: "SOFTWARE_DEPLOYMENT_CAMPAIGN" | "SOFTWARE_DEPLOYMENT_TARGET";
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
      type: input.aggregateType ?? "SOFTWARE_DEPLOYMENT_CAMPAIGN",
      id: input.campaignId,
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
  if (
    input.eventType === "SOFTWARE.DEPLOYMENT_CAMPAIGN_STARTED" ||
    input.eventType === "SOFTWARE.DEPLOYMENT_CAMPAIGN_ADVANCED"
  ) {
    const details = input.after as {
      rollout_stage_percent?: number;
      queued_count?: number;
    };
    await new PostgresOutboxWriter(input.tx).append({
      event_id: randomUUID(),
      event_type: "SOFTWARE.DEPLOYMENT_JOB_QUEUED",
      schema_version: 1,
      occurred_at: now,
      producer: { service: input.config.serviceName, instance: "api" },
      aggregate: {
        type: "SOFTWARE_DEPLOYMENT_CAMPAIGN",
        id: input.campaignId,
        version: input.version,
      },
      actor: { type: input.principal.actor_type, id: input.principal.id },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      tenant_id: input.principal.tenant_id,
      organization_id: input.principal.tenant_id,
      idempotency_key: `${input.key}:queued`,
      payload: {
        campaign_id: input.campaignId,
        rollout_stage_percent: details.rollout_stage_percent ?? 0,
        queued_count: details.queued_count ?? 0,
      },
    });
  }
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.eventType,
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.eventType },
    subject: {
      entity_type: input.aggregateType ?? "SOFTWARE_DEPLOYMENT_CAMPAIGN",
      entity_id: input.campaignId,
    },
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

export async function handleSoftwareDeploymentRoute(input: {
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
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const collection = path === "/api/v1/software/deployment-campaigns";
  const one = /^\/api\/v1\/software\/deployment-campaigns\/([^/]+)$/.exec(path);
  const targets =
    /^\/api\/v1\/software\/deployment-campaigns\/([^/]+)\/targets$/.exec(path);
  const retry =
    /^\/api\/v1\/software\/deployment-targets\/([^/]+)\/commands\/retry$/.exec(
      path,
    );
  const command =
    /^\/api\/v1\/software\/deployment-campaigns\/([^/]+)\/commands\/(start|pause|resume|advance|cancel)$/.exec(
      path,
    );
  const isRead = method === "GET" && (collection || !!one || !!targets);
  const isWrite = method === "POST" && (collection || !!command || !!retry);
  if (!isRead && !isWrite) return false;

  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  const resourceId = collection
    ? "catalog"
    : (one?.[1] ?? targets?.[1] ?? command?.[1] ?? retry?.[1] ?? "new");
  await authorizeRequest({
    authorization,
    principal,
    action: isRead
      ? "software.deployment.read"
      : retry
        ? "software.retry_deployment"
        : command?.[2] === "cancel"
          ? "software.deployment.cancel"
          : "software.deploy",
    resourceId,
    context,
  });

  if (isRead) {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      if (targets) return listDeploymentTargets(tx, targets[1]!);
      if (one) return readDeploymentCampaign(tx, one[1]!);
      return listDeploymentCampaigns(tx);
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  const body = await parseBody(req);
  if (collection && Array.isArray(body.asset_ids))
    for (const assetId of body.asset_ids)
      if (typeof assetId === "string")
        await authorizeRequest({
          authorization,
          principal,
          action: "software.deploy",
          resourceId: assetId,
          resourceType: "asset",
          context,
        });
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  const result = await uow.run(principal.tenant_id, (tx) =>
    new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: collection
          ? "SOFTWARE.DEPLOYMENT_CAMPAIGN_CREATE"
          : retry
            ? "SOFTWARE.RETRY_DEPLOYMENT"
            : `SOFTWARE.DEPLOYMENT_CAMPAIGN_${command![2]!.toUpperCase()}`,
        businessScope: resourceId,
        key,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        if (collection) {
          only(body, [
            "software_version_id",
            "asset_ids",
            "initial_stage_percent",
            "failure_threshold_percent",
            "max_attempts",
            "stop_on_security_failure",
            "change_id",
            "reason",
          ]);
          if (
            !Array.isArray(body.asset_ids) ||
            body.asset_ids.some((id) => typeof id !== "string")
          )
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "asset_ids must be a string array.",
            );
          const created = await createDeploymentCampaign({
            tx,
            softwareVersionId: text(body, "software_version_id"),
            assetIds: body.asset_ids as string[],
            initialStagePercent: integer(body, "initial_stage_percent", 1),
            failureThresholdPercent: integer(
              body,
              "failure_threshold_percent",
              25,
            ),
            maxAttempts: integer(body, "max_attempts", 2),
            stopOnSecurityFailure: bool(body, "stop_on_security_failure", true),
            ...(typeof body.change_id === "string"
              ? { changeId: body.change_id }
              : {}),
            actorId: principal.id,
            reason: text(body, "reason"),
          });
          await appendEffects({
            tx,
            config,
            principal,
            context,
            key,
            eventType: "SOFTWARE.DEPLOYMENT_CAMPAIGN_CREATED",
            campaignId: created.id,
            version: created.version,
            reason: created.reason,
            before: null,
            after: {
              campaign_id: created.id,
              software_version_id: created.software_version_id,
              artifact_version_id: created.artifact_version_id,
              state: created.state,
              rollout_stage_percent: created.rollout_stage_percent,
              target_count: created.target_count,
              version: created.version,
              reason: created.reason,
            },
          });
          return { status: 201, body: created as never };
        }

        if (retry) {
          only(body, ["expected_version", "reason"]);
          const retried = await retryDeploymentTarget({
            tx,
            targetId: retry[1]!,
            expectedVersion: integer(body, "expected_version"),
            reason: text(body, "reason"),
          });
          await appendEffects({
            tx,
            config,
            principal,
            context,
            key,
            eventType: retried.event_type,
            campaignId: retried.id,
            aggregateType: "SOFTWARE_DEPLOYMENT_TARGET",
            version: retried.version,
            reason: retried.reason,
            before: { state: "FAILED" },
            after: {
              deployment_job_id: retried.id,
              campaign_id: retried.campaign_id,
              state: retried.state,
              version: retried.version,
              reason: retried.reason,
            },
          });
          return { status: 200, body: retried as never };
        }

        only(body, ["expected_version", "reason"]);
        const action = (
          command![2] === "cancel" ? "STOP" : command![2]!.toUpperCase()
        ) as "START" | "PAUSE" | "RESUME" | "ADVANCE" | "STOP";
        const changed = await transitionDeploymentCampaign({
          tx,
          campaignId: command![1]!,
          expectedVersion: integer(body, "expected_version"),
          action,
          reason: text(body, "reason"),
        });
        await appendEffects({
          tx,
          config,
          principal,
          context,
          key,
          eventType: changed.event_type,
          campaignId: changed.id,
          version: changed.version,
          reason: changed.reason,
          before: changed.before,
          after: {
            campaign_id: changed.id,
            state: changed.state,
            rollout_stage_percent: changed.rollout_stage_percent,
            queued_count: changed.queued_count,
            version: changed.version,
            reason: changed.reason,
          },
        });
        return {
          status: 200,
          body: {
            id: changed.id,
            state: changed.state,
            rollout_stage_percent: changed.rollout_stage_percent,
            queued_count: changed.queued_count,
            version: changed.version,
          } as never,
        };
      },
    ),
  );
  if (result.body && typeof result.body === "object" && "error" in result.body)
    json(res, result.status, result.body);
  else json(res, result.status, { data: result.body, meta: context });
  return true;
}

export function deploymentFailure(error: unknown, context: CorrelationContext) {
  return errorResponse(error, context);
}
