import { assertNoSecretFields } from "../domain/audit-policy.js";
import { createHash } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import type { AuditPort, AuditRecord } from "../application/ports.js";
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
export class PostgresAudit implements AuditPort {
  constructor(private readonly tx: Transaction) {}
  async append(r: AuditRecord): Promise<void> {
    assertNoSecretFields(r);
    if (r.tenant_id !== this.tx.tenantId)
      throw new Error("Audit tenant mismatch");
    const previous = await this.tx.query<{ checksum: string | null }>(
      "SELECT checksum FROM audit.audit_events WHERE tenant_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1",
      [r.tenant_id],
    );
    const previousHash = previous.rows[0]?.checksum ?? null;
    const canonical = JSON.stringify(
      stable({
        id: r.id,
        tenant_id: r.tenant_id,
        event_type: r.event_type,
        occurred_at: r.occurred_at,
        actor: r.actor,
        action: r.action,
        subject: r.subject,
        correlation_id: r.correlation_id,
        causation_id: r.causation_id,
        reason: r.reason,
        before: r.before,
        after: r.after,
        outcome: r.outcome,
        classification: r.classification,
        previous_hash: previousHash,
      }),
    );
    const checksum = createHash("sha256").update(canonical).digest("hex");
    await this.tx.query(
      "INSERT INTO audit.audit_events(id,tenant_id,event_type,occurred_at,actor,action,subject,correlation_id,causation_id,reason,before,after,outcome,classification,checksum,previous_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
      [
        r.id,
        r.tenant_id,
        r.event_type,
        r.occurred_at,
        JSON.stringify(r.actor),
        JSON.stringify(r.action),
        JSON.stringify(r.subject),
        r.correlation_id,
        r.causation_id,
        JSON.stringify(r.reason),
        JSON.stringify(r.before),
        JSON.stringify(r.after),
        JSON.stringify(r.outcome),
        r.classification,
        checksum,
        previousHash,
      ],
    );
    for (const rel of r.relations)
      await this.tx.query(
        "INSERT INTO audit.audit_event_relations VALUES($1,$2,$3,$4,$5)",
        [r.tenant_id, r.id, rel.entity_type, rel.entity_id, rel.relation],
      );
    for (const e of r.evidence)
      await this.tx.query(
        "INSERT INTO audit.audit_evidence_links VALUES($1,$2,$3,$4,$5,$6)",
        [r.tenant_id, r.id, e.type, e.id, e.checksum, e.relation],
      );
  }
}
