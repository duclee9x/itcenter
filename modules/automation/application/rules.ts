import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
export async function registerRule(input: {
  tx: Transaction;
  code: string;
  ownerUserId: string;
  safetyLevel: string;
  requiresApproval: boolean;
  timeoutSeconds: number;
  maxAttempts: number;
  rollbackPlan?: string;
  actionSpec: unknown;
}) {
  if (
    !input.code.trim() ||
    !input.ownerUserId.trim() ||
    !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(input.safetyLevel) ||
    input.timeoutSeconds <= 0 ||
    input.maxAttempts < 1 ||
    input.maxAttempts > 10
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Invalid automation rule guardrails.",
    );
  if (input.safetyLevel === "HIGH" || input.safetyLevel === "CRITICAL")
    input.requiresApproval = true;
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO automation.rules(id,tenant_id,code,version,owner_user_id,safety_level,requires_approval,timeout_seconds,max_attempts,rollback_plan,action_spec) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)",
    [
      id,
      input.tx.tenantId,
      input.code,
      input.ownerUserId,
      input.safetyLevel,
      input.requiresApproval,
      input.timeoutSeconds,
      input.maxAttempts,
      input.rollbackPlan ?? null,
      JSON.stringify(input.actionSpec),
    ],
  );
  return {
    id,
    code: input.code,
    version: 1,
    enabled: false,
    requires_approval: input.requiresApproval,
  };
}
export async function setKillSwitch(input: {
  tx: Transaction;
  ruleId: string;
  enabled: boolean;
}) {
  const result = await input.tx.query(
    "UPDATE automation.rules SET kill_switched=$1,enabled=CASE WHEN $1 THEN false ELSE enabled END WHERE tenant_id=$2 AND id=$3 RETURNING id,kill_switched,enabled",
    [input.enabled, input.tx.tenantId, input.ruleId],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Automation rule was not found.");
  return result.rows[0]!;
}
