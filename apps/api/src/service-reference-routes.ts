import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type {
  CorrelationContext,
  Json,
} from "../../../packages/shared-kernel/src/index.js";
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
  createPlatform,
  createService,
  createServiceEnvironment,
  deactivateCatalog,
  readPlatform,
  readService,
  readServiceEnvironment,
  updateCatalog,
  type CatalogKind,
  type PlatformFamily,
} from "../../../modules/service/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Body = Record<string, unknown>;
type KindConfig = {
  kind: CatalogKind;
  route: string;
  resource: string;
  event: string;
  read: typeof readService;
};
const catalogs: KindConfig[] = [
  {
    kind: "SERVICE",
    route: "services",
    resource: "service",
    event: "SERVICE",
    read: readService,
  },
  {
    kind: "PLATFORM",
    route: "platforms",
    resource: "platform",
    event: "PLATFORM",
    read: readPlatform,
  },
  {
    kind: "SERVICE_ENVIRONMENT",
    route: "service-environments",
    resource: "service_environment",
    event: "SERVICE_ENVIRONMENT",
    read: readServiceEnvironment,
  },
];

async function body(req: IncomingMessage): Promise<Body> {
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
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Body;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}
function fields(value: Body, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request has unsupported fields.",
    );
}
function text(value: unknown, field: string, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === ""))
    return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 500)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} is invalid or missing.`,
    );
  return value.trim();
}
function safeReason(value: unknown) {
  const reason = text(value, "reason")!;
  if (
    /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
      reason,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "reason must not contain credentials or secrets.",
    );
  return reason;
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version must be a positive integer.",
    );
  return Number(value);
}
function idem(req: IncomingMessage): string {
  const value = req.headers["idempotency-key"];
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return value.trim();
}
function uuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Reference id must be a UUID.",
    );
  return value;
}
async function authorizeResource(input: {
  authorization: AuthorizationPort;
  principal: Principal;
  context: CorrelationContext;
  action: string;
  type: string;
  id: string;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: {
      type: input.type,
      id: input.id,
      tenant_id: input.principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
}
function storedIntent(input: {
  principal: Principal;
  operation: string;
  scope: string;
  key: string;
  body: Body;
}) {
  return {
    principalId: input.principal.id,
    operation: input.operation,
    businessScope: input.scope,
    key: input.key,
    semanticRequest: input.body as Json,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}
async function appendEffects(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: CorrelationContext;
  key: string;
  command: string;
  event: string;
  kind: KindConfig;
  entity: { id: string; version: number; state: string };
  reason: string;
  before: unknown;
}) {
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: input.event,
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.config.serviceName, instance: "api" },
    aggregate: {
      type: input.kind.event,
      id: input.entity.id,
      version: input.entity.version,
    },
    actor: { type: input.principal.actor_type, id: input.principal.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    tenant_id: input.principal.tenant_id,
    organization_id: input.principal.tenant_id,
    idempotency_key: input.key,
    payload: {
      id: input.entity.id,
      version: input.entity.version,
      state: input.entity.state,
    } as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.event,
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.command, idempotency_key: input.key },
    subject: { entity_type: input.kind.event, entity_id: input.entity.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.command, text: input.reason },
    before: input.before as never,
    after: {
      id: input.entity.id,
      version: input.entity.version,
      state: input.entity.state,
    },
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
}

export async function handleServiceReferenceRoute(input: {
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
  const selected = catalogs.find(
    (item) =>
      url.pathname === `/api/v1/${item.route}` ||
      new RegExp(
        `^/api/v1/${item.route}/[^/]+(?:/commands/(?:update|deactivate))?$`,
      ).test(url.pathname),
  );
  if (!selected) return false;
  const collection = url.pathname === `/api/v1/${selected.route}`;
  const match = collection
    ? null
    : new RegExp(
        `^/api/v1/${selected.route}/([^/]+)(?:/commands/(update|deactivate))?$`,
      ).exec(url.pathname);
  const id = match?.[1];
  if (id) uuid(id);
  if (!(
    (collection && method === "POST") ||
    (id && method === "GET") ||
    (id && match?.[2] && method === "POST")
  ))
    throw new ApplicationError("NOT_FOUND", "Reference route was not found.");
  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  if (method === "GET") {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        context,
        action: `${selected.resource}.read`,
        type: selected.resource,
        id: id!,
      });
      return selected.read(tx, id!);
    });
    json(res, 200, { data, meta: context });
    return true;
  }
  const request = await body(req);
  const key = idem(req);
  const isCreate = collection;
  const isDeactivate = match?.[2] === "deactivate";
  const command = isCreate
    ? `${selected.event}.CREATE`
    : isDeactivate
      ? `${selected.event}.DEACTIVATE`
      : `${selected.event}.UPDATE`;
  const reason = safeReason(request.reason);
  const allowed = isCreate
    ? selected.kind === "SERVICE"
      ? ["key", "name", "description", "reason"]
      : selected.kind === "PLATFORM"
        ? ["key", "family", "name", "major_version", "reason"]
        : ["service_id", "key", "name", "reason"]
    : isDeactivate
      ? ["expected_version", "reason"]
      : selected.kind === "SERVICE"
        ? ["expected_version", "key", "name", "description", "reason"]
        : selected.kind === "PLATFORM"
          ? [
              "expected_version",
              "key",
              "family",
              "name",
              "major_version",
              "reason",
            ]
          : ["expected_version", "key", "name", "reason"];
  fields(request, allowed);
  const expected = isCreate ? undefined : version(request.expected_version);
  const output = await uow.run(principal.tenant_id, async (tx) => {
    await authorizeResource({
      authorization,
      principal,
      context,
      action: `${selected.resource}.manage`,
      type: selected.resource,
      id: id ?? "new",
    });
    return new PostgresIdempotencyStore(tx).execute(
      storedIntent({
        principal,
        operation: command,
        scope: id ?? "new",
        key,
        body: request,
      }),
      async () => {
        let entity: { id: string; version: number; state: string };
        let before: unknown = null;
        if (isCreate) {
          entity =
            selected.kind === "SERVICE"
              ? await createService({
                  tx,
                  key: text(request.key, "key")!,
                  name: text(request.name, "name")!,
                  description: text(request.description, "description", true),
                })
              : selected.kind === "PLATFORM"
                ? await createPlatform({
                    tx,
                    key: text(request.key, "key")!,
                    family: text(request.family, "family") as PlatformFamily,
                    name: text(request.name, "name")!,
                    majorVersion: text(
                      request.major_version,
                      "major_version",
                      true,
                    ),
                  })
                : await createServiceEnvironment({
                    tx,
                    serviceId: uuid(text(request.service_id, "service_id")!),
                    key: text(request.key, "key")!,
                    name: text(request.name, "name")!,
                  });
        } else if (isDeactivate) {
          const current = await selected.read(tx, id!);
          before = { state: current.state, version: current.version };
          const changed = await deactivateCatalog({
            tx,
            kind: selected.kind,
            id: id!,
            expectedVersion: expected!,
          });
          entity = changed.after;
        } else {
          const current = await selected.read(tx, id!);
          before = { state: current.state, version: current.version };
          const changes: Record<string, string | null> = {};
          for (const field of [
            "key",
            "name",
            "description",
            "family",
            "major_version",
          ])
            if (request[field] !== undefined)
              changes[field] = text(
                request[field],
                field,
                field === "description" || field === "major_version",
              );
          entity = await updateCatalog({
            tx,
            kind: selected.kind,
            id: id!,
            expectedVersion: expected!,
            changes,
          });
        }
        const event = `${selected.event}.${isCreate ? "CREATED" : isDeactivate ? "DEACTIVATED" : "UPDATED"}`;
        await appendEffects({
          tx,
          config,
          principal,
          context,
          key,
          command,
          event,
          kind: selected,
          entity,
          reason,
          before,
        });
        return { status: isCreate ? 201 : 200, body: entity as never };
      },
    );
  });
  json(res, output.status, { data: output.body, meta: context });
  return true;
}
