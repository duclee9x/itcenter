import type { Transaction } from "../../../packages/persistence/src/index.js";

/** Read-only Approval Engine contract used by source-domain command guards. */
export async function readApprovalRequest(input: {
  tx: Transaction;
  requestId: string;
}) {
  const result = await input.tx.query(
    "SELECT id,tenant_id,source_type,source_id,state,context,version,created_at FROM control.approval_requests WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.requestId],
  );
  return result.rows[0] ?? null;
}

/** Source-scoped approval link contract for owning-domain guards. */
export async function readApprovalRequestForSource(input: {
  tx: Transaction;
  sourceType: string;
  sourceId: string;
}) {
  const result = await input.tx.query(
    "SELECT id,tenant_id,source_type,source_id,state,context,version,created_at FROM control.approval_requests WHERE tenant_id=$1 AND source_type=$2 AND source_id=$3",
    [input.tx.tenantId, input.sourceType, input.sourceId],
  );
  return result.rows[0] ?? null;
}

/** Read all linked approval requests so source domains can reject any stale or unresolved gate. */
export async function readApprovalRequestsForSource(input: {
  tx: Transaction;
  sourceType: string;
  sourceId: string;
}) {
  const result = await input.tx.query(
    "SELECT id,tenant_id,source_type,source_id,state,context,version,created_at FROM control.approval_requests WHERE tenant_id=$1 AND source_type=$2 AND source_id=$3 ORDER BY created_at DESC,id DESC",
    [input.tx.tenantId, input.sourceType, input.sourceId],
  );
  return result.rows;
}
