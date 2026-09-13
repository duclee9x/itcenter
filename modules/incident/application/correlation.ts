import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";

export async function correlateIncident(input: {
  tx: Transaction;
  childIncidentId: string;
  rootIncidentId: string;
  relatedEntityType: "INCIDENT" | "TICKET";
  relatedEntityId: string;
  reason: string;
  score?: number | undefined;
}) {
  if (input.childIncidentId === input.rootIncidentId)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "An incident cannot correlate to itself.",
    );
  if (input.relatedEntityType === "INCIDENT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Incident Root relationships must use the explicit correlation attach command.",
    );
  if (
    !input.reason.trim() ||
    (input.score !== undefined && (input.score < 0 || input.score > 1))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Correlation reason and valid score are required.",
    );
  const incidents = await input.tx.query(
    "SELECT id FROM incident.incidents WHERE tenant_id=$1 AND id IN ($2,$3)",
    [input.tx.tenantId, input.childIncidentId, input.rootIncidentId],
  );
  if (incidents.rowCount !== 2)
    throw new ApplicationError("NOT_FOUND", "Incident was not found.");
  const ticket = await input.tx.query(
    "SELECT id FROM helpdesk.tickets WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.relatedEntityId],
  );
  if (!ticket.rowCount)
    throw new ApplicationError("NOT_FOUND", "Ticket was not found.");
  await input.tx.query(
    "INSERT INTO incident.relations(id,tenant_id,root_incident_id,related_entity_type,related_entity_id,relation_reason,correlation_score) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      randomUUID(),
      input.tx.tenantId,
      input.rootIncidentId,
      input.relatedEntityType,
      input.relatedEntityId,
      input.reason,
      input.score ?? null,
    ],
  );
  return {
    root_incident_id: input.rootIncidentId,
    related_entity_type: input.relatedEntityType,
    related_entity_id: input.relatedEntityId,
    correlation_reason: input.reason,
    correlation_score: input.score ?? null,
  };
}
