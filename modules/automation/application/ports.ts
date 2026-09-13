import type { ActionDescriptor, PolicyDecision } from "../domain/rules.js";
import type { ActionCapability } from "../domain/capabilities.js";

export interface AutomationTargetContext {
  tenantId: string;
  targetType: string;
  targetId: string;
  scope: Readonly<Record<string, string>>;
  scopeReference: string;
}

export interface ActionCapabilityPort {
  resolve(input: {
    action: ActionDescriptor;
  }): Promise<ActionCapability | null>;
}

export interface AutomationTargetPort {
  resolveTarget(input: {
    tenantId: string;
    targetType: string;
    targetId: string;
  }): Promise<AutomationTargetContext | null>;
}

export const denyUnconfiguredActionCapabilities: ActionCapabilityPort = {
  async resolve() {
    return null;
  },
};

export const denyUnconfiguredAutomationTarget: AutomationTargetPort = {
  async resolveTarget() {
    return null;
  },
};

export interface ActionAuthorization {
  authorize(input: {
    tenantId: string;
    capability: ActionCapability;
    target: AutomationTargetContext;
    correlationId: string;
  }): Promise<{
    allowed: boolean;
    reasonCode: string;
    principalId: string | null;
    permission: string;
    scopeReference: string | null;
  }>;
}

export interface AutomationPolicyPort {
  decide(input: {
    tenantId: string;
    safetyLevel: string;
    requiresApproval: boolean;
    action: ActionDescriptor;
    capability: ActionCapability;
    target: AutomationTargetContext;
    correlationId: string;
  }): Promise<{
    decision: PolicyDecision;
    reasonCode: string;
    policyId: string | null;
    policyVersion: number | null;
    approvalRequired: boolean;
  }>;
}
