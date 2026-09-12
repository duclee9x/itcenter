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
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  executeGoodsReceiptCommand,
  listGoodsReceipts,
  readGoodsReceipt,
  type GoodsReceiptCommand,
} from "../../../modules/procurement/index.js";
import {
  readEntityTimeline,
  recordProcurementTimelineEvent,
  resolveGoodsReceiptWorkItem,
  upsertGoodsReceiptWorkItem,
} from "../../../modules/work-queue/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Body = Record<string, unknown>;
async function readBody(req: IncomingMessage): Promise<Body> {
  let raw = "";
  for await (const part of req) {
    raw += part.toString();
    if (raw.length > 65536)
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
function uuid(value: string, label = "goods_receipt_id") {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApplicationError("VALIDATION_ERROR", `${label} must be a UUID.`);
  return value;
}
function idempotencyKey(req: IncomingMessage) {
  const value = req.headers["idempotency-key"];
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return value.trim();
}
function version(body: Body) {
  if (
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version must be a positive integer.",
    );
  return Number(body.expected_version);
}
function requiredReason(body: Body) {
  const value = body.reason;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 2000 ||
    /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
      value,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid reason without credentials is required.",
    );
  return value.trim();
}
async function authorizeReceipt(input: {
  authorization: AuthorizationPort;
  principal: Principal;
  context: CorrelationContext;
  action: string;
  id: string;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: {
      type: "goods_receipt",
      id: input.id,
      tenant_id: input.principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
}
const commandMap: Record<
  string,
  { command: GoodsReceiptCommand; permission: string }
> = {
  "update-draft": {
    command: "GOODS_RECEIPT.UPDATE_DRAFT",
    permission: "goods_receipt.update",
  },
  post: { command: "GOODS_RECEIPT.POST", permission: "goods_receipt.post" },
  cancel: {
    command: "GOODS_RECEIPT.CANCEL",
    permission: "goods_receipt.cancel",
  },
};
const fields: Record<GoodsReceiptCommand, string[]> = {
  "GOODS_RECEIPT.CREATE": [
    "purchase_order_id",
    "warehouse_id",
    "location_id",
    "received_at",
    "lines",
    "exceptions",
  ],
  "GOODS_RECEIPT.UPDATE_DRAFT": [
    "expected_version",
    "warehouse_id",
    "location_id",
    "received_at",
    "lines",
    "exceptions",
  ],
  "GOODS_RECEIPT.POST": ["expected_version"],
  "GOODS_RECEIPT.CANCEL": ["expected_version", "reason"],
};

export async function handleGoodsReceiptRoute(input: {
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
  const collection = path === "/api/v1/goods-receipts";
  const detail = /^\/api\/v1\/goods-receipts\/([^/]+)$/.exec(path);
  const timeline = /^\/api\/v1\/goods-receipts\/([^/]+)\/timeline$/.exec(path);
  const match =
    /^\/api\/v1\/goods-receipts\/([^/]+)\/commands\/([a-z-]+)$/.exec(path);
  if (!(collection || detail || timeline || match)) return false;
  const receiptId = detail?.[1] ?? timeline?.[1] ?? match?.[1];
  if (receiptId) uuid(receiptId);
  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  if (method === "GET" && collection) {
    const limit = Number(url.searchParams.get("limit") ?? 50),
      offset = Number(url.searchParams.get("offset") ?? 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new ApplicationError("VALIDATION_ERROR", "Pagination is invalid.");
    const rows = await uow.run(principal.tenant_id, async (tx) => {
      const result = await listGoodsReceipts(tx, {
        limit: Math.min(limit * 3, 300),
        offset: 0,
        state: url.searchParams.get("state"),
      });
      const visible = [];
      for (const row of result) {
        try {
          await authorizeReceipt({
            authorization,
            principal,
            context,
            action: "goods_receipt.read",
            id: String(row.id),
          });
          visible.push(row);
        } catch (error) {
          if (!(
            error instanceof ApplicationError &&
            error.code === "PERMISSION_DENIED"
          ))
            throw error;
        }
      }
      return visible.slice(offset, offset + limit);
    });
    json(res, 200, { data: rows, meta: context });
    return true;
  }
  if (method === "GET" && (detail || timeline)) {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeReceipt({
        authorization,
        principal,
        context,
        action: "goods_receipt.read",
        id: receiptId!,
      });
      if (timeline) {
        await readGoodsReceipt(tx, receiptId!);
        return readEntityTimeline({
          tx,
          entityType: "GOODS_RECEIPT",
          entityId: receiptId!,
        });
      }
      return readGoodsReceipt(tx, receiptId!);
    });
    json(res, 200, { data, meta: context });
    return true;
  }
  if (method !== "POST" || !(collection || match)) return false;
  const body = await readBody(req),
    create = collection;
  const entry = create
    ? {
        command: "GOODS_RECEIPT.CREATE" as const,
        permission: "goods_receipt.create",
      }
    : commandMap[match![2]!];
  if (!entry)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported Goods Receipt command.",
    );
  const command = entry.command,
    allowed = fields[command];
  if (Object.keys(body).some((field) => !allowed.includes(field)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request has unsupported fields.",
    );
  const commandReason =
    command === "GOODS_RECEIPT.CANCEL"
      ? requiredReason(body)
      : typeof body.reason === "string"
        ? body.reason.trim()
        : "";
  const expected = create ? undefined : version(body);
  const key = idempotencyKey(req);
  const scope = create
    ? uuid(String(body.purchase_order_id ?? ""), "purchase_order_id")
    : receiptId!;
  const result = await uow.run(principal.tenant_id, async (tx) => {
    await authorizeReceipt({
      authorization,
      principal,
      context,
      action: entry.permission,
      id: scope,
    });
    return new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: command,
        businessScope: scope,
        key,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        const value = await executeGoodsReceiptCommand({
          tx,
          actorId: principal.id,
          actorType: principal.actor_type,
          correlationId: context.correlation_id,
          command,
          ...(create ? {} : { id: receiptId! }),
          ...(expected === undefined ? {} : { expectedVersion: expected }),
          body,
          reason: commandReason,
        });
        if (
          command === "GOODS_RECEIPT.CREATE" ||
          command === "GOODS_RECEIPT.UPDATE_DRAFT"
        ) {
          const exceptions = value.data.exceptions as Array<
            Record<string, unknown>
          >;
          const blocking =
            exceptions?.filter(
              (exception) =>
                exception.blocking === true && exception.status === "OPEN",
            ) ?? [];
          if (blocking.length)
            await upsertGoodsReceiptWorkItem({
              tx,
              receiptId: String(value.data.id),
              title: `Resolve ${blocking.length} blocking receiving exception(s) before posting Goods Receipt ${String(value.data.receipt_code)}`,
            });
          else
            await resolveGoodsReceiptWorkItem({
              tx,
              receiptId: String(value.data.id),
            });
        }
        for (const event of value.events) {
          const eventId = randomUUID(),
            occurredAt = new Date().toISOString();
          await new PostgresOutboxWriter(tx).append({
            event_id: eventId,
            event_type: event.type,
            schema_version: 1,
            occurred_at: occurredAt,
            producer: { service: config.serviceName, instance: "api" },
            aggregate: {
              type: event.aggregateType,
              id: event.aggregateId,
              version: event.version,
            },
            actor: { type: principal.actor_type, id: principal.id },
            correlation_id: context.correlation_id,
            causation_id: context.causation_id,
            tenant_id: principal.tenant_id,
            organization_id: principal.tenant_id,
            idempotency_key: key,
            payload: event.payload as never,
          });
          await recordProcurementTimelineEvent({
            tx,
            entityType: event.aggregateType,
            entityId: event.aggregateId,
            eventType: event.type,
            payload: event.payload,
            sourceEventId: eventId,
          });
          await new PostgresAudit(tx).append({
            id: randomUUID(),
            tenant_id: principal.tenant_id,
            event_type: event.type,
            occurred_at: occurredAt,
            actor: { type: principal.actor_type, id: principal.id },
            action: { command_type: command, idempotency_key: key },
            subject: {
              entity_type: event.aggregateType,
              entity_id: event.aggregateId,
            },
            correlation_id: context.correlation_id,
            causation_id: context.causation_id,
            reason: { code: command, text: commandReason },
            before: event.before as never,
            after: event.after as never,
            outcome: { status: "SUCCESS" },
            classification: "INTERNAL",
            relations: [],
            evidence: [],
          });
        }
        return { status: value.status, body: value.data as never };
      },
    );
  });
  json(res, result.status, { data: result.body, meta: context });
  return true;
}
