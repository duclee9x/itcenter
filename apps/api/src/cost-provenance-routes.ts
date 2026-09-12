import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AuthenticationPort,
  AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import { authenticate, authorize } from "../../../packages/auth/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { json } from "../../../packages/observability/src/index.js";
import { PostgresIdempotencyStore } from "../../../packages/messaging/src/index.js";
import {
  recordCostProvenance,
  readCostProvenance,
  type CostTargetType,
  type CostSourceType,
  type CostBasis,
} from "../../../modules/procurement/index.js";

async function readBody(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 100_000)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
  }
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw 0;
    return value as Record<string, unknown>;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
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

function parseTargetType(value: unknown): CostTargetType {
  if (["ASSET", "LICENSE_ENTITLEMENT", "LICENSE_POOL"].includes(String(value)))
    return value as CostTargetType;
  throw new ApplicationError("VALIDATION_ERROR", "target_type is invalid.");
}

function required(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}

export async function handleCostProvenanceRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}) {
  const url = new URL(input.req.url ?? "/", "http://localhost");
  if (
    url.pathname === "/api/v1/cost-provenance" &&
    input.req.method === "POST"
  ) {
    const body = await readBody(input.req);
    const principal = await authenticate(
      input.authentication,
      input.req.headers.authorization,
    );
    const target = parseTargetType(body.target_type);
    const targetId = required(body.target_id, "target_id");
    const resourceType =
      target === "ASSET"
        ? "asset"
        : target === "LICENSE_POOL"
          ? "license_pool"
          : "license_entitlement";
    const permission =
      target === "ASSET"
        ? "asset.update_master"
        : target === "LICENSE_POOL"
          ? "license.pool.manage"
          : "license.entitlement.manage";
    const reason = required(body.reason, "reason");
    const key = idempotencyKey(input.req);
    const sourceType = required(
      body.source_type,
      "source_type",
    ) as CostSourceType;
    const basis = required(body.cost_basis, "cost_basis") as CostBasis;
    const sourceId = required(body.source_document_id, "source_document_id");
    const sourceVersionRef = required(
      body.source_document_version_ref,
      "source_document_version_ref",
    );
    const currency = required(body.currency, "currency").toUpperCase();
    if (
      !Number.isFinite(Number(body.amount)) ||
      !Number.isFinite(Number(body.quantity_basis))
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "amount and quantity_basis must be numeric.",
      );
    if (
      ![
        "PURCHASE_ORDER",
        "INVOICE",
        "CREDIT_NOTE",
        "CONTRACT",
        "CONTRACT_VERSION",
      ].includes(sourceType)
    )
      throw new ApplicationError("VALIDATION_ERROR", "source_type is invalid.");
    if (!["COMMITTED", "ACTUAL", "ADJUSTMENT"].includes(basis))
      throw new ApplicationError("VALIDATION_ERROR", "cost_basis is invalid.");
    const result = await input.uow.run(principal.tenant_id, async (tx) => {
      await authorize(input.authorization, {
        principal,
        action: permission,
        resource: {
          type: resourceType,
          id: targetId,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...input.context },
      });
      const result = await new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "COST_PROVENANCE.RECORD",
          businessScope: `${target}:${targetId}`,
          key,
          semanticRequest: body as never,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        async () => {
          const value = await recordCostProvenance({
            tx,
            actorId: principal.id,
            actorType: principal.actor_type as "USER" | "SYSTEM" | "SERVICE",
            correlationId: input.context.correlation_id,
            causationId: input.context.causation_id ?? "COST_PROVENANCE.RECORD",
            reason,
            value: {
              targetType: target,
              targetId,
              sourceType,
              sourceDocumentId: sourceId,
              sourceVersionRef: sourceVersionRef,
              sourceLineId:
                body.source_line_id == null
                  ? null
                  : String(body.source_line_id),
              basis,
              adjustmentDirection: body.adjustment_direction as
                "CREDIT" | "DEBIT" | null,
              amount: body.amount as string | number,
              currency,
              quantity: body.quantity_basis as string | number,
              allocationMethod: required(
                body.allocation_method,
                "allocation_method",
              ),
              allocationRole: required(body.allocation_role, "allocation_role"),
              effectiveFrom:
                body.effective_from == null
                  ? null
                  : String(body.effective_from),
              effectiveTo:
                body.effective_to == null ? null : String(body.effective_to),
            },
          });
          return {
            status: value.created ? 201 : 200,
            body: { id: value.id, created: value.created } as never,
          };
        },
      );
      return result;
    });
    json(input.res, result.status, {
      data: result.body,
      meta: input.context,
    } as never);
    return true;
  }
  const match = url.pathname.match(
    /^\/api\/v1\/cost-provenance\/(assets|license-entitlements|license-pools)\/([0-9a-f-]{36})$/i,
  );
  if (!match) return false;
  if (input.req.method !== "GET")
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Cost provenance is read-only.",
    );
  const targetType: CostTargetType =
    match[1] === "assets"
      ? "ASSET"
      : match[1] === "license-entitlements"
        ? "LICENSE_ENTITLEMENT"
        : "LICENSE_POOL";
  const principal = await authenticate(
    input.authentication,
    input.req.headers.authorization,
  );
  const resourceType = targetType === "ASSET" ? "asset" : "license";
  await authorize(input.authorization, {
    principal,
    action: targetType === "ASSET" ? "asset.read" : "license.read",
    resource: {
      type: resourceType,
      id: match[2]!,
      tenant_id: principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
  const value = await input.uow.run(principal.tenant_id, (tx) =>
    readCostProvenance(tx, targetType, match[2]!),
  );
  json(input.res, 200, { data: value, meta: input.context } as never);
  return true;
}
