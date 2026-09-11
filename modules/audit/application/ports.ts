import type {
  ActorContext,
  Json,
} from "../../../packages/shared-kernel/src/index.js";
export interface AuditRecord {
  id: string;
  tenant_id: string;
  event_type: string;
  occurred_at: string;
  actor: ActorContext;
  action: { command_type: string };
  subject: { entity_type: string; entity_id: string };
  correlation_id: string;
  causation_id: string;
  reason: { code: string; text: string };
  before: Json;
  after: Json;
  outcome: { status: string };
  classification: string;
  relations: readonly {
    entity_type: string;
    entity_id: string;
    relation: string;
  }[];
  evidence: readonly {
    type: string;
    id: string;
    checksum: string;
    relation: string;
  }[];
}
export interface AuditPort {
  append(record: AuditRecord): Promise<void>;
}
