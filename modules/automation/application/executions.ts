import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { PostgresOutboxWriter } from "../../../packages/messaging/src/index.js";
import type { ActionDescriptor } from "../domain/rules.js";
import type { ExecutionSecurityPorts } from "./ports.js";

const VERIFY_MS = 5 * 60 * 1000;
const ACCEPTANCE_TIMEOUT_MS = 30 * 1000;
const EXECUTOR = "task091-agent-executor";

async function transition(input: {
  tx: Transaction;
  id: string;
  from: string[];
  to: string;
  event: string;
  actorType: string;
  actorId: string;
  correlationId: string;
  reason: string;
  evidence?: Record<string, unknown>;
  update?: Record<string, unknown>;
}) {
  const current = await input.tx.query<{
    entity_version: number;
    intent_id: string;
    target_agent_id: string;
    attempt_number: number;
  }>(
    "SELECT entity_version,intent_id,target_agent_id,attempt_number FROM automation.action_executions WHERE tenant_id=$1 AND id=$2 AND state=ANY($3::text[]) FOR UPDATE",
    [input.tx.tenantId, input.id, input.from],
  );
  if (!current.rowCount) return false;
  const allowed = new Set([
    "dispatched_at",
    "acceptance_deadline_at",
    "accepted_at",
    "verification_deadline",
    "completed_at",
    "reason_code",
    "preflight_evidence_json",
    "baseline_json",
    "result_evidence_json",
    "claimed_by",
    "lease_expires_at",
  ]);
  const sets = [
    "state=$1",
    "entity_version=entity_version+1",
    "updated_at=now()",
  ];
  const values: unknown[] = [input.to];
  for (const [key, value] of Object.entries(input.update ?? {})) {
    if (!allowed.has(key))
      throw new Error(`Unsupported execution update: ${key}`);
    values.push(value);
    sets.push(`${key}=$${values.length}`);
  }
  values.push(input.tx.tenantId, input.id);
  await input.tx.query(
    `UPDATE automation.action_executions SET ${sets.join(",")} WHERE tenant_id=$${values.length - 1} AND id=$${values.length}`,
    values,
  );
  const item = current.rows[0]!;
  const eventId = randomUUID();
  const payload = {
    execution_id: input.id,
    intent_id: item.intent_id,
    target_agent_id: item.target_agent_id,
    attempt_number: item.attempt_number,
    state: input.to,
    reason_code: input.reason,
    ...(input.evidence ?? {}),
  };
  await new PostgresOutboxWriter(input.tx).append({
    event_id: eventId,
    event_type: input.event,
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    producer: { service: "itcenter-automation", instance: EXECUTOR },
    aggregate: {
      type: "ACTION_EXECUTION",
      id: input.id,
      version: item.entity_version + 1,
    },
    actor: {
      type:
        input.actorType === "SYSTEM_AUTOMATION"
          ? "AUTOMATION"
          : input.actorType,
      id: input.actorId,
    },
    correlation_id: input.correlationId,
    causation_id: input.id,
    tenant_id: input.tx.tenantId,
    organization_id: input.tx.tenantId,
    idempotency_key: `${input.id}:${input.to}:${item.entity_version + 1}`,
    payload,
  });
  await input.tx.query(
    `INSERT INTO automation.action_execution_audit(id,tenant_id,execution_id,event_type,actor_type,actor_id,reason_code,evidence_json,correlation_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      input.tx.tenantId,
      input.id,
      input.event,
      input.actorType,
      input.actorId,
      input.reason,
      JSON.stringify(input.evidence ?? {}),
      input.correlationId,
    ],
  );
  return true;
}

export async function createAutomaticExecution(
  tx: Transaction,
  input: { intentId: string; sourceEventId: string },
) {
  const intent = await tx.query<{
    id: string;
    state: string;
    action_type: string;
    target_type: string;
    target_id: string;
    action_domain: string;
    normalized_parameters_json: Record<string, unknown>;
    correlation_id: string;
    source_event_id: string;
    decision_evidence_json: Record<string, unknown>;
    contributor: { rule_id: string; rule_version: number } | null;
  }>(
    `SELECT i.id,i.state,i.action_type,i.target_type,i.target_id,i.action_domain,
      i.normalized_parameters_json,i.correlation_id,i.source_event_id,i.decision_evidence_json,
      (SELECT jsonb_build_object('rule_id',c.rule_id,'rule_version',c.rule_version)
       FROM automation.action_intent_contributors c WHERE c.tenant_id=i.tenant_id AND c.action_intent_id=i.id
       ORDER BY c.created_at LIMIT 1) AS contributor
     FROM automation.action_intents i WHERE i.tenant_id=$1 AND i.id=$2 FOR SHARE`,
    [tx.tenantId, input.intentId],
  );
  const row = intent.rows[0];
  if (
    !row ||
    row.source_event_id !== input.sourceEventId ||
    row.state !== "READY"
  )
    return null;
  if (
    row.action_type !== "RESTART_AGENT" ||
    row.target_type !== "AGENT" ||
    row.action_domain !== "agent"
  )
    return null;
  const id = randomUUID();
  const commandId = randomUUID();
  const issuedAt = new Date().toISOString();
  const created = await tx.query<{ id: string }>(
    `INSERT INTO automation.action_executions(
      id,tenant_id,intent_id,attempt_number,attempt_kind,command_id,target_agent_id,action_type,state,
      command_snapshot_json,correlation_id,issued_at,created_by)
     VALUES($1,$2,$3,1,'AUTOMATIC',$4,$5,'RESTART_AGENT','PENDING',$6,$7,$8,$9)
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      id,
      tx.tenantId,
      row.id,
      commandId,
      row.target_id,
      JSON.stringify({
        execution_id: id,
        command_id: commandId,
        intent_id: row.id,
        tenant_id: tx.tenantId,
        target_agent_id: row.target_id,
        action_type: "RESTART_AGENT",
        parameters: {},
        correlation_id: row.correlation_id,
        issued_at: issuedAt,
      }),
      row.correlation_id,
      issuedAt,
      EXECUTOR,
    ],
  );
  if (!created.rowCount) {
    const existing = await tx.query<{ id: string }>(
      "SELECT id FROM automation.action_executions WHERE tenant_id=$1 AND intent_id=$2 AND attempt_kind='AUTOMATIC'",
      [tx.tenantId, row.id],
    );
    return existing.rows[0]?.id ?? null;
  }
  const rules = Array.isArray(row.decision_evidence_json.contributors)
    ? row.decision_evidence_json.contributors
    : [];
  await tx.query(
    `INSERT INTO automation.action_execution_audit(id,tenant_id,execution_id,event_type,actor_type,actor_id,reason_code,evidence_json,correlation_id)
     VALUES($1,$2,$3,'AUTOMATION.EXECUTION_CREATED','SYSTEM_AUTOMATION',$4,'READY_INTENT_ACCEPTED',$5,$6)`,
    [
      randomUUID(),
      tx.tenantId,
      id,
      String(
        row.decision_evidence_json.principal_id ?? "task090-system-automation",
      ),
      JSON.stringify({
        intent_id: row.id,
        source_event_id: row.source_event_id,
        rule: row.contributor,
        contributors: rules,
        action_type: row.action_type,
      }),
      row.correlation_id,
    ],
  );
  const eventId = randomUUID();
  await new PostgresOutboxWriter(tx).append({
    event_id: eventId,
    event_type: "AUTOMATION.EXECUTION_CREATED",
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    producer: { service: "itcenter-automation", instance: EXECUTOR },
    aggregate: { type: "ACTION_EXECUTION", id, version: 1 },
    actor: { type: "AUTOMATION", id: null },
    correlation_id: row.correlation_id,
    causation_id: input.sourceEventId,
    tenant_id: tx.tenantId,
    organization_id: tx.tenantId,
    idempotency_key: `execution-created:${id}`,
    payload: {
      execution_id: id,
      intent_id: row.id,
      target_agent_id: row.target_id,
      action_type: "RESTART_AGENT",
      state: "PENDING",
    },
  });
  return id;
}

export async function readDispatchedAgentCommand(
  tx: Transaction,
  input: { agentId: string; commandId: string; executionId: string },
) {
  const result = await tx.query<{
    command_snapshot_json: Record<string, unknown>;
    state: string;
  }>(
    "SELECT command_snapshot_json,state FROM automation.action_executions WHERE tenant_id=$1 AND target_agent_id=$2 AND command_id=$3 AND id=$4",
    [tx.tenantId, input.agentId, input.commandId, input.executionId],
  );
  const row = result.rows[0];
  return row ? { state: row.state, command: row.command_snapshot_json } : null;
}

export async function claimAgentRestart(
  tx: Transaction,
  agentId: string,
  agentBaseline: {
    tenant_id: string;
    agent_id: string;
    agent_runtime_id: string;
    agent_session_id: string | null;
    last_seen_at: Date | string;
  },
  security: ExecutionSecurityPorts,
): Promise<Record<string, unknown> | null> {
  const pending = await tx.query<{
    id: string;
    intent_id: string;
    command_id: string;
    target_agent_id: string;
    correlation_id: string;
    entity_version: number;
    command_snapshot_json: Record<string, unknown>;
    action_type: string;
  }>(
    `SELECT e.id,e.intent_id,e.command_id,e.target_agent_id,e.correlation_id,e.entity_version,e.command_snapshot_json,e.action_type
     FROM automation.action_executions e WHERE e.tenant_id=$1 AND e.target_agent_id=$2 AND e.state='PENDING'
     ORDER BY e.created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
    [tx.tenantId, agentId],
  );
  if (!pending.rowCount) return null;
  const e = pending.rows[0]!;
  await transition({
    tx,
    id: e.id,
    from: ["PENDING"],
    to: "CLAIMED",
    event: "AUTOMATION.EXECUTION_CLAIMED",
    actorType: "AGENT",
    actorId: agentId,
    correlationId: e.correlation_id,
    reason: "AUTHENTICATED_AGENT_CLAIM",
    evidence: { agent_id: agentId },
    update: { claimed_by: agentId },
  });
  const intent = await tx.query<{
    id: string;
    state: string;
    action_type: string;
    target_type: string;
    target_id: string;
    action_domain: string;
    normalized_parameters_json: Record<string, unknown>;
    decision_evidence_json: Record<string, unknown>;
    approval_id: string | null;
    approval_context_hash: string;
    approval_requirement: string;
    correlation_id: string;
    conflict_scope_key: string;
    policy_id: string | null;
    policy_version: number | null;
  }>(
    "SELECT * FROM automation.action_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, e.intent_id],
  );
  const i = intent.rows[0];
  const fail = async (
    reason: string,
    evidence: Record<string, unknown> = {},
  ) => {
    await transition({
      tx,
      id: e.id,
      from: ["CLAIMED"],
      to: "FAILED",
      event: "AUTOMATION.ACTION_FAILED",
      actorType: "SYSTEM_AUTOMATION",
      actorId: EXECUTOR,
      correlationId: e.correlation_id,
      reason,
      evidence,
      update: {
        completed_at: new Date().toISOString(),
        reason_code: reason,
        result_evidence_json: JSON.stringify(evidence),
      },
    });
    return null;
  };
  if (!i || i.state !== "READY") return fail("AUTOMATION_INTENT_NOT_READY");
  if (
    i.action_type !== "RESTART_AGENT" ||
    e.action_type !== "RESTART_AGENT" ||
    i.target_type !== "AGENT" ||
    i.target_id !== agentId
  )
    return fail("AUTOMATION_ACTION_UNSUPPORTED");
  const descriptor: ActionDescriptor = {
    target_type: i.target_type,
    target_id: i.target_id,
    action_domain: i.action_domain,
    action_type: i.action_type,
    parameters: i.normalized_parameters_json as ActionDescriptor["parameters"],
    exclusivity_group: String(
      (
        i.decision_evidence_json.capability as
          Record<string, unknown> | undefined
      )?.conflict_group ?? "AGENT_SERVICE_CONTROL",
    ),
  };
  const capability = await security.resolve({ action: descriptor });
  if (
    !capability ||
    !capability.automatic_execution_supported ||
    capability.action_type !== "RESTART_AGENT"
  )
    return fail("AUTOMATION_ACTION_UNSUPPORTED");
  const target = await security.resolveTarget({
    tenantId: tx.tenantId,
    targetType: i.target_type,
    targetId: i.target_id,
  });
  if (!target || target.targetId !== agentId)
    return fail("AUTOMATION_TARGET_SCOPE_DENIED");
  const safetyLevel = String(
    i.decision_evidence_json.safety_level ?? "HIGH_RISK",
  );
  const requiresApproval =
    i.approval_requirement === "REQUIRED" ||
    i.decision_evidence_json.requires_approval === true;
  const policy = await security.decide({
    tenantId: tx.tenantId,
    safetyLevel,
    requiresApproval,
    action: descriptor,
    capability,
    target,
    correlationId: i.correlation_id,
  });
  if (policy.decision === "DENY")
    return fail("AUTOMATION_POLICY_DENIED", {
      policy_id: policy.policyId,
      policy_version: policy.policyVersion,
      reason_code: policy.reasonCode,
    });
  const authorization = await security.authorize({
    tenantId: tx.tenantId,
    capability,
    target,
    correlationId: i.correlation_id,
  });
  if (!authorization.allowed)
    return fail("AUTOMATION_AUTHORIZATION_DENIED", {
      reason_code: authorization.reasonCode,
      permission: authorization.permission,
      scope: authorization.scopeReference,
    });
  if (policy.approvalRequired) {
    if (!i.approval_id) return fail("AUTOMATION_APPROVAL_STALE");
    const approval = await tx.query<{
      state: string;
      source_type: string;
      source_id: string;
      tenant_id: string;
      context: Record<string, unknown>;
    }>(
      "SELECT tenant_id,state,source_type,source_id,context FROM control.approval_requests WHERE tenant_id=$1 AND id=$2 FOR SHARE",
      [tx.tenantId, i.approval_id],
    );
    const a = approval.rows[0];
    if (
      !a ||
      a.state !== "APPROVED" ||
      a.source_type !== "AUTOMATION_ACTION_INTENT" ||
      a.source_id !== i.id ||
      a.tenant_id !== tx.tenantId ||
      a.context.context_hash !== i.approval_context_hash ||
      a.context.intent_id !== i.id ||
      i.policy_id !== policy.policyId ||
      i.policy_version !== policy.policyVersion
    )
      return fail("AUTOMATION_APPROVAL_STALE");
  }
  const conflicts = await tx.query(
    "SELECT 1 FROM automation.intent_conflicts c JOIN automation.intent_conflict_members m ON m.tenant_id=c.tenant_id AND m.conflict_id=c.id WHERE c.tenant_id=$1 AND c.state='OPEN' AND m.action_intent_id=$2",
    [tx.tenantId, i.id],
  );
  if (conflicts.rowCount) return fail("AUTOMATION_CONFLICT_OPEN");
  const ruleIds = await tx.query<{ rule_id: string }>(
    "SELECT DISTINCT rule_id FROM automation.action_intent_contributors WHERE tenant_id=$1 AND action_intent_id=$2",
    [tx.tenantId, i.id],
  );
  const kill = await tx.query(
    "SELECT 1 FROM automation.kill_switches WHERE tenant_id=$1 AND enabled=true AND ((scope_type='GLOBAL' AND scope_key='*') OR (scope_type='CATEGORY' AND scope_key IN ($2,$3)) OR (scope_type='RULE' AND scope_key=ANY($4::text[])))",
    [
      tx.tenantId,
      i.action_domain,
      i.action_type,
      ruleIds.rows.map((r) => r.rule_id),
    ],
  );
  if (kill.rowCount) return fail("AUTOMATION_KILL_SWITCH_ACTIVE");
  if (
    agentBaseline.agent_id !== agentId ||
    agentBaseline.tenant_id !== tx.tenantId
  )
    return fail("AUTOMATION_TARGET_SCOPE_DENIED", {
      reason_code: "AGENT_TENANT_IDENTITY_MISMATCH",
    });
  const baseline = {
    agent_id: agentId,
    tenant_id: tx.tenantId,
    session_id: agentBaseline.agent_session_id,
    agent_runtime_id: agentBaseline.agent_runtime_id,
    last_heartbeat_at: agentBaseline.last_seen_at,
    target_version: e.entity_version,
    policy_id: policy.policyId,
    policy_version: policy.policyVersion,
    principal_id: authorization.principalId,
    permission: authorization.permission,
    scope: authorization.scopeReference,
    policy_decision: policy.decision,
    authorization_decision: "ALLOW",
    approval_required: policy.approvalRequired,
    kill_switch: "ALLOW",
    conflict: "CLEAR",
  };
  const now = new Date().toISOString();
  const command = e.command_snapshot_json;
  await transition({
    tx,
    id: e.id,
    from: ["CLAIMED"],
    to: "DISPATCHED",
    event: "AUTOMATION.ACTION_DISPATCHED",
    actorType: "SYSTEM_AUTOMATION",
    actorId: EXECUTOR,
    correlationId: e.correlation_id,
    reason: "AGENT_COMMAND_DISPATCHED",
    evidence: {
      command_id: e.command_id,
      agent_id: agentId,
      policy_version: policy.policyVersion,
      authorization: authorization.reasonCode,
    },
    update: {
      dispatched_at: now,
      acceptance_deadline_at: new Date(
        new Date(now).getTime() + ACCEPTANCE_TIMEOUT_MS,
      ).toISOString(),
      baseline_json: JSON.stringify(baseline),
      preflight_evidence_json: JSON.stringify({
        capability_id: capability.id,
        policy_id: policy.policyId,
        policy_version: policy.policyVersion,
        policy_decision: policy.decision,
        principal_id: authorization.principalId,
        permission: authorization.permission,
        scope: authorization.scopeReference,
        approval_required: policy.approvalRequired,
        kill_switch: "ALLOW",
        conflict: "CLEAR",
      }),
    },
  });
  return command;
}

async function recordExecutionReconciliationEvidence(
  tx: Transaction,
  input: {
    executionId: string;
    evidenceType: "LATE_AGENT_ACCEPTED" | "LATE_RESTART_RUNTIME";
    evidenceKey: string;
    sourceEventId: string;
    actorId: string;
    correlationId: string;
    evidence: Record<string, unknown>;
  },
) {
  const execution = await tx.query<{
    intent_id: string;
    target_agent_id: string;
    command_id: string;
    state: string;
    reason_code: string | null;
    entity_version: number;
  }>(
    "SELECT intent_id,target_agent_id,command_id,state,reason_code,entity_version FROM automation.action_executions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.executionId],
  );
  const row = execution.rows[0];
  if (!row || row.state !== "UNKNOWN") return false;
  const evidence = {
    ...input.evidence,
    execution_id: input.executionId,
    intent_id: row.intent_id,
    agent_id: row.target_agent_id,
    command_id: row.command_id,
    execution_state: "UNKNOWN",
  };
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO automation.action_execution_reconciliation_evidence(
       id,tenant_id,execution_id,evidence_type,evidence_key,source_event_id,evidence_json,correlation_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      randomUUID(),
      tx.tenantId,
      input.executionId,
      input.evidenceType,
      input.evidenceKey,
      input.sourceEventId,
      JSON.stringify(evidence),
      input.correlationId,
    ],
  );
  if (!inserted.rowCount) return false;
  const eventId = randomUUID();
  await new PostgresOutboxWriter(tx).append({
    event_id: eventId,
    event_type: "AUTOMATION.ACTION_RECONCILIATION_EVIDENCE_RECORDED",
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    producer: { service: "itcenter-automation", instance: EXECUTOR },
    aggregate: {
      type: "ACTION_EXECUTION",
      id: input.executionId,
      version: row.entity_version,
    },
    actor: { type: "AGENT", id: input.actorId },
    correlation_id: input.correlationId,
    causation_id: input.sourceEventId,
    tenant_id: tx.tenantId,
    organization_id: tx.tenantId,
    idempotency_key: `execution-reconciliation:${input.executionId}:${input.evidenceType}:${input.evidenceKey}`,
    payload: {
      execution_id: input.executionId,
      intent_id: row.intent_id,
      target_agent_id: row.target_agent_id,
      command_id: row.command_id,
      evidence_type: input.evidenceType,
      evidence,
      reason_code: "LATE_EVIDENCE_AFTER_UNKNOWN",
      state: "UNKNOWN",
    },
  });
  await tx.query(
    `INSERT INTO automation.action_execution_audit(
       id,tenant_id,execution_id,event_type,actor_type,actor_id,reason_code,evidence_json,correlation_id
     ) VALUES($1,$2,$3,'AUTOMATION.ACTION_RECONCILIATION_EVIDENCE_RECORDED','AGENT',$4,'LATE_EVIDENCE_AFTER_UNKNOWN',$5,$6)`,
    [
      randomUUID(),
      tx.tenantId,
      input.executionId,
      input.actorId,
      JSON.stringify(evidence),
      input.correlationId,
    ],
  );
  return true;
}

export async function recordExecutionAcceptance(
  tx: Transaction,
  input: {
    commandId: string;
    agentId: string;
    acceptedAt: string;
    sourceEventId: string;
    correlationId: string;
  },
) {
  const result = await tx.query<{
    id: string;
    intent_id: string;
    target_agent_id: string;
    state: string;
    baseline_json: Record<string, unknown>;
    verification_deadline: Date | null;
    dispatched_at: Date | null;
    acceptance_deadline_at: Date | null;
    correlation_id: string;
    reason_code: string | null;
    entity_version: number;
  }>(
    "SELECT id,intent_id,target_agent_id,state,baseline_json,verification_deadline,dispatched_at,acceptance_deadline_at,correlation_id,reason_code,entity_version FROM automation.action_executions WHERE tenant_id=$1 AND command_id=$2 FOR UPDATE",
    [tx.tenantId, input.commandId],
  );
  const e = result.rows[0];
  if (!e || e.target_agent_id !== input.agentId) return false;
  if (e.state === "UNKNOWN") {
    await recordExecutionReconciliationEvidence(tx, {
      executionId: e.id,
      evidenceType: "LATE_AGENT_ACCEPTED",
      evidenceKey: input.sourceEventId,
      sourceEventId: input.sourceEventId,
      actorId: input.agentId,
      correlationId: input.correlationId,
      evidence: {
        command_id: input.commandId,
        agent_id: input.agentId,
        accepted_at: input.acceptedAt,
        accepted_after_unknown: true,
        previous_reason_code: e.reason_code,
      },
    });
    return false;
  }
  if (e.state !== "DISPATCHED")
    return ["ACCEPTED", "VERIFYING", "SUCCEEDED"].includes(e.state);
  const acceptedAt = new Date(input.acceptedAt).getTime();
  const dispatchedAt = e.dispatched_at
    ? new Date(e.dispatched_at).getTime()
    : Number.POSITIVE_INFINITY;
  const acceptanceDeadline = e.acceptance_deadline_at
    ? new Date(e.acceptance_deadline_at).getTime()
    : Number.NEGATIVE_INFINITY;
  if (acceptedAt < dispatchedAt || acceptedAt >= acceptanceDeadline) {
    const reason =
      acceptedAt < dispatchedAt
        ? "AGENT_DELIVERY_AMBIGUOUS"
        : "AGENT_ACCEPTANCE_TIMEOUT";
    await transition({
      tx,
      id: e.id,
      from: ["DISPATCHED"],
      to: "UNKNOWN",
      event: "AUTOMATION.ACTION_UNKNOWN",
      actorType: "SERVICE_ACCOUNT",
      actorId: EXECUTOR,
      correlationId: e.correlation_id,
      reason,
      evidence: {
        command_id: input.commandId,
        agent_id: input.agentId,
        dispatched_at: e.dispatched_at,
        acceptance_deadline_at: e.acceptance_deadline_at,
        accepted_at: input.acceptedAt,
        late_acceptance: acceptedAt >= acceptanceDeadline,
        acceptance_timestamp_invalid: acceptedAt < dispatchedAt,
      },
      update: {
        completed_at: new Date().toISOString(),
        reason_code: reason,
        result_evidence_json: JSON.stringify({
          outcome: "UNKNOWN",
          reason_code: reason,
          accepted_at: input.acceptedAt,
        }),
      },
    });
    await recordExecutionReconciliationEvidence(tx, {
      executionId: e.id,
      evidenceType: "LATE_AGENT_ACCEPTED",
      evidenceKey: input.sourceEventId,
      sourceEventId: input.sourceEventId,
      actorId: input.agentId,
      correlationId: input.correlationId,
      evidence: {
        command_id: input.commandId,
        agent_id: input.agentId,
        accepted_at: input.acceptedAt,
        acceptance_deadline_at: e.acceptance_deadline_at,
      },
    });
    return false;
  }
  if (e.state === "DISPATCHED") {
    const deadline = new Date(
      new Date(input.acceptedAt).getTime() + VERIFY_MS,
    ).toISOString();
    await transition({
      tx,
      id: e.id,
      from: ["DISPATCHED"],
      to: "ACCEPTED",
      event: "AUTOMATION.ACTION_ACCEPTED",
      actorType: "AGENT",
      actorId: input.agentId,
      correlationId: e.correlation_id,
      reason: "AGENT_COMMAND_ACCEPTED",
      evidence: { command_id: input.commandId, accepted_at: input.acceptedAt },
      update: {
        accepted_at: input.acceptedAt,
        verification_deadline: deadline,
      },
    });
    await transition({
      tx,
      id: e.id,
      from: ["ACCEPTED"],
      to: "VERIFYING",
      event: "AUTOMATION.ACTION_VERIFYING",
      actorType: "AGENT",
      actorId: input.agentId,
      correlationId: e.correlation_id,
      reason: "RESTART_VERIFICATION_STARTED",
      evidence: { verification_deadline: deadline },
      update: {},
    });
  }
  return true;
}

export async function recordExecutionRejection(
  tx: Transaction,
  input: { commandId: string; agentId: string; reason: string },
) {
  const row = await tx.query<{
    id: string;
    target_agent_id: string;
    state: string;
    correlation_id: string;
  }>(
    "SELECT id,target_agent_id,state,correlation_id FROM automation.action_executions WHERE tenant_id=$1 AND command_id=$2 FOR UPDATE",
    [tx.tenantId, input.commandId],
  );
  const e = row.rows[0];
  if (!e || e.target_agent_id !== input.agentId || e.state !== "DISPATCHED")
    return false;
  return transition({
    tx,
    id: e.id,
    from: ["DISPATCHED"],
    to: "FAILED",
    event: "AUTOMATION.ACTION_FAILED",
    actorType: "AGENT",
    actorId: input.agentId,
    correlationId: e.correlation_id,
    reason: "AGENT_COMMAND_REJECTED",
    evidence: { reason: input.reason },
    update: {
      completed_at: new Date().toISOString(),
      reason_code: "AGENT_COMMAND_REJECTED",
      result_evidence_json: JSON.stringify({ reason: input.reason }),
    },
  });
}

export async function observeAgentRuntime(
  tx: Transaction,
  input: {
    agentId: string;
    runtimeId: string;
    sessionId: string | null;
    observedAt: string;
    sourceEventId: string;
  },
) {
  const rows = await tx.query<{
    id: string;
    state: string;
    baseline_json: Record<string, unknown>;
    accepted_at: Date;
    verification_deadline: Date | null;
    dispatched_at: Date | null;
    correlation_id: string;
  }>(
    "SELECT id,state,baseline_json,accepted_at,verification_deadline,dispatched_at,correlation_id FROM automation.action_executions WHERE tenant_id=$1 AND target_agent_id=$2 AND state IN ('ACCEPTED','VERIFYING','UNKNOWN') FOR UPDATE",
    [tx.tenantId, input.agentId],
  );
  for (const e of rows.rows) {
    if (e.state === "UNKNOWN") {
      if (
        input.runtimeId !== e.baseline_json.agent_runtime_id &&
        e.dispatched_at &&
        new Date(input.observedAt).getTime() >=
          new Date(e.dispatched_at).getTime()
      ) {
        await recordExecutionReconciliationEvidence(tx, {
          executionId: e.id,
          evidenceType: "LATE_RESTART_RUNTIME",
          evidenceKey: input.runtimeId,
          sourceEventId: input.sourceEventId,
          actorId: input.agentId,
          correlationId: e.correlation_id,
          evidence: {
            agent_id: input.agentId,
            command_id: null,
            agent_runtime_id: input.runtimeId,
            agent_session_id: input.sessionId,
            observed_at: input.observedAt,
            baseline_runtime_id: e.baseline_json.agent_runtime_id,
            post_unknown: true,
          },
        });
      }
      continue;
    }
    if (
      new Date(input.observedAt).getTime() <
        new Date(e.accepted_at).getTime() ||
      input.runtimeId === e.baseline_json.agent_runtime_id ||
      (e.verification_deadline &&
        new Date(input.observedAt) > new Date(e.verification_deadline))
    )
      continue;
    await transition({
      tx,
      id: e.id,
      from: ["ACCEPTED", "VERIFYING"],
      to: "SUCCEEDED",
      event: "AUTOMATION.ACTION_SUCCEEDED",
      actorType: "AGENT",
      actorId: input.agentId,
      correlationId: e.correlation_id,
      reason: "POST_RESTART_RUNTIME_VERIFIED",
      evidence: {
        agent_runtime_id: input.runtimeId,
        observed_at: input.observedAt,
      },
      update: {
        completed_at: new Date().toISOString(),
        result_evidence_json: JSON.stringify({
          agent_runtime_id: input.runtimeId,
          observed_at: input.observedAt,
        }),
      },
    });
  }
}

export async function markExpiredExecutionsUnknown(
  tx: Transaction,
  now = new Date(),
) {
  const rows = await tx.query<{
    id: string;
    state: string;
    correlation_id: string;
    command_id: string;
    intent_id: string;
    target_agent_id: string;
    dispatched_at: Date;
    acceptance_deadline_at: Date;
    verification_deadline: Date | null;
  }>(
    "SELECT id,state,correlation_id,command_id,intent_id,target_agent_id,dispatched_at,acceptance_deadline_at,verification_deadline FROM automation.action_executions WHERE tenant_id=$1 AND ((state='DISPATCHED' AND acceptance_deadline_at<=$2) OR (state IN ('ACCEPTED','VERIFYING') AND verification_deadline<=$2)) FOR UPDATE SKIP LOCKED LIMIT 50",
    [tx.tenantId, now.toISOString()],
  );
  for (const e of rows.rows) {
    const acceptanceTimeout = e.state === "DISPATCHED";
    const reason = acceptanceTimeout
      ? "AGENT_ACCEPTANCE_TIMEOUT"
      : "RESTART_VERIFICATION_TIMEOUT";
    await transition({
      tx,
      id: e.id,
      from: acceptanceTimeout ? ["DISPATCHED"] : ["ACCEPTED", "VERIFYING"],
      to: "UNKNOWN",
      event: "AUTOMATION.ACTION_UNKNOWN",
      actorType: "SERVICE_ACCOUNT",
      actorId: EXECUTOR,
      correlationId: e.correlation_id,
      reason,
      evidence: {
        command_id: e.command_id,
        intent_id: e.intent_id,
        agent_id: e.target_agent_id,
        dispatched_at: e.dispatched_at,
        acceptance_deadline_at: e.acceptance_deadline_at,
        verification_deadline_at: e.verification_deadline,
        reconciliation_guidance:
          "Confirm the Agent runtime and command outcome before any manual retry.",
      },
      update: {
        completed_at: now.toISOString(),
        reason_code: reason,
        result_evidence_json: JSON.stringify({
          outcome: "UNKNOWN",
          reason_code: reason,
        }),
      },
    });
  }
  return rows.rowCount ?? 0;
}

export type ActionExecutionReadModel = Record<string, unknown> & {
  id: string;
  intent_id: string;
  target_type: string;
  target_id: string;
  state: string;
  entity_version: number;
};
export async function readActionExecution(
  tx: Transaction,
  id: string,
): Promise<ActionExecutionReadModel> {
  const result = await tx.query<ActionExecutionReadModel>(
    "SELECT e.*,i.target_type,i.target_id,i.action_type,i.source_event_id,i.decision_evidence_json FROM automation.action_executions e JOIN automation.action_intents i ON i.tenant_id=e.tenant_id AND i.id=e.intent_id WHERE e.tenant_id=$1 AND e.id=$2",
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Action execution was not found.");
  return result.rows[0]!;
}

export async function cancelActionExecution(
  tx: Transaction,
  input: {
    id: string;
    expectedVersion: number;
    actorId: string;
    reason: string;
    correlationId: string;
  },
) {
  const row = await tx.query<{
    state: string;
    entity_version: number;
    correlation_id: string;
    accepted_at: Date | null;
  }>(
    "SELECT state,entity_version,correlation_id,accepted_at FROM automation.action_executions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.id],
  );
  const e = row.rows[0];
  if (!e)
    throw new ApplicationError("NOT_FOUND", "Action execution was not found.");
  if (e.entity_version !== input.expectedVersion)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Action execution version changed.",
    );
  if (e.state !== "PENDING" && e.state !== "CLAIMED")
    throw new ApplicationError(
      "AUTOMATION_ACTION_CANCEL_FORBIDDEN",
      "Cancellation requires proof that the Agent has not accepted the command.",
    );
  await transition({
    tx,
    id: input.id,
    from: ["PENDING", "CLAIMED"],
    to: "CANCELLED",
    event: "AUTOMATION.ACTION_CANCELLED",
    actorType: "USER",
    actorId: input.actorId,
    correlationId: input.correlationId,
    reason: "OPERATOR_CANCELLED_BEFORE_DISPATCH",
    evidence: { reason: input.reason },
    update: {
      completed_at: new Date().toISOString(),
      reason_code: "OPERATOR_CANCELLED_BEFORE_DISPATCH",
    },
  });
  return readActionExecution(tx, input.id);
}

export async function retryActionExecution(
  tx: Transaction,
  input: {
    id: string;
    expectedVersion: number;
    actorId: string;
    reason: string;
    reconciliationEvidence: string;
    idempotencyKey: string;
  },
) {
  const prior = await tx.query<{
    intent_id: string;
    state: string;
    entity_version: number;
    attempt_number: number;
    correlation_id: string;
    target_agent_id: string;
    command_snapshot_json: Record<string, unknown>;
  }>(
    "SELECT intent_id,state,entity_version,attempt_number,correlation_id,target_agent_id,command_snapshot_json FROM automation.action_executions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.id],
  );
  const p = prior.rows[0];
  if (!p)
    throw new ApplicationError("NOT_FOUND", "Action execution was not found.");
  if (p.entity_version !== input.expectedVersion)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Action execution version changed.",
    );
  if (
    !["FAILED", "UNKNOWN"].includes(p.state) ||
    input.reconciliationEvidence.trim().length < 10
  )
    throw new ApplicationError(
      "AUTOMATION_RECONCILIATION_REQUIRED",
      "Retry requires explicit reconciliation after a terminal failure or unknown result.",
    );
  const intent = await tx.query<{ state: string }>(
    "SELECT state FROM automation.action_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, p.intent_id],
  );
  if (intent.rows[0]?.state !== "READY")
    throw new ApplicationError(
      "AUTOMATION_INTENT_NOT_READY",
      "Action Intent is not currently READY.",
    );
  const attempts = await tx.query<{ max_attempt: number }>(
    "SELECT COALESCE(max(attempt_number),0)::int AS max_attempt FROM automation.action_executions WHERE tenant_id=$1 AND intent_id=$2",
    [tx.tenantId, p.intent_id],
  );
  if (Number(attempts.rows[0]?.max_attempt) !== p.attempt_number)
    throw new ApplicationError(
      "AUTOMATION_RECONCILIATION_REQUIRED",
      "A newer execution attempt exists and must be reconciled first.",
    );
  const id = randomUUID(),
    commandId = randomUUID();
  const issuedAt = new Date().toISOString();
  const snapshot = {
    ...p.command_snapshot_json,
    execution_id: id,
    command_id: commandId,
    issued_at: issuedAt,
  };
  await tx.query(
    "INSERT INTO automation.action_executions(id,tenant_id,intent_id,attempt_number,attempt_kind,previous_execution_id,command_id,target_agent_id,action_type,state,idempotency_key,command_snapshot_json,correlation_id,issued_at,created_by) VALUES($1,$2,$3,$4,'MANUAL',$5,$6,$7,'RESTART_AGENT','PENDING',$8,$9,$10,$11,$12)",
    [
      id,
      tx.tenantId,
      p.intent_id,
      Number(attempts.rows[0]!.max_attempt) + 1,
      input.id,
      commandId,
      p.target_agent_id,
      input.idempotencyKey,
      JSON.stringify(snapshot),
      p.correlation_id,
      issuedAt,
      input.actorId,
    ],
  );
  await tx.query(
    "INSERT INTO automation.action_execution_audit(id,tenant_id,execution_id,event_type,actor_type,actor_id,reason_code,evidence_json,correlation_id) VALUES($1,$2,$3,'AUTOMATION.EXECUTION_CREATED','USER',$4,'MANUAL_RECONCILED_RETRY',$5,$6)",
    [
      randomUUID(),
      tx.tenantId,
      id,
      input.actorId,
      JSON.stringify({
        previous_execution_id: input.id,
        reason: input.reason,
        reconciliation_evidence: input.reconciliationEvidence,
      }),
      p.correlation_id,
    ],
  );
  await new PostgresOutboxWriter(tx).append({
    event_id: randomUUID(),
    event_type: "AUTOMATION.EXECUTION_CREATED",
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    producer: { service: "itcenter-api", instance: "api" },
    aggregate: { type: "ACTION_EXECUTION", id, version: 1 },
    actor: { type: "USER", id: input.actorId },
    correlation_id: p.correlation_id,
    causation_id: input.id,
    tenant_id: tx.tenantId,
    organization_id: tx.tenantId,
    idempotency_key: `execution-created:${id}`,
    payload: {
      execution_id: id,
      intent_id: p.intent_id,
      previous_execution_id: input.id,
      target_agent_id: p.target_agent_id,
      action_type: "RESTART_AGENT",
      state: "PENDING",
      reason: input.reason,
    },
  });
  return readActionExecution(tx, id);
}
