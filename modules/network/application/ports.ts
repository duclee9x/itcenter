import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

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

/** Provider-neutral boundary for a future NETCONF/RESTCONF device adapter.
 * Implementations must verify the target, capture restorable pre-change state,
 * verify read-back after apply, and support compensation. Never pass credentials
 * through this port; adapters resolve secret references from the secret store.
 */
export interface NetworkConfigurationPort {
  snapshot(input: NetworkTarget): Promise<NetworkSnapshot>;
  apply(input: NetworkApplyRequest): Promise<{ operationId: string }>;
  verify(input: NetworkApplyRequest): Promise<{
    passed: boolean;
    observedVlan: string | null;
    evidence: Readonly<Record<string, unknown>>;
  }>;
  restore(input: NetworkRestoreRequest): Promise<{ operationId: string }>;
}

export interface NetworkTarget {
  deviceId: string;
  portId: string;
  signal?: AbortSignal;
}

export interface NetworkSnapshot {
  observedVlan: string;
  opaqueConfiguration: Readonly<Record<string, unknown>>;
}

export interface NetworkApplyRequest extends NetworkTarget {
  changeId: string;
  desiredVlan: string;
  previous: NetworkSnapshot;
}

export interface NetworkRestoreRequest extends NetworkTarget {
  changeId: string;
  previous: NetworkSnapshot;
}

/** Default wiring deliberately performs no network I/O. */
export const unavailableNetworkConfiguration: NetworkConfigurationPort = {
  async snapshot() {
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "No network configuration adapter is configured.",
      true,
    );
  },
  async apply() {
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "No network configuration adapter is configured.",
      true,
    );
  },
  async verify() {
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "No network configuration adapter is configured.",
      true,
    );
  },
  async restore() {
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "No network configuration adapter is configured.",
      true,
    );
  },
};

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
