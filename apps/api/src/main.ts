import {
  loadConfig,
  databaseUrl,
  EnvironmentSecretProvider,
} from "../../../packages/config/src/index.js";
import { createPool } from "../../../packages/persistence/src/index.js";
import { logger } from "../../../packages/observability/src/index.js";
import { installShutdown } from "../../../packages/observability/src/lifecycle.js";
import { apiServer } from "./server.js";
import {
  unavailableAuthentication,
  denyAll,
} from "../../../packages/auth/src/index.js";
import {
  PostgresUnitOfWork,
  databaseReady,
} from "../../../packages/persistence/src/index.js";
const config = loadConfig(process.env, "api", 3000);
const log = logger(config);
const pool = createPool(
  databaseUrl(config, new EnvironmentSecretProvider(process.env)),
);
pool.on("error", () => log("error", "database.connection_error"));
const server = apiServer(
  config,
  () => databaseReady(pool),
  unavailableAuthentication,
  denyAll,
  new PostgresUnitOfWork(pool),
);
server.listen(config.port, config.host, () => log("info", "started"));
installShutdown(server, async () => {
  await pool.end();
});
