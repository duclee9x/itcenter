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

export async function upsertAssetLifecycleWorkItem(input: {
  tx: Transaction;
  sourceId: string;
  title: string;
  priority?: string;
}): Promise<void> {
  await input.tx.query(
    `INSERT INTO operations.work_items
       (id,tenant_id,source_type,source_id,title,priority,owner_team_id)
     VALUES($1,$2,'ASSET_LIFECYCLE',$3,$4,$5,'ASSET')
     ON CONFLICT(tenant_id,source_type,source_id) DO UPDATE SET
       title=EXCLUDED.title,priority=EXCLUDED.priority,
       state=CASE WHEN operations.work_items.state IN ('RESOLVED','CLOSED') THEN 'NEW' ELSE operations.work_items.state END,
       resolved_at=CASE WHEN operations.work_items.state IN ('RESOLVED','CLOSED') THEN NULL ELSE operations.work_items.resolved_at END,
       last_action_at=now(),version=operations.work_items.version+1`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.sourceId,
      input.title,
      input.priority ?? "HIGH",
    ],
  );
}

export async function resolveAssetLifecycleWorkItem(input: {
  tx: Transaction;
  sourceId: string;
}): Promise<void> {
  await input.tx.query(
    `UPDATE operations.work_items SET state='RESOLVED',resolved_at=now(),last_action_at=now(),version=version+1
      WHERE tenant_id=$1 AND source_type='ASSET_LIFECYCLE' AND source_id=$2 AND state NOT IN ('RESOLVED','CLOSED')`,
    [input.tx.tenantId, input.sourceId],
  );
}

export async function recordAssetLifecycleTimelineEvent(input: {
  tx: Transaction;
  assetId: string;
  eventType: string;
  summary: string;
  payload: unknown;
  sourceEventId?: string;
}): Promise<void> {
  await input.tx.query(
    `INSERT INTO operations.timeline_events(id,tenant_id,entity_type,entity_id,event_type,summary,payload,source_event_id)
     VALUES($1,$2,'ASSET',$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,source_event_id) DO NOTHING`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.assetId,
      input.eventType,
      input.summary,
      JSON.stringify(input.payload ?? {}),
      input.sourceEventId ?? randomUUID(),
    ],
  );
}

export async function recordProcurementTimelineEvent(input: {
  tx: Transaction;
  entityType: "SUPPLIER" | "PROCUREMENT_REQUEST";
  entityId: string;
  eventType: string;
  payload: unknown;
  sourceEventId: string;
}): Promise<void> {
  await input.tx.query(
    `INSERT INTO operations.timeline_events
       (id,tenant_id,entity_type,entity_id,event_type,summary,payload,source_event_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(tenant_id,source_event_id) DO NOTHING`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.entityType,
      input.entityId,
      input.eventType,
      `${input.eventType} committed`,
      JSON.stringify(input.payload ?? {}),
      input.sourceEventId,
    ],
  );
}

export async function readEntityTimeline(input: {
  tx: Transaction;
  entityType: "SUPPLIER" | "PROCUREMENT_REQUEST";
  entityId: string;
  limit?: number;
}) {
  const result = await input.tx.query(
    `SELECT id,event_type,summary,payload,occurred_at
       FROM operations.timeline_events
      WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3
      ORDER BY occurred_at DESC,id DESC LIMIT $4`,
    [input.tx.tenantId, input.entityType, input.entityId, input.limit ?? 100],
  );
  return result.rows;
}

export async function upsertApprovalWorkItem(input: {
  tx: Transaction;
  approvalId: string;
  title: string;
}): Promise<void> {
  await input.tx.query(
    `INSERT INTO operations.work_items(id,tenant_id,source_type,source_id,title,priority,owner_team_id)
     VALUES($1,$2,'APPROVAL',$3,$4,'HIGH','APPROVAL')
     ON CONFLICT(tenant_id,source_type,source_id) DO UPDATE SET title=EXCLUDED.title,
       state=CASE WHEN operations.work_items.state IN ('RESOLVED','CLOSED') THEN 'NEW' ELSE operations.work_items.state END,
       resolved_at=NULL,last_action_at=now(),version=operations.work_items.version+1`,
    [randomUUID(), input.tx.tenantId, input.approvalId, input.title],
  );
}

export async function resolveApprovalWorkItem(input: {
  tx: Transaction;
  approvalId: string;
}): Promise<void> {
  await input.tx.query(
    "UPDATE operations.work_items SET state='RESOLVED',resolved_at=now(),last_action_at=now(),version=version+1 WHERE tenant_id=$1 AND source_type='APPROVAL' AND source_id=$2 AND state NOT IN ('RESOLVED','CLOSED')",
    [input.tx.tenantId, input.approvalId],
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
