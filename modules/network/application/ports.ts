import type { Transaction } from "../../../packages/persistence/src/index.js";

export interface NetworkExceptionQueuePort {
  createReference(input: {
    tx: Transaction;
    exceptionId: string;
    title: string;
    priority: string;
  }): Promise<void>;
  resolveReference(input: {
    tx: Transaction;
    exceptionId: string;
  }): Promise<void>;
}

export type NetworkException = {
  id: string;
  exception_type: "UNKNOWN_DEVICE" | "VLAN_MISMATCH" | "IP_CONFLICT";
  state: "OPEN" | "RESOLVED" | "ACCEPTED";
  source_observation_id: string;
  dedupe_key: string;
  expected: unknown;
  observed: unknown;
  version: number;
};
