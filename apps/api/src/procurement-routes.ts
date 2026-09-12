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
import { assertActiveUser } from "../../../modules/identity/index.js";
import {
  createProcurementRequest,
  createSupplier,
  listProcurementRequests,
  listSuppliers,
  readProcurementRequest,
  readSupplier,
  submitProcurementRequest,
  transitionSupplier,
  updateSupplierProfile,
  type ProcurementRequestInput,
  type SupplierContact,
  type SupplierProfile,
} from "../../../modules/procurement/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Context = CorrelationContext;
type Input = Record<string, unknown>;

async function readBody(req: IncomingMessage): Promise<Input> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 65536)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
  }
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Input;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}

function allowFields(input: Input, fields: readonly string[]) {
  if (Object.keys(input).some((field) => !fields.includes(field)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request has unsupported fields.",
    );
}

function requiredText(input: Input, field: string, max = 2000) {
  const value = input[field];
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} is invalid or missing.`,
    );
  return value.trim();
}

function optionalText(
  input: Input,
  field: string,
  max = 2000,
): string | null | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be text of at most ${max} characters.`,
    );
  return value.trim();
}

function safeReason(input: Input) {
  const reason = requiredText(input, "reason");
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

function version(input: Input) {
  if (
    !Number.isSafeInteger(input.expected_version) ||
    Number(input.expected_version) < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version must be a positive integer.",
    );
  return Number(input.expected_version);
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

function stringArray(input: Input, field: string, maxCount = 40) {
  const value = input[field];
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > maxCount ||
    value.some(
      (v) => typeof v !== "string" || !v.trim() || v.trim().length > 120,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be a bounded list of non-empty strings.`,
    );
  return value.map((v) => (v as string).trim());
}

function contacts(input: Input): SupplierContact[] {
  if (input.contacts === undefined) return [];
  if (!Array.isArray(input.contacts) || input.contacts.length > 50)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "contacts must be an array with at most 50 entries.",
    );
  return input.contacts.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Each contact must be an object.",
      );
    const contact = entry as Input;
    allowFields(contact, ["name", "email", "phone", "role"]);
    const result: SupplierContact = {
      name: requiredText(contact, "name", 200),
    };
    for (const field of ["email", "phone", "role"] as const) {
      const value = optionalText(contact, field, 320);
      if (value !== undefined) result[field] = value;
    }
    return result;
  });
}

function supplierProfile(input: Input, creating: boolean): SupplierProfile {
  allowFields(input, [
    "legal_name",
    "tax_identifier",
    "address",
    "categories",
    "risk_state",
    "bank_info_reference",
    "contacts",
    "reason",
  ]);
  const profile: SupplierProfile = {};
  if (creating || input.legal_name !== undefined)
    profile.legal_name = requiredText(input, "legal_name", 240);
  for (const [field, max] of [
    ["tax_identifier", 120],
    ["address", 1000],
    ["risk_state", 120],
    ["bank_info_reference", 500],
  ] as const) {
    const value = optionalText(input, field, max);
    if (value !== undefined) profile[field] = value;
  }
  if (input.categories !== undefined)
    profile.categories = stringArray(input, "categories");
  if (input.contacts !== undefined) profile.contacts = contacts(input);
  return profile;
}

function requestInput(input: Input): ProcurementRequestInput {
  allowFields(input, [
    "requester_user_id",
    "source_type",
    "source_id",
    "business_reason",
    "target_date",
    "cost_center_id",
    "project_id",
    "estimated_total",
    "currency",
    "priority",
    "lines",
  ]);
  if (
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > 100
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "lines must contain between 1 and 100 entries.",
    );
  const lines = input.lines.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Each request line must be an object.",
      );
    const line = entry as Input;
    allowFields(line, [
      "item_type",
      "item_reference_id",
      "description",
      "quantity",
      "estimated_unit_price",
    ]);
    if (
      typeof line.quantity !== "number" ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "line quantity must be greater than zero.",
      );
    if (
      line.estimated_unit_price !== undefined &&
      line.estimated_unit_price !== null &&
      (typeof line.estimated_unit_price !== "number" ||
        !Number.isFinite(line.estimated_unit_price) ||
        line.estimated_unit_price < 0)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "estimated_unit_price must be non-negative.",
      );
    return {
      item_type: requiredText(line, "item_type", 80),
      item_reference_id: optionalText(line, "item_reference_id", 256) ?? null,
      description: requiredText(line, "description", 1000),
      quantity: line.quantity,
      estimated_unit_price:
        (line.estimated_unit_price as number | null | undefined) ?? null,
    };
  });
  const targetDate = requiredText(input, "target_date", 10);
  const parsedTargetDate = new Date(`${targetDate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) ||
    Number.isNaN(parsedTargetDate.getTime()) ||
    parsedTargetDate.toISOString().slice(0, 10) !== targetDate
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "target_date must be an ISO calendar date.",
    );
  const estimatedTotal = input.estimated_total;
  if (
    estimatedTotal !== undefined &&
    estimatedTotal !== null &&
    (typeof estimatedTotal !== "number" ||
      !Number.isFinite(estimatedTotal) ||
      estimatedTotal < 0)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "estimated_total must be non-negative.",
    );
  const currency = optionalText(input, "currency", 3);
  if (
    (estimatedTotal === undefined || estimatedTotal === null) !==
    (currency === undefined || currency === null)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "estimated_total and currency must be provided together.",
    );
  if (currency && !/^[A-Z]{3}$/.test(currency))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "currency must be a three-letter uppercase code.",
    );
  const costCenter = optionalText(input, "cost_center_id", 256);
  const project = optionalText(input, "project_id", 256);
  if (!costCenter && !project)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "cost_center_id or project_id is required.",
    );
  const sourceType = requiredText(input, "source_type", 80).toUpperCase();
  const supportedSources = new Set([
    "USER_ASSET_REQUEST",
    "REPLACEMENT_PLAN",
    "WAREHOUSE_REORDER",
    "MAINTENANCE_PART_REQUEST",
    "WARRANTY_RENEWAL",
    "LICENSE_RENEWAL",
    "SOFTWARE_REQUEST",
    "CONTRACT_RENEWAL",
    "NETWORK_EXPANSION",
    "MANUAL_REQUEST",
  ]);
  if (!supportedSources.has(sourceType))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "source_type is unsupported.",
    );
  const sourceId = optionalText(input, "source_id", 256);
  if (sourceType !== "MANUAL_REQUEST" && !sourceId)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "source_id is required for linked request types.",
    );
  const businessReason = requiredText(input, "business_reason");
  if (
    /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
      businessReason,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "business_reason must not contain credentials or secrets.",
    );
  return {
    requester_user_id: uuid(
      requiredText(input, "requester_user_id", 36),
      "requester_user_id",
    ),
    source_type: sourceType,
    source_id: sourceId ?? null,
    business_reason: businessReason,
    target_date: targetDate,
    cost_center_id: costCenter ?? null,
    project_id: project ?? null,
    estimated_total: (estimatedTotal as number | null | undefined) ?? null,
    currency: currency ?? null,
    priority: optionalText(input, "priority", 40) ?? null,
    lines,
  };
}

async function authorizeResource(input: {
  authorization: AuthorizationPort;
  principal: Principal;
  action: string;
  type: string;
  id: string;
  context: Context;
  scope?: Record<string, string>;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: {
      type: input.type,
      id: input.id,
      tenant_id: input.principal.tenant_id,
    },
    scope: input.scope ?? {},
    context: { ...input.context },
  });
}

async function appendEffects(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: Context;
  key: string;
  eventType: string;
  command: string;
  aggregateType: string;
  aggregateId: string;
  version: number;
  reason: string;
  before: unknown;
  after: Record<string, unknown>;
  eventPayload: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const eventId = randomUUID();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: eventId,
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
    payload: input.eventPayload as never,
  });
  if (
    input.aggregateType === "SUPPLIER" ||
    input.aggregateType === "PROCUREMENT_REQUEST"
  )
    await recordProcurementTimelineEvent({
      tx: input.tx,
      entityType: input.aggregateType,
      entityId: input.aggregateId,
      eventType: input.eventType,
      payload: input.eventPayload,
      sourceEventId: eventId,
    });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.eventType,
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: {
      command_type: input.command,
      idempotency_key: input.key,
    },
    subject: { entity_type: input.aggregateType, entity_id: input.aggregateId },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.command, text: input.reason },
    before: input.before as never,
    after: input.after as never,
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
}

function intent(input: {
  principal: Principal;
  operation: string;
  scope: string;
  key: string;
  body: Input;
}) {
  return {
    principalId: input.principal.id,
    operation: input.operation,
    businessScope: input.scope,
    key: input.key,
    semanticRequest: input.body as never,
    expiresAt: new Date(Date.now() + 86400000),
  };
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

function isPermissionDenied(error: unknown) {
  return (
    error instanceof ApplicationError && error.code === "PERMISSION_DENIED"
  );
}

function mapConflict(error: unknown, message: string): never {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  )
    throw new ApplicationError("BUSINESS_RULE_VIOLATION", message);
  throw error;
}

export async function handleProcurementRoute(input: {
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
  const supplierCollection = path === "/api/v1/suppliers";
  const supplierDetail = /^\/api\/v1\/suppliers\/([^/]+)$/.exec(path);
  const supplierTimeline = /^\/api\/v1\/suppliers\/([^/]+)\/timeline$/.exec(
    path,
  );
  const supplierCommand =
    /^\/api\/v1\/suppliers\/([^/]+)\/commands\/([a-z-]+)$/.exec(path);
  const requestCollection = path === "/api/v1/procurement-requests";
  const requestDetail = /^\/api\/v1\/procurement-requests\/([^/]+)$/.exec(path);
  const requestTimeline =
    /^\/api\/v1\/procurement-requests\/([^/]+)\/timeline$/.exec(path);
  const requestSubmit =
    /^\/api\/v1\/procurement-requests\/([^/]+)\/commands\/submit$/.exec(path);
  const supplierId =
    supplierDetail?.[1] ?? supplierTimeline?.[1] ?? supplierCommand?.[1];
  const requestId =
    requestDetail?.[1] ?? requestTimeline?.[1] ?? requestSubmit?.[1];
  if (supplierId) uuid(supplierId, "supplier_id");
  if (requestId) uuid(requestId, "procurement_request_id");
  const matched =
    supplierCollection ||
    supplierDetail ||
    supplierTimeline ||
    supplierCommand ||
    requestCollection ||
    requestDetail ||
    requestTimeline ||
    requestSubmit;
  if (!matched) return false;

  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  const key = method === "POST" ? idempotencyKey(req) : undefined;

  if (method === "GET" && supplierCollection) {
    const pagination = page(url);
    const state = url.searchParams.get("state");
    const data = await uow.run(principal.tenant_id, async (tx) => {
      const rows = await listSuppliers(tx, { ...pagination, state });
      const visible = [];
      for (const row of rows) {
        try {
          await authorizeResource({
            authorization,
            principal,
            action: "supplier.read",
            type: "supplier",
            id: row.id,
            context,
          });
          visible.push(row);
        } catch (error) {
          if (!isPermissionDenied(error)) throw error;
        }
      }
      return visible;
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  if (method === "GET" && supplierDetail) {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        action: "supplier.read",
        type: "supplier",
        id: supplierDetail[1]!,
        context,
      });
      return readSupplier(tx, supplierDetail[1]!);
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  if (method === "GET" && supplierTimeline) {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        action: "supplier.read",
        type: "supplier",
        id: supplierTimeline[1]!,
        context,
      });
      await readSupplier(tx, supplierTimeline[1]!);
      return readEntityTimeline({
        tx,
        entityType: "SUPPLIER",
        entityId: supplierTimeline[1]!,
      });
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  if (method === "GET" && requestCollection) {
    const pagination = page(url);
    const state = url.searchParams.get("state");
    const data = await uow.run(principal.tenant_id, async (tx) => {
      const rows = await listProcurementRequests(tx, { ...pagination, state });
      const visible = [];
      for (const row of rows) {
        try {
          await authorizeResource({
            authorization,
            principal,
            action: "procurement.request.read",
            type: "procurement_request",
            id: String(row.id),
            context,
            scope: {
              ...(typeof row.cost_center_id === "string"
                ? { cost_center: row.cost_center_id }
                : {}),
              ...(typeof row.project_id === "string"
                ? { project: row.project_id }
                : {}),
            },
          });
          visible.push(row);
        } catch (error) {
          if (!isPermissionDenied(error)) throw error;
        }
      }
      return visible;
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  if (method === "GET" && requestDetail) {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      const row = await readProcurementRequest(tx, requestDetail[1]!);
      await authorizeResource({
        authorization,
        principal,
        action: "procurement.request.read",
        type: "procurement_request",
        id: String(row.id),
        context,
        scope: {
          ...(typeof row.cost_center_id === "string"
            ? { cost_center: row.cost_center_id }
            : {}),
          ...(typeof row.project_id === "string"
            ? { project: row.project_id }
            : {}),
        },
      });
      return row;
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  if (method === "GET" && requestTimeline) {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      const row = await readProcurementRequest(tx, requestTimeline[1]!);
      await authorizeResource({
        authorization,
        principal,
        action: "procurement.request.read",
        type: "procurement_request",
        id: requestTimeline[1]!,
        context,
        scope: {
          ...(typeof row.cost_center_id === "string"
            ? { cost_center: row.cost_center_id }
            : {}),
          ...(typeof row.project_id === "string"
            ? { project: row.project_id }
            : {}),
        },
      });
      return readEntityTimeline({
        tx,
        entityType: "PROCUREMENT_REQUEST",
        entityId: requestTimeline[1]!,
      });
    });
    json(res, 200, { data, meta: context });
    return true;
  }

  if (method !== "POST") return false;
  const body = await readBody(req);

  if (supplierCollection) {
    const profile = supplierProfile(body, true) as SupplierProfile & {
      legal_name: string;
    };
    const reason = safeReason(body);
    const storeResponse = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        action: "supplier.create",
        type: "supplier",
        id: "new",
        context,
      });
      return new PostgresIdempotencyStore(tx).execute(
        intent({
          principal,
          operation: "SUPPLIER.CREATE",
          scope: "new",
          key: key!,
          body,
        }),
        async () => {
          try {
            const supplier = await createSupplier({
              tx,
              actorId: principal.id,
              reason,
              correlationId: context.correlation_id,
              profile,
            });
            const eventPayload = {
              supplier_id: supplier.id,
              code: supplier.code,
              version: supplier.version,
              reason,
              previous_state: null,
              new_state: "PROSPECT",
            };
            await appendEffects({
              tx,
              config,
              principal,
              context,
              key: key!,
              eventType: "SUPPLIER.CREATED",
              command: "SUPPLIER.CREATE",
              aggregateType: "SUPPLIER",
              aggregateId: supplier.id,
              version: supplier.version,
              reason,
              before: null,
              after: {
                id: supplier.id,
                code: supplier.code,
                state: supplier.state,
                version: supplier.version,
              },
              eventPayload,
            });
            return { status: 201, body: supplier as never };
          } catch (error) {
            mapConflict(
              error,
              "Supplier code or tax identifier already exists in this tenant.",
            );
          }
        },
      );
    });
    json(res, storeResponse.status, {
      data: storeResponse.body,
      meta: context,
    });
    return true;
  }

  if (supplierCommand) {
    const routeCommand = supplierCommand[2]!;
    const commandByRoute: Record<string, string> = {
      "update-profile": "UPDATE_PROFILE",
      approve: "APPROVE",
      "mark-preferred": "MARK_PREFERRED",
      "remove-preferred": "REMOVE_PREFERRED",
      suspend: "SUSPEND",
      resume: "RESUME",
      block: "BLOCK",
      unblock: "UNBLOCK",
      deactivate: "DEACTIVATE",
      reactivate: "REACTIVATE",
    };
    const command = commandByRoute[routeCommand];
    if (!command)
      throw new ApplicationError(
        "NOT_FOUND",
        "Supplier command was not found.",
      );
    const permission =
      command === "UPDATE_PROFILE"
        ? "supplier.update"
        : ["APPROVE", "MARK_PREFERRED", "REMOVE_PREFERRED"].includes(command)
          ? "supplier.approve"
          : ["BLOCK", "UNBLOCK"].includes(command)
            ? "supplier.block"
            : "supplier.status.change";
    const reason = safeReason(body);
    const expectedVersion = version(body);
    const profileInput = { ...body };
    delete profileInput.expected_version;
    const profile =
      command === "UPDATE_PROFILE"
        ? supplierProfile(profileInput, false)
        : undefined;
    if (command !== "UPDATE_PROFILE")
      allowFields(body, ["expected_version", "reason"]);
    const storeResponse = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        action: permission,
        type: "supplier",
        id: supplierCommand[1]!,
        context,
      });
      return new PostgresIdempotencyStore(tx).execute(
        intent({
          principal,
          operation: `SUPPLIER.${command}`,
          scope: supplierCommand[1]!,
          key: key!,
          body,
        }),
        async () => {
          const before = await readSupplier(tx, supplierCommand[1]!);
          if (before.version !== expectedVersion)
            throw new ApplicationError(
              "VERSION_CONFLICT",
              "Supplier version changed.",
            );
          if (command === "UPDATE_PROFILE") {
            const updated = await updateSupplierProfile({
              tx,
              supplierId: supplierCommand[1]!,
              expectedVersion,
              profile: profile!,
              actorId: principal.id,
              reason,
              correlationId: context.correlation_id,
            });
            const eventPayload = {
              supplier_id: updated.id,
              version: updated.version,
              reason,
              changed_fields: updated.changed_fields,
            };
            await appendEffects({
              tx,
              config,
              principal,
              context,
              key: key!,
              eventType: "SUPPLIER.UPDATED",
              command: "SUPPLIER.UPDATE_PROFILE",
              aggregateType: "SUPPLIER",
              aggregateId: updated.id,
              version: updated.version,
              reason,
              before: { state: before.state, version: before.version },
              after: {
                state: updated.state,
                version: updated.version,
                changed_fields: updated.changed_fields,
              },
              eventPayload,
            });
            return { status: 200, body: updated as never };
          }
          const changed = await transitionSupplier({
            tx,
            supplierId: supplierCommand[1]!,
            expectedVersion,
            command,
            actorId: principal.id,
            reason,
            correlationId: context.correlation_id,
          });
          const eventPayload = {
            supplier_id: supplierCommand[1]!,
            version: changed.value.version,
            reason,
            previous_state: changed.value.previous_state,
            new_state: changed.value.state,
          };
          await appendEffects({
            tx,
            config,
            principal,
            context,
            key: key!,
            eventType: changed.eventType,
            command: `SUPPLIER.${command}`,
            aggregateType: "SUPPLIER",
            aggregateId: supplierCommand[1]!,
            version: changed.value.version,
            reason,
            before: { state: before.state, version: before.version },
            after: {
              state: changed.value.state,
              version: changed.value.version,
            },
            eventPayload,
          });
          return { status: 200, body: changed.value as never };
        },
      );
    });
    json(res, storeResponse.status, {
      data: storeResponse.body,
      meta: context,
    });
    return true;
  }

  if (requestCollection) {
    const request = requestInput(body);
    const reason = request.business_reason;
    const requestScope = {
      ...(request.cost_center_id
        ? { cost_center: request.cost_center_id }
        : {}),
      ...(request.project_id ? { project: request.project_id } : {}),
    };
    const storeResponse = await uow.run(principal.tenant_id, async (tx) => {
      await authorizeResource({
        authorization,
        principal,
        action: "procurement.request.create",
        type: "procurement_request",
        id: "new",
        context,
        scope: requestScope,
      });
      await assertActiveUser({ tx, userId: request.requester_user_id });
      return new PostgresIdempotencyStore(tx).execute(
        intent({
          principal,
          operation: "PROCUREMENT.REQUEST_CREATE",
          scope: "new",
          key: key!,
          body,
        }),
        async () => {
          try {
            const created = await createProcurementRequest({
              tx,
              actorId: principal.id,
              reason,
              correlationId: context.correlation_id,
              request,
            });
            const eventPayload = {
              procurement_request_id: created.id,
              request_code: created.request_code,
              requester_user_id: created.requester_user_id,
              source_type: created.source_type,
              source_id: created.source_id,
              state: created.state,
              version: created.version,
              estimated_total: created.estimated_total,
              currency: created.currency,
            };
            await appendEffects({
              tx,
              config,
              principal,
              context,
              key: key!,
              eventType: "PROCUREMENT.REQUEST_CREATED",
              command: "PROCUREMENT.REQUEST_CREATE",
              aggregateType: "PROCUREMENT_REQUEST",
              aggregateId: String(created.id),
              version: Number(created.version),
              reason,
              before: null,
              after: created,
              eventPayload,
            });
            return { status: 201, body: created as never };
          } catch (error) {
            mapConflict(
              error,
              "A request with this active source reference already exists.",
            );
          }
        },
      );
    });
    json(res, storeResponse.status, {
      data: storeResponse.body,
      meta: context,
    });
    return true;
  }

  if (requestSubmit) {
    allowFields(body, ["expected_version", "reason"]);
    const expectedVersion = version(body);
    const reason = safeReason(body);
    const storeResponse = await uow.run(principal.tenant_id, async (tx) => {
      const before = await readProcurementRequest(tx, requestSubmit[1]!);
      const scope = {
        ...(typeof before.cost_center_id === "string"
          ? { cost_center: before.cost_center_id }
          : {}),
        ...(typeof before.project_id === "string"
          ? { project: before.project_id }
          : {}),
      };
      await authorizeResource({
        authorization,
        principal,
        action: "procurement.request.create",
        type: "procurement_request",
        id: requestSubmit[1]!,
        context,
        scope,
      });
      return new PostgresIdempotencyStore(tx).execute(
        intent({
          principal,
          operation: "PROCUREMENT.REQUEST_SUBMIT",
          scope: requestSubmit[1]!,
          key: key!,
          body,
        }),
        async () => {
          const updated = await submitProcurementRequest({
            tx,
            id: requestSubmit[1]!,
            expectedVersion,
            actorId: principal.id,
            reason,
            correlationId: context.correlation_id,
          });
          const eventPayload = {
            procurement_request_id: updated.id,
            requester_user_id: updated.requester_user_id,
            source_type: updated.source_type,
            source_id: updated.source_id,
            estimated_total: updated.estimated_total,
            currency: updated.currency,
            state: updated.state,
            version: updated.version,
            reason,
          };
          await appendEffects({
            tx,
            config,
            principal,
            context,
            key: key!,
            eventType: "PROCUREMENT.REQUESTED",
            command: "PROCUREMENT.REQUEST_SUBMIT",
            aggregateType: "PROCUREMENT_REQUEST",
            aggregateId: String(updated.id),
            version: Number(updated.version),
            reason,
            before: { state: before.state, version: before.version },
            after: updated,
            eventPayload,
          });
          return { status: 200, body: updated as never };
        },
      );
    });
    json(res, storeResponse.status, {
      data: storeResponse.body,
      meta: context,
    });
    return true;
  }
  return false;
}
