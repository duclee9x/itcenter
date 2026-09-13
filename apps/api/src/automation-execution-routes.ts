import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { Config } from "../../../packages/config/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  cancelActionExecution,
  PostgresAutomationSecurity,
  readActionExecution,
  retryActionExecution,
} from "../../../modules/automation/index.js";
import { PostgresIdempotencyStore } from "../../../packages/messaging/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import { json } from "../../../packages/observability/src/index.js";

async function readBody(req: IncomingMessage) {
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
    const v = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
    return v as Record<string, unknown>;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}
function text(body: Record<string, unknown>, key: string, min = 1, max = 2000) {
  const v = body[key];
  if (typeof v !== "string" || v.trim().length < min || v.length > max)
    throw new ApplicationError("VALIDATION_ERROR", `${key} is invalid.`);
  return v.trim();
}
function version(body: Record<string, unknown>) {
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
function idem(req: IncomingMessage) {
  const v = req.headers["idempotency-key"];
  if (typeof v !== "string" || !v.trim() || v.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return v.trim();
}

export async function handleAutomationExecutionRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}): Promise<boolean> {
  const pathname = input.req.url?.split("?")[0] ?? "";
  const method = input.req.method ?? "GET";
  const match = pathname.match(
    /^\/api\/v1\/automation\/action-executions\/([0-9a-f-]{36})(?:\/commands\/(cancel|retry))?$/i,
  );
  if (
    !match ||
    !((method === "GET" && !match[2]) || (method === "POST" && !!match[2]))
  )
    return false;
  const principal = await authenticate(
    input.authentication,
    input.req.headers.authorization,
  );
  const executionId = match[1]!;
  const operation = match[2];
  if (method === "GET") {
    const result = await input.uow.run(principal.tenant_id, async (tx) => {
      const execution = await readActionExecution(tx, executionId);
      const security = new PostgresAutomationSecurity(tx);
      const target = await security.resolveTarget({
        tenantId: principal.tenant_id,
        targetType: String(execution.target_type),
        targetId: String(execution.target_id),
      });
      if (!target)
        throw new ApplicationError(
          "NOT_FOUND",
          "Action execution was not found.",
        );
      await authorize(input.authorization, {
        principal,
        action: "automation.intent.read",
        resource: {
          type: "action_intent",
          id: execution.intent_id,
          tenant_id: principal.tenant_id,
        },
        scope: target.scope,
        context: { ...input.context, execution_id: executionId },
      });
      return execution;
    });
    json(input.res, 200, { data: result, meta: input.context });
    return true;
  }
  const body = await readBody(input.req);
  const expectedVersion = version(body);
  const reason = text(body, "reason");
  const reconciliation =
    operation === "retry"
      ? text(body, "reconciliation_evidence", 10, 4000)
      : undefined;
  const allowed = new Set(
    operation === "retry"
      ? ["expected_version", "reason", "reconciliation_evidence"]
      : ["expected_version", "reason"],
  );
  if (Object.keys(body).some((k) => !allowed.has(k)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request contains unsupported fields.",
    );
  const idempotencyKey = idem(input.req);
  const result = await input.uow.run(principal.tenant_id, async (tx) => {
    const execution = await readActionExecution(tx, executionId);
    const security = new PostgresAutomationSecurity(tx);
    const target = await security.resolveTarget({
      tenantId: principal.tenant_id,
      targetType: String(execution.target_type),
      targetId: String(execution.target_id),
    });
    if (!target)
      throw new ApplicationError(
        "NOT_FOUND",
        "Action execution was not found.",
      );
    await authorize(input.authorization, {
      principal,
      action: operation === "retry" ? "execution.retry" : "execution.cancel",
      resource: {
        type: "action_execution",
        id: executionId,
        tenant_id: principal.tenant_id,
      },
      scope: target.scope,
      context: { ...input.context, intent_id: execution.intent_id },
    });
    const saved = await new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation:
          operation === "retry"
            ? "AUTOMATION.RETRY_ACTION"
            : "AUTOMATION.CANCEL_ACTION",
        businessScope: executionId,
        key: idempotencyKey,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        const value =
          operation === "retry"
            ? await retryActionExecution(tx, {
                id: executionId,
                expectedVersion,
                actorId: principal.id,
                reason,
                reconciliationEvidence: reconciliation!,
                idempotencyKey,
              })
            : await cancelActionExecution(tx, {
                id: executionId,
                expectedVersion,
                actorId: principal.id,
                reason,
                correlationId: input.context.correlation_id,
              });
        const eventId = randomUUID();
        const type =
          operation === "retry"
            ? "AUTOMATION.EXECUTION_CREATED"
            : "AUTOMATION.ACTION_CANCELLED";
        await new PostgresAudit(tx).append({
          id: eventId,
          tenant_id: principal.tenant_id,
          event_type: type,
          occurred_at: new Date().toISOString(),
          actor: { type: principal.actor_type, id: principal.id },
          action: { command_type: type },
          subject: { entity_type: "ACTION_EXECUTION", entity_id: value.id },
          correlation_id: input.context.correlation_id,
          causation_id: executionId,
          reason: {
            code:
              operation === "retry"
                ? "MANUAL_RECONCILED_RETRY"
                : "OPERATOR_CANCELLED_BEFORE_DISPATCH",
            text:
              reason +
              (reconciliation ? " Reconciliation: " + reconciliation : ""),
          },
          before: { state: execution.state },
          after: {
            execution_id: value.id,
            previous_execution_id: operation === "retry" ? executionId : null,
            state: value.state,
          },
          outcome: { status: "SUCCESS" },
          classification: "INTERNAL",
          relations: [],
          evidence: [],
        });
        return { status: 200, body: value as never };
      },
    );
    return saved;
  });
  json(input.res, result.status, { data: result.body, meta: input.context });
  return true;
}
