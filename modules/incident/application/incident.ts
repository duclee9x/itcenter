import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
const transitions: Record<string, string[]> = {
  DETECTED: ["INVESTIGATING"],
  INVESTIGATING: ["IDENTIFIED", "MITIGATING"],
  IDENTIFIED: ["MITIGATING"],
  MITIGATING: ["MONITORING_RECOVERY", "RESTORED"],
  MONITORING_RECOVERY: ["RESTORED"],
  RESTORED: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};
export async function createIncident(input: {
  tx: Transaction;
  incidentCode: string;
  title: string;
  source: string;
  monitoringEventId?: string | undefined;
  priority: string;
  serviceId?: string | undefined;
}) {
  if (
    input.serviceId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.serviceId,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "service_id must be a canonical Service UUID.",
    );
  if (
    !input.incidentCode.trim() ||
    !input.title.trim() ||
    !["P1", "P2", "P3", "P4"].includes(input.priority)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "incident_code, title and valid priority are required.",
    );
  const id = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO incident.incidents(id,tenant_id,incident_code,title,source,monitoring_event_id,priority,service_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        input.tx.tenantId,
        input.incidentCode,
        input.title,
        input.source,
        input.monitoringEventId ?? null,
        input.priority,
        input.serviceId ?? null,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Incident code or monitoring event already exists.",
      );
    if ((error as { code?: string }).code === "23503")
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "service_id must reference a canonical Service in this tenant.",
      );
    throw error;
  }
  return {
    id,
    incident_code: input.incidentCode,
    state: "DETECTED",
    priority: input.priority,
    version: 1,
  };
}
export async function transitionIncident(input: {
  tx: Transaction;
  incidentId: string;
  expectedVersion: number;
  targetState: string;
  reason: string;
  verification?: string | undefined;
  resolutionSummary?: string | undefined;
  postChecks?: string | undefined;
}) {
  const row = await input.tx.query(
    "SELECT id,state,version FROM incident.incidents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.incidentId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Incident was not found.");
  const incident = row.rows[0]!;
  assertVersion(incident.version, input.expectedVersion);
  if (!transitions[String(incident.state)]?.includes(input.targetState))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid incident state transition.",
    );
  if (input.targetState === "RESTORED" && !input.verification?.trim())
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Restoration verification is required.",
    );
  if (input.targetState === "RESOLVED" && !input.resolutionSummary?.trim())
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Resolution summary is required.",
    );
  if (input.targetState === "CLOSED" && !input.postChecks?.trim())
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Post-resolution checks are required.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE incident.incidents SET state=$1,restoration_verification=COALESCE($2,restoration_verification),resolution_summary=COALESCE($3,resolution_summary),post_resolution_checks=COALESCE($4,post_resolution_checks),version=$5,updated_at=now() WHERE tenant_id=$6 AND id=$7",
    [
      input.targetState,
      input.verification ?? null,
      input.resolutionSummary ?? null,
      input.postChecks ?? null,
      version,
      input.tx.tenantId,
      input.incidentId,
    ],
  );
  if (input.targetState === "CLOSED" || input.targetState === "CANCELLED") {
    await input.tx.query(
      `UPDATE incident.correlation_clusters SET status='ENDED',ended_at=now(),ended_reason='ROOT_INCIDENT_TERMINAL'
        WHERE tenant_id=$1 AND root_incident_id=$2 AND status='ACTIVE'`,
      [input.tx.tenantId, input.incidentId],
    );
    await input.tx.query(
      "DELETE FROM incident.correlation_active_suppressions WHERE tenant_id=$1 AND root_incident_id=$2",
      [input.tx.tenantId, input.incidentId],
    );
  }
  return {
    id: input.incidentId,
    from_state: String(incident.state),
    to_state: input.targetState,
    version,
  };
}

export interface IncidentRecommendationContextQuery {
  execute(input: { incidentId?: string; ticketId?: string }): Promise<{
    incident_id: string | null;
    incident_state: string | null;
    service_ids: string[];
    active_root: { id: string; state: string } | null;
  } | null>;
}

/** Read-only, tenant-scoped context projection for Knowledge consumers. */
export function incidentRecommendationContextQuery(
  tx: Transaction,
): IncidentRecommendationContextQuery {
  return {
    execute: (input) => readIncidentRecommendationContext({ tx, ...input }),
  };
}

export async function readIncidentRecommendationContext(input: {
  tx: Transaction;
  incidentId?: string;
  ticketId?: string;
}) {
  if (Boolean(input.incidentId) === Boolean(input.ticketId))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Provide exactly one incident_id or ticket_id.",
    );
  if (input.incidentId) {
    const result = await input.tx.query<{
      incident_id: string;
      incident_state: string;
      service_id: string | null;
      root_incident_id: string | null;
      root_state: string | null;
      root_service_id: string | null;
    }>(
      `WITH subject AS (
         SELECT id,state,service_id FROM incident.incidents
          WHERE tenant_id=$1 AND id=$2
       ), linked_root AS (
         SELECT root.id,root.state,root.service_id
           FROM incident.root_relations rel
           JOIN incident.incidents root
             ON root.tenant_id=rel.tenant_id AND root.id=rel.root_incident_id
          WHERE rel.tenant_id=$1 AND rel.child_incident_id=$2
            AND rel.relation_state='ACTIVE' AND root.state NOT IN ('CLOSED','CANCELLED')
         UNION ALL
         SELECT s.id,s.state,s.service_id FROM subject s
          WHERE s.state NOT IN ('CLOSED','CANCELLED')
            AND EXISTS (SELECT 1 FROM incident.root_relations rel
              WHERE rel.tenant_id=$1 AND rel.root_incident_id=s.id
                AND rel.relation_state='ACTIVE')
       )
       SELECT s.id AS incident_id,s.state AS incident_state,s.service_id,
         r.id AS root_incident_id,r.state AS root_state,r.service_id AS root_service_id
         FROM subject s LEFT JOIN LATERAL (
           SELECT (array_agg(id))[1] AS id,(array_agg(state))[1] AS state,
             (array_agg(service_id))[1] AS service_id
             FROM linked_root HAVING count(*)=1
         ) r ON true`,
      [input.tx.tenantId, input.incidentId],
    );
    const row = result.rows[0];
    return row
      ? {
          incident_id: row.incident_id,
          incident_state: row.incident_state,
          service_ids: [
            ...new Set(
              [row.service_id, row.root_service_id].filter((id): id is string =>
                Boolean(id),
              ),
            ),
          ],
          active_root: row.root_incident_id
            ? { id: row.root_incident_id, state: row.root_state! }
            : null,
        }
      : null;
  }
  const root = await input.tx.query<{
    id: string;
    state: string;
    service_id: string | null;
  }>(
    `SELECT (array_agg(i.id))[1] AS id,(array_agg(i.state))[1] AS state,
        (array_agg(i.service_id))[1] AS service_id FROM incident.relations rel
       JOIN incident.incidents i ON i.tenant_id=rel.tenant_id AND i.id=rel.root_incident_id
      WHERE rel.tenant_id=$1 AND rel.related_entity_type='TICKET' AND rel.related_entity_id=$2
        AND i.state NOT IN ('CLOSED','CANCELLED') HAVING count(DISTINCT i.id)=1`,
    [input.tx.tenantId, input.ticketId],
  );
  const row = root.rows[0];
  return row
    ? {
        incident_id: null,
        incident_state: null,
        service_ids: row.service_id ? [row.service_id] : [],
        active_root: { id: row.id, state: row.state },
      }
    : {
        incident_id: null,
        incident_state: null,
        service_ids: [] as string[],
        active_root: null,
      };
}
