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
  executePurchaseOrderCommand,
  listPurchaseOrders,
  readPurchaseOrder,
  type PurchaseOrderCommand,
} from "../../../modules/procurement/index.js";
import {
  readEntityTimeline,
  recordProcurementTimelineEvent,
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

function uuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "purchase_order_id must be a UUID.",
    );
  return value;
}

function key(req: IncomingMessage) {
  const value = req.headers["idempotency-key"];
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return value.trim();
}

function expectedVersion(body: Body) {
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

function reason(body: Body) {
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

async function authorizeResource(input: {
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
      type: "purchase_order",
      id: input.id,
      tenant_id: input.principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
}

const commandMap: Record<
  string,
  { command: PurchaseOrderCommand; permission: string }
> = {
  "update-draft": { command: "PO.UPDATE_DRAFT", permission: "po.update" },
  issue: { command: "PO.ISSUE", permission: "po.issue" },
  hold: { command: "PO.HOLD", permission: "po.hold" },
  resume: { command: "PO.RESUME", permission: "po.hold" },
  amend: { command: "PO.AMEND", permission: "po.amend" },
  cancel: { command: "PO.CANCEL", permission: "po.cancel" },
  close: { command: "PO.CLOSE", permission: "po.close" },
  "close-remainder": { command: "PO.CLOSE_REMAINDER", permission: "po.close" },
};

function permittedFields(command: PurchaseOrderCommand) {
  const base = [
    "reason",
    ...(command === "PO.CREATE" ? [] : ["expected_version"]),
  ];
  if (["PO.CREATE", "PO.UPDATE_DRAFT", "PO.AMEND"].includes(command))
    return [
      ...base,
      "supplier_id",
      "procurement_request_id",
      "rfq_id",
      "source_quotation_id",
      "currency",
      "expected_delivery",
      "payment_terms",
      "delivery_terms",
      "delivery_location",
      "terms",
      "lines",
      ...(command === "PO.AMEND" ? ["approval_request_id"] : []),
    ];
  return base;
}

export async function handlePurchaseOrderRoute(input: {
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
  const collection = path === "/api/v1/purchase-orders";
  const detail = /^\/api\/v1\/purchase-orders\/([^/]+)$/.exec(path);
  const timeline = /^\/api\/v1\/purchase-orders\/([^/]+)\/timeline$/.exec(path);
  const commandMatch =
    /^\/api\/v1\/purchase-orders\/([^/]+)\/commands\/([a-z-]+)$/.exec(path);
  if (!(collection || detail || timeline || commandMatch)) return false;
  const poId = detail?.[1] ?? timeline?.[1] ?? commandMatch?.[1];
  if (poId) uuid(poId);
  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );

  if (method === "GET" && collection) {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new ApplicationError("VALIDATION_ERROR", "Pagination is invalid.");
    const data = await uow.run(principal.tenant_id, async (tx) => {
      const rows = await listPurchaseOrders(tx, {
        limit,
        offset,
        state: url.searchParams.get("state"),
      });
      const visible = [];
      for (const row of rows) {
        try {
          await authorizeResource({
            authorization,
            principal,
            context,
            action: "po.read",
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
      return visible;
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  if (method === "GET" && (detail || timeline)) {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        context,
        action: "po.read",
        id: poId!,
      });
      if (timeline) {
        await readPurchaseOrder(tx, poId!);
        return readEntityTimeline({
          tx,
          entityType: "PURCHASE_ORDER",
          entityId: poId!,
        });
      }
      return readPurchaseOrder(tx, poId!);
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  if (method !== "POST" || !(collection || commandMatch)) return false;
  const body = await readBody(req);
  const create = collection;
  const commandEntry = create
    ? { command: "PO.CREATE" as const, permission: "po.create" }
    : commandMap[commandMatch![2]!];
  if (!commandEntry)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported Purchase Order command.",
    );
  const command = commandEntry.command;
  const allowed = permittedFields(command);
  if (Object.keys(body).some((field) => !allowed.includes(field)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request has unsupported fields.",
    );
  const commandReason = reason(body);
  const version = create ? undefined : expectedVersion(body);
  const idemKey = key(req);
  const id = create ? "new" : poId!;
  const result = await uow.run(principal.tenant_id, async (tx) => {
    await authorizeResource({
      authorization,
      principal,
      context,
      action: commandEntry.permission,
      id,
    });
    return new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: command,
        businessScope: id,
        key: idemKey,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        const value = await executePurchaseOrderCommand({
          tx,
          actorId: principal.id,
          correlationId: context.correlation_id,
          reason: commandReason,
          command,
          ...(create ? {} : { id }),
          ...(version === undefined ? {} : { expectedVersion: version }),
          body,
        });
        for (const event of value.events) {
          const eventId = randomUUID();
          const occurredAt = new Date().toISOString();
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
            idempotency_key: idemKey,
            payload: event.payload as never,
          });
          await recordProcurementTimelineEvent({
            tx,
            entityType: "PURCHASE_ORDER",
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
            action: { command_type: command, idempotency_key: idemKey },
            subject: {
              entity_type: "PURCHASE_ORDER",
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
