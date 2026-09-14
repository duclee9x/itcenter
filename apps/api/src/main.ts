import {
  loadConfig,
  databaseUrl,
  EnvironmentSecretProvider,
} from "../../../packages/config/src/index.js";
import {
  createPool,
  PostgresUnitOfWork,
  PostgresReadiness,
  readExpectedMigrationManifest,
} from "../../../packages/persistence/src/index.js";
import {
  aggregateReadiness,
  logger,
  type ReadinessComponent,
} from "../../../packages/observability/src/index.js";
import { installShutdown } from "../../../packages/observability/src/lifecycle.js";
import { apiServer } from "./server.js";
import {
  unavailableAuthentication,
  type AuthenticationPort,
} from "../../../packages/auth/src/index.js";
import { OidcApiAuthentication } from "../../../modules/identity/infrastructure/oidc-authentication.js";
import { postgresAuthorization } from "./postgres-authorization.js";
const config = loadConfig(process.env, "api", 3000);
const log = logger(config);
const pool = createPool(
  databaseUrl(config, new EnvironmentSecretProvider(process.env)),
);
pool.on("error", () => log("error", "database.connection_error"));
const uow = new PostgresUnitOfWork(pool);
const migrationManifest = await readExpectedMigrationManifest();
const readiness = new PostgresReadiness(pool, migrationManifest);
let draining = false;
let authentication: AuthenticationPort;
try {
  authentication =
    config.authMode === "oidc"
      ? await OidcApiAuthentication.create({
          pool,
          uow,
          issuer: config.oidcIssuer!,
          audience: config.oidcAudience!,
          onEvent: (event) =>
            log(event === "success" ? "info" : "warn", `auth.${event}`),
        })
      : unavailableAuthentication;
} catch {
  await pool.end();
  throw new Error("Production authentication trust initialization failed");
}
if (config.authMode === "oidc") log("info", "auth.adapter.initialized");
const server = apiServer(
  config,
  async () => {
    if (draining)
      return aggregateReadiness("API", [
        {
          id: "runtime",
          state: "STOPPING",
          criticality: "MANDATORY",
        },
      ]);
    const components: ReadinessComponent[] = await readiness.components();
    return aggregateReadiness("API", components);
  },
  authentication,
  postgresAuthorization(uow),
  uow,
);
server.listen(config.port, config.host, () => log("info", "started"));
installShutdown(
  server,
  async () => {
    await pool.end();
  },
  () => {
    draining = true;
  },
);
