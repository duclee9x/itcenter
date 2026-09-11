import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../helpers.js";
import { authenticateOidcLogin } from "../../modules/identity/index.js";
import { PostgresOutboxWriter } from "../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../modules/audit/index.js";

test("OIDC login commits session, success outbox and audit atomically", async () => {
  const db = await testDatabase();
  const userId = randomUUID();
  try {
    await db.pool.query(
      "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,'tenant-a','U-1','user-a','User A','ACTIVE')",
      [userId],
    );
    const result = await authenticateOidcLogin({
      token: "verified",
      verifier: {
        async verify() {
          return {
            issuer: "https://idp",
            audience: ["hub"],
            subject: "subject-a",
            expiresAt: Math.floor(Date.now() / 1000) + 300,
            tenantId: "tenant-a",
            userId,
          };
        },
      },
      expected: {
        issuer: "https://idp",
        audience: "hub",
        tenantId: "tenant-a",
      },
      uow: db.uow,
      effects: (tx) => ({
        appendEvent: (event) => new PostgresOutboxWriter(tx).append(event),
        appendAudit: (record) => new PostgresAudit(tx).append(record),
      }),
      providerId: "idp",
      serviceName: "api",
      correlationId: "corr-login",
      causationId: "cause-login",
      idleMs: 60_000,
      absoluteMs: 300_000,
    });
    assert.equal(result.id, userId);
    const session = await db.pool.query(
      "SELECT user_id,tenant_id,revoked_at FROM identity.sessions WHERE id=$1",
      [result.session_id],
    );
    assert.deepEqual(session.rows[0], {
      user_id: userId,
      tenant_id: "tenant-a",
      revoked_at: null,
    });
    assert.equal(
      (
        await db.pool.query(
          "SELECT event_type FROM platform.outbox_events WHERE aggregate_id=$1",
          [result.session_id],
        )
      ).rows[0].event_type,
      "AUTH.LOGIN_SUCCESS",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT event_type FROM audit.audit_events WHERE subject->>'entity_id'=$1",
          [userId],
        )
      ).rows[0].event_type,
      "AUTH.LOGIN_SUCCESS",
    );
  } finally {
    await db.close();
  }
});

test("OIDC login failure commits failure effects and no session", async () => {
  const db = await testDatabase();
  try {
    await assert.rejects(
      authenticateOidcLogin({
        token: "invalid",
        verifier: {
          async verify() {
            throw new Error("signature invalid");
          },
        },
        expected: {
          issuer: "https://idp",
          audience: "hub",
          tenantId: "tenant-a",
        },
        uow: db.uow,
        effects: (tx) => ({
          appendEvent: (event) => new PostgresOutboxWriter(tx).append(event),
          appendAudit: (record) => new PostgresAudit(tx).append(record),
        }),
        providerId: "idp",
        serviceName: "api",
        correlationId: "corr-failure",
        causationId: "cause-failure",
        idleMs: 60_000,
        absoluteMs: 300_000,
      }),
      { code: "AUTHENTICATION_REQUIRED" },
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM identity.sessions",
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT event_type FROM platform.outbox_events WHERE event_type='AUTH.LOGIN_FAILED'",
        )
      ).rows[0].event_type,
      "AUTH.LOGIN_FAILED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT event_type FROM audit.audit_events WHERE event_type='AUTH.LOGIN_FAILED'",
        )
      ).rows[0].event_type,
      "AUTH.LOGIN_FAILED",
    );
  } finally {
    await db.close();
  }
});
