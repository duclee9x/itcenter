import test from "node:test";
import assert from "node:assert/strict";
import type { Transaction } from "../../packages/persistence/src/index.js";
import {
  KPI_CATALOG,
  aggregateKpiSnapshots,
  calculateKpi,
  validateDimensions,
} from "../../modules/reporting/index.js";
import { escapeCsvCell } from "../../apps/api/src/reporting-routes.js";

const kpiIds = [
  "OPS_OPEN_TICKETS_COUNT",
  "OPS_ACTIVE_INCIDENT_EPISODES_COUNT",
  "OPS_ACTIONABLE_WORK_QUEUE_COUNT",
  "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
  "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT",
  "KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT",
  "ASSET_CRITICAL_RISK_COUNT",
  "ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT",
  "PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY",
].sort();

test("TASK-095 catalog is exactly the governed nine KPI definitions", () => {
  assert.deepEqual(Object.keys(KPI_CATALOG).sort(), kpiIds);
  for (const definition of Object.values(KPI_CATALOG)) {
    assert.equal(definition.version, 1);
    assert.ok(Array.isArray(definition.dimensions));
  }
});

test("TASK-095 validates only governed dimensions and canonical dimension values", () => {
  assert.doesNotThrow(() =>
    validateDimensions("OPS_OPEN_TICKETS_COUNT", { priority: "P2" }),
  );
  assert.throws(
    () => validateDimensions("OPS_OPEN_TICKETS_COUNT", { priority: "HIGH" }),
    { code: "VALIDATION_ERROR" },
  );
  assert.doesNotThrow(() =>
    validateDimensions("OPS_ACTIONABLE_WORK_QUEUE_COUNT", {
      priority: "HIGH",
      source_type: "ASSET_RISK_REVIEW",
    }),
  );
  assert.throws(
    () =>
      validateDimensions("OPS_ACTIVE_INCIDENT_EPISODES_COUNT", {
        root_incident_id: "any-column",
      }),
    { code: "VALIDATION_ERROR" },
  );
});

test("TASK-095 ratio ranges sum numerator and denominator, never daily percentages", () => {
  const result = aggregateKpiSnapshots(
    "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
    [
      { numerator: 1, denominator: 1, status: "COMPLETE" },
      { numerator: 1, denominator: 9, status: "COMPLETE" },
    ],
  );
  assert.deepEqual(result, {
    numerator: 2,
    denominator: 10,
    value: 20,
    unit: "PERCENT",
    status: "COMPLETE",
  });
});

test("TASK-095 point-in-time counts remain a time series and missing snapshots are not zero", () => {
  assert.deepEqual(
    aggregateKpiSnapshots("OPS_OPEN_TICKETS_COUNT", [
      { value: 20 },
      { value: 25 },
      { value: 30 },
    ]),
    {
      mode: "DAILY_POINT_IN_TIME",
      time_series: [{ value: 20 }, { value: 25 }, { value: 30 }],
      status: "COMPLETE",
    },
  );
  assert.deepEqual(aggregateKpiSnapshots("OPS_OPEN_TICKETS_COUNT", []), {
    mode: "DAILY_POINT_IN_TIME",
    time_series: [],
    status: "UNAVAILABLE",
    reason: "NO_SNAPSHOT_AVAILABLE",
  });
  assert.equal(
    aggregateKpiSnapshots("OPS_OPEN_TICKETS_COUNT", [
      { value: 3, status: "COMPLETE" },
      { value: null, status: "UNAVAILABLE" },
    ]).status,
    "UNAVAILABLE",
  );
});

test("TASK-095 distinguishes source failure from an empty successful count", async () => {
  const tx = {
    tenantId: "tenant-a",
    async query(sql: string) {
      if (/^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT)/.test(sql))
        return { rows: [], rowCount: 0 };
      throw new Error("source unavailable");
    },
  } as unknown as Transaction;
  const failed = await calculateKpi({
    tx,
    kpiId: "OPS_OPEN_TICKETS_COUNT",
    from: "2026-09-10T00:00:00Z",
    to: "2026-09-11T00:00:00Z",
    asOf: "2026-09-11T00:00:00Z",
  });
  assert.equal(failed.status, "UNAVAILABLE");
  assert.equal(failed.value, null);
  assert.equal(failed.freshness, "UNAVAILABLE");
});

test("TASK-095 rejects non-UTC as_of timestamps independent of server timezone", async () => {
  const tx = {
    tenantId: "tenant-a",
    async query() {
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Transaction;
  await assert.rejects(
    calculateKpi({
      tx,
      kpiId: "OPS_OPEN_TICKETS_COUNT",
      from: "2026-09-10T00:00:00Z",
      to: "2026-09-11T00:00:00Z",
      asOf: "2026-09-11T00:00:00+07:00",
    }),
    { code: "VALIDATION_ERROR" },
  );
});

test("TASK-095 CSV escapes formula triggers without mutating canonical values", () => {
  for (const value of ["=1+1", "+cmd", "-1+2", "@SUM(A1:A2)"]) {
    assert.equal(escapeCsvCell(value), `'${value}`);
    assert.equal(value[0], value.charAt(0));
  }
  assert.equal(escapeCsvCell("ordinary,value"), '"ordinary,value"');
});
