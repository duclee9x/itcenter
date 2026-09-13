import type pg from "pg";
import type { Config } from "../../../packages/config/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import {
  expireAssetRiskProjections,
  listScoringAssetIds,
  recalculateAssetAssessments,
} from "../../../modules/asset/index.js";
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

export async function runAssetScoringBatch(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  config: Config;
  asOf?: string;
  reportFailure?: (reason: string) => void;
}) {
  const tenants = await input.pool.query<{ tenant_id: string }>(
    "SELECT DISTINCT tenant_id FROM asset.assets ORDER BY tenant_id",
  );
  const asOf = input.asOf ?? new Date().toISOString();
  let assessed = 0;
  let unavailableTenants = 0;
  for (const { tenant_id: tenantId } of tenants.rows) {
    const scan = await input.uow.run(
      tenantId,
      async (tx) => {
        const principal = await tx.query<{ id: string }>(
          "SELECT id FROM identity.asset_scoring_principals WHERE tenant_id=$1 AND service_identity='asset-scoring' AND active=true",
          [tenantId],
        );
        if (!principal.rowCount) return { ids: [], principalId: null };
        await expireAssetRiskProjections({
          tx,
          serviceName: input.config.serviceName,
          correlationId: `asset-scoring-freshness:${tenantId}:${asOf.slice(0, 13)}`,
          actorId: String(principal.rows[0]!.id),
        });
        return {
          ids: await listScoringAssetIds(tx),
          principalId: String(principal.rows[0]!.id),
        };
      },
      { isolationLevel: "REPEATABLE READ" },
    );
    if (!scan.principalId) {
      unavailableTenants += 1;
      continue;
    }
    for (const assetId of scan.ids) {
      try {
        await input.uow.run(
          tenantId,
          async (tx) => {
            const principal = await tx.query<{ id: string }>(
              "SELECT id FROM identity.asset_scoring_principals WHERE tenant_id=$1 AND service_identity='asset-scoring' AND active=true",
              [tenantId],
            );
            if (!principal.rowCount) {
              unavailableTenants += 1;
              return;
            }
            await recalculateAssetAssessments({
              tx,
              assetId,
              actor: {
                id: String(principal.rows[0]!.id),
                tenant_id: tenantId,
                actor_type: "SYSTEM_ASSET_SCORING",
              },
              asOf,
              trigger: "SCHEDULED_EVIDENCE_RECONCILIATION",
              correlationId: `asset-scoring:${tenantId}:${assetId}:${asOf.slice(0, 13)}`,
              serviceName: input.config.serviceName,
            });
            assessed += 1;
          },
          { isolationLevel: "REPEATABLE READ" },
        );
      } catch (error) {
        input.reportFailure?.(
          error instanceof Error ? error.message : "ASSET_SCORING_FAILED",
        );
      }
    }
  }
  return { assessed, unavailable_tenants: unavailableTenants, as_of: asOf };
}

export function assetScoringTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  config: Config;
  reportFailure?: (reason: string) => void;
}): WorkerTask {
  return {
    name: "asset-risk-replacement-scoring",
    async run(signal) {
      while (!signal.aborted) {
        try {
          await runAssetScoringBatch(input);
        } catch (error) {
          input.reportFailure?.(
            error instanceof Error
              ? error.message
              : "ASSET_SCORING_SCAN_FAILED",
          );
        }
        await wait(signal, 60 * 60_000);
      }
    },
  };
}
