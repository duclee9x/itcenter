import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type {
  AuthorizationPort,
  Principal,
} from "../../../packages/auth/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  queryIncidentCorrelationRecommendationSource,
  type IncidentCorrelationRecommendationSourceItem,
} from "../../incident/index.js";
import {
  queryReplacementCandidateRecommendationSource,
  type ReplacementCandidateRecommendationSourceItem,
} from "../../asset/index.js";
import {
  queryRecommendationSourceSessions,
  readRecommendationSession,
  queryKnowledgeRecommendationEligibility,
} from "../../problem/index.js";
import {
  markRecommendationSourceMissing,
  materializeRecommendationSource,
  writeRecommendationWatermark,
} from "./recommendation.js";
import type {
  RecommendationFamily,
  RecommendationSource,
} from "../domain/recommendation.js";

type SourceOutcome = {
  availability: "AVAILABLE" | "AVAILABLE_EMPTY" | "SOURCE_UNAVAILABLE";
  materialized: number;
  revisions_created: number;
  error_code?: string;
};

const iso = (value: Date | string) => new Date(value).toISOString();

export function incidentSource(
  item: IncidentCorrelationRecommendationSourceItem,
): RecommendationSource {
  return {
    family: "INCIDENT_CORRELATION_REVIEW",
    source_domain: "INCIDENT",
    source_type: "CORRELATION_DECISION",
    source_id: item.decision_id,
    contexts: [{ type: "INCIDENT", id: item.incident_id }],
    generation: {
      decision_id: item.decision_id,
      source_generation: item.source_generation,
      evaluation_identity: item.evaluation_identity,
    },
    source_version: { decision_id: item.decision_id },
    profile_id: item.profile_id,
    profile_version: item.profile_version,
    score: item.confidence,
    reason_codes: item.reason_codes,
    evidence_summary: {
      decision_state: item.decision_state,
      ambiguity: item.ambiguity,
      candidates: item.candidates.map((candidate) => ({
        root_incident_id: candidate.root_incident_id,
        raw_score: candidate.raw_score,
        confidence: candidate.confidence,
        strong_signals: candidate.strong_signals,
        evidence_categories: candidate.evidence_categories,
      })),
    },
    freshness: { evaluated_at: item.evaluated_at, state: "SOURCE_CURRENT" },
    initial_provenance: "SOURCE_EVENT",
  };
}

export function replacementSource(
  item: ReplacementCandidateRecommendationSourceItem,
): RecommendationSource {
  return {
    family: "ASSET_REPLACEMENT_REVIEW",
    source_domain: "ASSET",
    source_type: "REPLACEMENT_CANDIDATE",
    source_id: item.candidate_id,
    contexts: [{ type: "ASSET", id: item.asset_id }],
    generation: item.source_generation,
    source_version: {
      candidate_id: item.candidate_id,
      candidate_version: item.candidate_version,
      assessment_id: item.assessment_id,
    },
    profile_id: item.profile_id,
    profile_version: item.profile_version,
    score: item.score,
    band: item.band,
    reason_codes: item.reasons,
    evidence_summary: {
      candidate_state: item.candidate_state,
      assessment_id: item.assessment_id,
      completeness: item.completeness,
      contributions: item.contributions,
    },
    freshness: {
      state: item.freshness,
      calculated_at: item.calculated_at,
      valid_until: item.valid_until,
    },
    valid_until: item.valid_until,
    initial_provenance: "SOURCE_EVENT",
  };
}

export async function collectIncident(input: {
  tx: Transaction;
  principal: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
  asOf: string;
  incidentId?: string;
}) {
  const items: IncidentCorrelationRecommendationSourceItem[] = [];
  for (let offset = 0; ;) {
    const page = await queryIncidentCorrelationRecommendationSource({
      tx: input.tx,
      tenant_id: input.tx.tenantId,
      principal: input.principal,
      authorization: input.authorization,
      correlation_id: input.correlationId,
      ...(input.incidentId ? { incident_id: input.incidentId } : {}),
      offset,
      limit: 200,
    });
    if (page.availability === "SOURCE_UNAVAILABLE")
      return { availability: "SOURCE_UNAVAILABLE" as const, items: [] };
    items.push(...page.items);
    if (!page.next_offset) break;
    offset = page.next_offset;
  }
  return {
    availability: items.length
      ? ("AVAILABLE" as const)
      : ("AVAILABLE_EMPTY" as const),
    items,
  };
}

export async function collectReplacement(input: {
  tx: Transaction;
  principal: Principal;
  authorization: AuthorizationPort;
  correlationId: string;
  asOf: string;
  assetId?: string;
}) {
  const items: ReplacementCandidateRecommendationSourceItem[] = [];
  for (let offset = 0; ;) {
    const page = await queryReplacementCandidateRecommendationSource({
      tx: input.tx,
      tenant_id: input.tx.tenantId,
      principal: input.principal,
      authorization: input.authorization,
      correlation_id: input.correlationId,
      as_of: input.asOf,
      ...(input.assetId ? { asset_id: input.assetId } : {}),
      offset,
      limit: 200,
    });
    if (page.availability === "SOURCE_UNAVAILABLE")
      return { availability: "SOURCE_UNAVAILABLE" as const, items: [] };
    items.push(...page.items);
    if (!page.next_offset) break;
    offset = page.next_offset;
  }
  return {
    availability: items.length
      ? ("AVAILABLE" as const)
      : ("AVAILABLE_EMPTY" as const),
    items,
  };
}

export async function collectKnowledge(input: {
  tx: Transaction;
  principal: Principal;
  authorization: AuthorizationPort;
  correlation: CorrelationContext;
  sourceContext?: {
    type: "INCIDENT" | "TICKET" | "RECOMMENDATION_SESSION";
    id: string;
  };
}) {
  const items: RecommendationSource[] = [];
  for (let offset = 0; ;) {
    const page = await queryRecommendationSourceSessions({
      tx: input.tx,
      principal: input.principal,
      authorization: input.authorization,
      correlation: input.correlation,
      ...(input.sourceContext ? { sourceContext: input.sourceContext } : {}),
      offset,
      limit: 200,
    });
    for (const identity of page.rows) {
      let contextReadable = true;
      for (const [action, type, id] of [
        ...(identity.ticket_id
          ? [["ticket.read", "ticket", identity.ticket_id] as const]
          : []),
        ...(identity.incident_id
          ? [["incident.read", "incident", identity.incident_id] as const]
          : []),
      ]) {
        const decision = await input.authorization.evaluate({
          principal: input.principal,
          action,
          resource: { type, id, tenant_id: input.tx.tenantId },
          scope: { tenant: input.tx.tenantId, [type]: id },
          context: { ...input.correlation },
        });
        if (decision.result !== "ALLOW") contextReadable = false;
      }
      if (!contextReadable) continue;
      const session = await readRecommendationSession(
        input.tx,
        identity.session_id,
      );
      if (
        !session ||
        !["PRESENTED", "NOT_HELPFUL"].includes(String(session.outcome))
      )
        continue;
      for (const item of session.items as Array<{
        id: string;
        knowledge_id: string;
        knowledge_version: number;
        rank: number;
        score: number;
        evidence: Array<{ code: string }>;
      }>) {
        const eligibility = await queryKnowledgeRecommendationEligibility({
          tx: input.tx,
          authorization: input.authorization,
          principal: input.principal,
          context: input.correlation,
          knowledgeId: item.knowledge_id,
          knowledgeVersion: Number(item.knowledge_version),
        });
        if (!eligibility.eligible) continue;
        const contexts: RecommendationSource["contexts"] = [
          { type: "RECOMMENDATION_SESSION", id: identity.session_id },
        ];
        if (identity.ticket_id)
          contexts.push({ type: "TICKET", id: identity.ticket_id });
        if (identity.incident_id)
          contexts.push({ type: "INCIDENT", id: identity.incident_id });
        items.push({
          family: "KNOWLEDGE_GUIDANCE",
          source_domain: "KNOWLEDGE",
          source_type: "KNOWLEDGE_RECOMMENDATION_ITEM",
          source_id: item.id,
          contexts,
          generation: {
            session_id: identity.session_id,
            session_version: identity.version,
            item_id: item.id,
            knowledge_id: item.knowledge_id,
            knowledge_version: Number(item.knowledge_version),
            rank: Number(item.rank),
            score: Number(item.score),
            evidence: item.evidence.map((evidence) => evidence.code),
          },
          source_version: {
            session_version: identity.version,
            knowledge_version: Number(item.knowledge_version),
          },
          profile_id: identity.profile_id,
          profile_version: identity.profile_version,
          rank: Number(item.rank),
          score: Number(item.score),
          reason_codes: item.evidence.map((evidence) => evidence.code),
          evidence_summary: {
            knowledge_id: item.knowledge_id,
            knowledge_version: Number(item.knowledge_version),
            presentation_eligible: true,
          },
          freshness: {
            eligibility_checked_at: new Date().toISOString(),
            state: "PRESENTATION_ELIGIBLE",
          },
          initial_provenance: "SOURCE_EVENT",
        });
      }
    }
    if (page.next_offset === null) break;
    offset = page.next_offset;
  }
  return {
    availability: items.length
      ? ("AVAILABLE" as const)
      : ("AVAILABLE_EMPTY" as const),
    items,
  };
}

export async function queryCurrentRecommendationFamilySources(input: {
  tx: Transaction;
  family: RecommendationFamily;
  principal: Principal;
  authorization: AuthorizationPort;
  correlation: CorrelationContext;
  context?: {
    type: "INCIDENT" | "TICKET" | "RECOMMENDATION_SESSION" | "ASSET";
    id: string;
  };
  asOf?: string;
}) {
  const asOf = input.asOf ?? new Date().toISOString();
  if (input.family === "INCIDENT_CORRELATION_REVIEW") {
    const result = await collectIncident({
      tx: input.tx,
      principal: input.principal,
      authorization: input.authorization,
      correlationId: input.correlation.correlation_id,
      asOf,
      ...(input.context?.type === "INCIDENT"
        ? { incidentId: input.context.id }
        : {}),
    });
    return {
      availability: result.availability,
      sources: result.items.map(incidentSource),
    };
  }
  if (input.family === "ASSET_REPLACEMENT_REVIEW") {
    const result = await collectReplacement({
      tx: input.tx,
      principal: input.principal,
      authorization: input.authorization,
      correlationId: input.correlation.correlation_id,
      asOf,
      ...(input.context?.type === "ASSET" ? { assetId: input.context.id } : {}),
    });
    return {
      availability: result.availability,
      sources: result.items.map(replacementSource),
    };
  }
  const sourceContext =
    input.context && input.context.type !== "ASSET"
      ? { type: input.context.type, id: input.context.id }
      : undefined;
  return collectKnowledge({
    ...input,
    ...(sourceContext ? { sourceContext } : {}),
  }).then((result) => ({
    availability: result.availability,
    sources: result.items.filter(
      (source) =>
        !input.context ||
        source.contexts.some(
          (context) =>
            context.type === input.context!.type &&
            context.id === input.context!.id,
        ),
    ),
  }));
}

async function reconcileFamily(input: {
  tx: Transaction;
  family: RecommendationFamily;
  source: RecommendationSource[];
  availability: SourceOutcome["availability"];
  asOf: string;
}) {
  const started = Date.now();
  const watermark = await input.tx.query<{
    last_success_at: Date | string | null;
  }>(
    `SELECT last_success_at FROM recommendation.source_watermarks
      WHERE tenant_id=$1 AND source_family=$2`,
    [input.tx.tenantId, input.family],
  );
  const initial = !watermark.rowCount || !watermark.rows[0]!.last_success_at;
  if (input.availability === "SOURCE_UNAVAILABLE") {
    await writeRecommendationWatermark({
      tx: input.tx,
      family: input.family,
      success: false,
      errorCode: "SOURCE_QUERY_FAILED",
      durationMs: Date.now() - started,
      at: input.asOf,
    });
    return {
      availability: input.availability,
      materialized: 0,
      revisions_created: 0,
      error_code: "SOURCE_QUERY_FAILED",
    } satisfies SourceOutcome;
  }
  let materialized = 0;
  let revisionsCreated = 0;
  const sourceIds: string[] = [];
  for (const source of input.source) {
    sourceIds.push(source.source_id);
    const result = await materializeRecommendationSource({
      tx: input.tx,
      source: {
        ...source,
        initial_provenance: initial
          ? "INITIAL_RECONCILIATION"
          : "RECONCILIATION",
      },
      generatedAt: input.asOf,
    });
    materialized += 1;
    if (result.created) revisionsCreated += 1;
  }
  await markRecommendationSourceMissing({
    tx: input.tx,
    family: input.family,
    seenSourceIds: sourceIds,
    asOf: input.asOf,
  });
  await writeRecommendationWatermark({
    tx: input.tx,
    family: input.family,
    success: true,
    sourceGeneration: `${input.source.length}:${input.source
      .map((source) => source.source_id)
      .sort()
      .join(",")}`,
    availableCount: input.source.length,
    durationMs: Date.now() - started,
    at: input.asOf,
  });
  return {
    availability: input.availability,
    materialized,
    revisions_created: revisionsCreated,
  } satisfies SourceOutcome;
}

/** Reconciles the three canonical source owners without issuing any source command. */
export async function reconcileRecommendationSources(input: {
  tx: Transaction;
  principal: Principal;
  authorization: AuthorizationPort;
  correlation: CorrelationContext;
  asOf?: string;
}) {
  if (input.principal.tenant_id !== input.tx.tenantId)
    throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
  const at = input.asOf ?? new Date().toISOString();
  const families: Record<string, SourceOutcome> = {};
  const definitions: Array<{
    family: RecommendationFamily;
    collect: () => Promise<{
      availability: "AVAILABLE" | "AVAILABLE_EMPTY" | "SOURCE_UNAVAILABLE";
      items: RecommendationSource[];
    }>;
  }> = [
    {
      family: "INCIDENT_CORRELATION_REVIEW",
      collect: async () => {
        const result = await collectIncident({
          tx: input.tx,
          principal: input.principal,
          authorization: input.authorization,
          correlationId: input.correlation.correlation_id,
          asOf: at,
        });
        return { ...result, items: result.items.map(incidentSource) };
      },
    },
    {
      family: "KNOWLEDGE_GUIDANCE",
      collect: () => collectKnowledge(input),
    },
    {
      family: "ASSET_REPLACEMENT_REVIEW",
      collect: async () => {
        const result = await collectReplacement({
          tx: input.tx,
          principal: input.principal,
          authorization: input.authorization,
          correlationId: input.correlation.correlation_id,
          asOf: at,
        });
        return { ...result, items: result.items.map(replacementSource) };
      },
    },
  ];
  for (const definition of definitions) {
    const savepoint = `recommendation_${definition.family.toLowerCase()}`;
    await input.tx.query(`SAVEPOINT ${savepoint}`);
    try {
      const collected = await definition.collect();
      const outcome = await reconcileFamily({
        tx: input.tx,
        family: definition.family,
        source: collected.items,
        availability: collected.availability,
        asOf: at,
      });
      await input.tx.query(`RELEASE SAVEPOINT ${savepoint}`);
      families[definition.family] = outcome;
    } catch (error) {
      await input.tx.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await input.tx.query(`RELEASE SAVEPOINT ${savepoint}`);
      await writeRecommendationWatermark({
        tx: input.tx,
        family: definition.family,
        success: false,
        errorCode:
          error instanceof ApplicationError &&
          error.code === "PERMISSION_DENIED"
            ? "SOURCE_ACCESS_DENIED"
            : "SOURCE_QUERY_FAILED",
        durationMs: 0,
        at,
      });
      families[definition.family] = {
        availability: "SOURCE_UNAVAILABLE",
        materialized: 0,
        revisions_created: 0,
        error_code:
          error instanceof ApplicationError &&
          error.code === "PERMISSION_DENIED"
            ? "SOURCE_ACCESS_DENIED"
            : "SOURCE_QUERY_FAILED",
      };
    }
  }
  return { tenant_id: input.tx.tenantId, as_of: iso(at), families };
}

export function recommendationServiceAuthorization(
  tx: Transaction,
): AuthorizationPort {
  return {
    async evaluate(request) {
      const { evaluateAuthorization } = await import("../../identity/index.js");
      const principalType = request.principal.actor_type.startsWith("SYSTEM_")
        ? (request.principal.actor_type as
            | "SYSTEM_AUTOMATION"
            | "SYSTEM_CORRELATION"
            | "SYSTEM_ASSET_SCORING"
            | "SYSTEM_RECOMMENDATION")
        : "USER";
      return evaluateAuthorization(tx, {
        principalId: request.principal.id,
        principalType,
        tenantId: request.principal.tenant_id,
        action: request.action,
        resourceType: request.resource.type,
        resourceId: request.resource.id,
        scope: request.scope,
      });
    },
  };
}

export async function requireRecommendationReconcileGrant(input: {
  tx: Transaction;
  principalId: string;
}) {
  const authorization = recommendationServiceAuthorization(input.tx);
  const decision = await authorization.evaluate({
    principal: {
      id: input.principalId,
      tenant_id: input.tx.tenantId,
      actor_type: "SYSTEM_RECOMMENDATION",
    },
    action: "recommendation.projection.reconcile",
    resource: {
      type: "recommendation_projection",
      id: input.tx.tenantId,
      tenant_id: input.tx.tenantId,
    },
    scope: { tenant: input.tx.tenantId },
    context: { correlation_id: randomUUID() },
  });
  if (decision.result !== "ALLOW")
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Tenant-scoped Recommendation reconciliation grant is unavailable.",
    );
}
