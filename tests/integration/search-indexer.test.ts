import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "../../packages/event-contracts/src/index.js";
import {
  applySearchEvent,
  searchIndexerTask,
} from "../../apps/worker/src/search-indexer.js";
import { testDatabase, event } from "../helpers.js";

function ticketEvent(input: {
  id: string;
  ticketId: string;
  version: number;
}): EventEnvelope {
  return {
    ...event("tenant-a"),
    published_at: new Date().toISOString(),
    event_type: "TICKET.STATE_CHANGED",
    aggregate: {
      type: "TICKET",
      id: input.ticketId,
      version: input.version,
    },
    event_id: input.id,
    payload: {},
  };
}

test("search index consumer deduplicates, rereads current source and preserves tombstones", async () => {
  const db = await testDatabase();
  const userId = randomUUID();
  const ticketId = randomUUID();
  try {
    await db.pool.query(
      `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
       VALUES($1,'tenant-a','USR-INDEX','index-user','Index User','ACTIVE')`,
      [userId],
    );
    await db.pool.query(
      `INSERT INTO helpdesk.tickets(id,tenant_id,ticket_code,title,description,requester_user_id)
       VALUES($1,'tenant-a','INDEX-100','Before update','indexer fixture',$2)`,
      [ticketId, userId],
    );

    const duplicateEvent = ticketEvent({
      id: randomUUID(),
      ticketId,
      version: 1,
    });
    assert.equal(await applySearchEvent(db.uow, duplicateEvent), "processed");
    assert.equal(await applySearchEvent(db.uow, duplicateEvent), "duplicate");

    await db.pool.query(
      "UPDATE helpdesk.tickets SET title='Canonical latest title',version=2,updated_at=now() WHERE tenant_id='tenant-a' AND id=$1",
      [ticketId],
    );
    assert.equal(
      await applySearchEvent(
        db.uow,
        ticketEvent({ id: randomUUID(), ticketId, version: 1 }),
      ),
      "processed",
    );
    let document = await db.pool.query<{
      title: string;
      source_version: number;
      is_tombstone: boolean;
    }>(
      `SELECT title,source_version,is_tombstone FROM operations.search_documents
       WHERE tenant_id='tenant-a' AND entity_type='TICKET' AND entity_id=$1`,
      [ticketId],
    );
    assert.equal(document.rows[0]?.title, "Canonical latest title");
    assert.equal(Number(document.rows[0]?.source_version), 2);
    assert.equal(document.rows[0]?.is_tombstone, false);

    await db.pool.query(
      "DELETE FROM helpdesk.tickets WHERE tenant_id='tenant-a' AND id=$1",
      [ticketId],
    );
    await applySearchEvent(
      db.uow,
      ticketEvent({ id: randomUUID(), ticketId, version: 3 }),
    );
    await applySearchEvent(
      db.uow,
      ticketEvent({ id: randomUUID(), ticketId, version: 2 }),
    );
    document = await db.pool.query(
      `SELECT title,source_version,is_tombstone FROM operations.search_documents
       WHERE tenant_id='tenant-a' AND entity_type='TICKET' AND entity_id=$1`,
      [ticketId],
    );
    assert.equal(document.rows[0]?.is_tombstone, true);
    assert.equal(Number(document.rows[0]?.source_version), 3);
    assert.equal(
      (
        await db.pool.query(
          "SELECT status FROM platform.inbox_events WHERE consumer_name='search-indexer' AND tenant_id='tenant-a'",
        )
      ).rows.filter((row) => row.status === "PROCESSED").length,
      4,
    );
  } finally {
    await db.close();
  }
});

test("search indexer records retry backoff and marks the index degraded on invalid events", async () => {
  const db = await testDatabase();
  const eventId = randomUUID();
  const aggregateId = randomUUID();
  const controller = new AbortController();
  let failures = 0;
  try {
    await db.pool.query(
      `INSERT INTO platform.outbox_events(id,event_id,tenant_id,event_type,schema_version,
         aggregate_type,aggregate_id,aggregate_version,payload,correlation_id,causation_id,occurred_at)
       VALUES($1,$2,'tenant-a','TICKET.CREATED',1,'TICKET',$3,1,
         $4::jsonb,
         'search-test','search-test',now())`,
      [
        randomUUID(),
        eventId,
        aggregateId,
        JSON.stringify({
          tenant_id: "tenant-a",
          aggregate: { type: "TICKET", id: aggregateId, version: 1 },
        }),
      ],
    );
    const task = searchIndexerTask({
      pool: db.pool,
      uow: db.uow,
      reportFailure() {
        failures++;
      },
    });
    const running = task.run(controller.signal);
    let retryRows = 0;
    for (let attempt = 0; attempt < 20 && !retryRows; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      retryRows = (
        await db.pool.query(
          "SELECT 1 FROM operations.search_index_retries WHERE tenant_id='tenant-a' AND event_id=$1",
          [eventId],
        )
      ).rowCount!;
    }
    controller.abort();
    await running;

    assert.equal(retryRows, 1);
    assert.equal(failures, 1);
    const retry = await db.pool.query<{
      attempt_count: number;
      next_attempt_at: string;
    }>(
      "SELECT attempt_count,next_attempt_at FROM operations.search_index_retries WHERE tenant_id='tenant-a' AND event_id=$1",
      [eventId],
    );
    assert.equal(Number(retry.rows[0]?.attempt_count), 1);
    assert.ok(Date.parse(retry.rows[0]!.next_attempt_at) > Date.now());
    const state = await db.pool.query(
      "SELECT index_state,failure_code FROM operations.search_index_state WHERE tenant_id='tenant-a'",
    );
    assert.equal(state.rows[0]?.index_state, "FAILED");
    assert.equal(state.rows[0]?.failure_code, "SEARCH_INDEX_EVENT_FAILED");
  } finally {
    controller.abort();
    await db.close();
  }
});
