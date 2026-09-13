import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { ACTION_CAPABILITY_CATALOG } from "../domain/capabilities.js";
import type { PolicyDecision } from "../domain/rules.js";

export interface ActionPolicyDraft {
  mode: PolicyDecision;
  resourceScope: Record<string, string>;
  parameterConstraints: Record<string, unknown>;
  approvalRequired: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
  reason: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function contentHash(input: ActionPolicyDraft): string {
  return createHash("sha256").update(stable(input)).digest("hex");
}

function validate(
  input: ActionPolicyDraft,
  actionType: string,
  targetType: string,
) {
  if (
    !ACTION_CAPABILITY_CATALOG.some(
      (entry) =>
        entry.action_type === actionType && entry.target_type === targetType,
    )
  )
    throw new ApplicationError(
      "AUTOMATION_ACTION_UNSUPPORTED",
      "Action policy must reference a registered action capability.",
    );
  if (
    !["DENY", "ALLOW", "REQUIRE_APPROVAL"].includes(input.mode) ||
    !input.reason.trim() ||
    input.reason.length > 2000 ||
    typeof input.approvalRequired !== "boolean"
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Action policy mode, approval flag and reason are required.",
    );
  if (
    Object.entries(input.resourceScope).some(
      ([key, value]) =>
        !["site", "location"].includes(key) ||
        typeof value !== "string" ||
        !value.trim(),
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Resource scope may contain only non-empty site/location selectors.",
    );
  const constraintKeys = Object.keys(input.parameterConstraints);
  if (constraintKeys.some((key) => !["equals", "required_keys"].includes(key)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported action parameter constraint.",
    );
  if (
    input.parameterConstraints.equals !== undefined &&
    (!input.parameterConstraints.equals ||
      typeof input.parameterConstraints.equals !== "object" ||
      Array.isArray(input.parameterConstraints.equals))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Parameter equality constraints must be an object.",
    );
  if (
    input.parameterConstraints.required_keys !== undefined &&
    (!Array.isArray(input.parameterConstraints.required_keys) ||
      input.parameterConstraints.required_keys.some(
        (key) => typeof key !== "string",
      ))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "required_keys must be an array of field names.",
    );
  const from = Date.parse(input.effectiveFrom);
  const to = input.effectiveTo ? Date.parse(input.effectiveTo) : null;
  if (
    !Number.isFinite(from) ||
    (to !== null && (!Number.isFinite(to) || to <= from))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Action policy effective interval is invalid.",
    );
}

async function lockPolicyKey(
  tx: Transaction,
  actionType: string,
  targetType: string,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${tx.tenantId}:AUTOMATION_ACTION_POLICY:${actionType}:${targetType}`,
  ]);
}

export async function createActionPolicyDraft(
  tx: Transaction,
  input: {
    actionType: string;
    targetType: string;
    actorId: string;
    draft: ActionPolicyDraft;
  },
) {
  validate(input.draft, input.actionType, input.targetType);
  await lockPolicyKey(tx, input.actionType, input.targetType);
  const existingDraft = await tx.query(
    `SELECT id FROM automation.action_policies
     WHERE tenant_id=$1 AND action_type=$2 AND target_type=$3 AND state='DRAFT'`,
    [tx.tenantId, input.actionType, input.targetType],
  );
  if (existingDraft.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "A draft version already exists for this action policy.",
    );
  const version = await tx.query<{ version: number | null }>(
    "SELECT max(version)::int AS version FROM automation.action_policies WHERE tenant_id=$1 AND action_type=$2 AND target_type=$3",
    [tx.tenantId, input.actionType, input.targetType],
  );
  const id = randomUUID();
  const nextVersion = (version.rows[0]?.version ?? 0) + 1;
  await tx.query(
    `INSERT INTO automation.action_policies(
       id,tenant_id,action_type,target_type,version,state,mode,resource_scope_json,
       parameter_constraints_json,approval_required,effective_from,effective_to,
       content_hash,created_by,changed_by,reason,entity_version
     ) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,1)`,
    [
      id,
      tx.tenantId,
      input.actionType,
      input.targetType,
      nextVersion,
      input.draft.mode,
      JSON.stringify(input.draft.resourceScope),
      JSON.stringify(input.draft.parameterConstraints),
      input.draft.approvalRequired,
      input.draft.effectiveFrom,
      input.draft.effectiveTo ?? null,
      contentHash(input.draft),
      input.actorId,
      input.draft.reason,
    ],
  );
  return {
    id,
    action_type: input.actionType,
    target_type: input.targetType,
    version: nextVersion,
    state: "DRAFT",
    mode: input.draft.mode,
    entity_version: 1,
  };
}

export async function updateActionPolicyDraft(
  tx: Transaction,
  input: {
    policyId: string;
    expectedVersion: number;
    actorId: string;
    draft: ActionPolicyDraft;
  },
) {
  const row = await tx.query<{
    action_type: string;
    target_type: string;
    state: string;
    entity_version: number;
  }>(
    "SELECT action_type,target_type,state,entity_version FROM automation.action_policies WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.policyId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Action policy was not found.");
  const current = row.rows[0]!;
  if (current.entity_version !== input.expectedVersion)
    throw new ApplicationError("VERSION_CONFLICT", "Action policy changed.");
  if (current.state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a DRAFT policy version can be edited.",
    );
  validate(input.draft, current.action_type, current.target_type);
  await tx.query(
    `UPDATE automation.action_policies SET mode=$1,resource_scope_json=$2,
       parameter_constraints_json=$3,approval_required=$4,effective_from=$5,
       effective_to=$6,content_hash=$7,changed_by=$8,reason=$9,
       entity_version=entity_version+1
     WHERE tenant_id=$10 AND id=$11`,
    [
      input.draft.mode,
      JSON.stringify(input.draft.resourceScope),
      JSON.stringify(input.draft.parameterConstraints),
      input.draft.approvalRequired,
      input.draft.effectiveFrom,
      input.draft.effectiveTo ?? null,
      contentHash(input.draft),
      input.actorId,
      input.draft.reason,
      tx.tenantId,
      input.policyId,
    ],
  );
  return {
    id: input.policyId,
    state: "DRAFT",
    mode: input.draft.mode,
    entity_version: input.expectedVersion + 1,
  };
}

export async function activateActionPolicy(
  tx: Transaction,
  input: {
    policyId: string;
    expectedVersion: number;
    actorId: string;
    reason: string;
  },
) {
  if (!input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Activation reason is required.",
    );
  const row = await tx.query<{
    action_type: string;
    target_type: string;
    state: string;
    entity_version: number;
    effective_from: Date;
  }>(
    "SELECT action_type,target_type,state,entity_version,effective_from FROM automation.action_policies WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.policyId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Action policy was not found.");
  const policy = row.rows[0]!;
  if (policy.entity_version !== input.expectedVersion)
    throw new ApplicationError("VERSION_CONFLICT", "Action policy changed.");
  if (policy.state !== "DRAFT")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only a DRAFT policy can be activated.",
    );
  await lockPolicyKey(tx, policy.action_type, policy.target_type);
  const active = await tx.query<{ id: string }>(
    `SELECT id FROM automation.action_policies
     WHERE tenant_id=$1 AND action_type=$2 AND target_type=$3 AND state='ACTIVE'
     FOR UPDATE`,
    [tx.tenantId, policy.action_type, policy.target_type],
  );
  if (active.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Deactivate the current policy version before activating its successor.",
    );
  const updated = await tx.query(
    `UPDATE automation.action_policies
     SET state='ACTIVE',activated_at=now(),entity_version=entity_version+1
     WHERE tenant_id=$1 AND id=$2 AND state='DRAFT' AND entity_version=$3
     RETURNING id,version,entity_version`,
    [tx.tenantId, input.policyId, input.expectedVersion],
  );
  if (!updated.rowCount)
    throw new ApplicationError("VERSION_CONFLICT", "Action policy changed.");
  return { ...updated.rows[0], state: "ACTIVE" };
}

export async function deactivateActionPolicy(
  tx: Transaction,
  input: {
    policyId: string;
    expectedVersion: number;
    actorId: string;
    reason: string;
  },
) {
  if (!input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Deactivation reason is required.",
    );
  const row = await tx.query<{ entity_version: number; state: string }>(
    "SELECT entity_version,state FROM automation.action_policies WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.policyId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Action policy was not found.");
  if (row.rows[0]!.entity_version !== input.expectedVersion)
    throw new ApplicationError("VERSION_CONFLICT", "Action policy changed.");
  if (row.rows[0]!.state !== "ACTIVE")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Only an ACTIVE policy can be deactivated.",
    );
  const result = await tx.query(
    `UPDATE automation.action_policies SET state='INACTIVE',deactivated_at=now(),
       deactivated_by=$1,deactivation_reason=$2,entity_version=entity_version+1
     WHERE tenant_id=$3 AND id=$4 AND entity_version=$5 RETURNING id,version,entity_version`,
    [
      input.actorId,
      input.reason.trim(),
      tx.tenantId,
      input.policyId,
      input.expectedVersion,
    ],
  );
  if (!result.rowCount)
    throw new ApplicationError("VERSION_CONFLICT", "Action policy changed.");
  return { ...result.rows[0], state: "INACTIVE" };
}
