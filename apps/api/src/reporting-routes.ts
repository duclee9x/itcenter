import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { json } from "../../../packages/observability/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  calculateKpi,
  listKpiDefinitions,
  aggregateKpiSnapshots,
  queryKpiDrilldownCandidates,
  readKpiSnapshots,
  validateDimensions,
  type KpiDrilldownCandidate,
  type KpiId,
} from "../../../modules/reporting/index.js";

function period(url: URL) {
  const utc = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
  const now = new Date().toISOString();
  const from =
    url.searchParams.get("from") ??
    new Date(Date.now() - 86_400_000).toISOString();
  const to = url.searchParams.get("to") ?? now;
  if (
    !utc.test(from) ||
    !utc.test(to) ||
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(from) >= Date.parse(to)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "from and to must be a UTC [from,to) interval.",
    );
  return { from, to };
}

function dimensions(url: URL) {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!key.startsWith("dimension.")) continue;
    const name = key.slice("dimension.".length);
    if (!name || Object.hasOwn(result, name))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Each governed dimension may be supplied once.",
      );
    result[name] = value;
  }
  return result;
}

function validateReportingParameters(url: URL, operation: string) {
  const allowed = new Set(["from", "to"]);
  if (operation === "current" || operation === "drilldown")
    allowed.add("as_of");
  if (operation === "history") {
    allowed.add("version");
    allowed.add("revision");
  }
  if (operation === "drilldown") {
    allowed.add("offset");
    allowed.add("limit");
  }
  if (operation === "export.csv") {
    allowed.add("revision");
    allowed.add("as_of");
  }
  for (const [key] of url.searchParams)
    if (!allowed.has(key) && !key.startsWith("dimension."))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `Query parameter ${key} is not supported by governed reporting.`,
      );
}

export function escapeCsvCell(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function safeError(error: unknown) {
  return (
    error instanceof ApplicationError && error.code === "PERMISSION_DENIED"
  );
}

async function permission(input: {
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  req: IncomingMessage;
  context: CorrelationContext;
  action: string;
}) {
  const principal = await authenticate(
    input.authentication,
    input.req.headers.authorization,
  );
  const resourceType =
    input.action === "metric.read" ? "reporting_metric" : "reporting";
  await authorize(input.authorization, {
    principal,
    action: input.action,
    resource: {
      type: resourceType,
      id: "governed-kpi",
      tenant_id: principal.tenant_id,
    },
    scope: { tenant: principal.tenant_id },
    context: { ...input.context },
  });
  return principal;
}

async function authorizeCandidate(input: {
  candidate: KpiDrilldownCandidate;
  principal: Principal;
  authorization: AuthorizationPort;
  context: CorrelationContext;
}) {
  const candidate = input.candidate;
  try {
    await authorize(input.authorization, {
      principal: input.principal,
      action: candidate.permission,
      resource: {
        type: candidate.resource_type,
        id: candidate.resource_id,
        tenant_id: input.principal.tenant_id,
      },
      scope: { tenant: input.principal.tenant_id },
      context: { ...input.context },
    });
    for (const knowledgeId of candidate.related_knowledge_ids ?? [])
      await authorize(input.authorization, {
        principal: input.principal,
        action: "knowledge.read",
        resource: {
          type: "knowledge",
          id: knowledgeId,
          tenant_id: input.principal.tenant_id,
        },
        scope: { tenant: input.principal.tenant_id },
        context: { ...input.context },
      });
    return true;
  } catch (error) {
    if (safeError(error)) return false;
    throw error;
  }
}

export async function handleReportingRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}) {
  const url = new URL(input.req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/v1/kpis/catalog" && input.req.method === "GET") {
    const principal = await permission({ ...input, action: "metric.read" });
    const data = await input.uow.run(principal.tenant_id, (tx) =>
      listKpiDefinitions(tx),
    );
    json(input.res, 200, {
      data,
      meta: { ...input.context, tenant_id: principal.tenant_id },
    });
    return true;
  }
  if (
    url.pathname === "/api/v1/kpis/observability" &&
    input.req.method === "GET"
  ) {
    const principal = await permission({ ...input, action: "report.read" });
    const data = await input.uow.run(principal.tenant_id, async (tx) => {
      const result = await tx.query(
        `SELECT source_name,watermark_at,last_success_at,last_error_code,
                source_generation,snapshot_lag_seconds,last_duration_ms,updated_at,
           CASE WHEN last_error_code IS NOT NULL THEN 'UNAVAILABLE'
                ELSE 'LAST_MATERIALIZATION_SUCCEEDED' END AS source_status,
           CASE WHEN snapshot_lag_seconds > 900 THEN 'LATE'
                WHEN snapshot_lag_seconds IS NOT NULL THEN 'WITHIN_TARGET'
                ELSE 'NOT_MATERIALIZED' END AS snapshot_generation_slo
           FROM reporting.source_watermarks WHERE tenant_id=$1 ORDER BY source_name`,
        [principal.tenant_id],
      );
      return result.rows;
    });
    json(input.res, 200, { data, meta: input.context });
    return true;
  }
  const match =
    /^\/api\/v1\/kpis\/([A-Z0-9_]+)\/(current|history|drilldown|export\.csv)$/.exec(
      url.pathname,
    );
  if (!match) return false;
  const [, matchedKpiId, operation] = match;
  const kpiId = matchedKpiId!;
  validateReportingParameters(url, operation!);
  const principal = await permission({ ...input, action: "metric.read" });
  if (operation === "history")
    await permission({ ...input, action: "report.read" });
  if (operation === "export.csv")
    await permission({ ...input, action: "report.export" });
  if (kpiId === "PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY")
    await authorize(input.authorization, {
      principal,
      action: "procurement.cost.read",
      resource: {
        type: "procurement_cost",
        id: "aggregate",
        tenant_id: principal.tenant_id,
      },
      scope: { tenant: principal.tenant_id },
      context: { ...input.context },
    });
  const p = period(url),
    d = dimensions(url);
  validateDimensions(kpiId as KpiId, d);
  const asOf =
    url.searchParams.get("as_of") ??
    (operation === "current" ? new Date().toISOString() : p.to);
  if (
    !Number.isFinite(Date.parse(asOf)) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(asOf)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "as_of must be a UTC timestamp.",
    );

  if (operation === "history") {
    const revisionParam = url.searchParams.get("revision");
    const revision = revisionParam === null ? undefined : Number(revisionParam);
    const versionParam = url.searchParams.get("version");
    const version = versionParam === null ? undefined : Number(versionParam);
    if (
      revision !== undefined &&
      (!Number.isSafeInteger(revision) || revision < 1)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "revision must be a positive integer.",
      );
    if (
      version !== undefined &&
      (!Number.isSafeInteger(version) || version < 1)
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "version must be a positive integer.",
      );
    const rows = await input.uow.run(principal.tenant_id, (tx) =>
      readKpiSnapshots({
        tx,
        kpiId,
        from: p.from,
        to: p.to,
        dimensions: d,
        ...(version !== undefined ? { kpiVersion: version } : {}),
        ...(revision !== undefined ? { revision } : {}),
      }),
    );
    json(input.res, 200, {
      data: rows,
      aggregate: aggregateKpiSnapshots(kpiId, rows),
      meta: input.context,
    });
    return true;
  }

  if (operation === "drilldown") {
    const offset = Number(url.searchParams.get("offset") ?? 0),
      limit = Number(url.searchParams.get("limit") ?? 50);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "drilldown pagination is invalid.",
      );
    const candidates = await input.uow.run(principal.tenant_id, (tx) =>
      queryKpiDrilldownCandidates({
        tx,
        kpiId,
        from: p.from,
        to: p.to,
        asOf,
        dimensions: d,
        offset,
        limit,
      }),
    );
    const authorized = [];
    for (const candidate of candidates)
      if (
        await authorizeCandidate({
          candidate,
          principal,
          authorization: input.authorization,
          context: input.context,
        })
      )
        authorized.push({ id: candidate.resource_id, ...candidate.metadata });
    json(input.res, 200, {
      data: authorized,
      meta: { ...input.context, as_of: asOf, returned: authorized.length },
    });
    return true;
  }

  const revisionParam = url.searchParams.get("revision");
  const revision = revisionParam === null ? undefined : Number(revisionParam);
  if (
    operation === "export.csv" &&
    revision !== undefined &&
    (!Number.isSafeInteger(revision) || revision < 1)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "revision must be a positive integer.",
    );
  const historicalRows =
    operation === "export.csv" && revision !== undefined
      ? await input.uow.run(principal.tenant_id, (tx) =>
          readKpiSnapshots({
            tx,
            kpiId,
            from: p.from,
            to: p.to,
            dimensions: d,
            revision,
          }),
        )
      : null;
  if (historicalRows && historicalRows.length === 0)
    throw new ApplicationError(
      "NOT_FOUND",
      "No historical KPI snapshot matches the requested revision.",
    );
  const result =
    historicalRows === null
      ? await input.uow.run(principal.tenant_id, (tx) =>
          calculateKpi({
            tx,
            kpiId,
            from: p.from,
            to: p.to,
            asOf,
            dimensions: d,
          }),
        )
      : null;
  if (operation === "export.csv") {
    const fields = [
      "tenant_id",
      "kpi_id",
      "kpi_version",
      "period_start",
      "period_end",
      "dimensions",
      "numerator",
      "denominator",
      "value",
      "unit",
      "status",
      "completeness",
      "revision",
      "as_of",
      "generated_at",
      "source_lineage",
    ];
    const valueRows = historicalRows
      ? historicalRows.map((row) =>
          fields.map(
            (field) =>
              (row as Record<string, unknown>)[field] ??
              (field === "revision"
                ? revision
                : field === "tenant_id"
                  ? principal.tenant_id
                  : null),
          ),
        )
      : [
          fields.map((field) =>
            field === "revision"
              ? null
              : field === "tenant_id"
                ? principal.tenant_id
                : (result as unknown as Record<string, unknown>)[field],
          ),
        ];
    const rows = [fields, ...valueRows];
    const exportMeta = historicalRows?.[0] as
      Record<string, unknown> | undefined;
    const exportedResult = result as Record<string, unknown> | null;
    await input.uow.run(principal.tenant_id, async (tx) => {
      const recordedAt = new Date().toISOString();
      await new PostgresAudit(tx).append({
        id: randomUUID(),
        tenant_id: principal.tenant_id,
        event_type: "REPORTING.KPI_CSV_EXPORTED",
        occurred_at: recordedAt,
        actor: { type: principal.actor_type, id: principal.id },
        action: { command_type: "REPORTING.KPI_CSV_EXPORT" },
        subject: { entity_type: "KPI_DEFINITION", entity_id: kpiId },
        correlation_id: input.context.correlation_id,
        causation_id:
          input.context.causation_id ?? input.context.correlation_id,
        reason: {
          code: "AUTHORIZED_AGGREGATE_EXPORT",
          text: "Aggregate KPI CSV export.",
        },
        before: null,
        after: {
          kpi_version:
            exportMeta?.kpi_version ?? exportedResult?.kpi_version ?? 1,
          period_start: p.from,
          period_end: p.to,
          dimensions: d,
          revision: exportMeta?.revision ?? revision ?? null,
          as_of: exportMeta?.as_of ?? exportedResult?.as_of ?? asOf,
          generated_at:
            exportMeta?.generated_at ?? exportedResult?.generated_at ?? null,
          format: "CSV_AGGREGATE",
          record_count: valueRows.length,
          result_status: exportMeta?.status ?? exportedResult?.status ?? null,
        } as never,
        outcome: { status: "SUCCESS" },
        classification:
          kpiId === "PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY"
            ? "CONFIDENTIAL"
            : "INTERNAL",
        relations: [],
        evidence: [],
      });
    });
    input.res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kpiId}.csv"`,
    });
    input.res.end(
      rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n") + "\r\n",
    );
    return true;
  }
  json(input.res, 200, { data: result, meta: input.context });
  return true;
}
