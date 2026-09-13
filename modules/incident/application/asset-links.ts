import { randomUUID } from "node:crypto";
import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";

export type IncidentAssetSource =
  "MONITORING_EVENT" | "EXPLICIT_TICKET_OR_INTAKE_ASSET" | "MANUAL_AUTHORIZED";

export async function recordMonitoringIncidentAssetLink(input: {
  tx: Transaction;
  incidentId: string;
  assetId: string;
  monitoringEventId: string;
  actorType: string;
  actorId: string;
  correlationId: string;
}) {
  const source = await input.tx.query(
    `SELECT i.id FROM incident.incidents i
       JOIN monitoring.events m ON m.tenant_id=i.tenant_id
        AND m.id=i.monitoring_event_id AND m.id=$3
       JOIN asset.assets a ON a.tenant_id=m.tenant_id AND a.id=m.asset_id
      WHERE i.tenant_id=$1 AND i.id=$2 AND m.asset_id=$4
        AND m.asset_reference_validated=true`,
    [
      input.tx.tenantId,
      input.incidentId,
      input.monitoringEventId,
      input.assetId,
    ],
  );
  if (!source.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Incident, Monitoring event and Asset must resolve to the same validated tenant context.",
    );
  const existing = await input.tx.query<{ id: string }>(
    `SELECT id FROM incident.asset_links
      WHERE tenant_id=$1 AND incident_id=$2 AND asset_id=$3 AND state='ACTIVE'
      FOR UPDATE`,
    [input.tx.tenantId, input.incidentId, input.assetId],
  );
  if (existing.rowCount)
    return { id: String(existing.rows[0]!.id), created: false };
  const id = randomUUID();
  await input.tx.query(
    `INSERT INTO incident.asset_links
      (id,tenant_id,incident_id,asset_id,relation_type,source_type,source_reference,actor_type,actor_id,reason)
     VALUES($1,$2,$3,$4,'AFFECTED_ASSET','MONITORING_EVENT',$5,$6,$7,'Canonical Monitoring event Asset reference')`,
    [
      id,
      input.tx.tenantId,
      input.incidentId,
      input.assetId,
      input.monitoringEventId,
      input.actorType,
      input.actorId,
    ],
  );
  await input.tx.query(
    `INSERT INTO incident.asset_link_history
      (id,tenant_id,link_id,incident_id,asset_id,event_type,source_type,source_reference,actor_type,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,'LINKED','MONITORING_EVENT',$6,$7,$8,'Canonical Monitoring event Asset reference',$9)`,
    [
      randomUUID(),
      input.tx.tenantId,
      id,
      input.incidentId,
      input.assetId,
      input.monitoringEventId,
      input.actorType,
      input.actorId,
      input.correlationId,
    ],
  );
  return { id, created: true };
}

/** Records an explicitly selected Asset supplied through canonical intake. */
export async function recordExplicitIncidentAssetLink(input: {
  tx: Transaction;
  incidentId: string;
  assetId: string;
  sourceReference: string;
  actorType: string;
  actorId: string;
  reason: string;
  correlationId: string;
  actor: Principal;
  authorization: AuthorizationPort;
  assetExists: (assetId: string) => Promise<void>;
}) {
  if (!input.sourceReference.trim() || !input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Explicit Asset source and reason are required.",
    );
  await authorize(input.authorization, {
    principal: input.actor,
    action: "incident.asset_link",
    resource: {
      type: "incident",
      id: input.incidentId,
      tenant_id: input.tx.tenantId,
    },
    scope: {},
    context: { correlation_id: input.correlationId },
  });
  await input.assetExists(input.assetId);
  const incident = await input.tx.query(
    "SELECT id FROM incident.incidents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.incidentId],
  );
  if (!incident.rowCount)
    throw new ApplicationError("NOT_FOUND", "Incident was not found.");
  const existing = await input.tx.query<{ id: string }>(
    `SELECT id FROM incident.asset_links
      WHERE tenant_id=$1 AND incident_id=$2 AND asset_id=$3 AND state='ACTIVE'
      FOR UPDATE`,
    [input.tx.tenantId, input.incidentId, input.assetId],
  );
  if (existing.rowCount)
    return { id: String(existing.rows[0]!.id), created: false };
  const id = randomUUID();
  await input.tx.query(
    `INSERT INTO incident.asset_links
      (id,tenant_id,incident_id,asset_id,relation_type,source_type,source_reference,actor_type,actor_id,reason)
     VALUES($1,$2,$3,$4,'AFFECTED_ASSET','EXPLICIT_TICKET_OR_INTAKE_ASSET',$5,$6,$7,$8)`,
    [
      id,
      input.tx.tenantId,
      input.incidentId,
      input.assetId,
      input.sourceReference,
      input.actorType,
      input.actorId,
      input.reason,
    ],
  );
  await input.tx.query(
    `INSERT INTO incident.asset_link_history
      (id,tenant_id,link_id,incident_id,asset_id,event_type,source_type,source_reference,actor_type,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,'LINKED','EXPLICIT_TICKET_OR_INTAKE_ASSET',$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      input.tx.tenantId,
      id,
      input.incidentId,
      input.assetId,
      input.sourceReference,
      input.actorType,
      input.actorId,
      input.reason,
      input.correlationId,
    ],
  );
  return { id, created: true };
}

export async function linkIncidentAsset(input: {
  tx: Transaction;
  incidentId: string;
  assetId: string;
  reason: string;
  idempotencyKey: string;
  actor: Principal;
  authorization: AuthorizationPort;
  assetExists: (assetId: string) => Promise<void>;
  correlationId: string;
}) {
  if (!input.reason.trim() || !input.idempotencyKey.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A reason and idempotency key are required.",
    );
  await authorize(input.authorization, {
    principal: input.actor,
    action: "incident.asset_link",
    resource: {
      type: "incident",
      id: input.incidentId,
      tenant_id: input.tx.tenantId,
    },
    scope: {},
    context: { correlation_id: input.correlationId },
  });
  await input.assetExists(input.assetId);
  const incident = await input.tx.query(
    "SELECT id FROM incident.incidents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.incidentId],
  );
  if (!incident.rowCount)
    throw new ApplicationError("NOT_FOUND", "Incident was not found.");
  const current = await input.tx.query<{ id: string }>(
    `SELECT id FROM incident.asset_links
      WHERE tenant_id=$1 AND incident_id=$2 AND asset_id=$3 AND state='ACTIVE'
      FOR UPDATE`,
    [input.tx.tenantId, input.incidentId, input.assetId],
  );
  if (current.rowCount)
    return { id: String(current.rows[0]!.id), state: "ACTIVE", created: false };
  const id = randomUUID();
  try {
    await input.tx.query(
      `INSERT INTO incident.asset_links
        (id,tenant_id,incident_id,asset_id,relation_type,source_type,source_reference,actor_type,actor_id,reason)
       VALUES($1,$2,$3,$4,'AFFECTED_ASSET','MANUAL_AUTHORIZED',$5,$6,$7,$8)`,
      [
        id,
        input.tx.tenantId,
        input.incidentId,
        input.assetId,
        input.idempotencyKey,
        input.actor.actor_type,
        input.actor.id,
        input.reason,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "VERSION_CONFLICT",
        "An active Incident–Asset relationship was created concurrently.",
      );
    throw error;
  }
  await input.tx.query(
    `INSERT INTO incident.asset_link_history
      (id,tenant_id,link_id,incident_id,asset_id,event_type,source_type,source_reference,actor_type,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,'LINKED','MANUAL_AUTHORIZED',$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      input.tx.tenantId,
      id,
      input.incidentId,
      input.assetId,
      input.idempotencyKey,
      input.actor.actor_type,
      input.actor.id,
      input.reason,
      input.correlationId,
    ],
  );
  return { id, state: "ACTIVE", created: true };
}

export async function detachIncidentAsset(input: {
  tx: Transaction;
  incidentId: string;
  linkId: string;
  expectedVersion: number;
  reason: string;
  actor: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
}) {
  if (!input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A detach reason is required.",
    );
  await authorize(input.authorization, {
    principal: input.actor,
    action: "incident.asset_link",
    resource: {
      type: "incident",
      id: input.incidentId,
      tenant_id: input.tx.tenantId,
    },
    scope: {},
    context: { correlation_id: input.correlationId },
  });
  const row = await input.tx.query<{
    asset_id: string;
    source_type: IncidentAssetSource;
    source_reference: string | null;
    actor_type: string;
    actor_id: string;
    state: string;
    version: number;
  }>(
    `SELECT asset_id,source_type,source_reference,actor_type,actor_id,state,version
       FROM incident.asset_links
      WHERE tenant_id=$1 AND incident_id=$2 AND id=$3 FOR UPDATE`,
    [input.tx.tenantId, input.incidentId, input.linkId],
  );
  if (!row.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Incident–Asset link was not found.",
    );
  const link = row.rows[0]!;
  assertVersion(Number(link.version), input.expectedVersion);
  if (link.state === "DETACHED")
    return {
      id: input.linkId,
      asset_id: link.asset_id,
      state: "DETACHED",
      detached: false,
    };
  const version = input.expectedVersion + 1;
  await input.tx.query(
    `UPDATE incident.asset_links SET state='DETACHED',detached_at=now(),
       detached_by_type=$1,detached_by_id=$2,detach_reason=$3,version=$4
      WHERE tenant_id=$5 AND id=$6`,
    [
      input.actor.actor_type,
      input.actor.id,
      input.reason,
      version,
      input.tx.tenantId,
      input.linkId,
    ],
  );
  await input.tx.query(
    `INSERT INTO incident.asset_link_history
      (id,tenant_id,link_id,incident_id,asset_id,event_type,source_type,source_reference,actor_type,actor_id,reason,correlation_id)
     VALUES($1,$2,$3,$4,$5,'DETACHED',$6,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.linkId,
      input.incidentId,
      link.asset_id,
      link.source_type,
      link.source_reference,
      input.actor.actor_type,
      input.actor.id,
      input.reason,
      input.correlationId,
    ],
  );
  return {
    id: input.linkId,
    asset_id: link.asset_id,
    state: "DETACHED",
    detached: true,
    version,
  };
}

export async function queryIncidentAssetHistory(input: {
  tx: Transaction;
  assetId: string;
  from: string;
  to: string;
  principal: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
}) {
  if (
    !Number.isFinite(Date.parse(input.from)) ||
    !Number.isFinite(Date.parse(input.to)) ||
    Date.parse(input.from) > Date.parse(input.to)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid Incident time window is required.",
    );
  await authorize(input.authorization, {
    principal: input.principal,
    action: "incident.asset_history.read",
    resource: {
      type: "incident_asset_history",
      id: input.assetId,
      tenant_id: input.tx.tenantId,
    },
    scope: {},
    context: { correlation_id: input.correlationId, query: "ASSET_HISTORY" },
  });
  const result = await input.tx.query<{
    incident_id: string;
    root_incident_id: string | null;
    occurred_at: Date | string;
    state: string;
    monitoring_event_id: string | null;
    link_id: string;
    source_type: IncidentAssetSource;
    source_reference: string | null;
    link_created_at: Date | string;
  }>(
    `SELECT i.id AS incident_id,
            COALESCE(active_root.root_incident_id,i.root_incident_id) AS root_incident_id,
            i.created_at AS occurred_at,i.state,i.monitoring_event_id,
            l.id AS link_id,l.source_type,l.source_reference,l.linked_at AS link_created_at
       FROM incident.asset_links l
       JOIN incident.incidents i ON i.tenant_id=l.tenant_id AND i.id=l.incident_id
       LEFT JOIN LATERAL (
         SELECT r.root_incident_id FROM incident.root_relations r
          WHERE r.tenant_id=i.tenant_id AND r.child_incident_id=i.id
            AND r.relation_state='ACTIVE' LIMIT 1
       ) active_root ON true
      WHERE l.tenant_id=$1 AND l.asset_id=$2 AND l.state='ACTIVE'
        AND i.created_at >= $3 AND i.created_at < $4
      ORDER BY i.created_at,i.id`,
    [input.tx.tenantId, input.assetId, input.from, input.to],
  );
  return {
    availability: "AVAILABLE" as const,
    incidents: result.rows.map((row) => ({
      incident_id: row.incident_id,
      root_incident_id: row.root_incident_id,
      episode_id: row.root_incident_id ?? row.incident_id,
      occurred_at: new Date(String(row.occurred_at)).toISOString(),
      state: row.state,
      monitoring_event_id: row.monitoring_event_id,
      asset_link: {
        id: row.link_id,
        source_type: row.source_type,
        source_reference: row.source_reference,
        linked_at: new Date(String(row.link_created_at)).toISOString(),
      },
    })),
  };
}
