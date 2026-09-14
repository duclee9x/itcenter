import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";

export interface AgentCertificatePeer {
  authorized: boolean;
  raw: Buffer | null;
}

export interface AgentPrincipal {
  id: string;
  tenant_id: string;
  actor_type: "AGENT";
  auth_method: "MTLS";
  credential_id: string;
  asset_id: string;
  agent_session_id: string;
}

export interface AgentPeerAuthenticationPort {
  readonly mode: "mtls";
  isReady(): Promise<boolean>;
  authenticate(
    peer: AgentCertificatePeer,
    agentSessionId: string,
  ): Promise<AgentPrincipal>;
  endSession(agentSessionId: string): Promise<void>;
}

export async function assertCurrentAgentPrincipal(
  tx: Transaction,
  principal: AgentPrincipal,
): Promise<void> {
  try {
    const result = await tx.query(
      `SELECT c.id FROM agent.agent_credentials c
       JOIN agent.agents a ON a.tenant_id=c.tenant_id AND a.id=c.agent_id
       JOIN agent.agent_sessions s ON s.tenant_id=c.tenant_id
         AND s.agent_id=c.agent_id AND s.credential_id=c.id
       JOIN asset.assets x ON x.tenant_id=a.tenant_id AND x.id=a.asset_id
       WHERE c.tenant_id=$1 AND c.id=$2 AND c.agent_id=$3
         AND a.registration_status='ACTIVE' AND a.status<>'UNMANAGED'
         AND c.status='ACTIVE' AND c.not_before<=now()+interval '30 seconds'
         AND c.expires_at>now()-interval '30 seconds'
         AND (c.overlap_until IS NULL OR c.overlap_until>now())
         AND s.id=$4 AND s.ended_at IS NULL
         AND x.lifecycle_state NOT IN ('RETIRED','DISPOSED')
       FOR SHARE OF c,a,s,x`,
      [
        principal.tenant_id,
        principal.credential_id,
        principal.id,
        principal.agent_session_id,
      ],
    );
    if (!result.rowCount)
      throw new ApplicationError(
        "AUTHENTICATION_REQUIRED",
        "Agent authentication failed.",
      );
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      "DEPENDENCY_UNAVAILABLE",
      "Agent authentication is temporarily unavailable.",
      true,
    );
  }
}
