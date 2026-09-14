import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import type { Principal } from "../../../packages/auth/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { json } from "../../../packages/observability/src/index.js";
import {
  acceptAutomationAction,
  isRegisteredAgent,
  processAgentMessage,
  readPendingAutomationAction,
  readRestartBaseline,
  recordAutomationActionDelivery,
  rejectAutomationAction,
} from "../../../modules/agent/index.js";
import type { AgentPrincipal } from "../../../modules/agent/application/authentication.js";
import {
  claimAgentRestart,
  PostgresAutomationSecurity,
  readDispatchedAgentCommand,
} from "../../../modules/automation/index.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString();
      if (raw.length > 8192)
        reject(
          new ApplicationError(
            "VALIDATION_ERROR",
            "Request body is too large.",
          ),
        );
    });
    req.on("error", reject);
    req.on("end", () => {
      try {
        const value = raw ? JSON.parse(raw) : {};
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw 0;
        resolve(value as Record<string, unknown>);
      } catch {
        reject(
          new ApplicationError(
            "VALIDATION_ERROR",
            "A JSON object is required.",
          ),
        );
      }
    });
  });
}
function requireAgent(principal: Principal) {
  if (principal.actor_type !== "AGENT")
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "An authenticated enrolled Agent is required.",
    );
}

export async function handleAgentAutomationActionRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  principal: Principal;
  uow: UnitOfWork;
}): Promise<boolean> {
  const pathname = input.req.url?.split("?")[0] ?? "";
  const claim =
    input.req.method === "POST" &&
    pathname === "/api/v1/agent/automation-actions/claim";
  const accept =
    input.req.method === "POST" &&
    /^\/api\/v1\/agent\/automation-actions\/[0-9a-f-]{36}\/commands\/accept$/i.test(
      pathname,
    );
  const report =
    input.req.method === "POST" &&
    /^\/api\/v1\/agent\/automation-actions\/[0-9a-f-]{36}\/commands\/report$/i.test(
      pathname,
    );
  if (!claim && !accept && !report) return false;
  requireAgent(input.principal);
  const agentSessionId = (input.principal as Partial<AgentPrincipal>)
    .agent_session_id;
  const registered = await input.uow.run(input.principal.tenant_id, (tx) =>
    isRegisteredAgent({ tx, agentId: input.principal.id }),
  );
  if (!registered)
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Authenticated identity is not a registered Agent.",
    );
  const authenticatedAgent = input.principal as Principal &
    Partial<AgentPrincipal>;
  const messageHeader = input.req.headers["idempotency-key"];
  const messageId =
    typeof messageHeader === "string" ? messageHeader : undefined;
  if (
    input.config.environment === "production" &&
    (!messageId || !authenticatedAgent.agent_session_id)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required for authenticated Agent messages.",
    );
  if (Array.isArray(messageHeader))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Exactly one Idempotency-Key is allowed.",
    );
  if (messageId && !/^[A-Za-z0-9._:-]{1,200}$/.test(messageId))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key message identity is invalid.",
    );
  if (claim) {
    const request = await body(input.req);
    if (Object.keys(request).length)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Agent command claim does not accept caller-supplied target or action parameters.",
      );
    const requestHash = createHash("sha256")
      .update(
        canonical({ method: input.req.method, path: pathname, body: request }),
      )
      .digest("hex");
    const result = await input.uow.run(
      input.principal.tenant_id,
      async (tx) => {
        const process = async () => {
          const prior = await readPendingAutomationAction({
            tx,
            agentId: input.principal.id,
            ...(agentSessionId ? { agentSessionId } : {}),
          });
          if (prior) {
            const delivery = await readDispatchedAgentCommand(tx, {
              agentId: input.principal.id,
              commandId: prior.command_id,
              executionId: prior.execution_id,
            });
            if (!delivery)
              throw new ApplicationError(
                "AGENT_COMMAND_ID_CONFLICT",
                "Agent delivery receipt has no matching execution.",
              );
            if (delivery.state !== "DISPATCHED") return null;
            const command = delivery.command;
            const hash = createHash("sha256")
              .update(canonical(command))
              .digest("hex");
            if (hash !== prior.command_hash)
              throw new ApplicationError(
                "AGENT_COMMAND_ID_CONFLICT",
                "Dispatched command content changed after delivery.",
              );
            return command;
          }
          const baseline = await readRestartBaseline({
            tx,
            agentId: input.principal.id,
          });
          const command = await claimAgentRestart(
            tx,
            input.principal.id,
            baseline,
            new PostgresAutomationSecurity(tx),
          );
          if (!command) return null;
          const executionId = String(command.execution_id),
            commandId = String(command.command_id);
          const hash = createHash("sha256")
            .update(canonical(command))
            .digest("hex");
          await recordAutomationActionDelivery({
            tx,
            agentId: input.principal.id,
            commandId,
            executionId,
            commandHash: hash,
            ...(agentSessionId ? { agentSessionId } : {}),
          });
          return command;
        };
        if (!messageId || !agentSessionId) return process();
        return processAgentMessage({
          tx,
          principal: authenticatedAgent as AgentPrincipal,
          messageId,
          requestSha256: requestHash,
          resolveExecutionAttemptId: (value) =>
            value && typeof value === "object" && "execution_id" in value
              ? String((value as { execution_id: unknown }).execution_id)
              : undefined,
          process,
        });
      },
    );
    json(input.res, 200, { data: result, meta: input.context });
    return true;
  }
  const match = pathname.match(
    /\/automation-actions\/([0-9a-f-]{36})\/commands\/(accept|report)$/i,
  )!;
  const commandId = match[1]!;
  const request = await body(input.req);
  const requestHash = createHash("sha256")
    .update(
      canonical({ method: input.req.method, path: pathname, body: request }),
    )
    .digest("hex");
  const result = await input.uow.run(input.principal.tenant_id, async (tx) => {
    const process = async () => {
      if (accept) {
        if (Object.keys(request).length)
          throw new ApplicationError(
            "VALIDATION_ERROR",
            "Acceptance is bound to the command ID in the route and accepts no mutable payload.",
          );
        return acceptAutomationAction({
          tx,
          agentId: input.principal.id,
          commandId,
          acceptedAt: new Date().toISOString(),
          correlationId: input.context.correlation_id,
          ...(agentSessionId ? { agentSessionId } : {}),
        });
      }
      const allowed = new Set(["outcome", "reason_code"]);
      if (
        Object.keys(request).some((key) => !allowed.has(key)) ||
        request.outcome !== "REJECTED" ||
        typeof request.reason_code !== "string" ||
        !new Set([
          "UNSUPPORTED_CAPABILITY",
          "LOCAL_SAFETY_DENIED",
          "AGENT_BUSY",
          "COMMAND_EXPIRED",
        ]).has(request.reason_code)
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Only a typed RESTART_AGENT rejection can be reported.",
        );
      return rejectAutomationAction({
        tx,
        agentId: input.principal.id,
        commandId,
        reason: request.reason_code,
        correlationId: input.context.correlation_id,
        ...(agentSessionId ? { agentSessionId } : {}),
      });
    };
    if (!messageId || !authenticatedAgent.agent_session_id) return process();
    const attempt = await tx.query<{ id: string }>(
      `SELECT id FROM automation.action_executions
       WHERE tenant_id=$1 AND target_agent_id=$2 AND command_id=$3`,
      [input.principal.tenant_id, input.principal.id, commandId],
    );
    return processAgentMessage({
      tx,
      principal: authenticatedAgent as AgentPrincipal,
      messageId,
      requestSha256: requestHash,
      ...(attempt.rows[0]?.id
        ? { executionAttemptId: attempt.rows[0].id }
        : {}),
      process,
    });
  });
  json(input.res, 200, { data: result, meta: input.context });
  return true;
}
