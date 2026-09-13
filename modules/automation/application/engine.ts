import { createHash, randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  evaluateCondition,
  SAFETY_LEVELS,
  validateRuleDefinition,
  type ActionDescriptor,
  type Condition,
  type EventTrigger,
  type PolicyDecision,
} from "../domain/rules.js";

export interface AutomationEvent {
  event_id: string;
  event_type: string;
  tenant_id: string;
  correlation_id: string;
  causation_id: string;
  occurred_at?: string;
  payload: Record<string, unknown>;
}

export interface ActionAuthorization {
  authorize(input: {
    tenantId: string;
    targetType: string;
    targetId: string;
    actionDomain: string;
    actionType: string;
  }): Promise<{ allowed: boolean; reasonCode: string }>;
}
export interface AutomationPolicyPort {
  decide(input: {
    tenantId: string;
    safetyLevel: string;
    requiresApproval: boolean;
    action: ActionDescriptor;
  }): Promise<{ decision: PolicyDecision; reasonCode: string }>;
}

export const denyUnconfiguredAutomationPrincipal: ActionAuthorization = {
  async authorize() {
    return {
      allowed: false,
      reasonCode: "AUTOMATION_PRINCIPAL_NOT_CONFIGURED",
    };
  },
};
export const denyUnconfiguredAutomationPolicy: AutomationPolicyPort = {
  async decide() {
    return { decision: "DENY", reasonCode: "AUTOMATION_POLICY_NOT_CONFIGURED" };
  },
};

export interface RuleDefinition {
  name: string;
  priority?: number;
  ownerUserId: string;
  ownerTeamId: string;
  purpose: string;
  reviewDate: string;
  trigger: EventTrigger;
  condition: unknown;
  action: ActionDescriptor;
  safetyLevel: (typeof SAFETY_LEVELS)[number];
  requiresApproval: boolean;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function validateDefinition(definition: RuleDefinition) {
  if (
    !definition.name.trim() ||
    (definition.priority !== undefined &&
      (!Number.isSafeInteger(definition.priority) ||
        definition.priority < -1000 ||
        definition.priority > 1000)) ||
    !definition.ownerUserId.trim() ||
    !definition.ownerTeamId.trim() ||
    !definition.purpose.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(definition.reviewDate) ||
    Number.isNaN(Date.parse(`${definition.reviewDate}T00:00:00Z`))
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Rule name, owner, team, purpose and valid review date are required.",
    );
  try {
    validateRuleDefinition({
      trigger: definition.trigger,
      condition: definition.condition,
      action: definition.action,
      safetyLevel: definition.safetyLevel,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid automation rule.";
    throw new ApplicationError(
      message.startsWith("AUTOMATION_ACTION_UNSUPPORTED")
        ? "AUTOMATION_ACTION_UNSUPPORTED"
        : "AUTOMATION_RULE_INVALID",
      message,
    );
  }
}

async function insertVersion(
  tx: Transaction,
  input: {
    ruleId: string;
    version: number;
    actorId: string;
    definition: RuleDefinition;
  },
) {
  const id = randomUUID();
  const content = {
    trigger: input.definition.trigger,
    condition: input.definition.condition,
    action: input.definition.action,
    priority: input.definition.priority ?? 0,
    safety_level: input.definition.safetyLevel,
    requires_approval: input.definition.requiresApproval,
  };
  await tx.query(
    `INSERT INTO automation.rule_versions(id,tenant_id,rule_id,version,state,trigger_json,condition_json,action_json,priority,safety_level,requires_approval,content_hash,created_by)
    VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      tx.tenantId,
      input.ruleId,
      input.version,
      JSON.stringify(content.trigger),
      JSON.stringify(content.condition),
      JSON.stringify(content.action),
      content.priority,
      content.safety_level,
      content.requires_approval,
      hash(content),
      input.actorId,
    ],
  );
  return id;
}

export async function createRule(
  tx: Transaction,
  input: { code: string; actorId: string; definition: RuleDefinition },
) {
  validateDefinition(input.definition);
  if (!/^[A-Z0-9][A-Z0-9_.-]{1,63}$/.test(input.code))
    throw new ApplicationError(
      "AUTOMATION_RULE_INVALID",
      "Rule code is invalid.",
    );
  const id = randomUUID();
  await tx.query(
    `INSERT INTO automation.rules(id,tenant_id,code,version,owner_user_id,owner_team_id,name,purpose,review_date,state,draft_version_id,entity_version,safety_level,requires_approval,timeout_seconds,max_attempts,action_spec)
    VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,'DRAFT',NULL,1,$9,$10,30,1,$11)`,
    [
      id,
      tx.tenantId,
      input.code,
      input.definition.ownerUserId,
      input.definition.ownerTeamId,
      input.definition.name,
      input.definition.purpose,
      input.definition.reviewDate,
      input.definition.safetyLevel,
      input.definition.requiresApproval,
      JSON.stringify(input.definition.action),
    ],
  );
  const versionId = await insertVersion(tx, {
    ruleId: id,
    version: 1,
    actorId: input.actorId,
    definition: input.definition,
  });
  await tx.query(
    "UPDATE automation.rules SET draft_version_id=$1 WHERE tenant_id=$2 AND id=$3",
    [versionId, tx.tenantId, id],
  );
  return {
    id,
    code: input.code,
    state: "DRAFT",
    version: 1,
    entity_version: 1,
    draft_version_id: versionId,
  };
}

export async function updateDraft(
  tx: Transaction,
  input: {
    ruleId: string;
    expectedVersion: number;
    actorId: string;
    definition: RuleDefinition;
  },
) {
  validateDefinition(input.definition);
  const row = await tx.query<{
    version: number;
    draft_version_id: string | null;
    state: string;
  }>(
    "SELECT entity_version AS version,draft_version_id,state FROM automation.rules WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.ruleId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Automation rule was not found.");
  if (row.rows[0]!.version !== input.expectedVersion)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Automation rule version changed.",
    );
  const rule = row.rows[0]!;
  const prior = rule.draft_version_id
    ? await tx.query<{ version: number }>(
        "SELECT version FROM automation.rule_versions WHERE tenant_id=$1 AND id=$2 AND state='DRAFT' FOR UPDATE",
        [tx.tenantId, rule.draft_version_id],
      )
    : { rows: [] as { version: number }[], rowCount: 0 };
  const next = input.expectedVersion + 1;
  let versionId: string;
  if (prior.rowCount) {
    versionId = rule.draft_version_id!;
    const content = {
      trigger: input.definition.trigger,
      condition: input.definition.condition,
      action: input.definition.action,
      priority: input.definition.priority ?? 0,
      safety_level: input.definition.safetyLevel,
      requires_approval: input.definition.requiresApproval,
    };
    await tx.query(
      "UPDATE automation.rule_versions SET trigger_json=$1,condition_json=$2,action_json=$3,priority=$4,safety_level=$5,requires_approval=$6,content_hash=$7,created_by=$8,created_at=now() WHERE tenant_id=$9 AND id=$10 AND state='DRAFT'",
      [
        JSON.stringify(content.trigger),
        JSON.stringify(content.condition),
        JSON.stringify(content.action),
        content.priority,
        content.safety_level,
        content.requires_approval,
        hash(content),
        input.actorId,
        tx.tenantId,
        versionId,
      ],
    );
  } else
    versionId = await insertVersion(tx, {
      ruleId: input.ruleId,
      version: next,
      actorId: input.actorId,
      definition: input.definition,
    });
  await tx.query(
    "UPDATE automation.rules SET name=$1,owner_user_id=$2,owner_team_id=$3,purpose=$4,review_date=$5,draft_version_id=$6,version=$7,entity_version=$7,safety_level=$8,requires_approval=$9,action_spec=$10,updated_at=now() WHERE tenant_id=$11 AND id=$12",
    [
      input.definition.name,
      input.definition.ownerUserId,
      input.definition.ownerTeamId,
      input.definition.purpose,
      input.definition.reviewDate,
      versionId,
      next,
      input.definition.safetyLevel,
      input.definition.requiresApproval,
      JSON.stringify(input.definition.action),
      tx.tenantId,
      input.ruleId,
    ],
  );
  return {
    id: input.ruleId,
    entity_version: next,
    draft_version_id: versionId,
  };
}

export async function publishVersion(
  tx: Transaction,
  input: { ruleId: string; expectedVersion: number; actorId: string },
) {
  const row = await tx.query<{
    entity_version: number;
    draft_version_id: string | null;
  }>(
    "SELECT entity_version,draft_version_id FROM automation.rules WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.ruleId],
  );
  if (!row.rowCount)
    throw new ApplicationError("NOT_FOUND", "Automation rule was not found.");
  if (row.rows[0]!.entity_version !== input.expectedVersion)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Automation rule version changed.",
    );
  const draftId = row.rows[0]!.draft_version_id;
  if (!draftId)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Rule has no draft version to publish.",
    );
  const published = await tx.query<{ version: number; content_hash: string }>(
    "UPDATE automation.rule_versions SET state='PUBLISHED',published_by=$1,published_at=now() WHERE tenant_id=$2 AND id=$3 AND state='DRAFT' RETURNING version,content_hash",
    [input.actorId, tx.tenantId, draftId],
  );
  if (!published.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Draft version is no longer publishable.",
    );
  const entityVersion = input.expectedVersion + 1;
  await tx.query(
    "UPDATE automation.rules SET draft_version_id=NULL,version=$1,entity_version=$1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
    [entityVersion, tx.tenantId, input.ruleId],
  );
  return {
    id: input.ruleId,
    version: published.rows[0]!.version,
    entity_version: entityVersion,
    content_hash: published.rows[0]!.content_hash,
  };
}

export async function activateRule(
  tx: Transaction,
  input: {
    ruleId: string;
    ruleVersion: number;
    expectedVersion: number;
    actorId: string;
    approvalId?: string;
  },
) {
  const row = await tx.query<{
    entity_version: number;
    state: string;
    id: string;
    safety_level: string;
    content_hash: string;
    requires_approval: boolean;
  }>(
    "SELECT r.entity_version,r.state,v.id,v.safety_level,v.content_hash,v.requires_approval FROM automation.rules r JOIN automation.rule_versions v ON v.tenant_id=r.tenant_id AND v.rule_id=r.id AND v.version=$3 AND v.state='PUBLISHED' WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r",
    [tx.tenantId, input.ruleId, input.ruleVersion],
  );
  if (!row.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Published rule version was not found.",
    );
  const value = row.rows[0]!;
  if (value.entity_version !== input.expectedVersion)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Automation rule version changed.",
    );
  let activationContextHash: string | null = null;
  if (value.safety_level === "HIGH_RISK") {
    if (!input.approvalId)
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        "High-risk rule activation requires approval.",
      );
    const approval = await tx.query<{
      state: string;
      source_id: string;
      context: unknown;
    }>(
      "SELECT state,source_id,context FROM control.approval_requests WHERE tenant_id=$1 AND id=$2 AND source_type='AUTOMATION_RULE_ACTIVATION' FOR SHARE",
      [tx.tenantId, input.approvalId],
    );
    const context = approval.rows[0]?.context as
      Record<string, unknown> | undefined;
    if (
      !approval.rowCount ||
      approval.rows[0]!.state !== "APPROVED" ||
      approval.rows[0]!.source_id !== input.ruleId ||
      context?.rule_version !== input.ruleVersion ||
      context?.content_hash !== value.content_hash
    )
      throw new ApplicationError(
        "APPROVAL_CONTEXT_STALE",
        "Activation approval does not bind to this published version.",
      );
    activationContextHash = hash({
      rule_id: input.ruleId,
      rule_version: input.ruleVersion,
      content_hash: value.content_hash,
    });
  }
  const next = input.expectedVersion + 1;
  await tx.query(
    "UPDATE automation.rules SET state='ACTIVE',enabled=true,active_version_id=$1,activated_at=now(),activation_approval_id=$2,activation_context_hash=$3,version=$4,entity_version=$4,updated_at=now() WHERE tenant_id=$5 AND id=$6",
    [
      value.id,
      input.approvalId ?? null,
      activationContextHash,
      next,
      tx.tenantId,
      input.ruleId,
    ],
  );
  return {
    id: input.ruleId,
    state: "ACTIVE",
    rule_version: input.ruleVersion,
    safety_level: value.safety_level,
    approval_reference: input.approvalId ?? null,
    entity_version: next,
  };
}

export async function deactivateRule(
  tx: Transaction,
  input: { ruleId: string; expectedVersion: number },
) {
  const result = await tx.query<{ entity_version: number }>(
    "UPDATE automation.rules SET state='INACTIVE',enabled=false,version=version+1,entity_version=entity_version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND entity_version=$3 RETURNING entity_version",
    [tx.tenantId, input.ruleId, input.expectedVersion],
  );
  if (!result.rowCount) {
    const exists = await tx.query(
      "SELECT 1 FROM automation.rules WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, input.ruleId],
    );
    if (!exists.rowCount)
      throw new ApplicationError("NOT_FOUND", "Automation rule was not found.");
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Automation rule version changed.",
    );
  }
  return {
    id: input.ruleId,
    state: "INACTIVE",
    entity_version: result.rows[0]!.entity_version,
  };
}

export async function setScopedKillSwitch(input: {
  tx: Transaction;
  scopeType: "GLOBAL" | "CATEGORY" | "RULE";
  scopeKey: string;
  enabled: boolean;
  actorId: string;
  reason: string;
}) {
  if (!input.reason.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Kill-switch change requires a reason.",
    );
  await input.tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${input.tx.tenantId}:AUTOMATION_KILL:${input.scopeType}:${input.scopeKey}`,
  ]);
  await input.tx.query(
    `INSERT INTO automation.kill_switches(tenant_id,scope_type,scope_key,enabled,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(tenant_id,scope_type,scope_key) DO UPDATE SET enabled=EXCLUDED.enabled,changed_by=EXCLUDED.changed_by,reason=EXCLUDED.reason,updated_at=now()`,
    [
      input.tx.tenantId,
      input.scopeType,
      input.scopeKey,
      input.enabled,
      input.actorId,
      input.reason,
    ],
  );
}

function policyFor(
  result: PolicyDecision,
  requiresApproval: boolean,
): PolicyDecision {
  if (result === "DENY") return "DENY";
  if (requiresApproval && result === "ALLOW") return "REQUIRE_APPROVAL";
  return result;
}
function contextHash(event: AutomationEvent, action: ActionDescriptor) {
  return hash({
    event_id: event.event_id,
    target_type: action.target_type,
    target_id: action.target_id,
    action_domain: action.action_domain,
    action_type: action.action_type,
    parameters: action.parameters,
    desired_state: action.desired_state,
  });
}
function dedupeHash(event: AutomationEvent, action: ActionDescriptor) {
  return hash({ tenant_id: event.tenant_id, event_id: event.event_id, action });
}
function conflictHash(event: AutomationEvent, action: ActionDescriptor) {
  return hash({
    tenant_id: event.tenant_id,
    event_id: event.event_id,
    target_type: action.target_type,
    target_id: action.target_id,
    action_domain: action.action_domain,
    exclusivity_group: action.exclusivity_group,
  });
}

async function isKilled(
  tx: Transaction,
  ruleId: string,
  category: string,
): Promise<boolean> {
  for (const key of [
    `${tx.tenantId}:AUTOMATION_KILL:GLOBAL:*`,
    `${tx.tenantId}:AUTOMATION_KILL:CATEGORY:${category}`,
    `${tx.tenantId}:AUTOMATION_KILL:RULE:${ruleId}`,
  ])
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      key,
    ]);
  const result = await tx.query(
    "SELECT 1 FROM automation.kill_switches WHERE tenant_id=$1 AND enabled=true AND (scope_type='GLOBAL' OR (scope_type='CATEGORY' AND scope_key=$2) OR (scope_type='RULE' AND scope_key=$3)) LIMIT 1",
    [tx.tenantId, category, ruleId],
  );
  if (result.rowCount) return true;
  const legacy = await tx.query<{ kill_switched: boolean }>(
    "SELECT kill_switched FROM automation.rules WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, ruleId],
  );
  return legacy.rows[0]?.kill_switched === true;
}

async function isIntentKilled(
  tx: Transaction,
  intentId: string,
  category: string,
): Promise<boolean> {
  const contributors = await tx.query<{ rule_id: string }>(
    "SELECT DISTINCT rule_id FROM automation.action_intent_contributors WHERE tenant_id=$1 AND action_intent_id=$2 ORDER BY rule_id",
    [tx.tenantId, intentId],
  );
  if (!contributors.rowCount) return true;
  for (const contributor of contributors.rows)
    if (await isKilled(tx, contributor.rule_id, category)) return true;
  return false;
}

export async function evaluateEvent(
  tx: Transaction,
  event: AutomationEvent,
  authorization: ActionAuthorization,
  policy: AutomationPolicyPort = denyUnconfiguredAutomationPolicy,
  options: {
    mode?: "PRODUCTION" | "SIMULATION";
    fixture?: Record<string, unknown>;
  } = {},
) {
  if (event.tenant_id !== tx.tenantId)
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Event tenant does not match transaction.",
    );
  if (event.event_type.startsWith("AUTOMATION.")) return [];
  const rules = await tx.query<{
    id: string;
    code: string;
    version: number;
    rule_version: number;
    version_id: string;
    trigger_json: EventTrigger;
    condition_json: Condition;
    action_json: ActionDescriptor;
    safety_level: string;
    requires_approval: boolean;
  }>(
    `SELECT r.id,r.code,r.entity_version AS version,v.version AS rule_version,v.id AS version_id,v.trigger_json,v.condition_json,v.action_json,v.safety_level,v.requires_approval
    FROM automation.rules r JOIN automation.rule_versions v ON v.tenant_id=r.tenant_id AND v.id=r.active_version_id AND v.state='PUBLISHED'
    WHERE r.tenant_id=$1 AND r.state='ACTIVE' AND r.enabled=true AND v.trigger_json->>'event_type'=$2 AND ($3::timestamptz IS NULL OR r.activated_at<=$3) ORDER BY v.priority DESC,r.id FOR SHARE OF r,v`,
    [tx.tenantId, event.event_type, event.occurred_at ?? null],
  );
  const staged: {
    id: string;
    action: ActionDescriptor;
    evalId: string;
    ruleId: string;
    version: number;
    decision: PolicyDecision;
    contextHash: string;
    reason: string;
    authorized: boolean;
  }[] = [];
  const results: Record<string, unknown>[] = [];
  for (const rule of rules.rows) {
    if (!triggerMatches(rule.trigger_json, event.payload)) continue;
    const condition = evaluateCondition(
      rule.condition_json,
      {
        ...event.payload,
        event_type: event.event_type,
        event_id: event.event_id,
      },
      options.fixture ?? {},
    );
    const action = rule.action_json;
    const policyResult =
      rule.safety_level === "PROHIBITED_AUTO"
        ? { decision: "DENY" as const, reasonCode: "PROHIBITED_AUTO" }
        : await policy.decide({
            tenantId: tx.tenantId,
            safetyLevel: rule.safety_level,
            requiresApproval: rule.requires_approval,
            action,
          });
    const decision = policyFor(policyResult.decision, rule.requires_approval);
    const killed = await isKilled(tx, rule.id, action.action_domain);
    const auth =
      condition.matched &&
      decision === "ALLOW" &&
      !killed &&
      options.mode !== "SIMULATION"
        ? await authorization.authorize({
            tenantId: tx.tenantId,
            targetType: action.target_type,
            targetId: action.target_id,
            actionDomain: action.action_domain,
            actionType: action.action_type,
          })
        : {
            allowed: decision !== "DENY" && !killed,
            reasonCode: killed ? "KILL_SWITCH_ACTIVE" : "POLICY_GATE",
          };
    const policyDecision = decision;
    const reason = killed
      ? "KILL_SWITCH_ACTIVE"
      : decision === "DENY"
        ? policyResult.reasonCode
        : condition.matched && !auth.allowed
          ? auth.reasonCode
          : decision;
    const evaluationId = randomUUID();
    const context = hash({
      event_id: event.event_id,
      payload: event.payload,
      fixture: options.fixture ?? {},
    });
    if (options.mode !== "SIMULATION") {
      await tx.query(
        `INSERT INTO automation.rule_evaluations(id,tenant_id,source_event_id,source_event_type,rule_id,rule_version,mode,match_result,condition_evidence_json,policy_decision,policy_reason_code,context_hash,correlation_id)
        VALUES($1,$2,$3,$4,$5,$6,'PRODUCTION',$7,$8,$9,$10,$11,$12) ON CONFLICT(tenant_id,source_event_id,rule_id,rule_version,mode) DO NOTHING`,
        [
          evaluationId,
          tx.tenantId,
          event.event_id,
          event.event_type,
          rule.id,
          rule.rule_version,
          condition.matched,
          JSON.stringify(condition.evidence),
          policyDecision,
          reason,
          context,
          event.correlation_id,
        ],
      );
      const stored = await tx.query<{ id: string }>(
        "SELECT id FROM automation.rule_evaluations WHERE tenant_id=$1 AND source_event_id=$2 AND rule_id=$3 AND rule_version=$4 AND mode='PRODUCTION'",
        [tx.tenantId, event.event_id, rule.id, rule.rule_version],
      );
      const evalId = stored.rows[0]!.id;
      if (condition.matched)
        staged.push({
          id: rule.id,
          action,
          evalId,
          ruleId: rule.id,
          version: rule.rule_version,
          decision,
          contextHash: contextHash(event, action),
          reason,
          authorized: auth.allowed && !killed,
        });
      results.push({
        evaluation_id: evalId,
        rule_id: rule.id,
        rule_version: rule.rule_version,
        matched: condition.matched,
        conditions: condition.evidence,
        policy_decision: policyDecision,
        reason_code: reason,
        mode: "PRODUCTION",
      });
    } else {
      results.push({
        evaluation_id: null,
        rule_id: rule.id,
        rule_version: rule.rule_version,
        matched: condition.matched,
        conditions: condition.evidence,
        policy_decision: policyDecision,
        reason_code: reason,
        proposed_action: condition.matched ? action : null,
        mode: "SIMULATION",
      });
    }
  }
  if (options.mode === "SIMULATION") return results;
  const canonicalIntents = new Map<
    string,
    {
      id: string;
      action: ActionDescriptor;
      decision: PolicyDecision;
      conflictKey: string;
      contextHash: string;
      state: string;
      reason: string;
      members: { ruleId: string; version: number; evalId: string }[];
      authOk: boolean;
    }
  >();
  for (const item of staged) {
    const dedupeKey = dedupeHash(event, item.action);
    const existing = canonicalIntents.get(dedupeKey);
    if (existing) {
      existing.members.push({
        ruleId: item.ruleId,
        version: item.version,
        evalId: item.evalId,
      });
      existing.decision = restrictive(existing.decision, item.decision);
      existing.authOk &&= item.authorized;
      if (existing.decision === "DENY") existing.reason = "PROHIBITED_AUTO";
      continue;
    }
    const id = randomUUID();
    const state =
      item.decision === "DENY" || !item.authorized
        ? "BLOCKED"
        : item.decision === "REQUIRE_APPROVAL"
          ? "PENDING_APPROVAL"
          : "READY";
    canonicalIntents.set(dedupeKey, {
      id,
      action: item.action,
      decision: item.decision,
      conflictKey: conflictHash(event, item.action),
      contextHash: item.contextHash,
      state,
      reason: item.reason,
      members: [
        { ruleId: item.ruleId, version: item.version, evalId: item.evalId },
      ],
      authOk: item.authorized,
    });
  }
  const scopes = new Map<
    string,
    typeof canonicalIntents extends Map<string, infer V> ? V[] : never
  >();
  for (const [dedupeKey, intent] of canonicalIntents) {
    intent.state =
      intent.decision === "DENY" || !intent.authOk
        ? "BLOCKED"
        : intent.decision === "REQUIRE_APPROVAL"
          ? "PENDING_APPROVAL"
          : "READY";
    if (!intent.authOk && intent.decision !== "DENY")
      intent.reason = "AUTOMATION_PRINCIPAL_NOT_CONFIGURED";
    const key = intent.conflictKey;
    const list = scopes.get(key) ?? [];
    list.push(intent);
    scopes.set(key, list);
    const existing = await tx.query<{
      id: string;
      policy_decision: PolicyDecision;
      state: string;
      approval_context_hash: string;
    }>(
      "SELECT id,policy_decision,state,approval_context_hash FROM automation.action_intents WHERE tenant_id=$1 AND deduplication_key=$2",
      [tx.tenantId, dedupeKey],
    );
    const finalId = existing.rows[0]?.id ?? intent.id;
    if (!existing.rowCount) {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO automation.action_intents(id,tenant_id,source_event_id,target_type,target_id,action_domain,action_type,normalized_parameters_json,policy_decision,approval_context_hash,deduplication_key,conflict_scope_key,exclusivity_group,desired_state,state,reason_code,correlation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(tenant_id,deduplication_key) DO NOTHING RETURNING id`,
        [
          intent.id,
          tx.tenantId,
          event.event_id,
          intent.action.target_type,
          intent.action.target_id,
          intent.action.action_domain,
          intent.action.action_type,
          JSON.stringify(intent.action.parameters),
          intent.decision,
          intent.contextHash,
          dedupeKey,
          intent.conflictKey,
          intent.action.exclusivity_group,
          intent.action.desired_state ?? null,
          intent.state,
          intent.reason,
          event.correlation_id,
        ],
      );
      if (!inserted.rowCount) {
        const winner = await tx.query<{ id: string }>(
          "SELECT id FROM automation.action_intents WHERE tenant_id=$1 AND deduplication_key=$2",
          [tx.tenantId, dedupeKey],
        );
        intent.id = winner.rows[0]!.id;
      }
    }
    for (const member of intent.members)
      await tx.query(
        "INSERT INTO automation.action_intent_contributors(tenant_id,action_intent_id,rule_id,rule_version,evaluation_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [tx.tenantId, finalId, member.ruleId, member.version, member.evalId],
      );
    intent.id = finalId;
  }
  for (const scopeKey of scopes.keys()) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${tx.tenantId}:${scopeKey}`,
    ]);
    const scoped = await tx.query<{
      id: string;
      desired_state: string | null;
      action_type: string;
    }>(
      "SELECT id,desired_state,action_type FROM automation.action_intents WHERE tenant_id=$1 AND conflict_scope_key=$2 AND state IN ('READY','PENDING_APPROVAL','CONFLICTED') FOR UPDATE",
      [tx.tenantId, scopeKey],
    );
    const states = new Set(
      scoped.rows.map((i) => i.desired_state ?? i.action_type),
    );
    if ((scoped.rowCount ?? 0) > 1 && states.size > 1) {
      const conflictId = randomUUID();
      await tx.query(
        "INSERT INTO automation.intent_conflicts(id,tenant_id,conflict_scope_key,state) VALUES($1,$2,$3,'OPEN') ON CONFLICT DO NOTHING",
        [conflictId, tx.tenantId, scopeKey],
      );
      const conflict = await tx.query<{ id: string }>(
        "SELECT id FROM automation.intent_conflicts WHERE tenant_id=$1 AND conflict_scope_key=$2 AND state='OPEN'",
        [tx.tenantId, scopeKey],
      );
      for (const intent of scoped.rows) {
        await tx.query(
          "UPDATE automation.action_intents SET state='CONFLICTED',reason_code='ACTION_INTENT_CONFLICT',entity_version=entity_version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state<>'CONFLICTED'",
          [tx.tenantId, intent.id],
        );
        await tx.query(
          "INSERT INTO automation.intent_conflict_members(tenant_id,conflict_id,action_intent_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [tx.tenantId, conflict.rows[0]!.id, intent.id],
        );
      }
    }
  }
  const intentRows = await tx.query<{
    id: string;
    state: string;
    policy_decision: PolicyDecision;
    reason_code: string | null;
    deduplication_key: string;
  }>(
    "SELECT DISTINCT i.id,i.state,i.policy_decision,i.reason_code,i.deduplication_key FROM automation.action_intents i JOIN automation.action_intent_contributors c ON c.tenant_id=i.tenant_id AND c.action_intent_id=i.id JOIN automation.rule_evaluations e ON e.tenant_id=c.tenant_id AND e.id=c.evaluation_id WHERE i.tenant_id=$1 AND i.source_event_id=$2",
    [tx.tenantId, event.event_id],
  );
  for (const evaluation of results)
    if (evaluation.evaluation_id) {
      const own = await tx.query<{ ids: string[] }>(
        "SELECT COALESCE(array_agg(DISTINCT c.action_intent_id),'{}') AS ids FROM automation.action_intent_contributors c WHERE c.tenant_id=$1 AND c.evaluation_id=$2",
        [tx.tenantId, evaluation.evaluation_id],
      );
      const actionIntentIds = own.rows[0]?.ids ?? [];
      await tx.query(
        "UPDATE automation.rule_evaluations SET action_intent_ids=$1::uuid[] WHERE tenant_id=$2 AND id=$3",
        [actionIntentIds, tx.tenantId, evaluation.evaluation_id],
      );
      evaluation.action_intent_ids = actionIntentIds;
    }
  return Object.assign(results, { action_intents: intentRows.rows });
}

function restrictive(
  left: PolicyDecision,
  right: PolicyDecision,
): PolicyDecision {
  const order = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 };
  return order[left] >= order[right] ? left : right;
}

function triggerMatches(
  trigger: EventTrigger,
  eventPayload: Record<string, unknown>,
): boolean {
  if (!trigger.attributes) return true;
  return Object.entries(trigger.attributes).every(
    ([key, value]) => canonical(eventPayload[key]) === canonical(value),
  );
}

export async function simulateRule(
  tx: Transaction,
  input: {
    ruleId: string;
    ruleVersion?: number;
    eventType: string;
    eventId?: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
    authorization: ActionAuthorization;
    policy?: AutomationPolicyPort;
  },
) {
  const row = await tx.query<{
    rule_id: string;
    version: number;
    trigger_json: EventTrigger;
    condition_json: Condition;
    action_json: ActionDescriptor;
    safety_level: string;
    requires_approval: boolean;
    state: string;
  }>(
    `SELECT r.id AS rule_id,v.version,v.trigger_json,v.condition_json,v.action_json,v.safety_level,v.requires_approval,v.state
    FROM automation.rules r JOIN automation.rule_versions v ON v.tenant_id=r.tenant_id AND v.rule_id=r.id
    WHERE r.tenant_id=$1 AND r.id=$2 AND ($3::integer IS NULL OR v.version=$3) ORDER BY v.version DESC LIMIT 1`,
    [tx.tenantId, input.ruleId, input.ruleVersion ?? null],
  );
  if (!row.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Automation rule version was not found.",
    );
  const rule = row.rows[0]!;
  const triggerMatched =
    rule.trigger_json.event_type === input.eventType &&
    triggerMatches(rule.trigger_json, input.payload);
  const condition = triggerMatched
    ? evaluateCondition(
        rule.condition_json,
        {
          ...input.payload,
          event_type: input.eventType,
          event_id: input.eventId ?? "SIMULATION",
        },
        input.context ?? {},
      )
    : { matched: false, evidence: [] };
  const policyResult =
    rule.safety_level === "PROHIBITED_AUTO"
      ? { decision: "DENY" as const, reasonCode: "PROHIBITED_AUTO" }
      : await (input.policy ?? denyUnconfiguredAutomationPolicy).decide({
          tenantId: tx.tenantId,
          safetyLevel: rule.safety_level,
          requiresApproval: rule.requires_approval,
          action: rule.action_json,
        });
  const decision = policyFor(policyResult.decision, rule.requires_approval);
  const killed = await isKilled(
    tx,
    input.ruleId,
    rule.action_json.action_domain,
  );
  const auth =
    condition.matched && decision === "ALLOW" && !killed
      ? await input.authorization.authorize({
          tenantId: tx.tenantId,
          targetType: rule.action_json.target_type,
          targetId: rule.action_json.target_id,
          actionDomain: rule.action_json.action_domain,
          actionType: rule.action_json.action_type,
        })
      : {
          allowed: decision !== "DENY" && !killed,
          reasonCode: killed ? "KILL_SWITCH_ACTIVE" : "POLICY_GATE",
        };
  const dedupeKey = condition.matched
    ? dedupeHash(
        {
          event_id: input.eventId ?? "SIMULATION",
          tenant_id: tx.tenantId,
        } as AutomationEvent,
        rule.action_json,
      )
    : null;
  const conflictKey = condition.matched
    ? conflictHash(
        {
          event_id: input.eventId ?? "SIMULATION",
          tenant_id: tx.tenantId,
        } as AutomationEvent,
        rule.action_json,
      )
    : null;
  const dedupe = dedupeKey
    ? await tx.query<{ id: string }>(
        "SELECT id FROM automation.action_intents WHERE tenant_id=$1 AND deduplication_key=$2",
        [tx.tenantId, dedupeKey],
      )
    : { rows: [] as { id: string }[], rowCount: 0 };
  const conflicts = conflictKey
    ? await tx.query<{ id: string }>(
        "SELECT id FROM automation.action_intents WHERE tenant_id=$1 AND conflict_scope_key=$2 AND desired_state IS DISTINCT FROM $3 AND state IN ('READY','PENDING_APPROVAL','CONFLICTED')",
        [
          tx.tenantId,
          conflictKey,
          rule.action_json.desired_state ?? rule.action_json.action_type,
        ],
      )
    : { rows: [] as { id: string }[], rowCount: 0 };
  return {
    mode: "SIMULATION",
    rule_id: input.ruleId,
    rule_version: rule.version,
    match_result: condition.matched,
    condition_evidence: condition.evidence,
    policy_decision: decision,
    policy_reason_code: killed
      ? "KILL_SWITCH_ACTIVE"
      : condition.matched && !auth.allowed
        ? auth.reasonCode
        : decision === "DENY"
          ? policyResult.reasonCode
          : decision,
    proposed_action: condition.matched ? rule.action_json : null,
    deduplication_key: dedupeKey,
    canonical_duplicate_intent_id: dedupe.rows[0]?.id ?? null,
    conflict_scope_key: conflictKey,
    conflict_with_intent_ids: conflicts.rows.map((r) => r.id),
    executable: false,
  };
}

export async function resolveConflict(
  tx: Transaction,
  input: {
    conflictId: string;
    expectedVersion: number;
    actorId: string;
    reason: string;
    selectedIntentIds: string[];
    authorization: ActionAuthorization;
  },
) {
  if (!input.reason.trim() || !input.selectedIntentIds.length)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Reason and at least one selected intent are required.",
    );
  const conflict = await tx.query<{ entity_version: number; state: string }>(
    "SELECT entity_version,state FROM automation.intent_conflicts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, input.conflictId],
  );
  if (!conflict.rowCount)
    throw new ApplicationError(
      "NOT_FOUND",
      "Automation conflict was not found.",
    );
  if (conflict.rows[0]!.entity_version !== input.expectedVersion)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Automation conflict changed.",
    );
  if (conflict.rows[0]!.state !== "OPEN")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Automation conflict is already resolved.",
    );
  const members = await tx.query<{
    id: string;
    target_type: string;
    target_id: string;
    action_domain: string;
    action_type: string;
    policy_decision: string;
    approval_id: string | null;
    approval_context_hash: string;
    state: string;
    desired_state: string | null;
  }>(
    `SELECT i.id,i.target_type,i.target_id,i.action_domain,i.action_type,i.policy_decision,i.approval_id,i.approval_context_hash,i.state,i.desired_state
    FROM automation.intent_conflict_members m JOIN automation.action_intents i ON i.tenant_id=m.tenant_id AND i.id=m.action_intent_id WHERE m.tenant_id=$1 AND m.conflict_id=$2 FOR UPDATE OF i`,
    [tx.tenantId, input.conflictId],
  );
  const ids = new Set(members.rows.map((r) => r.id));
  if (input.selectedIntentIds.some((id) => !ids.has(id)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Selected intents must belong to this conflict.",
    );
  const selected = members.rows.filter((r) =>
    input.selectedIntentIds.includes(r.id),
  );
  if (new Set(selected.map((r) => r.desired_state ?? r.action_type)).size > 1)
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Selected intents are mutually incompatible.",
    );
  for (const intent of selected) {
    if (intent.policy_decision === "DENY")
      throw new ApplicationError(
        "AUTOMATION_POLICY_DENIED",
        "Policy DENY cannot be overridden.",
      );
    if (intent.policy_decision === "REQUIRE_APPROVAL" && !intent.approval_id)
      continue;
    const kill = await isIntentKilled(tx, intent.id, intent.action_domain);
    const auth = await input.authorization.authorize({
      tenantId: tx.tenantId,
      targetType: intent.target_type,
      targetId: intent.target_id,
      actionDomain: intent.action_domain,
      actionType: intent.action_type,
    });
    if (kill || !auth.allowed)
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "Intent remains blocked by current safety or target authorization.",
      );
  }
  for (const intent of members.rows) {
    const isSelected = input.selectedIntentIds.includes(intent.id);
    const state =
      isSelected && intent.policy_decision === "ALLOW"
        ? "READY"
        : isSelected
          ? "PENDING_APPROVAL"
          : "BLOCKED";
    await tx.query(
      "UPDATE automation.action_intents SET state=$1,reason_code=$2,entity_version=entity_version+1,updated_at=now() WHERE tenant_id=$3 AND id=$4",
      [
        state,
        isSelected ? "CONFLICT_RESOLVED" : "CONFLICT_NOT_SELECTED",
        tx.tenantId,
        intent.id,
      ],
    );
    await tx.query(
      "UPDATE automation.intent_conflict_members SET resolution_state=$1 WHERE tenant_id=$2 AND conflict_id=$3 AND action_intent_id=$4",
      [
        isSelected ? "SELECTED" : "BLOCKED",
        tx.tenantId,
        input.conflictId,
        intent.id,
      ],
    );
  }
  await tx.query(
    "UPDATE automation.intent_conflicts SET state='RESOLVED',entity_version=entity_version+1,resolution_json=$1,resolved_by=$2,resolution_reason=$3,resolved_at=now() WHERE tenant_id=$4 AND id=$5",
    [
      JSON.stringify({ selected_intent_ids: input.selectedIntentIds }),
      input.actorId,
      input.reason,
      tx.tenantId,
      input.conflictId,
    ],
  );
  await tx.query(
    "UPDATE operations.work_items SET state='RESOLVED',resolved_at=now(),last_action_at=now(),version=version+1 WHERE tenant_id=$1 AND source_type='AUTOMATION_CONFLICT' AND source_id=$2 AND state NOT IN ('RESOLVED','CLOSED')",
    [tx.tenantId, input.conflictId],
  );
  return {
    id: input.conflictId,
    state: "RESOLVED",
    selected_intent_ids: input.selectedIntentIds,
  };
}

export async function recheckIntentApproval(
  tx: Transaction,
  input: {
    approvalId: string;
    eventId: string;
    authorization: ActionAuthorization;
  },
) {
  const approval = await tx.query<{
    state: string;
    source_type: string;
    source_id: string;
    context: unknown;
  }>(
    "SELECT state,source_type,source_id,context FROM control.approval_requests WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, input.approvalId],
  );
  if (
    !approval.rowCount ||
    approval.rows[0]!.source_type !== "AUTOMATION_ACTION_INTENT"
  )
    return false;
  const intentId = approval.rows[0]!.source_id;
  const row = await tx.query<{
    id: string;
    state: string;
    approval_context_hash: string;
    target_type: string;
    target_id: string;
    action_domain: string;
    action_type: string;
    conflict_scope_key: string;
    policy_decision: string;
  }>(
    "SELECT * FROM automation.action_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
    [tx.tenantId, intentId],
  );
  if (!row.rowCount) return false;
  const intent = row.rows[0]!;
  const context = approval.rows[0]!.context as Record<string, unknown>;
  if (
    approval.rows[0]!.state !== "APPROVED" ||
    context?.context_hash !== intent.approval_context_hash ||
    context?.intent_id !== intent.id ||
    intent.policy_decision !== "REQUIRE_APPROVAL"
  )
    return false;
  const conflict = await tx.query(
    "SELECT 1 FROM automation.intent_conflict_members m JOIN automation.intent_conflicts c ON c.tenant_id=m.tenant_id AND c.id=m.conflict_id WHERE m.tenant_id=$1 AND m.action_intent_id=$2 AND c.state='OPEN'",
    [tx.tenantId, intent.id],
  );
  const killed = await isIntentKilled(tx, intentId, intent.action_domain);
  const auth = await input.authorization.authorize({
    tenantId: tx.tenantId,
    targetType: intent.target_type,
    targetId: intent.target_id,
    actionDomain: intent.action_domain,
    actionType: intent.action_type,
  });
  if (conflict.rowCount || killed || !auth.allowed) return false;
  await tx.query(
    "UPDATE automation.action_intents SET state='READY',approval_id=$1,entity_version=entity_version+1,updated_at=now() WHERE tenant_id=$2 AND id=$3 AND state='PENDING_APPROVAL'",
    [input.approvalId, tx.tenantId, intent.id],
  );
  return true;
}

export async function getIntent(tx: Transaction, id: string) {
  const result = await tx.query(
    "SELECT i.*,COALESCE(jsonb_agg(DISTINCT jsonb_build_object('rule_id',c.rule_id,'rule_version',c.rule_version,'evaluation_id',c.evaluation_id)) FILTER(WHERE c.action_intent_id IS NOT NULL),'[]'::jsonb) AS contributors FROM automation.action_intents i LEFT JOIN automation.action_intent_contributors c ON c.tenant_id=i.tenant_id AND c.action_intent_id=i.id WHERE i.tenant_id=$1 AND i.id=$2 GROUP BY i.id",
    [tx.tenantId, id],
  );
  if (!result.rowCount)
    throw new ApplicationError("NOT_FOUND", "Action Intent was not found.");
  return result.rows[0];
}
