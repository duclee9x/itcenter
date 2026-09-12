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
]);
const server = createHttpServer(config, async () => false);
server.listen(config.port, config.host, () => log("info", "started"));
installShutdown(server, async () => {
  await host.stop();
  await pool.end();
});
