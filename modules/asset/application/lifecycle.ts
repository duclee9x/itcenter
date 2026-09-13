import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

const transitions: Record<string, readonly string[]> = {
  PLANNED: ["PURCHASED"],
  PURCHASED: ["RECEIVED"],
  RECEIVED: ["AVAILABLE"],
  AVAILABLE: ["RESERVED", "RETIRED"],
  RESERVED: ["ASSIGNED"],
  ASSIGNED: ["IN_USE"],
  IN_USE: ["REPAIR", "RETURNED"],
  REPAIR: ["IN_USE", "AVAILABLE"],
  RETURNED: ["REPAIR", "AVAILABLE", "RETIRED"],
  RETIRED: ["DISPOSED"],
  DISPOSED: [],
};

export async function transitionLifecycle(input: {
  tx: Transaction;
  assetId: string;
  expectedVersion: number;
  targetState: string;
  actorType: string;
  actorId: string;
  reason: string;
  correlationId: string;
  commandType?: string;
}): Promise<{
  id: string;
  from_state: string;
  to_state: string;
  version: number;
}> {
  if (!Number.isSafeInteger(input.expectedVersion) || !input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version and reason are required.",
    );
  const result = await input.tx.query(
    "SELECT id,lifecycle_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  const asset = result.rows[0]!;
  assertVersion(asset.version, input.expectedVersion);
  if (!transitions[String(asset.lifecycle_state)]?.includes(input.targetState))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      `Invalid asset lifecycle transition to ${input.targetState}.`,
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE asset.assets SET lifecycle_state=$1, assignment_state=CASE WHEN $1='RESERVED' THEN 'RESERVED' WHEN $1='AVAILABLE' THEN 'UNASSIGNED' ELSE assignment_state END,updated_at=now(),version=$2 WHERE tenant_id=$3 AND id=$4",
    [input.targetState, version, input.tx.tenantId, input.assetId],
  );
  await input.tx.query(
    "INSERT INTO asset.lifecycle_transitions(id,tenant_id,asset_id,from_state,to_state,command_type,actor_type,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.assetId,
      asset.lifecycle_state,
      input.targetState,
      input.commandType ?? `ASSET.${input.targetState}`,
      input.actorType,
      input.actorId,
      input.reason,
      input.correlationId,
    ],
  );
  return {
    id: input.assetId,
    from_state: String(asset.lifecycle_state),
    to_state: input.targetState,
    version,
  };
}

export async function reserveAsset(input: {
  tx: Transaction;
  assetId: string;
  expectedVersion: number;
  requestedFor: string;
  reason: string;
  expiresAt: string;
  actorType: string;
  actorId: string;
  correlationId: string;
}): Promise<{
  reservation_id: string;
  asset_id: string;
  expires_at: string;
  version: number;
}> {
  if (
    !input.requestedFor.trim() ||
    new Date(input.expiresAt).getTime() <= Date.now()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "requested_for and a future expires_at are required.",
    );
  const changed = await transitionLifecycle({
    ...input,
    targetState: "RESERVED",
    commandType: "ASSET.RESERVE",
  });
  const id = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO asset.reservations(id,tenant_id,asset_id,requested_for,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        input.tx.tenantId,
        input.assetId,
        input.requestedFor,
        input.reason,
        input.expiresAt,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Asset already has an active reservation.",
      );
    throw error;
  }
  return {
    reservation_id: id,
    asset_id: input.assetId,
    expires_at: input.expiresAt,
    version: changed.version,
  };
}

export async function assignAsset(input: {
  tx: Transaction;
  assetId: string;
  expectedVersion: number;
  userId: string;
  reason: string;
  actorType: string;
  actorId: string;
  correlationId: string;
}): Promise<{
  assignment_id: string;
  asset_id: string;
  user_id: string;
  version: number;
}> {
  if (!input.userId.trim() || !input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "user_id and reason are required.",
    );
  const user = await input.tx.query(
    "SELECT id FROM identity.users WHERE tenant_id=$1 AND id=$2 AND employment_status='ACTIVE'",
    [input.tx.tenantId, input.userId],
  );
  if (!user.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Target user is not active.",
    );
  const changed = await transitionLifecycle({
    ...input,
    targetState: "ASSIGNED",
    commandType: "ASSET.ASSIGN",
  });
  const id = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO asset.assignments(id,tenant_id,asset_id,user_id,reason) VALUES($1,$2,$3,$4,$5)",
      [id, input.tx.tenantId, input.assetId, input.userId, input.reason],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Asset already has an active primary assignment.",
      );
    throw error;
  }
  await input.tx.query(
    "UPDATE asset.assets SET assignment_state='ASSIGNED' WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.assetId],
  );
  return {
    assignment_id: id,
    asset_id: input.assetId,
    user_id: input.userId,
    version: changed.version,
  };
}

export async function transferAsset(input: {
  tx: Transaction;
  assetId: string;
  expectedVersion: number;
  toLocationId: string;
  toUserId: string;
  reason: string;
  actorType: string;
  actorId: string;
  correlationId: string;
}): Promise<{
  movement_id: string;
  asset_id: string;
  from_location_id: string | null;
  to_location_id: string;
  from_user_id: string;
  to_user_id: string;
  version: number;
}> {
  if (
    !input.toLocationId.trim() ||
    !input.toUserId.trim() ||
    !input.reason.trim()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "to_location_id, to_user_id and reason are required.",
    );
  const assetResult = await input.tx.query(
    "SELECT id,lifecycle_state,assignment_state,current_location_id,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!assetResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  const asset = assetResult.rows[0]!;
  assertVersion(asset.version, input.expectedVersion);
  if (
    !["ASSIGNED", "IN_USE"].includes(String(asset.lifecycle_state)) ||
    asset.assignment_state !== "ASSIGNED"
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Asset is not transferable in its current state.",
    );
  const location = await input.tx.query(
    "SELECT id FROM asset.locations WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
    [input.tx.tenantId, input.toLocationId],
  );
  if (!location.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Destination location was not found.",
    );
  const user = await input.tx.query(
    "SELECT id FROM identity.users WHERE tenant_id=$1 AND id=$2 AND employment_status='ACTIVE'",
    [input.tx.tenantId, input.toUserId],
  );
  if (!user.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Destination user is not active.",
    );
  const assignment = await input.tx.query(
    "SELECT id,user_id FROM asset.assignments WHERE tenant_id=$1 AND asset_id=$2 AND status='ACTIVE' AND assignment_type='PRIMARY' FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!assignment.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Asset has no active primary assignment.",
    );
  const currentAssignment = assignment.rows[0]!;
  const movementId = randomUUID();
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "INSERT INTO asset.movements(id,tenant_id,asset_id,movement_type,status,from_location_id,to_location_id,from_user_id,to_user_id,reason,completed_at) VALUES($1,$2,$3,'TRANSFER','COMPLETED',$4,$5,$6,$7,$8,now())",
    [
      movementId,
      input.tx.tenantId,
      input.assetId,
      asset.current_location_id,
      input.toLocationId,
      currentAssignment.user_id,
      input.toUserId,
      input.reason,
    ],
  );
  if (String(currentAssignment.user_id) !== input.toUserId) {
    await input.tx.query(
      "UPDATE asset.assignments SET status='ENDED',ended_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2",
      [input.tx.tenantId, currentAssignment.id],
    );
    await input.tx.query(
      "INSERT INTO asset.assignments(id,tenant_id,asset_id,user_id,assignment_type,status,reason) VALUES($1,$2,$3,$4,'PRIMARY','ACTIVE',$5)",
      [
        randomUUID(),
        input.tx.tenantId,
        input.assetId,
        input.toUserId,
        input.reason,
      ],
    );
  }
  await input.tx.query(
    "UPDATE asset.assets SET current_location_id=$1,updated_at=now(),version=$2 WHERE tenant_id=$3 AND id=$4",
    [input.toLocationId, version, input.tx.tenantId, input.assetId],
  );
  return {
    movement_id: movementId,
    asset_id: input.assetId,
    from_location_id: asset.current_location_id,
    to_location_id: input.toLocationId,
    from_user_id: String(currentAssignment.user_id),
    to_user_id: input.toUserId,
    version,
  };
}

export async function requestReturn(input: {
  tx: Transaction;
  assetId: string;
  expectedVersion: number;
  dueAt: string;
  reason: string;
}): Promise<{
  return_request_id: string;
  asset_id: string;
  assignment_id: string;
  user_id: string;
  due_at: string;
  version: number;
}> {
  if (!input.reason.trim() || new Date(input.dueAt).getTime() <= Date.now())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A future due_at and reason are required.",
    );
  const assetResult = await input.tx.query(
    "SELECT id,lifecycle_state,assignment_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!assetResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  const asset = assetResult.rows[0]!;
  assertVersion(asset.version, input.expectedVersion);
  if (
    !["ASSIGNED", "IN_USE"].includes(String(asset.lifecycle_state)) ||
    asset.assignment_state !== "ASSIGNED"
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Asset does not have an active assignment to return.",
    );
  const assignment = await input.tx.query(
    "SELECT id,user_id FROM asset.assignments WHERE tenant_id=$1 AND asset_id=$2 AND status='ACTIVE' AND assignment_type='PRIMARY' FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!assignment.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Asset has no active primary assignment.",
    );
  const currentAssignment = assignment.rows[0]!;
  const requestId = randomUUID();
  try {
    await input.tx.query(
      "INSERT INTO asset.return_requests(id,tenant_id,asset_id,assignment_id,user_id,due_at,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        requestId,
        input.tx.tenantId,
        input.assetId,
        currentAssignment.id,
        currentAssignment.user_id,
        input.dueAt,
        input.reason,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Asset already has a pending return request.",
      );
    throw error;
  }
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE asset.assets SET assignment_state='PENDING_RETURN',updated_at=now(),version=$1 WHERE tenant_id=$2 AND id=$3",
    [version, input.tx.tenantId, input.assetId],
  );
  return {
    return_request_id: requestId,
    asset_id: input.assetId,
    assignment_id: currentAssignment.id,
    user_id: currentAssignment.user_id,
    due_at: input.dueAt,
    version,
  };
}

export async function listUserAssetsForOffboarding(
  tx: Transaction,
  userId: string,
) {
  const rows = await tx.query(
    `SELECT a.id,a.asset_code,a.assignment_state,a.lifecycle_state,a.version,rr.id AS return_request_id,
            rr.status AS return_state
       FROM asset.assignments x JOIN asset.assets a ON a.tenant_id=x.tenant_id AND a.id=x.asset_id
       LEFT JOIN asset.return_requests rr ON rr.tenant_id=x.tenant_id AND rr.assignment_id=x.id AND rr.status='PENDING'
      WHERE x.tenant_id=$1 AND x.user_id=$2 AND x.status='ACTIVE' AND x.assignment_type='PRIMARY'
      ORDER BY a.id`,
    [tx.tenantId, userId],
  );
  return rows.rows.map((row) => ({
    id: String(row.id),
    asset_code: String(row.asset_code),
    assignment_state: String(row.assignment_state),
    lifecycle_state: String(row.lifecycle_state),
    version: Number(row.version),
    return_request_id: row.return_request_id
      ? String(row.return_request_id)
      : null,
    return_state: row.return_state ? String(row.return_state) : null,
  }));
}

export async function cancelReturnRequest(input: {
  tx: Transaction;
  assetId: string;
  returnRequestId: string;
  expectedVersion: number;
  reason: string;
}) {
  if (
    !input.reason.trim() ||
    input.reason.length > 2000 ||
    /(?:password|access[_ -]?token|secret|api[_ -]?key|license[_ -]?key)\s*[:=]\s*\S+/i.test(
      input.reason,
    )
  )
    throw new ApplicationError("VALIDATION_ERROR", "reason is required.");
  const asset = await input.tx.query(
    "SELECT assignment_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!asset.rowCount)
    throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  const req = await input.tx.query(
    "SELECT id,assignment_id,status,cancelled_reason FROM asset.return_requests WHERE tenant_id=$1 AND id=$2 AND asset_id=$3 FOR UPDATE",
    [input.tx.tenantId, input.returnRequestId, input.assetId],
  );
  if (
    req.rowCount &&
    req.rows[0]!.status === "CANCELLED" &&
    req.rows[0]!.cancelled_reason === input.reason.trim()
  )
    return {
      asset_id: input.assetId,
      version: Number(asset.rows[0]!.version),
      return_request_id: input.returnRequestId,
      noOp: true,
    };
  assertVersion(Number(asset.rows[0]!.version), input.expectedVersion);
  if (
    !req.rowCount ||
    req.rows[0]!.status !== "PENDING" ||
    asset.rows[0]!.assignment_state !== "PENDING_RETURN"
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Pending return request cannot be recovered.",
    );
  await input.tx.query(
    "UPDATE asset.return_requests SET status='CANCELLED',cancelled_reason=$3 WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.returnRequestId, input.reason.trim()],
  );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE asset.assets SET assignment_state='ASSIGNED',version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
    [version, input.tx.tenantId, input.assetId],
  );
  return {
    asset_id: input.assetId,
    version,
    return_request_id: input.returnRequestId,
    noOp: false,
  };
}

export async function readReturnRequestState(
  tx: Transaction,
  returnRequestId: string,
) {
  const result = await tx.query(
    "SELECT status,asset_id FROM asset.return_requests WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, returnRequestId],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Asset return request was not found.",
    );
  return {
    status: String(result.rows[0]!.status),
    asset_id: String(result.rows[0]!.asset_id),
  };
}

export async function receiveReturn(input: {
  tx: Transaction;
  assetId: string;
  expectedVersion: number;
  returnRequestId: string;
  receivedLocationId: string;
  conditionGrade: string;
  notes: string;
}): Promise<{
  return_id: string;
  asset_id: string;
  condition_grade: string;
  received_location_id: string;
  version: number;
}> {
  if (
    !input.returnRequestId.trim() ||
    !input.receivedLocationId.trim() ||
    !["A", "B", "C", "D", "E"].includes(input.conditionGrade) ||
    !input.notes.trim()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "return_request_id, received_location_id, condition_grade and notes are required.",
    );
  const assetResult = await input.tx.query(
    "SELECT id,lifecycle_state,assignment_state,current_location_id,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.assetId],
  );
  if (!assetResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Asset was not found.");
  const asset = assetResult.rows[0]!;
  assertVersion(asset.version, input.expectedVersion);
  if (asset.assignment_state !== "PENDING_RETURN")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Asset is not pending return.",
    );
  const location = await input.tx.query(
    "SELECT id FROM asset.locations WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
    [input.tx.tenantId, input.receivedLocationId],
  );
  if (!location.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Receiving location was not found.",
    );
  const request = await input.tx.query(
    "SELECT id,assignment_id,user_id,status FROM asset.return_requests WHERE tenant_id=$1 AND id=$2 AND asset_id=$3 FOR UPDATE",
    [input.tx.tenantId, input.returnRequestId, input.assetId],
  );
  if (!request.rowCount || request.rows[0]?.status !== "PENDING")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Return request is not pending.",
    );
  const currentRequest = request.rows[0]!;
  const movementId = randomUUID();
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "INSERT INTO asset.movements(id,tenant_id,asset_id,movement_type,status,from_location_id,to_location_id,from_user_id,reason,completed_at) VALUES($1,$2,$3,'RETURN','COMPLETED',$4,$5,$6,$7,now())",
    [
      movementId,
      input.tx.tenantId,
      input.assetId,
      asset.current_location_id,
      input.receivedLocationId,
      currentRequest.user_id,
      input.notes,
    ],
  );
  const documentId = randomUUID();
  await input.tx.query(
    "INSERT INTO asset.return_documents(id,tenant_id,return_request_id,asset_id,condition_grade,received_location_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      documentId,
      input.tx.tenantId,
      input.returnRequestId,
      input.assetId,
      input.conditionGrade,
      input.receivedLocationId,
      input.notes,
    ],
  );
  await input.tx.query(
    "UPDATE asset.assignments SET status='ENDED',ended_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, currentRequest.assignment_id],
  );
  await input.tx.query(
    "UPDATE asset.return_requests SET status='FULFILLED',fulfilled_at=now() WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.returnRequestId],
  );
  await input.tx.query(
    "UPDATE asset.assets SET lifecycle_state='RETURNED',assignment_state='UNASSIGNED',current_location_id=$1,updated_at=now(),version=$2 WHERE tenant_id=$3 AND id=$4",
    [input.receivedLocationId, version, input.tx.tenantId, input.assetId],
  );
  return {
    return_id: documentId,
    asset_id: input.assetId,
    condition_grade: input.conditionGrade,
    received_location_id: input.receivedLocationId,
    version,
  };
}
