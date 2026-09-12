import {
  permissions as identity,
  seedPermissions,
} from "../../modules/identity/index.js";
import { permissions as audit } from "../../modules/audit/index.js";
import { permissions as software } from "../../modules/software/index.js";
import { permissions as artifact } from "../../modules/artifact/index.js";
import { permissions as license } from "../../modules/license/index.js";
import {
  loadConfig,
  databaseUrl,
  EnvironmentSecretProvider,
} from "../../packages/config/src/index.js";
import {
  createPool,
  PostgresUnitOfWork,
} from "../../packages/persistence/src/index.js";
const pool = createPool(
  databaseUrl(
    loadConfig(process.env),
    new EnvironmentSecretProvider(process.env),
  ),
);
try {
  await new PostgresUnitOfWork(pool).run("platform-catalog", (tx) =>
    seedPermissions(tx, [
      ...identity,
      ...audit,
      ...software,
      ...artifact,
      ...license,
    ]),
  );
} finally {
  await pool.end();
}
