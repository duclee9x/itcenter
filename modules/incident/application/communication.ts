import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

export async function declareMajor(input: {
  tx: Transaction;
  incidentId: string;
  expectedVersion: number;
  reason: string;
  cadence: string;
}) {
  if (!input.reason.trim() || !input.cadence.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "reason and communication cadence are required.",
    );
  const row = await input.tx.query(
    "SELECT id,is_major,version FROM incident.incidents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.incidentId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Incident was not found.");
  assertVersion(row.rows[0]!.version, input.expectedVersion);
  if (row.rows[0]!.is_major)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Incident is already major.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE incident.incidents SET is_major=true,version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
    [version, input.tx.tenantId, input.incidentId],
  );
  return {
    id: input.incidentId,
    is_major: true,
    version,
    reason: input.reason,
    communication_cadence: input.cadence,
  };
}

export async function publishCommunication(input: {
  tx: Transaction;
  incidentId: string;
  audience: string;
  channel: string;
  subject: string;
  body: string;
}) {
  if (
    !["PORTAL", "EMAIL", "TEAMS", "SLACK", "WEBHOOK"].includes(input.channel) ||
    !input.audience.trim() ||
    !input.subject.trim() ||
    !input.body.trim()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "audience, valid channel, subject and body are required.",
    );
  const incident = await input.tx.query(
    "SELECT id,is_major FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.incidentId],
  );
  if (!incident.rowCount)
    throw new ApplicationError("NOT_FOUND", "Incident was not found.");
  if (!incident.rows[0]!.is_major)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only major incidents can publish communication.",
    );
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO incident.communications(id,tenant_id,incident_id,audience,channel,subject,body,status,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,'PUBLISHED',now())",
    [
      id,
      input.tx.tenantId,
      input.incidentId,
      input.audience,
      input.channel,
      input.subject,
      input.body,
    ],
  );
  return {
    id,
    incident_id: input.incidentId,
    audience: input.audience,
    channel: input.channel,
    status: "PUBLISHED",
  };
}
