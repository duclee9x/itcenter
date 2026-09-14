import { createHash, X509Certificate } from "node:crypto";
import type pg from "pg";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import type {
  AgentCertificatePeer,
  AgentPeerAuthenticationPort,
  AgentPrincipal,
} from "../application/authentication.js";

interface CredentialRow {
  credential_id: string;
  agent_id: string;
  tenant_id: string;
  asset_id: string;
  credential_status: string;
  registration_status: string;
  operational_status: string;
  serial_number: string;
  fingerprint_sha256: string;
  spki_sha256: string;
  not_before: Date;
  expires_at: Date;
  overlap_until: Date | null;
  replaced_by: string | null;
  asset_lifecycle_state: string;
}

function denied(): ApplicationError {
  return new ApplicationError(
    "AUTHENTICATION_REQUIRED",
    "Agent authentication failed.",
  );
}

function unavailable(): ApplicationError {
  return new ApplicationError(
    "DEPENDENCY_UNAVAILABLE",
    "Agent authentication is temporarily unavailable.",
    true,
  );
}

function normalizedHex(value: string): string {
  return value.replaceAll(":", "").replace(/^0+/, "").toLowerCase();
}

function credentialIdFromSan(certificate: X509Certificate): string {
  const san = certificate.subjectAltName ?? "";
  const match = /^URI:urn:itcenter:agent-credential:([0-9a-f-]{36})$/i.exec(
    san,
  );
  if (!match || !/^[0-9a-f-]{36}$/i.test(match[1] ?? "")) throw denied();
  return match[1]!.toLowerCase();
}

export class PostgresMtlsAgentAuthentication implements AgentPeerAuthenticationPort {
  readonly mode = "mtls" as const;

  constructor(
    private readonly pool: pg.Pool,
    private readonly uow: UnitOfWork,
    private readonly observe: (event: string) => void = () => undefined,
  ) {}

  async isReady(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1 FROM agent.agent_credentials LIMIT 1");
      return true;
    } catch {
      return false;
    }
  }

  async authenticate(
    peer: AgentCertificatePeer,
    agentSessionId: string,
  ): Promise<AgentPrincipal> {
    if (!peer.authorized || !peer.raw) {
      this.observe("agent_auth_invalid_peer_certificate");
      throw denied();
    }

    let certificate: X509Certificate;
    let credentialId: string;
    try {
      certificate = new X509Certificate(peer.raw);
      credentialId = credentialIdFromSan(certificate);
    } catch {
      this.observe("agent_auth_invalid_certificate");
      throw denied();
    }

    let tenantId: string | undefined;
    try {
      const lookup = await this.pool.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM agent.agent_credentials WHERE id=$1",
        [credentialId],
      );
      tenantId = lookup.rows[0]?.tenant_id;
    } catch {
      this.observe("agent_auth_repository_unavailable");
      throw unavailable();
    }
    if (!tenantId) {
      this.observe("agent_auth_unknown_credential");
      throw denied();
    }

    try {
      const principal = await this.uow.run(tenantId, async (tx) => {
        const result = await tx.query<CredentialRow>(
          `SELECT c.id AS credential_id,c.agent_id,c.tenant_id,a.asset_id,
             c.status AS credential_status,a.registration_status,
             a.status AS operational_status,c.serial_number,
             c.fingerprint_sha256,c.spki_sha256,c.not_before,c.expires_at,c.overlap_until,
             c.replaced_by,x.lifecycle_state AS asset_lifecycle_state
           FROM agent.agent_credentials c
           JOIN agent.agents a ON a.tenant_id=c.tenant_id AND a.id=c.agent_id
           JOIN asset.assets x ON x.tenant_id=a.tenant_id AND x.id=a.asset_id
           WHERE c.tenant_id=$1 AND c.id=$2
           FOR UPDATE OF c,a`,
          [tenantId, credentialId],
        );
        const row = result.rows[0];
        if (
          !row ||
          row.credential_status !== "ACTIVE" ||
          row.registration_status !== "ACTIVE" ||
          row.operational_status === "UNMANAGED" ||
          normalizedHex(row.serial_number) !==
            normalizedHex(certificate.serialNumber) ||
          row.fingerprint_sha256.replaceAll(":", "").toLowerCase() !==
            certificate.fingerprint256.replaceAll(":", "").toLowerCase() ||
          row.spki_sha256 !==
            createHash("sha256")
              .update(
                certificate.publicKey.export({ type: "spki", format: "der" }),
              )
              .digest("hex") ||
          !certificate.keyUsage?.includes("1.3.6.1.5.5.7.3.2")
        ) {
          this.observe(
            row?.credential_status === "REVOKED"
              ? "agent_auth_revoked_credential"
              : row?.credential_status === "EXPIRED"
                ? "agent_auth_expired_credential"
                : row?.registration_status !== "ACTIVE"
                  ? "agent_auth_registration_ineligible"
                  : "agent_auth_certificate_mismatch",
          );
          throw denied();
        }

        const now = Date.now();
        if (row.overlap_until && new Date(row.overlap_until).getTime() <= now) {
          await tx.query(
            `UPDATE agent.agent_credentials
             SET status='REPLACED',overlap_until=NULL,entity_version=entity_version+1,updated_at=now()
             WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'`,
            [tenantId, credentialId],
          );
          this.observe("agent_auth_replaced_credential");
          return null;
        }
        if (
          now + 30_000 < new Date(row.not_before).getTime() ||
          now + 30_000 < Date.parse(certificate.validFrom) ||
          ["RETIRED", "DISPOSED"].includes(row.asset_lifecycle_state)
        )
          throw denied();

        if (
          now - 30_000 >= new Date(row.expires_at).getTime() ||
          now - 30_000 >= Date.parse(certificate.validTo)
        ) {
          await tx.query(
            `UPDATE agent.agent_credentials SET status='EXPIRED',
               entity_version=entity_version+1,updated_at=now()
             WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'`,
            [tenantId, credentialId],
          );
          this.observe("agent_auth_expired_credential");
          return null;
        }

        const session = await tx.query<{
          id: string;
          agent_id: string;
          credential_id: string;
          tenant_id: string;
          ended_at: Date | null;
        }>(
          `INSERT INTO agent.agent_sessions
             (id,tenant_id,agent_id,credential_id,established_at)
           VALUES($1,$2,$3,$4,now())
           ON CONFLICT (id) DO NOTHING
           RETURNING id,tenant_id,agent_id,credential_id,ended_at`,
          [agentSessionId, tenantId, row.agent_id, row.credential_id],
        );
        const current =
          session.rows[0] ??
          (
            await tx.query<{
              id: string;
              tenant_id: string;
              agent_id: string;
              credential_id: string;
              ended_at: Date | null;
            }>(
              "SELECT id,tenant_id,agent_id,credential_id,ended_at FROM agent.agent_sessions WHERE id=$1",
              [agentSessionId],
            )
          ).rows[0];
        if (
          !current ||
          current.ended_at ||
          current.tenant_id !== tenantId ||
          current.agent_id !== row.agent_id ||
          current.credential_id !== row.credential_id
        ) {
          this.observe("agent_auth_session_conflict");
          throw denied();
        }
        this.observe("agent_auth_success");
        return {
          id: row.agent_id,
          tenant_id: row.tenant_id,
          actor_type: "AGENT" as const,
          auth_method: "MTLS" as const,
          credential_id: row.credential_id,
          asset_id: row.asset_id,
          agent_session_id: agentSessionId,
        };
      });
      if (!principal) throw denied();
      return principal;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      this.observe("agent_auth_repository_unavailable");
      throw unavailable();
    }
  }

  async endSession(agentSessionId: string): Promise<void> {
    try {
      await this.pool.query(
        "UPDATE agent.agent_sessions SET ended_at=COALESCE(ended_at,now()) WHERE id=$1",
        [agentSessionId],
      );
    } catch {
      this.observe("agent_auth_session_close_failed");
      // Session closure is best effort; each message still revalidates the
      // credential and registration from canonical storage.
    }
  }
}
