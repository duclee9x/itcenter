import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  authorize,
  type AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import { PostgresIdempotencyStore } from "../../../packages/messaging/src/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import type { Json } from "../../../packages/shared-kernel/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { PostgresAudit } from "../../audit/index.js";
import { upsertAssetLifecycleWorkItem } from "../../work-queue/index.js";

export type ReplacementCandidateRecommendation = {
  tenant_id: string;
  asset_id: string;
  replacement_assessment_id: string;
  score: number;
  band: "PLAN" | "PRIORITY";
  scoring_profile_id: string;
  scoring_profile_version: string;
  reasons: string[];
  evidence_summary: Record<string, unknown>;
  principal: { id: string; tenant_id: string; actor_type: string };
  authorization: AuthorizationPort;
  context: { correlation_id: string; causation_id: string };
  service_name: string;
  reason: string;
  idempotency_key: string;
};

export type ReplacementCandidateRecommendationResult = {
  outcome:
    | "CREATED"
    | "UPDATED_ACTIVE"
    | "ACTIVE_ALREADY_CURRENT"
    | "TERMINAL_DISPOSITION_EXISTS"
    | "INELIGIBLE"
    | "CONFLICT";
  candidate_id: string | null;
  asset_id: string;
  state: string | null;
  version: number | null;
  score: number;
};

async function recordCandidateRecommendation(input: {
  tx: Transaction;
  command: ReplacementCandidateRecommendation;
  result: ReplacementCandidateRecommendationResult;
  event:
    | "REPLACEMENT.CANDIDATE_CREATED"
    | "REPLACEMENT.CANDIDATE_RECOMMENDATION_UPDATED";
  before: Json;
}) {
  const now = new Date().toISOString();
  const payload = {
    candidate_id: input.result.candidate_id!,
    asset_id: input.command.asset_id,
    assessment_id: input.command.replacement_assessment_id,
    score: input.command.score,
    band: input.command.band,
    profile_id: input.command.scoring_profile_id,
    profile_version: input.command.scoring_profile_version,
    state: input.result.state,
  };
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: input.event,
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.command.service_name, instance: "application" },
    aggregate: {
      type: "REPLACEMENT_PLAN",
      id: input.result.candidate_id!,
      version: input.result.version!,
    },
    actor: {
      type:
        input.command.principal.actor_type === "SYSTEM_ASSET_SCORING"
          ? "SYSTEM"
          : input.command.principal.actor_type,
      id: input.command.principal.id,
    },
    correlation_id: input.command.context.correlation_id,
    causation_id: input.command.context.causation_id,
    tenant_id: input.command.tenant_id,
    organization_id: input.command.tenant_id,
    idempotency_key: input.command.idempotency_key,
    payload: payload as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.command.tenant_id,
    event_type: input.event,
    occurred_at: now,
    actor: {
      type: input.command.principal.actor_type,
      id: input.command.principal.id,
    },
    action: { command_type: "REPLACEMENT_CANDIDATE.RECOMMEND_FROM_ASSESSMENT" },
    subject: {
      entity_type: "REPLACEMENT_PLAN",
      entity_id: input.result.candidate_id!,
    },
    correlation_id: input.command.context.correlation_id,
    causation_id: input.command.context.causation_id,
    reason: { code: "SCORING_RECOMMENDATION", text: input.command.reason },
    before: input.before,
    after: payload as Json,
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [
      {
        entity_type: "ASSET",
        entity_id: input.command.asset_id,
        relation: "SUBJECT",
      },
    ],
    evidence: [
      {
        type: "REPLACEMENT_ASSESSMENT",
        id: input.command.replacement_assessment_id,
        checksum: input.command.scoring_profile_version,
        relation: "RECOMMENDATION_SOURCE",
      },
    ],
  });
  await upsertAssetLifecycleWorkItem({
    tx: input.tx,
    sourceId: input.result.candidate_id!,
    title: "Review replacement candidate recommendation",
    priority: "HIGH",
  });
}

/** TASK-059-owned command boundary for a future Asset scoring producer. */
async function recommendReplacementCandidateOnce(
  tx: Transaction,
  input: ReplacementCandidateRecommendation,
): Promise<ReplacementCandidateRecommendationResult> {
  if (input.tenant_id !== tx.tenantId)
    throw new ApplicationError("PERMISSION_DENIED", "Tenant scope mismatch.");
  if (
    !input.asset_id ||
    !input.replacement_assessment_id ||
    !input.scoring_profile_id ||
    !input.scoring_profile_version ||
    !input.principal.id ||
    input.principal.tenant_id !== tx.tenantId ||
    !["SYSTEM", "SYSTEM_ASSET_SCORING"].includes(input.principal.actor_type) ||
    !input.service_name ||
    !input.reason.trim() ||
    !input.context.correlation_id ||
    !input.context.causation_id ||
    !input.idempotency_key ||
    !Number.isInteger(input.score) ||
    input.score < 60 ||
    input.score > 100 ||
    (input.band === "PLAN" && input.score >= 80) ||
    (input.band === "PRIORITY" && input.score < 80) ||
    !Array.isArray(input.reasons) ||
    input.reasons.length === 0 ||
    input.reasons.some(
      (reason) => typeof reason !== "string" || !reason.trim(),
    ) ||
    !input.evidence_summary ||
    !["PLAN", "PRIORITY"].includes(input.band)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid replacement assessment recommendation is required.",
    );

  await authorize(input.authorization, {
    principal: input.principal,
    action: "replacement.create_candidate",
    resource: {
      type: "replacement",
      id: input.asset_id,
      tenant_id: tx.tenantId,
    },
    scope: { asset: input.asset_id, tenant: input.tenant_id },
    context: { ...input.context },
  });

  // Lock the canonical Asset row so concurrent producers serialize before
  // consulting or creating the one-active-candidate record.
  const asset = await tx.query(
    "SELECT lifecycle_state FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.asset_id],
  );
  if (
    !asset.rowCount ||
    !["ASSIGNED", "IN_USE", "REPAIR"].includes(
      String(asset.rows[0]!.lifecycle_state),
    )
  )
    return {
      outcome: "INELIGIBLE",
      candidate_id: null,
      asset_id: input.asset_id,
      state: null,
      version: null,
      score: input.score,
    };

  const active = await tx.query(
    "SELECT id,state,version,score,recommendation_assessment_id,scoring_profile_id,scoring_profile_version FROM asset.replacement_plans WHERE tenant_id=$1 AND asset_id=$2 AND state NOT IN ('REPLACED','CANCELLED') FOR UPDATE",
    [tx.tenantId, input.asset_id],
  );
  const summary = {
    assessment_id: input.replacement_assessment_id,
    band: input.band,
    profile_id: input.scoring_profile_id,
    profile_version: input.scoring_profile_version,
    evidence: input.evidence_summary,
  };
  if (active.rowCount) {
    const current = active.rows[0]!;
    if (
      current.recommendation_assessment_id ===
        input.replacement_assessment_id &&
      current.scoring_profile_id === input.scoring_profile_id &&
      current.scoring_profile_version === input.scoring_profile_version &&
      Number(current.score) === input.score
    )
      return {
        outcome: "ACTIVE_ALREADY_CURRENT",
        candidate_id: String(current.id),
        asset_id: input.asset_id,
        state: String(current.state),
        version: Number(current.version),
        score: input.score,
      };
    if (current.state !== "UNDER_REVIEW")
      return {
        outcome: "CONFLICT",
        candidate_id: String(current.id),
        asset_id: input.asset_id,
        state: String(current.state),
        version: Number(current.version),
        score: Number(current.score ?? input.score),
      };
    const version = Number(current.version) + 1;
    await tx.query(
      "UPDATE asset.replacement_plans SET score=$1,reasons=$2,assessment=$3,recommendation_assessment_id=$4,scoring_profile_id=$5,scoring_profile_version=$6,version=$7,updated_at=now() WHERE tenant_id=$8 AND id=$9 AND version=$10",
      [
        input.score,
        JSON.stringify(input.reasons),
        JSON.stringify(summary),
        input.replacement_assessment_id,
        input.scoring_profile_id,
        input.scoring_profile_version,
        version,
        tx.tenantId,
        current.id,
        current.version,
      ],
    );
    const value = {
      candidate_id: String(current.id),
      asset_id: input.asset_id,
      state: String(current.state),
      version,
      score: input.score,
      band: input.band,
      recommendation_assessment_id: input.replacement_assessment_id,
    };
    await tx.query(
      "INSERT INTO asset.replacement_history(id,tenant_id,plan_id,entity_version,action,snapshot,actor_id,reason) VALUES($1,$2,$3,$4,'CANDIDATE_RECOMMENDATION_UPDATED',$5,$6,$7)",
      [
        randomUUID(),
        tx.tenantId,
        current.id,
        version,
        JSON.stringify(value),
        input.principal.id,
        input.reason,
      ],
    );
    const result = {
      outcome: "UPDATED_ACTIVE",
      candidate_id: String(current.id),
      asset_id: input.asset_id,
      state: String(current.state),
      version,
      score: input.score,
    } as const;
    await recordCandidateRecommendation({
      tx,
      command: input,
      result,
      event: "REPLACEMENT.CANDIDATE_RECOMMENDATION_UPDATED",
      before: {
        state: String(current.state),
        version: Number(current.version),
        score: current.score === null ? null : Number(current.score),
      },
    });
    return result;
  }

  const terminal = await tx.query(
    "SELECT id,state,version,score FROM asset.replacement_plans WHERE tenant_id=$1 AND asset_id=$2 ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE",
    [tx.tenantId, input.asset_id],
  );
  if (terminal.rowCount)
    return {
      outcome: "TERMINAL_DISPOSITION_EXISTS",
      candidate_id: String(terminal.rows[0]!.id),
      asset_id: input.asset_id,
      state: String(terminal.rows[0]!.state),
      version: Number(terminal.rows[0]!.version),
      score: input.score,
    };

  const id = randomUUID();
  const value = {
    candidate_id: id,
    asset_id: input.asset_id,
    state: "UNDER_REVIEW",
    version: 1,
    score: input.score,
    band: input.band,
    recommendation_assessment_id: input.replacement_assessment_id,
  };
  const created = await tx.query(
    "INSERT INTO asset.replacement_plans(id,tenant_id,asset_id,state,score,reasons,assessment,recommendation_assessment_id,scoring_profile_id,scoring_profile_version,reason,created_by) VALUES($1,$2,$3,'UNDER_REVIEW',$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id,asset_id) WHERE state NOT IN ('REPLACED','CANCELLED') DO NOTHING RETURNING id",
    [
      id,
      tx.tenantId,
      input.asset_id,
      input.score,
      JSON.stringify(input.reasons),
      JSON.stringify(summary) as Json,
      input.replacement_assessment_id,
      input.scoring_profile_id,
      input.scoring_profile_version,
      input.reason,
      input.principal.id,
    ],
  );
  if (!created.rowCount)
    return {
      outcome: "CONFLICT",
      candidate_id: null,
      asset_id: input.asset_id,
      state: null,
      version: null,
      score: input.score,
    };
  await tx.query(
    "INSERT INTO asset.replacement_history(id,tenant_id,plan_id,entity_version,action,snapshot,actor_id,reason) VALUES($1,$2,$3,1,'CANDIDATE_CREATED',$4,$5,$6)",
    [
      randomUUID(),
      tx.tenantId,
      id,
      JSON.stringify(value),
      input.principal.id,
      input.reason,
    ],
  );
  const result = {
    outcome: "CREATED",
    candidate_id: id,
    asset_id: input.asset_id,
    state: "UNDER_REVIEW",
    version: 1,
    score: input.score,
  } as const;
  await recordCandidateRecommendation({
    tx,
    command: input,
    result,
    event: "REPLACEMENT.CANDIDATE_CREATED",
    before: null,
  });
  return result;
}

/** Idempotent TASK-059 command boundary used by future scoring producers. */
export async function recommendReplacementCandidate(
  tx: Transaction,
  input: ReplacementCandidateRecommendation,
): Promise<ReplacementCandidateRecommendationResult> {
  const result = await new PostgresIdempotencyStore(tx).execute(
    {
      principalId: input.principal.id,
      operation: "REPLACEMENT.RECOMMEND_FROM_ASSESSMENT",
      businessScope: input.asset_id,
      key: input.idempotency_key,
      semanticRequest: {
        tenant_id: input.tenant_id,
        asset_id: input.asset_id,
        replacement_assessment_id: input.replacement_assessment_id,
        score: input.score,
        band: input.band,
        scoring_profile_id: input.scoring_profile_id,
        scoring_profile_version: input.scoring_profile_version,
        reasons: input.reasons,
        evidence_summary: input.evidence_summary,
        reason: input.reason,
      } as Json,
      expiresAt: new Date(Date.now() + 86400000),
    },
    async () => ({
      status: 200,
      body: (await recommendReplacementCandidateOnce(tx, input)) as Json,
    }),
  );
  return result.body as unknown as ReplacementCandidateRecommendationResult;
}
