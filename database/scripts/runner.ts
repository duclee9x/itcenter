import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type pg from "pg";
export async function migrate(
  pool: pg.Pool,
  root = path.resolve("database/migrations"),
): Promise<void> {
  const files: string[] = [];
  // Owners are ordered by schema dependencies. Network stays after Operations
  // because its compatibility migration extends the Work Queue. Software's
  // deployment migration references Artifact, so its catalog migration must
  // precede Artifact while later Software migrations run after it. License
  // entitlements reference Software products, so License migrations follow it.
  // Procurement references Identity requesters and owns Supplier/request data.
  const plan: { owner: string; before?: string; after?: string }[] = [
    ...[
      "platform",
      "identity",
      "communication",
      "control",
      "asset",
      "helpdesk",
      "problem",
      "audit",
      "audit_ops",
      "incident",
      "maintenance",
      "monitoring",
      "agent",
      "automation",
      "operations",
      "network",
    ].map((owner) => ({ owner })),
    { owner: "software", before: "20260912_002_deployment.sql" },
    { owner: "artifact" },
    { owner: "software", after: "20260912_001_catalog.sql" },
    { owner: "license" },
    { owner: "procurement" },
  ];
  for (const step of plan)
    for (const file of (await readdir(path.join(root, step.owner))).sort())
      if (
        file.endsWith(".sql") &&
        (!step.before || file < step.before) &&
        (!step.after || file > step.after)
      )
        files.push(path.join(step.owner, file));
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(70911000)");
    await client.query("CREATE SCHEMA IF NOT EXISTS migration_meta");
    await client.query(
      "CREATE TABLE IF NOT EXISTS migration_meta.applied(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of files) {
      const sql = await readFile(path.join(root, file), "utf8"),
        checksum = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query(
        "SELECT checksum FROM migration_meta.applied WHERE name=$1",
        [file],
      );
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${file}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO migration_meta.applied(name,checksum) VALUES($1,$2)",
          [file, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(70911000)");
    } finally {
      client.release();
    }
  }
}
