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
  readEntityTimeline,
  recordProcurementTimelineEvent,
} from "../../../modules/work-queue/index.js";
import {
  executeRfqCommand,
  listQuotations,
  listRfqs,
  readQuotation,
  readRfq,
  type RfqEvent,
} from "../../../modules/procurement/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Body = Record<string, unknown>;
type Context = CorrelationContext;

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

function uuid(value: string, field: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApplicationError("VALIDATION_ERROR", `${field} must be a UUID.`);
  return value;
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

function page(url: URL) {
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
  return { limit, offset };
}

async function authorizeResource(input: {
  authorization: AuthorizationPort;
  principal: Principal;
  context: Context;
  action: string;
  type: "rfq" | "quotation";
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

function permission(command: string) {
  const permissions: Record<string, string> = {
    "RFQ.CREATE": "rfq.create",
    "RFQ.UPDATE_DRAFT": "rfq.update",
    "RFQ.ISSUE": "rfq.issue",
    "RFQ.CLOSE_SUBMISSIONS": "rfq.close",
    "RFQ.CLOSE_NO_AWARD": "rfq.close",
    "RFQ.CANCEL": "rfq.cancel",
    "RFQ.AWARD": "rfq.award",
    "QUOTATION.CREATE": "quotation.create",
    "QUOTATION.UPDATE_DRAFT": "quotation.update",
    "QUOTATION.SUBMIT": "quotation.submit",
    "QUOTATION.WITHDRAW": "quotation.withdraw",
    "QUOTATION.DISQUALIFY": "quotation.evaluate",
  };
  const result = permissions[command];
  if (!result)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported Procurement command.",
    );
  return result;
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

function validatePayload(command: string, body: Body) {
  const shared = [
    "reason",
    ...(command.endsWith("CREATE") ? [] : ["expected_version"]),
  ];
  const fields: Record<string, string[]> = {
    "RFQ.CREATE": [
      "title",
      "description",
      "procurement_request_id",
      "currency",
      "submission_deadline",
      "terms",
      "supplier_ids",
    ],
    "RFQ.UPDATE_DRAFT": [
      "title",
      "description",
      "currency",
      "submission_deadline",
      "terms",
      "supplier_ids",
    ],
    "RFQ.AWARD": ["quotation_id", "approval_id"],
    "RFQ.ISSUE": [],
    "RFQ.CLOSE_SUBMISSIONS": [],
    "RFQ.CLOSE_NO_AWARD": [],
    "RFQ.CANCEL": [],
    "QUOTATION.CREATE": [
      "rfq_id",
      "supplier_id",
      "currency",
      "total",
      "valid_until",
      "lead_time_days",
      "payment_terms",
      "warranty",
      "delivery_terms",
      "terms",
      "lines",
      "attachments",
      "replaces_quotation_id",
    ],
    "QUOTATION.UPDATE_DRAFT": [
      "currency",
      "total",
      "valid_until",
      "lead_time_days",
      "payment_terms",
      "warranty",
      "delivery_terms",
      "terms",
      "lines",
      "attachments",
    ],
    "QUOTATION.SUBMIT": [],
    "QUOTATION.WITHDRAW": [],
    "QUOTATION.DISQUALIFY": [],
  };
  const allowed = new Set([...shared, ...(fields[command] ?? [])]);
  if (Object.keys(body).some((field) => !allowed.has(field)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request has unsupported fields.",
    );
  for (const field of [
    "rfq_id",
    "supplier_id",
    "procurement_request_id",
    "quotation_id",
    "approval_id",
    "replaces_quotation_id",
  ])
    if (body[field] !== undefined && body[field] !== null)
      uuid(String(body[field]), field);
  for (const field of ["terms"])
    if (
      body[field] !== undefined &&
      (!body[field] ||
        typeof body[field] !== "object" ||
        Array.isArray(body[field]))
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `${field} must be a JSON object.`,
      );
  if (
    body.supplier_ids !== undefined &&
    (!Array.isArray(body.supplier_ids) ||
      body.supplier_ids.length < 1 ||
      body.supplier_ids.length > 100)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "supplier_ids must contain 1 to 100 UUIDs.",
    );
  if (Array.isArray(body.supplier_ids))
    for (const supplierId of body.supplier_ids)
      uuid(String(supplierId), "supplier_id");
  for (const field of ["lines", "attachments"])
    if (
      body[field] !== undefined &&
      (!Array.isArray(body[field]) ||
        body[field].length > (field === "lines" ? 100 : 20) ||
        body[field].some(
          (row) => !row || typeof row !== "object" || Array.isArray(row),
        ))
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `${field} must be a bounded list of objects.`,
      );
  if (body.lines !== undefined && (body.lines as unknown[]).length === 0)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "At least one quotation line is required.",
    );
  if (
    body.total !== undefined &&
    (typeof body.total !== "number" ||
      !Number.isFinite(body.total) ||
      body.total < 0)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "total must be a non-negative number.",
    );
  if (
    body.lead_time_days !== undefined &&
    (!Number.isSafeInteger(body.lead_time_days) ||
      Number(body.lead_time_days) < 0)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "lead_time_days must be a non-negative integer.",
    );
  if (
    body.currency !== undefined &&
    (typeof body.currency !== "string" || !/^[A-Za-z]{3}$/.test(body.currency))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "currency must be a three-letter ISO currency code.",
    );
  if (
    body.submission_deadline !== undefined &&
    (typeof body.submission_deadline !== "string" ||
      !Number.isFinite(Date.parse(body.submission_deadline)))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "submission_deadline must be an ISO date-time.",
    );
  if (
    body.valid_until !== undefined &&
    (typeof body.valid_until !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.valid_until))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "valid_until must be an ISO calendar date.",
    );
  for (const field of [
    "title",
    "description",
    "payment_terms",
    "warranty",
    "delivery_terms",
  ])
    if (
      body[field] !== undefined &&
      body[field] !== null &&
      (typeof body[field] !== "string" ||
        (body[field] as string).length > (field === "title" ? 240 : 2000))
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `${field} must be bounded text.`,
      );
}

async function appendEffects(input: {
  tx: Transaction;
  event: RfqEvent;
  config: Config;
  principal: Principal;
  context: Context;
  key: string;
  command: string;
  reason: string;
}): Promise<string> {
  const occurredAt = new Date().toISOString();
  const eventId = randomUUID();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: eventId,
    event_type: input.event.type,
    schema_version: 1,
    occurred_at: occurredAt,
    producer: { service: input.config.serviceName, instance: "api" },
    aggregate: {
      type: input.event.aggregateType,
      id: input.event.aggregateId,
      version: input.event.version,
    },
    actor: { type: input.principal.actor_type, id: input.principal.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    tenant_id: input.principal.tenant_id,
    organization_id: input.principal.tenant_id,
    idempotency_key: input.key,
    payload: input.event.payload as never,
  });
  await recordProcurementTimelineEvent({
    tx: input.tx,
    entityType: input.event.aggregateType,
    entityId: input.event.aggregateId,
    eventType: input.event.type,
    payload: input.event.payload,
    sourceEventId: eventId,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.event.type,
    occurred_at: occurredAt,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.command, idempotency_key: input.key },
    subject: {
      entity_type: input.event.aggregateType,
      entity_id: input.event.aggregateId,
    },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.command, text: input.reason },
    before: input.event.before as never,
    after: input.event.after as never,
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
  return eventId;
}

export async function handleRfqRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: Context;
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
  const rfqCollection = path === "/api/v1/rfqs";
  const rfqDetail = /^\/api\/v1\/rfqs\/([^/]+)$/.exec(path);
  const rfqTimeline = /^\/api\/v1\/rfqs\/([^/]+)\/timeline$/.exec(path);
  const rfqCommand = /^\/api\/v1\/rfqs\/([^/]+)\/commands\/([a-z-]+)$/.exec(
    path,
  );
  const quoteCollection = path === "/api/v1/quotations";
  const quoteDetail = /^\/api\/v1\/quotations\/([^/]+)$/.exec(path);
  const quoteTimeline = /^\/api\/v1\/quotations\/([^/]+)\/timeline$/.exec(path);
  const quoteCommand =
    /^\/api\/v1\/quotations\/([^/]+)\/commands\/([a-z-]+)$/.exec(path);
  const matched =
    rfqCollection ||
    rfqDetail ||
    rfqTimeline ||
    rfqCommand ||
    quoteCollection ||
    quoteDetail ||
    quoteTimeline ||
    quoteCommand;
  if (!matched) return false;
  const rfqId = rfqDetail?.[1] ?? rfqTimeline?.[1] ?? rfqCommand?.[1];
  const quotationId =
    quoteDetail?.[1] ?? quoteTimeline?.[1] ?? quoteCommand?.[1];
  if (rfqId) uuid(rfqId, "rfq_id");
  if (quotationId) uuid(quotationId, "quotation_id");
  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );

  if (method === "GET" && (rfqCollection || quoteCollection)) {
    const pagination = page(url);
    const data = await uow.run(principal.tenant_id, async (tx) => {
      if (rfqCollection) {
        const rows = await listRfqs(
          tx,
          pagination.limit,
          pagination.offset,
          url.searchParams.get("state"),
        );
        const visible = [];
        for (const row of rows) {
          try {
            await authorizeResource({
              authorization,
              principal,
              context,
              action: "rfq.read",
              type: "rfq",
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
      }
      const queryRfq = url.searchParams.get("rfq_id");
      if (queryRfq) uuid(queryRfq, "rfq_id");
      const rows = await listQuotations(
        tx,
        pagination.limit,
        pagination.offset,
        queryRfq,
        url.searchParams.get("state"),
      );
      const visible = [];
      for (const row of rows) {
        try {
          await authorizeResource({
            authorization,
            principal,
            context,
            action: "quotation.read",
            type: "quotation",
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

  if (
    method === "GET" &&
    (rfqDetail || quoteDetail || rfqTimeline || quoteTimeline)
  ) {
    const isRfq = Boolean(rfqDetail || rfqTimeline);
    const id = (isRfq ? rfqId : quotationId)!;
    const data = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        context,
        action: isRfq ? "rfq.read" : "quotation.read",
        type: isRfq ? "rfq" : "quotation",
        id,
      });
      if (rfqTimeline || quoteTimeline)
        return readEntityTimeline({
          tx,
          entityType: isRfq ? "RFQ" : "QUOTATION",
          entityId: id,
        });
      return isRfq ? readRfq(tx, id) : readQuotation(tx, id);
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  if (
    method !== "POST" ||
    !(rfqCollection || rfqCommand || quoteCollection || quoteCommand)
  )
    return false;
  const body = await readBody(req);
  const idempotencyKey = key(req);
  const reason = requiredReason(body);
  const isRfq = rfqCollection || Boolean(rfqCommand);
  const isCreate = rfqCollection || quoteCollection;
  const commandPath = rfqCommand?.[2] ?? quoteCommand?.[2];
  const command = isCreate
    ? `${rfqCollection ? "RFQ" : "QUOTATION"}.CREATE`
    : `${rfqCommand ? "RFQ" : "QUOTATION"}.${commandPath!.toUpperCase().replaceAll("-", "_")}`;
  validatePayload(command, body);
  const action = permission(command);
  const entityType = isRfq ? "rfq" : "quotation";
  const id = rfqCommand?.[1] ?? quoteCommand?.[1] ?? "new";
  const expectedVersion = isCreate ? undefined : version(body);
  if (
    quoteCollection &&
    principal.actor_type === "SUPPLIER" &&
    String(body.supplier_id) !== principal.id
  )
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Supplier principals may create quotations only for their own Supplier.",
    );
  const result = await uow.run(principal.tenant_id, async (tx) => {
    await authorizeResource({
      authorization,
      principal,
      context,
      action,
      type: entityType,
      id,
    });
    return new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: command,
        businessScope: id,
        key: idempotencyKey,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        if (quoteCommand && principal.actor_type === "SUPPLIER") {
          const quote = await readQuotation(tx, quotationId!);
          if (quote.supplier_id !== principal.id)
            throw new ApplicationError(
              "PERMISSION_DENIED",
              "Supplier principal cannot change another Supplier's quotation.",
            );
        }
        let value;
        try {
          value = await executeRfqCommand({
            tx,
            actorId: principal.id,
            correlationId: context.correlation_id,
            reason,
            command,
            ...(isCreate ? {} : { id }),
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
            body,
          });
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "23505"
          )
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "A submitted quotation already exists for this RFQ and Supplier or the revision number is already used.",
            );
          throw error;
        }
        let parentEventId: string | null = null;
        for (const event of value.events) {
          if (event.aggregateType === "QUOTATION" && parentEventId) {
            if (command === "RFQ.AWARD") {
              if (event.type === "QUOTATION.VOIDED") {
                event.payload.rfq_decision_event_id = parentEventId;
                event.payload.decision = "RFQ_AWARDED";
              } else {
                event.payload.decision_event_id = parentEventId;
              }
              if (event.type === "QUOTATION.ACCEPTED")
                event.payload.award_event_id = parentEventId;
              else if (event.type === "QUOTATION.REJECTED")
                event.payload.decision = "AWARD_OTHER_QUOTATION";
            } else if (command === "RFQ.CLOSE_NO_AWARD") {
              if (event.type === "QUOTATION.VOIDED")
                event.payload.rfq_decision_event_id = parentEventId;
              else event.payload.decision_event_id = parentEventId;
              event.payload.decision = "RFQ_CLOSED_NO_AWARD";
            } else if (command === "RFQ.CANCEL") {
              event.payload.rfq_decision_event_id = parentEventId;
              event.payload.decision = "RFQ_CANCELLED";
              event.payload.rfq_cancelled_event_id = parentEventId;
            }
          }
          const eventId = await appendEffects({
            tx,
            event,
            config,
            principal,
            context,
            key: idempotencyKey,
            command,
            reason,
          });
          if (event.aggregateType === "RFQ") parentEventId = eventId;
        }
        return { status: value.status, body: value.data as never };
      },
    );
  });
  json(res, result.status, { data: result.body, meta: context });
  return true;
}
