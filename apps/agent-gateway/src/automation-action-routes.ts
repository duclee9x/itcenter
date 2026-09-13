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
  readPendingAutomationAction,
  readRestartBaseline,
  recordAutomationActionDelivery,
  rejectAutomationAction,
} from "../../../modules/agent/index.js";
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
  const registered = await input.uow.run(input.principal.tenant_id, (tx) =>
    isRegisteredAgent({ tx, agentId: input.principal.id }),
  );
  if (!registered)
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Authenticated identity is not a registered Agent.",
    );
  if (claim) {
    const request = await body(input.req);
    if (Object.keys(request).length)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Agent command claim does not accept caller-supplied target or action parameters.",
      );
    const result = await input.uow.run(
      input.principal.tenant_id,
      async (tx) => {
        const prior = await readPendingAutomationAction({
          tx,
          agentId: input.principal.id,
        });
        if (prior) {
          const command = await readDispatchedAgentCommand(tx, {
            agentId: input.principal.id,
            commandId: prior.command_id,
            executionId: prior.execution_id,
          });
          if (!command)
            throw new ApplicationError(
              "AGENT_COMMAND_ID_CONFLICT",
              "Agent delivery receipt has no matching dispatched command.",
            );
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
        });
        return command;
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
  const result = await input.uow.run(input.principal.tenant_id, async (tx) => {
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
    });
  });
  json(input.res, 200, { data: result, meta: input.context });
  return true;
}
