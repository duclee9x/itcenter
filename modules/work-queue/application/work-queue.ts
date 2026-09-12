import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
export async function createTicketWorkItem(input: {
  tx: Transaction;
  ticketId: string;
  title: string;
  priority: string;
}): Promise<{
  id: string;
  source_type: string;
  source_id: string;
  state: string;
  version: number;
}> {
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO operations.work_items(id,tenant_id,source_type,source_id,title,priority,owner_team_id) VALUES($1,$2,'TICKET',$3,$4,$5,'HELPDESK') ON CONFLICT (tenant_id,source_type,source_id) DO NOTHING",
    [id, input.tx.tenantId, input.ticketId, input.title, input.priority],
  );
  const result = await input.tx.query(
    "SELECT id,source_type,source_id,state,version FROM operations.work_items WHERE tenant_id=$1 AND source_type='TICKET' AND source_id=$2",
    [input.tx.tenantId, input.ticketId],
  );
  return result.rows[0] as {
    id: string;
    source_type: string;
    source_id: string;
    state: string;
    version: number;
  };
}

export async function createNetworkExceptionWorkItem(input: {
  tx: Transaction;
  exceptionId: string;
  title: string;
  priority: string;
}): Promise<void> {
  await input.tx.query(
    "INSERT INTO operations.work_items(id,tenant_id,source_type,source_id,title,priority,owner_team_id) VALUES($1,$2,'NETWORK_EXCEPTION',$3,$4,$5,'NETWORK') ON CONFLICT (tenant_id,source_type,source_id) DO NOTHING",
    [
      randomUUID(),
      input.tx.tenantId,
      input.exceptionId,
      input.title,
      input.priority,
    ],
  );
}

export async function resolveNetworkExceptionWorkItem(input: {
  tx: Transaction;
  exceptionId: string;
}): Promise<void> {
  await input.tx.query(
    "UPDATE operations.work_items SET state='RESOLVED',resolved_at=now(),last_action_at=now(),version=version+1 WHERE tenant_id=$1 AND source_type='NETWORK_EXCEPTION' AND source_id=$2 AND state NOT IN ('RESOLVED','CLOSED')",
    [input.tx.tenantId, input.exceptionId],
  );
}

export async function createOffboardingWorkItem(input: {
  tx: Transaction;
  caseId: string;
  title: string;
}): Promise<void> {
  await input.tx.query(
    "INSERT INTO operations.work_items(id,tenant_id,source_type,source_id,title,priority,owner_team_id) VALUES($1,$2,'OFFBOARDING',$3,$4,'HIGH','IDENTITY') ON CONFLICT (tenant_id,source_type,source_id) DO NOTHING",
    [randomUUID(), input.tx.tenantId, input.caseId, input.title],
  );
}

export async function resolveOffboardingWorkItem(input: {
  tx: Transaction;
  caseId: string;
}): Promise<void> {
  await input.tx.query(
    "UPDATE operations.work_items SET state='RESOLVED',resolved_at=now(),last_action_at=now(),version=version+1 WHERE tenant_id=$1 AND source_type='OFFBOARDING' AND source_id=$2 AND state NOT IN ('RESOLVED','CLOSED')",
    [input.tx.tenantId, input.caseId],
  );
}

export async function createSoftwareExceptionWorkItem(input: {
  tx: Transaction;
  exceptionId: string;
  title: string;
  priority: string;
}): Promise<void> {
  await input.tx.query(
    `INSERT INTO operations.work_items
       (id,tenant_id,source_type,source_id,title,priority,owner_team_id)
     VALUES($1,$2,'SOFTWARE_EXCEPTION',$3,$4,$5,'SOFTWARE_SECURITY')
     ON CONFLICT(tenant_id,source_type,source_id) DO UPDATE SET
       title=EXCLUDED.title,priority=EXCLUDED.priority,
       state=CASE WHEN operations.work_items.state IN ('RESOLVED','CLOSED')
         THEN 'NEW' ELSE operations.work_items.state END,
       resolved_at=CASE WHEN operations.work_items.state IN ('RESOLVED','CLOSED')
         THEN NULL ELSE operations.work_items.resolved_at END,
       last_action_at=now(),version=operations.work_items.version+1`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.exceptionId,
      input.title,
      input.priority,
    ],
  );
}

export async function resolveSoftwareExceptionWorkItem(input: {
  tx: Transaction;
  exceptionId: string;
}): Promise<void> {
  await input.tx.query(
    `UPDATE operations.work_items
        SET state='RESOLVED',resolved_at=now(),last_action_at=now(),version=version+1
      WHERE tenant_id=$1 AND source_type='SOFTWARE_EXCEPTION' AND source_id=$2
        AND state NOT IN ('RESOLVED','CLOSED')`,
    [input.tx.tenantId, input.exceptionId],
  );
}
export async function resolveWorkItem(input: {
  tx: Transaction;
  workItemId: string;
  expectedVersion: number;
  reason: string;
}): Promise<{ id: string; source_id: string; state: string; version: number }> {
  if (!Number.isSafeInteger(input.expectedVersion) || !input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version and reason are required.",
    );
  const result = await input.tx.query(
    "SELECT id,source_type,source_id,state,version FROM operations.work_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.workItemId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Work item was not found.");
  const item = result.rows[0]!;
  assertVersion(item.version, input.expectedVersion);
  if (item.source_type !== "TICKET")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Resolve the source resource through its domain command.",
    );
  if (item.state === "RESOLVED" || item.state === "CLOSED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Work item is already resolved.",
    );
  const source = await input.tx.query(
    "SELECT id FROM helpdesk.tickets WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, item.source_id],
  );
  if (!source.rowCount)
    throw new ApplicationError("NOT_FOUND", "Work item source was not found.");
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE operations.work_items SET state='RESOLVED',resolved_at=now(),last_action_at=now(),version=$1 WHERE tenant_id=$2 AND id=$3",
    [version, input.tx.tenantId, input.workItemId],
  );
  return {
    id: input.workItemId,
    source_id: item.source_id,
    state: "RESOLVED",
    version,
  };
}
