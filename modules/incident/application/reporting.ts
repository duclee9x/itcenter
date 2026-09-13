import type { Transaction } from "../../../packages/persistence/src/index.js";
import { queryActiveIncidentEpisodesAt } from "./state-history.js";

/** Historical Incident/Root query. R2 coverage failures never collapse to zero. */
export async function queryActiveIncidentEpisodesForReporting(input: {
  tx: Transaction;
  asOf: string;
  dimensions: Record<string, string>;
}) {
  const result = await queryActiveIncidentEpisodesAt({
    tx: input.tx,
    asOf: input.asOf,
  });
  return {
    count: BigInt(result.episode_ids.length),
    episodeIds: result.episode_ids,
    coverage: result.coverage,
    source: "incidents",
  };
}

export async function queryIncidentEpisodeDrilldown(input: {
  tx: Transaction;
  asOf: string;
  offset: number;
  limit: number;
}) {
  const result = await queryActiveIncidentEpisodesAt({
    tx: input.tx,
    asOf: input.asOf,
  });
  return {
    ...result,
    episode_ids: result.episode_ids.slice(
      input.offset,
      input.offset + input.limit,
    ),
  };
}
