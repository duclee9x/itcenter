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
  agentSessionId?: string;
}) {
  const existing = await input.tx.query<{
    command_hash: string;
    execution_id: string;
    state: string;
    agent_transport_session_id: string | null;
  }>(
    "SELECT command_hash,execution_id,state,agent_transport_session_id FROM agent.automation_action_receipts WHERE tenant_id=$1 AND agent_id=$2 AND command_id=$3 FOR UPDATE",
    [input.tx.tenantId, input.agentId, input.commandId],
  );
  if (existing.rowCount) {
    if (
      existing.rows[0]!.command_hash !== input.commandHash ||
      existing.rows[0]!.execution_id !== input.executionId ||
      (input.agentSessionId &&
        existing.rows[0]!.agent_transport_session_id !== input.agentSessionId)
    )
      throw new ApplicationError(
        "AGENT_COMMAND_ID_CONFLICT",
        "Command ID was reused with different content.",
      );
    return existing.rows[0];
  }
  await input.tx.query(
    "INSERT INTO agent.automation_action_receipts(tenant_id,agent_id,command_id,execution_id,command_hash,state,agent_transport_session_id) VALUES($1,$2,$3,$4,$5,'DELIVERED',$6)",
    [
      input.tx.tenantId,
      input.agentId,
      input.commandId,
      input.executionId,
      input.commandHash,
      input.agentSessionId ?? null,
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
  agentSessionId?: string;
}) {
  const result = await input.tx.query<{
    command_id: string;
    execution_id: string;
    command_hash: string;
    state: string;
  }>(
    "SELECT command_id,execution_id,command_hash,state FROM agent.automation_action_receipts WHERE tenant_id=$1 AND agent_id=$2 AND agent_transport_session_id IS NOT DISTINCT FROM $3 AND state='DELIVERED' ORDER BY created_at LIMIT 1 FOR UPDATE",
    [input.tx.tenantId, input.agentId, input.agentSessionId ?? null],
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

export async function readAgentRuntimeEvidence(input: {
  tx: Transaction;
  agentId: string;
}) {
  const result = await input.tx.query<{
    id: string;
    status: string;
    agent_runtime_id: string | null;
    agent_session_id: string | null;
    last_seen_at: Date | null;
  }>(
    "SELECT id,status,agent_runtime_id,agent_session_id,last_seen_at FROM agent.agents WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.agentId],
  );
  return result.rows[0] ?? null;
}

export async function acceptAutomationAction(input: {
  tx: Transaction;
  agentId: string;
  commandId: string;
  acceptedAt: string;
  correlationId: string;
  agentSessionId?: string;
}) {
  const row = await input.tx.query<{
    execution_id: string;
    state: string;
    accepted_at: Date | null;
    agent_transport_session_id: string | null;
  }>(
    "SELECT execution_id,state,accepted_at,agent_transport_session_id FROM agent.automation_action_receipts WHERE tenant_id=$1 AND agent_id=$2 AND command_id=$3 FOR UPDATE",
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
  if (
    input.agentSessionId &&
    receipt.agent_transport_session_id !== input.agentSessionId
  )
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Agent command belongs to another authenticated session.",
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
  agentSessionId?: string;
}) {
  const row = await input.tx.query<{
    execution_id: string;
    state: string;
    agent_transport_session_id: string | null;
  }>(
    "SELECT execution_id,state,agent_transport_session_id FROM agent.automation_action_receipts WHERE tenant_id=$1 AND agent_id=$2 AND command_id=$3 FOR UPDATE",
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
  if (
    input.agentSessionId &&
    receipt.agent_transport_session_id !== input.agentSessionId
  )
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Agent command belongs to another authenticated session.",
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
  agentId: string;
  actorId: string;
  reason: string;
  idempotencyKey: string;
  now?: Date;
}) {
  const registration = await input.tx.query<{
    id: string;
    asset_id: string;
    registration_status: string;
  }>(
    `SELECT a.id,a.asset_id,a.registration_status
     FROM agent.agents a JOIN asset.assets x
       ON x.tenant_id=a.tenant_id AND x.id=a.asset_id
     WHERE a.tenant_id=$1 AND a.id=$2
       AND a.registration_status='ACTIVE'
       AND x.lifecycle_state NOT IN ('RETIRED','DISPOSED')
     FOR UPDATE OF a`,
    [input.tx.tenantId, input.agentId],
  );
  if (!registration.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Agent registration was not found or cannot enroll.",
    );
  const now = input.now ?? new Date();
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        agentId: input.agentId,
        tenantId: input.tx.tenantId,
        reason: input.reason,
      }),
    )
    .digest("hex");
  const prior = await input.tx.query<{ request_sha256: string }>(
    `SELECT request_sha256 FROM agent.enrollment_tokens
     WHERE tenant_id=$1 AND agent_id=$2 AND idempotency_key=$3`,
    [input.tx.tenantId, input.agentId, input.idempotencyKey],
  );
  if (prior.rowCount) {
    if (prior.rows[0]!.request_sha256 !== requestHash)
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "Idempotency key was reused with different content.",
      );
    throw new ApplicationError(
      "OPERATION_IN_PROGRESS",
      "The one-time token has already been issued and cannot be shown again.",
    );
  }
  const usableCredential = await input.tx.query(
    `SELECT id FROM agent.agent_credentials
     WHERE tenant_id=$1 AND agent_id=$2 AND status='ACTIVE'
       AND expires_at>=$3 AND (overlap_until IS NULL OR overlap_until>$3)
     FOR UPDATE`,
    [input.tx.tenantId, input.agentId, now],
  );
  if (usableCredential.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "A valid Agent credential already exists; use self-rotation or authorized forced re-enrollment.",
    );
  const outstandingToken = await input.tx.query(
    `SELECT id FROM agent.enrollment_tokens
     WHERE tenant_id=$1 AND agent_id=$2 AND status='ISSUED' AND expires_at>$3
     FOR UPDATE`,
    [input.tx.tenantId, input.agentId, now],
  );
  if (outstandingToken.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "An unexpired enrollment token already exists for this registration.",
    );
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  const token = randomBytes(32).toString("base64url");
  const verifier = createHash("sha256").update(token).digest("hex");
  const id = randomUUID();
  await input.tx.query(
    `INSERT INTO agent.enrollment_tokens
      (id,tenant_id,agent_id,asset_id,verifier_sha256,idempotency_key,
       request_sha256,issued_at,expires_at,issued_by,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      input.tx.tenantId,
      input.agentId,
      registration.rows[0]!.asset_id,
      verifier,
      input.idempotencyKey,
      requestHash,
      now.toISOString(),
      expiresAt.toISOString(),
      input.actorId,
      input.reason,
    ],
  );
  return {
    token_id: id,
    agent_id: input.agentId,
    asset_id: registration.rows[0]!.asset_id,
    enrollment_token: token,
    expires_at: expiresAt.toISOString(),
  };
}

export async function forceAgentReenrollment(input: {
  tx: Transaction;
  agentId: string;
  actorId: string;
  reason: string;
  expectedRegistrationVersion: number;
  idempotencyKey: string;
  now?: Date;
}) {
  if (
    !input.reason.trim() ||
    !Number.isSafeInteger(input.expectedRegistrationVersion) ||
    input.expectedRegistrationVersion < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Reason and expected registration version are required.",
    );
  const registration = await input.tx.query<{
    registration_version: number;
    registration_status: string;
  }>(
    `SELECT registration_version,registration_status FROM agent.agents
     WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tx.tenantId, input.agentId],
  );
  const row = registration.rows[0];
  if (!row || row.registration_status !== "ACTIVE")
    throw new ApplicationError(
      "NOT_FOUND",
      "Active Agent registration was not found.",
    );
  if (row.registration_version !== input.expectedRegistrationVersion)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Agent registration has changed.",
    );
  const revoked = await input.tx.query<{ id: string }>(
    `UPDATE agent.agent_credentials SET status='REVOKED',revoked_at=now(),
       revocation_reason=$3,entity_version=entity_version+1,updated_at=now()
     WHERE tenant_id=$1 AND agent_id=$2 AND status='ACTIVE' RETURNING id`,
    [input.tx.tenantId, input.agentId, input.reason],
  );
  await input.tx.query(
    `UPDATE agent.agent_sessions SET ended_at=COALESCE(ended_at,now())
     WHERE tenant_id=$1 AND agent_id=$2 AND ended_at IS NULL`,
    [input.tx.tenantId, input.agentId],
  );
  const token = await issueEnrollmentToken({
    tx: input.tx,
    agentId: input.agentId,
    actorId: input.actorId,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
    ...(input.now ? { now: input.now } : {}),
  });
  return {
    ...token,
    revoked_credential_ids: revoked.rows.map((row) => row.id),
  };
}

export async function createAgentRegistration(input: {
  tx: Transaction;
  assetId: string;
  actorId: string;
}) {
  const asset = await input.tx.query(
    "SELECT id FROM asset.assets WHERE tenant_id=$1 AND id=$2 AND lifecycle_state NOT IN ('RETIRED','DISPOSED')",
    [input.tx.tenantId, input.assetId],
  );
  if (!asset.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Asset was not found or cannot register an agent.",
    );
  const id = randomUUID();
  try {
    const result = await input.tx.query(
      `INSERT INTO agent.agents
        (id,tenant_id,asset_id,agent_version,registration_status,
         registration_provenance,provisioned_by)
       VALUES($1,$2,$3,NULL,'ACTIVE','AUTHORIZED_OPERATOR',$4)
       RETURNING id,tenant_id,asset_id,registration_status,created_at`,
      [id, input.tx.tenantId, input.assetId, input.actorId],
    );
    return result.rows[0]!;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "The Asset already has an active Agent registration.",
      );
    throw error;
  }
}

export async function transitionAgentRegistration(input: {
  tx: Transaction;
  agentId: string;
  target: "ACTIVE" | "DISABLED" | "RETIRED";
  expectedVersion: number;
  reason: string;
}) {
  if (
    !input.reason.trim() ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Reason and expected version are required.",
    );
  const current = await input.tx.query<{
    registration_status: string;
    registration_version: number;
  }>(
    `SELECT registration_status,registration_version FROM agent.agents
     WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tx.tenantId, input.agentId],
  );
  const row = current.rows[0];
  if (!row)
    throw new ApplicationError(
      "NOT_FOUND",
      "Agent registration was not found.",
    );
  if (row.registration_version !== input.expectedVersion)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Agent registration has changed.",
    );
  if (
    row.registration_status === "RETIRED" ||
    (row.registration_status === "DISABLED" && input.target === "DISABLED")
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Agent registration cannot make this transition.",
    );
  if (input.target === "ACTIVE" && row.registration_status !== "DISABLED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a disabled registration may be re-enabled.",
    );
  const updated = await input.tx.query<{
    registration_status: string;
    registration_version: number;
  }>(
    `UPDATE agent.agents SET registration_status=$3,registration_version=registration_version+1,
       disabled_at=CASE WHEN $3='DISABLED' THEN now() WHEN $3='ACTIVE' THEN NULL ELSE disabled_at END,
       retired_at=CASE WHEN $3='RETIRED' THEN now() ELSE retired_at END,updated_at=now()
     WHERE tenant_id=$1 AND id=$2 AND registration_version=$4
     RETURNING registration_status,registration_version`,
    [input.tx.tenantId, input.agentId, input.target, input.expectedVersion],
  );
  if (!updated.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Agent registration has changed.",
    );
  if (input.target !== "ACTIVE")
    await input.tx.query(
      `UPDATE agent.agent_sessions SET ended_at=COALESCE(ended_at,now()) WHERE tenant_id=$1 AND agent_id=$2 AND ended_at IS NULL`,
      [input.tx.tenantId, input.agentId],
    );
  return { agent_id: input.agentId, ...updated.rows[0]! };
}

export async function revokeEnrollmentToken(input: {
  tx: Transaction;
  agentId: string;
  tokenId: string;
  expectedVersion: number;
  reason: string;
}) {
  if (
    !input.reason.trim() ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Reason and expected version are required.",
    );
  const result = await input.tx.query<{ entity_version: number }>(
    `UPDATE agent.enrollment_tokens SET status='REVOKED',revoked_at=now(),
       entity_version=entity_version+1,updated_at=now()
     WHERE tenant_id=$1 AND agent_id=$2 AND id=$3 AND status='ISSUED'
       AND entity_version=$4 RETURNING entity_version`,
    [input.tx.tenantId, input.agentId, input.tokenId, input.expectedVersion],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Enrollment token is no longer revocable or has changed.",
    );
  return {
    token_id: input.tokenId,
    agent_id: input.agentId,
    status: "REVOKED",
    entity_version: result.rows[0]!.entity_version,
  };
}
