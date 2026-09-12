export const supplierTransitions: Readonly<Record<string, readonly string[]>> =
  {
    PROSPECT: ["APPROVED", "BLOCKED", "INACTIVE"],
    APPROVED: ["PREFERRED", "SUSPENDED", "BLOCKED", "INACTIVE"],
    PREFERRED: ["APPROVED", "SUSPENDED", "BLOCKED", "INACTIVE"],
    SUSPENDED: ["APPROVED", "BLOCKED", "INACTIVE"],
    BLOCKED: ["PROSPECT", "INACTIVE"],
    INACTIVE: ["PROSPECT"],
  };

export const supplierCommandContract = {
  APPROVE: {
    from: "PROSPECT",
    to: "APPROVED",
    permission: "supplier.approve",
    event: "SUPPLIER.APPROVED",
  },
  MARK_PREFERRED: {
    from: "APPROVED",
    to: "PREFERRED",
    permission: "supplier.approve",
    event: "SUPPLIER.PREFERRED",
  },
  REMOVE_PREFERRED: {
    from: "PREFERRED",
    to: "APPROVED",
    permission: "supplier.approve",
    event: "SUPPLIER.PREFERRED_REMOVED",
  },
  SUSPEND: {
    from: ["APPROVED", "PREFERRED"],
    to: "SUSPENDED",
    permission: "supplier.status.change",
    event: "SUPPLIER.SUSPENDED",
  },
  RESUME: {
    from: "SUSPENDED",
    to: "APPROVED",
    permission: "supplier.status.change",
    event: "SUPPLIER.RESUMED",
  },
  BLOCK: {
    from: ["PROSPECT", "APPROVED", "PREFERRED", "SUSPENDED"],
    to: "BLOCKED",
    permission: "supplier.block",
    event: "SUPPLIER.BLOCKED",
  },
  UNBLOCK: {
    from: "BLOCKED",
    to: "PROSPECT",
    permission: "supplier.block",
    event: "SUPPLIER.UNBLOCKED",
  },
  DEACTIVATE: {
    from: ["PROSPECT", "APPROVED", "PREFERRED", "SUSPENDED", "BLOCKED"],
    to: "INACTIVE",
    permission: "supplier.status.change",
    event: "SUPPLIER.DEACTIVATED",
  },
  REACTIVATE: {
    from: "INACTIVE",
    to: "PROSPECT",
    permission: "supplier.status.change",
    event: "SUPPLIER.REACTIVATED",
  },
} as const;

export type SupplierCommand = keyof typeof supplierCommandContract;

export class SupplierRuleError extends Error {
  constructor(
    public readonly rule: "UNSUPPORTED_COMMAND" | "INVALID_TRANSITION",
    message: string,
  ) {
    super(message);
  }
}

export function supplierCommand(input: string): SupplierCommand {
  if (input in supplierCommandContract) return input as SupplierCommand;
  throw new SupplierRuleError(
    "UNSUPPORTED_COMMAND",
    "Unsupported Supplier command.",
  );
}

export function assertSupplierTransition(from: string, to: string): void {
  if (!supplierTransitions[from]?.includes(to))
    throw new SupplierRuleError(
      "INVALID_TRANSITION",
      `Supplier cannot transition from ${from} to ${to}.`,
    );
}

export function supplierEligibility(state: string) {
  return {
    rfq_candidate: ["PROSPECT", "APPROVED", "PREFERRED"].includes(state),
    po_issue: ["APPROVED", "PREFERRED"].includes(state),
  };
}
