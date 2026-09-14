import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { SCORING_ELIGIBLE_LIFECYCLE_STATES } from "../domain/scoring.js";

export type ReplacementCandidateRecommendationSourceItem = {
  candidate_id: string;
  asset_id: string;
  candidate_state: "UNDER_REVIEW";
  candidate_version: number;
  assessment_id: string;
  score: number;
  band: "PLAN" | "PRIORITY";
  completeness: number;
  profile_id: string;
  profile_version: string;
  reasons: string[];
  contributions: Record<
    string,
    { available: boolean; score: number; reason_code?: string }
  >;
  calculated_at: string;
  valid_until: string;
  freshness: "CURRENT";
  source_generation: {
    candidate_id: string;
    candidate_version: number;
    assessment_id: string;
  };
  eligible: true;
};

export type ReplacementCandidateRecommendationSourceResult =
  | {
      availability: "AVAILABLE";
      items: ReplacementCandidateRecommendationSourceItem[];
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
      "A valid replacement source page is required.",
    );
  return { offset: pageOffset, limit: pageLimit };
}

async function canReadAsset(
  authorization: AuthorizationPort,
  principal: Principal,
  assetId: string,
  tenantId: string,
  correlationId: string,
) {
  for (const action of ["asset.read", "asset.scoring.read"]) {
    const decision = await authorization.evaluate({
      principal,
      action,
      resource: { type: "asset", id: assetId, tenant_id: tenantId },
      scope: { tenant: tenantId, asset: assetId },
      context: { correlation_id: correlationId },
    });
    if (decision.result !== "ALLOW") return false;
  }
  return true;
}

/** TASK-059/TASK-094-owned read boundary; it never creates or refreshes candidates. */
export async function queryReplacementCandidateRecommendationSource(input: {
  tx: Transaction;
  tenant_id: string;
  principal: Principal;
  authorization: AuthorizationPort;
  correlation_id: string;
  as_of?: string;
  asset_id?: string;
  offset?: number;
  limit?: number;
}): Promise<ReplacementCandidateRecommendationSourceResult> {
  if (
    input.tenant_id !== input.tx.tenantId ||
    input.principal.tenant_id !== input.tx.tenantId
  )
    throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
  const page = pageArgs(input.offset, input.limit);
  const asOf = input.as_of ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(asOf)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid as_of is required.",
    );
  const normalizedAsOf = new Date(asOf).toISOString();

  // Collection checks make an empty result subject to the same narrow read
  // permissions as a populated one; per-Asset checks then enforce resource scope.
  for (const action of ["asset.read", "asset.scoring.read"]) {
    await authorize(input.authorization, {
      principal: input.principal,
      action,
      resource: {
        type: "asset",
        id: input.asset_id ?? input.tenant_id,
        tenant_id: input.tx.tenantId,
      },
      scope: {
        tenant: input.tx.tenantId,
        ...(input.asset_id ? { asset: input.asset_id } : {}),
      },
      context: { correlation_id: input.correlation_id },
    });
  }

  let rows: Array<{
    candidate_id: string;
    asset_id: string;
    candidate_state: string;
    candidate_version: number;
    assessment_id: string;
    score: number;
    band: string;
    completeness: number;
    profile_id: string;
    profile_version: string;
    reasons: unknown;
    contributions: unknown;
    calculated_at: Date | string;
    valid_until: Date | string;
  }>;
  await input.tx.query("SAVEPOINT replacement_recommendation_source_query");
  try {
    const result = await input.tx.query(
      `SELECT p.id AS candidate_id,p.asset_id,p.state AS candidate_state,
              p.version AS candidate_version,a.id AS assessment_id,a.score,a.band,
              a.completeness,a.profile_id,a.profile_version,p.reasons,
              a.contributions,a.calculated_at,a.valid_until
         FROM asset.replacement_plans p
         JOIN asset.assets asset
           ON asset.tenant_id=p.tenant_id AND asset.id=p.asset_id
         JOIN asset.scoring_latest latest
           ON latest.tenant_id=p.tenant_id AND latest.asset_id=p.asset_id
          AND latest.replacement_assessment_id::text=p.recommendation_assessment_id
         JOIN asset.replacement_assessments a
           ON a.tenant_id=p.tenant_id AND a.asset_id=p.asset_id
          AND a.id::text=p.recommendation_assessment_id
          AND a.id=latest.replacement_assessment_id
        WHERE p.tenant_id=$1
          AND ($2::uuid IS NULL OR p.asset_id=$2)
          AND p.state='UNDER_REVIEW'
          AND asset.lifecycle_state=ANY($6::text[])
          AND a.band IN ('PLAN','PRIORITY')
          AND a.calculated_at <= $3 AND a.valid_until > $3
        ORDER BY p.updated_at DESC,p.id DESC
        OFFSET $4 LIMIT $5`,
      [
        input.tx.tenantId,
        input.asset_id ?? null,
        normalizedAsOf,
        page.offset,
        page.limit + 1,
        [...SCORING_ELIGIBLE_LIFECYCLE_STATES],
      ],
    );
    rows = result.rows as typeof rows;
  } catch {
    await input.tx.query(
      "ROLLBACK TO SAVEPOINT replacement_recommendation_source_query",
    );
    await input.tx.query(
      "RELEASE SAVEPOINT replacement_recommendation_source_query",
    );
    return {
      availability: "SOURCE_UNAVAILABLE",
      items: [],
      reason: "SOURCE_QUERY_FAILED",
    };
  }
  await input.tx.query(
    "RELEASE SAVEPOINT replacement_recommendation_source_query",
  );

  const hasMore = rows.length > page.limit;
  const selected = rows.slice(0, page.limit);
  const items: ReplacementCandidateRecommendationSourceItem[] = [];
  for (const row of selected) {
    if (
      !(await canReadAsset(
        input.authorization,
        input.principal,
        row.asset_id,
        input.tx.tenantId,
        input.correlation_id,
      ))
    )
      continue;
    const reasons = Array.isArray(row.reasons) ? row.reasons.map(String) : [];
    const rawContributions =
      row.contributions &&
      typeof row.contributions === "object" &&
      !Array.isArray(row.contributions)
        ? (row.contributions as Record<string, unknown>)
        : {};
    const contributions: ReplacementCandidateRecommendationSourceItem["contributions"] =
      {};
    for (const [category, raw] of Object.entries(rawContributions)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const contribution = raw as Record<string, unknown>;
      contributions[category] = {
        available: Boolean(contribution.available),
        score: Number(contribution.score ?? 0),
        ...(typeof contribution.missing_reason === "string"
          ? { reason_code: contribution.missing_reason }
          : {}),
      };
    }
    items.push({
      candidate_id: row.candidate_id,
      asset_id: row.asset_id,
      candidate_state: "UNDER_REVIEW",
      candidate_version: Number(row.candidate_version),
      assessment_id: row.assessment_id,
      score: Number(row.score),
      band: row.band as "PLAN" | "PRIORITY",
      completeness: Number(row.completeness),
      profile_id: row.profile_id,
      profile_version: row.profile_version,
      reasons,
      contributions,
      calculated_at: new Date(row.calculated_at).toISOString(),
      valid_until: new Date(row.valid_until).toISOString(),
      freshness: "CURRENT",
      source_generation: {
        candidate_id: row.candidate_id,
        candidate_version: Number(row.candidate_version),
        assessment_id: row.assessment_id,
      },
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
