import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCondition,
  validateRuleDefinition,
  type Condition,
} from "../../modules/automation/domain/rules.js";

test("automation condition evaluator supports typed scalar, threshold and set predicates", () => {
  const condition: Condition = {
    all: [
      { path: "event.cpu", op: "greater_than_or_equal", value: 90 },
      { path: "event.enabled", op: "equals", value: true },
      { path: "event.health", op: "in", value: ["CRITICAL", "DEGRADED"] },
      { path: "event.labels", op: "contains", value: "managed" },
      { path: "context.site", op: "not_equals", value: "restricted" },
    ],
  };
  const result = evaluateCondition(
    condition,
    { cpu: 93, enabled: true, health: "CRITICAL", labels: ["managed"] },
    { site: "hq" },
  );
  assert.equal(result.matched, true);
  assert.ok(result.evidence.length > 1);
});

test("automation evaluator hashes string evidence and handles missing paths deterministically", () => {
  const result = evaluateCondition(
    { path: "event.email", op: "exists" },
    { email: "private@example.invalid" },
    {},
  );
  assert.equal(result.matched, true);
  const evidence = result.evidence[0] as {
    actual: { value_type: string; length: number };
  };
  assert.equal(evidence.actual.value_type, "string");
  assert.equal(evidence.actual.length, 23);
});

test("rule validation rejects scheduled, temporal, executable and unsafe definitions", () => {
  const base = {
    trigger: { type: "EVENT", event_type: "MONITORING.CRITICAL" },
    condition: { path: "event.cpu", op: "greater_than", value: 90 },
    action: {
      target_type: "ASSET",
      target_id: "asset-1",
      action_domain: "asset",
      action_type: "CREATE_TICKET",
      parameters: { summary: "review" },
      exclusivity_group: "ASSET_ACTION",
    },
    safetyLevel: "SAFE",
  };
  validateRuleDefinition(base);
  assert.throws(
    () =>
      validateRuleDefinition({
        ...base,
        trigger: { type: "CRON", expression: "* * * * *" },
      }),
    /only canonical EVENT/,
  );
  assert.throws(
    () =>
      validateRuleDefinition({
        ...base,
        condition: { path: "event.cpu", op: "for_minutes", value: 5 },
      }),
    /unsupported condition operator/,
  );
  assert.throws(
    () =>
      validateRuleDefinition({
        ...base,
        trigger: { type: "EVENT", event_type: "AUTOMATION.INTENT_READY" },
      }),
    /cannot trigger/,
  );
  assert.throws(
    () =>
      validateRuleDefinition({
        ...base,
        action: { ...base.action, action_type: "EXECUTE_SCRIPT" },
      }),
    /not allow-listed/,
  );
  assert.throws(
    () =>
      validateRuleDefinition({
        ...base,
        condition: { path: "event.__proto__.x", op: "exists" },
      }),
    /invalid condition path/,
  );
  assert.throws(
    () =>
      validateRuleDefinition({
        ...base,
        condition: {
          path: "event.value",
          op: "matches_regex",
          value: "(a+)+$",
        },
      }),
    /bounded safe subset/,
  );
});

test("automation action definitions require declared conflict semantics", () => {
  const base = {
    trigger: { type: "EVENT", event_type: "TICKET.CREATED" },
    condition: { path: "event.priority", op: "equals", value: "HIGH" },
    action: {
      target_type: "TICKET",
      target_id: "ticket-1",
      action_domain: "helpdesk",
      action_type: "ASSIGN_TEAM",
      parameters: { team_id: "team-a" },
      exclusivity_group: "TICKET_ASSIGNMENT",
    },
    safetyLevel: "CONTROLLED",
  };
  assert.throws(
    () => validateRuleDefinition(base),
    /requires declared desired_state/,
  );
});
