import { createHash } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)]),
    );
  return value;
}

export interface AuditSummary {
  id: string;
  tenant_id: string;
  event_type: string;
  occurred_at: Date;
  actor: unknown;
  action: unknown;
  subject: unknown;
  correlation_id: string;
  causation_id: string;
  reason: unknown;
  before: unknown;
  after: unknown;
  outcome: unknown;
  classification: string;
  checksum: string | null;
  previous_hash: string | null;
  audit_sequence: number;
}

export class AuditQuery {
  constructor(private readonly tx: Transaction) {}

  async list(
    input: {
      limit?: number;
      eventType?: string;
      subjectId?: string;
    } = {},
  ) {
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Audit query limit must be between 1 and 100");
    const values: unknown[] = [this.tx.tenantId],
      conditions = ["tenant_id=$1"];
    if (input.eventType) {
      values.push(input.eventType);
      conditions.push(`event_type=$${values.length}`);
    }
    if (input.subjectId) {
      values.push(input.subjectId);
      conditions.push(`subject->>'entity_id'=$${values.length}`);
    }
    values.push(limit);
    const result = await this.tx.query<AuditSummary>(
      `SELECT id,tenant_id,event_type,occurred_at,actor,action,subject,correlation_id,causation_id,reason,before,after,outcome,classification,checksum,previous_hash,audit_sequence FROM audit.audit_events WHERE ${conditions.join(" AND ")} ORDER BY audit_sequence DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows;
  }

  async verifyIntegrity(): Promise<{
    valid: boolean;
    checked: number;
    brokenAt?: string;
  }> {
    const rows = await this.tx.query<AuditSummary>(
      "SELECT id,tenant_id,event_type,occurred_at,actor,action,subject,correlation_id,causation_id,reason,before,after,outcome,classification,checksum,previous_hash,audit_sequence FROM audit.audit_events WHERE tenant_id=$1 ORDER BY audit_sequence ASC",
      [this.tx.tenantId],
    );
    let previousHash: string | null = null;
    for (const row of rows.rows) {
      const occurredAt =
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : row.occurred_at;
      const canonical = JSON.stringify(
        stable({
          id: row.id,
          tenant_id: row.tenant_id,
          event_type: row.event_type,
          occurred_at: occurredAt,
          actor: row.actor,
          action: row.action,
          subject: row.subject,
          correlation_id: row.correlation_id,
          causation_id: row.causation_id,
          reason: row.reason,
          before: row.before,
          after: row.after,
          outcome: row.outcome,
          classification: row.classification,
          previous_hash: row.previous_hash,
        }),
      );
      const checksum = createHash("sha256").update(canonical).digest("hex");
      if (row.previous_hash !== previousHash || row.checksum !== checksum)
        return {
          valid: false,
          checked: rows.rows.indexOf(row),
          brokenAt: row.id,
        };
      previousHash = row.checksum;
    }
    return { valid: true, checked: rows.rows.length };
  }
}
