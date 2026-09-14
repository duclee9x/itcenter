import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateReadiness,
  asReadinessSnapshot,
  publicReadiness,
  ReadinessCheckCache,
} from "../../packages/observability/src/readiness.js";
import {
  WORKER_DEFINITIONS,
  WorkerRegistry,
} from "../../apps/worker/src/host.js";
import { agentGatewayReadiness } from "../../apps/agent-gateway/src/readiness.js";

const component = (
  id: string,
  state: "STARTING" | "READY" | "DEGRADED" | "NOT_READY" | "STOPPING",
  criticality: "MANDATORY" | "DEGRADABLE",
) => ({ id, state, criticality });

test("readiness aggregation preserves required/degradable and drain semantics", () => {
  assert.equal(
    aggregateReadiness("API", [component("database", "READY", "MANDATORY")])
      .status,
    "READY",
  );
  assert.equal(
    aggregateReadiness("WORKER", [
      component("mandatory", "READY", "MANDATORY"),
      component("optional", "NOT_READY", "DEGRADABLE"),
    ]).status,
    "DEGRADED",
  );
  assert.equal(
    aggregateReadiness("WORKER", [
      component("mandatory", "READY", "MANDATORY"),
      component("optional", "STARTING", "DEGRADABLE"),
    ]).status,
    "READY",
  );
  assert.equal(
    aggregateReadiness("WORKER", [
      component("mandatory", "DEGRADED", "MANDATORY"),
    ]).status,
    "NOT_READY",
  );
  assert.equal(
    aggregateReadiness(
      "WORKER",
      [component("mandatory", "READY", "MANDATORY")],
      true,
    ).status,
    "NOT_READY",
  );
  assert.equal(asReadinessSnapshot(false, "API").status, "NOT_READY");
});

test("public readiness excludes internal timestamps and restart diagnostics", () => {
  const status = aggregateReadiness("WORKER", [
    {
      ...component("search-indexer", "NOT_READY", "DEGRADABLE"),
      reasonCode: "WORKER_HEARTBEAT_STALE",
      lastHeartbeatAt: "2026-09-15T00:00:00.000Z",
      startedAt: "2026-09-14T00:00:00.000Z",
      generation: 3,
      restartCount: 2,
    },
  ]);
  assert.deepEqual(publicReadiness(status), {
    profile: "WORKER",
    status: "DEGRADED",
    components: [
      {
        id: "search-indexer",
        state: "NOT_READY",
        reason_code: "WORKER_HEARTBEAT_STALE",
      },
    ],
  });
});

test("readiness probe cache bounds staleness and fails closed", async () => {
  let now = 100;
  let calls = 0;
  let available = true;
  const cache = new ReadinessCheckCache(50, () => now);
  const probe = async () => {
    calls += 1;
    if (!available) throw new Error("private detail");
    return available;
  };
  assert.equal(await cache.check("oidc", probe), true);
  available = false;
  now += 49;
  assert.equal(await cache.check("oidc", probe), true);
  now += 2;
  assert.equal(await cache.check("oidc", probe), false);
  assert.equal(calls, 2);
});

test("Agent Gateway isolates mandatory mTLS from degradable certificate issuance", () => {
  const base = [
    component("database", "READY", "MANDATORY"),
    component("schema", "READY", "MANDATORY"),
  ];
  const issuerUnavailable = agentGatewayReadiness(base, true, false);
  assert.equal(issuerUnavailable.status, "DEGRADED");
  assert.equal(
    issuerUnavailable.components.find(
      (item) => item.id === "agent-certificate-issuer",
    )?.reasonCode,
    "AGENT_CERTIFICATE_ISSUER_UNAVAILABLE",
  );
  assert.equal(agentGatewayReadiness(base, false, true).status, "NOT_READY");
});

const expectedNames = [
  "license-entitlement-expiry",
  "search-indexer",
  "goods-receipt-assetizer",
  "contract-alert-expiry",
  "cost-provenance-linker",
  "automation-rule-evaluator",
  "automation-conflict-work-items",
  "automation-action-executions",
  "incident-correlation",
  "asset-warranty-state-projection",
  "asset-risk-replacement-scoring",
  "reporting-governed-kpi-snapshots",
  "recommendation-source-reconciliation",
];

test("worker runtime inventory exactly matches R1 criticality and durable replica contract", () => {
  assert.deepEqual(
    WORKER_DEFINITIONS.map(({ name }) => name),
    expectedNames,
  );
  assert.equal(WORKER_DEFINITIONS.length, 13);
  assert.deepEqual(
    WORKER_DEFINITIONS.filter(
      (worker) => worker.criticality === "MANDATORY",
    ).map(({ name }) => name),
    [
      "goods-receipt-assetizer",
      "contract-alert-expiry",
      "automation-action-executions",
    ],
  );
  assert.equal(
    WORKER_DEFINITIONS.filter((worker) => worker.criticality === "DEGRADABLE")
      .length,
    10,
  );
  for (const worker of WORKER_DEFINITIONS) {
    assert.equal(worker.replicaMode, "CONCURRENT_SAFE");
    assert.ok(worker.coordination.length > 10);
  }
});

test("worker registry aggregates stale heartbeats by exact R1 criticality and recovers", () => {
  let now = 10_000;
  const registry = new WorkerRegistry(
    WORKER_DEFINITIONS,
    () => now,
    45_000,
    60_000,
  );
  assert.equal(registry.snapshot().status, "NOT_READY");
  for (const name of registry.expectedNames) {
    registry.register(name, 1);
    registry.heartbeat(name, 1);
  }
  assert.equal(registry.snapshot().status, "READY");
  now += 45_001;
  assert.equal(registry.snapshot().status, "NOT_READY");
  for (const name of registry.expectedNames) registry.heartbeat(name, 1);
  assert.equal(registry.snapshot().status, "READY");
  registry.fail("search-indexer", 1, "WORKER_EXITED_UNEXPECTEDLY");
  assert.equal(registry.snapshot().status, "DEGRADED");
  registry.heartbeat("search-indexer", 1);
  assert.equal(registry.snapshot().status, "READY");
  registry.fail(
    "automation-action-executions",
    1,
    "WORKER_EXITED_UNEXPECTEDLY",
  );
  assert.equal(registry.snapshot().status, "NOT_READY");
  registry.stop();
  assert.equal(registry.snapshot().status, "NOT_READY");
});

test("worker startup deadline classifies a missing mandatory worker as not ready", () => {
  let now = 1000;
  const registry = new WorkerRegistry(
    WORKER_DEFINITIONS,
    () => now,
    45_000,
    60_000,
  );
  for (const name of registry.expectedNames) {
    if (name === "contract-alert-expiry") continue;
    registry.register(name, 1);
    registry.heartbeat(name, 1);
  }
  assert.equal(registry.snapshot().status, "NOT_READY");
  now += 60_001;
  const snapshot = registry.snapshot();
  assert.equal(snapshot.status, "NOT_READY");
  assert.equal(
    snapshot.components.find((item) => item.id === "contract-alert-expiry")
      ?.reasonCode,
    "WORKER_STARTUP_TIMEOUT",
  );
});
