import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase, event, audit } from "../helpers.js";
import {
  PostgresInboxStore,
  consume,
} from "../../packages/messaging/src/index.js";
import { OperationRegistry } from "../../packages/persistence/src/operations.js";
import { PostgresAudit } from "../../modules/audit/index.js";

// Task: TASK-000; Feature: FOUNDATION; Workflow: PLATFORM-BOOTSTRAP.
test("committed NOT_PROCESSED event is processed and later delivery is suppressed", async () => {
  const db = await testDatabase();
  try {
    const e = { ...event(), published_at: new Date().toISOString() };
    await db.uow.run(e.tenant_id, (tx) =>
      new PostgresInboxStore(tx).claim("review", e.event_id),
    );
    let calls = 0;
    const handler = async () => {
      calls++;
    };
    assert.equal(await consume(db.uow, "review", e, handler), "processed");
    assert.equal(await consume(db.uow, "review", e, handler), "duplicate");
    assert.equal(calls, 1);
    const row = await db.pool.query(
      "SELECT status,processed_at FROM platform.inbox_events WHERE event_id=$1",
      [e.event_id],
    );
    assert.equal(row.rows[0].status, "PROCESSED");
    assert.ok(row.rows[0].processed_at);
  } finally {
    await db.close();
  }
});

test("parallel deliveries of a committed NOT_PROCESSED event produce one durable effect", async () => {
  const db = await testDatabase();
  try {
    const e = { ...event(), published_at: new Date().toISOString() };
    await db.uow.run(e.tenant_id, (tx) =>
      new PostgresInboxStore(tx).claim("parallel", e.event_id),
    );
    const record = audit();
    let calls = 0;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        consume(db.uow, "parallel", e, async (tx) => {
          calls++;
          await new PostgresAudit(tx).append(record);
        }),
      ),
    );
    assert.equal(results.filter((r) => r === "processed").length, 1);
    assert.equal(results.filter((r) => r === "duplicate").length, 3);
    assert.equal(calls, 1);
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

test("failed processing of existing NOT_PROCESSED rolls back effects, records failure, then retries", async () => {
  const db = await testDatabase();
  try {
    const e = { ...event(), published_at: new Date().toISOString() };
    await db.uow.run(e.tenant_id, (tx) =>
      new PostgresInboxStore(tx).claim("retry", e.event_id),
    );
    const record = audit();
    await assert.rejects(
      consume(db.uow, "retry", e, async (tx) => {
        await new PostgresAudit(tx).append(record);
        throw new Error("handler failed");
      }),
      /handler failed/,
    );
    assert.equal(
      (
        await db.pool.query("SELECT 1 FROM audit.audit_events WHERE id=$1", [
          record.id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT status FROM platform.inbox_events WHERE event_id=$1",
          [e.event_id],
        )
      ).rows[0].status,
      "FAILED",
    );
    assert.equal(
      await consume(db.uow, "retry", e, (tx) =>
        new PostgresAudit(tx).append(record),
      ),
      "processed",
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

test("UnitOfWork rejects a swallowed SQL failure when COMMIT rolls back; later transactions work", async () => {
  const db = await testDatabase();
  try {
    const input = {
      operation_id: randomUUID(),
      type: "TEST",
      target_type: "TEST",
      target_id: "one",
      correlation_id: "corr",
    };
    await assert.rejects(
      db.uow.run("review", async (tx) => {
        await new OperationRegistry(tx).enqueue(input);
        await tx.query("SELECT 1/0").catch(() => undefined);
        return { status: "success" };
      }),
      /Transaction did not commit/,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT 1 FROM platform.operations WHERE operation_id=$1",
          [input.operation_id],
        )
      ).rowCount,
      0,
    );
    await db.uow.run("review", (tx) =>
      new OperationRegistry(tx).enqueue(input),
    );
    assert.equal(
      (
        await db.uow.run("review", (tx) =>
          new OperationRegistry(tx).find(input.operation_id),
        )
      )?.state,
      "QUEUED",
    );
  } finally {
    await db.close();
  }
});

test("late inbox failure recording does not overwrite a successful concurrent redelivery", async () => {
  const db = await testDatabase();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const e = { ...event(), published_at: new Date().toISOString() };
    await db.uow.run(e.tenant_id, (tx) =>
      new PostgresInboxStore(tx).claim("race", e.event_id),
    );
    let recording!: () => void;
    const ready = new Promise<void>((resolve) => {
      recording = resolve;
    });
    let calls = 0;
    const delayed: import("../../packages/persistence/src/index.js").UnitOfWork =
      {
        async run(tenant, work) {
          if (++calls === 2) {
            recording();
            await hold;
          }
          return db.uow.run(tenant, work);
        },
      };
    const failed = consume(delayed, "race", e, async () => {
      throw new Error("first delivery failed");
    }).then(
      () => null,
      (error) => error,
    );
    await ready;
    try {
      assert.equal(
        await consume(db.uow, "race", e, (tx) =>
          new PostgresAudit(tx).append(audit()),
        ),
        "processed",
      );
    } finally {
      release();
      await failed;
    }
    assert.match((await failed).message, /first delivery failed/);
    const row = await db.pool.query(
      "SELECT status,error_code FROM platform.inbox_events WHERE event_id=$1",
      [e.event_id],
    );
    assert.equal(row.rows[0].status, "PROCESSED");
    assert.equal(row.rows[0].error_code, null);
  } finally {
    release();
    await db.close();
  }
});
