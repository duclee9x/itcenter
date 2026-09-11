import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
const transitions: Record<string, string[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["DIAGNOSING", "CANCELLED"],
  DIAGNOSING: [
    "WAITING_APPROVAL",
    "WAITING_PART",
    "WAITING_VENDOR",
    "IN_REPAIR",
  ],
  WAITING_APPROVAL: ["IN_REPAIR", "CANCELLED"],
  WAITING_PART: ["IN_REPAIR", "CANCELLED"],
  WAITING_VENDOR: ["IN_REPAIR", "CANCELLED"],
  IN_REPAIR: ["VERIFYING", "FAILED"],
  VERIFYING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};
export async function createWarranty(input: {
  tx: Transaction;
  assetId: string;
  provider: string;
  contractRef?: string | undefined;
  startsAt: string;
  endsAt: string;
  coverage: string;
}) {
  if (
    !input.provider.trim() ||
    !input.coverage.trim() ||
    new Date(input.endsAt) < new Date(input.startsAt)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Valid warranty provider, coverage and dates are required.",
    );
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO maintenance.warranties(id,tenant_id,asset_id,provider,contract_ref,starts_at,ends_at,coverage) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      input.tx.tenantId,
      input.assetId,
      input.provider,
      input.contractRef ?? null,
      input.startsAt,
      input.endsAt,
      input.coverage,
    ],
  );
  return { id, asset_id: input.assetId, ends_at: input.endsAt };
}
export async function createMaintenance(input: {
  tx: Transaction;
  assetId: string;
  title: string;
  description: string;
  warrantyId?: string | undefined;
}) {
  if (!input.title.trim() || !input.description.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "title and description are required.",
    );
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO maintenance.orders(id,tenant_id,asset_id,title,description,warranty_id) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      input.tx.tenantId,
      input.assetId,
      input.title,
      input.description,
      input.warrantyId ?? null,
    ],
  );
  return { id, asset_id: input.assetId, state: "DRAFT", version: 1 };
}
export async function transitionMaintenance(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  targetState: string;
  reason: string;
}) {
  const row = await input.tx.query(
    "SELECT id,state,version FROM maintenance.orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.id],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Maintenance order was not found.");
  const item = row.rows[0]!;
  assertVersion(item.version, input.expectedVersion);
  if (
    !input.reason.trim() ||
    !transitions[String(item.state)]?.includes(input.targetState)
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid maintenance transition or reason.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE maintenance.orders SET state=$1,version=$2,updated_at=now() WHERE tenant_id=$3 AND id=$4",
    [input.targetState, version, input.tx.tenantId, input.id],
  );
  return {
    id: input.id,
    from_state: String(item.state),
    to_state: input.targetState,
    version,
  };
}
