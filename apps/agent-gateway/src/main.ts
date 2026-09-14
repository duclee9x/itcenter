import {
  databaseUrl,
  EnvironmentSecretProvider,
} from "../../../packages/config/src/index.js";
import {
  createPool,
  PostgresReadiness,
  readExpectedMigrationManifest,
} from "../../../packages/persistence/src/index.js";
import {
  logger,
  ReadinessCheckCache,
} from "../../../packages/observability/src/index.js";
import { installShutdown } from "../../../packages/observability/src/lifecycle.js";
import { agentServer } from "./server.js";
import { unavailableAuthentication } from "../../../packages/auth/src/index.js";
import { PostgresUnitOfWork } from "../../../packages/persistence/src/index.js";
import { loadAgentGatewayRuntimeConfig } from "./runtime-config.js";
import { PostgresMtlsAgentAuthentication } from "../../../modules/agent/infrastructure/postgres-mtls-authentication.js";
import { OpenSslAgentCertificateIssuer } from "../../../modules/agent/infrastructure/openssl-agent-certificate-issuer.js";
import { agentGatewayReadiness } from "./readiness.js";
const runtime = loadAgentGatewayRuntimeConfig(process.env);
const { config } = runtime;
const log = logger(config);
const pool = createPool(
  databaseUrl(config, new EnvironmentSecretProvider(process.env)),
);
pool.on("error", () => log("error", "database.connection_error"));
const uow = new PostgresUnitOfWork(pool);
const migrationManifest = await readExpectedMigrationManifest();
const databaseSchemaReadiness = new PostgresReadiness(pool, migrationManifest);
const capabilityReadiness = new ReadinessCheckCache(5000);
const agentAuthentication =
  runtime.authenticationMode === "mtls"
    ? new PostgresMtlsAgentAuthentication(pool, uow, (event) =>
        log(event.endsWith("unavailable") ? "error" : "info", event),
      )
    : unavailableAuthentication;
const certificateIssuer = runtime.certificateAuthority
  ? new OpenSslAgentCertificateIssuer({
      caCertificatePem: runtime.certificateAuthority.certificatePem,
      caPrivateKeyPem: runtime.certificateAuthority.privateKeyPem,
      ...(runtime.certificateAuthority.passphrase
        ? { caPassphrase: runtime.certificateAuthority.passphrase }
        : {}),
    })
  : undefined;
let draining = false;
const server = agentServer(
  config,
  async () => {
    if (draining)
      return agentGatewayReadiness(
        [
          {
            id: "runtime",
            state: "STOPPING",
            criticality: "MANDATORY",
          },
        ],
        true,
        true,
        true,
      );
    const base = await databaseSchemaReadiness.components();
    const authenticationReady = await capabilityReadiness.check(
      "agent-authentication",
      async () => (await agentAuthentication.isReady?.()) === true,
    );
    const issuerReady = await capabilityReadiness.check(
      "agent-certificate-issuer",
      async () => (await certificateIssuer?.isReady()) === true,
    );
    return agentGatewayReadiness(base, authenticationReady, issuerReady, false);
  },
  agentAuthentication,
  uow,
  undefined,
  undefined,
  runtime.tlsOptions,
  certificateIssuer ? { pool, issuer: certificateIssuer } : undefined,
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
