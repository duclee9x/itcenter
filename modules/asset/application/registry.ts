import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
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
