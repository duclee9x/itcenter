import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";

export type MonitoringReliabilityEpisode = {
  episode_id: string;
  source: string;
  source_correlation_key: string;
  asset_id: string;
  occurred_at: string;
  severities: string[];
  event_ids: string[];
  provider_event_ids: string[];
};

function validateWindow(from: string, to: string) {
  if (
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(from) > Date.parse(to)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid Monitoring reliability time window is required.",
    );
}

async function authorizeAssetRead(input: {
  tx: Transaction;
  assetId: string;
  principal: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: "monitoring.asset_reliability.read",
    resource: {
      type: "monitoring_asset",
      id: input.assetId,
      tenant_id: input.tx.tenantId,
    },
    scope: {},
    context: { correlation_id: input.correlationId },
  });
}

/** Monitoring-owned reliability projection; SQL/query errors intentionally propagate. */
export async function queryMonitoringAssetReliability(input: {
  tx: Transaction;
  assetId: string;
  from: string;
  to: string;
  principal: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
}) {
  validateWindow(input.from, input.to);
  await authorizeAssetRead(input);
  const result = await input.tx.query<{
    id: string;
    source: string;
    provider_event_id: string;
    source_correlation_key: string | null;
    asset_id: string;
    asset_reference_validated: boolean;
    severity: string;
    observed_at: Date | string;
  }>(
    `SELECT id,source,provider_event_id,source_correlation_key,asset_id,
            asset_reference_validated,severity,observed_at
       FROM monitoring.events
      WHERE tenant_id=$1 AND asset_id=$2 AND observed_at >= $3 AND observed_at < $4
      ORDER BY observed_at,id`,
    [input.tx.tenantId, input.assetId, input.from, input.to],
  );
  const groups = new Map<string, MonitoringReliabilityEpisode>();
  let unresolvedEventCount = 0;
  for (const row of result.rows) {
    if (!row.asset_reference_validated || !row.source_correlation_key) {
      unresolvedEventCount += 1;
      continue;
    }
    const key = JSON.stringify([row.source, row.source_correlation_key]);
    const group = groups.get(key);
    const occurredAt = new Date(String(row.observed_at)).toISOString();
    if (!group) {
      groups.set(key, {
        episode_id: JSON.stringify([row.source, row.source_correlation_key]),
        source: row.source,
        source_correlation_key: row.source_correlation_key,
        asset_id: row.asset_id,
        occurred_at: occurredAt,
        severities: [row.severity],
        event_ids: [row.id],
        provider_event_ids: [row.provider_event_id],
      });
    } else {
      group.occurred_at =
        occurredAt < group.occurred_at ? occurredAt : group.occurred_at;
      if (!group.severities.includes(row.severity))
        group.severities.push(row.severity);
      group.event_ids.push(row.id);
      group.provider_event_ids.push(row.provider_event_id);
    }
  }
  const episodes = [...groups.values()].sort((a, b) =>
    a.occurred_at.localeCompare(b.occurred_at),
  );
  return {
    availability: unresolvedEventCount
      ? ("UNAVAILABLE" as const)
      : ("AVAILABLE" as const),
    reason_code: unresolvedEventCount ? "UNRESOLVED_EPISODE_IDENTITY" : null,
    unresolved_event_count: unresolvedEventCount,
    episodes,
  };
}

/** Resolve an Incident's source event to the same canonical episode identity. */
export async function resolveMonitoringEpisodeForEvent(input: {
  tx: Transaction;
  eventId: string;
  assetId: string;
  principal: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
}) {
  await authorizeAssetRead(input);
  const result = await input.tx.query<{
    id: string;
    source: string;
    source_correlation_key: string | null;
    provider_event_id: string;
    asset_reference_validated: boolean;
    observed_at: Date | string;
  }>(
    `SELECT id,source,source_correlation_key,provider_event_id,
            asset_reference_validated,observed_at
       FROM monitoring.events
      WHERE tenant_id=$1 AND id=$2 AND asset_id=$3`,
    [input.tx.tenantId, input.eventId, input.assetId],
  );
  const row = result.rows[0];
  if (!row || !row.asset_reference_validated || !row.source_correlation_key)
    return {
      availability: "UNAVAILABLE" as const,
      reason_code: "UNRESOLVED_EPISODE_IDENTITY",
      episode: null,
    };
  const siblings = await input.tx.query<{
    id: string;
    provider_event_id: string;
  }>(
    `SELECT id,provider_event_id FROM monitoring.events
      WHERE tenant_id=$1 AND asset_id=$2 AND asset_reference_validated=true
        AND source=$3 AND source_correlation_key=$4
      ORDER BY observed_at,id`,
    [input.tx.tenantId, input.assetId, row.source, row.source_correlation_key],
  );
  return {
    availability: "AVAILABLE" as const,
    reason_code: null,
    episode: {
      episode_id: JSON.stringify([row.source, row.source_correlation_key]),
      source: row.source,
      source_correlation_key: row.source_correlation_key,
      event_ids: siblings.rows.map((item) => item.id),
      provider_event_ids: siblings.rows.map((item) => item.provider_event_id),
      occurred_at: new Date(String(row.observed_at)).toISOString(),
    },
  };
}

/** Canonical event-to-Asset reference for Incident creation; no guessed Asset IDs. */
export async function readValidatedMonitoringEventAsset(input: {
  tx: Transaction;
  eventId: string;
}) {
  const result = await input.tx.query<{
    asset_id: string | null;
    asset_reference_validated: boolean;
  }>(
    `SELECT asset_id,asset_reference_validated FROM monitoring.events
      WHERE tenant_id=$1 AND id=$2`,
    [input.tx.tenantId, input.eventId],
  );
  const row = result.rows[0];
  return row?.asset_id && row.asset_reference_validated
    ? { asset_id: row.asset_id }
    : null;
}

export async function resolveMonitoringEventForIncident(input: {
  tx: Transaction;
  eventId: string;
}) {
  const result = await input.tx.query<{
    id: string;
    asset_id: string | null;
    asset_reference_validated: boolean;
  }>(
    `SELECT id,asset_id,asset_reference_validated FROM monitoring.events
      WHERE tenant_id=$1 AND id=$2`,
    [input.tx.tenantId, input.eventId],
  );
  const row = result.rows[0];
  if (!row)
    throw new ApplicationError(
      "NOT_FOUND",
      "Monitoring event was not found in this tenant.",
    );
  return {
    event_id: row.id,
    asset_id:
      row.asset_id && row.asset_reference_validated ? row.asset_id : null,
  };
}
