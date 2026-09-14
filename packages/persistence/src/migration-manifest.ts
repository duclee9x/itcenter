import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type MigrationStep = { owner: string; before?: string; after?: string };

const migrationPlan: readonly MigrationStep[] = [
  ...[
    "platform",
    "identity",
    "communication",
    "control",
    "asset",
    "helpdesk",
    "problem",
    "audit",
    "service",
    "audit_ops",
    "incident",
    "maintenance",
    "monitoring",
    "agent",
    "automation",
    "operations",
    "network",
  ].map((owner) =>
    owner === "asset"
      ? { owner, before: "20260912_010_received_unit_registration.sql" }
      : owner === "incident"
        ? {
            owner,
            before: "20260920_002_task094_monitoring_asset_link_backfill.sql",
          }
        : owner === "identity"
          ? { owner, before: "20260919_001_offboarding_asset_recovery.sql" }
          : owner === "operations"
            ? { owner, before: "20260914_001_contract_document_sources.sql" }
            : owner === "problem"
              ? {
                  owner,
                  before: "20260918_001_task093_knowledge_foundation.sql",
                }
              : { owner },
  ),
  {
    owner: "identity",
    after: "20260916_002_task092_correlation_permissions.sql",
  },
  { owner: "software", before: "20260912_002_deployment.sql" },
  { owner: "artifact" },
  { owner: "software", after: "20260912_001_catalog.sql" },
  { owner: "problem", after: "20260912_001_problem_change_knowledge.sql" },
  { owner: "license" },
  { owner: "procurement" },
  { owner: "asset", after: "20260912_009_replacement_retirement_disposal.sql" },
  { owner: "contract" },
  { owner: "document" },
  { owner: "operations", after: "20260912_006_asset_lifecycle_source.sql" },
  { owner: "reporting" },
  { owner: "recommendation" },
  { owner: "incident", after: "20260920_001_task094_asset_links.sql" },
  { owner: "automation", after: "20260912_001_safe_automation.sql" },
];

export interface MigrationManifestEntry {
  name: string;
  checksum: string;
}

export async function listMigrationFiles(
  root = path.resolve("database/migrations"),
): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const step of migrationPlan)
    for (const file of (await readdir(path.join(root, step.owner))).sort())
      if (
        file.endsWith(".sql") &&
        (!step.before || file < step.before) &&
        (!step.after || file > step.after)
      ) {
        const name = path.join(step.owner, file);
        if (!seen.has(name)) {
          seen.add(name);
          files.push(name);
        }
      }
  return files;
}

export async function readExpectedMigrationManifest(
  root = path.resolve("database/migrations"),
): Promise<MigrationManifestEntry[]> {
  const files = await listMigrationFiles(root);
  return Promise.all(
    files.map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(await readFile(path.join(root, name), "utf8"))
        .digest("hex"),
    })),
  );
}

export function migrationManifestRevision(
  manifest: readonly MigrationManifestEntry[],
): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}
