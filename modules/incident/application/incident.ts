import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
const transitions: Record<string, string[]> = {
  DETECTED: ["INVESTIGATING"],
  INVESTIGATING: ["IDENTIFIED", "MITIGATING"],
  IDENTIFIED: ["MITIGATING"],
  MITIGATING: ["MONITORING_RECOVERY", "RESTORED"],
  MONITORING_RECOVERY: ["RESTORED"],
  RESTORED: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};
export async function createIncident(input: {
  tx: Transaction;
  incidentCode: string;
  title: string;
  source: string;
  monitoringEventId?: string | undefined;
  priority: string;
  serviceId?: string | undefined;
}) {
  if (
    !input.incidentCode.trim() ||
    !input.title.trim() ||
    !["P1", "P2", "P3", "P4"].includes(input.priority)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "incident_code, title and valid priority are required.",
    );
  const id = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO incident.incidents(id,tenant_id,incident_code,title,source,monitoring_event_id,priority,service_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        input.tx.tenantId,
        input.incidentCode,
        input.title,
        input.source,
        input.monitoringEventId ?? null,
        input.priority,
        input.serviceId ?? null,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Incident code or monitoring event already exists.",
      );
    throw error;
  }
  return {
    id,
    incident_code: input.incidentCode,
    state: "DETECTED",
    priority: input.priority,
    version: 1,
  };
}
export async function transitionIncident(input: {
  tx: Transaction;
  incidentId: string;
  expectedVersion: number;
  targetState: string;
  reason: string;
  verification?: string | undefined;
  resolutionSummary?: string | undefined;
  postChecks?: string | undefined;
}) {
  const row = await input.tx.query(
    "SELECT id,state,version FROM incident.incidents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.incidentId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Incident was not found.");
  const incident = row.rows[0]!;
  assertVersion(incident.version, input.expectedVersion);
  if (!transitions[String(incident.state)]?.includes(input.targetState))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid incident state transition.",
    );
  if (input.targetState === "RESTORED" && !input.verification?.trim())
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Restoration verification is required.",
    );
  if (input.targetState === "RESOLVED" && !input.resolutionSummary?.trim())
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Resolution summary is required.",
    );
  if (input.targetState === "CLOSED" && !input.postChecks?.trim())
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Post-resolution checks are required.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE incident.incidents SET state=$1,restoration_verification=COALESCE($2,restoration_verification),resolution_summary=COALESCE($3,resolution_summary),post_resolution_checks=COALESCE($4,post_resolution_checks),version=$5,updated_at=now() WHERE tenant_id=$6 AND id=$7",
    [
      input.targetState,
      input.verification ?? null,
      input.resolutionSummary ?? null,
      input.postChecks ?? null,
      version,
      input.tx.tenantId,
      input.incidentId,
    ],
  );
  if (input.targetState === "CLOSED" || input.targetState === "CANCELLED") {
    await input.tx.query(
      `UPDATE incident.correlation_clusters SET status='ENDED',ended_at=now(),ended_reason='ROOT_INCIDENT_TERMINAL'
        WHERE tenant_id=$1 AND root_incident_id=$2 AND status='ACTIVE'`,
      [input.tx.tenantId, input.incidentId],
    );
    await input.tx.query(
      "DELETE FROM incident.correlation_active_suppressions WHERE tenant_id=$1 AND root_incident_id=$2",
      [input.tx.tenantId, input.incidentId],
    );
  }
  return {
    id: input.incidentId,
    from_state: String(incident.state),
    to_state: input.targetState,
    version,
  };
}
