import type pg from "pg";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  KPI_CATALOG,
  calculateKpi,
  persistKpiSnapshot,
  type KpiResult,
  type KpiId,
} from "../../../modules/reporting/index.js";
import type { WorkerTask } from "./host.js";

const wait = (signal: AbortSignal, ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
const utcMidnight = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
const periodAt = (end: Date) => ({
  start: new Date(end.getTime() - 86_400_000).toISOString(),
  end: end.toISOString(),
});

/** Internal deterministic materializer; closed periods remain valid indefinitely for backfill/revision. */
export async function materializeReportingPeriod(input: {
  uow: UnitOfWork;
  tenantId: string;
  kpiId: KpiId;
  periodStart: string;
  periodEnd: string;
}) {
  const startedAt = Date.now();
  return input.uow.run(input.tenantId, async (tx) => {
    const principal = await tx.query<{ id: string }>(
      `SELECT id FROM identity.reporting_principals
        WHERE tenant_id=$1 AND principal_type='SYSTEM_REPORTING'
          AND service_identity='reporting' AND active=true
          AND granted_capabilities @> ARRAY[
            'reporting.snapshot.materialize','ticket.reporting.read',
            'incident.reporting.read','work_queue.reporting.read','sla.reporting.read',
            'knowledge.reporting.read','asset.scoring.read','procurement.cost.read'
          ]::text[]`,
      [input.tenantId],
    );
    if (!principal.rowCount)
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "Tenant-scoped reporting system principal is unavailable.",
      );
    const calculated = await calculateKpi({
      tx,
      kpiId: input.kpiId,
      from: input.periodStart,
      to: input.periodEnd,
      asOf: input.periodEnd,
    });
    const generatedAt = new Date().toISOString();
    const lagSeconds = Math.max(
      0,
      Math.floor(
        (Date.parse(generatedAt) - Date.parse(input.periodEnd)) / 1000,
      ),
    );
    const result: KpiResult = {
      ...calculated,
      generated_at: generatedAt,
      source_lineage: {
        ...calculated.source_lineage,
        materialization: {
          generated_at: generatedAt,
          period_close_lag_seconds: lagSeconds,
          fifteen_minute_target: lagSeconds <= 15 * 60 ? "MET" : "LATE",
        },
      },
    };
    const sourceReason = result.source_lineage.reason;
    const sourceFailed =
      result.status === "UNAVAILABLE" &&
      ![
        "INSUFFICIENT_HISTORICAL_COVERAGE",
        "AMBIGUOUS_TARGET_PURPOSE",
        "FINALIZATION_TIMESTAMP_UNAVAILABLE",
        "PRE_TICKET_ORIGIN_AMBIGUOUS",
        "COST_EFFECTIVE_TIME_UNAVAILABLE",
      ].includes(String(sourceReason));
    if (sourceFailed) {
      await tx.query(
        `INSERT INTO reporting.source_watermarks(tenant_id,source_name,last_error_code,last_duration_ms,updated_at)
         VALUES($1,$2,$3,$4,now()) ON CONFLICT(tenant_id,source_name) DO UPDATE
           SET last_error_code=EXCLUDED.last_error_code,last_duration_ms=EXCLUDED.last_duration_ms,updated_at=now()`,
        [
          input.tenantId,
          input.kpiId,
          String(sourceReason ?? "SOURCE_QUERY_UNAVAILABLE"),
          Math.max(0, Date.now() - startedAt),
        ],
      );
      return { result, created: false, revision: null, sourceFailed: true };
    }
    const snapshotType =
      KPI_CATALOG[input.kpiId].mode === "LIVE_COUNT"
        ? "DAILY_POINT_IN_TIME"
        : "PERIOD";
    const saved = await persistKpiSnapshot({ tx, result, snapshotType });
    const sourceGeneration = String(
      result.source_lineage.source_generation ?? "unknown",
    );
    const durationMs = Math.max(0, Date.now() - startedAt);
    await tx.query(
      `INSERT INTO reporting.source_watermarks(tenant_id,source_name,watermark_at,last_success_at,last_error_code,source_generation,snapshot_lag_seconds,last_duration_ms)
       VALUES($1,$2,$3,now(),NULL,$4,GREATEST(0,EXTRACT(EPOCH FROM (now()-$3)))::bigint,$5)
       ON CONFLICT(tenant_id,source_name) DO UPDATE SET watermark_at=EXCLUDED.watermark_at,
         last_success_at=EXCLUDED.last_success_at,last_error_code=NULL,source_generation=EXCLUDED.source_generation,
         snapshot_lag_seconds=EXCLUDED.snapshot_lag_seconds,last_duration_ms=EXCLUDED.last_duration_ms,updated_at=now()`,
      [
        input.tenantId,
        input.kpiId,
        input.periodEnd,
        sourceGeneration,
        durationMs,
      ],
    );
    return { result, ...saved, sourceFailed: false };
  });
}

/** Daily close worker also catches up every closed UTC day missed while it was unavailable. */
export async function runReportingSnapshotBatch(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  asOf?: string;
  backfillFrom?: string;
  reportFailure?: (reason: string) => void;
}) {
  const now = new Date(input.asOf ?? new Date().toISOString());
  const closedThrough = utcMidnight(now);
  const tenants = await input.pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM identity.reporting_principals
      WHERE principal_type='SYSTEM_REPORTING' AND service_identity='reporting' AND active=true
        AND granted_capabilities @> ARRAY[
          'reporting.snapshot.materialize','ticket.reporting.read',
          'incident.reporting.read','work_queue.reporting.read','sla.reporting.read',
          'knowledge.reporting.read','asset.scoring.read','procurement.cost.read'
        ]::text[]
      ORDER BY tenant_id`,
  );
  let snapshots = 0,
    periods = 0;
  for (const { tenant_id } of tenants.rows) {
    for (const kpiId of Object.keys(KPI_CATALOG) as KpiId[]) {
      try {
        const last = await input.pool.query<{
          period_end: Date | string | null;
        }>(
          `SELECT max(period_end) AS period_end FROM reporting.kpi_result_snapshots
            WHERE tenant_id=$1 AND kpi_id=$2 AND snapshot_type=$3`,
          [
            tenant_id,
            kpiId,
            KPI_CATALOG[kpiId].mode === "LIVE_COUNT"
              ? "DAILY_POINT_IN_TIME"
              : "PERIOD",
          ],
        );
        const fallbackStart = new Date(closedThrough.getTime() - 86_400_000);
        const firstStart = input.backfillFrom
          ? new Date(input.backfillFrom)
          : last.rows[0]?.period_end
            ? new Date(last.rows[0].period_end)
            : fallbackStart;
        if (
          !Number.isFinite(firstStart.getTime()) ||
          firstStart.getTime() % 86_400_000 !== 0
        )
          throw new Error("REPORTING_BACKFILL_START_MUST_BE_UTC_DAY_BOUNDARY");
        for (
          let start = firstStart;
          start.getTime() < closedThrough.getTime();
          start = new Date(start.getTime() + 86_400_000)
        ) {
          const p = periodAt(new Date(start.getTime() + 86_400_000));
          const saved = await materializeReportingPeriod({
            uow: input.uow,
            tenantId: tenant_id,
            kpiId,
            periodStart: p.start,
            periodEnd: p.end,
          });
          if (saved.sourceFailed) break;
          if (saved.created) snapshots += 1;
          periods += 1;
        }
      } catch (error) {
        input.reportFailure?.(
          error instanceof Error ? error.message : "REPORTING_SNAPSHOT_FAILED",
        );
      }
    }
  }
  return { snapshots, periods, closed_through: closedThrough.toISOString() };
}

export function reportingSnapshotTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  reportFailure?: (reason: string) => void;
}): WorkerTask {
  return {
    name: "reporting-governed-kpi-snapshots",
    async run(signal) {
      while (!signal.aborted) {
        await runReportingSnapshotBatch(input);
        await wait(signal, 5 * 60_000);
      }
    },
  };
}
