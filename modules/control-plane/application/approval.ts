import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
export async function createApproval(input: {
  tx: Transaction;
  sourceType: string;
  sourceId: string;
  policyId: string;
  policyVersion: number;
  requesterId: string;
  context: unknown;
}) {
  const policy = await input.tx.query(
    "SELECT id FROM control.approval_policies WHERE tenant_id=$1 AND id=$2 AND version=$3 AND state='ACTIVE'",
    [input.tx.tenantId, input.policyId, input.policyVersion],
  );
  if (!policy.rowCount)
    throw new ApplicationError("NOT_FOUND", "Approval policy was not found.");
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,context) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      input.tx.tenantId,
      input.sourceType,
      input.sourceId,
      input.policyId,
      input.policyVersion,
      input.requesterId,
      JSON.stringify(input.context ?? {}),
    ],
  );
  return {
    id,
    state: "PENDING",
    version: 1,
    source_type: input.sourceType,
    source_id: input.sourceId,
  };
}
export async function decideApproval(input: {
  tx: Transaction;
  requestId: string;
  expectedVersion: number;
  actorId: string;
  decision: string;
  reason: string;
}) {
  if (
    !["APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(input.decision) ||
    !input.reason.trim()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Valid decision and reason are required.",
    );
  const row = await input.tx.query(
    "SELECT id,state,version,requested_by FROM control.approval_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.requestId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Approval request was not found.");
  const request = row.rows[0]!;
  assertVersion(request.version, input.expectedVersion);
  if (request.requested_by === input.actorId)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Requester cannot approve their own request.",
    );
  if (request.state !== "PENDING")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Approval request is not pending.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE control.approval_requests SET state=$1,version=$2,updated_at=now() WHERE tenant_id=$3 AND id=$4",
    [input.decision, version, input.tx.tenantId, input.requestId],
  );
  await input.tx.query(
    "INSERT INTO control.approval_decisions(id,tenant_id,request_id,actor_id,decision,reason) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.requestId,
      input.actorId,
      input.decision,
      input.reason,
    ],
  );
  return { id: input.requestId, state: input.decision, version };
}
