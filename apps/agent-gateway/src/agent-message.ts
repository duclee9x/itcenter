import type { IncomingMessage } from "node:http";
import type { Principal } from "../../../packages/auth/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  agentMessageDigest,
  processAgentMessage,
  requireAgentMessageId,
} from "../../../modules/agent/application/message-receipts.js";
import type { AgentPrincipal } from "../../../modules/agent/application/authentication.js";

export async function withAgentMessageReceipt<T>(input: {
  tx: Transaction;
  req: IncomingMessage;
  principal: Principal;
  body: unknown;
  process: () => Promise<T>;
  production: boolean;
}): Promise<T> {
  const candidate = input.principal as Principal & Partial<AgentPrincipal>;
  if (candidate.actor_type !== "AGENT") return input.process();
  const rawId = input.req.headers["idempotency-key"];
  if (input.production || candidate.agent_session_id) {
    const messageId = requireAgentMessageId(rawId);
    if (!candidate.agent_session_id || !candidate.credential_id) {
      if (input.production)
        throw new ApplicationError(
          "AUTHENTICATION_REQUIRED",
          "Authenticated Agent session is unavailable.",
        );
      return input.process();
    }
    return processAgentMessage({
      tx: input.tx,
      principal: candidate as AgentPrincipal,
      messageId,
      requestSha256: agentMessageDigest({
        method: input.req.method,
        path: input.req.url,
        body: input.body,
      }),
      process: input.process,
    });
  }
  return input.process();
}

export function agentMessageIdempotencyPrincipal(principal: Principal): string {
  const candidate = principal as Principal & Partial<AgentPrincipal>;
  return candidate.agent_session_id
    ? `${principal.id}:${candidate.agent_session_id}`
    : principal.id;
}
