import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import { isKnowledgeSearchCandidateCurrent } from "../../../modules/problem/index.js";
import { PostgresIdempotencyStore } from "../../../packages/messaging/src/index.js";
import {
  SEARCH_ENTITY_TYPES,
  exactCanonicalFallback,
  findSearchCandidates,
  normalizeSearchText,
  reindexSearchPage,
  type SearchCandidate,
  type SearchEntityType,
} from "../../../modules/search/index.js";
import { json } from "../../../packages/observability/src/index.js";

interface SearchCursor {
  fingerprint: string;
  score: number;
  entity_type: string;
  entity_id: string;
}

function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string | null, fingerprint: string) {
  if (!value) return undefined;
  try {
    const cursor = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as SearchCursor;
    if (
      cursor.fingerprint !== fingerprint ||
      !Number.isSafeInteger(cursor.score) ||
      typeof cursor.entity_type !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(cursor.entity_id)
    )
      throw new Error();
    return cursor;
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", "Invalid search cursor.");
  }
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65536)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
  }
  try {
    return (body ? JSON.parse(body) : {}) as Record<string, unknown>;
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
  }
}

function allowedTypeList(value: string | null): SearchEntityType[] {
  if (!value) return [...SEARCH_ENTITY_TYPES];
  const requested = value
    .split(",")
    .map((type) => type.trim().toUpperCase())
    .filter(Boolean);
  if (
    requested.some(
      (type) => !SEARCH_ENTITY_TYPES.includes(type as SearchEntityType),
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported search entity type.",
    );
  return [...new Set(requested as SearchEntityType[])];
}

function filterForResult(candidate: SearchCandidate, q: string) {
  const normalizedQuery = normalizeSearchText(q);
  return {
    type: candidate.entity_type,
    id: candidate.entity_id,
    display_code: candidate.display_code,
    title: candidate.title,
    subtitle: candidate.subtitle,
    highlights: [candidate.display_code, candidate.title].filter((field) =>
      normalizeSearchText(field).includes(normalizedQuery),
    ),
    score: candidate.score,
    updated_at: candidate.updated_at,
  };
}

async function canReadCandidate(input: {
  tx: Transaction;
  authorization: AuthorizationPort;
  principal: Principal;
  context: CorrelationContext;
  candidate: SearchCandidate;
}): Promise<boolean> {
  if (input.candidate.entity_type === "KNOWLEDGE") {
    const version = input.candidate.filter_fields.version;
    const audience = input.candidate.filter_fields.audience;
    if (
      !Number.isSafeInteger(version) ||
      (audience !== "END_USER_SAFE" && audience !== "OPERATOR_ONLY") ||
      !(await isKnowledgeSearchCandidateCurrent({
        tx: input.tx,
        knowledgeId: input.candidate.entity_id,
        knowledgeVersion: Number(version),
        audience,
      }))
    )
      return false;
  }
  const metadata = input.candidate.security_scope ?? {};
  const resourceScope: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata))
    if (typeof value === "string" && value) resourceScope[key] = value;
  const selfIds = Array.isArray(metadata.self_user_ids)
    ? metadata.self_user_ids.filter(
        (id): id is string => typeof id === "string",
      )
    : typeof metadata.self === "string"
      ? [metadata.self]
      : [];
  const scopes = selfIds.length
    ? selfIds.map((id) => ({ ...resourceScope, self: id }))
    : [resourceScope];
  const decisions = await Promise.all(
    scopes.map((scope) =>
      input.authorization.evaluate({
        principal: input.principal,
        action: input.candidate.authorization_action,
        resource: {
          type: input.candidate.authorization_resource_type,
          id: input.candidate.entity_id,
          tenant_id: input.principal.tenant_id,
        },
        scope,
        context: { ...input.context },
      }),
    ),
  );
  return decisions.some((decision) => decision.result === "ALLOW");
}

async function freshness(tx: Transaction) {
  const result = await tx.query<{
    index_state: string;
    last_event_at: string | null;
    indexed_at: string;
  }>(
    "SELECT index_state,last_event_at,indexed_at FROM operations.search_index_state WHERE tenant_id=$1",
    [tx.tenantId],
  );
  if (!result.rowCount)
    return { index_state: "STALE", lag_seconds: null as number | null };
  const row = result.rows[0]!;
  const lag = row.last_event_at
    ? Math.max(
        0,
        Math.floor((Date.now() - Date.parse(row.last_event_at)) / 1000),
      )
    : 0;
  const state =
    row.index_state === "FAILED"
      ? "FAILED"
      : row.index_state === "REBUILDING"
        ? "REBUILDING"
        : lag > 60
          ? "STALE"
          : lag > 15
            ? "DELAYED"
            : "CURRENT";
  return { index_state: state, lag_seconds: lag };
}

async function queryWithAuthorization(input: {
  tx: Transaction;
  principal: Principal;
  authorization: AuthorizationPort;
  context: CorrelationContext;
  q: string;
  types: SearchEntityType[];
  state?: string;
  siteId?: string;
  limit: number;
  prefixOnly: boolean;
  fingerprint: string;
  after?: SearchCursor;
}) {
  const batchSize = 100;
  let after = input.after
    ? {
        score: input.after.score,
        entity_type: input.after.entity_type,
        entity_id: input.after.entity_id,
      }
    : undefined;
  let scanned = 0;
  let next: SearchCursor | undefined;
  const allowed: SearchCandidate[] = [];
  while (scanned < 1000 && allowed.length <= input.limit) {
    const rows = await findSearchCandidates({
      tx: input.tx,
      q: input.q,
      types: input.types,
      ...(input.state ? { state: input.state } : {}),
      ...(input.siteId ? { siteId: input.siteId } : {}),
      ...(after ? { after } : {}),
      limit: batchSize,
      prefixOnly: input.prefixOnly,
    });
    if (!rows.length) break;
    const checks = await Promise.all(
      rows.map((candidate) =>
        canReadCandidate({
          tx: input.tx,
          authorization: input.authorization,
          principal: input.principal,
          context: input.context,
          candidate,
        }),
      ),
    );
    rows.forEach((candidate, index) => {
      if (checks[index]) allowed.push(candidate);
    });
    scanned += rows.length;
    const last = rows.at(-1)!;
    after = {
      score: last.score,
      entity_type: last.entity_type,
      entity_id: last.entity_id,
    };
    if (allowed.length > input.limit) {
      const lastReturned = allowed[input.limit - 1]!;
      next = {
        fingerprint: input.fingerprint,
        score: lastReturned.score,
        entity_type: lastReturned.entity_type,
        entity_id: lastReturned.entity_id,
      };
      break;
    }
    if (rows.length < batchSize) break;
  }
  return {
    data: allowed
      .slice(0, input.limit)
      .map((candidate) => filterForResult(candidate, input.q)),
    next_cursor: next ? encodeCursor(next) : null,
    // Search must not reveal that inaccessible Knowledge matched a query.
    scan_limited:
      scanned >= 1000 && !next && !input.types.includes("KNOWLEDGE"),
  };
}

async function exactFallbackWithAuthorization(input: {
  tx: Transaction;
  principal: Principal;
  authorization: AuthorizationPort;
  context: CorrelationContext;
  q: string;
  types: SearchEntityType[];
  state?: string;
  siteId?: string;
  limit: number;
  autocomplete: boolean;
  fingerprint: string;
  after?: SearchCursor;
}) {
  const exact = await exactCanonicalFallback({
    tx: input.tx,
    q: input.q,
    types: input.types,
  });
  const candidates = exact
    .filter(
      (candidate) =>
        (!input.state || candidate.filter_fields.state === input.state) &&
        (!input.siteId || candidate.security_scope.site_id === input.siteId),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entity_type.localeCompare(right.entity_type) ||
        left.entity_id.localeCompare(right.entity_id),
    )
    .filter(
      (candidate) =>
        !input.after ||
        candidate.score < input.after.score ||
        (candidate.score === input.after.score &&
          (candidate.entity_type > input.after.entity_type ||
            (candidate.entity_type === input.after.entity_type &&
              candidate.entity_id > input.after.entity_id))),
    );
  const checks = await Promise.all(
    candidates.map((candidate) =>
      canReadCandidate({
        tx: input.tx,
        authorization: input.authorization,
        principal: input.principal,
        context: input.context,
        candidate,
      }),
    ),
  );
  const readable = candidates.filter((_, index) => checks[index]);
  const page = readable.slice(0, input.limit);
  const last = page.at(-1);
  const next =
    !input.autocomplete && readable.length > input.limit && last
      ? encodeCursor({
          fingerprint: input.fingerprint,
          score: last.score,
          entity_type: last.entity_type,
          entity_id: last.entity_id,
        })
      : null;
  return {
    data: page.map((candidate) => filterForResult(candidate, input.q)),
    next_cursor: next,
    scan_limited: false,
  };
}

export async function handleSearchRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}): Promise<boolean> {
  const { req, res, context, authentication, authorization, uow } = input;
  const url = new URL(req.url ?? "", "http://localhost");
  const isSearch =
    req.method === "GET" &&
    (url.pathname === "/api/v1/search" ||
      url.pathname === "/api/v1/search/autocomplete");
  const isReindex =
    req.method === "POST" && url.pathname === "/api/v1/search/reindex";
  if (!isSearch && !isReindex) return false;
  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );

  if (isReindex) {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !key.trim())
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Idempotency-Key is required.",
      );
    const body = await readJson(req);
    const type = String(body.entity_type ?? "").toUpperCase();
    if (!SEARCH_ENTITY_TYPES.includes(type as SearchEntityType))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unsupported search entity type.",
      );
    const afterId = body.after_id ? String(body.after_id) : undefined;
    if (afterId && !/^[0-9a-f-]{36}$/i.test(afterId))
      throw new ApplicationError("VALIDATION_ERROR", "Invalid reindex cursor.");
    const limit = body.limit === undefined ? 100 : Number(body.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Reindex limit must be 1..250.",
      );
    const reason = String(body.reason ?? "").trim();
    if (!reason)
      throw new ApplicationError("VALIDATION_ERROR", "reason is required.");
    await authorize(authorization, {
      principal,
      action: "search.reindex",
      resource: {
        type: "search",
        id: String(type),
        tenant_id: principal.tenant_id,
      },
      scope: {},
      context: { ...context },
    });
    const result = await uow.run(principal.tenant_id, async (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "SEARCH.REINDEX",
          businessScope: `${type}:${afterId ?? "start"}`,
          key,
          semanticRequest: body as never,
          expiresAt: new Date(Date.now() + 86400000),
        },
        async () => {
          await tx.query(
            `INSERT INTO operations.search_index_state(tenant_id,index_state,indexed_at,updated_at)
             VALUES($1,'REBUILDING',now(),now()) ON CONFLICT(tenant_id)
             DO UPDATE SET index_state='REBUILDING',updated_at=now()`,
            [tx.tenantId],
          );
          const page = await reindexSearchPage({
            tx,
            type: type as SearchEntityType,
            ...(afterId ? { afterId } : {}),
            limit,
          });
          if (!page.next_id)
            await tx.query(
              `UPDATE operations.search_index_state SET
                 index_state=CASE WHEN EXISTS (
                   SELECT 1 FROM operations.search_index_retries r WHERE r.tenant_id=$1
                 ) THEN 'FAILED' ELSE 'CURRENT' END,
                 last_rebuild_at=now(),indexed_at=now(),
                 failure_code=CASE WHEN EXISTS (
                   SELECT 1 FROM operations.search_index_retries r WHERE r.tenant_id=$1
                 ) THEN 'SEARCH_INDEX_EVENT_FAILED' ELSE NULL END,updated_at=now()
               WHERE tenant_id=$1`,
              [tx.tenantId],
            );
          const now = new Date().toISOString();
          await new PostgresAudit(tx).append({
            id: randomUUID(),
            tenant_id: principal.tenant_id,
            event_type: "SEARCH.REINDEXED",
            occurred_at: now,
            actor: { type: principal.actor_type, id: principal.id },
            action: { command_type: "SEARCH.REINDEX" },
            subject: { entity_type: "SEARCH_INDEX", entity_id: type },
            correlation_id: context.correlation_id,
            causation_id: context.causation_id,
            reason: { code: "SEARCH_REINDEX", text: reason },
            before: null,
            after: { entity_type: type, ...page },
            outcome: { status: "SUCCESS" },
            classification: "INTERNAL",
            relations: [],
            evidence: [],
          });
          return { status: 200, body: page };
        },
      ),
    );
    json(res, result.status, { data: result.body, meta: context });
    return true;
  }

  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length > 256)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "q must contain 1..256 characters.",
    );
  if (!normalizeSearchText(q))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "q must contain searchable letters or digits.",
    );
  const autocomplete = url.pathname.endsWith("/autocomplete");
  const types = allowedTypeList(url.searchParams.get("types"));
  const state = url.searchParams.get("state") ?? undefined;
  const siteId = url.searchParams.get("site_id") ?? undefined;
  if (siteId && !/^[0-9a-f-]{36}$/i.test(siteId))
    throw new ApplicationError("VALIDATION_ERROR", "site_id must be a UUID.");
  const limit = autocomplete
    ? 10
    : Number(url.searchParams.get("limit") ?? "20");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new ApplicationError("VALIDATION_ERROR", "limit must be 1..50.");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        tenant_id: principal.tenant_id,
        principal_id: principal.id,
        q: normalizeSearchText(q),
        types,
        state,
        siteId,
        autocomplete,
        sort: "rank",
      }),
    )
    .digest("hex");
  const cursor = decodeCursor(url.searchParams.get("cursor"), fingerprint);
  const started = performance.now();
  let searched;
  let degraded = false;
  let currentFreshness = {
    index_state: "STALE",
    lag_seconds: null as number | null,
  };
  try {
    searched = await uow.run(principal.tenant_id, async (tx) => {
      currentFreshness = await freshness(tx);
      const page = await queryWithAuthorization({
        tx,
        principal,
        authorization,
        context,
        q,
        types,
        ...(state ? { state } : {}),
        ...(siteId ? { siteId } : {}),
        limit,
        prefixOnly: autocomplete,
        fingerprint,
        ...(cursor ? { after: cursor } : {}),
      });
      return page;
    });
  } catch {
    degraded = true;
    const exactRows = await uow.run(principal.tenant_id, async (tx) => {
      return exactFallbackWithAuthorization({
        tx,
        principal,
        authorization,
        context,
        q,
        types,
        ...(state ? { state } : {}),
        ...(siteId ? { siteId } : {}),
        limit,
        autocomplete,
        fingerprint,
        ...(cursor ? { after: cursor } : {}),
      });
    });
    searched = exactRows;
  }
  const duration = Math.round(performance.now() - started);
  json(res, 200, {
    data: searched.data,
    meta: {
      ...context,
      next_cursor: searched.next_cursor,
      query_time_ms: duration,
      index_state: degraded ? "DEGRADED" : currentFreshness.index_state,
      lag_seconds: currentFreshness.lag_seconds,
      ...(searched.scan_limited ? { scan_limited: true } : {}),
    },
  });
  return true;
}
