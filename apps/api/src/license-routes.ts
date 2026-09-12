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
  createLicenseEntitlement,
  createLicensePool,
  listLicenseEntitlements,
  listLicensePools,
  readLicenseEntitlement,
  readLicensePool,
  renewLicenseEntitlement,
  updateLicenseEntitlement,
  updateLicensePool,
  createLicenseAssignment,
  transitionLicenseAssignment,
  recordLicenseUsageObservation,
  listLicenseCompliance,
  readLicenseAvailability,
  readLicenseAssignment,
} from "../../../modules/license/index.js";
import { assertAssetEligibleForLicense } from "../../../modules/asset/index.js";
import { assertActiveLicenseUser } from "../../../modules/identity/index.js";
import { json } from "../../../packages/observability/src/index.js";

async function bodyOf(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 32768)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
    chunks.push(bytes);
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

function allowFields(
  input: Record<string, unknown>,
  fields: readonly string[],
) {
  if (Object.keys(input).some((field) => !fields.includes(field)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request has unsupported fields.",
    );
}

function requiredString(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (typeof value !== "string" || !value.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}

function optionalString(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string")
    throw new ApplicationError("VALIDATION_ERROR", `${field} must be text.`);
  return value.trim();
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

function optionalNumber(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be a number.`,
    );
  return value;
}

function textArray(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be a text array.`,
    );
  return value as string[];
}

function safeFreeText(value: string, field: string, max = 2000) {
  if (value.length > max)
    throw new ApplicationError("VALIDATION_ERROR", `${field} is too long.`);
  if (
    /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
      value,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must not contain credentials, secrets, or license keys.`,
    );
  return value;
}

async function authorizeRequest(input: {
  authorization: AuthorizationPort;
  principal: Principal;
  action: string;
  resourceType: string;
  resourceId: string;
  scope?: Readonly<Record<string, string>>;
  context: CorrelationContext;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: {
      type: input.resourceType,
      id: input.resourceId,
      tenant_id: input.principal.tenant_id,
    },
    scope: input.scope ?? {},
    context: { ...input.context },
  });
}

function licenseScope(poolType: unknown, scopeReference: unknown) {
  const scopeTypes: Record<string, string> = {
    DEPARTMENT: "department",
    BUSINESS_UNIT: "business_unit",
    PROJECT: "project",
  };
  const scopeType = scopeTypes[String(poolType)];
  return scopeType && typeof scopeReference === "string"
    ? { [scopeType]: scopeReference }
    : {};
}

async function poolAuthorizationScope(tx: Transaction, poolId: string) {
  const result = await tx.query(
    "SELECT pool_type,scope_reference FROM license.license_pools WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, poolId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "License pool was not found.");
  return licenseScope(
    result.rows[0]!.pool_type,
    result.rows[0]!.scope_reference,
  );
}

async function entitlementAuthorizationScope(tx: Transaction, id: string) {
  const result = await tx.query(
    `SELECT p.pool_type,p.scope_reference
       FROM license.license_entitlements e
       LEFT JOIN license.license_pools p
         ON p.tenant_id=e.tenant_id AND p.id=e.pool_id
      WHERE e.tenant_id=$1 AND e.id=$2`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License entitlement was not found.",
    );
  return licenseScope(
    result.rows[0]!.pool_type,
    result.rows[0]!.scope_reference,
  );
}

async function assignmentAuthorizationScope(tx: Transaction, id: string) {
  const result = await tx.query(
    `SELECT p.pool_type,p.scope_reference
       FROM license.assignments a
       JOIN license.license_entitlements e
         ON e.tenant_id=a.tenant_id AND e.id=a.entitlement_id
       LEFT JOIN license.license_pools p
         ON p.tenant_id=e.tenant_id AND p.id=e.pool_id
      WHERE a.tenant_id=$1 AND a.id=$2`,
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "License assignment was not found.",
    );
  return licenseScope(
    result.rows[0]!.pool_type,
    result.rows[0]!.scope_reference,
  );
}

function isPermissionDenied(error: unknown) {
  return (
    error instanceof ApplicationError && error.code === "PERMISSION_DENIED"
  );
}

async function effects(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: CorrelationContext;
  key: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  version: number;
  action: string;
  reason: string;
  before: unknown;
  after: Record<string, unknown>;
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
    action: { command_type: input.action },
    subject: { entity_type: input.aggregateType, entity_id: input.aggregateId },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.action, text: input.reason },
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
  body: Record<string, unknown>;
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

export async function handleLicenseRoute(input: {
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
  const entitlements = path === "/api/v1/license-entitlements";
  const entitlement = /^\/api\/v1\/license-entitlements\/([^/]+)$/.exec(path);
  const entitlementAvailability =
    /^\/api\/v1\/license-entitlements\/([^/]+)\/availability$/.exec(path);
  const assignment = /^\/api\/v1\/license-assignments\/([^/]+)$/.exec(path);
  const entitlementCommand =
    /^\/api\/v1\/license-entitlements\/([^/]+)\/commands\/(update|renew|assign|usage-observation)$/.exec(
      path,
    );
  const assignmentCommand =
    /^\/api\/v1\/license-assignments\/([^/]+)\/commands\/(activate|suspend|reclaim|complete-reclaim|cancel)$/.exec(
      path,
    );
  const compliance = path === "/api/v1/license-compliance";
  const pools = path === "/api/v1/license-pools";
  const pool = /^\/api\/v1\/license-pools\/([^/]+)$/.exec(path);
  const poolUpdate =
    /^\/api\/v1\/license-pools\/([^/]+)\/commands\/update$/.exec(path);
  const isRead =
    method === "GET" &&
    (entitlements ||
      !!entitlement ||
      !!entitlementAvailability ||
      !!assignment ||
      pools ||
      !!pool ||
      compliance);
  const isWrite =
    method === "POST" &&
    (entitlements ||
      !!entitlementCommand ||
      !!assignmentCommand ||
      pools ||
      !!poolUpdate);
  if (!isRead && !isWrite) return false;

  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  const isPoolRoute = pools || !!pool || !!poolUpdate;
  const targetId =
    entitlement?.[1] ??
    entitlementAvailability?.[1] ??
    entitlementCommand?.[1] ??
    assignment?.[1] ??
    assignmentCommand?.[1] ??
    pool?.[1] ??
    poolUpdate?.[1] ??
    "catalog";
  const action = isRead
    ? "license.read"
    : assignmentCommand
      ? assignmentCommand[2] === "reclaim" ||
        assignmentCommand[2] === "complete-reclaim"
        ? "license.reclaim"
        : "license.assign"
      : entitlementCommand?.[2] === "assign"
        ? "license.assign"
        : entitlementCommand?.[2] === "usage-observation"
          ? "license.compliance.resolve"
          : pools || !!poolUpdate
            ? "license.pool.manage"
            : "license.entitlement.manage";
  const resourceType = isRead
    ? compliance
      ? "license_compliance"
      : "license"
    : assignmentCommand
      ? "license_assignment"
      : entitlementCommand?.[2] === "assign" ||
          entitlementCommand?.[2] === "usage-observation"
        ? "license_entitlement"
        : isPoolRoute
          ? "license_pool"
          : "license_entitlement";
  if (isRead) {
    const data = await uow.run(principal.tenant_id, async (tx) => {
      if (assignment) {
        const scope = await assignmentAuthorizationScope(tx, assignment[1]!);
        await authorizeRequest({
          authorization,
          principal,
          action,
          resourceType: "license_assignment",
          resourceId: assignment[1]!,
          scope,
          context,
        });
        return readLicenseAssignment(tx, assignment[1]!);
      }
      if (entitlementAvailability) {
        const scope = await entitlementAuthorizationScope(
          tx,
          entitlementAvailability[1]!,
        );
        await authorizeRequest({
          authorization,
          principal,
          action,
          resourceType: "license",
          resourceId: entitlementAvailability[1]!,
          scope,
          context,
        });
        return readLicenseAvailability(tx, entitlementAvailability[1]!);
      }
      if (entitlement) {
        const scope = await entitlementAuthorizationScope(tx, entitlement[1]!);
        await authorizeRequest({
          authorization,
          principal,
          action,
          resourceType,
          resourceId: targetId,
          scope,
          context,
        });
        return readLicenseEntitlement(tx, entitlement[1]!);
      }
      if (pool) {
        const scope = await poolAuthorizationScope(tx, pool[1]!);
        await authorizeRequest({
          authorization,
          principal,
          action,
          resourceType,
          resourceId: targetId,
          scope,
          context,
        });
        return readLicensePool(tx, pool[1]!);
      }
      if (compliance) {
        const rows = (await listLicenseCompliance(tx)) as Array<
          Record<string, unknown>
        >;
        const visible = [];
        for (const row of rows) {
          try {
            await authorizeRequest({
              authorization,
              principal,
              action,
              resourceType,
              resourceId: String(row.entitlement_id),
              scope: licenseScope(row.pool_type, row.scope_reference),
              context,
            });
            const publicRow = { ...row };
            delete publicRow.pool_id;
            delete publicRow.pool_type;
            delete publicRow.scope_reference;
            visible.push(publicRow);
          } catch (error) {
            if (!isPermissionDenied(error)) throw error;
          }
        }
        return visible;
      }
      const rows = pools
        ? await listLicensePools(tx)
        : await listLicenseEntitlements(tx);
      const visible = [];
      for (const row of rows) {
        const scope = pools
          ? licenseScope(row.pool_type, row.scope_reference)
          : row.pool_id
            ? await poolAuthorizationScope(tx, String(row.pool_id))
            : {};
        try {
          await authorizeRequest({
            authorization,
            principal,
            action,
            resourceType,
            resourceId: String(row.id),
            scope,
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

  const body = await bodyOf(req);
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  const result = await uow.run(principal.tenant_id, async (tx) => {
    const store = new PostgresIdempotencyStore(tx);
    let scope: Readonly<Record<string, string>> = {};
    if (entitlements && body.pool_id) {
      scope = await poolAuthorizationScope(tx, requiredString(body, "pool_id"));
    } else if (entitlements) {
      scope = {};
    } else if (pools) {
      scope = licenseScope(
        requiredString(body, "pool_type"),
        requiredString(body, "scope_reference"),
      );
    } else if (poolUpdate) {
      scope = await poolAuthorizationScope(tx, poolUpdate[1]!);
    } else if (assignmentCommand) {
      scope = await assignmentAuthorizationScope(tx, assignmentCommand[1]!);
    } else {
      scope = await entitlementAuthorizationScope(tx, entitlementCommand![1]!);
      if (
        entitlementCommand![2] === "update" &&
        typeof body.pool_id === "string" &&
        body.pool_id
      ) {
        const requestedScope = await poolAuthorizationScope(tx, body.pool_id);
        await authorizeRequest({
          authorization,
          principal,
          action,
          resourceType,
          resourceId: targetId,
          scope: requestedScope,
          context,
        });
      }
    }
    await authorizeRequest({
      authorization,
      principal,
      action,
      resourceType,
      resourceId: targetId,
      scope,
      context,
    });
    if (entitlements) {
      allowFields(body, [
        "software_product_id",
        "pool_id",
        "license_type",
        "quantity",
        "purchased_at",
        "valid_from",
        "valid_until",
        "contract_reference",
        "supplier_reference",
        "cost",
        "currency",
        "renewal_notice_days",
        "restrictions",
        "reason",
      ]);
      if (typeof body.quantity !== "number")
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "quantity must be a number.",
        );
      if (
        body.renewal_notice_days !== undefined &&
        body.renewal_notice_days !== null &&
        !Number.isSafeInteger(body.renewal_notice_days)
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "renewal_notice_days must be an integer.",
        );
      const restrictions =
        body.restrictions === undefined ? [] : textArray(body, "restrictions");
      const reason = safeFreeText(requiredString(body, "reason"), "reason");
      const op = intent({
        principal,
        operation: "LICENSE.ENTITLEMENT_CREATE",
        scope: "new",
        key,
        body,
      });
      return store.execute(op, async () => {
        const created = await createLicenseEntitlement({
          tx,
          softwareProductId: requiredString(body, "software_product_id"),
          poolId: optionalString(body, "pool_id"),
          licenseType: requiredString(body, "license_type"),
          quantity: body.quantity as number,
          purchasedAt: optionalString(body, "purchased_at"),
          validFrom: requiredString(body, "valid_from"),
          validUntil: optionalString(body, "valid_until"),
          contractReference:
            safeFreeText(
              optionalString(body, "contract_reference") ?? "",
              "contract_reference",
            ) || null,
          supplierReference:
            safeFreeText(
              optionalString(body, "supplier_reference") ?? "",
              "supplier_reference",
            ) || null,
          cost: optionalNumber(body, "cost"),
          currency: optionalString(body, "currency"),
          renewalNoticeDays:
            body.renewal_notice_days === undefined ||
            body.renewal_notice_days === null
              ? null
              : (body.renewal_notice_days as number),
          restrictions,
          actorId: principal.id,
          reason,
        });
        const after = {
          entitlement_id: created.id,
          software_product_id: created.software_product_id,
          license_type: created.license_type,
          quantity: created.quantity,
          valid_from: created.valid_from,
          valid_until: created.valid_until,
          term_version: created.term_version,
          effective_state: created.effective_state,
        };
        await effects({
          tx,
          config,
          principal,
          context,
          key,
          eventType: "LICENSE.ENTITLEMENT_CREATED",
          aggregateType: "LICENSE_ENTITLEMENT",
          aggregateId: created.id,
          version: 1,
          action: "LICENSE.ENTITLEMENT_CREATE",
          reason,
          before: null,
          after,
        });
        return { status: 201, body: created as never };
      });
    }
    if (pools) {
      allowFields(body, [
        "name",
        "pool_type",
        "scope_reference",
        "contract_reference",
        "reason",
      ]);
      const reason = safeFreeText(requiredString(body, "reason"), "reason");
      const op = intent({
        principal,
        operation: "LICENSE.POOL_CREATE",
        scope: "new",
        key,
        body,
      });
      return store.execute(op, async () => {
        const created = await createLicensePool({
          tx,
          name: requiredString(body, "name"),
          poolType: requiredString(body, "pool_type"),
          scopeReference: requiredString(body, "scope_reference"),
          contractReference:
            safeFreeText(
              optionalString(body, "contract_reference") ?? "",
              "contract_reference",
            ) || null,
          actorId: principal.id,
        });
        const after = {
          pool_id: created.id,
          name: created.name,
          pool_type: created.pool_type,
          scope_reference: created.scope_reference,
          state: created.state,
          version: created.version,
        };
        await effects({
          tx,
          config,
          principal,
          context,
          key,
          eventType: "LICENSE.POOL_CREATED",
          aggregateType: "LICENSE_POOL",
          aggregateId: created.id,
          version: 1,
          action: "LICENSE.POOL_CREATE",
          reason,
          before: null,
          after,
        });
        return { status: 201, body: created as never };
      });
    }
    if (poolUpdate) {
      allowFields(body, [
        "expected_version",
        "name",
        "state",
        "contract_reference",
        "reason",
      ]);
      const expectedVersion = integer(body, "expected_version");
      const reason = safeFreeText(requiredString(body, "reason"), "reason");
      const op = intent({
        principal,
        operation: "LICENSE.POOL_UPDATE",
        scope: poolUpdate[1]!,
        key,
        body,
      });
      return store.execute(op, async () => {
        const current = await readLicensePool(tx, poolUpdate[1]!);
        const updated = await updateLicensePool({
          tx,
          poolId: poolUpdate[1]!,
          expectedVersion,
          name:
            body.name === undefined
              ? String(current.name)
              : requiredString(body, "name"),
          state:
            body.state === undefined
              ? (current.state as "ACTIVE" | "INACTIVE")
              : (requiredString(body, "state") as "ACTIVE" | "INACTIVE"),
          contractReference:
            body.contract_reference === undefined
              ? (current.contract_reference as string | null)
              : optionalString(body, "contract_reference"),
        });
        const after = {
          pool_id: poolUpdate[1]!,
          name: updated.name,
          state: updated.state,
          version: updated.version,
        };
        await effects({
          tx,
          config,
          principal,
          context,
          key,
          eventType: "LICENSE.POOL_UPDATED",
          aggregateType: "LICENSE_POOL",
          aggregateId: poolUpdate[1]!,
          version: updated.version,
          action: "LICENSE.POOL_UPDATE",
          reason,
          before: updated.before,
          after,
        });
        return { status: 200, body: after as never };
      });
    }
    if (assignmentCommand) {
      const routeAction = assignmentCommand[2]!;
      const allowedFields = ["expected_version", "reason"];
      if (routeAction === "complete-reclaim")
        allowedFields.push("verification_reference");
      allowFields(body, allowedFields);
      const expectedVersion = integer(body, "expected_version");
      const reason = safeFreeText(requiredString(body, "reason"), "reason");
      const action =
        routeAction === "cancel"
          ? "CANCEL"
          : routeAction === "complete-reclaim"
            ? "COMPLETE_RECLAIM"
            : routeAction === "reclaim"
              ? "RECLAIM"
              : routeAction.toUpperCase();
      const operation =
        routeAction === "cancel"
          ? "LICENSE.CANCEL_ASSIGNMENT"
          : `LICENSE.ASSIGNMENT_${action}`;
      const op = intent({
        principal,
        operation,
        scope: assignmentCommand[1]!,
        key,
        body,
      });
      return store.execute(op, async () => {
        const changed = await transitionLicenseAssignment({
          tx,
          assignmentId: assignmentCommand[1]!,
          expectedVersion,
          action: action as
            "ACTIVATE" | "SUSPEND" | "RECLAIM" | "COMPLETE_RECLAIM" | "CANCEL",
          actorId: principal.id,
          reason,
          ...(typeof body.verification_reference === "string"
            ? { verificationReference: body.verification_reference }
            : {}),
        });
        if (changed.noOp)
          return {
            status: 200,
            body: {
              assignment_id: assignmentCommand[1]!,
              entitlement_id: String(changed.entitlement_id),
              principal_type: String(changed.principal_type),
              principal_id: String(changed.principal_id),
              state: String(changed.state),
              version: changed.version,
              cancelled_at: changed.cancelled_at,
            } as never,
          };
        const eventType =
          changed.state === "CANCELLED"
            ? "LICENSE.ASSIGNMENT_CANCELLED"
            : changed.state === "ACTIVE"
              ? "LICENSE.ACTIVATED"
              : changed.state === "SUSPENDED"
                ? "LICENSE.SUSPENDED"
                : changed.state === "RECLAIM_PENDING"
                  ? "LICENSE.RECLAIM_PENDING"
                  : "LICENSE.RECLAIMED";
        const after = {
          assignment_id: assignmentCommand[1]!,
          entitlement_id: String(changed.entitlement_id),
          principal_type: String(changed.principal_type),
          principal_id: String(changed.principal_id),
          state: String(changed.state),
          version: changed.version,
          ...(changed.cancelled_at
            ? { cancelled_at: changed.cancelled_at, reason }
            : {}),
          ...(changed.reclaim_verification_reference
            ? { verification_reference: changed.reclaim_verification_reference }
            : {}),
        };
        await effects({
          tx,
          config,
          principal,
          context,
          key,
          eventType,
          aggregateType: "LICENSE_ASSIGNMENT",
          aggregateId: assignmentCommand[1]!,
          version: changed.version,
          action: operation,
          reason,
          before: changed.before,
          after,
        });
        return { status: 200, body: after as never };
      });
    }
    if (entitlementCommand?.[2] === "assign") {
      allowFields(body, ["principal_type", "principal_id", "reason"]);
      const principalType = requiredString(body, "principal_type");
      if (principalType !== "USER" && principalType !== "ASSET")
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "principal_type is invalid.",
        );
      const principalId = requiredString(body, "principal_id");
      const reason = safeFreeText(requiredString(body, "reason"), "reason");
      const op = intent({
        principal,
        operation: "LICENSE.ASSIGNMENT_CREATE",
        scope: entitlementCommand[1]!,
        key,
        body,
      });
      return store.execute(op, async () => {
        if (principalType === "USER")
          await assertActiveLicenseUser({ tx, userId: principalId });
        else await assertAssetEligibleForLicense({ tx, assetId: principalId });
        const assignment = await createLicenseAssignment({
          tx,
          entitlementId: entitlementCommand[1]!,
          principalType,
          principalId,
          actorId: principal.id,
          reason,
        });
        const after = {
          assignment_id: String(assignment.id),
          entitlement_id: String(assignment.entitlement_id),
          principal_type: String(assignment.principal_type),
          principal_id: String(assignment.principal_id),
          state: String(assignment.state),
          version: Number(assignment.version),
        };
        await effects({
          tx,
          config,
          principal,
          context,
          key,
          eventType: "LICENSE.ASSIGNED",
          aggregateType: "LICENSE_ASSIGNMENT",
          aggregateId: String(assignment.id),
          version: Number(assignment.version),
          action: "LICENSE.ASSIGNMENT_CREATE",
          reason,
          before: null,
          after,
        });
        return { status: 201, body: after as never };
      });
    }
    if (entitlementCommand?.[2] === "usage-observation") {
      allowFields(body, [
        "source",
        "active_usage",
        "observed_at",
        "inactivity_threshold_days",
        "evidence_reference",
        "reason",
      ]);
      const source = requiredString(body, "source");
      if (source !== "MANUAL_ATTESTATION")
        throw new ApplicationError("VALIDATION_ERROR", "source is invalid.");
      const activeUsage = integer(body, "active_usage");
      const reason = safeFreeText(requiredString(body, "reason"), "reason");
      const op = intent({
        principal,
        operation: "LICENSE.USAGE_OBSERVATION_CREATE",
        scope: entitlementCommand[1]!,
        key,
        body,
      });
      return store.execute(op, async () => {
        const observation = await recordLicenseUsageObservation({
          tx,
          entitlementId: entitlementCommand[1]!,
          source,
          activeUsage,
          observedAt: requiredString(body, "observed_at"),
          inactivityThresholdDays:
            body.inactivity_threshold_days === undefined
              ? null
              : integer(body, "inactivity_threshold_days"),
          evidenceReference: requiredString(body, "evidence_reference"),
          actorId: principal.id,
        });
        const after = {
          entitlement_id: entitlementCommand[1]!,
          observation_id: observation.id,
          source: observation.source,
          active_usage: observation.active_usage,
          observed_at: observation.observed_at,
        };
        await effects({
          tx,
          config,
          principal,
          context,
          key,
          eventType: "LICENSE.USAGE_OBSERVED",
          aggregateType: "LICENSE_ENTITLEMENT",
          aggregateId: entitlementCommand[1]!,
          version: 1,
          action: "LICENSE.USAGE_OBSERVATION_CREATE",
          reason,
          before: null,
          after,
        });
        return { status: 201, body: after as never };
      });
    }
    const id = entitlementCommand![1]!;
    const command = entitlementCommand![2]!;
    const expectedVersion = integer(body, "expected_version");
    const reason = safeFreeText(requiredString(body, "reason"), "reason");
    if (command === "renew") {
      allowFields(body, [
        "expected_version",
        "valid_from",
        "valid_until",
        "reason",
      ]);
      const op = intent({
        principal,
        operation: "LICENSE.ENTITLEMENT_RENEW",
        scope: id,
        key,
        body,
      });
      return store.execute(op, async () => {
        const renewed = await renewLicenseEntitlement({
          tx,
          entitlementId: id,
          expectedVersion,
          validFrom: requiredString(body, "valid_from"),
          validUntil: optionalString(body, "valid_until"),
          actorId: principal.id,
          reason,
        });
        const after = {
          entitlement_id: id,
          software_product_id: renewed.software_product_id,
          term_version: renewed.current_term_version,
          previous_valid_from: renewed.previous_valid_from,
          previous_valid_until: renewed.previous_valid_until,
          valid_from: renewed.valid_from,
          valid_until: renewed.valid_until,
          reason,
        };
        await effects({
          tx,
          config,
          principal,
          context,
          key,
          eventType: "LICENSE.RENEWED",
          aggregateType: "LICENSE_ENTITLEMENT",
          aggregateId: id,
          version: renewed.version,
          action: "LICENSE.ENTITLEMENT_RENEW",
          reason,
          before: {
            valid_from: renewed.previous_valid_from,
            valid_until: renewed.previous_valid_until,
          },
          after,
        });
        return { status: 200, body: renewed as never };
      });
    }
    allowFields(body, [
      "expected_version",
      "pool_id",
      "license_type",
      "quantity",
      "purchased_at",
      "contract_reference",
      "supplier_reference",
      "cost",
      "currency",
      "renewal_notice_days",
      "restrictions",
      "reason",
    ]);
    const op = intent({
      principal,
      operation: "LICENSE.ENTITLEMENT_UPDATE",
      scope: id,
      key,
      body,
    });
    return store.execute(op, async () => {
      const current = await readLicenseEntitlement(tx, id);
      const updated = await updateLicenseEntitlement({
        tx,
        entitlementId: id,
        expectedVersion,
        poolId:
          body.pool_id === undefined
            ? (current.pool_id as string | null)
            : optionalString(body, "pool_id"),
        licenseType:
          body.license_type === undefined
            ? String(current.license_type)
            : requiredString(body, "license_type"),
        quantity:
          body.quantity === undefined
            ? Number(current.quantity)
            : integer(body, "quantity"),
        purchasedAt:
          body.purchased_at === undefined
            ? current.purchased_at === null
              ? null
              : new Date(current.purchased_at as string | Date).toISOString()
            : optionalString(body, "purchased_at"),
        contractReference:
          body.contract_reference === undefined
            ? (current.contract_reference as string | null)
            : optionalString(body, "contract_reference"),
        supplierReference:
          body.supplier_reference === undefined
            ? (current.supplier_reference as string | null)
            : optionalString(body, "supplier_reference"),
        cost:
          body.cost === undefined
            ? current.cost === null
              ? null
              : Number(current.cost)
            : optionalNumber(body, "cost"),
        currency:
          body.currency === undefined
            ? (current.currency as string | null)
            : optionalString(body, "currency"),
        renewalNoticeDays:
          body.renewal_notice_days === undefined
            ? current.renewal_notice_days === null
              ? null
              : Number(current.renewal_notice_days)
            : (body.renewal_notice_days as number | null),
        restrictions:
          body.restrictions === undefined
            ? (current.restrictions as string[])
            : textArray(body, "restrictions"),
        actorId: principal.id,
        reason,
      });
      const after = {
        entitlement_id: id,
        version: updated.version,
        changed_fields: Object.keys(body).filter(
          (field) => !["expected_version", "reason"].includes(field),
        ),
      };
      await effects({
        tx,
        config,
        principal,
        context,
        key,
        eventType: "LICENSE.ENTITLEMENT_UPDATED",
        aggregateType: "LICENSE_ENTITLEMENT",
        aggregateId: id,
        version: updated.version,
        action: "LICENSE.ENTITLEMENT_UPDATE",
        reason,
        before: updated.before,
        after,
      });
      return { status: 200, body: updated as never };
    });
  });
  json(res, result.status, { data: result.body, meta: context });
  return true;
}

export function licenseRouteFailure(
  error: unknown,
  context: CorrelationContext,
) {
  return errorResponse(error, context);
}
