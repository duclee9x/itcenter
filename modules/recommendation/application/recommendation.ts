import { createHash, randomUUID } from "node:crypto";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  canonicalSourceGeneration,
  type RecommendationFamily,
  type RecommendationInteractionType,
  type RecommendationSource,
  type RecommendationState,
} from "../domain/recommendation.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function recommendationGenerationKey(value: Record<string, unknown>) {
  return hash(canonicalSourceGeneration(value));
}

export async function materializeRecommendationSource(input: {
  tx: Transaction;
  source: RecommendationSource;
  generatedAt?: string;
}) {
  const now = input.generatedAt ?? new Date().toISOString();
  const generation = canonicalSourceGeneration(input.source.generation);
  const generationKey = recommendationGenerationKey(input.source.generation);
  await input.tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `${input.tx.tenantId}:${input.source.family}:${input.source.source_type}:${input.source.source_id}`,
  ]);
  const current = await input.tx.query<{
    id: string;
    current_state: RecommendationState;
    latest_revision: number;
    source_generation_key: string;
  }>(
    `SELECT id,current_state,latest_revision,source_generation_key
       FROM recommendation.recommendations
      WHERE tenant_id=$1 AND family=$2 AND source_type=$3 AND source_id=$4
      FOR UPDATE`,
    [
      input.tx.tenantId,
      input.source.family,
      input.source.source_type,
      input.source.source_id,
    ],
  );
  if (!current.rowCount) {
    const recommendationId = randomUUID();
    const revisionId = randomUUID();
    await input.tx.query(
      `INSERT INTO recommendation.recommendations(
         id,tenant_id,family,source_domain,source_type,source_id,contexts,
         context_type,context_id,current_state,source_generation_key,
         latest_revision,initial_provenance,created_at,refreshed_at,source_valid_until
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,1,$11,$12,$12,$13)`,
      [
        recommendationId,
        input.tx.tenantId,
        input.source.family,
        input.source.source_domain,
        input.source.source_type,
        input.source.source_id,
        JSON.stringify(input.source.contexts),
        input.source.contexts[0]?.type ?? null,
        input.source.contexts[0]?.id ?? null,
        generationKey,
        input.source.initial_provenance,
        now,
        input.source.valid_until ?? null,
      ],
    );
    await insertRevision({
      tx: input.tx,
      recommendationId,
      revisionId,
      revision: 1,
      source: input.source,
      generation,
      generationKey,
      generatedAt: now,
    });
    return { recommendation_id: recommendationId, revision: 1, created: true };
  }

  const row = current.rows[0]!;
  const priorRevision = await input.tx.query<{ revision: number }>(
    `SELECT revision FROM recommendation.recommendation_revisions
      WHERE tenant_id=$1 AND recommendation_id=$2 AND source_generation_key=$3`,
    [input.tx.tenantId, row.id, generationKey],
  );
  if (row.source_generation_key === generationKey) {
    await input.tx.query(
      `UPDATE recommendation.recommendations
          SET current_state='ACTIVE',contexts=$1,context_type=$2,context_id=$3,
              source_valid_until=$4,refreshed_at=$5,version=version+1
        WHERE tenant_id=$6 AND id=$7`,
      [
        JSON.stringify(input.source.contexts),
        input.source.contexts[0]?.type ?? null,
        input.source.contexts[0]?.id ?? null,
        input.source.valid_until ?? null,
        now,
        input.tx.tenantId,
        row.id,
      ],
    );
    return {
      recommendation_id: row.id,
      revision: row.latest_revision,
      created: false,
    };
  }

  if (priorRevision.rowCount) {
    // A replay of an older immutable generation must never roll the current
    // projection backward. A genuine source reversion has a new source version.
    return {
      recommendation_id: row.id,
      revision: Number(row.latest_revision),
      created: false,
      stale_generation: true,
    };
  }

  const revision = Number(row.latest_revision) + 1;
  const revisionId = randomUUID();
  await input.tx.query(
    `INSERT INTO recommendation.recommendation_revisions(
       id,tenant_id,recommendation_id,revision,source_generation_key,
       source_generation,source_version,source_profile_id,source_profile_version,
       recommendation_profile_id,recommendation_profile_version,
       source_rank,source_score,source_band,reason_codes,evidence_summary,
       freshness,source_valid_until,generated_at,supersedes_revision
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'TASK-096-EXPLAINABLE',1,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      revisionId,
      input.tx.tenantId,
      row.id,
      revision,
      generationKey,
      generation,
      JSON.stringify(input.source.source_version),
      input.source.profile_id ?? null,
      input.source.profile_version == null
        ? null
        : String(input.source.profile_version),
      input.source.rank ?? null,
      input.source.score ?? null,
      input.source.band ?? null,
      input.source.reason_codes,
      JSON.stringify(input.source.evidence_summary),
      JSON.stringify(input.source.freshness),
      input.source.valid_until ?? null,
      now,
      row.latest_revision,
    ],
  );
  await input.tx.query(
    `UPDATE recommendation.recommendations
        SET current_state='ACTIVE',source_domain=$1,contexts=$2,context_type=$3,
            context_id=$4,source_generation_key=$5,latest_revision=$6,
            source_valid_until=$7,refreshed_at=$8,version=version+1
      WHERE tenant_id=$9 AND id=$10`,
    [
      input.source.source_domain,
      JSON.stringify(input.source.contexts),
      input.source.contexts[0]?.type ?? null,
      input.source.contexts[0]?.id ?? null,
      generationKey,
      revision,
      input.source.valid_until ?? null,
      now,
      input.tx.tenantId,
      row.id,
    ],
  );
  return { recommendation_id: row.id, revision, created: true };
}

async function insertRevision(input: {
  tx: Transaction;
  recommendationId: string;
  revisionId: string;
  revision: number;
  source: RecommendationSource;
  generation: string;
  generationKey: string;
  generatedAt: string;
}) {
  await input.tx.query(
    `INSERT INTO recommendation.recommendation_revisions(
       id,tenant_id,recommendation_id,revision,source_generation_key,
       source_generation,source_version,source_profile_id,source_profile_version,
       recommendation_profile_id,recommendation_profile_version,
       source_rank,source_score,source_band,reason_codes,evidence_summary,
       freshness,source_valid_until,generated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'TASK-096-EXPLAINABLE',1,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      input.revisionId,
      input.tx.tenantId,
      input.recommendationId,
      input.revision,
      input.generationKey,
      input.generation,
      JSON.stringify(input.source.source_version),
      input.source.profile_id ?? null,
      input.source.profile_version == null
        ? null
        : String(input.source.profile_version),
      input.source.rank ?? null,
      input.source.score ?? null,
      input.source.band ?? null,
      input.source.reason_codes,
      JSON.stringify(input.source.evidence_summary),
      JSON.stringify(input.source.freshness),
      input.source.valid_until ?? null,
      input.generatedAt,
    ],
  );
}

export async function markRecommendationSourceMissing(input: {
  tx: Transaction;
  family: RecommendationFamily;
  seenSourceIds: string[];
  asOf: string;
}) {
  await input.tx.query(
    `UPDATE recommendation.recommendations
        SET current_state=CASE
          WHEN source_valid_until IS NOT NULL AND source_valid_until <= $1
            THEN 'EXPIRED' ELSE 'RESOLVED_BY_SOURCE' END,
            refreshed_at=$1,version=version+1
      WHERE tenant_id=$2 AND family=$3 AND current_state='ACTIVE'
        AND NOT (source_id=ANY($4::uuid[]))`,
    [input.asOf, input.tx.tenantId, input.family, input.seenSourceIds],
  );
}

export async function writeRecommendationWatermark(input: {
  tx: Transaction;
  family: RecommendationFamily;
  success: boolean;
  sourceGeneration?: string;
  availableCount?: number;
  durationMs: number;
  errorCode?: string;
  at?: string;
}) {
  await input.tx.query(
    `INSERT INTO recommendation.source_watermarks(
       tenant_id,source_family,last_success_at,last_error_code,source_generation,
       available_count,last_duration_ms,updated_at
     ) VALUES($1,$2,CASE WHEN $3 THEN $4::timestamptz ELSE NULL END,$5,$6,$7,$8,$4)
     ON CONFLICT(tenant_id,source_family) DO UPDATE SET
       last_success_at=CASE WHEN $3 THEN EXCLUDED.last_success_at
                            ELSE recommendation.source_watermarks.last_success_at END,
       last_error_code=$5,
       source_generation=CASE WHEN $3 THEN $6
                              ELSE recommendation.source_watermarks.source_generation END,
       available_count=CASE WHEN $3 THEN $7
                            ELSE recommendation.source_watermarks.available_count END,
       last_duration_ms=$8,updated_at=$4`,
    [
      input.tx.tenantId,
      input.family,
      input.success,
      input.at ?? new Date().toISOString(),
      input.errorCode ?? null,
      input.sourceGeneration ?? null,
      input.availableCount ?? null,
      input.durationMs,
    ],
  );
}

export async function readRecommendationFamily(input: {
  tx: Transaction;
  family: RecommendationFamily;
  actorId: string;
  contextType?: string;
  contextId?: string;
  state?: RecommendationState;
  sourceIds?: string[];
  offset?: number;
  limit?: number;
}) {
  const result = await input.tx.query(
    `SELECT r.id,r.family,r.source_domain,r.source_type,r.source_id,r.contexts,
            r.current_state,r.latest_revision,r.source_generation_key,
            r.created_at,r.refreshed_at,r.source_valid_until,v.id AS revision_id,
            v.revision,v.source_generation,v.source_version,v.source_profile_id,
            v.source_profile_version,v.recommendation_profile_id,
            v.recommendation_profile_version,v.source_rank,v.source_score,v.source_band,
            v.reason_codes,v.evidence_summary,v.freshness,v.generated_at,
            COALESCE(interactions.types,'[]'::jsonb) AS actor_interactions
       FROM recommendation.recommendations r
       JOIN recommendation.recommendation_revisions v
         ON v.tenant_id=r.tenant_id AND v.recommendation_id=r.id
        AND v.revision=r.latest_revision
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(DISTINCT i.interaction_type) AS types
           FROM recommendation.recommendation_interactions i
          WHERE i.tenant_id=r.tenant_id AND i.recommendation_id=r.id
            AND i.revision=r.latest_revision AND i.actor_id=$2
       ) interactions ON true
      WHERE r.tenant_id=$1 AND r.family=$3
        AND ($4::text IS NULL OR r.current_state=$4)
        AND ($5::text IS NULL OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(r.contexts) c
           WHERE c->>'type'=$5 AND c->>'id'=$6
        ))
        AND ($7::uuid[] IS NULL OR r.source_id=ANY($7::uuid[]))
      ORDER BY r.created_at DESC,r.id DESC OFFSET $8 LIMIT $9`,
    [
      input.tx.tenantId,
      input.actorId,
      input.family,
      input.state ?? null,
      input.contextType ?? null,
      input.contextId ?? null,
      input.sourceIds ?? null,
      input.offset ?? 0,
      (input.limit ?? 100) + 1,
    ],
  );
  return result.rows;
}

export async function readRecommendationById(input: {
  tx: Transaction;
  recommendationId: string;
  actorId: string;
}) {
  const result = await input.tx.query(
    `SELECT r.id,r.family,r.source_domain,r.source_type,r.source_id,r.contexts,
            r.current_state,r.latest_revision,r.source_generation_key,
            r.created_at,r.refreshed_at,r.source_valid_until,v.id AS revision_id,
            v.revision,v.source_generation,v.source_version,v.source_profile_id,
            v.source_profile_version,v.recommendation_profile_id,
            v.recommendation_profile_version,v.source_rank,v.source_score,v.source_band,
            v.reason_codes,v.evidence_summary,v.freshness,v.generated_at,
            COALESCE(interactions.types,'[]'::jsonb) AS actor_interactions
       FROM recommendation.recommendations r
       JOIN recommendation.recommendation_revisions v
         ON v.tenant_id=r.tenant_id AND v.recommendation_id=r.id
        AND v.revision=r.latest_revision
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(DISTINCT i.interaction_type) AS types
           FROM recommendation.recommendation_interactions i
          WHERE i.tenant_id=r.tenant_id AND i.recommendation_id=r.id
            AND i.revision=r.latest_revision AND i.actor_id=$3
       ) interactions ON true
      WHERE r.tenant_id=$1 AND r.id=$2`,
    [input.tx.tenantId, input.recommendationId, input.actorId],
  );
  return result.rows[0] ?? null;
}

export async function readRecommendationRevisions(input: {
  tx: Transaction;
  recommendationId: string;
}) {
  const result = await input.tx.query(
    `SELECT id,revision,source_generation,source_version,source_profile_id,
            source_profile_version,recommendation_profile_id,
            recommendation_profile_version,source_rank,source_score,source_band,
            reason_codes,evidence_summary,freshness,source_valid_until,
            generated_at,supersedes_revision
       FROM recommendation.recommendation_revisions
      WHERE tenant_id=$1 AND recommendation_id=$2 ORDER BY revision DESC`,
    [input.tx.tenantId, input.recommendationId],
  );
  return result.rows;
}

export async function recordRecommendationInteraction(input: {
  tx: Transaction;
  recommendationId: string;
  revision: number;
  actorId: string;
  interaction: RecommendationInteractionType;
  idempotencyKey: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
  validateCurrentSource?: () => Promise<boolean>;
}) {
  const requestHash = hash(
    JSON.stringify({
      recommendation_id: input.recommendationId,
      revision: input.revision,
      interaction: input.interaction,
      metadata: input.metadata ?? {},
    }),
  );
  await input.tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `${input.tx.tenantId}:${input.actorId}:${input.idempotencyKey}`,
  ]);
  const prior = await input.tx.query<{
    id: string;
    request_hash: string;
    revision: number;
  }>(
    `SELECT id,request_hash,revision FROM recommendation.recommendation_interactions
      WHERE tenant_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
    [input.tx.tenantId, input.actorId, input.idempotencyKey],
  );
  if (prior.rowCount) {
    if (prior.rows[0]!.request_hash !== requestHash)
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "Idempotency key was used with a different request.",
      );
    return { id: prior.rows[0]!.id, replayed: true };
  }
  if (input.validateCurrentSource && !(await input.validateCurrentSource()))
    throw new ApplicationError("NOT_FOUND", "Recommendation was not found.");
  const revisionRow = await input.tx.query<{
    id: string;
    source_generation_key: string;
  }>(
    `SELECT id,source_generation_key FROM recommendation.recommendation_revisions
      WHERE tenant_id=$1 AND recommendation_id=$2 AND revision=$3`,
    [input.tx.tenantId, input.recommendationId, input.revision],
  );
  if (!revisionRow.rowCount)
    throw new ApplicationError("NOT_FOUND", "Recommendation was not found.");
  const id = randomUUID();
  const inserted = await input.tx.query(
    `INSERT INTO recommendation.recommendation_interactions(
       id,tenant_id,recommendation_id,revision_id,revision,source_generation_key,
       actor_id,interaction_type,idempotency_key,request_hash,correlation_id,metadata
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(tenant_id,actor_id,idempotency_key) DO NOTHING
     RETURNING id`,
    [
      id,
      input.tx.tenantId,
      input.recommendationId,
      revisionRow.rows[0]!.id,
      input.revision,
      revisionRow.rows[0]!.source_generation_key,
      input.actorId,
      input.interaction,
      input.idempotencyKey,
      requestHash,
      input.correlationId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  if (!inserted.rowCount) {
    const replay = await input.tx.query<{ id: string; request_hash: string }>(
      `SELECT id,request_hash FROM recommendation.recommendation_interactions
        WHERE tenant_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
      [input.tx.tenantId, input.actorId, input.idempotencyKey],
    );
    if (!replay.rowCount || replay.rows[0]!.request_hash !== requestHash)
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "Idempotency key was used with a different request.",
      );
    return { id: replay.rows[0]!.id, replayed: true };
  }
  return { id, replayed: false };
}

export async function applyCurrentSourceEligibility(input: {
  tx: Transaction;
  family: RecommendationFamily;
  sourceId: string;
  generation: Record<string, unknown>;
  validUntil?: string | null;
  asOf: string;
}) {
  const key = hash(canonicalSourceGeneration(input.generation));
  const current = await input.tx.query<{
    id: string;
    current_state: RecommendationState;
    source_generation_key: string;
    source_valid_until: Date | string | null;
  }>(
    `SELECT id,current_state,source_generation_key,source_valid_until
       FROM recommendation.recommendations
      WHERE tenant_id=$1 AND family=$2 AND source_id=$3
      FOR UPDATE`,
    [input.tx.tenantId, input.family, input.sourceId],
  );
  if (!current.rowCount) return null;
  const row = current.rows[0]!;
  const state: RecommendationState =
    row.source_generation_key !== key
      ? "SUPERSEDED"
      : input.validUntil &&
          Date.parse(input.validUntil) <= Date.parse(input.asOf)
        ? "EXPIRED"
        : "ACTIVE";
  if (row.current_state !== state)
    await input.tx.query(
      `UPDATE recommendation.recommendations
          SET current_state=$1,refreshed_at=$2,version=version+1
        WHERE tenant_id=$3 AND id=$4`,
      [state, input.asOf, input.tx.tenantId, row.id],
    );
  return { recommendation_id: row.id, state, source_generation_key: key };
}

export function sourceUnavailableReason(error: unknown) {
  if (error instanceof ApplicationError && error.code === "PERMISSION_DENIED")
    return "SOURCE_ACCESS_DENIED";
  return "SOURCE_QUERY_FAILED";
}
