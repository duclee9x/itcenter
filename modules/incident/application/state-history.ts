import type { Transaction } from "../../../packages/persistence/src/index.js";

// Incident lifecycle keeps RESOLVED non-terminal until the explicit close step.
const terminal = ["CLOSED", "CANCELLED"];
export const isIncidentActiveState = (state: string) =>
  !terminal.includes(state);

export type HistoricalCoverage = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";

/** Tenant-scoped point-in-time episode query. It never substitutes current state for missing history. */
export async function queryActiveIncidentEpisodesAt(input: {
  tx: Transaction;
  asOf: string;
  severity?: string;
}): Promise<{ coverage: HistoricalCoverage; episode_ids: string[] }> {
  const result = await input.tx.query<{
    episode_id: string;
    coverage_gap: boolean;
  }>(
    `WITH existing AS (
       SELECT id FROM incident.incidents WHERE tenant_id=$1 AND created_at <= $2
     ), states AS (
       SELECT e.id,
         (SELECT t.to_state FROM incident.state_transitions t
           WHERE t.tenant_id=$1 AND t.incident_id=e.id AND t.effective_at <= $2
           ORDER BY t.effective_at DESC,t.transition_sequence DESC LIMIT 1) AS state_at
       FROM existing e
     ), active_root AS (
       SELECT r.child_incident_id,r.root_incident_id FROM incident.root_relations r
        WHERE r.tenant_id=$1 AND r.linked_at <= $2
          AND (r.detached_at IS NULL OR r.detached_at > $2)
     ), episodes AS (
       SELECT COALESCE(ar.root_incident_id,s.id) AS episode_id,s.state_at,
              COALESCE(root.priority,i.priority) AS severity
         FROM states s JOIN incident.incidents i ON i.tenant_id=$1 AND i.id=s.id
         LEFT JOIN active_root ar ON ar.child_incident_id=s.id
         LEFT JOIN incident.incidents root ON root.tenant_id=$1 AND root.id=ar.root_incident_id
     ) SELECT DISTINCT episode_id,(state_at IS NULL) AS coverage_gap
       FROM episodes WHERE (state_at IS NULL OR state_at <> ALL($3::text[]))
         AND ($4::text IS NULL OR severity=$4)`,
    [input.tx.tenantId, input.asOf, terminal, input.severity ?? null],
  );
  if (result.rows.some((row) => row.coverage_gap))
    return { coverage: "PARTIAL", episode_ids: [] };
  return {
    coverage: "COMPLETE",
    episode_ids: result.rows.map((row) => row.episode_id),
  };
}

export async function queryIncidentStateAt(input: {
  tx: Transaction;
  incidentId: string;
  asOf: string;
}) {
  const entity = await input.tx.query<{ created_at: Date | string }>(
    "SELECT created_at FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.incidentId],
  );
  if (!entity.rowCount)
    return { coverage: "UNAVAILABLE" as const, state: null };
  if (Date.parse(String(entity.rows[0]!.created_at)) > Date.parse(input.asOf))
    return { coverage: "NOT_YET_CREATED" as const, state: null };
  const result = await input.tx.query<{
    to_state: string;
    coverage_kind: string;
  }>(
    `SELECT to_state,coverage_kind FROM incident.state_transitions
      WHERE tenant_id=$1 AND incident_id=$2 AND effective_at <= $3
      ORDER BY effective_at DESC,transition_sequence DESC LIMIT 1`,
    [input.tx.tenantId, input.incidentId, input.asOf],
  );
  return result.rowCount
    ? { coverage: "KNOWN_STATE" as const, state: result.rows[0]!.to_state }
    : { coverage: "INSUFFICIENT_HISTORY" as const, state: null };
}
