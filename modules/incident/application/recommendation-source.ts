import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";

export type IncidentCorrelationRecommendationSourceItem = {
  decision_id: string;
  incident_id: string;
  candidates: Array<{
    root_incident_id: string;
    raw_score: number;
    confidence: number;
    strong_signals: string[];
    evidence_categories: string[];
  }>;
  decision_state: "REVIEW_REQUIRED";
  confidence: number;
  ambiguity: { reason_code: string; candidate_count: number };
  reason_codes: string[];
  profile_id: string;
  profile_version: number;
  source_generation: string;
  evaluation_identity: string;
  evaluated_at: string;
  eligible: true;
};

export type IncidentCorrelationRecommendationSourceResult =
  | {
      availability: "AVAILABLE";
      items: IncidentCorrelationRecommendationSourceItem[];
      next_offset: number | null;
    }
  | { availability: "AVAILABLE_EMPTY"; items: []; next_offset: null }
  | {
      availability: "SOURCE_UNAVAILABLE";
      items: [];
      reason: "SOURCE_QUERY_FAILED";
    };

function pageArgs(offset: number | undefined, limit: number | undefined) {
  const pageOffset = offset ?? 0;
  const pageLimit = limit ?? 100;
  if (
    !Number.isSafeInteger(pageOffset) ||
    pageOffset < 0 ||
    !Number.isSafeInteger(pageLimit) ||
    pageLimit < 1 ||
    pageLimit > 200
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid correlation source page is required.",
    );
  return { offset: pageOffset, limit: pageLimit };
}

async function canReadIncident(
  authorization: AuthorizationPort,
  principal: Principal,
  incidentId: string,
  tenantId: string,
  correlationId: string,
) {
  const decision = await authorization.evaluate({
    principal,
    action: "incident.read",
    resource: { type: "incident", id: incidentId, tenant_id: tenantId },
    scope: { tenant: tenantId, incident: incidentId },
    context: { correlation_id: correlationId },
  });
  return decision.result === "ALLOW";
}

/**
 * TASK-092-owned, read-only source boundary. The latest immutable machine
 * decision per subject is selected by its canonical recorded order. Human
 * review, current lifecycle, current Root eligibility and active suppression
 * are rechecked before the decision can be presented.
 */
export async function queryIncidentCorrelationRecommendationSource(input: {
  tx: Transaction;
  tenant_id: string;
  principal: Principal;
  authorization: AuthorizationPort;
  correlation_id: string;
  incident_id?: string;
  offset?: number;
  limit?: number;
}): Promise<IncidentCorrelationRecommendationSourceResult> {
  if (
    input.tenant_id !== input.tx.tenantId ||
    input.principal.tenant_id !== input.tx.tenantId
  )
    throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
  const page = pageArgs(input.offset, input.limit);
  await authorize(input.authorization, {
    principal: input.principal,
    action: "incident.correlation.read",
    resource: {
      type: "incident_correlation",
      id: input.incident_id ?? input.tenant_id,
      tenant_id: input.tx.tenantId,
    },
    scope: {
      tenant: input.tx.tenantId,
      ...(input.incident_id ? { incident: input.incident_id } : {}),
    },
    context: { correlation_id: input.correlation_id },
  });

  let rows: Array<{
    decision_id: string;
    incident_id: string;
    subject_state: string;
    subject_root_id: string | null;
    confidence: number;
    reason_code: string;
    candidate_count: number;
    profile_id: string;
    profile_version: number;
    evaluation_identity: string;
    evaluated_at: Date | string;
    candidates: unknown;
  }>;
  await input.tx.query("SAVEPOINT incident_recommendation_source_query");
  try {
    const result = await input.tx.query(
      `WITH latest_decisions AS (
         SELECT DISTINCT ON (d.subject_incident_id)
                d.id,d.tenant_id,d.subject_incident_id,d.evaluation_identity,
                d.profile_id,d.profile_version,d.outcome,d.confidence,
                d.reason_code,d.candidate_count,d.created_at
           FROM incident.correlation_decisions d
          WHERE d.tenant_id=$1
            AND ($2::uuid IS NULL OR d.subject_incident_id=$2)
          ORDER BY d.subject_incident_id,d.created_at DESC,d.id DESC
       )
       SELECT d.id AS decision_id,d.subject_incident_id AS incident_id,
              i.state AS subject_state,i.root_incident_id AS subject_root_id,
              d.confidence,d.reason_code,d.profile_id,d.profile_version,
              d.candidate_count,d.evaluation_identity,d.created_at AS evaluated_at,
              COALESCE(candidates.items,'[]'::jsonb) AS candidates
         FROM latest_decisions d
         JOIN incident.incidents i
           ON i.tenant_id=d.tenant_id AND i.id=d.subject_incident_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'root_incident_id',c.candidate_root_incident_id,
             'raw_score',c.raw_score,'confidence',c.confidence,
             'strong_signals',c.strong_signals,
             'evidence_categories',COALESCE(
               (SELECT jsonb_agg(DISTINCT contribution->>'code')
                  FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(c.evidence->'contributions')='array'
                         THEN c.evidence->'contributions' ELSE '[]'::jsonb END
                  ) contribution
                 WHERE contribution ? 'code'), '[]'::jsonb)
           ) ORDER BY c.confidence DESC,c.candidate_root_incident_id) AS items
             FROM incident.correlation_decision_candidates c
             JOIN incident.incidents r
               ON r.tenant_id=c.tenant_id AND r.id=c.candidate_root_incident_id
            WHERE c.tenant_id=d.tenant_id AND c.decision_id=d.id
              AND c.eligible=true
              AND r.state NOT IN ('CLOSED','CANCELLED')
              AND r.root_incident_id IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM incident.correlation_active_suppressions s
                 WHERE s.tenant_id=c.tenant_id
                   AND s.child_incident_id=d.subject_incident_id
                   AND s.root_incident_id=c.candidate_root_incident_id
              )
         ) candidates ON true
        WHERE d.outcome='REVIEW_REQUIRED'
          AND i.state NOT IN ('CLOSED','CANCELLED')
          AND i.root_incident_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM incident.correlation_reviews cr
             WHERE cr.tenant_id=d.tenant_id AND cr.decision_id=d.id
          )
          AND (d.candidate_count=0 OR candidates.items IS NOT NULL)
        ORDER BY d.created_at DESC,d.id DESC
        OFFSET $3 LIMIT $4`,
      [
        input.tx.tenantId,
        input.incident_id ?? null,
        page.offset,
        page.limit + 1,
      ],
    );
    rows = result.rows as typeof rows;
  } catch {
    await input.tx.query(
      "ROLLBACK TO SAVEPOINT incident_recommendation_source_query",
    );
    await input.tx.query(
      "RELEASE SAVEPOINT incident_recommendation_source_query",
    );
    return {
      availability: "SOURCE_UNAVAILABLE",
      items: [],
      reason: "SOURCE_QUERY_FAILED",
    };
  }
  await input.tx.query(
    "RELEASE SAVEPOINT incident_recommendation_source_query",
  );

  const hasMore = rows.length > page.limit;
  const selected = rows.slice(0, page.limit);
  const items: IncidentCorrelationRecommendationSourceItem[] = [];
  for (const row of selected) {
    if (
      !(await canReadIncident(
        input.authorization,
        input.principal,
        row.incident_id,
        input.tx.tenantId,
        input.correlation_id,
      ))
    )
      continue;
    const candidates = Array.isArray(row.candidates)
      ? (row.candidates as Array<Record<string, unknown>>)
      : [];
    const normalizedCandidates = [];
    let allCandidatesReadable = true;
    for (const candidate of candidates) {
      const rootId = String(candidate.root_incident_id);
      if (
        !(await canReadIncident(
          input.authorization,
          input.principal,
          rootId,
          input.tx.tenantId,
          input.correlation_id,
        ))
      ) {
        allCandidatesReadable = false;
        break;
      }
      normalizedCandidates.push({
        root_incident_id: rootId,
        raw_score: Number(candidate.raw_score),
        confidence: Number(candidate.confidence),
        strong_signals: Array.isArray(candidate.strong_signals)
          ? candidate.strong_signals.map(String)
          : [],
        evidence_categories: Array.isArray(candidate.evidence_categories)
          ? candidate.evidence_categories.map(String)
          : [],
      });
    }
    if (!allCandidatesReadable) continue;
    items.push({
      decision_id: row.decision_id,
      incident_id: row.incident_id,
      candidates: normalizedCandidates,
      decision_state: "REVIEW_REQUIRED",
      confidence: Number(row.confidence),
      ambiguity: {
        reason_code: row.reason_code,
        candidate_count: Number(row.candidate_count),
      },
      reason_codes: [row.reason_code],
      profile_id: row.profile_id,
      profile_version: Number(row.profile_version),
      source_generation: row.decision_id,
      evaluation_identity: row.evaluation_identity,
      evaluated_at: new Date(row.evaluated_at).toISOString(),
      eligible: true,
    });
  }
  if (!items.length && !hasMore)
    return { availability: "AVAILABLE_EMPTY", items: [], next_offset: null };
  return {
    availability: "AVAILABLE",
    items,
    next_offset: hasMore ? page.offset + page.limit : null,
  };
}
