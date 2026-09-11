import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase, event, audit } from "../helpers.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
  consume,
} from "../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../modules/audit/index.js";
import { OperationRegistry } from "../../packages/persistence/src/operations.js";
import { permissions, seedPermissions } from "../../modules/identity/index.js";
import type { Transaction } from "../../packages/persistence/src/index.js";
test("durable foundations on PostgreSQL", async (t) => {
  const db = await testDatabase();
  try {
    await t.test(
      "idempotency replay, hash conflict and tenant scope",
      async () => {
        const intent = {
          principalId: "u",
          operation: "TEST",
          businessScope: "test",
          key: randomUUID(),
          semanticRequest: { a: 1 },
          expiresAt: new Date(Date.now() + 86400000),
        };
        let calls = 0;
        const run = (tenant = "a", semanticRequest = { a: 1 }) =>
          db.uow.run(tenant, (tx) =>
            new PostgresIdempotencyStore(tx).execute(
              { ...intent, semanticRequest },
              async () => {
                calls++;
                return { status: 201, body: { id: "original" } };
              },
            ),
          );
        assert.deepEqual(await run(), await run());
        assert.equal(calls, 1);
        await assert.rejects(run("a", { a: 2 }), {
          code: "IDEMPOTENCY_KEY_CONFLICT",
        });
        await run("b");
        assert.equal(calls, 2);
      },
    );
    await t.test(
      "concurrent same key fails in progress; later retry replays",
      async () => {
        const intent = {
          principalId: "u",
          operation: "TEST",
          businessScope: "concurrent",
          key: randomUUID(),
          semanticRequest: { a: 1 },
          expiresAt: new Date(Date.now() + 86400000),
        };
        let release!: () => void, entered!: () => void;
        const hold = new Promise<void>((r) => (release = r)),
          ready = new Promise<void>((r) => (entered = r));
        const first = db.uow.run("a", (tx) =>
          new PostgresIdempotencyStore(tx).execute(intent, async () => {
            entered();
            await hold;
            return { status: 200, body: null };
          }),
        );
        await ready;
        try {
          await assert.rejects(
            db.uow.run("a", (tx) =>
              new PostgresIdempotencyStore(tx).execute(intent, async () => ({
                status: 200,
                body: null,
              })),
            ),
            { code: "OPERATION_IN_PROGRESS" },
          );
        } finally {
          release();
          await first;
        }
      },
    );
    await t.test(
      "outbox invisible before commit and rolled back with operation and audit",
      async () => {
        const e = event(),
          a = audit();
        const operation_id = randomUUID();
        let escaped: Transaction | undefined;
        await assert.rejects(
          db.uow.run("tenant-a", async (tx) => {
            escaped = tx;
            await new OperationRegistry(tx).enqueue({
              operation_id,
              type: "TEST",
              target_type: "TEST",
              target_id: "one",
              correlation_id: "corr",
            });
            await new PostgresOutboxWriter(tx).append(e);
            await new PostgresAudit(tx).append(a);
            assert.equal(
              (
                await db.pool.query(
                  "SELECT * FROM platform.outbox_events WHERE event_id=$1",
                  [e.event_id],
                )
              ).rowCount,
              0,
            );
            throw new Error("rollback");
          }),
          /rollback/,
        );
        for (const [table, id, column] of [
          ["platform.outbox_events", e.event_id, "event_id"],
          ["audit.audit_events", a.id, "id"],
          ["platform.operations", operation_id, "operation_id"],
        ])
          assert.equal(
            (
              await db.pool.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`, [
                id,
              ])
            ).rowCount,
            0,
          );
        assert.throws(() => escaped!.query("SELECT 1"), /closed/);
        await db.uow.run("tenant-a", (tx) =>
          new PostgresOutboxWriter(tx).append(e),
        );
        assert.equal(
          (
            await db.pool.query(
              "SELECT status FROM platform.outbox_events WHERE event_id=$1",
              [e.event_id],
            )
          ).rows[0].status,
          "PENDING",
        );
      },
    );
    await t.test(
      "inbox parallel redelivery applies one effect; failed effect rolls back then retries",
      async () => {
        const e = { ...event(), published_at: new Date().toISOString() };
        let count = 0;
        const handler = async (tx: Transaction) => {
          count++;
          await new PostgresAudit(tx).append(audit());
        };
        const results = await Promise.all([
          consume(db.uow, "test", e, handler),
          consume(db.uow, "test", e, handler),
        ]);
        assert.deepEqual(results.sort(), ["duplicate", "processed"]);
        assert.equal(count, 1);
        const failed = { ...event(), published_at: new Date().toISOString() },
          record = audit();
        await assert.rejects(
          consume(db.uow, "test", failed, async (tx) => {
            await new PostgresAudit(tx).append(record);
            throw new Error("failure");
          }),
          /failure/,
        );
        assert.equal(
          (
            await db.pool.query(
              "SELECT 1 FROM audit.audit_events WHERE id=$1",
              [record.id],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await db.pool.query(
              "SELECT status FROM platform.inbox_events WHERE event_id=$1",
              [failed.event_id],
            )
          ).rows[0].status,
          "FAILED",
        );
        assert.equal(
          await consume(db.uow, "test", failed, handler),
          "processed",
        );
      },
    );
    await t.test(
      "audit event, relation and evidence reject update, delete and truncate",
      async () => {
        const record = audit();
        await db.uow.run("tenant-a", (tx) =>
          new PostgresAudit(tx).append(record),
        );
        for (const table of [
          "audit_events",
          "audit_event_relations",
          "audit_evidence_links",
        ])
          for (const command of [
            `UPDATE audit.${table} SET tenant_id=tenant_id`,
            `DELETE FROM audit.${table}`,
            `TRUNCATE audit.${table} CASCADE`,
          ])
            await assert.rejects(db.pool.query(command), /append-only/);
        await assert.rejects(
          db.uow.run("wrong", (tx) => new PostgresAudit(tx).append(audit())),
          /tenant mismatch/,
        );
      },
    );
    await t.test(
      "operation reads filter tenant; permission seeds replay without privilege grants",
      async () => {
        const id = randomUUID();
        await db.uow.run("a", (tx) =>
          new OperationRegistry(tx).enqueue({
            operation_id: id,
            type: "TEST",
            target_type: "TEST",
            target_id: "one",
            correlation_id: "corr",
          }),
        );
        assert.equal(
          await db.uow.run("b", (tx) => new OperationRegistry(tx).find(id)),
          null,
        );
        assert.equal(
          (await db.uow.run("a", (tx) => new OperationRegistry(tx).find(id)))
            ?.state,
          "QUEUED",
        );
        await db.uow.run("catalog", (tx) => seedPermissions(tx, permissions));
        await db.uow.run("catalog", (tx) => seedPermissions(tx, permissions));
        assert.equal(
          (await db.pool.query("SELECT * FROM identity.permissions")).rowCount,
          permissions.length,
        );
        assert.equal(
          (await db.pool.query("SELECT * FROM identity.role_bindings"))
            .rowCount,
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test("idempotency failure rolls back the ledger and all local effects before retry", async () => {
  const db = await testDatabase();
  try {
    const intent = {
      principalId: "u",
      operation: "TEST",
      businessScope: "rollback",
      key: randomUUID(),
      semanticRequest: { a: 1 },
      expiresAt: new Date(Date.now() + 86400000),
    };
    const record = audit("a");
    await assert.rejects(
      db.uow.run("a", (tx) =>
        new PostgresIdempotencyStore(tx).execute(intent, async () => {
          await new PostgresAudit(tx).append(record);
          throw new Error("failed command");
        }),
      ),
      /failed command/,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT 1 FROM platform.idempotency_records WHERE idempotency_key=$1",
          [intent.key],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await db.pool.query("SELECT 1 FROM audit.audit_events WHERE id=$1", [
          record.id,
        ])
      ).rowCount,
      0,
    );
    await db.uow.run("a", (tx) =>
      new PostgresIdempotencyStore(tx).execute(intent, async () => {
        await new PostgresAudit(tx).append(record);
        return { status: 200, body: { id: record.id } };
      }),
    );
    assert.equal(
      (
        await db.pool.query("SELECT 1 FROM audit.audit_events WHERE id=$1", [
          record.id,
        ])
      ).rowCount,
      1,
    );
  } finally {
    await db.close();
  }
});
