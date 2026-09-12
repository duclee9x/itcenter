import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "../../persistence/src/index.js";
import type { Json } from "../../shared-kernel/src/index.js";
import { ApplicationError } from "../../api-contracts/src/index.js";
function canonical(v: Json): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]!))
        .join(",") +
      "}"
    );
  if (typeof v === "number" && !Number.isFinite(v))
    throw new ApplicationError("VALIDATION_ERROR", "Non-finite request value.");
  return JSON.stringify(v);
}
export function requestHash(value: Json): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export interface IdempotencyIntent {
  principalId: string;
  operation: string;
  businessScope: string;
  key: string;
  semanticRequest: Json;
  expiresAt: Date;
}
export interface StoredResponse {
  status: number;
  body: Json;
}
export interface IdempotencyStore {
  execute(
    intent: IdempotencyIntent,
    work: () => Promise<StoredResponse>,
  ): Promise<StoredResponse>;
}
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly tx: Transaction) {}
  async findPrevious(i: IdempotencyIntent): Promise<StoredResponse | null> {
    if (
      ![i.principalId, i.operation, i.businessScope, i.key].every((s) =>
        s.trim(),
      )
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Idempotency scope is required.",
      );
    const scope = [
      this.tx.tenantId,
      i.principalId,
      i.operation,
      i.businessScope,
      i.key,
    ];
    const previous = await this.tx.query(
      "SELECT request_hash,state,response_status,result_reference,expires_at FROM platform.idempotency_records WHERE tenant_id=$1 AND principal_id=$2 AND operation=$3 AND business_scope=$4 AND idempotency_key=$5",
      scope,
    );
    if (!previous.rowCount) return null;
    const row = previous.rows[0]!;
    if (new Date(row.expires_at).getTime() <= Date.now())
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "Idempotency key has expired and cannot be reused.",
      );
    if (row.request_hash !== requestHash(i.semanticRequest))
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "Key was used with a different request.",
      );
    if (row.state !== "SUCCEEDED")
      throw new ApplicationError(
        "OPERATION_IN_PROGRESS",
        "Original operation requires reconciliation.",
      );
    return { status: Number(row.response_status), body: row.result_reference };
  }

  async execute(
    i: IdempotencyIntent,
    work: () => Promise<StoredResponse>,
  ): Promise<StoredResponse> {
    if (
      ![i.principalId, i.operation, i.businessScope, i.key].every((s) =>
        s.trim(),
      )
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Idempotency scope is required.",
      );
    const scope = [
      this.tx.tenantId,
      i.principalId,
      i.operation,
      i.businessScope,
      i.key,
    ];
    const lock = await this.tx.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
      [JSON.stringify(scope)],
    );
    if (!lock.rows[0]!.acquired)
      throw new ApplicationError(
        "OPERATION_IN_PROGRESS",
        "The operation is in progress.",
      );
    const hash = requestHash(i.semanticRequest);
    const previous = await this.tx.query(
      "SELECT * FROM platform.idempotency_records WHERE tenant_id=$1 AND principal_id=$2 AND operation=$3 AND business_scope=$4 AND idempotency_key=$5",
      scope,
    );
    if (previous.rowCount) {
      const r = previous.rows[0]!;
      if (new Date(r.expires_at).getTime() <= Date.now())
        throw new ApplicationError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "Idempotency key has expired and cannot be reused.",
        );
      if (r.request_hash !== hash)
        throw new ApplicationError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "Key was used with a different request.",
        );
      if (r.state === "SUCCEEDED")
        return { status: r.response_status, body: r.result_reference };
      throw new ApplicationError(
        "OPERATION_IN_PROGRESS",
        "Original operation requires reconciliation.",
      );
    }
    const id = randomUUID();
    await this.tx.query(
      "INSERT INTO platform.idempotency_records(id,tenant_id,principal_id,operation,business_scope,idempotency_key,request_hash,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'IN_PROGRESS',$8)",
      [id, ...scope, hash, i.expiresAt],
    );
    const result = await work();
    await this.tx.query(
      "UPDATE platform.idempotency_records SET state='SUCCEEDED',response_status=$2,result_reference=$3 WHERE id=$1 AND tenant_id=$4",
      [id, result.status, JSON.stringify(result.body), this.tx.tenantId],
    );
    return result;
  }
}
