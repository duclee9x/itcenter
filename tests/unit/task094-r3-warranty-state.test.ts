import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateWarrantyState,
  warrantyStatePolicy,
} from "../../modules/maintenance/domain/warranty-state.js";

const record = (id: string, ends_at: string, starts_at = "2025-01-01") => ({
  id,
  starts_at,
  ends_at,
});

test("Warranty State Policy v1 uses UTC date boundaries and the 90-day threshold", () => {
  assert.equal(warrantyStatePolicy.expiring_within_days, 90);
  assert.equal(
    evaluateWarrantyState({
      records: [record("valid", "2026-04-02")],
      asOf: "2026-01-01T00:00:00-08:00",
    }).state,
    "VALID",
  );
  assert.equal(
    evaluateWarrantyState({
      records: [record("exact-90", "2026-04-01")],
      asOf: "2026-01-01T00:00:00.000Z",
    }).state,
    "EXPIRING",
  );
  for (const endsAt of ["2026-03-02", "2026-01-31", "2026-01-08", "2026-01-02"])
    assert.equal(
      evaluateWarrantyState({
        records: [record(`expiring-${endsAt}`, endsAt)],
        asOf: "2026-01-01T00:00:00Z",
      }).state,
      "EXPIRING",
    );
  assert.equal(
    evaluateWarrantyState({
      records: [record("expired", "2026-01-01")],
      asOf: "2026-01-01T00:00:00Z",
    }).state,
    "EXPIRED",
  );
});

test("Warranty state fails closed for no record, malformed dates and ambiguous effective coverage", () => {
  assert.equal(
    evaluateWarrantyState({ records: [], asOf: "2026-01-01T00:00:00Z" })
      .reason_code,
    "NO_WARRANTY",
  );
  assert.equal(
    evaluateWarrantyState({
      records: [record("bad", "2026-99-99")],
      asOf: "2026-01-01T00:00:00Z",
    }).reason_code,
    "INVALID_WARRANTY_EVIDENCE",
  );
  const ambiguous = evaluateWarrantyState({
    records: [record("one", "2026-06-01"), record("two", "2026-07-01")],
    asOf: "2026-01-01T00:00:00Z",
  });
  assert.equal(ambiguous.state, "UNKNOWN");
  assert.equal(ambiguous.reason_code, "AMBIGUOUS_WARRANTY_EVIDENCE");
});
