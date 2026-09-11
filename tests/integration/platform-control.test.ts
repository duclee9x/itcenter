import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase, event } from "../helpers.js";
import { OperationRegistry } from "../../packages/persistence/src/operations.js";
import { PostgresOutboxWriter } from "../../packages/messaging/src/index.js";

test("operation transitions enforce state and expected version", async () => {
  const db = await testDatabase();
  const id = randomUUID();
  try {
    await db.uow.run("tenant-a", (tx) =>
      new OperationRegistry(tx).enqueue({
        operation_id: id,
        type: "TEST",
        target_type: "TEST",
        target_id: "one",
        correlation_id: "corr",
      }),
    );
    await db.uow.run("tenant-a", (tx) =>
      new OperationRegistry(tx).transition({
        operationId: id,
        expectedVersion: 1,
        from: "QUEUED",
        to: "RUNNING",
      }),
    );
    assert.equal(
      (await db.uow.run("tenant-a", (tx) => new OperationRegistry(tx).find(id)))
        ?.state,
      "RUNNING",
    );
    await assert.rejects(
      db.uow.run("tenant-a", (tx) =>
        new OperationRegistry(tx).transition({
          operationId: id,
          expectedVersion: 1,
          from: "RUNNING",
          to: "SUCCEEDED",
        }),
      ),
      /conflict/,
    );
    await assert.rejects(
      db.uow.run("tenant-a", (tx) =>
        new OperationRegistry(tx).transition({
          operationId: id,
          expectedVersion: 2,
          from: "RUNNING",
          to: "QUEUED",
        }),
      ),
      /Invalid operation transition/,
    );
  } finally {
    await db.close();
  }
});

test("outbox claim increments attempts and publication is tenant-scoped", async () => {
  const db = await testDatabase();
  const value = event("tenant-a");
  try {
    await db.uow.run("tenant-a", (tx) =>
      new PostgresOutboxWriter(tx).append(value),
    );
    const claimed = await db.uow.run("tenant-a", (tx) =>
      new PostgresOutboxWriter(tx).claimPending(10),
    );
    assert.equal(claimed[0]?.event_id, value.event_id);
    await db.uow.run("tenant-a", (tx) =>
      new PostgresOutboxWriter(tx).markPublished(value.event_id),
    );
    const row = await db.pool.query(
      "SELECT status,attempt_count FROM platform.outbox_events WHERE event_id=$1",
      [value.event_id],
    );
    assert.deepEqual(row.rows[0], { status: "PUBLISHED", attempt_count: 1 });
  } finally {
    await db.close();
  }
});
