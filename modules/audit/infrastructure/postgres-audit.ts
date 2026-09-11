import { assertNoSecretFields } from "../domain/audit-policy.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import type { AuditPort, AuditRecord } from "../application/ports.js";
export class PostgresAudit implements AuditPort {
  constructor(private readonly tx: Transaction) {}
  async append(r: AuditRecord): Promise<void> {
    assertNoSecretFields(r);
    if (r.tenant_id !== this.tx.tenantId)
      throw new Error("Audit tenant mismatch");
    await this.tx.query(
      "INSERT INTO audit.audit_events(id,tenant_id,event_type,occurred_at,actor,action,subject,correlation_id,causation_id,reason,before,after,outcome,classification) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
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
