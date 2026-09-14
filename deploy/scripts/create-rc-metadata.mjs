#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [
  releaseId,
  repository,
  digest,
  sourceCommit,
  buildTime,
  workflowUrl,
  lockfileSha,
  outputPath,
] = process.argv.slice(2);
const fail = () => {
  process.stderr.write("Invalid release metadata input.\n");
  process.exit(2);
};
if (
  !releaseId ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(releaseId) ||
  !repository ||
  /\s|@/.test(repository) ||
  !/^sha256:[a-f0-9]{64}$/.test(digest ?? "") ||
  !/^[a-f0-9]{40}$/i.test(sourceCommit ?? "") ||
  !buildTime ||
  !Number.isFinite(Date.parse(buildTime)) ||
  !workflowUrl?.startsWith("https://") ||
  !/^[a-f0-9]{64}$/.test(lockfileSha ?? "") ||
  !outputPath
)
  fail();

const manifestModule = await import(
  pathToFileURL(
    path.resolve("dist/packages/persistence/src/migration-manifest.js"),
  )
);
const manifest = await manifestModule.readExpectedMigrationManifest();
const schemaRevision = manifestModule.migrationManifestRevision(manifest);
const lockfile = await readFile("package-lock.json");
const actualLockSha = createHash("sha256").update(lockfile).digest("hex");
if (actualLockSha !== lockfileSha) fail();

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const record = {
  release_id: releaseId,
  application_version: pkg.version,
  source_repository: process.env.GITHUB_REPOSITORY ?? "unknown",
  source_commit: sourceCommit,
  image_repository: repository,
  image_digest: digest,
  schema_revision: schemaRevision,
  build_time: new Date(buildTime).toISOString(),
  dependency_lock_sha256: actualLockSha,
  workflow: workflowUrl,
  sbom: {
    status: "GENERATED",
    subject: `${repository}@${digest}`,
    reference: workflowUrl,
  },
  provenance: { status: "GENERATED", reference: workflowUrl },
  staging: { status: "PENDING" },
  production: { status: "PENDING" },
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
  flag: "wx",
});
