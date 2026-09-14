import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import type { AgentPrincipal } from "./authentication.js";
import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function agentMessageDigest(input: {
  method: string | undefined;
  path: string | undefined;
  body: unknown;
}): string {
  return createHash("sha256").update(canonical(input)).digest("hex");
}

export function requireAgentMessageId(
  value: string | string[] | undefined,
): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Exactly one valid Idempotency-Key is required for Agent messages.",
    );
  return value;
}

export async function processAgentMessage<T>(input: {
  tx: Transaction;
  principal: AgentPrincipal;
  messageId: string;
  requestSha256: string;
  executionAttemptId?: string;
  resolveExecutionAttemptId?: (result: T) => string | undefined;
  process: () => Promise<T>;
}): Promise<T> {
  if (!input.messageId.trim() || input.messageId.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key message identity is invalid.",
    );
  const inserted = await input.tx.query(
    `INSERT INTO agent.agent_message_receipts
      (tenant_id,agent_id,agent_session_id,message_id,execution_attempt_id,request_sha256,state)
     VALUES($1,$2,$3,$4,$5,$6,'PROCESSING')
     ON CONFLICT(tenant_id,agent_id,agent_session_id,message_id) DO NOTHING
     RETURNING message_id`,
    [
      input.principal.tenant_id,
      input.principal.id,
      input.principal.agent_session_id,
      input.messageId,
      input.executionAttemptId ?? null,
      input.requestSha256,
    ],
  );
  if (!inserted.rowCount) {
    const prior = await input.tx.query<{
      request_sha256: string;
      state: string;
      response_json: { value?: T } | null;
    }>(
      `SELECT request_sha256,state,response_json FROM agent.agent_message_receipts
       WHERE tenant_id=$1 AND agent_id=$2 AND agent_session_id=$3 AND message_id=$4
       FOR UPDATE`,
      [
        input.principal.tenant_id,
        input.principal.id,
        input.principal.agent_session_id,
        input.messageId,
      ],
    );
    const row = prior.rows[0];
    if (!row || row.request_sha256 !== input.requestSha256)
      throw new ApplicationError(
        "AGENT_MESSAGE_CONFLICT",
        "Agent message identity conflicts with prior content.",
      );
    if (
      row.state !== "COMPLETED" ||
      !row.response_json ||
      !("value" in row.response_json)
    )
      throw new ApplicationError(
        "OPERATION_IN_PROGRESS",
        "Agent message is already being processed.",
        true,
      );
    return row.response_json.value as T;
  }
  const result = await input.process();
  const executionAttemptId =
    input.executionAttemptId ?? input.resolveExecutionAttemptId?.(result);
  const response = JSON.stringify({ value: result ?? null });
  await input.tx.query(
    `UPDATE agent.agent_message_receipts SET state='COMPLETED',response_status=200,
       response_json=$5::jsonb,execution_attempt_id=$6,completed_at=now()
     WHERE tenant_id=$1 AND agent_id=$2 AND agent_session_id=$3 AND message_id=$4`,
    [
      input.principal.tenant_id,
      input.principal.id,
      input.principal.agent_session_id,
      input.messageId,
      response,
      executionAttemptId ?? null,
    ],
  );
  return result;
}
