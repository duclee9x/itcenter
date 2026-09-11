import { randomUUID } from "node:crypto";
import {
  createPool,
  PostgresUnitOfWork,
} from "../packages/persistence/src/index.js";
import { migrate } from "../database/scripts/runner.js";
import type { PendingEvent } from "../packages/event-contracts/src/index.js";
import type { AuditRecord } from "../modules/audit/index.js";
export async function testDatabase(apply = true) {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection)
    throw new Error(
      "TEST_DATABASE_URL is required; use a disposable PostgreSQL instance with CREATE DATABASE permission.",
    );
  const admin = createPool(connection),
    name = "task000_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(connection);
  url.pathname = "/" + name;
  const pool = createPool(url.toString());
  if (apply) await migrate(pool);
  return {
    pool,
    uow: new PostgresUnitOfWork(pool),
    async close() {
      await pool.end();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    },
  };
}
export function event(tenant = "tenant-a"): PendingEvent {
  return {
    event_id: randomUUID(),
    event_type: "TEST.RECORDED",
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    producer: { service: "test", instance: "one" },
    aggregate: { type: "TEST", id: randomUUID(), version: 1 },
    actor: { type: "SYSTEM", id: null },
    correlation_id: "correlation",
    causation_id: "command",
    tenant_id: tenant,
    organization_id: "org",
    idempotency_key: randomUUID(),
    payload: { value: 1 },
  };
}
export function audit(tenant = "tenant-a"): AuditRecord {
  return {
    id: randomUUID(),
    tenant_id: tenant,
    event_type: "TEST.RECORDED",
    occurred_at: new Date().toISOString(),
    actor: { type: "SYSTEM", id: null },
    action: { command_type: "TEST.RECORD" },
    subject: { entity_type: "TEST", entity_id: randomUUID() },
    correlation_id: "correlation",
    causation_id: "command",
    reason: { code: "TEST", text: "Synthetic test" },
    before: null,
    after: { value: 1 },
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [
      { entity_type: "TEST", entity_id: "related", relation: "TEST" },
    ],
    evidence: [
      { type: "TEST", id: "evidence", checksum: "synthetic", relation: "TEST" },
    ],
  };
}
