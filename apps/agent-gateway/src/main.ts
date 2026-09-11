import {
  loadConfig,
  databaseUrl,
  EnvironmentSecretProvider,
} from "../../../packages/config/src/index.js";
import { createPool } from "../../../packages/persistence/src/index.js";
import { logger } from "../../../packages/observability/src/index.js";
import { installShutdown } from "../../../packages/observability/src/lifecycle.js";
import { agentServer } from "./server.js";
import { unavailableAuthentication } from "../../../packages/auth/src/index.js";
import { databaseReady } from "../../../packages/persistence/src/index.js";
import { PostgresUnitOfWork } from "../../../packages/persistence/src/index.js";
const config = loadConfig(process.env, "agent-gateway", 3001);
const log = logger(config);
const pool = createPool(
  databaseUrl(config, new EnvironmentSecretProvider(process.env)),
);
pool.on("error", () => log("error", "database.connection_error"));
const server = agentServer(
  config,
  () => databaseReady(pool),
  unavailableAuthentication,
  new PostgresUnitOfWork(pool),
);
server.listen(config.port, config.host, () => log("info", "started"));
installShutdown(server, async () => {
  await pool.end();
});
