import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

type OffboardingState =
  | "INITIATED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "READY_TO_CLOSE"
  | "CANCELLATION_PENDING"
  | "COMPLETED"
  | "CANCELLED";
const safeReason = (reason: string) => {
  if (
    !reason.trim() ||
    reason.length > 2000 ||
    /(?:password|access[_ -]?token|secret|api[_ -]?key)\s*[:=]\s*\S+/i.test(
      reason,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid reason is required.",
    );
  return reason.trim();
};

export async function createOffboardingCase(input: {
  tx: Transaction;
  userId: string;
  expectedUserVersion: number;
  terminationRequestId: string;
  reason: string;
  actorId: string;
  correlationId: string;
}) {
  const reason = safeReason(input.reason);
  if (
    !input.terminationRequestId.trim() ||
    input.terminationRequestId.length > 256
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "termination_request_id is required.",
    );
  const user = await input.tx.query(
    "SELECT employment_status,version FROM identity.users WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
    [input.tx.tenantId, input.userId],
  );
  if (!user.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "User was not found in this tenant.",
    );
  assertVersion(Number(user.rows[0]!.version), input.expectedUserVersion);
  const previous = String(user.rows[0]!.employment_status);
  if (!["ACTIVE", "SUSPENDED", "LEAVE"].includes(previous))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "User lifecycle cannot begin offboarding from this state.",
    );
  const existing = await input.tx.query(
    "SELECT id,state,version FROM identity.offboarding_cases WHERE tenant_id=$1 AND user_id=$2 AND state NOT IN ('COMPLETED','CANCELLED')",
    [input.tx.tenantId, input.userId],
  );
  if (existing.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "User already has an open offboarding case.",
    );
  const caseId = randomUUID();
  await input.tx.query(
    "INSERT INTO identity.offboarding_cases(id,tenant_id,user_id,state,pre_offboarding_user_state,termination_request_id,version) VALUES($1,$2,$3,'INITIATED',$4,$5,1)",
    [
      caseId,
      input.tx.tenantId,
      input.userId,
      previous,
      input.terminationRequestId.trim(),
    ],
  );
  await input.tx.query(
    "INSERT INTO identity.offboarding_case_history(id,tenant_id,offboarding_case_id,case_version,from_state,to_state,command_type,actor_id,reason,correlation_id) VALUES($1,$2,$3,1,NULL,'INITIATED','OFFBOARDING.CREATED',$4,$5,$6)",
    [
      randomUUID(),
      input.tx.tenantId,
      caseId,
      input.actorId,
      reason,
      input.correlationId,
    ],
  );
  return {
    id: caseId,
    user_id: input.userId,
    state: "INITIATED" as const,
    version: 1,
    user_version: input.expectedUserVersion,
    pre_offboarding_user_state: previous,
  };
}

export async function startExistingOffboarding(input: {
  tx: Transaction;
  caseId: string;
  expectedCaseVersion: number;
  expectedUserVersion: number;
  reason: string;
  actorId: string;
  correlationId: string;
}) {
  const reason = safeReason(input.reason);
  const caseResult = await input.tx.query(
    "SELECT user_id,state,pre_offboarding_user_state,version FROM identity.offboarding_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.caseId],
  );
  if (!caseResult.rowCount)
    throw new ApplicationError("NOT_FOUND", "Offboarding case was not found.");
  const c = caseResult.rows[0]!;
  assertVersion(Number(c.version), input.expectedCaseVersion);
  if (c.state !== "INITIATED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an initiated case can start.",
    );
  const user = await input.tx.query(
    "SELECT employment_status,version FROM identity.users WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
    [input.tx.tenantId, c.user_id],
  );
  if (!user.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "User was not found in this tenant.",
    );
  assertVersion(Number(user.rows[0]!.version), input.expectedUserVersion);
  if (
    String(user.rows[0]!.employment_status) !==
    String(c.pre_offboarding_user_state)
  )
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "User lifecycle changed since offboarding was initiated.",
    );
  const userChanged = await input.tx.query(
    "UPDATE identity.users SET employment_status='TERMINATING',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3 RETURNING id",
    [input.tx.tenantId, c.user_id, input.expectedUserVersion],
  );
  if (!userChanged.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "User lifecycle changed during offboarding start.",
    );
  const caseChanged = await input.tx.query(
    "UPDATE identity.offboarding_cases SET state='IN_PROGRESS',version=2,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='INITIATED' AND version=$3 RETURNING id",
    [input.tx.tenantId, input.caseId, input.expectedCaseVersion],
  );
  if (!caseChanged.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Offboarding case changed during start.",
    );
  await input.tx.query(
    "INSERT INTO identity.user_lifecycle_history(id,tenant_id,user_id,from_state,to_state,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,'TERMINATING',$5,$6,$7)",
    [
      randomUUID(),
      input.tx.tenantId,
      c.user_id,
      c.pre_offboarding_user_state,
      input.actorId,
      reason,
      input.correlationId,
    ],
  );
  await input.tx.query(
    "INSERT INTO identity.offboarding_case_history(id,tenant_id,offboarding_case_id,case_version,from_state,to_state,command_type,actor_id,reason,correlation_id) VALUES($1,$2,$3,2,'INITIATED','IN_PROGRESS','OFFBOARDING.START',$4,$5,$6)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.caseId,
      input.actorId,
      reason,
      input.correlationId,
    ],
  );
  const revoked = await input.tx.query(
    "UPDATE identity.sessions SET revoked_at=now(),version=version+1 WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id",
    [input.tx.tenantId, c.user_id],
  );
  await input.tx.query(
    "UPDATE identity.temporary_grants SET revoked_at=now(),version=version+1 WHERE tenant_id=$1 AND principal_id=$2 AND revoked_at IS NULL",
    [input.tx.tenantId, c.user_id],
  );
  await input.tx.query(
    "UPDATE identity.role_bindings SET revoked_at=now(),version=version+1 WHERE tenant_id=$1 AND principal_type='USER' AND principal_id=$2 AND revoked_at IS NULL",
    [input.tx.tenantId, c.user_id],
  );
  await input.tx.query(
    "INSERT INTO identity.offboarding_clearance_tasks(id,tenant_id,offboarding_case_id,clearance_type,state,detail) VALUES($1,$2,$3,'ACCESS','SUCCEEDED',$4)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.caseId,
      `Revoked ${revoked.rowCount ?? 0} active sessions and all temporary/role grants.`,
    ],
  );
  return {
    id: input.caseId,
    user_id: String(c.user_id),
    state: "IN_PROGRESS" as const,
    version: 2,
    user_version: input.expectedUserVersion + 1,
    pre_offboarding_user_state: String(c.pre_offboarding_user_state),
  };
}

export async function startOffboarding(input: {
  tx: Transaction;
  userId: string;
  expectedUserVersion: number;
  terminationRequestId: string;
  reason: string;
  actorId: string;
  correlationId: string;
}) {
  const created = await createOffboardingCase(input);
  return startExistingOffboarding({
    tx: input.tx,
    caseId: created.id,
    expectedCaseVersion: created.version,
    expectedUserVersion: input.expectedUserVersion,
    reason: input.reason,
    actorId: input.actorId,
    correlationId: input.correlationId,
  });
}

export type OffboardingCaseRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  state: OffboardingState;
  version: number;
  clearances: Array<{
    id: string;
    clearance_type: string;
    resource_id: string | null;
    state: string;
    detail: string;
    evidence_reference: string | null;
    asset_recovery_state?: string | null;
    version: number;
  }>;
  recovery_actions: Array<{
    id: string;
    source_action_id: string;
    action_type: string;
    disposition: string;
    evidence_reference: string | null;
    version: number;
  }>;
  [key: string]: unknown;
};
export async function readOffboardingCase(
  tx: Transaction,
  caseId: string,
): Promise<OffboardingCaseRecord> {
  const result = await tx.query(
    "SELECT * FROM identity.offboarding_cases WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, caseId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Offboarding case was not found.");
  const clearances = await tx.query(
    "SELECT id,clearance_type,resource_id,state,detail,evidence_reference,asset_recovery_state,version FROM identity.offboarding_clearance_tasks WHERE tenant_id=$1 AND offboarding_case_id=$2 ORDER BY clearance_type,resource_id",
    [tx.tenantId, caseId],
  );
  const recovery = await tx.query(
    "SELECT id,source_action_id,action_type,disposition,evidence_reference,version FROM identity.offboarding_recovery_actions WHERE tenant_id=$1 AND offboarding_case_id=$2 ORDER BY created_at",
    [tx.tenantId, caseId],
  );
  return {
    ...result.rows[0],
    clearances: clearances.rows,
    recovery_actions: recovery.rows,
  } as OffboardingCaseRecord;
}

export async function setOffboardingAssetRecoveryState(input: {
  tx: Transaction;
  caseId: string;
  assetId: string;
  expectedVersion: number;
  state: "PENDING_RETURN" | "RETURNED" | "UNRETURNED" | "MISSING";
  verifiedReturn?: boolean;
  actorId: string;
  reason: string;
  detail?: string;
  correlationId: string;
}) {
  const reason = safeReason(input.reason);
  const existing = await input.tx.query(
    "SELECT id,state,asset_recovery_state,version FROM identity.offboarding_clearance_tasks WHERE tenant_id=$1 AND offboarding_case_id=$2 AND clearance_type='ASSET_RETURN' AND resource_id=$3 FOR UPDATE",
    [input.tx.tenantId, input.caseId, input.assetId],
  );
  const actualVersion = existing.rowCount
    ? Number(existing.rows[0]!.version)
    : 0;
  assertVersion(actualVersion, input.expectedVersion);
  const prior = existing.rows[0]?.asset_recovery_state
    ? String(existing.rows[0].asset_recovery_state)
    : null;
  if (prior === input.state)
    return {
      clearance_id: String(existing.rows[0]!.id),
      asset_id: input.assetId,
      state: input.state,
      version: actualVersion,
      noOp: true,
    };
  if (
    (input.state === "UNRETURNED" || input.state === "MISSING") &&
    !["PENDING_RETURN", "UNRETURNED"].includes(prior ?? "")
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an unresolved pending return can be classified as unreturned or missing.",
    );
  if (input.state === "RETURNED") {
    if (!input.verifiedReturn)
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "Asset-domain return verification is required.",
      );
    if (![null, "PENDING_RETURN", "UNRETURNED", "MISSING"].includes(prior))
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Only an unresolved return recovery can be confirmed as returned.",
      );
  }
  const id = existing.rowCount ? String(existing.rows[0]!.id) : randomUUID();
  const version = actualVersion + 1;
  const clearanceState =
    input.state === "RETURNED"
      ? "SUCCEEDED"
      : input.state === "UNRETURNED" || input.state === "MISSING"
        ? "BLOCKED"
        : "PENDING";
  if (existing.rowCount) {
    await input.tx.query(
      "UPDATE identity.offboarding_clearance_tasks SET state=$1,detail=$2,asset_recovery_state=$3,version=$4,updated_at=now() WHERE tenant_id=$5 AND id=$6 AND version=$7",
      [
        clearanceState,
        input.detail ?? reason,
        input.state,
        version,
        input.tx.tenantId,
        id,
        actualVersion,
      ],
    );
  } else {
    await input.tx.query(
      "INSERT INTO identity.offboarding_clearance_tasks(id,tenant_id,offboarding_case_id,clearance_type,resource_id,state,detail,asset_recovery_state,version) VALUES($1,$2,$3,'ASSET_RETURN',$4,$5,$6,$7,$8)",
      [
        id,
        input.tx.tenantId,
        input.caseId,
        input.assetId,
        clearanceState,
        input.detail ?? reason,
        input.state,
        version,
      ],
    );
  }
  await input.tx.query(
    "INSERT INTO identity.offboarding_asset_recovery_history(id,tenant_id,clearance_id,asset_id,version,from_state,to_state,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      input.tx.tenantId,
      id,
      input.assetId,
      version,
      prior,
      input.state,
      input.actorId,
      reason,
      input.correlationId,
    ],
  );
  return {
    clearance_id: id,
    asset_id: input.assetId,
    from_state: prior,
    state: input.state,
    version,
    noOp: false,
  };
}

export async function recordOffboardingClearance(input: {
  tx: Transaction;
  caseId: string;
  type: "ASSET_RETURN" | "LICENSE";
  resourceId: string;
  state: "PENDING" | "SUCCEEDED" | "BLOCKED";
  detail: string;
}) {
  await input.tx.query(
    `INSERT INTO identity.offboarding_clearance_tasks(id,tenant_id,offboarding_case_id,clearance_type,resource_id,state,detail)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,offboarding_case_id,clearance_type,resource_id)
    DO UPDATE SET state=EXCLUDED.state,detail=EXCLUDED.detail,version=identity.offboarding_clearance_tasks.version+1,updated_at=now()`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.caseId,
      input.type,
      input.resourceId,
      input.state,
      input.detail,
    ],
  );
}

export async function beginOffboardingReconciliation(
  tx: Transaction,
  caseId: string,
) {
  const row = await tx.query(
    "SELECT state,reconciliation_lease_until FROM identity.offboarding_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, caseId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Offboarding case was not found.");
  if (!["IN_PROGRESS", "BLOCKED"].includes(String(row.rows[0]!.state)))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Case state does not allow clearance reconciliation.",
    );
  if (
    row.rows[0]!.reconciliation_lease_until &&
    new Date(row.rows[0]!.reconciliation_lease_until).getTime() > Date.now()
  )
    throw new ApplicationError(
      "OPERATION_IN_PROGRESS",
      "Another offboarding reconciliation is running.",
    );
  const token = randomUUID();
  await tx.query(
    "UPDATE identity.offboarding_cases SET reconciliation_token=$1,reconciliation_lease_until=now()+interval '5 minutes' WHERE tenant_id=$2 AND id=$3",
    [token, tx.tenantId, caseId],
  );
  return token;
}

export async function endOffboardingReconciliation(
  tx: Transaction,
  caseId: string,
  token: string,
) {
  await tx.query(
    "UPDATE identity.offboarding_cases SET reconciliation_token=NULL,reconciliation_lease_until=NULL WHERE tenant_id=$1 AND id=$2 AND reconciliation_token=$3",
    [tx.tenantId, caseId, token],
  );
}

export async function resolveOffboardingClearance(input: {
  tx: Transaction;
  caseId: string;
  clearanceId: string;
  expectedVersion: number;
  disposition: "WAIVED" | "ACCEPTED_EXCEPTION";
  evidenceReference: string;
  reason: string;
  actorId: string;
  authorized: boolean;
}) {
  const reason = safeReason(input.reason);
  if (!input.authorized)
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Offboarding exception permission is required.",
    );
  if (!input.evidenceReference.trim() || input.evidenceReference.length > 256)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Evidence reference is required.",
    );
  const result = await input.tx.query(
    "UPDATE identity.offboarding_clearance_tasks SET state=$1,detail=$2,evidence_reference=$3,authorized_by=$4,version=version+1,updated_at=now() WHERE tenant_id=$5 AND offboarding_case_id=$6 AND id=$7 AND version=$8 AND state IN ('PENDING','BLOCKED') RETURNING id,state,version",
    [
      input.disposition,
      reason,
      input.evidenceReference.trim(),
      input.actorId,
      input.tx.tenantId,
      input.caseId,
      input.clearanceId,
      input.expectedVersion,
    ],
  );
  if (!result.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Clearance changed or is no longer eligible for exception.",
    );
  const row = result.rows[0];
  if (!row)
    throw new ApplicationError("VERSION_CONFLICT", "Clearance changed.");
  return row;
}

export async function transitionOffboardingCase(input: {
  tx: Transaction;
  caseId: string;
  expectedVersion: number;
  command:
    | "BLOCK"
    | "RESUME"
    | "MARK_READY"
    | "COMPLETE"
    | "CANCEL"
    | "REQUEST_CANCEL"
    | "COMPLETE_CANCELLATION";
  reason: string;
  actorId: string;
  correlationId: string;
  withdrawalReference?: string;
  userExpectedVersion?: number;
  allowReconciliation?: boolean;
}) {
  const reason = safeReason(input.reason);
  const locked = await input.tx.query(
    "SELECT * FROM identity.offboarding_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.caseId],
  );
  if (!locked.rowCount)
    throw new ApplicationError("NOT_FOUND", "Offboarding case was not found.");
  const c = locked.rows[0]!;
  assertVersion(Number(c.version), input.expectedVersion);
  if (
    c.reconciliation_lease_until &&
    new Date(c.reconciliation_lease_until).getTime() > Date.now() &&
    !input.allowReconciliation
  )
    throw new ApplicationError(
      "OPERATION_IN_PROGRESS",
      "Offboarding clearance reconciliation must finish before this transition.",
    );
  const map: Record<string, OffboardingState> = {
    "IN_PROGRESS:BLOCK": "BLOCKED",
    "BLOCKED:RESUME": "IN_PROGRESS",
    "IN_PROGRESS:MARK_READY": "READY_TO_CLOSE",
    "READY_TO_CLOSE:COMPLETE": "COMPLETED",
    "INITIATED:CANCEL": "CANCELLED",
    "IN_PROGRESS:REQUEST_CANCEL": "CANCELLATION_PENDING",
    "BLOCKED:REQUEST_CANCEL": "CANCELLATION_PENDING",
    "READY_TO_CLOSE:REQUEST_CANCEL": "CANCELLATION_PENDING",
    "CANCELLATION_PENDING:COMPLETE_CANCELLATION": "CANCELLED",
  };
  const from = String(c.state);
  const next = map[`${from}:${input.command}`]!;
  if (!next)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Invalid offboarding case transition.",
    );
  if (input.command === "COMPLETE" || input.command === "MARK_READY") {
    const invalid = await input.tx.query(
      "SELECT 1 FROM identity.offboarding_clearance_tasks WHERE tenant_id=$1 AND offboarding_case_id=$2 AND state NOT IN ('SUCCEEDED','WAIVED','ACCEPTED_EXCEPTION') LIMIT 1",
      [input.tx.tenantId, input.caseId],
    );
    if (invalid.rowCount)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Required clearance remains unresolved.",
      );
  }
  if (input.command === "CANCEL") {
    const sideEffects = await input.tx.query(
      "SELECT (SELECT count(*) FROM identity.offboarding_clearance_tasks WHERE tenant_id=$1 AND offboarding_case_id=$2)+(SELECT count(*) FROM identity.offboarding_recovery_actions WHERE tenant_id=$1 AND offboarding_case_id=$2) AS count",
      [input.tx.tenantId, input.caseId],
    );
    if (Number(sideEffects.rows[0]!.count) > 0)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "An initiated case with side effects must use cancellation recovery.",
      );
  }
  if (
    input.command === "MARK_READY" &&
    (c.termination_request_withdrawn_at ||
      !String(c.termination_request_id ?? "").trim())
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "The termination request is withdrawn or unavailable.",
    );
  if (input.command === "COMPLETE") {
    if (
      c.termination_request_withdrawn_at ||
      !String(c.termination_request_id ?? "").trim()
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "The authoritative termination request is no longer valid.",
      );
    const access = await input.tx.query(
      `SELECT
        EXISTS(SELECT 1 FROM identity.sessions WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now()) AS session,
        EXISTS(SELECT 1 FROM identity.temporary_grants WHERE tenant_id=$1 AND principal_id=$2 AND revoked_at IS NULL AND valid_from<=now() AND valid_until>now()) AS temporary_grant,
        EXISTS(SELECT 1 FROM identity.role_bindings WHERE tenant_id=$1 AND principal_type='USER' AND principal_id=$2 AND revoked_at IS NULL AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now())) AS role_binding`,
      [input.tx.tenantId, c.user_id],
    );
    if (
      access.rows[0]?.session ||
      access.rows[0]?.temporary_grant ||
      access.rows[0]?.role_binding
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Active Identity access remains unresolved.",
      );
  }
  if (input.command === "COMPLETE_CANCELLATION") {
    if (!input.withdrawalReference?.trim())
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Authoritative termination withdrawal reference is required.",
      );
    if (
      String(c.termination_request_withdrawal_reference ?? "") !==
      input.withdrawalReference.trim()
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Termination request withdrawal must be validated when cancellation is requested.",
      );
    const pending = await input.tx.query(
      "SELECT 1 FROM identity.offboarding_recovery_actions WHERE tenant_id=$1 AND offboarding_case_id=$2 AND disposition='PENDING' LIMIT 1",
      [input.tx.tenantId, input.caseId],
    );
    if (pending.rowCount)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "Recovery actions remain unresolved.",
      );
    const user = await input.tx.query(
      "SELECT employment_status,version FROM identity.users WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [input.tx.tenantId, c.user_id],
    );
    if (user.rows[0]!.employment_status === "TERMINATED")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "A terminated user requires the separate rehire workflow.",
      );
    if (user.rows[0]!.employment_status === "TERMINATING") {
      if (input.userExpectedVersion === undefined)
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "user_expected_version is required.",
        );
      assertVersion(Number(user.rows[0]!.version), input.userExpectedVersion);
      const changed = await input.tx.query(
        "UPDATE identity.users SET employment_status=$1,version=version+1,updated_at=now() WHERE tenant_id=$2 AND id=$3 AND version=$4",
        [
          c.pre_offboarding_user_state,
          input.tx.tenantId,
          c.user_id,
          input.userExpectedVersion,
        ],
      );
      if (!changed.rowCount)
        throw new ApplicationError(
          "VERSION_CONFLICT",
          "User lifecycle changed.",
        );
      await input.tx.query(
        "INSERT INTO identity.user_lifecycle_history(id,tenant_id,user_id,from_state,to_state,actor_id,reason,correlation_id) VALUES($1,$2,$3,'TERMINATING',$4,$5,$6,$7)",
        [
          randomUUID(),
          input.tx.tenantId,
          c.user_id,
          c.pre_offboarding_user_state,
          input.actorId,
          reason,
          input.correlationId,
        ],
      );
    }
    await input.tx.query(
      "UPDATE identity.offboarding_cases SET termination_request_withdrawn_at=now(),termination_request_withdrawal_reference=$1 WHERE tenant_id=$2 AND id=$3",
      [input.withdrawalReference.trim(), input.tx.tenantId, input.caseId],
    );
  }
  if (input.command === "REQUEST_CANCEL") {
    const userState = await input.tx.query(
      "SELECT employment_status FROM identity.users WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [input.tx.tenantId, c.user_id],
    );
    if (userState.rows[0]?.employment_status === "TERMINATED")
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "A terminated user requires the separate rehire workflow.",
      );
    if (!input.withdrawalReference?.trim())
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Authoritative termination withdrawal reference is required before requesting cancellation.",
      );
    await input.tx.query(
      "UPDATE identity.offboarding_cases SET termination_request_withdrawn_at=now(),termination_request_withdrawal_reference=$1 WHERE tenant_id=$2 AND id=$3",
      [input.withdrawalReference.trim(), input.tx.tenantId, input.caseId],
    );
  }
  if (input.command === "COMPLETE") {
    const user = await input.tx.query(
      "SELECT employment_status,version FROM identity.users WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [input.tx.tenantId, c.user_id],
    );
    if (user.rows[0]!.employment_status !== "TERMINATED") {
      if (
        user.rows[0]!.employment_status !== "TERMINATING" ||
        input.userExpectedVersion === undefined
      )
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "User must be TERMINATING and user_expected_version is required.",
        );
      assertVersion(Number(user.rows[0]!.version), input.userExpectedVersion);
      await input.tx.query(
        "UPDATE identity.users SET employment_status='TERMINATED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$3",
        [input.tx.tenantId, c.user_id, input.userExpectedVersion],
      );
      await input.tx.query(
        "INSERT INTO identity.user_lifecycle_history(id,tenant_id,user_id,from_state,to_state,actor_id,reason,correlation_id) VALUES($1,$2,$3,'TERMINATING','TERMINATED',$4,$5,$6)",
        [
          randomUUID(),
          input.tx.tenantId,
          c.user_id,
          input.actorId,
          reason,
          input.correlationId,
        ],
      );
    }
  }
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE identity.offboarding_cases SET state=$1,version=$2,updated_at=now(),completed_at=CASE WHEN $1='COMPLETED' THEN now() ELSE completed_at END,cancelled_at=CASE WHEN $1='CANCELLED' THEN now() ELSE cancelled_at END,cancellation_requested_at=CASE WHEN $1='CANCELLATION_PENDING' THEN now() ELSE cancellation_requested_at END WHERE tenant_id=$3 AND id=$4 AND version=$5",
    [next, version, input.tx.tenantId, input.caseId, input.expectedVersion],
  );
  await input.tx.query(
    "INSERT INTO identity.offboarding_case_history(id,tenant_id,offboarding_case_id,case_version,from_state,to_state,command_type,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.caseId,
      version,
      from,
      next,
      `OFFBOARDING.${input.command}`,
      input.actorId,
      reason,
      input.correlationId,
    ],
  );
  return { id: input.caseId, from_state: from, state: next, version };
}

export async function addRecoveryAction(input: {
  tx: Transaction;
  caseId: string;
  sourceActionId: string;
  actionType: string;
  reason: string;
}) {
  const id = randomUUID();
  const row = await input.tx.query(
    "INSERT INTO identity.offboarding_recovery_actions(id,tenant_id,offboarding_case_id,source_action_id,action_type,disposition,reason) VALUES($1,$2,$3,$4,$5,'PENDING',$6) ON CONFLICT (tenant_id,offboarding_case_id,source_action_id,action_type) DO NOTHING RETURNING id",
    [
      id,
      input.tx.tenantId,
      input.caseId,
      input.sourceActionId,
      input.actionType,
      safeReason(input.reason),
    ],
  );
  if (row.rowCount)
    await input.tx.query(
      "INSERT INTO identity.offboarding_recovery_action_history(id,tenant_id,recovery_action_id,action_version,from_disposition,to_disposition,actor_id,reason) VALUES($1,$2,$3,1,NULL,'PENDING','system',$4)",
      [randomUUID(), input.tx.tenantId, id, safeReason(input.reason)],
    );
}

export async function resolveOffboardingRecoveryAction(input: {
  tx: Transaction;
  caseId: string;
  actionId: string;
  expectedVersion: number;
  disposition: "SUCCEEDED" | "WAIVED" | "ACCEPTED_EXCEPTION";
  evidenceReference: string;
  reason: string;
  actorId: string;
  authorized: boolean;
}) {
  const reason = safeReason(input.reason);
  if (!input.evidenceReference.trim() || input.evidenceReference.length > 256)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A bounded recovery evidence reference is required.",
    );
  if (input.disposition !== "SUCCEEDED" && !input.authorized)
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Policy exception permission is required.",
    );
  const current = await input.tx.query(
    "SELECT disposition,version FROM identity.offboarding_recovery_actions WHERE tenant_id=$1 AND offboarding_case_id=$2 AND id=$3 FOR UPDATE",
    [input.tx.tenantId, input.caseId, input.actionId],
  );
  if (!current.rowCount)
    throw new ApplicationError("NOT_FOUND", "Recovery action was not found.");
  assertVersion(Number(current.rows[0]!.version), input.expectedVersion);
  if (current.rows[0]!.disposition !== "PENDING")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Recovery action is already resolved.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE identity.offboarding_recovery_actions SET disposition=$1,evidence_reference=$2,authorized_by=$3,version=$4,completed_at=now() WHERE tenant_id=$5 AND id=$6",
    [
      input.disposition,
      input.evidenceReference.trim(),
      input.actorId,
      version,
      input.tx.tenantId,
      input.actionId,
    ],
  );
  await input.tx.query(
    "INSERT INTO identity.offboarding_recovery_action_history(id,tenant_id,recovery_action_id,action_version,from_disposition,to_disposition,actor_id,reason,evidence_reference) VALUES($1,$2,$3,$4,'PENDING',$5,$6,$7,$8)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.actionId,
      version,
      input.disposition,
      input.actorId,
      reason,
      input.evidenceReference.trim(),
    ],
  );
  return { id: input.actionId, disposition: input.disposition, version };
}
