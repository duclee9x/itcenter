import type { Transaction } from "../../../packages/persistence/src/index.js";

/** TASK-093 outcome history is the only source for both governed Knowledge KPIs. */
export async function queryKnowledgeReporting(input: {
  tx: Transaction;
  from: string;
  to: string;
}) {
  const result = await input.tx.query<{
    resolved: string;
    terminal: string;
    known: string;
    origin_ambiguous: boolean;
    generation: string;
  }>(
    `WITH session_outcomes AS (
       SELECT s.id,s.tenant_id,s.outcome,s.deflection_type,s.started_pre_ticket,
         CASE s.outcome
           WHEN 'USER_RESOLVED' THEN s.resolved_at
           WHEN 'ESCALATED' THEN s.escalated_at
           WHEN 'NOT_HELPFUL' THEN (SELECT max(i.created_at) FROM problem.knowledge_recommendation_interactions i
             WHERE i.tenant_id=s.tenant_id AND i.session_id=s.id AND i.interaction_type='NOT_HELPFUL')
           ELSE NULL END AS outcome_at
       FROM problem.knowledge_recommendation_sessions s WHERE s.tenant_id=$1
     ), eligible AS (
       SELECT * FROM session_outcomes o
        WHERE o.outcome IN ('USER_RESOLVED','NOT_HELPFUL','ESCALATED')
          AND o.outcome_at >= $2 AND o.outcome_at < $3
          AND EXISTS (SELECT 1 FROM problem.knowledge_recommendation_items i
            WHERE i.tenant_id=o.tenant_id AND i.session_id=o.id)
     )
     SELECT count(*) FILTER (WHERE outcome='USER_RESOLVED'
          AND deflection_type='KNOWLEDGE_RESOLUTION' AND started_pre_ticket IS TRUE)::text AS resolved,
       count(*) FILTER (WHERE started_pre_ticket IS TRUE
          AND deflection_type IS DISTINCT FROM 'KNOWN_INCIDENT_DEFLECTION'
          AND (outcome<>'USER_RESOLVED' OR deflection_type='KNOWLEDGE_RESOLUTION'))::text AS terminal,
       count(*) FILTER (WHERE outcome='USER_RESOLVED'
          AND deflection_type='KNOWN_INCIDENT_DEFLECTION')::text AS known,
       COALESCE(bool_or(
          (started_pre_ticket IS NULL AND deflection_type IS DISTINCT FROM 'KNOWN_INCIDENT_DEFLECTION'
            AND (outcome<>'USER_RESOLVED' OR deflection_type='KNOWLEDGE_RESOLUTION'))
          OR (started_pre_ticket IS TRUE AND outcome='USER_RESOLVED' AND deflection_type IS NULL)
       ),false) AS origin_ambiguous,
       md5(COALESCE(string_agg(id::text || ':' || outcome || ':' || COALESCE(deflection_type,'?'),',' ORDER BY id),'')) AS generation
       FROM eligible`,
    [input.tx.tenantId, input.from, input.to],
  );
  const row = result.rows[0];
  return {
    resolutionNumerator: BigInt(row?.resolved ?? "0"),
    resolutionDenominator: BigInt(row?.terminal ?? "0"),
    knownIncidentDeflections: BigInt(row?.known ?? "0"),
    coverage: row?.origin_ambiguous ? "PARTIAL" : "COMPLETE",
    source_generation: row?.generation ?? "empty",
    source: "knowledge_recommendations",
  };
}

export async function queryKnowledgeDrilldown(input: {
  tx: Transaction;
  kpiId:
    | "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT"
    | "KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT";
  from: string;
  to: string;
  offset: number;
  limit: number;
}) {
  const result = await input.tx.query<{
    session_id: string;
    knowledge_ids: string[];
    outcome: string;
  }>(
    `WITH session_outcomes AS (
       SELECT s.id,s.tenant_id,s.outcome,s.deflection_type,s.started_pre_ticket,
         CASE s.outcome
           WHEN 'USER_RESOLVED' THEN s.resolved_at
           WHEN 'ESCALATED' THEN s.escalated_at
           WHEN 'NOT_HELPFUL' THEN (SELECT max(i.created_at) FROM problem.knowledge_recommendation_interactions i
             WHERE i.tenant_id=s.tenant_id AND i.session_id=s.id AND i.interaction_type='NOT_HELPFUL')
           ELSE NULL END AS outcome_at
       FROM problem.knowledge_recommendation_sessions s WHERE s.tenant_id=$1
     ), eligible AS (
       SELECT o.* FROM session_outcomes o
        WHERE o.outcome_at >= $2 AND o.outcome_at < $3
          AND EXISTS (SELECT 1 FROM problem.knowledge_recommendation_items i
            WHERE i.tenant_id=o.tenant_id AND i.session_id=o.id)
          AND (($4='KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT'
                AND o.outcome='USER_RESOLVED' AND o.deflection_type='KNOWN_INCIDENT_DEFLECTION')
            OR ($4='KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT'
                AND o.outcome IN ('USER_RESOLVED','NOT_HELPFUL','ESCALATED')
                AND o.started_pre_ticket IS TRUE
                AND o.deflection_type IS DISTINCT FROM 'KNOWN_INCIDENT_DEFLECTION'
                AND (o.outcome<>'USER_RESOLVED' OR o.deflection_type='KNOWLEDGE_RESOLUTION')))
     )
     SELECT e.id AS session_id,array_agg(i.knowledge_id ORDER BY i.rank) AS knowledge_ids,e.outcome
       FROM eligible e JOIN problem.knowledge_recommendation_items i
         ON i.tenant_id=e.tenant_id AND i.session_id=e.id
      GROUP BY e.id,e.outcome ORDER BY e.id OFFSET $5 LIMIT $6`,
    [
      input.tx.tenantId,
      input.from,
      input.to,
      input.kpiId,
      input.offset,
      input.limit,
    ],
  );
  return result.rows;
}
