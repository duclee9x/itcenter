export { registerRule, setKillSwitch } from "./application/rules.js";
export {
  activateRule,
  createRule,
  deactivateRule,
  denyUnconfiguredAutomationPrincipal,
  denyUnconfiguredAutomationPolicy,
  evaluateEvent,
  getIntent,
  publishVersion,
  recheckIntentApproval,
  resolveConflict,
  simulateRule,
  setScopedKillSwitch,
  updateDraft,
  type AutomationEvent,
  type RuleDefinition,
} from "./application/engine.js";
export type {
  ActionAuthorization,
  ActionCapabilityPort,
  AutomationPolicyPort,
  AutomationTargetPort,
} from "./application/ports.js";
export {
  denyUnconfiguredActionCapabilities,
  denyUnconfiguredAutomationTarget,
} from "./application/ports.js";
export { PostgresAutomationSecurity } from "./infrastructure/postgres-security.js";
export {
  createActionPolicyDraft,
  updateActionPolicyDraft,
  activateActionPolicy,
  deactivateActionPolicy,
} from "./application/policies.js";
export type { ActionPolicyDraft } from "./application/policies.js";
export { ACTION_CAPABILITY_CATALOG } from "./domain/capabilities.js";
export { evaluateCondition, validateRuleDefinition } from "./domain/rules.js";
export const permissions = [
  {
    code: "automation.rule.read",
    resource_type: "automation_rule",
    action: "read",
  },
  {
    code: "automation.rule.create",
    resource_type: "automation_rule",
    action: "create",
  },
  {
    code: "automation.rule.edit",
    resource_type: "automation_rule",
    action: "edit",
  },
  {
    code: "automation.simulate",
    resource_type: "automation_rule",
    action: "simulate",
  },
  {
    code: "automation.activate_low_risk",
    resource_type: "automation_rule",
    action: "activate_low_risk",
  },
  {
    code: "automation.activate_high_risk",
    resource_type: "automation_rule",
    action: "activate_high_risk",
  },
  {
    code: "automation.disable",
    resource_type: "automation_rule",
    action: "disable",
  },
  {
    code: "automation.intent.read",
    resource_type: "action_intent",
    action: "read",
  },
  {
    code: "automation.intent.resolve",
    resource_type: "automation_conflict",
    action: "resolve",
  },
  {
    code: "automation.policy.read",
    resource_type: "automation_action_policy",
    action: "read",
  },
  {
    code: "automation.policy.create",
    resource_type: "automation_action_policy",
    action: "create",
  },
  {
    code: "automation.policy.update",
    resource_type: "automation_action_policy",
    action: "update",
  },
  {
    code: "automation.policy.activate",
    resource_type: "automation_action_policy",
    action: "activate",
  },
] as const;
