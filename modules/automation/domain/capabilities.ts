import type { ActionDescriptor } from "./rules.js";

export interface ActionCapabilityDefinition {
  action_type: string;
  target_type: string;
  required_permission: string;
  safety_class: "SAFE_AUTOMATION" | "CONTROLLED" | "HIGH_RISK" | "PROHIBITED";
  automatic_execution_supported: boolean;
  approval_supported: boolean;
  approval_required: boolean;
  conflict_group: string;
  parameter_schema_json: Readonly<Record<string, unknown>>;
  executor_type: string;
  version: number;
}

// Catalog entries are reviewed code, not tenant-authored strings. The database
// row is checked against this definition before it can authorize an intent.
export const ACTION_CAPABILITY_CATALOG: readonly ActionCapabilityDefinition[] =
  [
    {
      action_type: "RESTART_AGENT",
      target_type: "AGENT",
      required_permission: "agent.restart",
      safety_class: "SAFE_AUTOMATION",
      automatic_execution_supported: true,
      approval_supported: true,
      approval_required: false,
      conflict_group: "AGENT_SERVICE_CONTROL",
      parameter_schema_json: {
        type: "object",
        additionalProperties: false,
        maxProperties: 0,
      },
      executor_type: "TASK091_AGENT_COMMAND",
      version: 1,
    },
  ];

export interface ActionCapability extends ActionCapabilityDefinition {
  id: string;
}

export function validateCapabilityAction(
  action: ActionDescriptor,
  capability: ActionCapabilityDefinition,
): boolean {
  return (
    action.action_type === capability.action_type &&
    action.target_type === capability.target_type &&
    action.action_domain === "agent" &&
    action.exclusivity_group === capability.conflict_group &&
    Object.keys(action.parameters).length === 0 &&
    action.desired_state === undefined
  );
}
