import { randomUUID } from "node:crypto";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";

export type AssetWarrantyProjectionState =
  "VALID" | "EXPIRING" | "EXPIRED" | "UNKNOWN";

export async function listWarrantyProjectionAssetIds(tx: Transaction) {
  const result = await tx.query<{ id: string }>(
    "SELECT id FROM asset.assets WHERE tenant_id=$1 ORDER BY id",
    [tx.tenantId],
  );
  return result.rows.map((row) => String(row.id));
}

/** Asset-owned derived projection update; source Warranty records remain in Maintenance. */
export async function projectWarrantyState(input: {
  tx: Transaction;
  assetId: string;
  state: AssetWarrantyProjectionState;
  evaluatedOn: string;
  policyVersion: string;
  evidenceReference: string | null;
  reasonCode: string | null;
  serviceName: string;
  correlationId: string;
}) {
  const beforeResult = await input.tx.query<{
    warranty_state: string;
    warranty_state_evaluated_on: string | null;
    warranty_state_policy_version: string | null;
    warranty_state_evidence_ref: string | null;
    version: number;
  }>(
    `SELECT warranty_state,warranty_state_evaluated_on::text,
            warranty_state_policy_version,warranty_state_evidence_ref,version
       FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tx.tenantId, input.assetId],
  );
  if (!beforeResult.rowCount)
    return { updated: false, reason: "ASSET_NOT_FOUND" };
  const before = beforeResult.rows[0]!;
  const changed =
    before.warranty_state !== input.state ||
    before.warranty_state_policy_version !== input.policyVersion ||
    before.warranty_state_evidence_ref !== input.evidenceReference;
  const dateChanged = before.warranty_state_evaluated_on !== input.evaluatedOn;
  if (!changed && !dateChanged) return { updated: false, reason: "CURRENT" };
  const updated = await input.tx.query<{ version: number }>(
    `UPDATE asset.assets SET warranty_state=$1,warranty_state_evaluated_on=$2,
       warranty_state_policy_version=$3,warranty_state_evidence_ref=$4,
       version=version+CASE WHEN $7 THEN 1 ELSE 0 END,updated_at=now()
      WHERE tenant_id=$5 AND id=$6 RETURNING version`,
    [
      input.state,
      input.evaluatedOn,
      input.policyVersion,
      input.evidenceReference,
      input.tx.tenantId,
      input.assetId,
      changed,
    ],
  );
  if (changed)
    await new PostgresOutboxWriter(input.tx).append({
      event_id: randomUUID(),
      event_type: "ASSET.WARRANTY_STATE_PROJECTED",
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      producer: { service: input.serviceName, instance: "warranty-projection" },
      aggregate: {
        type: "ASSET",
        id: input.assetId,
        version: Number(updated.rows[0]!.version),
      },
      actor: { type: "SYSTEM", id: "warranty-state-projection" },
      correlation_id: input.correlationId,
      causation_id: "warranty-state-policy-v1",
      tenant_id: input.tx.tenantId,
      organization_id: input.tx.tenantId,
      idempotency_key: `asset-warranty-projection:${input.assetId}:${input.evaluatedOn}:${input.policyVersion}:${input.state}:${input.evidenceReference ?? "none"}`,
      payload: {
        asset_id: input.assetId,
        state: input.state,
        state_policy_version: input.policyVersion,
        evaluated_on: input.evaluatedOn,
        evidence_reference: input.evidenceReference,
        reason_code: input.reasonCode,
      },
    });
  return { updated: true, changed, state: input.state };
}
