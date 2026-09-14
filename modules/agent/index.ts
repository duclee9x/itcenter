export {
  createAgentRegistration,
  transitionAgentRegistration,
  revokeEnrollmentToken,
  issueEnrollmentToken,
  forceAgentReenrollment,
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
export type {
  AgentCertificatePeer,
  AgentPeerAuthenticationPort,
  AgentPrincipal,
} from "./application/authentication.js";
export { enrollAgentCertificate } from "./application/enrollment.js";
export {
  rotateAgentCredential,
  revokeAgentCredential,
} from "./application/credentials.js";
export { processAgentMessage } from "./application/message-receipts.js";
export type {
  IssuedCredentialAuditPort,
  IssuedCredentialRecord,
} from "./application/enrollment.js";
export type {
  AgentCertificateIssueRequest,
  AgentCertificateIssuerPort,
  IssuedAgentCertificate,
} from "./application/certificate-issuer.js";
export const permissions = [
  { code: "agent.restart", resource_type: "agent", action: "restart" },
] as const;
