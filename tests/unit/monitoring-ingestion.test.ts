import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMonitoringEvent } from "../../modules/monitoring/index.js";

test("normalizes a provider-neutral critical monitoring event", () => {
  assert.deepEqual(
    normalizeMonitoringEvent({
      source: "zabbix",
      provider_event_id: "trigger-1",
      metric: "cpu.utilization",
      observed_value: 97,
      threshold: 90,
      severity: "CRITICAL",
      observed_at: "2026-09-12T10:00:00Z",
    }),
    {
      source: "zabbix",
      provider_event_id: "trigger-1",
      asset_id: null,
      service_id: null,
      metric: "cpu.utilization",
      observed_value: "97",
      threshold: "90",
      severity: "CRITICAL",
      observed_at: "2026-09-12T10:00:00.000Z",
    },
  );
});

test("rejects unsupported monitoring severity", () => {
  assert.throws(
    () =>
      normalizeMonitoringEvent({
        source: "agent",
        provider_event_id: "event-1",
        metric: "disk.full",
        observed_value: "x",
        severity: "UNKNOWN",
        observed_at: "2026-09-12T10:00:00Z",
      }),
    /Unsupported monitoring severity/,
  );
});
