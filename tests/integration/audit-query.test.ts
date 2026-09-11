import test from "node:test";
import assert from "node:assert/strict";
import { audit, testDatabase } from "../helpers.js";
import { AuditQuery, PostgresAudit } from "../../modules/audit/index.js";

test("audit query is tenant-scoped and integrity verification validates the chain", async () => {
  const db = await testDatabase();
  try {
    const first = audit("tenant-a");
    const second = { ...audit("tenant-a"), event_type: "AUTH.LOGIN_SUCCESS" };
    await db.uow.run("tenant-a", async (tx) => {
      const store = new PostgresAudit(tx);
      await store.append(first);
      await store.append(second);
    });
    await db.uow.run("tenant-b", (tx) =>
      new PostgresAudit(tx).append(audit("tenant-b")),
    );
    const scoped = await db.uow.run("tenant-a", (tx) =>
      new AuditQuery(tx).list({ eventType: "AUTH.LOGIN_SUCCESS", limit: 10 }),
    );
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0]!.tenant_id, "tenant-a");
    assert.equal(
      (
        await db.uow.run("tenant-a", (tx) =>
          new AuditQuery(tx).verifyIntegrity(),
        )
      ).valid,
      true,
    );
    assert.equal(
      (await db.uow.run("tenant-b", (tx) => new AuditQuery(tx).list())).length,
      1,
    );
    await assert.rejects(
      db.uow.run("tenant-a", (tx) => new AuditQuery(tx).list({ limit: 101 })),
      /between 1 and 100/,
    );
  } finally {
    await db.close();
  }
});
