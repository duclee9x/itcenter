import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type {
  AuthorizationPort,
  Principal,
} from "../../../packages/auth/src/index.js";
import { authorize } from "../../../packages/auth/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";

export type RecommendationSourceContext = {
  type: "INCIDENT" | "TICKET" | "RECOMMENDATION_SESSION";
  id: string;
};

/**
 * TASK-093-owned discovery boundary for its already persisted recommendation
 * sessions. This lists only session identities and stable source metadata;
 * callers must use readRecommendationSession and the presentation eligibility
 * query before exposing any item.
 */
export async function queryRecommendationSourceSessions(input: {
  tx: Transaction;
  principal: Principal;
  authorization: AuthorizationPort;
  correlation: CorrelationContext;
  sourceContext?: RecommendationSourceContext;
  offset?: number;
  limit?: number;
}) {
  if (input.principal.tenant_id !== input.tx.tenantId)
    throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
  await authorize(input.authorization, {
    principal: input.principal,
    action: "knowledge.read",
    resource: {
      type: "knowledge",
      id: input.tx.tenantId,
      tenant_id: input.tx.tenantId,
    },
    scope: { tenant: input.tx.tenantId },
    context: { ...input.correlation },
  });
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 100;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid Recommendation source page is required.",
    );

  const result = await input.tx.query<{
    session_id: string;
    actor_id: string;
    ticket_id: string | null;
    incident_id: string | null;
    profile_id: string;
    profile_version: number;
    version: number;
    created_at: Date | string;
    presented_at: Date | string;
  }>(
    `SELECT s.id AS session_id,s.actor_id,s.ticket_id,s.incident_id,
            s.profile_id,s.profile_version,s.version,s.created_at,s.presented_at
       FROM problem.knowledge_recommendation_sessions s
      WHERE s.tenant_id=$1
        AND s.outcome IN ('PRESENTED','NOT_HELPFUL')
        AND s.presented_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM problem.knowledge_recommendation_items i
           WHERE i.tenant_id=s.tenant_id AND i.session_id=s.id
        )
        AND ($2::text IS NULL OR
          ($2='INCIDENT' AND s.incident_id=$3::uuid) OR
          ($2='TICKET' AND s.ticket_id=$3::uuid) OR
          ($2='RECOMMENDATION_SESSION' AND s.id=$3::uuid))
      ORDER BY s.created_at DESC,s.id DESC
      OFFSET $4 LIMIT $5`,
    [
      input.tx.tenantId,
      input.sourceContext?.type ?? null,
      input.sourceContext?.id ?? null,
      offset,
      limit + 1,
    ],
  );
  const hasMore = result.rows.length > limit;
  const candidates = result.rows.slice(0, limit).map((row) => ({
    session_id: row.session_id,
    actor_id: row.actor_id,
    ticket_id: row.ticket_id,
    incident_id: row.incident_id,
    profile_id: row.profile_id,
    profile_version: Number(row.profile_version),
    version: Number(row.version),
    created_at: new Date(row.created_at).toISOString(),
    presented_at: new Date(row.presented_at).toISOString(),
  }));
  const rows = [];
  for (const row of candidates) {
    const decision = await input.authorization.evaluate({
      principal: input.principal,
      action:
        row.actor_id === input.principal.id
          ? "knowledge.recommendation.use"
          : "knowledge.recommendation.review",
      resource: {
        type: "knowledge_recommendation",
        id: row.session_id,
        tenant_id: input.tx.tenantId,
      },
      scope: { tenant: input.tx.tenantId },
      context: { ...input.correlation },
    });
    if (decision.result === "ALLOW") rows.push(row);
  }
  return {
    rows,
    next_offset: hasMore ? offset + limit : null,
  };
}
