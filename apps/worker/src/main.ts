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
const host = new WorkerHost();
host.start([]);
const config = loadConfig(process.env, "worker", 3002);
const log = logger(config);
const pool = createPool(
  databaseUrl(config, new EnvironmentSecretProvider(process.env)),
);
pool.on("error", () => log("error", "database.connection_error"));
const server = createHttpServer(config, async () => false);
server.listen(config.port, config.host, () => log("info", "started"));
installShutdown(server, async () => {
  await host.stop();
  await pool.end();
});
