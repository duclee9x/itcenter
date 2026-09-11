import {
  loadConfig,
  databaseUrl,
  EnvironmentSecretProvider,
} from "../../packages/config/src/index.js";
import { createPool } from "../../packages/persistence/src/index.js";
import { migrate } from "./runner.js";
const pool = createPool(
  databaseUrl(
    loadConfig(process.env),
    new EnvironmentSecretProvider(process.env),
  ),
);
try {
  await migrate(pool);
} finally {
  await pool.end();
}
