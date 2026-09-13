export {
  issueEnrollmentToken,
  recordHeartbeat,
  recordAutomationActionDelivery,
  readPendingAutomationAction,
  readRestartBaseline,
  isRegisteredAgent,
  readAgentRuntimeEvidence,
  acceptAutomationAction,
  rejectAutomationAction,
  recordInventory,
  resolveDeploymentAgentContext,
} from "./application/agent.js";
export const permissions = [
  { code: "agent.restart", resource_type: "agent", action: "restart" },
] as const;
