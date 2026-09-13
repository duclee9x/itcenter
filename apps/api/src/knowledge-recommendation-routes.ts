import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import type {
  CorrelationContext,
  Json,
} from "../../../packages/shared-kernel/src/index.js";
import type {
  UnitOfWork,
  Transaction,
} from "../../../packages/persistence/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  appendRecommendationInteraction,
  createRecommendationSession,
  lockRecommendationSession,
  readKnowledgeApplicabilityForRecommendation,
  readProblemRecommendationReference,
  readRecommendationSession,
  recommendationContextHash,
  RECOMMENDATION_MAX_ITEMS,
  RECOMMENDATION_MIN_SCORE,
  RECOMMENDATION_PROFILE_ID,
  RECOMMENDATION_PROFILE_VERSION,
  scoreKnowledgeRecommendation,
  queryKnowledgeRecommendationEligibility,
  transitionRecommendationSession,
  type RecommendationContext,
  type RecommendationEvidence,
} from "../../../modules/problem/index.js";
import { incidentRecommendationContextQuery } from "../../../modules/incident/index.js";
import {
  findKnowledgeRecommendationCandidates,
  exactCanonicalFallback,
  refreshSearchEntity,
  type SearchCandidate,
} from "../../../modules/search/index.js";
import {
  platformQueryPort,
  serviceEnvironmentQueryPort,
  serviceQueryPort,
} from "../../../modules/service/index.js";
import { readSoftwareProductReference } from "../../../modules/software/index.js";
import {
  createTicket,
  readTicketReference,
} from "../../../modules/ticket/index.js";
import { createTicketWorkItem } from "../../../modules/work-queue/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Body = Record<string, unknown>;
const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_SOURCE}$`, "i");
const CONTEXT_FIELDS = [
  "description",
  "title",
  "category",
  "symptom",
  "service_id",
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
] as const;

async function readBody(req: IncomingMessage): Promise<Body> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 32768)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
  }
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Body;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}

function onlyFields(body: Body, allowed: readonly string[]) {
  if (Object.keys(body).some((field) => !allowed.includes(field)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request has unsupported fields.",
    );
}

function requireIdempotencyKey(req: IncomingMessage) {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim() || key.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return key;
}

function contextFrom(body: unknown): RecommendationContext {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "support_context is required.",
    );
  const value = body as Body;
  onlyFields(value, CONTEXT_FIELDS);
  const description =
    typeof value.description === "string" ? value.description.trim() : "";
  if (!description || description.length > 8000)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A bounded issue description is required.",
    );
  const context: RecommendationContext = { description };
  for (const field of [
    "title",
    "category",
    "symptom",
    "ticket_code",
  ] as const) {
    const entry = value[field];
    if (entry !== undefined) {
      if (
        typeof entry !== "string" ||
        !entry.trim() ||
        entry.length > (field === "title" ? 200 : 500)
      )
        throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
      context[field] = entry.trim();
    }
  }
  for (const field of [
    "service_id",
    "software_product_id",
    "platform_id",
    "service_environment_id",
    "problem_id",
    "known_error_id",
    "knowledge_id",
    "incident_id",
    "ticket_id",
  ] as const) {
    const entry = value[field];
    if (entry !== undefined) {
      if (typeof entry !== "string" || !UUID.test(entry))
        throw new ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
      context[field] = entry;
    }
  }
  if (value.priority !== undefined) {
    if (
      typeof value.priority !== "string" ||
      !["P1", "P2", "P3", "P4"].includes(value.priority)
    )
      throw new ApplicationError("VALIDATION_ERROR", "priority is invalid.");
    context.priority = value.priority;
  }
  return context;
}

function resource(tenantId: string, type: string, id: string) {
  return { type, id, tenant_id: tenantId };
}

async function authorizeRecommendation(input: {
  authorization: AuthorizationPort;
  principal: Principal;
  action: string;
  resourceId: string;
  context: CorrelationContext;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: resource(
      input.principal.tenant_id,
      "knowledge_recommendation",
      input.resourceId,
    ),
    scope: {},
    context: { ...input.context },
  });
}

async function appendEvent(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: CorrelationContext;
  eventType: string;
  aggregateId: string;
  version: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}) {
  const eventId = randomUUID();
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: eventId,
    event_type: input.eventType,
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.config.serviceName, instance: "api" },
    aggregate: {
      type: "KNOWLEDGE_RECOMMENDATION_SESSION",
      id: input.aggregateId,
      version: input.version,
    },
    actor: { type: input.principal.actor_type, id: input.principal.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    tenant_id: input.principal.tenant_id,
    organization_id: input.principal.tenant_id,
    idempotency_key: input.idempotencyKey,
    payload: JSON.parse(JSON.stringify(input.payload)) as {
      [key: string]: Json;
    },
  });
  return { eventId, occurredAt: now };
}

async function validateContext(input: {
  tx: Transaction;
  principal: Principal;
  authorization: AuthorizationPort;
  context: CorrelationContext;
  support: RecommendationContext;
}) {
  const invalid = () =>
    new ApplicationError(
      "VALIDATION_ERROR",
      "Support context is invalid or unavailable.",
    );
  if (input.support.service_id) {
    const row = await serviceQueryPort(input.tx).get(
      input.tx.tenantId,
      input.support.service_id,
    );
    if (row?.state !== "ACTIVE") throw invalid();
  }
  if (input.support.platform_id) {
    const row = await platformQueryPort(input.tx).get(
      input.tx.tenantId,
      input.support.platform_id,
    );
    if (row?.state !== "ACTIVE") throw invalid();
  }
  if (input.support.service_environment_id) {
    const row = await serviceEnvironmentQueryPort(input.tx).get(
      input.tx.tenantId,
      input.support.service_environment_id,
    );
    if (row?.state !== "ACTIVE") throw invalid();
    const service = await serviceQueryPort(input.tx).get(
      input.tx.tenantId,
      row.service_id,
    );
    if (service?.state !== "ACTIVE") throw invalid();
  }
  if (input.support.software_product_id) {
    const row = await readSoftwareProductReference(
      input.tx,
      input.support.software_product_id,
    );
    if (!row) throw invalid();
  }
  if (input.support.problem_id) {
    const row = await readProblemRecommendationReference(
      input.tx,
      input.support.problem_id,
      "PROBLEM",
    );
    if (!row?.active) throw invalid();
  }
  if (input.support.known_error_id) {
    const row = await readProblemRecommendationReference(
      input.tx,
      input.support.known_error_id,
      "KNOWN_ERROR",
    );
    if (!row?.active) throw invalid();
  }
  if (input.support.ticket_id) {
    const ticket = await readTicketReference(input.tx, input.support.ticket_id);
    if (!ticket) throw invalid();
    if (ticket.requester_user_id !== input.principal.id) {
      await authorize(input.authorization, {
        principal: input.principal,
        action: "ticket.read",
        resource: resource(input.principal.tenant_id, "ticket", ticket.id),
        scope: {},
        context: { ...input.context },
      });
    }
  }
  if (input.support.incident_id) {
    await authorize(input.authorization, {
      principal: input.principal,
      action: "incident.read",
      resource: resource(
        input.principal.tenant_id,
        "incident",
        input.support.incident_id,
      ),
      scope: {},
      context: { ...input.context },
    });
  }
  const incidentQuery = incidentRecommendationContextQuery(input.tx);
  let activeRoot: { id: string; state: string } | null = null;
  let serviceIds: string[] = [];
  for (const ref of [
    ...(input.support.incident_id
      ? [{ incidentId: input.support.incident_id }]
      : []),
    ...(input.support.ticket_id ? [{ ticketId: input.support.ticket_id }] : []),
  ]) {
    const result = await incidentQuery.execute(ref);
    if (
      (ref.incidentId && !result) ||
      (ref.ticketId && !result && input.support.ticket_id)
    ) {
      if (ref.incidentId) throw invalid();
    }
    if (result) {
      if (result.active_root) activeRoot = result.active_root;
      serviceIds = [...new Set([...serviceIds, ...result.service_ids])];
    }
  }
  // Incident context may retain legacy service references. Only active
  // canonical Service ids are usable as recommendation evidence.
  const canonicalServiceIds: string[] = [];
  for (const id of serviceIds) {
    const service = await serviceQueryPort(input.tx).get(input.tx.tenantId, id);
    if (service?.state === "ACTIVE") canonicalServiceIds.push(id);
  }
  return { activeRoot, serviceIds: [...new Set(canonicalServiceIds)] };
}

function applicableRefs(context: RecommendationContext, serviceIds: string[]) {
  const refs: Array<{ type: string; id: string }> = [];
  const add = (type: string, id: string | undefined) => {
    if (id) refs.push({ type, id });
  };
  add("SERVICE", context.service_id);
  for (const id of serviceIds) add("SERVICE", id);
  add("SOFTWARE_PRODUCT", context.software_product_id);
  add("PLATFORM", context.platform_id);
  add("SERVICE_ENVIRONMENT", context.service_environment_id);
  add("PROBLEM", context.problem_id);
  add("KNOWN_ERROR", context.known_error_id);
  return refs;
}

async function activeApplicability(input: {
  tx: Transaction;
  links: Array<{ type: string; id: string }>;
}) {
  const active: Array<{ type: string; id: string }> = [];
  for (const link of input.links) {
    let isActive = false;
    if (link.type === "SERVICE") {
      isActive =
        (await serviceQueryPort(input.tx).get(input.tx.tenantId, link.id))
          ?.state === "ACTIVE";
    } else if (link.type === "PLATFORM") {
      isActive =
        (await platformQueryPort(input.tx).get(input.tx.tenantId, link.id))
          ?.state === "ACTIVE";
    } else if (link.type === "SERVICE_ENVIRONMENT") {
      const environment = await serviceEnvironmentQueryPort(input.tx).get(
        input.tx.tenantId,
        link.id,
      );
      if (environment?.state === "ACTIVE") {
        isActive =
          (
            await serviceQueryPort(input.tx).get(
              input.tx.tenantId,
              environment.service_id,
            )
          )?.state === "ACTIVE";
      }
    } else if (link.type === "SOFTWARE_PRODUCT") {
      isActive = Boolean(
        (await readSoftwareProductReference(input.tx, link.id))?.active,
      );
    } else if (link.type === "PROBLEM" || link.type === "KNOWN_ERROR") {
      isActive = Boolean(
        (await readProblemRecommendationReference(input.tx, link.id, link.type))
          ?.active,
      );
    }
    if (isActive) active.push(link);
  }
  return active;
}

async function discoverCandidates(input: {
  uow: UnitOfWork;
  tenantId: string;
  support: RecommendationContext;
  serviceIds: string[];
}) {
  const q =
    input.support.category ??
    input.support.symptom ??
    input.support.description;
  try {
    return await input.uow.run(input.tenantId, (tx) =>
      findKnowledgeRecommendationCandidates({
        tx,
        q,
        applicability: applicableRefs(input.support, input.serviceIds),
        ...(input.support.knowledge_id
          ? { knowledgeId: input.support.knowledge_id }
          : {}),
        limit: 250,
      }),
    );
  } catch {
    // A failed PostgreSQL transaction cannot safely be reused for fallback.
    // TASK-061 explicitly permits exact canonical fallback; otherwise fail
    // closed as NO_RECOMMENDATION.
    try {
      return await input.uow.run(input.tenantId, (tx) =>
        exactCanonicalFallback({ tx, q, types: ["KNOWLEDGE"] }),
      );
    } catch {
      return [];
    }
  }
}

async function presentableItems(input: {
  tx: Transaction;
  principal: Principal;
  authorization: AuthorizationPort;
  context: CorrelationContext;
  candidates: SearchCandidate[];
  support: RecommendationContext;
  serviceIds: string[];
}) {
  const support = { ...input.support, service_ids: input.serviceIds };
  const contextHash = recommendationContextHash(support);
  const result: Array<{
    knowledgeId: string;
    version: number;
    score: number;
    searchScore: number;
    evidence: RecommendationEvidence[];
    eligibilityReference: string;
    eligibilityEvidence: Record<string, unknown>;
    title: string;
    body: string;
  }> = [];
  for (const candidate of input.candidates) {
    const version = candidate.filter_fields.version;
    if (!Number.isSafeInteger(version)) continue;
    const eligible = await queryKnowledgeRecommendationEligibility({
      tx: input.tx,
      authorization: input.authorization,
      principal: input.principal,
      context: input.context,
      knowledgeId: candidate.entity_id,
      knowledgeVersion: Number(version),
    });
    if (!eligible.eligible) continue;
    const storedLinks = await readKnowledgeApplicabilityForRecommendation(
      input.tx,
      candidate.entity_id,
    );
    const links = await activeApplicability({
      tx: input.tx,
      links: storedLinks,
    });
    const history = await input.tx.query(
      `SELECT 1 FROM problem.knowledge_recommendation_sessions
        WHERE tenant_id=$1 AND normalized_context_hash=$2 AND outcome='USER_RESOLVED'
          AND ticket_id IS NULL LIMIT 1`,
      [input.tx.tenantId, contextHash],
    );
    const scoring = scoreKnowledgeRecommendation({
      knowledgeId: candidate.entity_id,
      context: support,
      applicability: links,
      title: eligible.title,
      body: eligible.body,
      historicalSuccess: Boolean(history.rowCount),
    });
    if (scoring.score < RECOMMENDATION_MIN_SCORE) continue;
    const eligibilityReference = randomUUID();
    result.push({
      knowledgeId: candidate.entity_id,
      version: eligible.version,
      score: scoring.score,
      searchScore: candidate.score,
      evidence: scoring.evidence,
      eligibilityReference,
      eligibilityEvidence: {
        decision_reference: eligibilityReference,
        decision: "ALLOW",
        permission: "knowledge.read",
        knowledge_id: eligible.knowledge_id,
        knowledge_version: eligible.version,
        state: eligible.state,
        audience: eligible.audience,
        checked_at: new Date().toISOString(),
      },
      title: eligible.title,
      body: eligible.body,
    });
  }
  return result
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.searchScore - a.searchScore ||
        a.knowledgeId.localeCompare(b.knowledgeId),
    )
    .slice(0, RECOMMENDATION_MAX_ITEMS);
}

async function sessionResponse(input: {
  tx: Transaction;
  sessionId: string;
  principal: Principal;
  authorization: AuthorizationPort;
  context: CorrelationContext;
}) {
  const session = await readRecommendationSession(input.tx, input.sessionId);
  if (!session)
    throw new ApplicationError(
      "NOT_FOUND",
      "Recommendation session was not found.",
    );
  const owns = session.actor_id === input.principal.id;
  await authorizeRecommendation({
    authorization: input.authorization,
    principal: input.principal,
    action: owns
      ? "knowledge.recommendation.use"
      : "knowledge.recommendation.review",
    resourceId: input.sessionId,
    context: input.context,
  });
  const recommendations: Array<Record<string, unknown>> = [];
  for (const item of session.items as Array<{
    id: string;
    knowledge_id: string;
    knowledge_version: number;
    rank: number;
    score: number;
    evidence: RecommendationEvidence[];
    eligibility_reference: string;
    eligibility_evidence: Record<string, unknown>;
    presented_at: string;
  }>) {
    const current = await queryKnowledgeRecommendationEligibility({
      tx: input.tx,
      authorization: input.authorization,
      principal: input.principal,
      context: input.context,
      knowledgeId: item.knowledge_id,
      knowledgeVersion: item.knowledge_version,
    });
    if (!current.eligible) continue;
    recommendations.push({
      item_id: item.id,
      knowledge_id: item.knowledge_id,
      knowledge_version: item.knowledge_version,
      rank: item.rank,
      score: item.score,
      evidence: item.evidence,
      eligibility_reference: item.eligibility_reference,
      eligibility_evidence: item.eligibility_evidence,
      presented_at: item.presented_at,
      title: current.title,
      body: current.body,
    });
  }
  const visibleItemIds = new Set(recommendations.map((item) => item.item_id));
  const interactions = (
    session.interactions as Array<Record<string, unknown>>
  ).filter(
    (interaction) =>
      !interaction.item_id || visibleItemIds.has(interaction.item_id),
  );
  const sessionData: Record<string, unknown> = { ...session };
  delete sessionData.items;
  return {
    ...sessionData,
    ...(owns
      ? {}
      : {
          support_context: {
            ...session.support_context,
            knowledge_id: undefined,
          },
        }),
    interactions,
    recommendations,
  };
}

async function appendTimeline(input: {
  tx: Transaction;
  sessionId: string;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
  eventId: string;
}) {
  await input.tx.query(
    `INSERT INTO operations.timeline_events(id,tenant_id,entity_type,entity_id,event_type,summary,payload,source_event_id)
     VALUES($1,$2,'KNOWLEDGE_RECOMMENDATION_SESSION',$3,$4,$5,$6,$7)
     ON CONFLICT(tenant_id,source_event_id) DO NOTHING`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.sessionId,
      input.eventType,
      input.summary,
      JSON.stringify(input.payload),
      input.eventId,
    ],
  );
}

export async function handleKnowledgeRecommendationRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}): Promise<boolean> {
  const path = new URL(input.req.url ?? "", "http://localhost").pathname;
  const collection = "/api/v1/knowledge/recommendation-sessions";
  const sessionMatch = new RegExp(`^${collection}/(${UUID_SOURCE})$`, "i").exec(
    path,
  );
  const commandMatch = new RegExp(
    `^${collection}/(${UUID_SOURCE})/commands/(select|feedback|confirm-resolution|escalate)$`,
    "i",
  ).exec(path);
  if (
    !(input.req.method === "POST" && path === collection) &&
    !(input.req.method === "GET" && sessionMatch) &&
    !(input.req.method === "POST" && commandMatch)
  )
    return false;

  const principal = await authenticate(
    input.authentication,
    input.req.headers.authorization,
  );
  if (input.req.method === "POST" && path === collection) {
    const body = await readBody(input.req);
    onlyFields(body, ["support_context"]);
    const support = contextFrom(body.support_context);
    const key = requireIdempotencyKey(input.req);
    await authorizeRecommendation({
      authorization: input.authorization,
      principal,
      action: "knowledge.recommendation.use",
      resourceId: "tenant-request",
      context: input.context,
    });
    const idemIntent = {
      principalId: principal.id,
      operation: "KNOWLEDGE.RECOMMEND",
      businessScope: "tenant",
      key,
      semanticRequest: body as never,
      expiresAt: new Date(Date.now() + 86400000),
    };
    const prior = await input.uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).findPrevious(idemIntent),
    );
    if (prior) {
      const resultSessionId = String(
        (prior.body as { session_id: string }).session_id,
      );
      const result = await input.uow.run(principal.tenant_id, (tx) =>
        sessionResponse({
          tx,
          sessionId: resultSessionId,
          principal,
          authorization: input.authorization,
          context: input.context,
        }),
      );
      json(input.res, prior.status, { data: result, meta: input.context });
      return true;
    }
    const contextInfo = await input.uow.run(principal.tenant_id, (tx) =>
      validateContext({
        tx,
        principal,
        authorization: input.authorization,
        context: input.context,
        support,
      }),
    );
    const candidates = await discoverCandidates({
      uow: input.uow,
      tenantId: principal.tenant_id,
      support,
      serviceIds: contextInfo.serviceIds,
    });
    const sessionId = randomUUID();
    const stored = await input.uow.run(principal.tenant_id, async (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          ...idemIntent,
        },
        async () => {
          const items = await presentableItems({
            tx,
            principal,
            authorization: input.authorization,
            context: input.context,
            candidates,
            support,
            serviceIds: contextInfo.serviceIds,
          });
          const outcome = items.length ? "PRESENTED" : "NO_RECOMMENDATION";
          const idempotencySessionKey = `SESSION_CREATE:${key}`;
          const persistedItems = items.map((item, index) => ({
            id: randomUUID(),
            knowledgeId: item.knowledgeId,
            knowledgeVersion: item.version,
            rank: index + 1,
            score: item.score,
            evidence: item.evidence,
            eligibilityReference: item.eligibilityReference,
            eligibilityEvidence: item.eligibilityEvidence,
          }));
          await createRecommendationSession({
            tx,
            id: sessionId,
            actorId: principal.id,
            requestKey: idempotencySessionKey,
            correlationId: input.context.correlation_id,
            context: { ...support, service_ids: contextInfo.serviceIds },
            contextHash: recommendationContextHash({
              ...support,
              service_ids: contextInfo.serviceIds,
            }),
            activeRootIncidentId: contextInfo.activeRoot?.id ?? null,
            outcome,
            items: persistedItems,
          });
          const created = await appendEvent({
            tx,
            config: input.config,
            principal,
            context: input.context,
            eventType: "KNOWLEDGE.RECOMMENDATION_CREATED",
            aggregateId: sessionId,
            version: 1,
            idempotencyKey: key,
            payload: {
              session_id: sessionId,
              profile_id: RECOMMENDATION_PROFILE_ID,
              profile_version: RECOMMENDATION_PROFILE_VERSION,
              outcome,
            },
          });
          if (items.length) {
            const event = await appendEvent({
              tx,
              config: input.config,
              principal,
              context: input.context,
              eventType: "KNOWLEDGE.RECOMMENDATION_PRESENTED",
              aggregateId: sessionId,
              version: 1,
              idempotencyKey: key,
              payload: {
                session_id: sessionId,
                profile_id: RECOMMENDATION_PROFILE_ID,
                profile_version: RECOMMENDATION_PROFILE_VERSION,
                items: persistedItems.map((item) => ({
                  item_id: item.id,
                  knowledge_id: item.knowledgeId,
                  knowledge_version: item.knowledgeVersion,
                  rank: item.rank,
                  score: item.score,
                })),
              },
            });
            await appendTimeline({
              tx,
              sessionId,
              eventType: "KNOWLEDGE.RECOMMENDATION_PRESENTED",
              summary: "Self-service recommendation presented",
              payload: { session_id: sessionId, item_count: items.length },
              eventId: event.eventId,
            });
          } else {
            await appendTimeline({
              tx,
              sessionId,
              eventType: "KNOWLEDGE.RECOMMENDATION_CREATED",
              summary: "Self-service recommendation attempted",
              payload: { session_id: sessionId, outcome },
              eventId: created.eventId,
            });
          }
          return { status: 201, body: { session_id: sessionId } as Json };
        },
      ),
    );
    const resultSessionId = String(
      (stored.body as { session_id: string }).session_id,
    );
    const result = await input.uow.run(principal.tenant_id, (tx) =>
      sessionResponse({
        tx,
        sessionId: resultSessionId,
        principal,
        authorization: input.authorization,
        context: input.context,
      }),
    );
    json(input.res, stored.status, { data: result, meta: input.context });
    return true;
  }

  if (sessionMatch) {
    const sessionId = sessionMatch[1]!;
    const result = await input.uow.run(principal.tenant_id, (tx) =>
      sessionResponse({
        tx,
        sessionId,
        principal,
        authorization: input.authorization,
        context: input.context,
      }),
    );
    json(input.res, 200, { data: result, meta: input.context });
    return true;
  }

  const sessionId = commandMatch![1]!;
  const command = commandMatch![2]!;
  const body = await readBody(input.req);
  const key = requireIdempotencyKey(input.req);
  const allowedBody =
    command === "select"
      ? ["item_id", "expected_version"]
      : command === "feedback"
        ? ["item_id", "feedback", "expected_version"]
        : ["expected_version"];
  onlyFields(body, allowedBody);
  if (
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version is required.",
    );
  const expectedVersion = Number(body.expected_version);
  const itemId =
    typeof body.item_id === "string" && UUID.test(body.item_id)
      ? body.item_id
      : undefined;
  if ((command === "select" || command === "feedback") && !itemId)
    throw new ApplicationError("VALIDATION_ERROR", "item_id is required.");
  const feedback = body.feedback;
  if (
    command === "feedback" &&
    !["HELPFUL", "NOT_HELPFUL"].includes(String(feedback))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "feedback must be HELPFUL or NOT_HELPFUL.",
    );
  await authorizeRecommendation({
    authorization: input.authorization,
    principal,
    action:
      command === "select"
        ? "knowledge.recommendation.use"
        : command === "feedback" || command === "confirm-resolution"
          ? "knowledge.feedback.submit"
          : "knowledge.recommendation.use",
    resourceId: sessionId,
    context: input.context,
  });
  if (command === "escalate")
    await authorize(input.authorization, {
      principal,
      action: "ticket.create",
      resource: resource(principal.tenant_id, "ticket", principal.id),
      scope: {},
      context: { ...input.context },
    });

  const response = await input.uow.run(principal.tenant_id, async (tx) => {
    const operation =
      command === "select"
        ? "KNOWLEDGE.RECOMMENDATION_SELECT"
        : command === "feedback"
          ? "KNOWLEDGE.RECOMMENDATION_FEEDBACK"
          : command === "confirm-resolution"
            ? "KNOWLEDGE.DEFLECTION_CONFIRM"
            : "KNOWLEDGE.RECOMMENDATION_ESCALATE";
    return new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation,
        businessScope: sessionId,
        key,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        const session = await lockRecommendationSession(tx, sessionId);
        if (!session)
          throw new ApplicationError(
            "NOT_FOUND",
            "Recommendation session was not found.",
          );
        if (session.actor_id !== principal.id)
          throw new ApplicationError(
            "NOT_FOUND",
            "Recommendation session was not found.",
          );
        assertVersion(session.version, expectedVersion);
        let interactionType:
          | "ARTICLE_SELECTED"
          | "HELPFUL"
          | "NOT_HELPFUL"
          | "ISSUE_RESOLVED"
          | "ESCALATED";
        let eventType: string;
        let payload: Record<string, unknown>;
        let responseBody: Record<string, unknown>;
        let nextVersion = session.version;

        if (command === "select" || command === "feedback") {
          const item = await tx.query<{
            knowledge_id: string;
            knowledge_version: number;
          }>(
            `SELECT knowledge_id,knowledge_version FROM problem.knowledge_recommendation_items
            WHERE tenant_id=$1 AND session_id=$2 AND id=$3`,
            [tx.tenantId, sessionId, itemId],
          );
          if (!item.rowCount)
            throw new ApplicationError(
              "NOT_FOUND",
              "Recommendation item was not found.",
            );
          const eligibility = await queryKnowledgeRecommendationEligibility({
            tx,
            authorization: input.authorization,
            principal,
            context: input.context,
            knowledgeId: item.rows[0]!.knowledge_id,
            knowledgeVersion: item.rows[0]!.knowledge_version,
          });
          if (!eligibility.eligible)
            throw new ApplicationError(
              "NOT_FOUND",
              "Recommendation item was not found.",
            );
          if (command === "select") {
            if (!["PRESENTED", "NOT_HELPFUL"].includes(session.outcome))
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Recommendation session no longer accepts article selection.",
              );
            interactionType = "ARTICLE_SELECTED";
            eventType = "KNOWLEDGE.RECOMMENDATION_SELECTED";
            payload = {
              session_id: sessionId,
              item_id: itemId,
              knowledge_id: item.rows[0]!.knowledge_id,
              knowledge_version: item.rows[0]!.knowledge_version,
            };
            responseBody = {
              session_id: sessionId,
              item_id: itemId,
              interaction: interactionType,
              outcome: session.outcome,
              version: session.version,
            };
          } else {
            if (["USER_RESOLVED", "ESCALATED"].includes(session.outcome))
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Recommendation session is terminal.",
              );
            interactionType =
              feedback === "HELPFUL" ? "HELPFUL" : "NOT_HELPFUL";
            if (interactionType === "NOT_HELPFUL") {
              const transition = await transitionRecommendationSession({
                tx,
                sessionId,
                expectedVersion,
                outcome: "NOT_HELPFUL",
              });
              nextVersion = transition.version;
            }
            eventType = "KNOWLEDGE.RECOMMENDATION_FEEDBACK";
            payload = {
              session_id: sessionId,
              item_id: itemId,
              feedback: interactionType,
            };
            responseBody = {
              session_id: sessionId,
              item_id: itemId,
              feedback: interactionType,
              outcome:
                interactionType === "NOT_HELPFUL"
                  ? "NOT_HELPFUL"
                  : session.outcome,
              version: nextVersion,
            };
          }
          const interaction = await appendRecommendationInteraction({
            tx,
            sessionId,
            ...(itemId ? { itemId } : {}),
            actorId: principal.id,
            interactionType,
            idempotencyKey: `${operation}:${key}`,
            correlationId: input.context.correlation_id,
          });
          await appendEvent({
            tx,
            config: input.config,
            principal,
            context: input.context,
            eventType,
            aggregateId: sessionId,
            version: nextVersion,
            idempotencyKey: key,
            payload: { ...payload, interaction_id: interaction.id },
          });
          return { status: 200, body: responseBody as Json };
        }

        if (command === "confirm-resolution") {
          if (session.outcome === "USER_RESOLVED")
            return {
              status: 200,
              body: {
                session_id: sessionId,
                outcome: "USER_RESOLVED",
                version: session.version,
              } as Json,
            };
          const presented = await tx.query<{
            id: string;
            knowledge_id: string;
            knowledge_version: number;
          }>(
            `SELECT id,knowledge_id,knowledge_version
               FROM problem.knowledge_recommendation_items
              WHERE tenant_id=$1 AND session_id=$2 ORDER BY rank`,
            [tx.tenantId, sessionId],
          );
          if (!presented.rowCount)
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "A recommendation must have been presented before resolution can be confirmed.",
            );
          const interaction = await appendRecommendationInteraction({
            tx,
            sessionId,
            actorId: principal.id,
            interactionType: "ISSUE_RESOLVED",
            idempotencyKey: `${operation}:${key}`,
            correlationId: input.context.correlation_id,
          });
          if (session.outcome === "ESCALATED") {
            if (!interaction.replayed)
              await appendEvent({
                tx,
                config: input.config,
                principal,
                context: input.context,
                eventType: "KNOWLEDGE.RECOMMENDATION_FEEDBACK",
                aggregateId: sessionId,
                version: session.version,
                idempotencyKey: key,
                payload: {
                  session_id: sessionId,
                  interaction_id: interaction.id,
                  feedback: "ISSUE_RESOLVED",
                  after_escalation: true,
                  ticket_id: session.ticket_id,
                },
              });
            return {
              status: 200,
              body: {
                session_id: sessionId,
                outcome: "ESCALATED",
                issue_resolved_after_escalation: true,
                ticket_id: session.ticket_id,
                version: session.version,
              } as Json,
            };
          }
          const type = session.active_root_incident_id
            ? "KNOWN_INCIDENT_DEFLECTION"
            : "KNOWLEDGE_RESOLUTION";
          const transition = await transitionRecommendationSession({
            tx,
            sessionId,
            expectedVersion,
            outcome: "USER_RESOLVED",
            ...(session.ticket_id ? {} : { deflectionType: type }),
          });
          const event = await appendEvent({
            tx,
            config: input.config,
            principal,
            context: input.context,
            eventType: "KNOWLEDGE.DEFLECTION_CONFIRMED",
            aggregateId: sessionId,
            version: transition.version,
            idempotencyKey: key,
            payload: {
              session_id: sessionId,
              interaction_id: interaction.id,
              deflection_type: session.ticket_id ? null : type,
              ticket_id: session.ticket_id,
              items: presented.rows.map((item) => ({
                item_id: item.id,
                knowledge_id: item.knowledge_id,
                knowledge_version: item.knowledge_version,
              })),
            },
          });
          if (!session.ticket_id) {
            await appendTimeline({
              tx,
              sessionId,
              eventType: "KNOWLEDGE.DEFLECTION_CONFIRMED",
              summary: "Self-service resolution confirmed",
              payload: { session_id: sessionId, deflection_type: type },
              eventId: event.eventId,
            });
            if (type === "KNOWN_INCIDENT_DEFLECTION") {
              await appendEvent({
                tx,
                config: input.config,
                principal,
                context: input.context,
                eventType: "KNOWLEDGE.KNOWN_INCIDENT_DEFLECTION_CONFIRMED",
                aggregateId: sessionId,
                version: transition.version,
                idempotencyKey: key,
                payload: {
                  session_id: sessionId,
                  root_incident_id: session.active_root_incident_id,
                  interaction_id: interaction.id,
                  items: presented.rows.map((item) => ({
                    knowledge_id: item.knowledge_id,
                    knowledge_version: item.knowledge_version,
                  })),
                },
              });
            }
          }
          return {
            status: 200,
            body: {
              session_id: sessionId,
              outcome: "USER_RESOLVED",
              deflection_type: session.ticket_id ? null : type,
              ticket_id: session.ticket_id,
              version: transition.version,
            } as Json,
          };
        }

        if (session.outcome === "ESCALATED")
          return {
            status: 200,
            body: {
              session_id: sessionId,
              outcome: "ESCALATED",
              ticket_id: session.ticket_id,
              version: session.version,
            } as Json,
          };
        if (session.outcome === "USER_RESOLVED")
          throw new ApplicationError(
            "BUSINESS_RULE_VIOLATION",
            "A resolved session cannot be escalated.",
          );
        let ticketId = session.ticket_id;
        let ticket: {
          id: string;
          ticket_code: string;
          state: string;
          version: number;
        } | null = null;
        if (!ticketId) {
          const support = session.support_context;
          await authorize(input.authorization, {
            principal,
            action: "ticket.create",
            resource: resource(principal.tenant_id, "ticket", principal.id),
            scope: {},
            context: { ...input.context },
          });
          const code = support.ticket_code ?? `KS-${sessionId}`;
          const title = support.title ?? support.description.slice(0, 120);
          const priority = support.priority ?? "P3";
          ticket = await createTicket({
            tx,
            ticketCode: code,
            title,
            description: support.description,
            requesterUserId: principal.id,
            priority,
            sourceChannel: "PORTAL",
            sourceContext: {
              type: "KNOWLEDGE_RECOMMENDATION",
              referenceId: sessionId,
            },
          });
          ticketId = ticket.id;
          const workItem = await createTicketWorkItem({
            tx,
            ticketId,
            title,
            priority,
          });
          const eventId = randomUUID();
          const now = new Date().toISOString();
          await new PostgresOutboxWriter(tx).append({
            event_id: eventId,
            event_type: "WORK_ITEM.CREATED",
            schema_version: 1,
            occurred_at: now,
            producer: { service: input.config.serviceName, instance: "api" },
            aggregate: {
              type: "WORK_ITEM",
              id: workItem.id,
              version: workItem.version,
            },
            actor: { type: principal.actor_type, id: principal.id },
            correlation_id: input.context.correlation_id,
            causation_id: input.context.causation_id,
            tenant_id: principal.tenant_id,
            organization_id: principal.tenant_id,
            idempotency_key: key,
            payload: JSON.parse(JSON.stringify(workItem)) as {
              [key: string]: Json;
            },
          });
          await tx.query(
            `INSERT INTO operations.timeline_events(id,tenant_id,entity_type,entity_id,event_type,summary,payload,source_event_id)
           VALUES($1,$2,'TICKET',$3,'TICKET.CREATED',$4,$5,$6) ON CONFLICT(tenant_id,source_event_id) DO NOTHING`,
            [
              randomUUID(),
              principal.tenant_id,
              ticket.id,
              `Ticket ${ticket.ticket_code} created`,
              JSON.stringify(ticket),
              eventId,
            ],
          );
          await refreshSearchEntity(tx, "TICKET", ticket.id);
          await new PostgresOutboxWriter(tx).append({
            event_id: randomUUID(),
            event_type: "TICKET.CREATED",
            schema_version: 1,
            occurred_at: now,
            producer: { service: input.config.serviceName, instance: "api" },
            aggregate: {
              type: "TICKET",
              id: ticket.id,
              version: ticket.version,
            },
            actor: { type: principal.actor_type, id: principal.id },
            correlation_id: input.context.correlation_id,
            causation_id: input.context.causation_id,
            tenant_id: principal.tenant_id,
            organization_id: principal.tenant_id,
            idempotency_key: key,
            payload: JSON.parse(JSON.stringify(ticket)) as {
              [key: string]: Json;
            },
          });
          await new PostgresAudit(tx).append({
            id: randomUUID(),
            tenant_id: principal.tenant_id,
            event_type: "TICKET.CREATED",
            occurred_at: now,
            actor: { type: principal.actor_type, id: principal.id },
            action: { command_type: "TICKET.CREATE" },
            subject: { entity_type: "TICKET", entity_id: ticket.id },
            correlation_id: input.context.correlation_id,
            causation_id: input.context.causation_id,
            reason: {
              code: "SELF_SERVICE_ESCALATION",
              text: "Ticket created after unsuccessful self-service",
            },
            before: null,
            after: ticket as unknown as Json,
            outcome: { status: "SUCCESS" },
            classification: "INTERNAL",
            relations: [],
            evidence: [],
          });
        }
        const interaction = await appendRecommendationInteraction({
          tx,
          sessionId,
          actorId: principal.id,
          interactionType: "ESCALATED",
          idempotencyKey: `${operation}:${key}`,
          correlationId: input.context.correlation_id,
          metadata: { ticket_id: ticketId },
        });
        const transition = await transitionRecommendationSession({
          tx,
          sessionId,
          expectedVersion,
          outcome: "ESCALATED",
          ticketId,
        });
        const event = await appendEvent({
          tx,
          config: input.config,
          principal,
          context: input.context,
          eventType: "KNOWLEDGE.RECOMMENDATION_ESCALATED",
          aggregateId: sessionId,
          version: transition.version,
          idempotencyKey: key,
          payload: {
            session_id: sessionId,
            ticket_id: ticketId,
            interaction_id: interaction.id,
            handoff_outcome: "TICKET_CREATED_OR_LINKED",
          },
        });
        await appendTimeline({
          tx,
          sessionId,
          eventType: "KNOWLEDGE.RECOMMENDATION_ESCALATED",
          summary: "Self-service escalated to Ticket intake",
          payload: { session_id: sessionId, ticket_id: ticketId },
          eventId: event.eventId,
        });
        return {
          status: 201,
          body: {
            session_id: sessionId,
            outcome: "ESCALATED",
            ticket_id: ticketId,
            ...(ticket ? { ticket } : {}),
            version: transition.version,
          } as Json,
        };
      },
    );
  });
  json(input.res, response.status, {
    data: response.body,
    meta: input.context,
  });
  return true;
}
