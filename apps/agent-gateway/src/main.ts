import {
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
import { loadAgentGatewayRuntimeConfig } from "./runtime-config.js";
import { PostgresMtlsAgentAuthentication } from "../../../modules/agent/infrastructure/postgres-mtls-authentication.js";
import { OpenSslAgentCertificateIssuer } from "../../../modules/agent/infrastructure/openssl-agent-certificate-issuer.js";
const runtime = loadAgentGatewayRuntimeConfig(process.env);
const { config } = runtime;
const log = logger(config);
const pool = createPool(
  databaseUrl(config, new EnvironmentSecretProvider(process.env)),
);
pool.on("error", () => log("error", "database.connection_error"));
const uow = new PostgresUnitOfWork(pool);
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
const server = agentServer(
  config,
  async () =>
    (await databaseReady(pool)) &&
    (await agentAuthentication.isReady?.()) === true &&
    (await certificateIssuer?.isReady()) === true,
  agentAuthentication,
  uow,
  undefined,
  undefined,
  runtime.tlsOptions,
  certificateIssuer ? { pool, issuer: certificateIssuer } : undefined,
);
server.listen(config.port, config.host, () => log("info", "started"));
installShutdown(server, async () => {
  await pool.end();
});
