import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";

type VlanChangeState =
  | "PLANNED"
  | "IMPLEMENTING"
  | "VERIFYING"
  | "ROLLBACK_REQUIRED"
  | "ROLLED_BACK"
  | "FAILED"
  | "COMPLETED";

async function lockVlanChange(tx: Transaction, id: string) {
  const result = await tx.query(
    "SELECT id,change_id,target_device,target_port,previous_vlan,desired_vlan,reason,rollback_plan,state,version FROM network.vlan_changes WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "VLAN change was not found.");
  return result.rows[0]!;
}

async function recordEvidence(input: {
  tx: Transaction;
  id: string;
  actorId: string;
  phase: "IMPLEMENTATION" | "VERIFICATION" | "ROLLBACK";
  reason: string;
  evidence: unknown;
}) {
  await input.tx.query(
    "INSERT INTO network.vlan_change_evidence(id,tenant_id,vlan_change_id,phase,actor_id,reason,evidence) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [
      randomUUID(),
      input.tx.tenantId,
      input.id,
      input.phase,
      input.actorId,
      input.reason,
      JSON.stringify(input.evidence),
    ],
  );
}

async function transition(input: {
  tx: Transaction;
  id: string;
  row: Record<string, unknown>;
  expectedVersion: number;
  from: VlanChangeState[];
  to: VlanChangeState;
}) {
  assertVersion(Number(input.row.version), input.expectedVersion);
  if (!input.from.includes(String(input.row.state) as VlanChangeState))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "VLAN change is not in a state that allows this command.",
    );
  const version = input.expectedVersion + 1;
  await input.tx.query(
    "UPDATE network.vlan_changes SET state=$1,version=$2,updated_at=now() WHERE tenant_id=$3 AND id=$4",
    [input.to, version, input.tx.tenantId, input.id],
  );
  return {
    ...input.row,
    id: input.id,
    from_state: String(input.row.state),
    state: input.to,
    version,
  };
}

function requireText(value: string, field: string) {
  if (!value.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
}

function evidenceReference(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Evidence must be an opaque reference, not a raw payload.",
    );
  const input = value as Record<string, unknown>;
  const referenceId = input.reference_id;
  const checksum = input.sha256;
  if (
    typeof referenceId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(referenceId) ||
    Object.keys(input).some(
      (key) => !["reference_id", "sha256"].includes(key),
    ) ||
    (checksum !== undefined &&
      (typeof checksum !== "string" || !/^[a-f0-9]{64}$/i.test(checksum)))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Evidence requires a safe reference_id and optional SHA-256 checksum.",
    );
  return {
    reference_id: referenceId,
    ...(typeof checksum === "string" ? { sha256: checksum.toLowerCase() } : {}),
  };
}

export async function createVlanChange(input: {
  tx: Transaction;
  changeId: string;
  targetDevice: string;
  targetPort: string;
  previousVlan: string;
  desiredVlan: string;
  reason: string;
  rollbackPlan: string;
}) {
  for (const [value, field] of [
    [input.targetDevice, "target_device"],
    [input.targetPort, "target_port"],
    [input.previousVlan, "previous_vlan"],
    [input.desiredVlan, "desired_vlan"],
    [input.reason, "reason"],
    [input.rollbackPlan, "rollback_plan"],
  ])
    requireText(value ?? "", field ?? "value");
  if (input.previousVlan.trim() === input.desiredVlan.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "previous_vlan and desired_vlan must differ.",
    );
  const change = await input.tx.query(
    "SELECT id FROM problem.changes WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, input.changeId],
  );
  if (!change.rowCount)
    throw new ApplicationError("NOT_FOUND", "Change record was not found.");
  const id = randomUUID();
  await input.tx.query(
    "INSERT INTO network.vlan_changes(id,tenant_id,change_id,target_device,target_port,previous_vlan,desired_vlan,reason,rollback_plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      id,
      input.tx.tenantId,
      input.changeId,
      input.targetDevice.trim(),
      input.targetPort.trim(),
      input.previousVlan.trim(),
      input.desiredVlan.trim(),
      input.reason.trim(),
      input.rollbackPlan.trim(),
    ],
  );
  return {
    id,
    change_id: input.changeId,
    target_device: input.targetDevice.trim(),
    target_port: input.targetPort.trim(),
    previous_vlan: input.previousVlan.trim(),
    desired_vlan: input.desiredVlan.trim(),
    state: "PLANNED" as const,
    version: 1,
  };
}

export async function startVlanChange(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
}) {
  const row = await lockVlanChange(input.tx, input.id);
  const change = await input.tx.query(
    "SELECT state FROM problem.changes WHERE tenant_id=$1 AND id=$2",
    [input.tx.tenantId, row.change_id],
  );
  if (!change.rowCount)
    throw new ApplicationError("NOT_FOUND", "Change record was not found.");
  if (String(change.rows[0]!.state) !== "IMPLEMENTING")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "The linked Change must be in IMPLEMENTING state.",
    );
  const approval = await input.tx.query(
    "SELECT id FROM control.approval_requests WHERE tenant_id=$1 AND source_type='CHANGE' AND source_id=$2 AND state='APPROVED' LIMIT 1",
    [input.tx.tenantId, row.change_id],
  );
  if (!approval.rowCount)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "An approved Change request is required before implementation.",
    );
  return transition({
    tx: input.tx,
    id: input.id,
    row,
    expectedVersion: input.expectedVersion,
    from: ["PLANNED"],
    to: "IMPLEMENTING",
  });
}

export async function recordVlanImplementation(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  result: "APPLIED" | "FAILED";
  evidence: unknown;
}) {
  requireText(input.reason, "reason");
  if (!("APPLIED" === input.result || "FAILED" === input.result))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "result must be APPLIED or FAILED.",
    );
  const evidence = evidenceReference(input.evidence);
  const row = await lockVlanChange(input.tx, input.id);
  const value = await transition({
    tx: input.tx,
    id: input.id,
    row,
    expectedVersion: input.expectedVersion,
    from: ["IMPLEMENTING"],
    to: input.result === "APPLIED" ? "VERIFYING" : "ROLLBACK_REQUIRED",
  });
  await recordEvidence({
    tx: input.tx,
    id: input.id,
    actorId: input.actorId,
    phase: "IMPLEMENTATION",
    reason: input.reason,
    evidence: { result: input.result, ...evidence },
  });
  return value;
}

export async function verifyVlanChange(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  observedVlan: string;
  technicalPassed: boolean;
  servicePassed: boolean;
  monitoringPassed: boolean;
  evidence: unknown;
}) {
  requireText(input.reason, "reason");
  if (
    typeof input.technicalPassed !== "boolean" ||
    typeof input.servicePassed !== "boolean" ||
    typeof input.monitoringPassed !== "boolean"
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Technical, service and monitoring verification results are required.",
    );
  const row = await lockVlanChange(input.tx, input.id);
  const evidence = evidenceReference(input.evidence);
  const passed =
    input.observedVlan.trim() === String(row.desired_vlan) &&
    input.technicalPassed &&
    input.servicePassed &&
    input.monitoringPassed;
  const value = await transition({
    tx: input.tx,
    id: input.id,
    row,
    expectedVersion: input.expectedVersion,
    from: ["VERIFYING"],
    to: passed ? "COMPLETED" : "ROLLBACK_REQUIRED",
  });
  await recordEvidence({
    tx: input.tx,
    id: input.id,
    actorId: input.actorId,
    phase: "VERIFICATION",
    reason: input.reason,
    evidence: {
      observed_vlan: input.observedVlan,
      technical_passed: input.technicalPassed,
      service_passed: input.servicePassed,
      monitoring_passed: input.monitoringPassed,
      passed,
      ...evidence,
    },
  });
  return { ...value, verification_passed: passed };
}

export async function recordVlanRollback(input: {
  tx: Transaction;
  id: string;
  expectedVersion: number;
  actorId: string;
  reason: string;
  trigger: string;
  steps: unknown;
  restoredVlan: string;
  verificationPassed: boolean;
  evidence: unknown;
}) {
  requireText(input.reason, "reason");
  requireText(input.trigger, "trigger");
  if (!Array.isArray(input.steps) || input.steps.length === 0)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "rollback steps are required.",
    );
  const row = await lockVlanChange(input.tx, input.id);
  const evidence = evidenceReference(input.evidence);
  const passed =
    input.restoredVlan.trim() === String(row.previous_vlan) &&
    input.verificationPassed;
  const value = await transition({
    tx: input.tx,
    id: input.id,
    row,
    expectedVersion: input.expectedVersion,
    from: ["ROLLBACK_REQUIRED"],
    to: passed ? "ROLLED_BACK" : "FAILED",
  });
  await recordEvidence({
    tx: input.tx,
    id: input.id,
    actorId: input.actorId,
    phase: "ROLLBACK",
    reason: input.reason,
    evidence: {
      trigger: input.trigger,
      steps: input.steps,
      restored_vlan: input.restoredVlan,
      verification_passed: input.verificationPassed,
      rollback_succeeded: passed,
      ...evidence,
    },
  });
  return { ...value, rollback_succeeded: passed };
}
