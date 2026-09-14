import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import type {
  Transaction,
  UnitOfWork,
} from "../../packages/persistence/src/index.js";
import { loadAgentGatewayRuntimeConfig } from "../../apps/agent-gateway/src/runtime-config.js";
import { OpenSslAgentCertificateIssuer } from "../../modules/agent/infrastructure/openssl-agent-certificate-issuer.js";
import { PostgresMtlsAgentAuthentication } from "../../modules/agent/infrastructure/postgres-mtls-authentication.js";
import { processAgentMessage } from "../../modules/agent/application/message-receipts.js";
import { acceptAutomationAction } from "../../modules/agent/application/agent.js";
import type { AgentPrincipal } from "../../modules/agent/application/authentication.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "release002-test-"));
  const caKey = join(dir, "ca.key");
  const caCert = join(dir, "ca.pem");
  const key = join(dir, "agent.key");
  const csr = join(dir, "agent.csr");
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
      "2",
      "-subj",
      "/CN=Ephemeral Test CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      csr,
      "-subj",
      "/CN=untrusted-agent-label",
    ],
    { stdio: "ignore" },
  );
  const caCertificatePem = readFileSync(caCert, "utf8");
  const caPrivateKeyPem = readFileSync(caKey, "utf8");
  const csrPem = readFileSync(csr, "utf8");
  return {
    dir,
    caCert,
    caCertificatePem,
    caPrivateKeyPem,
    csrPem,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("production Agent Gateway auth rejects unavailable and incomplete mTLS configuration", () => {
  const base = {
    APP_ENV: "production",
    DATABASE_SECRET_REF: "file:/run/secrets/db",
    AUTH_MODE: "oidc",
    OIDC_ISSUER: "https://issuer.example",
    OIDC_AUDIENCE: "api",
  } as NodeJS.ProcessEnv;
  assert.throws(() =>
    loadAgentGatewayRuntimeConfig({ ...base, AGENT_AUTH_MODE: "unavailable" }),
  );
  assert.throws(() =>
    loadAgentGatewayRuntimeConfig({ ...base, AGENT_AUTH_MODE: "mtls" }),
  );
});

test("production mTLS configuration enables required client certificates and TLS 1.2 minimum", () => {
  const f = fixture();
  try {
    const cert = join(f.dir, "server.pem");
    const key = join(f.dir, "server.key");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
    const files = [cert, key, f.caCert, join(f.dir, "signing.key")];
    writeFileSync(files[3]!, f.caPrivateKeyPem);
    const env = {
      APP_ENV: "production",
      DATABASE_SECRET_REF: "file:/run/secrets/db",
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "https://issuer.example",
      OIDC_AUDIENCE: "api",
      AGENT_AUTH_MODE: "mtls",
      AGENT_TLS_CERT_REF: `file:${files[0]}`,
      AGENT_TLS_KEY_REF: `file:${files[1]}`,
      AGENT_CA_CERT_REF: `file:${files[2]}`,
      AGENT_CA_SIGNING_KEY_REF: `file:${files[3]}`,
    } as NodeJS.ProcessEnv;
    const loaded = loadAgentGatewayRuntimeConfig(env);
    assert.equal(loaded.tlsOptions?.requestCert, true);
    assert.equal(loaded.tlsOptions?.rejectUnauthorized, false);
    assert.equal(loaded.tlsOptions?.minVersion, "TLSv1.2");
    assert.ok(
      loaded.certificateAuthority?.privateKeyPem.includes("PRIVATE KEY"),
    );
  } finally {
    f.cleanup();
  }
});

test("OpenSSL issuer signs a server-bound Agent credential URI SAN and clientAuth certificate", async () => {
  const f = fixture();
  try {
    const issuer = new OpenSslAgentCertificateIssuer({
      caCertificatePem: f.caCertificatePem,
      caPrivateKeyPem: f.caPrivateKeyPem,
    });
    assert.equal(await issuer.isReady(), true);
    const credentialId = "9c5b0000-0000-4000-8000-000000000001";
    const now = new Date(Date.now() - 5_000);
    const issued = await issuer.issue({
      operationId: "attempt",
      credentialId,
      serialNumber: "123456789abcdef",
      csrPem: f.csrPem,
      notBefore: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    const certPath = join(f.dir, "leaf.pem");
    writeFileSync(certPath, issued.certificatePem);
    execFileSync("openssl", ["verify", "-CAfile", f.caCert, certPath], {
      stdio: "ignore",
    });
    const san = execFileSync(
      "openssl",
      ["x509", "-in", certPath, "-noout", "-ext", "subjectAltName"],
      { encoding: "utf8" },
    );
    const eku = execFileSync(
      "openssl",
      ["x509", "-in", certPath, "-noout", "-ext", "extendedKeyUsage"],
      { encoding: "utf8" },
    );
    assert.match(
      san,
      new RegExp(`urn:itcenter:agent-credential:${credentialId}`),
    );
    assert.match(eku, /TLS Web Client Authentication/);
  } finally {
    f.cleanup();
  }
});

test("mTLS authentication rejects missing verified peer identity without fallback", async () => {
  const auth = new PostgresMtlsAgentAuthentication(
    {} as pg.Pool,
    {} as UnitOfWork,
  );
  await assert.rejects(
    () => auth.authenticate({ authorized: false, raw: null }, "session"),
    { code: "AUTHENTICATION_REQUIRED" },
  );
});

test("mTLS authentication derives principal only from current credential and registration records", async () => {
  const f = fixture();
  try {
    const issuer = new OpenSslAgentCertificateIssuer({
      caCertificatePem: f.caCertificatePem,
      caPrivateKeyPem: f.caPrivateKeyPem,
    });
    const issued = await issuer.issue({
      operationId: "attempt",
      credentialId: "9c5b0000-0000-4000-8000-000000000002",
      serialNumber: "abcdef123456",
      csrPem: f.csrPem,
      notBefore: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60_000),
    });
    const { X509Certificate } = await import("node:crypto");
    const cert = new X509Certificate(issued.certificatePem);
    assert.equal(
      cert.subjectAltName,
      "URI:urn:itcenter:agent-credential:9c5b0000-0000-4000-8000-000000000002",
    );
    assert.ok(cert.keyUsage?.includes("1.3.6.1.5.5.7.3.2"));
    const pool = {
      query: async () => ({ rows: [{ tenant_id: "tenant-a" }] }),
    } as unknown as pg.Pool;
    const tx: Transaction = {
      tenantId: "tenant-a",
      query: async (sql: string) => {
        if (sql.includes("FROM agent.agent_credentials c"))
          return {
            rows: [
              {
                credential_id: "9c5b0000-0000-4000-8000-000000000002",
                agent_id: "agent-a",
                tenant_id: "tenant-a",
                asset_id: "asset-a",
                credential_status: "ACTIVE",
                registration_status: "ACTIVE",
                operational_status: "ONLINE",
                serial_number: issued.serialNumber,
                fingerprint_sha256: issued.fingerprintSha256,
                spki_sha256: issued.spkiSha256,
                not_before: issued.notBefore,
                expires_at: issued.expiresAt,
                overlap_until: null,
                replaced_by: null,
                asset_lifecycle_state: "IN_USE",
              },
            ],
            rowCount: 1,
          } as never;
        if (sql.includes("INSERT INTO agent.agent_sessions"))
          return {
            rows: [
              {
                id: "session-a",
                tenant_id: "tenant-a",
                agent_id: "agent-a",
                credential_id: "9c5b0000-0000-4000-8000-000000000002",
                ended_at: null,
              },
            ],
            rowCount: 1,
          } as never;
        return { rows: [], rowCount: 0 } as never;
      },
    };
    const uow: UnitOfWork = { run: async (_tenant, work) => work(tx) };
    const auth = new PostgresMtlsAgentAuthentication(pool, uow);
    const principal = await auth.authenticate(
      { authorized: true, raw: cert.raw },
      "session-a",
    );
    assert.deepEqual(principal, {
      id: "agent-a",
      tenant_id: "tenant-a",
      actor_type: "AGENT",
      auth_method: "MTLS",
      credential_id: "9c5b0000-0000-4000-8000-000000000002",
      asset_id: "asset-a",
      agent_session_id: "session-a",
    });
  } finally {
    f.cleanup();
  }
});

test("durable Agent message identity replays identical outcome and rejects changed payload", async () => {
  const receipts = new Map<
    string,
    { hash: string; state: string; response: { value: unknown } | null }
  >();
  const tx = {
    tenantId: "tenant-a",
    query: async (sql: string, values: unknown[] = []) => {
      const key = values.slice(0, 4).join(":");
      if (sql.includes("INSERT INTO agent.agent_message_receipts")) {
        if (receipts.has(key)) return { rows: [], rowCount: 0 } as never;
        receipts.set(key, {
          hash: String(values[5]),
          state: "PROCESSING",
          response: null,
        });
        return { rows: [{ message_id: values[3] }], rowCount: 1 } as never;
      }
      if (sql.includes("SELECT request_sha256,state,response_json")) {
        const receipt = receipts.get(key);
        return {
          rows: receipt
            ? [
                {
                  request_sha256: receipt.hash,
                  state: receipt.state,
                  response_json: receipt.response,
                },
              ]
            : [],
          rowCount: receipt ? 1 : 0,
        } as never;
      }
      if (sql.includes("UPDATE agent.agent_message_receipts")) {
        const receipt = receipts.get(key)!;
        receipt.state = "COMPLETED";
        receipt.response = JSON.parse(String(values[4])) as { value: unknown };
        return { rows: [], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    },
  } as unknown as Transaction;
  const principal: AgentPrincipal = {
    id: "agent-a",
    tenant_id: "tenant-a",
    actor_type: "AGENT",
    auth_method: "MTLS",
    credential_id: "credential-a",
    asset_id: "asset-a",
    agent_session_id: "session-a",
  };
  let calls = 0;
  const run = (hash: string) =>
    processAgentMessage({
      tx,
      principal,
      messageId: "message-1",
      requestSha256: hash,
      process: async () => {
        calls += 1;
        return { accepted: true };
      },
    });
  assert.deepEqual(await run("payload-a"), { accepted: true });
  assert.deepEqual(await run("payload-a"), { accepted: true });
  assert.equal(calls, 1);
  await assert.rejects(() => run("payload-b"), {
    code: "AGENT_MESSAGE_CONFLICT",
  });
});

test("TASK-091 acknowledgement cannot be moved from the command's authenticated transport session", async () => {
  let transitioned = false;
  const tx = {
    tenantId: "tenant-a",
    query: async (sql: string) => {
      if (
        sql.includes(
          "SELECT execution_id,state,accepted_at,agent_transport_session_id",
        )
      )
        return {
          rows: [
            {
              execution_id: "execution-a",
              state: "DELIVERED",
              accepted_at: null,
              agent_transport_session_id: "session-old",
            },
          ],
          rowCount: 1,
        } as never;
      if (sql.startsWith("UPDATE")) transitioned = true;
      return { rows: [], rowCount: 0 } as never;
    },
  } as unknown as Transaction;
  await assert.rejects(
    () =>
      acceptAutomationAction({
        tx,
        agentId: "agent-a",
        commandId: "command-a",
        acceptedAt: new Date().toISOString(),
        correlationId: "correlation",
        agentSessionId: "session-new",
      }),
    { code: "PERMISSION_DENIED" },
  );
  assert.equal(transitioned, false);
});
