import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AuthenticationPort,
  AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import { authenticate, authorize } from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { Config } from "../../../packages/config/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { json } from "../../../packages/observability/src/index.js";
import { PostgresIdempotencyStore } from "../../../packages/messaging/src/index.js";
import {
  readAssetAssessments,
  recalculateAssetAssessments,
  recordVerifiedAcquisitionDate,
  saveAssetReplacementPolicy,
} from "../../../modules/asset/index.js";

type Body = Record<string, unknown>;
async function body(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > 32768)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(
      Buffer.concat(chunks).toString("utf8") || "{}",
    );
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Body;
  } catch {
    /* mapped below */
  }
  throw new ApplicationError("VALIDATION_ERROR", "A JSON object is required.");
}
function text(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${name} is required.`);
  return value.trim();
}
function integer(value: unknown, name: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${name} must be an integer >= ${minimum}.`,
    );
  return Number(value);
}
function requestKey(req: IncomingMessage) {
  const value = req.headers["idempotency-key"];
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return value.trim();
}

export async function handleAssetScoringRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}) {
  const url = new URL(input.req.url ?? "/", "http://localhost");
  const assessmentMatch = /^\/api\/v1\/assets\/([^/]+)\/assessments$/.exec(
    url.pathname,
  );
  if (assessmentMatch && input.req.method === "GET") {
    const principal = await authenticate(
      input.authentication,
      input.req.headers.authorization,
    );
    const result = await input.uow.run(principal.tenant_id, (tx) =>
      readAssetAssessments({
        tx,
        assetId: assessmentMatch[1]!,
        principal,
        authorization: input.authorization,
        correlationId: input.context.correlation_id,
      }),
    );
    json(input.res, 200, { data: result, meta: input.context });
    return true;
  }
  const recalcMatch =
    /^\/api\/v1\/assets\/([^/]+)\/commands\/recalculate-scoring$/.exec(
      url.pathname,
    );
  if (recalcMatch && input.req.method === "POST") {
    const principal = await authenticate(
      input.authentication,
      input.req.headers.authorization,
    );
    const key = requestKey(input.req);
    const request = await body(input.req);
    if (
      Object.keys(request).some(
        (field) => !["reason", "expected_version"].includes(field),
      )
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unsupported recalculation field.",
      );
    const reason = text(request.reason, "reason");
    const expectedVersion = integer(
      request.expected_version,
      "expected_version",
      1,
    );
    const result = await input.uow.run(
      principal.tenant_id,
      async (tx) => {
        await authorize(input.authorization, {
          principal,
          action: "asset.scoring.recalculate",
          resource: {
            type: "asset",
            id: recalcMatch[1]!,
            tenant_id: principal.tenant_id,
          },
          scope: { asset: recalcMatch[1]!, tenant: principal.tenant_id },
          context: { ...input.context },
        });
        const system = await tx.query<{ id: string }>(
          "SELECT id FROM identity.asset_scoring_principals WHERE tenant_id=$1 AND service_identity='asset-scoring' AND active=true",
          [principal.tenant_id],
        );
        if (!system.rowCount)
          throw new ApplicationError(
            "PERMISSION_DENIED",
            "The tenant scoring principal is not configured.",
          );
        return new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "ASSET.SCORING.RECALCULATE",
            businessScope: recalcMatch[1]!,
            key,
            semanticRequest: { reason, expected_version: expectedVersion },
            expiresAt: new Date(Date.now() + 86_400_000),
          },
          async () => ({
            status: 200,
            body: (await recalculateAssetAssessments({
              tx,
              assetId: recalcMatch[1]!,
              actor: {
                id: String(system.rows[0]!.id),
                tenant_id: principal.tenant_id,
                actor_type: "SYSTEM_ASSET_SCORING",
              },
              asOf: new Date().toISOString(),
              trigger: `EXPLICIT:${reason}`,
              correlationId: input.context.correlation_id,
              serviceName: input.config.serviceName,
              expectedAssetVersion: expectedVersion,
            })) as never,
          }),
        );
      },
      { isolationLevel: "REPEATABLE READ" },
    );
    json(input.res, result.status, { data: result.body, meta: input.context });
    return true;
  }
  if (
    url.pathname === "/api/v1/asset-replacement-policies" &&
    input.req.method === "POST"
  ) {
    const principal = await authenticate(
      input.authentication,
      input.req.headers.authorization,
    );
    const key = requestKey(input.req);
    const request = await body(input.req);
    if (
      Object.keys(request).some(
        (field) =>
          ![
            "category_id",
            "expected_life_months",
            "expected_version",
            "reason",
          ].includes(field),
      )
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unsupported policy field.",
      );
    const result = await input.uow.run(principal.tenant_id, async (tx) => {
      const value = await saveAssetReplacementPolicy({
        tx,
        categoryId: text(request.category_id, "category_id"),
        expectedLifeMonths: integer(
          request.expected_life_months,
          "expected_life_months",
          1,
        ),
        expectedVersion: integer(request.expected_version, "expected_version"),
        idempotencyKey: key,
        reason: text(request.reason, "reason"),
        actor: principal,
        authorization: input.authorization,
        correlationId: input.context.correlation_id,
        serviceName: input.config.serviceName,
      });
      return { status: 201, body: value };
    });
    json(input.res, result.status, { data: result.body, meta: input.context });
    return true;
  }
  const acquisitionMatch =
    /^\/api\/v1\/assets\/([^/]+)\/commands\/verify-acquisition-date$/.exec(
      url.pathname,
    );
  if (acquisitionMatch && input.req.method === "POST") {
    const principal = await authenticate(
      input.authentication,
      input.req.headers.authorization,
    );
    const key = requestKey(input.req);
    const request = await body(input.req);
    if (
      Object.keys(request).some(
        (field) =>
          ![
            "acquired_on",
            "expected_asset_version",
            "source_reference",
            "reason",
          ].includes(field),
      )
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unsupported acquisition evidence field.",
      );
    const result = await input.uow.run(principal.tenant_id, async (tx) => ({
      status: 201,
      body: await recordVerifiedAcquisitionDate({
        tx,
        assetId: acquisitionMatch[1]!,
        acquiredOn: text(request.acquired_on, "acquired_on"),
        expectedAssetVersion: integer(
          request.expected_asset_version,
          "expected_asset_version",
          1,
        ),
        sourceReference: text(request.source_reference, "source_reference"),
        reason: text(request.reason, "reason"),
        idempotencyKey: key,
        actor: principal,
        authorization: input.authorization,
        correlationId: input.context.correlation_id,
        serviceName: input.config.serviceName,
      }),
    }));
    json(input.res, result.status, { data: result.body, meta: input.context });
    return true;
  }
  return false;
}
