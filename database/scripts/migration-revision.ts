import {
  migrationManifestRevision,
  readExpectedMigrationManifest,
} from "../../packages/persistence/src/index.js";

const manifest = await readExpectedMigrationManifest();
process.stdout.write(`${migrationManifestRevision(manifest)}\n`);
