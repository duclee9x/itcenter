import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import {
  evaluateWarrantyState,
  warrantyStatePolicy,
  type WarrantyEvidence,
} from "../domain/warranty-state.js";
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
export const maintenanceClassifications = [
  "CORRECTIVE",
  "PREVENTIVE",
  "INSPECTION",
  "OTHER",
  "UNKNOWN",
] as const;
export type MaintenanceClassification =
  (typeof maintenanceClassifications)[number];
export async function createWarranty(input: {
  tx: Transaction;
  assetId: string;
  provider: string;
  contractRef?: string | undefined;
  startsAt: string;
  endsAt: string;
  coverage: string;
  validateAsset: () => Promise<void>;
}) {
  await input.validateAsset();
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

async function evaluateWarrantyForAsset(input: {
  tx: Transaction;
  assetId: string;
  asOf: string;
}) {
  const rows = await input.tx.query<WarrantyEvidence>(
    `SELECT id,starts_at::text,ends_at::text FROM maintenance.warranties
      WHERE tenant_id=$1 AND asset_id=$2 ORDER BY id`,
    [input.tx.tenantId, input.assetId],
  );
  return {
    ...evaluateWarrantyState({ records: rows.rows, asOf: input.asOf }),
    evaluated_at: new Date(input.asOf).toISOString(),
    state_policy_id: warrantyStatePolicy.id,
    state_policy_version: warrantyStatePolicy.version,
  };
}

/** Maintenance-owned, minimal canonical Warranty state query. */
export async function queryWarrantyAsset(input: {
  tx: Transaction;
  assetId: string;
  asOf: string;
  principal: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
}) {
  if (!Number.isFinite(Date.parse(input.asOf)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid as_of timestamp is required.",
    );
  await authorize(input.authorization, {
    principal: input.principal,
    action: "warranty.read",
    resource: {
      type: "warranty",
      id: input.assetId,
      tenant_id: input.tx.tenantId,
    },
    scope: {},
    context: { correlation_id: input.correlationId },
  });
  const result = await evaluateWarrantyForAsset(input);
  return {
    availability: "AVAILABLE" as const,
    ...result,
  };
}

/** Internal tenant-scoped evaluator used by the scheduled projection refresher. */
export async function evaluateWarrantyAssetForProjection(input: {
  tx: Transaction;
  assetId: string;
  asOf: string;
}) {
  return evaluateWarrantyForAsset(input);
}

export async function createMaintenance(input: {
  tx: Transaction;
  assetId: string;
  title: string;
  description: string;
  classification: Exclude<MaintenanceClassification, "UNKNOWN">;
  warrantyId?: string | undefined;
}) {
  if (!input.title.trim() || !input.description.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "title and description are required.",
    );
  if (
    !maintenanceClassifications
      .filter((classification) => classification !== "UNKNOWN")
      .includes(input.classification)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "New Maintenance orders require an explicit supported classification.",
    );
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO maintenance.orders(id,tenant_id,asset_id,title,description,classification,warranty_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      id,
      input.tx.tenantId,
      input.assetId,
      input.title,
      input.description,
      input.classification,
      input.warrantyId ?? null,
    ],
  );
  return { id, asset_id: input.assetId, state: "DRAFT", version: 1 };
}

export async function updateMaintenanceClassification(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  classification: Exclude<MaintenanceClassification, "UNKNOWN">;
  reason: string;
}) {
  const result = await input.tx.query(
    "SELECT state,classification,version FROM maintenance.orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Maintenance order was not found.");
  const current = result.rows[0]!;
  assertVersion(Number(current.version), input.expectedVersion);
  if (
    !input.reason.trim() ||
    ["COMPLETED", "CANCELLED", "FAILED"].includes(String(current.state))
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Classification can only be corrected before the order becomes terminal.",
    );
  if (current.classification === input.classification)
    return {
      id: input.id,
      classification: input.classification,
      version: input.expectedVersion,
      noOp: true,
    };
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE maintenance.orders SET classification=$1,version=$2,updated_at=now() WHERE tenant_id=$3 AND id=$4",
    [input.classification, version, input.tx.tenantId, input.id],
  );
  return {
    id: input.id,
    from_classification: String(current.classification),
    classification: input.classification,
    version,
    noOp: false,
  };
}

/** Owning-domain, tenant-scoped evidence query for future Asset scoring. */
export async function queryMaintenanceAssetHistory(input: {
  tx: Transaction;
  assetId: string;
  from: string;
  to: string;
  principal: Principal;
  authorization: AuthorizationPort;
  context: { correlation_id: string };
}) {
  if (
    !Number.isFinite(Date.parse(input.from)) ||
    !Number.isFinite(Date.parse(input.to)) ||
    Date.parse(input.from) > Date.parse(input.to)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid maintenance time window is required.",
    );
  await authorize(input.authorization, {
    principal: input.principal,
    action: "maintenance.read",
    resource: {
      type: "maintenance",
      id: input.assetId,
      tenant_id: input.tx.tenantId,
    },
    scope: {},
    context: { ...input.context },
  });
  const rows = await input.tx.query(
    `SELECT id,asset_id,state,classification,completed_at
       FROM maintenance.orders
      WHERE tenant_id=$1 AND asset_id=$2 AND state='COMPLETED'
        AND completed_at >= $3 AND completed_at < $4
      ORDER BY completed_at,id`,
    [input.tx.tenantId, input.assetId, input.from, input.to],
  );
  const orders = rows.rows.map((row) => ({
    id: String(row.id),
    asset_id: String(row.asset_id),
    state: String(row.state),
    classification: row.classification as MaintenanceClassification,
    completed_at: new Date(String(row.completed_at)).toISOString(),
    financial_reference: null as string | null,
  }));
  return {
    availability: "AVAILABLE" as const,
    orders,
    unknown_classification_count: orders.filter(
      (order) => order.classification === "UNKNOWN",
    ).length,
  };
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
    "UPDATE maintenance.orders SET state=$1,version=$2,completed_at=CASE WHEN $1='COMPLETED' THEN now() ELSE completed_at END,updated_at=now() WHERE tenant_id=$3 AND id=$4",
    [input.targetState, version, input.tx.tenantId, input.id],
  );
  return {
    id: input.id,
    from_state: String(item.state),
    to_state: input.targetState,
    version,
  };
}
