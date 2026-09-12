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
