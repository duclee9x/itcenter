import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

export async function grantTemporary(input: {
  tx: Transaction;
  principalId: string;
  permissionId: string;
  scopeType: string;
  scopeId: string;
  validFrom: Date;
  validUntil: Date;
  reason: string;
}): Promise<{ id: string; version: number }> {
  if (
    !input.reason.trim() ||
    input.validUntil <= input.validFrom ||
    !input.scopeType.trim() ||
    !input.scopeId.trim()
  )
    throw new ApplicationError("VALIDATION_ERROR", "Invalid temporary grant.");
  const user = await input.tx.query(
    "SELECT id FROM identity.users WHERE tenant_id=$1 AND id=$2 AND employment_status='ACTIVE' AND archived_at IS NULL",
    [input.tx.tenantId, input.principalId],
  );
  if (!user.rowCount)
    throw new ApplicationError("NOT_FOUND", "Target user is not active.");
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO identity.temporary_grants(id,tenant_id,principal_id,permission_id,scope_type,scope_id,valid_from,valid_until,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      id,
      input.tx.tenantId,
      input.principalId,
      input.permissionId,
      input.scopeType,
      input.scopeId,
      input.validFrom,
      input.validUntil,
      input.reason,
    ],
  );
  return { id, version: 1 };
}

export async function revokeTemporary(
  tx: Transaction,
  id: string,
  expectedVersion: number,
): Promise<void> {
  const row = await tx.query(
    "UPDATE identity.temporary_grants SET revoked_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 AND version=$3 AND revoked_at IS NULL RETURNING id",
    [tx.tenantId, id, expectedVersion],
  );
  if (!row.rowCount)
    throw new ApplicationError("VERSION_CONFLICT", "Temporary grant changed.");
}
