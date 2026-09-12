import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNetworkObservation } from "../../modules/network/index.js";

test("normalizes network identity, source, confidence and observation time", () => {
  assert.deepEqual(
    normalizeNetworkObservation({
      source_type: "agent",
      source: "endpoint-agent",
      source_event_id: "inventory-17",
      ip: "192.0.2.10",
      mac: "AA-BB-CC-DD-EE-FF",
      confidence: "high",
      observed_at: "2026-09-12T10:00:00Z",
    }),
    {
      source_type: "AGENT",
      source: "endpoint-agent",
      source_event_id: "inventory-17",
      observed_at: "2026-09-12T10:00:00.000Z",
      asset_id: null,
      ip: "192.0.2.10",
      mac: "aa:bb:cc:dd:ee:ff",
      hostname: null,
      vendor: null,
      model: null,
      operating_system: null,
      vlan: null,
      switch_name: null,
      port_name: null,
      confidence: "HIGH",
    },
  );
});

test("rejects observations without a usable IP or MAC identity", () => {
  assert.throws(
    () =>
      normalizeNetworkObservation({
        source_type: "ARP",
        source: "router-1",
        source_event_id: "event-1",
        ip: "not-an-ip",
        observed_at: "2026-09-12T10:00:00Z",
      }),
    /valid IPv4 or IPv6/,
  );
});
