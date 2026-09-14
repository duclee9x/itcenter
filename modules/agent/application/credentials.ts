import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import type { AgentPrincipal } from "./authentication.js";
import type {
  AgentCertificateIssuerPort,
  IssuedAgentCertificate,
} from "./certificate-issuer.js";
import type {
  IssuedCredentialAuditPort,
  IssuedCredentialRecord,
} from "./enrollment.js";

interface RotationAttempt {
  id: string;
  credential_id: string;
  serial_number: string;
  issued_at: Date;
  expires_at: Date;
  tenant_id: string;
  agent_id: string;
  csr_pem: string;
  request_sha256: string;
  state: string;
  certificate_pem: string | null;
}

interface CredentialRow {
  credential_id: string;
  serial_number: string;
  fingerprint_sha256: string;
  spki_sha256: string;
  issuer_fingerprint_sha256: string;
  not_before: Date;
  expires_at: Date;
}

const rejected = () =>
  new ApplicationError(
    "AUTHENTICATION_REQUIRED",
    "Agent credential is not authorized.",
  );
const unavailable = () =>
  new ApplicationError(
    "DEPENDENCY_UNAVAILABLE",
    "Agent credential service is unavailable.",
    true,
  );
const conflict = () =>
  new ApplicationError(
    "AGENT_MESSAGE_CONFLICT",
    "Credential request identity conflicts with prior content.",
  );
const busy = () =>
  new ApplicationError(
    "OPERATION_IN_PROGRESS",
    "Credential operation is already in progress.",
    true,
  );
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function existingCredential(
  uow: UnitOfWork,
  tenantId: string,
  id: string,
): Promise<IssuedCredentialRecord> {
  return uow.run(tenantId, async (tx) => {
    const result = await tx.query<
      CredentialRow & {
        agent_id: string;
        tenant_id: string;
        asset_id: string;
        certificate_pem: string;
      }
    >(
      `SELECT c.id AS credential_id,c.agent_id,c.tenant_id,a.asset_id,
        c.certificate_pem,c.serial_number,c.fingerprint_sha256,c.spki_sha256,
        c.issuer_fingerprint_sha256,c.not_before,c.expires_at
       FROM agent.agent_credentials c JOIN agent.agents a
        ON a.tenant_id=c.tenant_id AND a.id=c.agent_id
       WHERE c.tenant_id=$1 AND c.id=$2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) throw unavailable();
    return { ...row, created: false };
  });
}

export async function rotateAgentCredential(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  issuer: AgentCertificateIssuerPort;
  principal: AgentPrincipal;
  csrPem: string;
  idempotencyKey: string;
  audit: IssuedCredentialAuditPort;
  now?: Date;
}): Promise<IssuedCredentialRecord> {
  if (
    !input.csrPem.includes("BEGIN CERTIFICATE REQUEST") ||
    input.csrPem.length > 16_384 ||
    !input.idempotencyKey.trim()
  )
    throw rejected();
  const now = input.now ?? new Date();
  const csrHash = digest(input.csrPem);
  const requestHash = digest(
    JSON.stringify({ credential: input.principal.credential_id, csrHash }),
  );
  let attempt: RotationAttempt;
  try {
    attempt = await input.uow.run(input.principal.tenant_id, async (tx) => {
      await tx.query(
        `UPDATE agent.agent_credentials SET status='REPLACED',overlap_until=NULL,
           entity_version=entity_version+1,updated_at=now()
         WHERE tenant_id=$1 AND agent_id=$2 AND status='ACTIVE'
           AND overlap_until IS NOT NULL AND overlap_until<=$3
           AND replaced_by IS NOT NULL`,
        [input.principal.tenant_id, input.principal.id, now],
      );
      const current = await tx.query<{
        status: string;
        expires_at: Date;
        replaced_by: string | null;
      }>(
        `SELECT status,expires_at,replaced_by FROM agent.agent_credentials
         WHERE tenant_id=$1 AND id=$2 AND agent_id=$3 FOR UPDATE`,
        [
          input.principal.tenant_id,
          input.principal.credential_id,
          input.principal.id,
        ],
      );
      const credential = current.rows[0];
      if (
        !credential ||
        credential.status !== "ACTIVE" ||
        credential.replaced_by ||
        new Date(credential.expires_at).getTime() <= now.getTime() ||
        new Date(credential.expires_at).getTime() - now.getTime() >
          7 * 24 * 60 * 60_000
      )
        throw rejected();
      const otherActive = await tx.query(
        `SELECT id FROM agent.agent_credentials
         WHERE tenant_id=$1 AND agent_id=$2 AND id<>$3 AND status='ACTIVE'
           AND expires_at>$4 AND (overlap_until IS NULL OR overlap_until>$4)
         FOR UPDATE`,
        [
          input.principal.tenant_id,
          input.principal.id,
          input.principal.credential_id,
          now,
        ],
      );
      if (otherActive.rowCount) throw rejected();
      const inflight = await tx.query(
        `SELECT id FROM agent.certificate_issuance_attempts
         WHERE tenant_id=$1 AND agent_id=$2 AND operation_type='ROTATE'
           AND state IN ('PENDING','ISSUING') FOR UPDATE`,
        [input.principal.tenant_id, input.principal.id],
      );
      const inflightCount = inflight.rowCount ?? inflight.rows.length;
      const previous = await tx.query<RotationAttempt>(
        `SELECT id,credential_id,serial_number,issued_at,expires_at,tenant_id,
          agent_id,csr_pem,request_sha256,state,certificate_pem
         FROM agent.certificate_issuance_attempts
         WHERE tenant_id=$1 AND agent_id=$2 AND operation_type='ROTATE'
           AND idempotency_key=$3 FOR UPDATE`,
        [input.principal.tenant_id, input.principal.id, input.idempotencyKey],
      );
      if (previous.rowCount) {
        const prior = previous.rows[0]!;
        if (prior.request_sha256 !== requestHash) throw conflict();
        if (prior.state === "ISSUED") return prior;
        if (
          inflightCount > 1 ||
          (inflightCount === 1 && inflight.rows[0]?.id !== prior.id)
        )
          throw busy();
        await tx.query(
          `UPDATE agent.certificate_issuance_attempts SET state='ISSUING',lease_until=$3 WHERE tenant_id=$1 AND id=$2`,
          [
            input.principal.tenant_id,
            prior.id,
            new Date(now.getTime() + 5 * 60_000),
          ],
        );
        return { ...prior, state: "ISSUING" };
      }
      if (inflightCount) throw busy();
      const id = randomUUID();
      const credentialId = randomUUID();
      const serial = randomBytes(16).toString("hex");
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
      const inserted = await tx.query<RotationAttempt>(
        `INSERT INTO agent.certificate_issuance_attempts
          (id,tenant_id,agent_id,operation_type,idempotency_key,request_sha256,
           csr_sha256,csr_pem,serial_number,issued_at,expires_at,state,
           credential_id,lease_until)
         VALUES($1,$2,$3,'ROTATE',$4,$5,$6,$7,$8,$9,$10,'ISSUING',$11,$12)
         RETURNING id,credential_id,serial_number,issued_at,expires_at,
           tenant_id,agent_id,csr_pem,request_sha256,state,certificate_pem`,
        [
          id,
          input.principal.tenant_id,
          input.principal.id,
          input.idempotencyKey,
          requestHash,
          csrHash,
          input.csrPem,
          serial,
          now,
          expiresAt,
          credentialId,
          new Date(now.getTime() + 5 * 60_000),
        ],
      );
      return inserted.rows[0]!;
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw unavailable();
  }
  if (attempt.state === "ISSUED")
    return existingCredential(
      input.uow,
      attempt.tenant_id,
      attempt.credential_id,
    );

  let issued: IssuedAgentCertificate;
  try {
    issued = await input.issuer.issue({
      operationId: attempt.id,
      credentialId: attempt.credential_id,
      serialNumber: attempt.serial_number,
      csrPem: attempt.csr_pem,
      notBefore: new Date(attempt.issued_at),
      expiresAt: new Date(attempt.expires_at),
    });
  } catch {
    await input.uow.run(attempt.tenant_id, (tx) =>
      tx
        .query(
          `UPDATE agent.certificate_issuance_attempts SET lease_until=now() WHERE tenant_id=$1 AND id=$2 AND state='ISSUING'`,
          [attempt.tenant_id, attempt.id],
        )
        .then(() => undefined),
    );
    throw unavailable();
  }

  try {
    return await input.uow.run(attempt.tenant_id, async (tx) => {
      const locked = await tx.query<RotationAttempt>(
        `SELECT id,credential_id,serial_number,issued_at,expires_at,tenant_id,agent_id,csr_pem,request_sha256,state,certificate_pem FROM agent.certificate_issuance_attempts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [attempt.tenant_id, attempt.id],
      );
      const row = locked.rows[0];
      if (!row) throw unavailable();
      if (row.state === "ISSUED") {
        const existing = await tx.query<
          CredentialRow & {
            agent_id: string;
            tenant_id: string;
            asset_id: string;
            certificate_pem: string;
          }
        >(
          `SELECT c.id AS credential_id,c.agent_id,c.tenant_id,a.asset_id,
            c.certificate_pem,c.serial_number,c.fingerprint_sha256,c.spki_sha256,
            c.issuer_fingerprint_sha256,c.not_before,c.expires_at
           FROM agent.agent_credentials c JOIN agent.agents a
            ON a.tenant_id=c.tenant_id AND a.id=c.agent_id
           WHERE c.tenant_id=$1 AND c.id=$2`,
          [row.tenant_id, row.credential_id],
        );
        if (!existing.rowCount) throw unavailable();
        return { ...existing.rows[0]!, created: false };
      }
      if (row.state !== "ISSUING") throw unavailable();
      const old = await tx.query<{
        expires_at: Date;
        status: string;
        replaced_by: string | null;
        asset_id: string;
      }>(
        `SELECT c.expires_at,c.status,c.replaced_by,a.asset_id
         FROM agent.agent_credentials c JOIN agent.agents a
          ON a.tenant_id=c.tenant_id AND a.id=c.agent_id
         WHERE c.tenant_id=$1 AND c.id=$2 AND c.agent_id=$3
           AND a.registration_status='ACTIVE' FOR UPDATE OF c,a`,
        [
          input.principal.tenant_id,
          input.principal.credential_id,
          input.principal.id,
        ],
      );
      const oldCredential = old.rows[0];
      if (
        !oldCredential ||
        oldCredential.status !== "ACTIVE" ||
        oldCredential.replaced_by ||
        new Date(oldCredential.expires_at).getTime() <= now.getTime()
      )
        throw rejected();
      const stored = await tx.query<{ certificate_pem: string | null }>(
        `SELECT certificate_pem FROM agent.certificate_issuance_attempts WHERE tenant_id=$1 AND id=$2`,
        [attempt.tenant_id, attempt.id],
      );
      if (
        stored.rows[0]?.certificate_pem &&
        stored.rows[0].certificate_pem !== issued.certificatePem
      )
        throw conflict();
      await tx.query(
        `UPDATE agent.certificate_issuance_attempts SET certificate_pem=$3 WHERE tenant_id=$1 AND id=$2`,
        [attempt.tenant_id, attempt.id, issued.certificatePem],
      );
      await tx.query(
        `INSERT INTO agent.agent_credentials
          (id,tenant_id,agent_id,serial_number,fingerprint_sha256,spki_sha256,
           issuer_fingerprint_sha256,certificate_pem,not_before,issued_at,
           expires_at,status,provenance)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE','SELF_ROTATION')`,
        [
          row.credential_id,
          row.tenant_id,
          row.agent_id,
          issued.serialNumber,
          issued.fingerprintSha256,
          issued.spkiSha256,
          issued.issuerFingerprintSha256,
          issued.certificatePem,
          issued.notBefore,
          row.issued_at,
          issued.expiresAt,
        ],
      );
      const overlapUntil = new Date(now.getTime() + 24 * 60 * 60_000);
      await tx.query(
        `UPDATE agent.agent_credentials SET replaced_by=$3,overlap_until=$4,entity_version=entity_version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [
          row.tenant_id,
          input.principal.credential_id,
          row.credential_id,
          overlapUntil,
        ],
      );
      await tx.query(
        `UPDATE agent.certificate_issuance_attempts SET state='ISSUED',completed_at=now(),lease_until=NULL WHERE tenant_id=$1 AND id=$2`,
        [row.tenant_id, row.id],
      );
      const record: IssuedCredentialRecord = {
        credential_id: row.credential_id,
        agent_id: row.agent_id,
        tenant_id: row.tenant_id,
        asset_id: oldCredential.asset_id,
        certificate_pem: issued.certificatePem,
        serial_number: issued.serialNumber,
        fingerprint_sha256: issued.fingerprintSha256,
        spki_sha256: issued.spkiSha256,
        issuer_fingerprint_sha256: issued.issuerFingerprintSha256,
        not_before: issued.notBefore,
        expires_at: issued.expiresAt,
        created: true,
      };
      await input.audit.append(tx, record);
      return record;
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw unavailable();
  }
}

export async function revokeAgentCredential(input: {
  tx: Transaction;
  agentId: string;
  credentialId: string;
  actorId: string;
  reason: string;
  expectedVersion: number;
}) {
  if (
    !input.reason.trim() ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Reason and expected version are required.",
    );
  const result = await input.tx.query<{
    entity_version: number;
    status: string;
  }>(
    `UPDATE agent.agent_credentials SET status='REVOKED',revoked_at=now(),
       revocation_reason=$4,entity_version=entity_version+1,updated_at=now()
     WHERE tenant_id=$1 AND agent_id=$2 AND id=$3 AND status='ACTIVE'
       AND entity_version=$5 RETURNING entity_version,status`,
    [
      input.tx.tenantId,
      input.agentId,
      input.credentialId,
      input.reason,
      input.expectedVersion,
    ],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Credential state changed or is no longer revocable.",
    );
  await input.tx.query(
    `UPDATE agent.agent_sessions SET ended_at=COALESCE(ended_at,now()) WHERE tenant_id=$1 AND agent_id=$2 AND credential_id=$3 AND ended_at IS NULL`,
    [input.tx.tenantId, input.agentId, input.credentialId],
  );
  return {
    credential_id: input.credentialId,
    agent_id: input.agentId,
    status: "REVOKED",
    entity_version: result.rows[0]!.entity_version,
  };
}
