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

  async transition(input: {
    operationId: string;
    expectedVersion: number;
    from: Operation["state"];
    to: Operation["state"];
    errorCode?: string;
  }): Promise<void> {
    const allowed: Record<Operation["state"], Operation["state"][]> = {
      QUEUED: ["RUNNING", "CANCELLED"],
      RUNNING: ["WAITING", "SUCCEEDED", "FAILED", "CANCELLED"],
      WAITING: ["RUNNING", "FAILED", "CANCELLED"],
      SUCCEEDED: [],
      FAILED: [],
      CANCELLED: [],
    };
    if (!allowed[input.from].includes(input.to))
      throw new Error(
        `Invalid operation transition ${input.from} -> ${input.to}`,
      );
    const result = await this.tx.query(
      "UPDATE platform.operations SET state=$3,error_code=$4,version=version+1,updated_at=now() WHERE operation_id=$1 AND tenant_id=$2 AND state=$5 AND version=$6",
      [
        input.operationId,
        this.tx.tenantId,
        input.to,
        input.errorCode ?? null,
        input.from,
        input.expectedVersion,
      ],
    );
    if (!result.rowCount)
      throw new Error("Operation version or state conflict");
  }
}
