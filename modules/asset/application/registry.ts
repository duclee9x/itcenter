import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
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
