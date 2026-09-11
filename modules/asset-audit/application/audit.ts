import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
export async function startAudit(input: { tx: Transaction; name: string }) {
  if (!input.name.trim())
    throw new ApplicationError("VALIDATION_ERROR", "Audit name is required.");
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO audit_ops.audits(id,tenant_id,name) VALUES($1,$2,$3)",
    [id, input.tx.tenantId, input.name],
  );
  return { id, name: input.name, state: "OPEN" };
}
export async function recordObservation(input: {
  tx: Transaction;
  auditId: string;
  assetId: string;
  expected: unknown;
  observed: unknown;
  exceptionType: string;
}) {
  const match =
    JSON.stringify(input.expected) === JSON.stringify(input.observed);
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO audit_ops.audit_observations(id,tenant_id,audit_id,asset_id,expected,observed,match) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      id,
      input.tx.tenantId,
      input.auditId,
      input.assetId,
      JSON.stringify(input.expected),
      JSON.stringify(input.observed),
      match,
    ],
  );
  let exceptionId: string | null = null;
  if (!match) {
    exceptionId = randomUUID();
    await input.tx.query(
      "INSERT INTO audit_ops.audit_exceptions(id,tenant_id,observation_id,asset_id,exception_type,expected,observed) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        exceptionId,
        input.tx.tenantId,
        id,
        input.assetId,
        input.exceptionType,
        JSON.stringify(input.expected),
        JSON.stringify(input.observed),
      ],
    );
  }
  return { observation_id: id, match, exception_id: exceptionId };
}
export async function resolveException(input: {
  tx: Transaction;
  exceptionId: string;
  reason: string;
}) {
  if (!input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Resolution reason is required.",
    );
  const result = await input.tx.query(
    "UPDATE audit_ops.audit_exceptions SET state='RESOLVED',resolution_reason=$1,resolved_at=now() WHERE tenant_id=$2 AND id=$3 AND state='OPEN' RETURNING id,asset_id,state",
    [input.reason, input.tx.tenantId, input.exceptionId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Open audit exception was not found.",
    );
  return result.rows[0]!;
}
