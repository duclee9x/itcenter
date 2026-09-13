import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

async function lockIncident(
  tx: Transaction,
  id: string,
  expectedVersion: number,
) {
  const result = await tx.query<{
    id: string;
    state: string;
    version: number;
    root_incident_id: string | null;
  }>(
    "SELECT id,state,version,root_incident_id FROM incident.incidents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Incident was not found.");
  assertVersion(result.rows[0]!.version, expectedVersion);
  return result.rows[0]!;
}

export async function attachIncidentToRoot(input: {
  tx: Transaction;
  incidentId: string;
  rootIncidentId: string;
  decisionId: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  correlationId: string;
}) {
  if (input.incidentId === input.rootIncidentId)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "An Incident cannot be its own Root.",
    );
  if (!input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A reason is required for manual correlation.",
    );
  const child = await lockIncident(
    input.tx,
    input.incidentId,
    input.expectedVersion,
  );
  const root = await input.tx.query<{
    id: string;
    state: string;
    root_incident_id: string | null;
  }>(
    "SELECT id,state,root_incident_id FROM incident.incidents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.rootIncidentId],
  );
  if (!root.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Root Incident was not found in this tenant.",
    );
  if (
    ["CLOSED", "CANCELLED"].includes(root.rows[0]!.state) ||
    root.rows[0]!.root_incident_id
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Selected Incident is not a linkable Root.",
    );
  const decision = await input.tx.query(
    "SELECT id FROM incident.correlation_decisions WHERE tenant_id=$1 AND id=$2 AND subject_incident_id=$3",
    [input.tx.tenantId, input.decisionId, input.incidentId],
  );
  if (!decision.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Correlation decision was not found for this Incident.",
    );
  if (child.root_incident_id && child.root_incident_id !== input.rootIncidentId)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Incident already has a different active Root; automatic reparenting is forbidden.",
    );
  const prior = await input.tx.query<{ suppression_id: string }>(
    "SELECT suppression_id FROM incident.correlation_active_suppressions WHERE tenant_id=$1 AND child_incident_id=$2 AND root_incident_id=$3 FOR UPDATE",
    [input.tx.tenantId, input.incidentId, input.rootIncidentId],
  );
  const suppressionOverridden = !!prior.rowCount;
  if (prior.rowCount) {
    await input.tx.query(
      "DELETE FROM incident.correlation_active_suppressions WHERE tenant_id=$1 AND child_incident_id=$2 AND root_incident_id=$3",
      [input.tx.tenantId, input.incidentId, input.rootIncidentId],
    );
    await input.tx.query(
      "INSERT INTO incident.correlation_suppression_overrides(id,tenant_id,suppression_id,actor_id,reason) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        input.tx.tenantId,
        prior.rows[0]!.suppression_id,
        input.actorId,
        input.reason,
      ],
    );
  }
  const relationId = randomUUID();
  try {
    await input.tx.query(
      `INSERT INTO incident.root_relations(id,tenant_id,child_incident_id,root_incident_id,relation_state,origin,decision_id,reason,linked_by_type,linked_by_id)
      VALUES($1,$2,$3,$4,'ACTIVE','HUMAN',$5,$6,'USER',$7)`,
      [
        relationId,
        input.tx.tenantId,
        input.incidentId,
        input.rootIncidentId,
        input.decisionId,
        input.reason,
        input.actorId,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "VERSION_CONFLICT",
        "Another Root relationship was attached concurrently.",
      );
    throw error;
  }
  const updated = await input.tx.query(
    "UPDATE incident.incidents SET root_incident_id=$1,version=version+1,updated_at=now() WHERE tenant_id=$2 AND id=$3 AND version=$4 AND (root_incident_id IS NULL OR root_incident_id=$1)",
    [
      input.rootIncidentId,
      input.tx.tenantId,
      input.incidentId,
      input.expectedVersion,
    ],
  );
  if (!updated.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Incident changed while correlation was being attached.",
    );
  await input.tx.query(
    "INSERT INTO incident.relations(id,tenant_id,root_incident_id,related_entity_type,related_entity_id,relation_reason) VALUES($1,$2,$3,'INCIDENT',$4,$5) ON CONFLICT DO NOTHING",
    [
      randomUUID(),
      input.tx.tenantId,
      input.rootIncidentId,
      input.incidentId,
      input.reason,
    ],
  );
  await input.tx.query(
    "INSERT INTO incident.correlation_reviews(id,tenant_id,decision_id,subject_incident_id,selected_root_incident_id,result,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,'ATTACHED',$6,$7,$8)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.decisionId,
      input.incidentId,
      input.rootIncidentId,
      input.actorId,
      input.reason,
      input.correlationId,
    ],
  );
  return {
    relation_id: relationId,
    incident_id: input.incidentId,
    root_incident_id: input.rootIncidentId,
    relation_state: "ACTIVE",
    origin: "HUMAN",
    suppression_overridden: suppressionOverridden,
    version: input.expectedVersion + 1,
  };
}

export async function rejectIncidentCorrelation(input: {
  tx: Transaction;
  incidentId: string;
  decisionId: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  correlationId: string;
}) {
  if (!input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A reason is required to reject correlation.",
    );
  await lockIncident(input.tx, input.incidentId, input.expectedVersion);
  const decision = await input.tx.query(
    "SELECT id FROM incident.correlation_decisions WHERE tenant_id=$1 AND id=$2 AND subject_incident_id=$3",
    [input.tx.tenantId, input.decisionId, input.incidentId],
  );
  if (!decision.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Correlation decision was not found for this Incident.",
    );
  await input.tx.query(
    "INSERT INTO incident.correlation_reviews(id,tenant_id,decision_id,subject_incident_id,result,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,'REJECTED',$5,$6,$7)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.decisionId,
      input.incidentId,
      input.actorId,
      input.reason,
      input.correlationId,
    ],
  );
  return {
    incident_id: input.incidentId,
    decision_id: input.decisionId,
    result: "REJECTED",
    reason: input.reason,
  };
}

export async function detachIncidentFromRoot(input: {
  tx: Transaction;
  incidentId: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
}) {
  if (!input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A reason is required to detach correlation.",
    );
  await lockIncident(input.tx, input.incidentId, input.expectedVersion);
  const relation = await input.tx.query<{
    id: string;
    root_incident_id: string;
    version: number;
  }>(
    "SELECT id,root_incident_id,version FROM incident.root_relations WHERE tenant_id=$1 AND child_incident_id=$2 AND relation_state='ACTIVE' FOR UPDATE",
    [input.tx.tenantId, input.incidentId],
  );
  if (!relation.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Incident has no active Root relationship.",
    );
  const active = relation.rows[0]!;
  const update = await input.tx.query(
    `UPDATE incident.root_relations SET relation_state='DETACHED',detached_by_type='USER',detached_by_id=$1,detached_at=now(),detach_reason=$2,version=version+1 WHERE tenant_id=$3 AND id=$4 AND version=$5 AND relation_state='ACTIVE'`,
    [input.actorId, input.reason, input.tx.tenantId, active.id, active.version],
  );
  if (!update.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Correlation relationship changed concurrently.",
    );
  const suppressionId = randomUUID();
  await input.tx.query(
    "INSERT INTO incident.correlation_suppressions(id,tenant_id,child_incident_id,root_incident_id,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)",
    [
      suppressionId,
      input.tx.tenantId,
      input.incidentId,
      active.root_incident_id,
      input.actorId,
      input.reason,
    ],
  );
  await input.tx.query(
    "INSERT INTO incident.correlation_active_suppressions(tenant_id,child_incident_id,root_incident_id,suppression_id) VALUES($1,$2,$3,$4)",
    [
      input.tx.tenantId,
      input.incidentId,
      active.root_incident_id,
      suppressionId,
    ],
  );
  const changed = await input.tx.query(
    "UPDATE incident.incidents SET root_incident_id=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 AND root_incident_id=$4",
    [
      input.tx.tenantId,
      input.incidentId,
      input.expectedVersion,
      active.root_incident_id,
    ],
  );
  if (!changed.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Incident changed while correlation was being detached.",
    );
  return {
    relation_id: active.id,
    incident_id: input.incidentId,
    root_incident_id: active.root_incident_id,
    relation_state: "DETACHED",
    version: input.expectedVersion + 1,
  };
}

export async function readIncidentCorrelationHistory(
  tx: Transaction,
  incidentId: string,
) {
  const exists = await tx.query(
    "SELECT id FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, incidentId],
  );
  if (!exists.rowCount)
    throw new ApplicationError("NOT_FOUND", "Incident was not found.");
  const decisions = await tx.query(
    "SELECT d.*,COALESCE(jsonb_agg(c.evidence) FILTER(WHERE c.id IS NOT NULL),'[]'::jsonb) candidates FROM incident.correlation_decisions d LEFT JOIN incident.correlation_decision_candidates c ON c.tenant_id=d.tenant_id AND c.decision_id=d.id WHERE d.tenant_id=$1 AND d.subject_incident_id=$2 GROUP BY d.id ORDER BY d.created_at DESC",
    [tx.tenantId, incidentId],
  );
  const relations = await tx.query(
    "SELECT * FROM incident.root_relations WHERE tenant_id=$1 AND child_incident_id=$2 ORDER BY linked_at DESC",
    [tx.tenantId, incidentId],
  );
  const reviews = await tx.query(
    "SELECT * FROM incident.correlation_reviews WHERE tenant_id=$1 AND subject_incident_id=$2 ORDER BY created_at DESC",
    [tx.tenantId, incidentId],
  );
  return {
    decisions: decisions.rows,
    relationships: relations.rows,
    reviews: reviews.rows,
  };
}
