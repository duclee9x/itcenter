import type pg from "pg";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import {
  reconcileRecommendationSources,
  recommendationServiceAuthorization,
  requireRecommendationReconcileGrant,
} from "../../../modules/recommendation/index.js";
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

export async function runRecommendationReconciliation(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  asOf?: string;
  reportFailure?: (reason: string) => void;
}) {
  const tenants = await input.pool.query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM identity.recommendation_principals
      WHERE service_identity='recommendation' AND active=true
      ORDER BY tenant_id`,
  );
  const asOf = input.asOf ?? new Date().toISOString();
  let reconciled = 0;
  let unavailable = 0;
  for (const { tenant_id: tenantId } of tenants.rows) {
    try {
      const result = await input.uow.run(
        tenantId,
        async (tx) => {
          const principal = await tx.query<{ id: string }>(
            `SELECT id FROM identity.recommendation_principals
              WHERE tenant_id=$1 AND service_identity='recommendation'
                AND active=true`,
            [tenantId],
          );
          if (!principal.rowCount) return null;
          const principalId = principal.rows[0]!.id;
          await requireRecommendationReconcileGrant({ tx, principalId });
          return reconcileRecommendationSources({
            tx,
            principal: {
              id: principalId,
              tenant_id: tenantId,
              actor_type: "SYSTEM_RECOMMENDATION",
            },
            authorization: recommendationServiceAuthorization(tx),
            correlation: {
              request_id: `recommendation-reconcile:${tenantId}`,
              correlation_id: `recommendation-reconcile:${tenantId}:${asOf.slice(0, 16)}`,
              causation_id: `recommendation-reconcile:${tenantId}:${asOf}`,
            },
            asOf,
          });
        },
        { isolationLevel: "SERIALIZABLE" },
      );
      if (!result) continue;
      reconciled += 1;
      if (
        Object.values(result.families).some(
          (family) => family.availability === "SOURCE_UNAVAILABLE",
        )
      )
        unavailable += 1;
    } catch (error) {
      unavailable += 1;
      input.reportFailure?.(
        error instanceof Error
          ? error.message
          : "RECOMMENDATION_RECONCILIATION_FAILED",
      );
    }
  }
  return {
    reconciled_tenants: reconciled,
    unavailable_tenants: unavailable,
    as_of: asOf,
  };
}

export function recommendationReconciliationTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  reportFailure?: (reason: string) => void;
}): WorkerTask {
  return {
    name: "recommendation-source-reconciliation",
    async run(signal) {
      while (!signal.aborted) {
        try {
          await runRecommendationReconciliation(input);
        } catch (error) {
          input.reportFailure?.(
            error instanceof Error
              ? error.message
              : "RECOMMENDATION_RECONCILIATION_SCAN_FAILED",
          );
        }
        await wait(signal, 60_000);
      }
    },
  };
}
