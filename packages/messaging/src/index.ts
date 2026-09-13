import { randomUUID } from "node:crypto";
import type { Transaction, UnitOfWork } from "../../persistence/src/index.js";
import {
  assertEvent,
  type EventEnvelope,
  type PendingEvent,
} from "../../event-contracts/src/index.js";
export { PostgresIdempotencyStore, requestHash } from "./idempotency.js";
export type {
  IdempotencyStore,
  IdempotencyIntent,
  StoredResponse,
} from "./idempotency.js";
export interface EventPublisher {
  publish(event: EventEnvelope): Promise<void>;
}
export interface OutboxWriter {
  append(event: PendingEvent): Promise<void>;
}
export class PostgresOutboxWriter implements OutboxWriter {
  constructor(private readonly tx: Transaction) {}
  async append(event: PendingEvent): Promise<void> {
    const envelope: EventEnvelope = {
      ...event,
      published_at: new Date().toISOString(),
    };
    assertEvent(envelope);
    if (event.tenant_id !== this.tx.tenantId)
      throw new Error("Outbox tenant mismatch");
    await this.tx.query(
      "INSERT INTO platform.outbox_events(id,event_id,tenant_id,event_type,schema_version,aggregate_type,aggregate_id,aggregate_version,payload,correlation_id,causation_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        randomUUID(),
        event.event_id,
        event.tenant_id,
        event.event_type,
        event.schema_version,
        event.aggregate.type,
        event.aggregate.id,
        event.aggregate.version,
        JSON.stringify(envelope),
        event.correlation_id,
        event.causation_id,
        event.occurred_at,
      ],
    );
  }

  async claimPending(limit = 50): Promise<EventEnvelope[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new Error("Invalid outbox batch size");
    const result = await this.tx.query<{ payload: EventEnvelope }>(
      "UPDATE platform.outbox_events SET attempt_count=attempt_count+1 WHERE id IN (SELECT id FROM platform.outbox_events WHERE status='PENDING' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1) RETURNING payload",
      [limit],
    );
    return result.rows.map((row) => row.payload);
  }

  async markPublished(eventId: string): Promise<void> {
    await this.tx.query(
      "UPDATE platform.outbox_events SET status='PUBLISHED',published_at=now() WHERE event_id=$1 AND tenant_id=$2 AND status='PENDING'",
      [eventId, this.tx.tenantId],
    );
  }
}
export interface InboxStore {
  claim(consumer: string, eventId: string): Promise<boolean>;
  processed(consumer: string, eventId: string): Promise<void>;
}
export class PostgresInboxStore implements InboxStore {
  constructor(private readonly tx: Transaction) {}
  async claim(consumer: string, eventId: string): Promise<boolean> {
    if (!consumer.trim()) throw new Error("Consumer namespace required");
    const row = await this.tx.query(
      "INSERT INTO platform.inbox_events(consumer_name,event_id,tenant_id,status) VALUES($1,$2,$3,'NOT_PROCESSED') ON CONFLICT(consumer_name,event_id) DO UPDATE SET status='NOT_PROCESSED',error_code=NULL WHERE inbox_events.status IN ('NOT_PROCESSED','FAILED') AND inbox_events.tenant_id=EXCLUDED.tenant_id RETURNING event_id",
      [consumer, eventId, this.tx.tenantId],
    );
    return !!row.rowCount;
  }
  async processed(consumer: string, eventId: string): Promise<void> {
    await this.tx.query(
      "UPDATE platform.inbox_events SET status='PROCESSED',processed_at=now() WHERE consumer_name=$1 AND event_id=$2 AND tenant_id=$3",
      [consumer, eventId, this.tx.tenantId],
    );
  }
}
export async function consume(
  uow: UnitOfWork,
  consumer: string,
  value: unknown,
  handler: (tx: Transaction, event: EventEnvelope) => Promise<void>,
): Promise<"processed" | "duplicate"> {
  assertEvent(value);
  try {
    return await uow.run(value.tenant_id, async (tx) => {
      const inbox = new PostgresInboxStore(tx);
      if (!(await inbox.claim(consumer, value.event_id))) return "duplicate";
      await handler(tx, value);
      await inbox.processed(consumer, value.event_id);
      return "processed";
    });
  } catch (error) {
    // The effect transaction rolled back first. Never overwrite a concurrent successful delivery.
    await uow.run(value.tenant_id, (tx) =>
      tx.query(
        "INSERT INTO platform.inbox_events(consumer_name,event_id,tenant_id,status,error_code) VALUES($1,$2,$3,'FAILED','CONSUMER_FAILED') ON CONFLICT(consumer_name,event_id) DO UPDATE SET status='FAILED',error_code=EXCLUDED.error_code WHERE inbox_events.status='NOT_PROCESSED' AND inbox_events.tenant_id=EXCLUDED.tenant_id",
        [consumer, value.event_id, value.tenant_id],
      ),
    );
    throw error;
  }
}
