import test from "node:test";
import assert from "node:assert/strict";
import { resolveContractAlertConfiguration } from "../../modules/contract/index.js";

test("TASK-076 renewal alert uses explicit date before period and no invented threshold", () => {
  const terms = {
    effective_at: "2026-01-01T00:00:00.000Z",
    end_at: "2026-12-31T00:00:00.000Z",
  };
  assert.deepEqual(resolveContractAlertConfiguration(terms), {
    valid: true,
    trigger: null,
  });
  assert.deepEqual(
    resolveContractAlertConfiguration({
      ...terms,
      renewal_notice_period_days: 30,
    }),
    {
      valid: true,
      trigger: {
        triggerAt: "2026-12-01T00:00:00.000Z",
        source: "NOTICE_PERIOD",
      },
    },
  );
  assert.deepEqual(
    resolveContractAlertConfiguration({
      ...terms,
      renewal_notice_date: "2026-11-01T00:00:00.000Z",
      renewal_notice_period_days: 30,
    }),
    {
      valid: true,
      trigger: {
        triggerAt: "2026-11-01T00:00:00.000Z",
        source: "EXPLICIT_DATE",
      },
    },
  );
});

test("TASK-076 invalid renewal notice terms return an actionable configuration error", () => {
  const base = {
    effective_at: "2026-01-01T00:00:00.000Z",
    end_at: "2026-12-31T00:00:00.000Z",
  };
  assert.deepEqual(
    resolveContractAlertConfiguration({ ...base, renewal_notice_date: "bad" }),
    {
      valid: false,
      errorCode: "INVALID_RENEWAL_NOTICE_DATE",
      field: "renewal_notice_date",
    },
  );
  assert.deepEqual(
    resolveContractAlertConfiguration({
      ...base,
      renewal_notice_period_days: 500,
    }),
    {
      valid: false,
      errorCode: "IMPOSSIBLE_RENEWAL_NOTICE_PERIOD",
      field: "renewal_notice_period_days",
    },
  );
});
