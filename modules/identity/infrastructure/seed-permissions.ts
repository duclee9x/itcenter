import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import type { Permission } from "../domain/model.js";
export async function seedPermissions(
  tx: Transaction,
  catalog: readonly Permission[],
): Promise<void> {
  if (new Set(catalog.map((p) => p.code)).size !== catalog.length)
    throw new Error("Duplicate permission registration");
  await tx.query("SELECT pg_advisory_xact_lock(70911002)");
  for (const p of catalog) {
    const row = await tx.query(
      "SELECT resource_type,action FROM identity.permissions WHERE code=$1",
      [p.code],
    );
    if (
      row.rowCount &&
      (row.rows[0]!.resource_type !== p.resource_type ||
        row.rows[0]!.action !== p.action)
    )
      throw new Error("Permission registration conflict");
    await tx.query(
      "INSERT INTO identity.permissions(id,code,resource_type,action) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO NOTHING",
      [randomUUID(), p.code, p.resource_type, p.action],
    );
  }
}
