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
  executeInvoiceCommand,
  listCreditNotes,
  listInvoices,
  readCreditNote,
  readInvoice,
  type InvoiceCommand,
  type InvoiceEvent,
} from "../../../modules/procurement/index.js";
import {
  readEntityTimeline,
  recordProcurementTimelineEvent,
  resolveInvoiceWorkItem,
  upsertInvoiceWorkItem,
} from "../../../modules/work-queue/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Context = CorrelationContext;
type Body = Record<string, unknown>;

function send(res: ServerResponse, status: number, body: unknown) {
  json(res, status, body as never);
}

async function readBody(req: IncomingMessage): Promise<Body> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 1_000_000)
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

function allowFields(body: Body, fields: string[]) {
  const unexpected = Object.keys(body).find((field) => !fields.includes(field));
  if (unexpected)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `Unexpected field: ${unexpected}.`,
    );
}

function idempotencyKey(req: IncomingMessage) {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim() || key.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return key.trim();
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

function optionalReason(body: Body) {
  const value = body.reason;
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2000)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "reason must be non-empty text of at most 2000 characters.",
    );
  if (
    /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
      value,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "reason must not contain credentials or secrets.",
    );
  return value.trim();
}

function page(url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Invalid pagination values.",
    );
  return { limit, offset };
}

async function authorizeResource(input: {
  authorization: AuthorizationPort;
  principal: Principal;
  action: string;
  type: "invoice" | "credit_note";
  id: string;
  context: Context;
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

function baseError(
  code: "INVOICE_DUPLICATE" | "INVOICE_MATCH_EXCEPTION_REQUIRED",
  message: string,
  context: Context,
  details: Record<string, unknown>,
) {
  const mapped = errorResponse(new ApplicationError(code, message), context);
  mapped.body.error.details = details;
  return mapped.body;
}

async function appendEventEffects(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: Context;
  key: string;
  command: InvoiceCommand;
  reason: string | null;
  events: InvoiceEvent[];
}) {
  for (const item of input.events) {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    await new PostgresOutboxWriter(input.tx).append({
      event_id: eventId,
      event_type: item.type,
      schema_version: 1,
      occurred_at: occurredAt,
      producer: { service: input.config.serviceName, instance: "api" },
      aggregate: {
        type: item.aggregateType,
        id: item.aggregateId,
        version: item.version,
      },
      actor: { type: input.principal.actor_type, id: input.principal.id },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      tenant_id: input.principal.tenant_id,
      organization_id: input.principal.tenant_id,
      idempotency_key: input.key,
      payload: item.payload as never,
    });
    await recordProcurementTimelineEvent({
      tx: input.tx,
      entityType: item.aggregateType,
      entityId: item.aggregateId,
      eventType: item.type,
      payload: item.payload,
      sourceEventId: eventId,
    });
    const purchaseOrderId = item.payload.purchase_order_id;
    const relatedPayload = { ...item.payload, source_event_id: eventId };
    if (item.aggregateType === "INVOICE" && typeof purchaseOrderId === "string")
      await recordProcurementTimelineEvent({
        tx: input.tx,
        entityType: "PURCHASE_ORDER",
        entityId: purchaseOrderId,
        eventType: item.type,
        payload: relatedPayload,
        sourceEventId: randomUUID(),
      });
    if (item.aggregateType === "CREDIT_NOTE") {
      if (typeof item.payload.invoice_id === "string")
        await recordProcurementTimelineEvent({
          tx: input.tx,
          entityType: "INVOICE",
          entityId: item.payload.invoice_id,
          eventType: item.type,
          payload: relatedPayload,
          sourceEventId: randomUUID(),
        });
      if (typeof purchaseOrderId === "string")
        await recordProcurementTimelineEvent({
          tx: input.tx,
          entityType: "PURCHASE_ORDER",
          entityId: purchaseOrderId,
          eventType: item.type,
          payload: relatedPayload,
          sourceEventId: randomUUID(),
        });
    }
    const duplicateCandidate =
      item.type === "INVOICE.DUPLICATE_DETECTED" &&
      item.payload.reason_code === "POTENTIAL_DUPLICATE";
    if (duplicateCandidate)
      await upsertInvoiceWorkItem({
        tx: input.tx,
        sourceType: "INVOICE_DUPLICATE",
        documentId: item.aggregateId,
        title: `Potential duplicate ${item.aggregateType === "CREDIT_NOTE" ? "Credit Note" : "Invoice"} requires review`,
        priority: "MEDIUM",
      });
    if (item.type === "INVOICE.MATCH_EXCEPTION_CREATED")
      await upsertInvoiceWorkItem({
        tx: input.tx,
        sourceType: "INVOICE_MATCH_EXCEPTION",
        documentId: item.aggregateId,
        title: "Blocking Invoice 3-Way Match exception requires review",
        priority: "HIGH",
      });
    if (
      item.type === "INVOICE.MATCHED" ||
      item.type === "INVOICE.MATCH_EXCEPTION_ACCEPTED" ||
      item.type === "INVOICE.REJECTED"
    )
      await resolveInvoiceWorkItem({
        tx: input.tx,
        sourceType: "INVOICE_MATCH_EXCEPTION",
        documentId: item.aggregateId,
      });

    const failedDuplicate =
      item.type === "INVOICE.DUPLICATE_DETECTED" &&
      item.payload.reason_code === "DUPLICATE_INVOICE";
    const safeBefore = item.before ? { ...item.before } : null;
    const safeAfter = { ...item.after };
    await new PostgresAudit(input.tx).append({
      id: randomUUID(),
      tenant_id: input.principal.tenant_id,
      event_type: item.type,
      occurred_at: occurredAt,
      actor: { type: input.principal.actor_type, id: input.principal.id },
      action: { command_type: input.command, idempotency_key: input.key },
      subject: { entity_type: item.aggregateType, entity_id: item.aggregateId },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      reason: { code: input.command, text: input.reason ?? input.command },
      before: safeBefore as never,
      after: { ...safeAfter, event_references: item.payload } as never,
      outcome: failedDuplicate ? { status: "FAILURE" } : { status: "SUCCESS" },
      classification: "INTERNAL",
      relations:
        typeof item.payload.purchase_order_id === "string"
          ? [
              {
                entity_type: "PURCHASE_ORDER",
                entity_id: item.payload.purchase_order_id,
                relation: "INVOICE_PO",
              },
            ]
          : [],
      evidence: [],
    });
  }
}

const invoiceFields = [
  "supplier_id",
  "supplier_document_number",
  "invoice_date",
  "currency",
  "tax_amount",
  "charges",
  "gross_amount",
  "purchase_order_id",
  "lines",
  "reason",
];
const creditFields = [
  "invoice_id",
  "supplier_id",
  "supplier_document_number",
  "document_date",
  "currency",
  "lines",
  "reason",
];

export async function handleInvoiceRoute(input: {
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
  const invoiceCollection = path === "/api/v1/invoices";
  const invoiceTimeline = /^\/api\/v1\/invoices\/([^/]+)\/timeline$/.exec(path);
  const invoiceCommandMatch =
    /^\/api\/v1\/invoices\/([^/]+)\/commands\/([a-z-]+)$/.exec(path);
  const invoiceDetail = /^\/api\/v1\/invoices\/([^/]+)$/.exec(path);
  const creditCollection = path === "/api/v1/credit-notes";
  const creditTimeline = /^\/api\/v1\/credit-notes\/([^/]+)\/timeline$/.exec(
    path,
  );
  const creditCommandMatch =
    /^\/api\/v1\/credit-notes\/([^/]+)\/commands\/([a-z-]+)$/.exec(path);
  const creditDetail = /^\/api\/v1\/credit-notes\/([^/]+)$/.exec(path);
  const matched =
    invoiceCollection ||
    invoiceTimeline ||
    invoiceCommandMatch ||
    invoiceDetail ||
    creditCollection ||
    creditTimeline ||
    creditCommandMatch ||
    creditDetail;
  if (!matched) return false;
  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  const body = method === "POST" ? await readBody(req) : {};

  if (method === "GET" && invoiceCollection) {
    const pagination = page(url);
    const state = url.searchParams.get("state");
    const poId = url.searchParams.get("purchase_order_id");
    if (poId) uuid(poId, "purchase_order_id");
    const rows = await uow.run(principal.tenant_id, async (tx) =>
      listInvoices(tx, {
        ...pagination,
        lifecycleState: state,
        purchaseOrderId: poId,
      }),
    );
    const visible = [];
    for (const row of rows) {
      try {
        await authorizeResource({
          authorization,
          principal,
          action: "invoice.read",
          type: "invoice",
          id: String(row.id),
          context,
        });
        visible.push(row);
      } catch (error) {
        if (
          !(error instanceof ApplicationError) ||
          error.code !== "PERMISSION_DENIED"
        )
          throw error;
      }
    }
    send(res, 200, { data: visible, meta: context });
    return true;
  }

  if (method === "GET" && creditCollection) {
    const pagination = page(url);
    const state = url.searchParams.get("state");
    const invoiceId = url.searchParams.get("invoice_id");
    if (invoiceId) uuid(invoiceId, "invoice_id");
    const rows = await uow.run(principal.tenant_id, async (tx) =>
      listCreditNotes(tx, { ...pagination, lifecycleState: state, invoiceId }),
    );
    const visible = [];
    for (const row of rows) {
      try {
        await authorizeResource({
          authorization,
          principal,
          action: "credit_note.read",
          type: "credit_note",
          id: String(row.id),
          context,
        });
        visible.push(row);
      } catch (error) {
        if (
          !(error instanceof ApplicationError) ||
          error.code !== "PERMISSION_DENIED"
        )
          throw error;
      }
    }
    send(res, 200, { data: visible, meta: context });
    return true;
  }

  const readId =
    invoiceDetail?.[1] ??
    invoiceTimeline?.[1] ??
    invoiceCommandMatch?.[1] ??
    creditDetail?.[1] ??
    creditTimeline?.[1] ??
    creditCommandMatch?.[1];
  if (readId)
    uuid(
      readId,
      invoiceDetail || invoiceTimeline || invoiceCommandMatch
        ? "invoice_id"
        : "credit_note_id",
    );

  if (method === "GET" && (invoiceDetail || invoiceTimeline)) {
    const id = readId!;
    const data = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        action: "invoice.read",
        type: "invoice",
        id,
        context,
      });
      return invoiceTimeline
        ? readEntityTimeline({ tx, entityType: "INVOICE", entityId: id })
        : readInvoice(tx, id);
    });
    send(res, 200, { data, meta: context });
    return true;
  }

  if (method === "GET" && (creditDetail || creditTimeline)) {
    const id = readId!;
    const data = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        action: "credit_note.read",
        type: "credit_note",
        id,
        context,
      });
      return creditTimeline
        ? readEntityTimeline({ tx, entityType: "CREDIT_NOTE", entityId: id })
        : readCreditNote(tx, id);
    });
    send(res, 200, { data, meta: context });
    return true;
  }

  if (method !== "POST")
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported Invoice/Credit Note method.",
    );
  const key = idempotencyKey(req);
  let command: InvoiceCommand;
  let action: string;
  let resourceType: "invoice" | "credit_note";
  let create: boolean;
  if (invoiceCollection) {
    allowFields(body, invoiceFields);
    command = "INVOICE.CREATE";
    action = "invoice.create";
    resourceType = "invoice";
    create = true;
  } else if (creditCollection) {
    allowFields(body, creditFields);
    command = "CREDIT_NOTE.CREATE";
    action = "credit_note.create";
    resourceType = "credit_note";
    create = true;
  } else {
    if (!invoiceCommandMatch && !creditCommandMatch)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unsupported command route.",
      );
    const isInvoice = Boolean(invoiceCommandMatch);
    const actionName = (invoiceCommandMatch?.[2] ?? creditCommandMatch?.[2])!;
    const map: Record<
      string,
      { command: InvoiceCommand; action: string; bodyFields: string[] }
    > = isInvoice
      ? {
          "update-draft": {
            command: "INVOICE.UPDATE_DRAFT",
            action: "invoice.update",
            bodyFields: invoiceFields,
          },
          cancel: {
            command: "INVOICE.CANCEL",
            action: "invoice.update",
            bodyFields: ["expected_version", "reason"],
          },
          submit: {
            command: "INVOICE.SUBMIT",
            action: "invoice.submit",
            bodyFields: ["expected_version", "reason"],
          },
          "reevaluate-match": {
            command: "INVOICE.REEVALUATE_MATCH",
            action: "invoice.match",
            bodyFields: ["expected_version", "reason"],
          },
          approve: {
            command: "INVOICE.APPROVE",
            action: "invoice.approve",
            bodyFields: ["expected_version", "reason"],
          },
          reject: {
            command: "INVOICE.REJECT",
            action: "invoice.reject",
            bodyFields: ["expected_version", "reason"],
          },
        }
      : {
          "update-draft": {
            command: "CREDIT_NOTE.UPDATE_DRAFT",
            action: "credit_note.update",
            bodyFields: [
              "supplier_document_number",
              "document_date",
              "lines",
              "reason",
            ],
          },
          cancel: {
            command: "CREDIT_NOTE.CANCEL",
            action: "credit_note.update",
            bodyFields: ["expected_version", "reason"],
          },
          submit: {
            command: "CREDIT_NOTE.SUBMIT",
            action: "credit_note.submit",
            bodyFields: ["expected_version", "reason"],
          },
          apply: {
            command: "CREDIT_NOTE.APPLY",
            action: "credit_note.apply",
            bodyFields: ["expected_version", "reason"],
          },
          reject: {
            command: "CREDIT_NOTE.REJECT",
            action: "credit_note.reject",
            bodyFields: ["expected_version", "reason"],
          },
        };
    const entry = map[actionName];
    if (!entry)
      throw new ApplicationError(
        "NOT_FOUND",
        "Invoice/Credit Note command was not found.",
      );
    allowFields(body, [
      ...entry.bodyFields,
      ...(entry.command.endsWith("UPDATE_DRAFT") ? ["expected_version"] : []),
    ]);
    command = entry.command;
    action = entry.action;
    resourceType = isInvoice ? "invoice" : "credit_note";
    create = false;
  }

  const id = invoiceCommandMatch?.[1] ?? creditCommandMatch?.[1];
  if (id)
    uuid(id, resourceType === "invoice" ? "invoice_id" : "credit_note_id");
  const expected = create ? undefined : expectedVersion(body);
  const reason = optionalReason(body);
  const scope =
    id ??
    (resourceType === "invoice"
      ? String(body.purchase_order_id ?? "new")
      : String(body.invoice_id ?? "new"));
  const response = await uow.run(principal.tenant_id, async (tx) => {
    if (create) {
      await authorize(authorization, {
        principal,
        action,
        resource: {
          type: resourceType,
          id: "new",
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
    } else {
      const current =
        resourceType === "invoice"
          ? await readInvoice(tx, id!)
          : await readCreditNote(tx, id!);
      await authorizeResource({
        authorization,
        principal,
        action,
        type: resourceType,
        id: id!,
        context,
      });
      void current;
    }
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
        const value = await executeInvoiceCommand({
          tx,
          command,
          ...(id ? { id } : {}),
          body,
          actorId: principal.id,
          ...(expected === undefined ? {} : { expectedVersion: expected }),
          correlationId: context.correlation_id,
          reason,
        });
        await appendEventEffects({
          tx,
          config,
          principal,
          context,
          key,
          command,
          reason,
          events: value.events,
        });
        if ("error_code" in value.data) {
          const message = String(
            value.data.message ?? "Duplicate supplier document.",
          );
          return {
            status: 409,
            body: baseError("INVOICE_DUPLICATE", message, context, {
              duplicate_document_id: value.data.duplicate_document_id ?? null,
            }) as never,
          };
        }
        return { status: value.status, body: value.data as never };
      },
    );
  });
  const responseBody = response.body as Record<string, unknown>;
  send(
    res,
    response.status,
    responseBody && typeof responseBody.error === "object"
      ? responseBody
      : responseBody && typeof responseBody.error_code === "string"
        ? {
            error: {
              code: responseBody.error_code,
              message: responseBody.message,
              details: responseBody.details,
            },
            meta: context,
          }
        : { data: response.body, meta: context },
  );
  return true;
}
