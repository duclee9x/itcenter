import { randomUUID } from "node:crypto";
import {
  authorize,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import type { Transaction } from "../../../packages/persistence/src/index.js";

export const slaTargetPurposes = [
  "RESPONSE",
  "ACKNOWLEDGE",
  "RESOLUTION",
  "RESTORE",
  "OTHER",
  "UNKNOWN",
] as const;
export type SlaTargetPurpose = (typeof slaTargetPurposes)[number];
export type ClassifiableSlaTargetPurpose = Exclude<SlaTargetPurpose, "UNKNOWN">;

export function parseSlaTargetPurpose(value: unknown): SlaTargetPurpose {
  if (
    typeof value === "string" &&
    slaTargetPurposes.includes(value as SlaTargetPurpose)
  )
    return value as SlaTargetPurpose;
  throw new ApplicationError(
    "VALIDATION_ERROR",
    "target_purpose must be a canonical SLA target purpose.",
  );
}

/** Governance command: legacy UNKNOWN is classified once; explicit purpose requires a new policy version. */
export async function classifySlaTargetPurpose(input: {
  tx: Transaction;
  authorization: AuthorizationPort;
  principal: Principal;
  targetId: string;
  targetPurpose: ClassifiableSlaTargetPurpose;
  expectedVersion: number;
  reason: string;
  correlationId: string;
  idempotencyKey: string;
}) {
  if (
    !input.reason.trim() ||
    input.reason.length > 2000 ||
    !input.correlationId.trim() ||
    !input.idempotencyKey.trim()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A reason, correlation id and idempotency key are required.",
    );
  await authorize(input.authorization, {
    principal: input.principal,
    action: "sla.target_purpose.manage",
    resource: {
      type: "sla_target",
      id: input.targetId,
      tenant_id: input.tx.tenantId,
    },
    scope: { tenant: input.tx.tenantId },
    context: { correlation_id: input.correlationId },
  });

  const previousByKey = await input.tx.query<{
    id: string;
    sla_target_id: string;
    to_purpose: ClassifiableSlaTargetPurpose;
    actor_type: string;
    actor_id: string;
    reason: string;
    target_version: number;
  }>(
    `SELECT id,sla_target_id,to_purpose,actor_type,actor_id,reason,target_version
       FROM control.sla_target_purpose_changes WHERE tenant_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
    [input.tx.tenantId, input.principal.id, input.idempotencyKey],
  );
  if (previousByKey.rowCount) {
    const prior = previousByKey.rows[0]!;
    if (
      prior.sla_target_id !== input.targetId ||
      prior.to_purpose !== input.targetPurpose ||
      prior.target_version !== input.expectedVersion + 1 ||
      prior.actor_id !== input.principal.id ||
      prior.reason !== input.reason
    )
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "Idempotency key was used for a different SLA target-purpose classification.",
      );
    return {
      id: prior.id,
      target_id: input.targetId,
      from_purpose: "UNKNOWN" as const,
      target_purpose: prior.to_purpose,
      version: prior.target_version,
      created: false,
    };
  }

  const current = await input.tx.query<{
    id: string;
    target_purpose: SlaTargetPurpose;
    version: number;
  }>(
    "SELECT id,target_purpose,version FROM control.sla_targets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [input.tx.tenantId, input.targetId],
  );
  if (!current.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "SLA target was not found in this tenant.",
    );
  const target = current.rows[0]!;
  assertVersion(target.version, input.expectedVersion);
  if (target.target_purpose === input.targetPurpose)
    return {
      id: input.targetId,
      target_id: input.targetId,
      from_purpose: target.target_purpose,
      target_purpose: target.target_purpose,
      version: target.version,
      created: false,
    };
  if (target.target_purpose !== "UNKNOWN")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "An explicit SLA target purpose is immutable; create a new SLA policy version to change it.",
    );

  const id = randomUUID(),
    version = target.version + 1;
  await input.tx.query(
    `INSERT INTO control.sla_target_purpose_changes(
       id,tenant_id,sla_target_id,from_purpose,to_purpose,target_version,actor_type,actor_id,reason,correlation_id,idempotency_key)
     VALUES($1,$2,$3,'UNKNOWN',$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      input.tx.tenantId,
      input.targetId,
      input.targetPurpose,
      version,
      input.principal.actor_type,
      input.principal.id,
      input.reason,
      input.correlationId,
      input.idempotencyKey,
    ],
  );
  const updated = await input.tx.query(
    "UPDATE control.sla_targets SET target_purpose=$1,version=$2 WHERE tenant_id=$3 AND id=$4 AND version=$5",
    [
      input.targetPurpose,
      version,
      input.tx.tenantId,
      input.targetId,
      target.version,
    ],
  );
  if (!updated.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "SLA target changed during purpose classification.",
    );
  return {
    id,
    target_id: input.targetId,
    from_purpose: "UNKNOWN" as const,
    target_purpose: input.targetPurpose,
    version,
    created: true,
  };
}
