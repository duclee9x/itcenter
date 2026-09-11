import type { Transaction } from "./index.js";
export interface Operation {
  operation_id: string;
  type: string;
  target_type: string;
  target_id: string;
  state:
    "QUEUED" | "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  correlation_id: string;
  created_at: Date;
  updated_at: Date;
  error_code: string | null;
}
export class OperationRegistry {
  constructor(private readonly tx: Transaction) {}
  async enqueue(input: {
    operation_id: string;
    type: string;
    target_type: string;
    target_id: string;
    correlation_id: string;
  }): Promise<void> {
    await this.tx.query(
      "INSERT INTO platform.operations(operation_id,tenant_id,type,target_type,target_id,state,correlation_id) VALUES($1,$2,$3,$4,$5,'QUEUED',$6)",
      [
        input.operation_id,
        this.tx.tenantId,
        input.type,
        input.target_type,
        input.target_id,
        input.correlation_id,
      ],
    );
  }
  async find(id: string): Promise<Operation | null> {
    const result = await this.tx.query<Operation>(
      "SELECT operation_id,type,target_type,target_id,state,correlation_id,created_at,updated_at,error_code FROM platform.operations WHERE operation_id=$1 AND tenant_id=$2",
      [id, this.tx.tenantId],
    );
    return result.rows[0] ?? null;
  }
}
