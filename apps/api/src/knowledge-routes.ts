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
import type {
  CorrelationContext,
  Json,
} from "../../../packages/shared-kernel/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  readKnowledgeArticle,
  replaceKnowledgeApplicability,
  updateKnowledgeAudience,
  type KnowledgeApplicabilityTarget,
} from "../../../modules/problem/index.js";
import {
  platformQueryPort,
  serviceEnvironmentQueryPort,
  serviceQueryPort,
} from "../../../modules/service/index.js";
import { readSoftwareProductReference } from "../../../modules/software/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Body = Record<string, unknown>;

async function readBody(req: IncomingMessage): Promise<Body> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 32768)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
  }
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Body;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}

function fields(body: Body, allowed: readonly string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request has unsupported fields.",
    );
}

function expectedVersion(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version is required.",
    );
  return Number(value);
}

async function authorizeKnowledge(input: {
  principal: Parameters<typeof authorize>[1]["principal"];
  authorization: AuthorizationPort;
  action: string;
  id: string;
  context: CorrelationContext;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: {
      type: "knowledge",
      id: input.id,
      tenant_id: input.principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
}

export async function handleKnowledgeRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}): Promise<boolean> {
  const path = new URL(input.req.url ?? "", "http://localhost").pathname;
  const readMatch = /^\/api\/v1\/knowledge\/([^/]+)$/.exec(path);
  const commandMatch =
    /^\/api\/v1\/knowledge\/([^/]+)\/commands\/(set-audience|set-applicability)$/.exec(
      path,
    );
  if (
    !(input.req.method === "GET" && readMatch) &&
    !(input.req.method === "POST" && commandMatch)
  )
    return false;

  const principal = await authenticate(
    input.authentication,
    input.req.headers.authorization,
  );
  if (readMatch) {
    const article = await input.uow.run(principal.tenant_id, (tx) =>
      readKnowledgeArticle(tx, readMatch[1]!),
    );
    if (!article || article.state !== "PUBLISHED")
      throw new ApplicationError(
        "NOT_FOUND",
        "Knowledge article was not found.",
      );
    const action =
      article.audience === "END_USER_SAFE"
        ? "knowledge.read"
        : article.audience === "OPERATOR_ONLY"
          ? "knowledge.read.operator"
          : null;
    if (!action)
      throw new ApplicationError(
        "NOT_FOUND",
        "Knowledge article was not found.",
      );
    await authorizeKnowledge({
      principal,
      authorization: input.authorization,
      action,
      id: article.id,
      context: input.context,
    });
    json(input.res, 200, {
      data: {
        id: article.id,
        slug: article.slug,
        title: article.title,
        body: article.body,
        state: article.state,
        audience: article.audience,
        version: article.version,
      },
      meta: input.context,
    });
    return true;
  }

  const id = commandMatch![1]!;
  const operation = commandMatch![2]!;
  const body = await readBody(input.req);
  fields(
    body,
    operation === "set-audience"
      ? ["expected_version", "audience", "reason"]
      : ["expected_version", "targets", "reason"],
  );
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 1000)
    throw new ApplicationError("VALIDATION_ERROR", "reason is required.");
  const version = expectedVersion(body.expected_version);
  const key = input.req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  await authorizeKnowledge({
    principal,
    authorization: input.authorization,
    action: "knowledge.manage",
    id,
    context: input.context,
  });

  const result = await input.uow.run(principal.tenant_id, (tx) =>
    new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: `KNOWLEDGE.${operation.replace("-", ".").toUpperCase()}`,
        businessScope: id,
        key,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        let before: Json;
        let after: Json;
        let event: Json;
        if (operation === "set-audience") {
          const value = await updateKnowledgeAudience({
            tx,
            id,
            expectedVersion: version,
            audience: String(body.audience) as
              "END_USER_SAFE" | "OPERATOR_ONLY",
          });
          before = value.before as Json;
          after = value.after as Json;
          event = {
            id,
            version: value.after.version,
            audience: value.after.audience,
          };
        } else {
          const value = await replaceKnowledgeApplicability({
            tx,
            id,
            expectedVersion: version,
            targets: body.targets as KnowledgeApplicabilityTarget[],
            actorId: principal.id,
            resolveTarget: async (targetTx, target) => {
              if (target.type === "SERVICE") {
                const ref = await serviceQueryPort(targetTx).get(
                  targetTx.tenantId,
                  target.id,
                );
                return {
                  exists: Boolean(ref),
                  active: ref?.state === "ACTIVE",
                };
              }
              if (target.type === "PLATFORM") {
                const ref = await platformQueryPort(targetTx).get(
                  targetTx.tenantId,
                  target.id,
                );
                return {
                  exists: Boolean(ref),
                  active: ref?.state === "ACTIVE",
                };
              }
              if (target.type === "SERVICE_ENVIRONMENT") {
                const ref = await serviceEnvironmentQueryPort(targetTx).get(
                  targetTx.tenantId,
                  target.id,
                );
                if (!ref) return { exists: false, active: false };
                const service = await serviceQueryPort(targetTx).get(
                  targetTx.tenantId,
                  ref.service_id,
                );
                return {
                  exists: true,
                  active: ref.state === "ACTIVE" && service?.state === "ACTIVE",
                };
              }
              if (target.type === "SOFTWARE_PRODUCT") {
                const ref = await readSoftwareProductReference(
                  targetTx,
                  target.id,
                );
                return { exists: Boolean(ref), active: ref?.active === true };
              }
              return { exists: false, active: false };
            },
          });
          before = value.before as Json;
          after = value.after as Json;
          event = {
            id,
            version: value.knowledge?.version ?? version + 1,
            applicability: value.after as Json,
          };
        }
        const eventVersion = (event as { version: number }).version;
        const now = new Date().toISOString();
        await new PostgresOutboxWriter(tx).append({
          event_id: randomUUID(),
          event_type: "KNOWLEDGE.UPDATED",
          schema_version: 1,
          occurred_at: now,
          producer: { service: input.config.serviceName, instance: "api" },
          aggregate: { type: "KNOWLEDGE", id, version: eventVersion },
          actor: { type: principal.actor_type, id: principal.id },
          correlation_id: input.context.correlation_id,
          causation_id: input.context.causation_id,
          tenant_id: principal.tenant_id,
          organization_id: principal.tenant_id,
          idempotency_key: key,
          payload: event as Record<string, Json>,
        });
        await new PostgresAudit(tx).append({
          id: randomUUID(),
          tenant_id: principal.tenant_id,
          event_type: "KNOWLEDGE.UPDATED",
          occurred_at: now,
          actor: { type: principal.actor_type, id: principal.id },
          action: {
            command_type: `KNOWLEDGE.${operation.replace("-", ".").toUpperCase()}`,
          },
          subject: { entity_type: "KNOWLEDGE", entity_id: id },
          correlation_id: input.context.correlation_id,
          causation_id: input.context.causation_id,
          reason: { code: "KNOWLEDGE_METADATA_CHANGED", text: reason },
          before,
          after,
          outcome: { status: "SUCCESS" },
          classification: "INTERNAL",
          relations: [],
          evidence: [],
        });
        return { status: 200, body: event as Record<string, Json> };
      },
    ),
  );
  json(input.res, result.status, { data: result.body, meta: input.context });
  return true;
}
