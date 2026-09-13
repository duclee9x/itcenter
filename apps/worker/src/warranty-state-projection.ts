import type pg from "pg";
import type { Config } from "../../../packages/config/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import {
  listWarrantyProjectionAssetIds,
  projectWarrantyState,
} from "../../../modules/asset/index.js";
import { evaluateWarrantyAssetForProjection } from "../../../modules/maintenance/index.js";
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

export async function refreshWarrantyStateProjectionBatch(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  config: Config;
  asOf?: string;
}) {
  const asOf = input.asOf ?? new Date().toISOString();
  const evaluatedOn = new Date(asOf).toISOString().slice(0, 10);
  const tenants = await input.pool.query<{ tenant_id: string }>(
    "SELECT DISTINCT tenant_id FROM asset.assets ORDER BY tenant_id",
  );
  let refreshed = 0;
  for (const { tenant_id: tenantId } of tenants.rows) {
    await input.uow.run(tenantId, async (tx) => {
      const assetIds = await listWarrantyProjectionAssetIds(tx);
      for (const assetId of assetIds) {
        const warranty = await evaluateWarrantyAssetForProjection({
          tx,
          assetId,
          asOf,
        });
        await projectWarrantyState({
          tx,
          assetId,
          state: warranty.state,
          evaluatedOn,
          policyVersion: `${warranty.state_policy_id}:v${warranty.state_policy_version}`,
          evidenceReference: warranty.warranty_id,
          reasonCode: warranty.reason_code,
          serviceName: input.config.serviceName,
          correlationId: `warranty-state:${tenantId}:${assetId}:${evaluatedOn}`,
        });
        refreshed += 1;
      }
    });
  }
  return { refreshed, evaluated_on: evaluatedOn };
}

export function warrantyStateProjectionTask(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  config: Config;
  reportFailure?: () => void;
}): WorkerTask {
  return {
    name: "asset-warranty-state-projection",
    async run(signal) {
      while (!signal.aborted) {
        try {
          await refreshWarrantyStateProjectionBatch(input);
        } catch {
          input.reportFailure?.();
        }
        await wait(signal, 60_000);
      }
    },
  };
}
