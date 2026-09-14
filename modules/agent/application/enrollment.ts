import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import type {
  AgentCertificateIssuerPort,
  IssuedAgentCertificate,
} from "./certificate-issuer.js";

export interface IssuedCredentialRecord {
  credential_id: string;
  agent_id: string;
  tenant_id: string;
  asset_id: string;
  certificate_pem: string;
  serial_number: string;
  fingerprint_sha256: string;
  spki_sha256: string;
  issuer_fingerprint_sha256: string;
  not_before: Date;
  expires_at: Date;
  created: boolean;
}

export interface IssuedCredentialAuditPort {
  append(tx: Transaction, record: IssuedCredentialRecord): Promise<void>;
}

interface IssuedCredentialRow {
  credential_id: string;
  serial_number: string;
  fingerprint_sha256: string;
  spki_sha256: string;
  issuer_fingerprint_sha256: string;
  not_before: Date;
  expires_at: Date;
}

interface EnrollmentAttempt {
  id: string;
  credential_id: string;
  serial_number: string;
  issued_at: Date;
  expires_at: Date;
  tenant_id: string;
  agent_id: string;
  token_id: string;
  csr_pem: string;
  request_sha256: string;
  state: string;
  certificate_pem: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function enrollmentRejected(): ApplicationError {
  return new ApplicationError(
    "ENROLLMENT_TOKEN_INVALID",
    "Enrollment could not be authorized.",
  );
}

function conflict(): ApplicationError {
  return new ApplicationError(
    "AGENT_MESSAGE_CONFLICT",
    "Enrollment request identity conflicts with prior content.",
  );
}

function busy(): ApplicationError {
  return new ApplicationError(
    "OPERATION_IN_PROGRESS",
    "Enrollment attempt is already being processed.",
    true,
  );
}

function unavailable(): ApplicationError {
  return new ApplicationError(
    "DEPENDENCY_UNAVAILABLE",
    "Agent enrollment is temporarily unavailable.",
    true,
  );
}

async function readExistingCredential(
  uow: UnitOfWork,
  tenantId: string,
  credentialId: string,
): Promise<IssuedCredentialRecord> {
  return uow.run(tenantId, async (tx) => {
    const result = await tx.query<Omit<IssuedCredentialRecord, "created">>(
      `SELECT c.id AS credential_id,c.agent_id,c.tenant_id,a.asset_id,
        c.certificate_pem,c.serial_number,c.fingerprint_sha256,c.spki_sha256,
        c.issuer_fingerprint_sha256,c.not_before,c.expires_at
       FROM agent.agent_credentials c JOIN agent.agents a
         ON a.tenant_id=c.tenant_id AND a.id=c.agent_id
       WHERE c.tenant_id=$1 AND c.id=$2`,
      [tenantId, credentialId],
    );
    const row = result.rows[0];
    if (!row) throw unavailable();
    return { ...row, created: false };
  });
}

export async function enrollAgentCertificate(input: {
  pool: pg.Pool;
  uow: UnitOfWork;
  issuer: AgentCertificateIssuerPort;
  enrollmentToken: string;
  csrPem: string;
  idempotencyKey: string;
  audit: IssuedCredentialAuditPort;
  now?: Date;
}): Promise<IssuedCredentialRecord> {
  if (
    !input.enrollmentToken ||
    input.enrollmentToken.length > 256 ||
    input.csrPem.length > 16_384 ||
    !input.csrPem.includes("BEGIN CERTIFICATE REQUEST") ||
    !input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 200
  )
    throw enrollmentRejected();

  const now = input.now ?? new Date();
  const tokenVerifier = sha256(input.enrollmentToken);
  const csrHash = sha256(input.csrPem);
  let tokenOwner: { tenant_id: string; agent_id: string } | undefined;
  try {
    const lookup = await input.pool.query<{
      tenant_id: string;
      agent_id: string;
    }>(
      "SELECT tenant_id,agent_id FROM agent.enrollment_tokens WHERE verifier_sha256=$1",
      [tokenVerifier],
    );
    tokenOwner = lookup.rows[0];
  } catch {
    throw unavailable();
  }
  if (!tokenOwner) throw enrollmentRejected();

  const requestSha = sha256(
    JSON.stringify({
      tokenVerifier,
      csrHash,
      idempotencyKey: input.idempotencyKey,
    }),
  );
  let attempt: EnrollmentAttempt;
  try {
    attempt = await input.uow.run(tokenOwner.tenant_id, async (tx) => {
      const token = await tx.query<{
        id: string;
        status: string;
        expires_at: Date;
      }>(
        `SELECT id,status,expires_at FROM agent.enrollment_tokens
         WHERE tenant_id=$1 AND verifier_sha256=$2 AND agent_id=$3
         FOR UPDATE`,
        [tokenOwner!.tenant_id, tokenVerifier, tokenOwner!.agent_id],
      );
      if (!token.rowCount) throw enrollmentRejected();

      const existing = await tx.query<EnrollmentAttempt>(
        `SELECT id,credential_id,serial_number,issued_at,expires_at,
          tenant_id,agent_id,enrollment_token_id AS token_id,csr_pem,
          request_sha256,state,certificate_pem
         FROM agent.certificate_issuance_attempts
         WHERE tenant_id=$1 AND agent_id=$2 AND operation_type='ENROLL'
           AND idempotency_key=$3
         FOR UPDATE`,
        [tokenOwner!.tenant_id, tokenOwner!.agent_id, input.idempotencyKey],
      );
      if (existing.rowCount) {
        const prior = existing.rows[0]!;
        if (
          prior.request_sha256 !== requestSha ||
          prior.token_id !== token.rows[0]!.id
        )
          throw conflict();
        if (prior.state === "ISSUED") return prior;
        if (token.rows[0]!.status === "REVOKED") throw enrollmentRejected();
        if (
          prior.state === "ISSUING" &&
          (
            await tx.query<{ active: boolean }>(
              "SELECT lease_until > $2 AS active FROM agent.certificate_issuance_attempts WHERE id=$1",
              [prior.id, now],
            )
          ).rows[0]?.active
        )
          throw busy();
        await tx.query(
          `UPDATE agent.certificate_issuance_attempts
           SET state='ISSUING',lease_until=$2
           WHERE tenant_id=$1 AND id=$3`,
          [
            tokenOwner!.tenant_id,
            new Date(now.getTime() + 5 * 60_000),
            prior.id,
          ],
        );
        return { ...prior, state: "ISSUING" };
      }

      if (
        token.rows[0]!.status !== "ISSUED" ||
        new Date(token.rows[0]!.expires_at).getTime() <= now.getTime()
      )
        throw enrollmentRejected();
      const inflight = await tx.query(
        `SELECT id FROM agent.certificate_issuance_attempts
         WHERE tenant_id=$1 AND enrollment_token_id=$2
           AND state IN ('PENDING','ISSUING') FOR UPDATE`,
        [tokenOwner!.tenant_id, token.rows[0]!.id],
      );
      if (inflight.rowCount) throw busy();

      const id = randomUUID();
      const credentialId = randomUUID();
      const serialNumber = randomBytes(16).toString("hex");
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
      const inserted = await tx.query<EnrollmentAttempt>(
        `INSERT INTO agent.certificate_issuance_attempts
          (id,tenant_id,agent_id,enrollment_token_id,operation_type,
           idempotency_key,request_sha256,csr_sha256,csr_pem,serial_number,
           issued_at,expires_at,state,credential_id,lease_until)
         VALUES($1,$2,$3,$4,'ENROLL',$5,$6,$7,$8,$9,$10,$11,'ISSUING',$12,$13)
         RETURNING id,credential_id,serial_number,issued_at,expires_at,
           tenant_id,agent_id,enrollment_token_id AS token_id,csr_pem,
           request_sha256,state,certificate_pem`,
        [
          id,
          tokenOwner!.tenant_id,
          tokenOwner!.agent_id,
          token.rows[0]!.id,
          input.idempotencyKey,
          requestSha,
          csrHash,
          input.csrPem,
          serialNumber,
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
    return readExistingCredential(
      input.uow,
      attempt.tenant_id,
      attempt.credential_id,
    );

  let certificate: IssuedAgentCertificate;
  try {
    certificate = await input.issuer.issue({
      operationId: attempt.id,
      credentialId: attempt.credential_id,
      serialNumber: attempt.serial_number,
      csrPem: attempt.csr_pem,
      notBefore: new Date(attempt.issued_at),
      expiresAt: new Date(attempt.expires_at),
    });
  } catch {
    try {
      await input.uow.run(attempt.tenant_id, async (tx) => {
        await tx.query(
          `UPDATE agent.certificate_issuance_attempts
           SET lease_until=now()
           WHERE tenant_id=$1 AND id=$2 AND state='ISSUING'`,
          [attempt.tenant_id, attempt.id],
        );
      });
    } catch {
      // The durable lease expires even if the best-effort release fails.
    }
    throw unavailable();
  }

  try {
    await input.uow.run(attempt.tenant_id, async (tx) => {
      const stored = await tx.query<{ certificate_pem: string | null }>(
        `SELECT certificate_pem FROM agent.certificate_issuance_attempts
         WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [attempt.tenant_id, attempt.id],
      );
      const priorCertificate = stored.rows[0]?.certificate_pem;
      if (priorCertificate && priorCertificate !== certificate.certificatePem)
        throw conflict();
      if (!priorCertificate)
        await tx.query(
          `UPDATE agent.certificate_issuance_attempts
           SET certificate_pem=$3
           WHERE tenant_id=$1 AND id=$2 AND state='ISSUING'`,
          [attempt.tenant_id, attempt.id, certificate.certificatePem],
        );
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw unavailable();
  }

  try {
    return await input.uow.run(attempt.tenant_id, async (tx) => {
      const current = await tx.query<EnrollmentAttempt>(
        `SELECT id,credential_id,serial_number,issued_at,expires_at,
          tenant_id,agent_id,enrollment_token_id AS token_id,csr_pem,
          request_sha256,state,certificate_pem
         FROM agent.certificate_issuance_attempts
         WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [attempt.tenant_id, attempt.id],
      );
      const row = current.rows[0];
      if (!row) throw unavailable();
      if (row.state === "ISSUED") {
        const existingCredential = await tx.query<
          Omit<IssuedCredentialRecord, "created">
        >(
          `SELECT c.id AS credential_id,c.agent_id,c.tenant_id,a.asset_id,
            c.certificate_pem,c.serial_number,c.fingerprint_sha256,c.spki_sha256,
            c.issuer_fingerprint_sha256,c.not_before,c.expires_at
           FROM agent.agent_credentials c JOIN agent.agents a
             ON a.tenant_id=c.tenant_id AND a.id=c.agent_id
           WHERE c.tenant_id=$1 AND c.id=$2`,
          [attempt.tenant_id, row.credential_id],
        );
        if (!existingCredential.rowCount) throw unavailable();
        return { ...existingCredential.rows[0]!, created: false };
      }
      if (row.state !== "ISSUING" || !row.certificate_pem) throw unavailable();

      const token = await tx.query<{ status: string; valid: boolean }>(
        `SELECT status,expires_at>now() AS valid FROM agent.enrollment_tokens
         WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [attempt.tenant_id, row.token_id],
      );
      if (token.rows[0]?.status !== "ISSUED" || token.rows[0]?.valid !== true)
        throw enrollmentRejected();
      const registration = await tx.query<{
        asset_id: string;
        registration_status: string;
        status: string;
        lifecycle_state: string;
      }>(
        `SELECT a.asset_id,a.registration_status,a.status,x.lifecycle_state
         FROM agent.agents a JOIN asset.assets x
           ON x.tenant_id=a.tenant_id AND x.id=a.asset_id
         WHERE a.tenant_id=$1 AND a.id=$2 FOR UPDATE OF a,x`,
        [attempt.tenant_id, row.agent_id],
      );
      const source = registration.rows[0];
      if (
        !source ||
        source.registration_status !== "ACTIVE" ||
        source.status === "UNMANAGED" ||
        ["RETIRED", "DISPOSED"].includes(source.lifecycle_state)
      )
        throw enrollmentRejected();

      const active = await tx.query<{ id: string }>(
        `SELECT id FROM agent.agent_credentials
         WHERE tenant_id=$1 AND agent_id=$2 AND status='ACTIVE'
           AND expires_at>now() AND (overlap_until IS NULL OR overlap_until>now())
         FOR UPDATE`,
        [attempt.tenant_id, row.agent_id],
      );
      if (active.rowCount) throw enrollmentRejected();

      const certRow = await tx.query<IssuedCredentialRow>(
        `INSERT INTO agent.agent_credentials
          (id,tenant_id,agent_id,serial_number,fingerprint_sha256,spki_sha256,
           issuer_fingerprint_sha256,certificate_pem,not_before,issued_at,
           expires_at,status,provenance)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE','TOKEN_ENROLLMENT')
        RETURNING id AS credential_id,serial_number,fingerprint_sha256,
           spki_sha256,issuer_fingerprint_sha256,not_before,expires_at`,
        [
          row.credential_id,
          attempt.tenant_id,
          row.agent_id,
          certificate.serialNumber,
          certificate.fingerprintSha256,
          certificate.spkiSha256,
          certificate.issuerFingerprintSha256,
          row.certificate_pem,
          certificate.notBefore,
          new Date(row.issued_at),
          certificate.expiresAt,
        ],
      );
      const consumed = await tx.query(
        `UPDATE agent.enrollment_tokens SET status='CONSUMED',consumed_at=now(),
           entity_version=entity_version+1,updated_at=now()
         WHERE tenant_id=$1 AND id=$2 AND status='ISSUED'`,
        [attempt.tenant_id, row.token_id],
      );
      if (!consumed.rowCount) throw enrollmentRejected();
      await tx.query(
        `UPDATE agent.certificate_issuance_attempts
         SET state='ISSUED',completed_at=now(),lease_until=NULL
         WHERE tenant_id=$1 AND id=$2`,
        [attempt.tenant_id, row.id],
      );
      const issued = certRow.rows[0]!;
      const credential: IssuedCredentialRecord = {
        credential_id: issued.credential_id,
        agent_id: row.agent_id,
        tenant_id: attempt.tenant_id,
        asset_id: source.asset_id,
        certificate_pem: row.certificate_pem,
        serial_number: issued.serial_number,
        fingerprint_sha256: issued.fingerprint_sha256,
        spki_sha256: issued.spki_sha256,
        issuer_fingerprint_sha256: issued.issuer_fingerprint_sha256,
        not_before: issued.not_before,
        expires_at: issued.expires_at,
        created: true,
      };
      await input.audit.append(tx, credential);
      return credential;
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw unavailable();
  }
}
