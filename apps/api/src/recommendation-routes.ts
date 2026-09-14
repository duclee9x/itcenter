import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { json } from "../../../packages/observability/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import { readRecommendationSession } from "../../../modules/problem/index.js";
import {
  RECOMMENDATION_FAMILIES,
  availableSourceAction,
  readRecommendationById,
  readRecommendationFamily,
  readRecommendationRevisions,
  recommendationGenerationKey,
  recordRecommendationInteraction,
  queryCurrentRecommendationFamilySources,
  type RecommendationContextType,
  type RecommendationFamily,
  type RecommendationInteractionType,
  type RecommendationSource,
  type RecommendationState,
} from "../../../modules/recommendation/index.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CONTEXT_TYPES = [
  "INCIDENT",
  "TICKET",
  "RECOMMENDATION_SESSION",
  "ASSET",
] as const;
const STATES = [
  "ACTIVE",
  "SUPERSEDED",
  "RESOLVED_BY_SOURCE",
  "EXPIRED",
] as const;
const FAMILY_ORDER = new Map(
  RECOMMENDATION_FAMILIES.map((family, index) => [family, index]),
);

function contextFilter(url: URL) {
  const type = url.searchParams.get("context_type");
  const id = url.searchParams.get("context_id");
  if ((type === null) !== (id === null))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "context_type and context_id must be supplied together.",
    );
  if (type === null) return undefined;
  if (!(CONTEXT_TYPES as readonly string[]).includes(type) || !UUID.test(id!))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Canonical recommendation context is invalid.",
    );
  return { type: type as RecommendationContextType, id: id! };
}

function strictQuery(url: URL, allowed: readonly string[]) {
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `Unsupported recommendation query parameter: ${key}.`,
      );
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 16_384)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}

function familyValue(value: string | null): RecommendationFamily | undefined {
  if (value === null) return undefined;
  if (!(RECOMMENDATION_FAMILIES as readonly string[]).includes(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unknown recommendation family.",
    );
  return value as RecommendationFamily;
}

async function requirePermission(input: {
  principal: Principal;
  authorization: AuthorizationPort;
  action: "recommendation.read" | "recommendation.interact";
  context: CorrelationContext;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: {
      type: "recommendation",
      id: "feed",
      tenant_id: input.principal.tenant_id,
    },
    scope: { tenant: input.principal.tenant_id },
    context: { ...input.context },
  });
}

async function readCurrentSources(input: {
  tx: Transaction;
  family: RecommendationFamily;
  principal: Principal;
  authorization: AuthorizationPort;
  context: CorrelationContext;
  sourceContext?: { type: RecommendationContextType; id: string };
}) {
  try {
    return await queryCurrentRecommendationFamilySources({
      tx: input.tx,
      family: input.family,
      principal: input.principal,
      authorization: input.authorization,
      correlation: input.context,
      ...(input.sourceContext ? { context: input.sourceContext } : {}),
    });
  } catch (error) {
    return {
      availability: "SOURCE_UNAVAILABLE" as const,
      sources: [] as RecommendationSource[],
      reason:
        error instanceof ApplicationError && error.code === "PERMISSION_DENIED"
          ? "SOURCE_ACCESS_DENIED"
          : "SOURCE_QUERY_FAILED",
    };
  }
}

async function familyPage(input: {
  tx: Transaction;
  family: RecommendationFamily;
  principal: Principal;
  authorization: AuthorizationPort;
  context: CorrelationContext;
  sourceContext?: { type: RecommendationContextType; id: string };
  requestedState?: RecommendationState;
}) {
  if (input.requestedState && input.requestedState !== "ACTIVE") {
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; ;) {
      const page = (await readRecommendationFamily({
        tx: input.tx,
        family: input.family,
        actorId: input.principal.id,
        state: input.requestedState,
        ...(input.sourceContext
          ? {
              contextType: input.sourceContext.type,
              contextId: input.sourceContext.id,
            }
          : {}),
        offset,
        limit: 200,
      })) as Array<Record<string, unknown>>;
      for (const row of page.slice(0, 200)) {
        try {
          await authorizeStoredSource({
            tx: input.tx,
            row,
            principal: input.principal,
            authorization: input.authorization,
            context: input.context,
          });
          rows.push(row);
        } catch (error) {
          if (
            !(error instanceof ApplicationError) ||
            error.code !== "PERMISSION_DENIED"
          )
            throw error;
        }
      }
      if (page.length <= 200) break;
      offset += 200;
    }
    return {
      availability: rows.length
        ? ("AVAILABLE" as const)
        : ("AVAILABLE_EMPTY" as const),
      data: rows,
    };
  }
  const source = await readCurrentSources(input);
  if (source.availability === "SOURCE_UNAVAILABLE")
    return {
      availability: source.availability,
      reason: "reason" in source ? source.reason : "SOURCE_QUERY_FAILED",
      data: [] as unknown[],
    };
  const eligibleSources = input.sourceContext
    ? source.sources.filter((item) =>
        item.contexts.some(
          (context) =>
            context.type === input.sourceContext!.type &&
            context.id === input.sourceContext!.id,
        ),
      )
    : source.sources;
  if (!eligibleSources.length)
    return { availability: "AVAILABLE_EMPTY" as const, data: [] as unknown[] };

  const expected = new Map(
    eligibleSources.map((item) => [
      item.source_id,
      recommendationGenerationKey(item.generation),
    ]),
  );
  const rows: Array<Record<string, unknown>> = [];
  const projected = new Set<string>();
  for (let offset = 0; ;) {
    const page = await readRecommendationFamily({
      tx: input.tx,
      family: input.family,
      actorId: input.principal.id,
      state: input.requestedState ?? "ACTIVE",
      sourceIds: [...expected.keys()],
      ...(input.sourceContext
        ? {
            contextType: input.sourceContext.type,
            contextId: input.sourceContext.id,
          }
        : {}),
      offset,
      limit: 200,
    });
    for (const row of (page as Array<Record<string, unknown>>).slice(0, 200)) {
      if (expected.get(String(row.source_id)) !== row.source_generation_key)
        continue;
      projected.add(String(row.source_id));
      const actorInteractions = Array.isArray(row.actor_interactions)
        ? row.actor_interactions
        : [];
      if (actorInteractions.includes("DISMISSED")) continue;
      rows.push(row);
    }
    if (page.length <= 200) break;
    offset += 200;
  }
  // A current canonical source with no matching projection must not look like an empty feed.
  if (
    (input.requestedState === undefined || input.requestedState === "ACTIVE") &&
    expected.size !== projected.size
  )
    return {
      availability: "SOURCE_UNAVAILABLE" as const,
      reason: "PROJECTION_STALE",
      data: [] as unknown[],
    };
  return { availability: "AVAILABLE" as const, data: rows };
}

function familySort(a: Record<string, unknown>, b: Record<string, unknown>) {
  const familyA = String(a.family) as RecommendationFamily;
  const familyB = String(b.family) as RecommendationFamily;
  const rank =
    (FAMILY_ORDER.get(familyA) ?? 99) - (FAMILY_ORDER.get(familyB) ?? 99);
  if (rank) return rank;
  if (familyA === "KNOWLEDGE_GUIDANCE")
    return (
      Number(a.source_rank ?? 0) - Number(b.source_rank ?? 0) ||
      String(a.id).localeCompare(String(b.id))
    );
  if (familyA === "ASSET_REPLACEMENT_REVIEW")
    return (
      (a.source_band === "PRIORITY" ? 0 : 1) -
        (b.source_band === "PRIORITY" ? 0 : 1) ||
      Number(b.source_score ?? 0) - Number(a.source_score ?? 0) ||
      String(a.id).localeCompare(String(b.id))
    );
  return (
    new Date(
      String(
        (a.freshness as Record<string, unknown> | undefined)?.evaluated_at ??
          a.created_at,
      ),
    ).getTime() -
      new Date(
        String(
          (b.freshness as Record<string, unknown> | undefined)?.evaluated_at ??
            b.created_at,
        ),
      ).getTime() || String(a.id).localeCompare(String(b.id))
  );
}

function present(row: Record<string, unknown>) {
  return {
    recommendation_id: row.id,
    family: row.family,
    state: row.current_state,
    contexts: row.contexts,
    source: {
      domain: row.source_domain,
      type: row.source_type,
      id: row.source_id,
      version: row.source_version,
      profile_id: row.source_profile_id,
      profile_version: row.source_profile_version,
      rank: row.source_rank,
      score: row.source_score,
      band: row.source_band,
    },
    recommendation_profile: {
      id: row.recommendation_profile_id,
      version: row.recommendation_profile_version,
    },
    explanation: {
      reason_codes: row.reason_codes,
      evidence: row.evidence_summary,
      freshness: row.freshness,
      source_generation: row.source_generation,
    },
    revision: row.revision,
    revision_id: row.revision_id,
    created_at: row.created_at,
    refreshed_at: row.refreshed_at,
    generated_at: row.generated_at,
    actor_interactions: row.actor_interactions,
    available_actions:
      row.current_state === "ACTIVE"
        ? availableSourceAction(row.family as RecommendationFamily)
        : [],
  };
}

async function authorizeStoredSource(input: {
  tx: Transaction;
  row: Record<string, unknown>;
  principal: Principal;
  authorization: AuthorizationPort;
  context: CorrelationContext;
}) {
  const contexts = Array.isArray(input.row.contexts)
    ? (input.row.contexts as Array<{
        type: RecommendationContextType;
        id: string;
      }>)
    : [];
  const check = async (action: string, type: string, id: string) =>
    authorize(input.authorization, {
      principal: input.principal,
      action,
      resource: { type, id, tenant_id: input.tx.tenantId },
      scope: { tenant: input.tx.tenantId, [type]: id },
      context: { ...input.context },
    });
  if (input.row.family === "INCIDENT_CORRELATION_REVIEW") {
    const incidentIds = contexts
      .filter((item) => item.type === "INCIDENT")
      .map((item) => item.id);
    const evidence = input.row.evidence_summary as {
      candidates?: Array<{ root_incident_id?: string }>;
    } | null;
    incidentIds.push(
      ...(evidence?.candidates ?? [])
        .map((candidate) => candidate.root_incident_id)
        .filter((value): value is string => Boolean(value)),
    );
    if (!incidentIds.length)
      throw new ApplicationError("NOT_FOUND", "Recommendation was not found.");
    for (const incidentId of new Set(incidentIds))
      await check("incident.read", "incident", incidentId);
    return true;
  }
  if (input.row.family === "KNOWLEDGE_GUIDANCE") {
    const sessionContext = contexts.find(
      (item) => item.type === "RECOMMENDATION_SESSION",
    );
    const knowledgeId = (
      input.row.evidence_summary as { knowledge_id?: string } | null
    )?.knowledge_id;
    if (!sessionContext || !knowledgeId)
      throw new ApplicationError("NOT_FOUND", "Recommendation was not found.");
    const session = await readRecommendationSession(
      input.tx,
      sessionContext.id,
    );
    if (!session)
      throw new ApplicationError("NOT_FOUND", "Recommendation was not found.");
    await check(
      session.actor_id === input.principal.id
        ? "knowledge.recommendation.use"
        : "knowledge.recommendation.review",
      "knowledge_recommendation",
      sessionContext.id,
    );
    await check("knowledge.read", "knowledge", knowledgeId);
    for (const context of contexts) {
      if (context.type === "TICKET")
        await check("ticket.read", "ticket", context.id);
      if (context.type === "INCIDENT")
        await check("incident.read", "incident", context.id);
    }
    return true;
  }
  const assetContext = contexts.find((item) => item.type === "ASSET");
  if (!assetContext)
    throw new ApplicationError("NOT_FOUND", "Recommendation was not found.");
  await check("asset.read", "asset", assetContext.id);
  await check("asset.scoring.read", "asset", assetContext.id);
  return true;
}

export async function handleRecommendationRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}) {
  const url = new URL(input.req.url ?? "/", "http://localhost");
  const collection = "/api/v1/recommendations";
  const observabilityPath = `${collection}/observability`;
  const historyMatch = new RegExp(
    `^${collection}/(${UUID_SOURCE})/revisions$`,
    "i",
  ).exec(url.pathname);
  const interactionMatch = new RegExp(
    `^${collection}/(${UUID_SOURCE})/commands/interact$`,
    "i",
  ).exec(url.pathname);
  const detailMatch = new RegExp(`^${collection}/(${UUID_SOURCE})$`, "i").exec(
    url.pathname,
  );
  if (
    !(input.req.method === "GET" && url.pathname === collection) &&
    !(input.req.method === "GET" && url.pathname === observabilityPath) &&
    !(input.req.method === "GET" && detailMatch) &&
    !(input.req.method === "GET" && historyMatch) &&
    !(input.req.method === "POST" && interactionMatch)
  )
    return false;

  const principal = await authenticate(
    input.authentication,
    input.req.headers.authorization,
  );
  await requirePermission({
    principal,
    authorization: input.authorization,
    action:
      input.req.method === "POST"
        ? "recommendation.interact"
        : "recommendation.read",
    context: input.context,
  });

  if (input.req.method === "GET" && url.pathname === observabilityPath) {
    strictQuery(url, []);
    const data = await input.uow.run(principal.tenant_id, async (tx) => {
      const result = await tx.query(
        `SELECT source_family,last_success_at,last_error_code,source_generation,
                available_count,last_duration_ms,updated_at
           FROM recommendation.source_watermarks
          WHERE tenant_id=$1 ORDER BY source_family`,
        [principal.tenant_id],
      );
      return result.rows;
    });
    json(input.res, 200, { data, meta: input.context });
    return true;
  }

  if (input.req.method === "GET" && url.pathname === collection) {
    strictQuery(url, [
      "family",
      "context_type",
      "context_id",
      "state",
      "offset",
      "limit",
    ]);
    const family = familyValue(url.searchParams.get("family"));
    const context = contextFilter(url);
    const stateValue = url.searchParams.get("state");
    if (stateValue && !(STATES as readonly string[]).includes(stateValue))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unknown recommendation projection state.",
      );
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Recommendation pagination is invalid.",
      );
    const data = await input.uow.run(
      principal.tenant_id,
      async (tx) => {
        const families = family ? [family] : RECOMMENDATION_FAMILIES;
        const availability: Record<string, unknown> = {};
        const rows: Array<Record<string, unknown>> = [];
        for (const currentFamily of families) {
          const result = await familyPage({
            tx,
            family: currentFamily,
            principal,
            authorization: input.authorization,
            context: input.context,
            ...(context ? { sourceContext: context } : {}),
            ...(stateValue
              ? { requestedState: stateValue as RecommendationState }
              : {}),
          });
          availability[currentFamily] = {
            status: result.availability,
            ...(result.reason ? { reason: result.reason } : {}),
          };
          rows.push(...(result.data as Array<Record<string, unknown>>));
        }
        rows.sort(familySort);
        return {
          data: rows.slice(offset, offset + limit).map(present),
          availability,
          pagination: { offset, limit, total_available: rows.length },
        };
      },
      { isolationLevel: "REPEATABLE READ" },
    );
    json(input.res, 200, {
      data: data.data,
      availability: data.availability,
      pagination: data.pagination,
      meta: input.context,
    });
    return true;
  }

  const id = detailMatch?.[1] ?? historyMatch?.[1] ?? interactionMatch?.[1];
  if (!id || !UUID.test(id))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Recommendation id is invalid.",
    );
  if (input.req.method === "GET" && (detailMatch || historyMatch)) {
    strictQuery(url, []);
    const result = await input.uow.run(
      principal.tenant_id,
      async (tx) => {
        const row = (await readRecommendationById({
          tx,
          recommendationId: id,
          actorId: principal.id,
        })) as Record<string, unknown> | null;
        if (!row) return null;
        const contexts = Array.isArray(row.contexts)
          ? (row.contexts as Array<{
              type: RecommendationContextType;
              id: string;
            }>)
          : [];
        if (row.current_state !== "ACTIVE") {
          try {
            await authorizeStoredSource({
              tx,
              row,
              principal,
              authorization: input.authorization,
              context: input.context,
            });
          } catch (error) {
            if (
              error instanceof ApplicationError &&
              error.code === "PERMISSION_DENIED"
            )
              return null;
            throw error;
          }
          if (historyMatch)
            return readRecommendationRevisions({ tx, recommendationId: id });
          return present(row);
        }
        const live = await readCurrentSources({
          tx,
          family: row.family as RecommendationFamily,
          principal,
          authorization: input.authorization,
          context: input.context,
          ...(contexts[0] ? { sourceContext: contexts[0] } : {}),
        });
        if (live.availability !== "AVAILABLE") {
          if (historyMatch) {
            try {
              await authorizeStoredSource({
                tx,
                row,
                principal,
                authorization: input.authorization,
                context: input.context,
              });
              return readRecommendationRevisions({ tx, recommendationId: id });
            } catch (error) {
              if (
                error instanceof ApplicationError &&
                error.code === "PERMISSION_DENIED"
              )
                return null;
              throw error;
            }
          }
          return null;
        }
        const source = live.sources.find(
          (item) => item.source_id === row.source_id,
        );
        if (
          !source ||
          recommendationGenerationKey(source.generation) !==
            row.source_generation_key
        ) {
          if (historyMatch) {
            try {
              await authorizeStoredSource({
                tx,
                row,
                principal,
                authorization: input.authorization,
                context: input.context,
              });
              return readRecommendationRevisions({ tx, recommendationId: id });
            } catch (error) {
              if (
                error instanceof ApplicationError &&
                error.code === "PERMISSION_DENIED"
              )
                return null;
              throw error;
            }
          }
          return null;
        }
        if (historyMatch)
          return await readRecommendationRevisions({
            tx,
            recommendationId: id,
          });
        return present(row);
      },
      { isolationLevel: "REPEATABLE READ" },
    );
    if (result === null)
      throw new ApplicationError("NOT_FOUND", "Recommendation was not found.");
    json(input.res, 200, { data: result, meta: input.context });
    return true;
  }

  if (input.req.method === "POST" && interactionMatch) {
    strictQuery(url, []);
    const payload = await body(input.req);
    if (
      Object.keys(payload).some(
        (key) => !["interaction", "revision"].includes(key),
      ) ||
      !["VIEWED", "DISMISSED", "OPENED_SOURCE"].includes(
        String(payload.interaction),
      ) ||
      !Number.isSafeInteger(payload.revision) ||
      Number(payload.revision) < 1
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "A valid interaction and current revision are required.",
      );
    const key = input.req.headers["idempotency-key"];
    if (typeof key !== "string" || !key.trim() || key.length > 200)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Idempotency-Key is required.",
      );
    const data = await input.uow.run(principal.tenant_id, async (tx) => {
      const row = (await readRecommendationById({
        tx,
        recommendationId: id,
        actorId: principal.id,
      })) as Record<string, unknown> | null;
      if (!row)
        throw new ApplicationError(
          "NOT_FOUND",
          "Recommendation was not found.",
        );
      const sourceContext = (
        Array.isArray(row.contexts) ? row.contexts : []
      )[0] as { type: RecommendationContextType; id: string } | undefined;
      const recorded = await recordRecommendationInteraction({
        tx,
        recommendationId: id,
        revision: Number(payload.revision),
        actorId: principal.id,
        interaction: payload.interaction as RecommendationInteractionType,
        idempotencyKey: key,
        correlationId: input.context.correlation_id,
        validateCurrentSource: async () => {
          if (
            row.current_state !== "ACTIVE" ||
            Number(row.latest_revision) !== Number(payload.revision)
          )
            return false;
          const live = await readCurrentSources({
            tx,
            family: row.family as RecommendationFamily,
            principal,
            authorization: input.authorization,
            context: input.context,
            ...(sourceContext ? { sourceContext } : {}),
          });
          const source = live.sources.find(
            (item) => item.source_id === row.source_id,
          );
          return (
            live.availability === "AVAILABLE" &&
            Boolean(source) &&
            recommendationGenerationKey(source!.generation) ===
              row.source_generation_key
          );
        },
      });
      if (!recorded.replayed && payload.interaction === "DISMISSED") {
        await new PostgresAudit(tx).append({
          id: randomUUID(),
          tenant_id: principal.tenant_id,
          event_type: "RECOMMENDATION.DISMISSED",
          occurred_at: new Date().toISOString(),
          actor: { type: principal.actor_type, id: principal.id },
          action: { command_type: "RECOMMENDATION.DISMISS" },
          subject: { entity_type: "RECOMMENDATION", entity_id: id },
          correlation_id: input.context.correlation_id,
          causation_id: input.context.causation_id,
          reason: {
            code: "ACTOR_DISMISSED_REVISION",
            text: "Actor dismissed this recommendation revision.",
          },
          before: null,
          after: {
            revision: Number(payload.revision),
            interaction_id: recorded.id,
          },
          outcome: { status: "SUCCESS" },
          classification: "INTERNAL",
          relations: [],
          evidence: [],
        });
      }
      return recorded;
    });
    json(input.res, 201, { data, meta: input.context });
    return true;
  }
  return false;
}
