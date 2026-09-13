import type { Transaction } from "../../../packages/persistence/src/index.js";
const terminal = ["RESOLVED", "CLOSED"];
export const isWorkItemActionableState = (state: string) =>
  !terminal.includes(state);

/** Minimal historical count basis for governed reporting, with explicit coverage. */
export async function queryActionableWorkItemsAt(input: {
  tx: Transaction;
  asOf: string;
  priority?: string;
  sourceType?: string;
}): Promise<{ coverage: "COMPLETE" | "PARTIAL"; work_item_ids: string[] }> {
  const result = await input.tx.query<{ id: string; coverage_gap: boolean }>(
    `WITH existing AS (
       SELECT id,priority,source_type FROM operations.work_items WHERE tenant_id=$1 AND created_at <= $2
     ), states AS (
       SELECT e.*, (SELECT t.to_state FROM operations.work_item_state_transitions t
         WHERE t.tenant_id=$1 AND t.work_item_id=e.id AND t.effective_at <= $2
         ORDER BY t.effective_at DESC,t.transition_sequence DESC LIMIT 1) AS state_at FROM existing e
     ) SELECT id,(state_at IS NULL) AS coverage_gap FROM states
       WHERE (state_at IS NULL OR state_at <> ALL($3::text[]))
       AND ($4::text IS NULL OR priority=$4) AND ($5::text IS NULL OR source_type=$5)`,
    [
      input.tx.tenantId,
      input.asOf,
      terminal,
      input.priority ?? null,
      input.sourceType ?? null,
    ],
  );
  if (result.rows.some((row) => row.coverage_gap))
    return { coverage: "PARTIAL", work_item_ids: [] };
  return {
    coverage: "COMPLETE",
    work_item_ids: result.rows.map((row) => row.id),
  };
}

export async function queryWorkItemStateAt(input: {
  tx: Transaction;
  workItemId: string;
  asOf: string;
}) {
  const entity = await input.tx.query<{ created_at: Date | string }>(
    "SELECT created_at FROM operations.work_items WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.workItemId],
  );
  if (!entity.rowCount)
    return { coverage: "UNAVAILABLE" as const, state: null };
  if (Date.parse(String(entity.rows[0]!.created_at)) > Date.parse(input.asOf))
    return { coverage: "NOT_YET_CREATED" as const, state: null };
  const result = await input.tx.query<{ to_state: string }>(
    `SELECT to_state FROM operations.work_item_state_transitions
      WHERE tenant_id=$1 AND work_item_id=$2 AND effective_at <= $3
      ORDER BY effective_at DESC,transition_sequence DESC LIMIT 1`,
    [input.tx.tenantId, input.workItemId, input.asOf],
  );
  return result.rowCount
    ? { coverage: "KNOWN_STATE" as const, state: result.rows[0]!.to_state }
    : { coverage: "INSUFFICIENT_HISTORY" as const, state: null };
}
