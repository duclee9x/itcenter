import {
  aggregateReadiness,
  type ReadinessComponent,
  type ReadinessSnapshot,
} from "../../../packages/observability/src/readiness.js";

export function agentGatewayReadiness(
  base: readonly ReadinessComponent[],
  authenticationReady: boolean,
  certificateIssuerReady: boolean,
  draining = false,
): ReadinessSnapshot {
  return aggregateReadiness(
    "AGENT_GATEWAY",
    [
      ...base,
      {
        id: "agent-authentication",
        state: authenticationReady ? "READY" : "NOT_READY",
        criticality: "MANDATORY",
        ...(!authenticationReady
          ? { reasonCode: "AGENT_AUTHENTICATION_UNAVAILABLE" }
          : {}),
      },
      {
        id: "agent-certificate-issuer",
        state: certificateIssuerReady ? "READY" : "NOT_READY",
        criticality: "DEGRADABLE",
        ...(!certificateIssuerReady
          ? { reasonCode: "AGENT_CERTIFICATE_ISSUER_UNAVAILABLE" }
          : {}),
      },
    ],
    draining,
  );
}
