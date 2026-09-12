export const contractStates = [
  "DRAFT",
  "PENDING_SIGNATURE",
  "EXECUTED",
  "ACTIVE",
  "EXPIRED",
  "TERMINATED",
  "CANCELLED",
] as const;
export type ContractState = (typeof contractStates)[number];
export const contractCommands = [
  "CONTRACT.CREATE",
  "CONTRACT.UPDATE_DRAFT",
  "CONTRACT.SUBMIT_FOR_SIGNATURE",
  "CONTRACT.RECALL_SIGNATURE",
  "CONTRACT.RECORD_EXECUTION",
  "CONTRACT.ACTIVATE",
  "CONTRACT.HOLD",
  "CONTRACT.RESUME",
  "CONTRACT.AMEND",
  "CONTRACT.EXPIRE",
  "CONTRACT.TERMINATE",
  "CONTRACT.CANCEL",
  "RENEWAL.OPEN",
  "RENEWAL.UPDATE_PROPOSAL",
  "RENEWAL.COMPLETE",
  "RENEWAL.MARK_NOT_RENEWED",
  "RENEWAL.CANCEL",
] as const;

export function mayTransition(from: ContractState, command: string) {
  const transitions: Record<string, ContractState[]> = {
    "CONTRACT.UPDATE_DRAFT": ["DRAFT"],
    "CONTRACT.SUBMIT_FOR_SIGNATURE": ["DRAFT"],
    "CONTRACT.RECALL_SIGNATURE": ["PENDING_SIGNATURE"],
    "CONTRACT.RECORD_EXECUTION": ["PENDING_SIGNATURE"],
    "CONTRACT.ACTIVATE": ["EXECUTED"],
    "CONTRACT.TERMINATE": ["EXECUTED", "ACTIVE"],
    "CONTRACT.EXPIRE": ["ACTIVE"],
    "CONTRACT.CANCEL": ["DRAFT", "PENDING_SIGNATURE"],
    "CONTRACT.AMEND": ["EXECUTED", "ACTIVE"],
  };
  return transitions[command]?.includes(from) ?? false;
}

export const permissions: ReadonlyArray<{
  code: string;
  resource_type: string;
  action: string;
}> = [
  { code: "contract.read", resource_type: "contract", action: "read" },
  { code: "contract.create", resource_type: "contract", action: "create" },
  { code: "contract.update", resource_type: "contract", action: "update" },
  { code: "contract.execute", resource_type: "contract", action: "execute" },
  {
    code: "contract.lifecycle",
    resource_type: "contract",
    action: "lifecycle",
  },
  { code: "contract.amend", resource_type: "contract", action: "amend" },
  { code: "contract.renew", resource_type: "contract", action: "renew" },
  {
    code: "contract.terminate",
    resource_type: "contract",
    action: "terminate",
  },
  {
    code: "commercial_document.read",
    resource_type: "commercial_document",
    action: "read",
  },
  {
    code: "commercial_document.write",
    resource_type: "commercial_document",
    action: "write",
  },
  {
    code: "commercial_document.finalize",
    resource_type: "commercial_document",
    action: "finalize",
  },
];
