import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { testDatabase } from "../helpers.js";
import {
  createAgentRegistration,
  forceAgentReenrollment,
  issueEnrollmentToken,
  enrollAgentCertificate,
  rotateAgentCredential,
  revokeAgentCredential,
  transitionAgentRegistration,
} from "../../modules/agent/index.js";
import { OpenSslAgentCertificateIssuer } from "../../modules/agent/infrastructure/openssl-agent-certificate-issuer.js";
import { PostgresMtlsAgentAuthentication } from "../../modules/agent/infrastructure/postgres-mtls-authentication.js";
import type { IssuedCredentialAuditPort } from "../../modules/agent/application/enrollment.js";

test("Agent enrollment, current certificate authorization, rotation overlap and revocation use durable canonical state", async () => {
  const db = await testDatabase();
  const tenant = `release002-${randomUUID()}`;
  const dir = mkdtempSync(join(tmpdir(), "release002-integration-"));
  try {
    const caKey = join(dir, "ca.key"),
      caCert = join(dir, "ca.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        caKey,
        "-out",
        caCert,
        "-days",
        "3",
        "-subj",
        "/CN=Ephemeral Integration CA",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
      ],
      { stdio: "ignore" },
    );
    const createCsr = (name: string) => {
      const keyPath = join(dir, `${name}.key`),
        csrPath = join(dir, `${name}.csr`);
      execFileSync(
        "openssl",
        [
          "req",
          "-new",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          keyPath,
          "-out",
          csrPath,
          "-subj",
          `/CN=${name}`,
        ],
        { stdio: "ignore" },
      );
      return readFileSync(csrPath, "utf8");
    };
    const issuer = new OpenSslAgentCertificateIssuer({
      caCertificatePem: readFileSync(caCert, "utf8"),
      caPrivateKeyPem: readFileSync(caKey, "utf8"),
    });
    const category = randomUUID(),
      model = randomUUID(),
      asset = randomUUID();
    await db.pool.query(
      "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,$3)",
      [category, tenant, "Agent test assets"],
    );
    await db.pool.query(
      "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Test','Agent',$3)",
      [model, tenant, category],
    );
    await db.pool.query(
      "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id) VALUES($1,$2,$3,$4)",
      [asset, tenant, `A-${randomUUID()}`, model],
    );
    const registration = await db.uow.run(tenant, (tx) =>
      createAgentRegistration({ tx, assetId: asset, actorId: "operator" }),
    );
    const agentId = String(registration.id);
    const token = await db.uow.run(tenant, (tx) =>
      issueEnrollmentToken({
        tx,
        agentId,
        actorId: "operator",
        reason: "Integration test enrollment",
        idempotencyKey: randomUUID(),
      }),
    );
    const storedVerifier = await db.pool.query<{ verifier_sha256: string }>(
      "SELECT verifier_sha256 FROM agent.enrollment_tokens WHERE tenant_id=$1 AND id=$2",
      [tenant, token.token_id],
    );
    assert.notEqual(
      storedVerifier.rows[0]!.verifier_sha256,
      token.enrollment_token,
    );
    assert.equal(storedVerifier.rows[0]!.verifier_sha256.length, 64);
    const audit: IssuedCredentialAuditPort = { append: async () => undefined };
    const enrollment = await enrollAgentCertificate({
      pool: db.pool,
      uow: db.uow,
      issuer,
      enrollmentToken: token.enrollment_token,
      csrPem: createCsr("first-agent-key"),
      idempotencyKey: randomUUID(),
      audit,
    });
    assert.equal(enrollment.created, true);
    const consumed = await db.pool.query(
      "SELECT status,consumed_at FROM agent.enrollment_tokens WHERE tenant_id=$1 AND id=$2",
      [tenant, token.token_id],
    );
    assert.equal(consumed.rows[0]!.status, "CONSUMED");
    assert.ok(consumed.rows[0]!.consumed_at);

    const revokedDuringIssuanceAsset = randomUUID();
    await db.pool.query(
      "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id) VALUES($1,$2,$3,$4)",
      [revokedDuringIssuanceAsset, tenant, `A-${randomUUID()}`, model],
    );
    const revokedDuringIssuanceRegistration = await db.uow.run(tenant, (tx) =>
      createAgentRegistration({
        tx,
        assetId: revokedDuringIssuanceAsset,
        actorId: "operator",
      }),
    );
    const revokedDuringIssuanceToken = await db.uow.run(tenant, (tx) =>
      issueEnrollmentToken({
        tx,
        agentId: String(revokedDuringIssuanceRegistration.id),
        actorId: "operator",
        reason: "Revocation race test",
        idempotencyKey: randomUUID(),
      }),
    );
    const revokingIssuer = {
      issue: async (request: Parameters<typeof issuer.issue>[0]) => {
        const certificate = await issuer.issue(request);
        await db.pool.query(
          "UPDATE agent.enrollment_tokens SET status='REVOKED',revoked_at=now() WHERE id=$1",
          [revokedDuringIssuanceToken.token_id],
        );
        return certificate;
      },
      isReady: () => issuer.isReady(),
    };
    await assert.rejects(
      () =>
        enrollAgentCertificate({
          pool: db.pool,
          uow: db.uow,
          issuer: revokingIssuer,
          enrollmentToken: revokedDuringIssuanceToken.enrollment_token,
          csrPem: createCsr("revoked-during-issuance"),
          idempotencyKey: randomUUID(),
          audit,
        }),
      { code: "ENROLLMENT_TOKEN_INVALID" },
    );
    const revokedAttemptCredential = await db.pool.query(
      "SELECT id FROM agent.agent_credentials WHERE tenant_id=$1 AND agent_id=$2",
      [tenant, revokedDuringIssuanceRegistration.id],
    );
    assert.equal(revokedAttemptCredential.rowCount, 0);

    const concurrentAsset = randomUUID();
    await db.pool.query(
      "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id) VALUES($1,$2,$3,$4)",
      [concurrentAsset, tenant, `A-${randomUUID()}`, model],
    );
    const concurrentRegistration = await db.uow.run(tenant, (tx) =>
      createAgentRegistration({
        tx,
        assetId: concurrentAsset,
        actorId: "operator",
      }),
    );
    const concurrentToken = await db.uow.run(tenant, (tx) =>
      issueEnrollmentToken({
        tx,
        agentId: String(concurrentRegistration.id),
        actorId: "operator",
        reason: "Concurrency test",
        idempotencyKey: randomUUID(),
      }),
    );
    const concurrentResults = await Promise.allSettled([
      enrollAgentCertificate({
        pool: db.pool,
        uow: db.uow,
        issuer,
        enrollmentToken: concurrentToken.enrollment_token,
        csrPem: createCsr("concurrent-key-one"),
        idempotencyKey: randomUUID(),
        audit: { append: async () => undefined },
      }),
      enrollAgentCertificate({
        pool: db.pool,
        uow: db.uow,
        issuer,
        enrollmentToken: concurrentToken.enrollment_token,
        csrPem: createCsr("concurrent-key-two"),
        idempotencyKey: randomUUID(),
        audit: { append: async () => undefined },
      }),
    ]);
    assert.equal(
      concurrentResults.filter((result) => result.status === "fulfilled")
        .length,
      1,
      JSON.stringify(
        concurrentResults.map((result) =>
          result.status === "rejected"
            ? ((result.reason as { code?: string }).code ??
              String(result.reason))
            : "FULFILLED",
        ),
      ),
    );
    const concurrentCredentials = await db.pool.query(
      "SELECT id FROM agent.agent_credentials WHERE tenant_id=$1 AND agent_id=$2",
      [tenant, concurrentRegistration.id],
    );
    assert.equal(concurrentCredentials.rowCount, 1);

    const authentication = new PostgresMtlsAgentAuthentication(db.pool, db.uow);
    const firstCert = new X509Certificate(enrollment.certificate_pem);
    const principal = await authentication.authenticate(
      { authorized: true, raw: firstCert.raw },
      randomUUID(),
    );
    assert.equal(principal.id, agentId);
    assert.equal(principal.tenant_id, tenant);
    assert.equal(principal.credential_id, enrollment.credential_id);
    await assert.rejects(
      () =>
        enrollAgentCertificate({
          pool: db.pool,
          uow: db.uow,
          issuer,
          enrollmentToken: token.enrollment_token,
          csrPem: createCsr("replay-key"),
          idempotencyKey: randomUUID(),
          audit,
        }),
      { code: "ENROLLMENT_TOKEN_INVALID" },
    );

    await db.pool.query(
      "UPDATE agent.agent_credentials SET expires_at=now()+interval '6 days' WHERE tenant_id=$1 AND id=$2",
      [tenant, enrollment.credential_id],
    );
    const nearExpiryPrincipal = await authentication.authenticate(
      { authorized: true, raw: firstCert.raw },
      randomUUID(),
    );
    const rotation = await rotateAgentCredential({
      pool: db.pool,
      uow: db.uow,
      issuer,
      principal: nearExpiryPrincipal,
      csrPem: createCsr("rotated-agent-key"),
      idempotencyKey: randomUUID(),
      audit,
    });
    assert.equal(rotation.created, true);
    const oldDuringOverlap = await authentication.authenticate(
      { authorized: true, raw: firstCert.raw },
      randomUUID(),
    );
    assert.equal(oldDuringOverlap.id, agentId);
    const rotatedCert = new X509Certificate(rotation.certificate_pem);
    const newPrincipal = await authentication.authenticate(
      { authorized: true, raw: rotatedCert.raw },
      randomUUID(),
    );
    assert.equal(newPrincipal.credential_id, rotation.credential_id);
    await db.pool.query(
      "UPDATE agent.agent_credentials SET overlap_until=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
      [tenant, enrollment.credential_id],
    );
    await assert.rejects(
      () =>
        authentication.authenticate(
          { authorized: true, raw: firstCert.raw },
          randomUUID(),
        ),
      { code: "AUTHENTICATION_REQUIRED" },
    );
    const oldStatus = await db.pool.query(
      "SELECT status FROM agent.agent_credentials WHERE tenant_id=$1 AND id=$2",
      [tenant, enrollment.credential_id],
    );
    assert.equal(oldStatus.rows[0]!.status, "REPLACED");

    const current = await db.pool.query<{ entity_version: number }>(
      "SELECT entity_version FROM agent.agent_credentials WHERE tenant_id=$1 AND id=$2",
      [tenant, rotation.credential_id],
    );
    await db.uow.run(tenant, (tx) =>
      revokeAgentCredential({
        tx,
        agentId,
        credentialId: rotation.credential_id,
        actorId: "operator",
        reason: "Compromised test credential",
        expectedVersion: current.rows[0]!.entity_version,
      }),
    );
    await assert.rejects(
      () =>
        authentication.authenticate(
          { authorized: true, raw: rotatedCert.raw },
          randomUUID(),
        ),
      { code: "AUTHENTICATION_REQUIRED" },
    );
    const registrationVersion = await db.pool.query<{
      registration_version: number;
    }>(
      "SELECT registration_version FROM agent.agents WHERE tenant_id=$1 AND id=$2",
      [tenant, agentId],
    );
    const forcedToken = await db.uow.run(tenant, (tx) =>
      forceAgentReenrollment({
        tx,
        agentId,
        actorId: "operator",
        reason: "Controlled recovery after compromise",
        expectedRegistrationVersion:
          registrationVersion.rows[0]!.registration_version,
        idempotencyKey: randomUUID(),
      }),
    );
    const reissued = await enrollAgentCertificate({
      pool: db.pool,
      uow: db.uow,
      issuer,
      enrollmentToken: forcedToken.enrollment_token,
      csrPem: createCsr("re-enrolled-agent-key"),
      idempotencyKey: randomUUID(),
      audit,
    });
    const reissuedCert = new X509Certificate(reissued.certificate_pem);
    assert.equal(
      (
        await authentication.authenticate(
          { authorized: true, raw: reissuedCert.raw },
          randomUUID(),
        )
      ).credential_id,
      reissued.credential_id,
    );
    const disabled = await db.uow.run(tenant, (tx) =>
      transitionAgentRegistration({
        tx,
        agentId,
        target: "DISABLED",
        expectedVersion: registrationVersion.rows[0]!.registration_version,
        reason: "Disable for authentication test",
      }),
    );
    await assert.rejects(
      () =>
        authentication.authenticate(
          { authorized: true, raw: reissuedCert.raw },
          randomUUID(),
        ),
      { code: "AUTHENTICATION_REQUIRED" },
    );
    await db.uow.run(tenant, (tx) =>
      transitionAgentRegistration({
        tx,
        agentId,
        target: "ACTIVE",
        expectedVersion: disabled.registration_version,
        reason: "Re-enable after authentication test",
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await db.close();
  }
});
