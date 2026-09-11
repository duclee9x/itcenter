import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

const transitions: Record<string, readonly string[]> = {
  PLANNED: ["PURCHASED"],
  PURCHASED: ["RECEIVED"],
  RECEIVED: ["AVAILABLE"],
  AVAILABLE: ["RESERVED", "RETIRED"],
  RESERVED: ["ASSIGNED"],
  ASSIGNED: ["IN_USE"],
  IN_USE: ["REPAIR", "RETURNED"],
  REPAIR: ["IN_USE", "AVAILABLE"],
  RETURNED: ["REPAIR", "AVAILABLE", "RETIRED"],
  RETIRED: ["DISPOSED"],
  DISPOSED: [],
};

export async function transitionLifecycle(input: {
  tx: Transaction;
  assetId: string;
  expectedVersion: number;
  targetState: string;
  actorType: string;
  actorId: string;
  reason: string;
  correlationId: string;
  commandType?: string;
}): Promise<{
  id: string;
  from_state: string;
  to_state: string;
  version: number;
}> {
  if (!Number.isSafeInteger(input.expectedVersion) || !input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version and reason are required.",
    );
  const result = await input.tx.query(
    "SELECT id,lifecycle_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  const asset = result.rows[0]!;
  assertVersion(asset.version, input.expectedVersion);
  if (!transitions[String(asset.lifecycle_state)]?.includes(input.targetState))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      `Invalid asset lifecycle transition to ${input.targetState}.`,
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE asset.assets SET lifecycle_state=$1, assignment_state=CASE WHEN $1='RESERVED' THEN 'RESERVED' WHEN $1='AVAILABLE' THEN 'UNASSIGNED' ELSE assignment_state END,updated_at=now(),version=$2 WHERE tenant_id=$3 AND id=$4",
    [input.targetState, version, input.tx.tenantId, input.assetId],
  );
  await input.tx.query(
    "INSERT INTO asset.lifecycle_transitions(id,tenant_id,asset_id,from_state,to_state,command_type,actor_type,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.assetId,
      asset.lifecycle_state,
      input.targetState,
      input.commandType ?? `ASSET.${input.targetState}`,
      input.actorType,
      input.actorId,
      input.reason,
      input.correlationId,
    ],
  );
  return {
    id: input.assetId,
    from_state: String(asset.lifecycle_state),
    to_state: input.targetState,
    version,
  };
}

export async function reserveAsset(input: {
  tx: Transaction;
  assetId: string;
  expectedVersion: number;
  requestedFor: string;
  reason: string;
  expiresAt: string;
  actorType: string;
  actorId: string;
  correlationId: string;
}): Promise<{
  reservation_id: string;
  asset_id: string;
  expires_at: string;
  version: number;
}> {
  if (
    !input.requestedFor.trim() ||
    new Date(input.expiresAt).getTime() <= Date.now()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "requested_for and a future expires_at are required.",
    );
  const changed = await transitionLifecycle({
    ...input,
    targetState: "RESERVED",
    commandType: "ASSET.RESERVE",
  });
  const id = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO asset.reservations(id,tenant_id,asset_id,requested_for,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        input.tx.tenantId,
        input.assetId,
        input.requestedFor,
        input.reason,
        input.expiresAt,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Asset already has an active reservation.",
      );
    throw error;
  }
  return {
    reservation_id: id,
    asset_id: input.assetId,
    expires_at: input.expiresAt,
    version: changed.version,
  };
}
