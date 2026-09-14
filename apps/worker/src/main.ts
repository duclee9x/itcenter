import {
  loadConfig,
  databaseUrl,
  EnvironmentSecretProvider,
} from "../../../packages/config/src/index.js";
import { createPool } from "../../../packages/persistence/src/index.js";
import { logger } from "../../../packages/observability/src/index.js";
import { installShutdown } from "../../../packages/observability/src/lifecycle.js";
import { createHttpServer } from "../../../packages/observability/src/index.js";
import { WorkerHost } from "./host.js";
import { PostgresUnitOfWork } from "../../../packages/persistence/src/index.js";
import { licenseExpiryTask } from "./license-expiry.js";
import { searchIndexerTask } from "./search-indexer.js";
import { goodsReceiptAssetizerTask } from "./goods-receipt-assetizer.js";
import { contractAlertTask } from "./contract-alerts.js";
import { costProvenanceTask } from "./cost-provenance.js";
import { automationEvaluatorTask } from "./automation-evaluator.js";
import { automationConflictWorkItemsTask } from "./automation-conflict-work-items.js";
import { automationExecutionTask } from "./automation-executions.js";
import { incidentCorrelationTask } from "./incident-correlation.js";
import { warrantyStateProjectionTask } from "./warranty-state-projection.js";
import { assetScoringTask } from "./asset-scoring.js";
import { reportingSnapshotTask } from "./reporting-snapshots.js";
import { recommendationReconciliationTask } from "./recommendations.js";
const config = loadConfig(process.env, "worker", 3002);
const log = logger(config);
const pool = createPool(
  databaseUrl(config, new EnvironmentSecretProvider(process.env)),
);
pool.on("error", () => log("error", "database.connection_error"));
const host = new WorkerHost();
host.start([
  licenseExpiryTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    config,
    reportFailure: () => log("error", "license.expiry.scan_failed"),
  }),
  searchIndexerTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    reportFailure: () => log("error", "search.indexer.failed"),
  }),
  goodsReceiptAssetizerTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    reportFailure: () =>
      log("error", "procurement.goods_receipt.assetization_failed"),
  }),
  contractAlertTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    config,
    reportFailure: () => log("error", "contract.alert_scheduler.failed"),
  }),
  costProvenanceTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    reportFailure: () => log("error", "procurement.cost_provenance.failed"),
  }),
  automationEvaluatorTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    reportFailure: () => log("error", "automation.evaluator.failed"),
  }),
  automationConflictWorkItemsTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    reportFailure: () => log("error", "automation.conflict_work_item.failed"),
  }),
  automationExecutionTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    reportFailure: () => log("error", "automation.execution.failed"),
  }),
  incidentCorrelationTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    reportFailure: () => log("error", "incident.correlation.failed"),
  }),
  warrantyStateProjectionTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    config,
    reportFailure: () => log("error", "asset.warranty_projection.failed"),
  }),
  assetScoringTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    config,
    reportFailure: () => log("error", "asset.scoring.failed"),
  }),
  reportingSnapshotTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    reportFailure: () => log("error", "reporting.snapshot.failed"),
  }),
  recommendationReconciliationTask({
    pool,
    uow: new PostgresUnitOfWork(pool),
    reportFailure: () => log("error", "recommendation.reconciliation.failed"),
  }),
]);
const server = createHttpServer(config, async () => false);
server.listen(config.port, config.host, () => log("info", "started"));
installShutdown(server, async () => {
  await host.stop();
  await pool.end();
});
