import test from "node:test";
import assert from "node:assert/strict";
import { validateClaims } from "../../modules/identity/application/oidc.js";
import { authenticateOidcLogin } from "../../modules/identity/application/authentication.js";
import {
  assertSessionActive,
  createSession,
} from "../../modules/identity/application/sessions.js";
test("OIDC claims require issuer audience subject tenant and expiry", () => {
  const base = {
    issuer: "https://idp",
    audience: "hub",
    subject: "sub",
    expiresAt: 200,
    tenantId: "t",
    userId: "u",
  };
  validateClaims(base, {
    issuer: "https://idp",
    audience: "hub",
    tenantId: "t",
    now: 100,
  });
  for (const bad of [
    { ...base, issuer: "bad" },
    { ...base, audience: "bad" },
    { ...base, subject: "" },
    { ...base, expiresAt: 100 },
    { ...base, tenantId: "other" },
  ])
    assert.throws(
      () =>
        validateClaims(bad, {
          issuer: "https://idp",
          audience: "hub",
          tenantId: "t",
          now: 100,
        }),
      { code: "AUTHENTICATION_REQUIRED" },
    );
});
test("session creation rejects non-active users and bounds expiry", async () => {
  const queries: string[] = [];
  const tx = {
    tenantId: "t",
    query: async (sql: string) => {
      queries.push(sql);
      return sql.startsWith("SELECT id")
        ? { rowCount: 1, rows: [{ id: "u" }] }
        : { rowCount: 1, rows: [] };
    },
  } as never;
  const result = await createSession(tx, {
    tenantId: "t",
    userId: "u",
    authMethod: "OIDC",
    now: new Date(0),
    idleMs: 1000,
    absoluteMs: 5000,
  });
  assert.equal(result.expiresAt.getTime(), 1000);
  assert.equal(queries.length, 2);
});
test("session creation rejects invalid expiry configuration", async () => {
  const tx = {
    tenantId: "t",
    query: async () => ({ rowCount: 1, rows: [{ id: "u" }] }),
  } as never;
  await assert.rejects(
    createSession(tx, {
      tenantId: "t",
      userId: "u",
      authMethod: "OIDC",
      now: new Date(0),
      idleMs: 0,
      absoluteMs: 1000,
    }),
    { code: "VALIDATION_ERROR" },
  );
});
test("session use checks the authoritative tenant, user status and locks the row", async () => {
  let sql = "";
  const tx = {
    tenantId: "tenant-a",
    query: async (statement: string) => {
      sql = statement;
      return {
        rowCount: 1,
        rows: [{ user_id: "user-a", tenant_id: "tenant-a", version: 1 }],
      };
    },
  } as never;
  const session = await assertSessionActive(tx, "session-a", new Date(0));
  assert.deepEqual(session, {
    user_id: "user-a",
    tenant_id: "tenant-a",
    version: 1,
  });
  assert.match(sql, /employment_status='ACTIVE'/);
  assert.match(sql, /FOR UPDATE/);
});
test("verified OIDC login creates a session and emits success effects", async () => {
  const events: string[] = [],
    tx = {
      tenantId: "tenant-a",
      query: async (sql: string) =>
        sql.startsWith("SELECT id")
          ? { rowCount: 1, rows: [{ id: "user-a" }] }
          : { rowCount: 1, rows: [] },
    } as never;
  const result = await authenticateOidcLogin({
    token: "verified",
    verifier: {
      async verify() {
        return {
          issuer: "https://idp",
          audience: "hub",
          subject: "subject-a",
          expiresAt: 200,
          tenantId: "tenant-a",
          userId: "user-a",
        };
      },
    },
    expected: { issuer: "https://idp", audience: "hub", tenantId: "tenant-a" },
    uow: { run: async (_tenant, work) => work(tx) },
    effects: () => ({
      async appendEvent(event) {
        events.push(event.event_type);
      },
      async appendAudit(record) {
        events.push(record.event_type);
      },
    }),
    providerId: "idp",
    serviceName: "api",
    correlationId: "corr",
    causationId: "cause",
    now: new Date(100000),
    idleMs: 1000,
    absoluteMs: 5000,
  });
  assert.equal(result.id, "user-a");
  assert.ok(result.session_id);
  assert.deepEqual(events, ["AUTH.LOGIN_SUCCESS", "AUTH.LOGIN_SUCCESS"]);
});
