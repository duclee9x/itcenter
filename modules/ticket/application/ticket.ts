import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
const transitions: Record<string, readonly string[]> = {
  NEW: ["TRIAGE", "CANCELLED"],
  TRIAGE: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: [
    "WAITING_USER",
    "WAITING_VENDOR",
    "WAITING_APPROVAL",
    "WAITING_CHANGE",
    "RESOLVED",
  ],
  WAITING_USER: ["IN_PROGRESS"],
  WAITING_VENDOR: ["IN_PROGRESS"],
  WAITING_APPROVAL: ["IN_PROGRESS"],
  WAITING_CHANGE: ["IN_PROGRESS"],
  RESOLVED: ["CLOSED", "REOPENED"],
  REOPENED: ["IN_PROGRESS"],
  CLOSED: [],
  CANCELLED: [],
};
export async function createTicket(input: {
  tx: Transaction;
  ticketCode: string;
  title: string;
  description: string;
  requesterUserId: string;
  priority: string;
  sourceChannel: string;
}): Promise<{
  id: string;
  ticket_code: string;
  state: string;
  version: number;
}> {
  if (
    !input.ticketCode.trim() ||
    !input.title.trim() ||
    !input.description.trim() ||
    !input.requesterUserId.trim() ||
    !["P1", "P2", "P3", "P4"].includes(input.priority) ||
    !["PORTAL", "EMAIL", "API"].includes(input.sourceChannel)
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "ticket fields and source_channel are required.",
    );
  const user = await input.tx.query(
    "SELECT id FROM identity.users WHERE tenant_id=$1 AND id=$2 AND employment_status='ACTIVE'",
    [input.tx.tenantId, input.requesterUserId],
  );
  if (!user.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Requester is not active.",
    );
  const id = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO helpdesk.tickets(id,tenant_id,ticket_code,title,description,requester_user_id,priority,source_channel) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        input.tx.tenantId,
        input.ticketCode,
        input.title,
        input.description,
        input.requesterUserId,
        input.priority,
        input.sourceChannel,
      ],
    );
    await input.tx.query(
      "INSERT INTO helpdesk.ticket_messages(id,tenant_id,ticket_id,author_user_id,channel,body) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        input.tx.tenantId,
        id,
        input.requesterUserId,
        input.sourceChannel,
        input.description,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Ticket code already exists.",
      );
    throw error;
  }
  return { id, ticket_code: input.ticketCode, state: "NEW", version: 1 };
}
export async function transitionTicket(input: {
  tx: Transaction;
  ticketId: string;
  expectedVersion: number;
  targetState: string;
  reason: string;
  actorType: string;
  actorId: string;
  correlationId: string;
  assigneeUserId?: string;
  resolutionCode?: string;
}): Promise<{
  id: string;
  from_state: string;
  to_state: string;
  resolution_code?: string;
  version: number;
}> {
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    !input.reason.trim() ||
    !transitions[input.targetState]
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version, target state and reason are required.",
    );
  const result = await input.tx.query(
    "SELECT id,state,version FROM helpdesk.tickets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.ticketId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Ticket was not found.");
  const ticket = result.rows[0]!;
  assertVersion(ticket.version, input.expectedVersion);
  if (!transitions[String(ticket.state)]?.includes(input.targetState))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid ticket state transition.",
    );
  if (input.targetState === "RESOLVED" && !input.resolutionCode?.trim())
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Resolution code is required.",
    );
  if (input.assigneeUserId) {
    const user = await input.tx.query(
      "SELECT id FROM identity.users WHERE tenant_id=$1 AND id=$2 AND employment_status='ACTIVE'",
      [input.tx.tenantId, input.assigneeUserId],
    );
    if (!user.rowCount)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Assignee is not active.",
      );
  }
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE helpdesk.tickets SET state=$1,assignee_user_id=COALESCE($2,assignee_user_id),resolution_code=CASE WHEN $1='RESOLVED' THEN $3 ELSE resolution_code END,resolved_at=CASE WHEN $1='RESOLVED' THEN now() ELSE resolved_at END,updated_at=now(),version=$4 WHERE tenant_id=$5 AND id=$6",
    [
      input.targetState,
      input.assigneeUserId ?? null,
      input.resolutionCode ?? null,
      version,
      input.tx.tenantId,
      input.ticketId,
    ],
  );
  await input.tx.query(
    "INSERT INTO helpdesk.ticket_transitions(id,tenant_id,ticket_id,from_state,to_state,command_type,reason,actor_type,actor_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.ticketId,
      ticket.state,
      input.targetState,
      `TICKET.${input.targetState}`,
      input.reason,
      input.actorType,
      input.actorId,
      input.correlationId,
    ],
  );
  return {
    id: input.ticketId,
    from_state: String(ticket.state),
    to_state: input.targetState,
    ...(input.resolutionCode ? { resolution_code: input.resolutionCode } : {}),
    version,
  };
}
