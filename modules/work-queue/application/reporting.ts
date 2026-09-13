import type { Transaction } from "../../../packages/persistence/src/index.js";
import { queryActionableWorkItemsAt } from "./state-history.js";

export async function queryActionableWorkItemsForReporting(input: {
  tx: Transaction;
  asOf: string;
  dimensions: Record<string, string>;
}) {
  const result = await queryActionableWorkItemsAt({
    tx: input.tx,
    asOf: input.asOf,
    ...(input.dimensions.priority
      ? { priority: input.dimensions.priority }
      : {}),
    ...(input.dimensions.source_type
      ? { sourceType: input.dimensions.source_type }
      : {}),
  });
  return {
    count: BigInt(result.work_item_ids.length),
    workItemIds: result.work_item_ids,
    coverage: result.coverage,
    source: "work_queue",
  };
}

export async function queryWorkItemDrilldown(input: {
  tx: Transaction;
  asOf: string;
  dimensions: Record<string, string>;
  offset: number;
  limit: number;
}) {
  const result = await queryActionableWorkItemsAt({
    tx: input.tx,
    asOf: input.asOf,
    ...(input.dimensions.priority
      ? { priority: input.dimensions.priority }
      : {}),
    ...(input.dimensions.source_type
      ? { sourceType: input.dimensions.source_type }
      : {}),
  });
  return {
    ...result,
    work_item_ids: result.work_item_ids.slice(
      input.offset,
      input.offset + input.limit,
    ),
  };
}
