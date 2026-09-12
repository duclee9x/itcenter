import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
export async function assertAssetExists(input: {
  tx: Transaction;
  assetId: string;
}) {
  const result = await input.tx.query(
    "SELECT id FROM asset.assets WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.assetId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  return true;
}

export async function assertAssetEligibleForLicense(input: {
  tx: Transaction;
  assetId: string;
}) {
  const result = await input.tx.query(
    `SELECT id FROM asset.assets
      WHERE tenant_id=$1 AND id=$2
        AND lifecycle_state NOT IN ('RETIRED','DISPOSED')
      FOR UPDATE`,
    [input.tx.tenantId, input.assetId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Active asset was not found in this tenant.",
    );
  return true;
}

export async function assertAssetEligibleForMaintenance(input: {
  tx: Transaction;
  assetId: string;
}) {
  const result = await input.tx.query(
    "SELECT id FROM asset.assets WHERE tenant_id=$1 AND id=$2 AND lifecycle_state NOT IN ('RETIRED','DISPOSED') FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Maintenance cannot be opened for a retired or disposed asset.",
    );
  return true;
}
export async function createAsset(input: {
  tx: Transaction;
  assetCode: string;
  assetTag?: string;
  serialNumber?: string;
  modelId: string;
  locationId?: string;
}): Promise<{ id: string; asset_code: string; version: number }> {
  if (!input.assetCode.trim() || !input.modelId.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "asset_code and model_id are required.",
    );
  const id = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_tag,serial_number,asset_model_id,current_location_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        input.tx.tenantId,
        input.assetCode,
        input.assetTag ?? null,
        input.serialNumber ?? null,
        input.modelId,
        input.locationId ?? null,
      ],
    );
  } catch (error) {
    if (
      String(error).includes("duplicate") ||
      (error as { code?: string }).code === "23505"
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Asset identifier already exists.",
      );
    if ((error as { code?: string }).code === "23503")
      throw new ApplicationError(
        "NOT_FOUND",
        "Asset model or location was not found.",
      );
    throw error;
  }
  return { id, asset_code: input.assetCode, version: 1 };
}

export async function registerReceivedAsset(input: {
  tx: Transaction;
  receivedUnitId: string;
  goodsReceiptId: string;
  modelId: string;
  serialNumber: string;
  locationId: string;
  actorId: string;
  correlationId: string;
  authorization: AuthorizationPort;
  principal: Principal;
}): Promise<{
  id: string;
  asset_code: string;
  version: number;
  created: boolean;
}> {
  await authorize(input.authorization, {
    principal: input.principal,
    action: "asset.receive",
    resource: {
      type: "asset",
      id: input.receivedUnitId,
      tenant_id: input.tx.tenantId,
    },
    scope: {},
    context: {
      source_event_type: "GOODS_RECEIPT.POSTED",
      received_unit_id: input.receivedUnitId,
      goods_receipt_id: input.goodsReceiptId,
    },
  });
  const prior = await input.tx.query(
    "SELECT r.asset_id,a.asset_code,a.version FROM asset.received_unit_registrations r JOIN asset.assets a ON a.tenant_id=r.tenant_id AND a.id=r.asset_id WHERE r.tenant_id=$1 AND r.received_unit_id=$2",
    [input.tx.tenantId, input.receivedUnitId],
  );
  if (prior.rowCount)
    return {
      id: String(prior.rows[0]!.asset_id),
      asset_code: String(prior.rows[0]!.asset_code),
      version: Number(prior.rows[0]!.version),
      created: false,
    };
  await input.tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${input.tx.tenantId}:${input.modelId}:${input.serialNumber.toLocaleLowerCase()}`,
  ]);
  const matches = await input.tx.query(
    "SELECT id FROM asset.assets WHERE tenant_id=$1 AND asset_model_id=$2 AND lower(serial_number)=lower($3) ORDER BY id FOR UPDATE",
    [input.tx.tenantId, input.modelId, input.serialNumber],
  );
  if (matches.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      matches.rowCount === 1
        ? "An Asset with this model and serial already exists; receiving requires human duplicate review."
        : "Multiple Asset matches exist for this model and serial; receiving requires human duplicate review.",
    );
  const id = randomUUID();
  const assetCode = `RCV-${input.receivedUnitId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  try {
    await input.tx.query(
      "INSERT INTO asset.assets(id,tenant_id,asset_code,serial_number,asset_model_id,current_location_id,lifecycle_state,assignment_state) VALUES($1,$2,$3,$4,$5,$6,'RECEIVED','UNASSIGNED')",
      [
        id,
        input.tx.tenantId,
        assetCode,
        input.serialNumber,
        input.modelId,
        input.locationId,
      ],
    );
    await input.tx.query(
      "INSERT INTO asset.lifecycle_transitions(id,tenant_id,asset_id,from_state,to_state,command_type,actor_type,actor_id,reason,correlation_id) VALUES($1,$2,$3,NULL,'RECEIVED','ASSET.REGISTER_RECEIVED','SYSTEM',$4,$5,$6)",
      [
        randomUUID(),
        input.tx.tenantId,
        id,
        input.actorId,
        `Registered from Goods Receipt ${input.goodsReceiptId}`,
        input.correlationId,
      ],
    );
    await input.tx.query(
      "INSERT INTO asset.received_unit_registrations(tenant_id,received_unit_id,asset_id,goods_receipt_id,asset_model_id,serial_number) VALUES($1,$2,$3,$4,$5,$6)",
      [
        input.tx.tenantId,
        input.receivedUnitId,
        id,
        input.goodsReceiptId,
        input.modelId,
        input.serialNumber,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23503")
      throw new ApplicationError(
        "NOT_FOUND",
        "Asset model or receiving location was not found.",
      );
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Asset identity is already registered; receiving requires human review.",
      );
    throw error;
  }
  return { id, asset_code: assetCode, version: 1, created: true };
}
