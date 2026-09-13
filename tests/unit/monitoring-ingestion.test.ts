import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMonitoringEvent } from "../../modules/monitoring/index.js";

test("normalizes a provider-neutral critical monitoring event", () => {
  assert.deepEqual(
    normalizeMonitoringEvent({
      source: "zabbix",
      provider_event_id: "trigger-1",
      source_correlation_key: null,
      metric: "cpu.utilization",
      observed_value: 97,
      threshold: 90,
      severity: "CRITICAL",
      observed_at: "2026-09-12T10:00:00Z",
    }),
    {
      source: "zabbix",
      provider_event_id: "trigger-1",
      source_correlation_key: null,
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

test("preserves canonical source correlation keys without punctuation rewriting", () => {
  const event = normalizeMonitoringEvent({
    source: "zabbix",
    provider_event_id: "trigger-2",
    source_correlation_key: "  Problem: AbC-01  ",
    metric: "cpu.utilization",
    observed_value: 97,
    severity: "CRITICAL",
    observed_at: "2026-09-12T10:00:00Z",
  });
  assert.equal(event.source_correlation_key, "Problem: AbC-01");
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
