import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

export async function recordHeartbeat(input: {
  tx: Transaction;
  agentId: string;
  agentVersion: string;
  now: string;
}) {
  const result = await input.tx.query(
    "UPDATE agent.agents SET status='ONLINE',agent_version=$1,last_seen_at=$2,updated_at=now() WHERE tenant_id=$3 AND id=$4 RETURNING id,asset_id,agent_version,status,last_seen_at",
    [input.agentVersion, input.now, input.tx.tenantId, input.agentId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Agent was not found.");
  return result.rows[0]!;
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
