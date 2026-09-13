import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

export const RECOMMENDATION_PROFILE_ID = "TASK-093-SELF-SERVICE";
export const RECOMMENDATION_PROFILE_VERSION = 1;
export const RECOMMENDATION_MAX_ITEMS = 3;
export const RECOMMENDATION_MIN_SCORE = 70;

export interface RecommendationContext {
  description: string;
  title?: string;
  category?: string;
  symptom?: string;
  service_id?: string;
  service_ids?: string[];
  software_product_id?: string;
  platform_id?: string;
  service_environment_id?: string;
  problem_id?: string;
  known_error_id?: string;
  knowledge_id?: string;
  incident_id?: string;
  ticket_id?: string;
  ticket_code?: string;
  priority?: string;
}

export interface RecommendationApplicability {
  type: string;
  id: string;
}

export interface RecommendationEvidence {
  code: string;
  points: number;
  reference?: string;
}

export function normalizeRecommendationText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeRecommendationContext(context: RecommendationContext) {
  const normalized: Record<string, string | string[]> = {
    description: normalizeRecommendationText(context.description),
  };
  for (const field of [
    "title",
    "category",
    "symptom",
    "service_id",
    "service_ids",
    "software_product_id",
    "platform_id",
    "service_environment_id",
    "problem_id",
    "known_error_id",
    "knowledge_id",
    "incident_id",
    "ticket_id",
    "ticket_code",
    "priority",
  ] as const) {
    const value = context[field];
    if (value === undefined) continue;
    if (field === "service_ids" && Array.isArray(value)) {
      normalized[field] = [...value].map((item) => item.toLowerCase()).sort();
    } else if (
      typeof value === "string" &&
      (field === "title" || field === "category" || field === "symptom")
    ) {
      normalized[field] = normalizeRecommendationText(value);
    } else if (typeof value === "string") {
      normalized[field] = value.toLowerCase();
    }
  }
  return normalized as unknown as RecommendationContext;
}

export function recommendationContextHash(context: RecommendationContext) {
  const normalized = normalizeRecommendationContext(context);
  const equivalentContext = {
    description: normalized.description,
    category: normalized.category ?? null,
    symptom: normalized.symptom ?? null,
    service_id: normalized.service_id ?? null,
    service_ids: normalized.service_ids ?? [],
    software_product_id: normalized.software_product_id ?? null,
    platform_id: normalized.platform_id ?? null,
    service_environment_id: normalized.service_environment_id ?? null,
    problem_id: normalized.problem_id ?? null,
    known_error_id: normalized.known_error_id ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(equivalentContext))
    .digest("hex");
}

export function scoreKnowledgeRecommendation(input: {
  knowledgeId: string;
  context: RecommendationContext;
  applicability: RecommendationApplicability[];
  title: string;
  body: string;
  historicalSuccess: boolean;
}): { score: number; evidence: RecommendationEvidence[]; strong: boolean } {
  const evidence: RecommendationEvidence[] = [];
  const applicability = new Set(
    input.applicability.map((link) => `${link.type}:${link.id.toLowerCase()}`),
  );
  const context = input.context;
  const explicitBinding = context.knowledge_id?.toLowerCase();
  const exactKnownError = context.known_error_id?.toLowerCase();
  const problemId = context.problem_id?.toLowerCase();
  const bindingMatch = Boolean(
    explicitBinding && explicitBinding === input.knowledgeId.toLowerCase(),
  );
  const knownErrorMatch = Boolean(
    exactKnownError && applicability.has(`KNOWN_ERROR:${exactKnownError}`),
  );
  const exactStrong = bindingMatch || knownErrorMatch;
  if (bindingMatch)
    evidence.push({
      code: "EXPLICIT_KNOWLEDGE_BINDING",
      points: 60,
      reference: explicitBinding!,
    });
  else if (knownErrorMatch)
    evidence.push({
      code: "EXACT_KNOWN_ERROR",
      points: 60,
      reference: exactKnownError!,
    });

  const sameProblem = Boolean(
    (problemId &&
      (applicability.has(`PROBLEM:${problemId}`) ||
        applicability.has(`KNOWN_ERROR:${problemId}`))) ||
    (exactKnownError && applicability.has(`PROBLEM:${exactKnownError}`)),
  );
  if (sameProblem && !exactStrong)
    evidence.push({
      code: "SAME_PROBLEM_OR_KNOWN_ERROR",
      points: 50,
      ...((problemId ?? exactKnownError)
        ? { reference: problemId ?? exactKnownError! }
        : {}),
    });

  const serviceProductMatch = Boolean(
    (context.service_id &&
      applicability.has(`SERVICE:${context.service_id.toLowerCase()}`)) ||
    (context.service_ids ?? []).some((id) =>
      applicability.has(`SERVICE:${id.toLowerCase()}`),
    ) ||
    (context.software_product_id &&
      applicability.has(
        `SOFTWARE_PRODUCT:${context.software_product_id.toLowerCase()}`,
      )),
  );
  if (serviceProductMatch)
    evidence.push({ code: "SAME_CANONICAL_SERVICE_OR_PRODUCT", points: 20 });

  const platformMatch = Boolean(
    (context.platform_id &&
      applicability.has(`PLATFORM:${context.platform_id.toLowerCase()}`)) ||
    (context.service_environment_id &&
      applicability.has(
        `SERVICE_ENVIRONMENT:${context.service_environment_id.toLowerCase()}`,
      )),
  );
  if (platformMatch)
    evidence.push({
      code: "SAME_CANONICAL_PLATFORM_OR_ENVIRONMENT",
      points: 10,
    });

  const categories = [context.category, context.symptom]
    .filter((value): value is string => Boolean(value))
    .map(normalizeRecommendationText);
  const searchable = normalizeRecommendationText(
    `${input.title} ${input.body}`,
  );
  if (categories.some((category) => category && searchable.includes(category)))
    evidence.push({ code: "SAME_NORMALIZED_CATEGORY_OR_SYMPTOM", points: 15 });
  if (input.historicalSuccess)
    evidence.push({ code: "PRIOR_CONFIRMED_DEFLECTION_CONTEXT", points: 10 });

  const raw = evidence.reduce((sum, item) => sum + item.points, 0);
  return {
    score: Math.min(100, raw),
    evidence,
    strong: evidence.some((item) =>
      [
        "EXPLICIT_KNOWLEDGE_BINDING",
        "EXACT_KNOWN_ERROR",
        "SAME_PROBLEM_OR_KNOWN_ERROR",
      ].includes(item.code),
    ),
  };
}

export async function createRecommendationSession(input: {
  tx: Transaction;
  id: string;
  actorId: string;
  requestKey: string;
  correlationId: string;
  context: RecommendationContext;
  contextHash: string;
  activeRootIncidentId: string | null;
  outcome: "NO_RECOMMENDATION" | "PRESENTED";
  items: Array<{
    id: string;
    knowledgeId: string;
    knowledgeVersion: number;
    rank: number;
    score: number;
    evidence: RecommendationEvidence[];
    eligibilityReference: string;
    eligibilityEvidence: Record<string, unknown>;
  }>;
}) {
  const presentedAt =
    input.outcome === "PRESENTED" ? new Date().toISOString() : null;
  await input.tx.query(
    `INSERT INTO problem.knowledge_recommendation_sessions(
      id,tenant_id,actor_id,ticket_id,incident_id,active_root_incident_id,
       support_context,normalized_context_hash,profile_id,profile_version,outcome,
       started_pre_ticket,
       request_key,correlation_id,presented_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.id,
      input.tx.tenantId,
      input.actorId,
      input.context.ticket_id ?? null,
      input.context.incident_id ?? null,
      input.activeRootIncidentId,
      JSON.stringify({
        ...normalizeRecommendationContext(input.context),
        description: input.context.description,
        ...(input.context.title ? { title: input.context.title } : {}),
      }),
      input.contextHash,
      RECOMMENDATION_PROFILE_ID,
      RECOMMENDATION_PROFILE_VERSION,
      input.outcome,
      input.context.ticket_id == null,
      input.requestKey,
      input.correlationId,
      presentedAt,
    ],
  );
  for (const item of input.items)
    await input.tx.query(
      `INSERT INTO problem.knowledge_recommendation_items(
         id,tenant_id,session_id,knowledge_id,knowledge_version,rank,score,evidence,
         eligibility_reference,eligibility_evidence,presented_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        item.id,
        input.tx.tenantId,
        input.id,
        item.knowledgeId,
        item.knowledgeVersion,
        item.rank,
        item.score,
        JSON.stringify(item.evidence),
        item.eligibilityReference,
        JSON.stringify(item.eligibilityEvidence),
        presentedAt,
      ],
    );
  return {
    id: input.id,
    outcome: input.outcome,
    profile_id: RECOMMENDATION_PROFILE_ID,
    profile_version: RECOMMENDATION_PROFILE_VERSION,
    version: 1,
    presented_at: presentedAt,
  };
}

export async function readRecommendationSession(tx: Transaction, id: string) {
  const session = await tx.query<{
    id: string;
    tenant_id: string;
    actor_id: string;
    ticket_id: string | null;
    incident_id: string | null;
    active_root_incident_id: string | null;
    support_context: RecommendationContext;
    profile_id: string;
    profile_version: number;
    outcome: string;
    deflection_type: string | null;
    version: number;
    created_at: string;
    presented_at: string | null;
    resolved_at: string | null;
    escalated_at: string | null;
    correlation_id: string;
  }>(
    `SELECT id,tenant_id,actor_id,ticket_id,incident_id,active_root_incident_id,
       support_context,profile_id,profile_version,outcome,deflection_type,version,
       created_at,presented_at,resolved_at,escalated_at,correlation_id
       FROM problem.knowledge_recommendation_sessions WHERE tenant_id=$1 AND id=$2`,
    [tx.tenantId, id],
  );
  if (!session.rowCount) return null;
  const items = await tx.query<{
    id: string;
    knowledge_id: string;
    knowledge_version: number;
    rank: number;
    score: number;
    evidence: RecommendationEvidence[];
    eligibility_reference: string;
    eligibility_evidence: Record<string, unknown>;
    presented_at: string;
  }>(
    `SELECT id,knowledge_id,knowledge_version,rank,score,evidence,
       eligibility_reference,eligibility_evidence,presented_at FROM problem.knowledge_recommendation_items
      WHERE tenant_id=$1 AND session_id=$2 ORDER BY rank`,
    [tx.tenantId, id],
  );
  const interactions = await tx.query(
    `SELECT id,item_id,interaction_type,metadata,created_at FROM problem.knowledge_recommendation_interactions
      WHERE tenant_id=$1 AND session_id=$2 ORDER BY created_at,id`,
    [tx.tenantId, id],
  );
  return {
    ...session.rows[0],
    items: items.rows,
    interactions: interactions.rows,
  };
}

export async function lockRecommendationSession(tx: Transaction, id: string) {
  const result = await tx.query<{
    id: string;
    actor_id: string;
    ticket_id: string | null;
    incident_id: string | null;
    active_root_incident_id: string | null;
    support_context: RecommendationContext;
    normalized_context_hash: string;
    outcome: string;
    deflection_type: string | null;
    version: number;
  }>(
    `SELECT id,actor_id,ticket_id,incident_id,active_root_incident_id,
       support_context,normalized_context_hash,outcome,deflection_type,version
       FROM problem.knowledge_recommendation_sessions
      WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tx.tenantId, id],
  );
  return result.rows[0] ?? null;
}

export async function appendRecommendationInteraction(input: {
  tx: Transaction;
  sessionId: string;
  itemId?: string;
  actorId: string;
  interactionType:
    | "ARTICLE_SELECTED"
    | "HELPFUL"
    | "NOT_HELPFUL"
    | "ISSUE_RESOLVED"
    | "ESCALATED";
  idempotencyKey: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}) {
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        sessionId: input.sessionId,
        itemId: input.itemId ?? null,
        interactionType: input.interactionType,
        metadata: input.metadata ?? {},
      }),
    )
    .digest("hex");
  const prior = await input.tx.query<{ id: string; request_hash: string }>(
    `SELECT id,request_hash FROM problem.knowledge_recommendation_interactions
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
  if (input.interactionType === "ISSUE_RESOLVED") {
    const priorResolution = await input.tx.query<{
      id: string;
      request_hash: string;
    }>(
      `SELECT id,request_hash FROM problem.knowledge_recommendation_interactions
        WHERE tenant_id=$1 AND session_id=$2 AND interaction_type='ISSUE_RESOLVED'`,
      [input.tx.tenantId, input.sessionId],
    );
    if (priorResolution.rowCount) {
      if (priorResolution.rows[0]!.request_hash !== requestHash)
        throw new ApplicationError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "Resolution evidence already exists with different content.",
        );
      return { id: priorResolution.rows[0]!.id, replayed: true };
    }
  }
  const id = randomUUID();
  await input.tx.query(
    `INSERT INTO problem.knowledge_recommendation_interactions(
       id,tenant_id,session_id,item_id,actor_id,interaction_type,idempotency_key,
       request_hash,correlation_id,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      input.tx.tenantId,
      input.sessionId,
      input.itemId ?? null,
      input.actorId,
      input.interactionType,
      input.idempotencyKey,
      requestHash,
      input.correlationId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return { id, replayed: false };
}

export async function transitionRecommendationSession(input: {
  tx: Transaction;
  sessionId: string;
  expectedVersion: number;
  outcome: "USER_RESOLVED" | "NOT_HELPFUL" | "ESCALATED";
  deflectionType?: "KNOWLEDGE_RESOLUTION" | "KNOWN_INCIDENT_DEFLECTION";
  ticketId?: string;
}) {
  const row = await input.tx.query<{
    id: string;
    outcome: string;
    ticket_id: string | null;
    version: number;
  }>(
    `SELECT id,outcome,ticket_id,version FROM problem.knowledge_recommendation_sessions
      WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [input.tx.tenantId, input.sessionId],
  );
  if (!row.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Recommendation session was not found.",
    );
  const current = row.rows[0]!;
  assertVersion(current.version, input.expectedVersion);
  if (current.outcome === "USER_RESOLVED" || current.outcome === "ESCALATED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Recommendation session is already resolved or escalated.",
    );
  const resolvedAt =
    input.outcome === "USER_RESOLVED" ? new Date().toISOString() : null;
  const escalatedAt =
    input.outcome === "ESCALATED" ? new Date().toISOString() : null;
  await input.tx.query(
    `UPDATE problem.knowledge_recommendation_sessions
        SET outcome=$1,deflection_type=$2,ticket_id=coalesce($3,ticket_id),
            resolved_at=$4,escalated_at=$5,version=version+1
      WHERE tenant_id=$6 AND id=$7 AND version=$8`,
    [
      input.outcome,
      input.deflectionType ?? null,
      input.ticketId ?? null,
      resolvedAt,
      escalatedAt,
      input.tx.tenantId,
      input.sessionId,
      input.expectedVersion,
    ],
  );
  return {
    id: current.id,
    from_outcome: current.outcome,
    to_outcome: input.outcome,
    version: input.expectedVersion + 1,
  };
}

export async function readKnowledgeApplicabilityForRecommendation(
  tx: Transaction,
  id: string,
) {
  const result = await tx.query<{ target_type: string; target_id: string }>(
    `SELECT target_type,
        coalesce(service_id,platform_id,service_environment_id,software_product_id,problem_id)::text AS target_id
       FROM problem.knowledge_applicability
      WHERE tenant_id=$1 AND knowledge_id=$2`,
    [tx.tenantId, id],
  );
  return result.rows.map((row) => ({
    type: row.target_type,
    id: row.target_id,
  }));
}
