import test from "node:test";
import assert from "node:assert/strict";
import {
  supplierCommandContract,
  supplierEligibility,
  supplierTransitions,
} from "../../modules/procurement/index.js";

test("Supplier lifecycle transition graph matches the normative contract", () => {
  assert.deepEqual(supplierTransitions, {
    PROSPECT: ["APPROVED", "BLOCKED", "INACTIVE"],
    APPROVED: ["PREFERRED", "SUSPENDED", "BLOCKED", "INACTIVE"],
    PREFERRED: ["APPROVED", "SUSPENDED", "BLOCKED", "INACTIVE"],
    SUSPENDED: ["APPROVED", "BLOCKED", "INACTIVE"],
    BLOCKED: ["PROSPECT", "INACTIVE"],
    INACTIVE: ["PROSPECT"],
  });
  assert.equal(supplierTransitions.BLOCKED?.includes("APPROVED"), false);
  assert.equal(supplierTransitions.BLOCKED?.includes("PREFERRED"), false);
  assert.equal(supplierTransitions.INACTIVE?.includes("APPROVED"), false);
  assert.equal(supplierTransitions.INACTIVE?.includes("PREFERRED"), false);
  assert.equal(supplierCommandContract.RESUME.to, "APPROVED");
});

test("Supplier RFQ and PO eligibility is derived from canonical lifecycle state", () => {
  assert.deepEqual(supplierEligibility("PROSPECT"), {
    rfq_candidate: true,
    po_issue: false,
  });
  assert.deepEqual(supplierEligibility("APPROVED"), {
    rfq_candidate: true,
    po_issue: true,
  });
  assert.deepEqual(supplierEligibility("PREFERRED"), {
    rfq_candidate: true,
    po_issue: true,
  });
  for (const state of ["SUSPENDED", "BLOCKED", "INACTIVE"]) {
    assert.deepEqual(supplierEligibility(state), {
      rfq_candidate: false,
      po_issue: false,
    });
  }
});

test("Supplier lifecycle commands carry their exact granular permissions and events", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(supplierCommandContract).map(([command, rule]) => [
        command,
        [rule.permission, rule.event],
      ]),
    ),
    {
      APPROVE: ["supplier.approve", "SUPPLIER.APPROVED"],
      MARK_PREFERRED: ["supplier.approve", "SUPPLIER.PREFERRED"],
      REMOVE_PREFERRED: ["supplier.approve", "SUPPLIER.PREFERRED_REMOVED"],
      SUSPEND: ["supplier.status.change", "SUPPLIER.SUSPENDED"],
      RESUME: ["supplier.status.change", "SUPPLIER.RESUMED"],
      BLOCK: ["supplier.block", "SUPPLIER.BLOCKED"],
      UNBLOCK: ["supplier.block", "SUPPLIER.UNBLOCKED"],
      DEACTIVATE: ["supplier.status.change", "SUPPLIER.DEACTIVATED"],
      REACTIVATE: ["supplier.status.change", "SUPPLIER.REACTIVATED"],
    },
  );
});
