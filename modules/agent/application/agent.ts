import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";

export async function recordHeartbeat(input: {
  tx: Transaction;
  agentId: string;
  agentVersion: string;
  now: string;
  runtimeId?: string;
  sessionId?: string;
}) {
  const result = await input.tx.query(
    "UPDATE agent.agents SET status='ONLINE',agent_version=$1,last_seen_at=$2,agent_runtime_id=COALESCE($3,agent_runtime_id),agent_session_id=COALESCE($4,agent_session_id),updated_at=now() WHERE tenant_id=$5 AND id=$6 RETURNING id,asset_id,agent_version,status,last_seen_at,agent_runtime_id,agent_session_id",
    [
      input.agentVersion,
      input.now,
      input.runtimeId ?? null,
      input.sessionId ?? null,
      input.tx.tenantId,
      input.agentId,
    ],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Agent was not found.");
  return result.rows[0]!;
}

export async function recordAutomationActionDelivery(input: {
  tx: Transaction;
  agentId: string;
  commandId: string;
  executionId: string;
  commandHash: string;
}) {
  const existing = await input.tx.query<{
    command_hash: string;
    execution_id: string;
    state: string;
  }>(
    "SELECT command_hash,execution_id,state FROM agent.automation_action_receipts WHERE tenant_id=$1 AND agent_id=$2 AND command_id=$3 FOR UPDATE",
    [input.tx.tenantId, input.agentId, input.commandId],
  );
  if (existing.rowCount) {
    if (
      existing.rows[0]!.command_hash !== input.commandHash ||
      existing.rows[0]!.execution_id !== input.executionId
    )
      throw new ApplicationError(
        "AGENT_COMMAND_ID_CONFLICT",
        "Command ID was reused with different content.",
      );
    return existing.rows[0];
  }
  await input.tx.query(
    "INSERT INTO agent.automation_action_receipts(tenant_id,agent_id,command_id,execution_id,command_hash,state) VALUES($1,$2,$3,$4,$5,'DELIVERED')",
    [
      input.tx.tenantId,
      input.agentId,
      input.commandId,
      input.executionId,
      input.commandHash,
    ],
  );
  return {
    command_hash: input.commandHash,
    execution_id: input.executionId,
    state: "DELIVERED",
  };
}

export async function readPendingAutomationAction(input: {
  tx: Transaction;
  agentId: string;
}) {
  const result = await input.tx.query<{
    command_id: string;
    execution_id: string;
    command_hash: string;
    state: string;
  }>(
    "SELECT command_id,execution_id,command_hash,state FROM agent.automation_action_receipts WHERE tenant_id=$1 AND agent_id=$2 AND state='DELIVERED' ORDER BY created_at LIMIT 1 FOR UPDATE",
    [input.tx.tenantId, input.agentId],
  );
  return result.rows[0] ?? null;
}

export async function readRestartBaseline(input: {
  tx: Transaction;
  agentId: string;
}) {
  const result = await input.tx.query<{
    tenant_id: string;
    id: string;
    agent_runtime_id: string | null;
    agent_session_id: string | null;
    last_seen_at: Date | null;
    status: string;
  }>(
    "SELECT tenant_id,id,agent_runtime_id,agent_session_id,last_seen_at,status FROM agent.agents WHERE tenant_id=$1 AND id=$2 AND status<>'UNMANAGED' FOR SHARE",
    [input.tx.tenantId, input.agentId],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.tenant_id !== input.tx.tenantId ||
    !row.agent_runtime_id ||
    !row.last_seen_at
  )
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "Agent restart baseline is unavailable.",
      true,
    );
  return {
    tenant_id: row.tenant_id,
    agent_id: row.id,
    agent_runtime_id: row.agent_runtime_id,
    agent_session_id: row.agent_session_id,
    last_seen_at: row.last_seen_at,
  };
}

export async function isRegisteredAgent(input: {
  tx: Transaction;
  agentId: string;
}) {
  const result = await input.tx.query<{ id: string }>(
    "SELECT id FROM agent.agents WHERE tenant_id=$1 AND id=$2 AND status<>'UNMANAGED'",
    [input.tx.tenantId, input.agentId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function acceptAutomationAction(input: {
  tx: Transaction;
  agentId: string;
  commandId: string;
  acceptedAt: string;
  correlationId: string;
}) {
  const row = await input.tx.query<{
    execution_id: string;
    state: string;
    accepted_at: Date | null;
  }>(
    "SELECT execution_id,state,accepted_at FROM agent.automation_action_receipts WHERE tenant_id=$1 AND agent_id=$2 AND command_id=$3 FOR UPDATE",
    [input.tx.tenantId, input.agentId, input.commandId],
  );
  const receipt = row.rows[0];
  if (!receipt)
    throw new ApplicationError("NOT_FOUND", "Agent command was not delivered.");
  if (receipt.state === "REJECTED")
    throw new ApplicationError(
      "AGENT_COMMAND_REJECTED",
      "Agent command was already rejected.",
    );
  if (receipt.state !== "ACCEPTED") {
    await input.tx.query(
      "UPDATE agent.automation_action_receipts SET state='ACCEPTED',accepted_at=$1,updated_at=now() WHERE tenant_id=$2 AND agent_id=$3 AND command_id=$4 AND state='DELIVERED'",
      [input.acceptedAt, input.tx.tenantId, input.agentId, input.commandId],
    );
    const eventId = randomUUID();
    await new PostgresOutboxWriter(input.tx).append({
      event_id: eventId,
      event_type: "AGENT.AUTOMATION_ACTION_ACCEPTED",
      schema_version: 1,
      occurred_at: input.acceptedAt,
      producer: {
        service: "itcenter-agent-gateway",
        instance: "agent-gateway",
      },
      aggregate: { type: "AGENT", id: input.agentId, version: 1 },
      actor: { type: "AGENT", id: input.agentId },
      correlation_id: input.correlationId,
      causation_id: input.commandId,
      tenant_id: input.tx.tenantId,
      organization_id: input.tx.tenantId,
      idempotency_key: `agent-command-accepted:${input.commandId}`,
      payload: {
        agent_id: input.agentId,
        command_id: input.commandId,
        execution_id: receipt.execution_id,
        accepted_at: input.acceptedAt,
      },
    });
  }
  return {
    execution_id: receipt.execution_id,
    command_id: input.commandId,
    state: "ACCEPTED",
    accepted_at: receipt.accepted_at ?? input.acceptedAt,
  };
}

export async function rejectAutomationAction(input: {
  tx: Transaction;
  agentId: string;
  commandId: string;
  reason: string;
  correlationId: string;
}) {
  const row = await input.tx.query<{ execution_id: string; state: string }>(
    "SELECT execution_id,state FROM agent.automation_action_receipts WHERE tenant_id=$1 AND agent_id=$2 AND command_id=$3 FOR UPDATE",
    [input.tx.tenantId, input.agentId, input.commandId],
  );
  const receipt = row.rows[0];
  if (!receipt)
    throw new ApplicationError("NOT_FOUND", "Agent command was not delivered.");
  if (receipt.state === "ACCEPTED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "An accepted Agent command cannot be rejected.",
    );
  if (receipt.state !== "REJECTED") {
    await input.tx.query(
      "UPDATE agent.automation_action_receipts SET state='REJECTED',result_json=$1,updated_at=now() WHERE tenant_id=$2 AND agent_id=$3 AND command_id=$4 AND state='DELIVERED'",
      [
        JSON.stringify({ reason: input.reason }),
        input.tx.tenantId,
        input.agentId,
        input.commandId,
      ],
    );
    await new PostgresOutboxWriter(input.tx).append({
      event_id: randomUUID(),
      event_type: "AGENT.AUTOMATION_ACTION_REJECTED",
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      producer: {
        service: "itcenter-agent-gateway",
        instance: "agent-gateway",
      },
      aggregate: { type: "AGENT", id: input.agentId, version: 1 },
      actor: { type: "AGENT", id: input.agentId },
      correlation_id: input.correlationId,
      causation_id: input.commandId,
      tenant_id: input.tx.tenantId,
      organization_id: input.tx.tenantId,
      idempotency_key: `agent-command-rejected:${input.commandId}`,
      payload: {
        agent_id: input.agentId,
        command_id: input.commandId,
        execution_id: receipt.execution_id,
        reason_code: "AGENT_COMMAND_REJECTED",
      },
    });
  }
  return {
    execution_id: receipt.execution_id,
    command_id: input.commandId,
    state: "REJECTED",
  };
}

export async function resolveDeploymentAgentContext(input: {
  tx: Transaction;
  agentId: string;
  now?: Date;
  maxHeartbeatAgeSeconds?: number;
}) {
  const result = await input.tx.query(
    "SELECT id,asset_id,status,last_seen_at FROM agent.agents WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.agentId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Enrolled agent was not found.");
  const row = result.rows[0]!;
  const now = input.now ?? new Date();
  const maxAge = (input.maxHeartbeatAgeSeconds ?? 300) * 1000;
  if (
    row.status !== "ONLINE" ||
    !row.last_seen_at ||
    now.getTime() - new Date(row.last_seen_at).getTime() > maxAge
  )
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "Agent must have a recent online heartbeat to receive deployment work.",
      true,
    );
  return { agent_id: String(row.id), asset_id: String(row.asset_id) };
}

export async function recordInventory(input: {
  tx: Transaction;
  agentId: string;
  dataset: string;
  inventory: unknown;
  observedAt: string;
}) {
  if (!["hardware", "software"].includes(input.dataset))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "dataset must be hardware or software.",
    );
  const column =
    input.dataset === "hardware" ? "hardware_inventory" : "software_inventory";
  const timestamp =
    input.dataset === "hardware"
      ? "hardware_inventory_at"
      : "software_inventory_at";
  const result = await input.tx.query(
    `UPDATE agent.agents SET ${column}=$1::jsonb,${timestamp}=$2,updated_at=now() WHERE tenant_id=$3 AND id=$4 RETURNING id,asset_id`,
    [
      JSON.stringify(input.inventory),
      input.observedAt,
      input.tx.tenantId,
      input.agentId,
    ],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Agent was not found.");
  return {
    id: String(result.rows[0]!.id),
    asset_id: String(result.rows[0]!.asset_id),
    dataset: input.dataset,
    observed_at: input.observedAt,
    snapshot_id: randomUUID(),
  };
}

export async function issueEnrollmentToken(input: {
  tx: Transaction;
  assetId: string;
  agentVersion: string;
  expiresAt: string;
}) {
  const asset = await input.tx.query(
    "SELECT id FROM asset.assets WHERE tenant_id=$1 AND id=$2 AND lifecycle_state NOT IN ('RETIRED','DISPOSED')",
    [input.tx.tenantId, input.assetId],
  );
  if (!asset.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Asset was not found or cannot enroll an agent.",
    );
  const existing = await input.tx.query(
    "SELECT id FROM agent.agents WHERE tenant_id=$1 AND asset_id=$2",
    [input.tx.tenantId, input.assetId],
  );
  if (existing.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Asset already has an enrolled agent.",
    );
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO agent.agents(id,tenant_id,asset_id,agent_version,enrollment_token_hash,enrollment_token_expires_at) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      input.tx.tenantId,
      input.assetId,
      input.agentVersion,
      createHash("sha256").update(token).digest("hex"),
      input.expiresAt,
    ],
  );
  return {
    id,
    asset_id: input.assetId,
    agent_version: input.agentVersion,
    enrollment_token: token,
    expires_at: input.expiresAt,
  };
}
