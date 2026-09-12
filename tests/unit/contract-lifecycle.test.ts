import test from "node:test";
import assert from "node:assert/strict";
import { contractStates, mayTransition } from "../../modules/contract/index.js";

test("TASK-075 Contract legal lifecycle is distinct from operational usage", () => {
  assert.deepEqual(contractStates, [
    "DRAFT",
    "PENDING_SIGNATURE",
    "EXECUTED",
    "ACTIVE",
    "EXPIRED",
    "TERMINATED",
    "CANCELLED",
  ]);
  assert.equal(mayTransition("DRAFT", "CONTRACT.SUBMIT_FOR_SIGNATURE"), true);
  assert.equal(
    mayTransition("PENDING_SIGNATURE", "CONTRACT.RECALL_SIGNATURE"),
    true,
  );
  assert.equal(mayTransition("ACTIVE", "CONTRACT.TERMINATE"), true);
  assert.equal(mayTransition("ACTIVE", "CONTRACT.CANCEL"), false);
  assert.equal(mayTransition("EXPIRED", "CONTRACT.ACTIVATE"), false);
  assert.equal(mayTransition("TERMINATED", "CONTRACT.AMEND"), false);
});
