import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  classifySlaTargetPurpose,
  parseSlaTargetPurpose,
  type ClassifiableSlaTargetPurpose,
} from "../../../modules/control-plane/index.js";
import { json } from "../../../packages/observability/src/index.js";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function readBody(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 65_536)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
  }
  try {
    const body: unknown = JSON.parse(raw || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}
function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}

export async function handleSlaTargetPurposeRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}) {
  const match =
    /^\/api\/v1\/sla-targets\/([0-9a-f-]{36})\/commands\/set-purpose$/i.exec(
      new URL(input.req.url ?? "/", "http://localhost").pathname,
    );
  if (!match) return false;
  if (input.req.method !== "POST")
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "SLA target purpose is changed only by POST command.",
    );
  const targetId = match[1]!;
  if (!uuid.test(targetId))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "sla_target_id must be a UUID.",
    );
  const body = await readBody(input.req);
  const principal = await authenticate(
    input.authentication,
    input.req.headers.authorization,
  );
  const key = requiredString(
    input.req.headers["idempotency-key"],
    "Idempotency-Key",
  );
  const reason = requiredString(body.reason, "reason");
  const parsedPurpose = parseSlaTargetPurpose(body.target_purpose);
  if (parsedPurpose === "UNKNOWN")
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Manual classification must select a known target purpose.",
    );
  if (
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version must be a positive integer.",
    );
  const targetPurpose = parsedPurpose as ClassifiableSlaTargetPurpose;
  const result = await input.uow.run(principal.tenant_id, async (tx) => {
    await authorize(input.authorization, {
      principal,
      action: "sla.target_purpose.manage",
      resource: {
        type: "sla_target",
        id: targetId,
        tenant_id: principal.tenant_id,
      },
      scope: { tenant: principal.tenant_id },
      context: { ...input.context },
    });
    return new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: "SLA.SET_TARGET_PURPOSE",
        businessScope: targetId,
        key,
        semanticRequest: {
          target_id: targetId,
          target_purpose: targetPurpose,
          expected_version: body.expected_version as number,
          reason,
        } as never,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      async () => {
        const value = await classifySlaTargetPurpose({
          tx,
          authorization: input.authorization,
          principal,
          targetId,
          targetPurpose,
          expectedVersion: body.expected_version as number,
          reason,
          correlationId: input.context.correlation_id,
          idempotencyKey: key,
        });
        if (value.created) {
          const occurredAt = new Date().toISOString();
          const eventId = randomUUID();
          const payload = {
            sla_target_id: targetId,
            from_purpose: value.from_purpose,
            target_purpose: value.target_purpose,
            target_version: value.version,
            reason,
          };
          await new PostgresOutboxWriter(tx).append({
            event_id: eventId,
            event_type: "SLA.TARGET_PURPOSE_CLASSIFIED",
            schema_version: 1,
            occurred_at: occurredAt,
            producer: { service: "api", instance: "sla-target-purpose" },
            aggregate: {
              type: "SLA_TARGET",
              id: targetId,
              version: value.version,
            },
            actor: { type: principal.actor_type, id: principal.id },
            correlation_id: input.context.correlation_id,
            causation_id: input.context.causation_id,
            tenant_id: principal.tenant_id,
            organization_id: principal.tenant_id,
            idempotency_key: key,
            payload,
          });
          await new PostgresAudit(tx).append({
            id: randomUUID(),
            tenant_id: principal.tenant_id,
            event_type: "SLA.TARGET_PURPOSE_CLASSIFIED",
            occurred_at: occurredAt,
            actor: { type: principal.actor_type, id: principal.id },
            action: {
              command_type: "SLA.SET_TARGET_PURPOSE",
              idempotency_key: key,
            },
            subject: { entity_type: "SLA_TARGET", entity_id: targetId },
            correlation_id: input.context.correlation_id,
            causation_id: input.context.causation_id,
            reason: { code: "LEGACY_TARGET_CLASSIFICATION", text: reason },
            before: {
              target_purpose: value.from_purpose,
              version: value.version - 1,
            },
            after: payload,
            outcome: { status: "SUCCESS" },
            classification: "INTERNAL",
            relations: [],
            evidence: [
              {
                type: "SLA_TARGET_PURPOSE_CHANGE",
                id: value.id,
                checksum: "immutable-purpose-history",
                relation: "CLASSIFICATION_EVIDENCE",
              },
            ],
          });
        }
        return { status: 200, body: value as never };
      },
    );
  });
  json(input.res, result.status, { data: result.body, meta: input.context });
  return true;
}
