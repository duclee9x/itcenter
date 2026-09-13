import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import type { SlaTargetPurpose } from "./sla-target-purpose.js";
const allowed: Record<string, string[]> = {
  RUNNING: ["PAUSED", "WARNING", "CRITICAL", "BREACHED", "MET", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED"],
  WARNING: ["PAUSED", "CRITICAL", "BREACHED", "MET", "CANCELLED"],
  CRITICAL: ["PAUSED", "BREACHED", "MET", "CANCELLED"],
  BREACHED: [],
  MET: [],
  CANCELLED: [],
};
export async function startSla(input: {
  tx: Transaction;
  objectType: string;
  objectId: string;
  targetId: string;
  now: string;
}) {
  const target = await input.tx.query(
    `SELECT t.id,t.sla_policy_id,t.duration_minutes,t.target_purpose,p.version AS policy_version
       FROM control.sla_targets t JOIN control.sla_policies p
         ON p.tenant_id=t.tenant_id AND p.id=t.sla_policy_id
      WHERE t.tenant_id=$1 AND t.id=$2`,
    [input.tx.tenantId, input.targetId],
  );
  if (!target.rowCount)
    throw new ApplicationError("NOT_FOUND", "SLA target was not found.");
  const started = new Date(input.now);
  const due = new Date(
    started.getTime() + Number(target.rows[0]!.duration_minutes) * 60000,
  );
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO control.sla_instances(id,tenant_id,object_type,object_id,target_id,policy_version,started_at,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      input.tx.tenantId,
      input.objectType,
      input.objectId,
      input.targetId,
      target.rows[0]!.policy_version,
      input.now,
      due.toISOString(),
    ],
  );
  await input.tx.query(
    "INSERT INTO control.sla_events(id,tenant_id,instance_id,event_type,to_state,reason) VALUES($1,$2,$3,'START','RUNNING','SLA started')",
    [randomUUID(), input.tx.tenantId, id],
  );
  return {
    id,
    object_type: input.objectType,
    object_id: input.objectId,
    target_purpose: target.rows[0]!.target_purpose as SlaTargetPurpose,
    state: "RUNNING",
    due_at: due.toISOString(),
    version: 1,
  };
}
export async function transitionSla(input: {
  tx: Transaction;
  instanceId: string;
  expectedVersion: number;
  targetState: string;
  reason: string;
}) {
  const row = await input.tx.query(
    "SELECT id,state,version FROM control.sla_instances WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.instanceId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "SLA instance was not found.");
  const item = row.rows[0]!;
  assertVersion(item.version, input.expectedVersion);
  if (
    !input.reason.trim() ||
    !allowed[String(item.state)]?.includes(input.targetState)
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid SLA transition or reason.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE control.sla_instances SET state=$1,version=$2,completed_at=CASE WHEN $1 IN ('MET','BREACHED','CANCELLED') THEN now() ELSE completed_at END WHERE tenant_id=$3 AND id=$4",
    [input.targetState, version, input.tx.tenantId, input.instanceId],
  );
  await input.tx.query(
    "INSERT INTO control.sla_events(id,tenant_id,instance_id,event_type,from_state,to_state,reason) VALUES($1,$2,$3,'STATE_CHANGED',$4,$5,$6)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.instanceId,
      item.state,
      input.targetState,
      input.reason,
    ],
  );
  return {
    id: input.instanceId,
    from_state: String(item.state),
    to_state: input.targetState,
    version,
  };
}
