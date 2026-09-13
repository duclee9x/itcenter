import type { Transaction } from "../../../packages/persistence/src/index.js";
import type {
  AuthorizationPort,
  AuthorizationRequest,
} from "../../../packages/auth/src/index.js";
import { evaluateAuthorization } from "../../identity/index.js";
import type { ActionDescriptor, PolicyDecision } from "../domain/rules.js";
import {
  ACTION_CAPABILITY_CATALOG,
  validateCapabilityAction,
  type ActionCapability,
} from "../domain/capabilities.js";
import type {
  ActionAuthorization,
  ActionCapabilityPort,
  AutomationPolicyPort,
  AutomationTargetContext,
  AutomationTargetPort,
} from "../application/ports.js";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const SERVICE_IDENTITY = "itcenter.task090.automation";

interface CapabilityRow extends ActionCapability {
  active: boolean;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function matchesScopeSelector(
  selectorValue: unknown,
  target: AutomationTargetContext,
): boolean {
  const selector = jsonObject(selectorValue);
  if (!selector) return false;
  return Object.entries(selector).every(
    ([key, value]) => typeof value === "string" && target.scope[key] === value,
  );
}

function matchesParameterConstraints(
  constraintsValue: unknown,
  parameters: Record<string, unknown>,
): boolean {
  const constraints = jsonObject(constraintsValue);
  if (!constraints) return false;
  if (
    Object.keys(constraints).some(
      (key) => !["equals", "required_keys"].includes(key),
    )
  )
    return false;
  const equals =
    constraints.equals === undefined ? {} : jsonObject(constraints.equals);
  if (!equals) return false;
  if (
    Object.entries(equals).some(
      ([key, value]) =>
        JSON.stringify(parameters[key]) !== JSON.stringify(value),
    )
  )
    return false;
  const required = constraints.required_keys ?? [];
  return (
    Array.isArray(required) &&
    required.every(
      (key) => typeof key === "string" && Object.hasOwn(parameters, key),
    )
  );
}

export class PostgresAutomationSecurity
  implements
    ActionCapabilityPort,
    AutomationTargetPort,
    ActionAuthorization,
    AutomationPolicyPort
{
  constructor(private readonly tx: Transaction) {}

  async resolve(input: {
    action: ActionDescriptor;
  }): Promise<ActionCapability | null> {
    const definition = ACTION_CAPABILITY_CATALOG.find(
      (entry) =>
        entry.action_type === input.action.action_type &&
        entry.target_type === input.action.target_type,
    );
    if (!definition || !validateCapabilityAction(input.action, definition))
      return null;
    const rows = await this.tx.query<CapabilityRow>(
      `SELECT id,action_type,target_type,version,required_permission,safety_class,
              automatic_execution_supported,approval_supported,approval_required,
              conflict_group,parameter_schema_json,executor_type,active
       FROM automation.action_capabilities
       WHERE action_type=$1 AND target_type=$2 AND active=true
       ORDER BY version DESC LIMIT 1`,
      [input.action.action_type, input.action.target_type],
    );
    if (!rows.rowCount) return null;
    const row = rows.rows[0]!;
    if (
      row.version !== definition.version ||
      row.required_permission !== definition.required_permission ||
      row.safety_class !== definition.safety_class ||
      row.automatic_execution_supported !==
        definition.automatic_execution_supported ||
      row.approval_supported !== definition.approval_supported ||
      row.approval_required !== definition.approval_required ||
      row.conflict_group !== definition.conflict_group ||
      row.executor_type !== definition.executor_type ||
      stable(row.parameter_schema_json) !==
        stable(definition.parameter_schema_json)
    )
      return null;
    return row;
  }

  async resolveTarget(input: {
    tenantId: string;
    targetType: string;
    targetId: string;
  }): Promise<AutomationTargetContext | null> {
    if (
      input.tenantId !== this.tx.tenantId ||
      input.targetType !== "AGENT" ||
      !/^[0-9a-f-]{36}$/i.test(input.targetId)
    )
      return null;
    const rows = await this.tx.query<{
      tenant_id: string;
      agent_id: string;
      site_id: string | null;
      location_id: string | null;
      location_path: string[];
    }>(
      `WITH RECURSIVE target AS (
         SELECT ag.tenant_id,ag.id AS agent_id,a.current_location_id
         FROM agent.agents ag JOIN asset.assets a
           ON a.tenant_id=ag.tenant_id AND a.id=ag.asset_id
         WHERE ag.tenant_id=$1 AND ag.id=$2 AND ag.status<>'UNMANAGED'
         FOR SHARE OF ag,a
       ), location_chain AS (
         SELECT l.id,l.type,l.parent_id,0 AS depth
         FROM target t JOIN asset.locations l
           ON l.tenant_id=t.tenant_id AND l.id=t.current_location_id
         UNION ALL
         SELECT parent.id,parent.type,parent.parent_id,child.depth+1
         FROM location_chain child JOIN asset.locations parent
           ON parent.id=child.parent_id
         JOIN target t ON parent.tenant_id=t.tenant_id
         WHERE child.depth<32
       )
       SELECT t.tenant_id,t.agent_id,t.current_location_id AS location_id,
         (SELECT id FROM location_chain WHERE type='SITE' ORDER BY depth DESC LIMIT 1) AS site_id,
         (SELECT array_agg(id) FROM location_chain) AS location_path
       FROM target t`,
      [input.tenantId, input.targetId],
    );
    const row = rows.rows[0];
    if (!row || row.tenant_id !== input.tenantId || !row.site_id) return null;
    await this.tx.query(
      "SELECT id FROM asset.locations WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE",
      [input.tenantId, row.location_path],
    );
    return {
      tenantId: row.tenant_id,
      targetType: "AGENT",
      targetId: row.agent_id,
      scope: {
        site: row.site_id,
        ...(row.location_id ? { location: row.location_id } : {}),
      },
      scopeReference: `SITE:${row.site_id}`,
    };
  }

  async decide(input: {
    tenantId: string;
    safetyLevel: string;
    requiresApproval: boolean;
    action: ActionDescriptor;
    capability: ActionCapability;
    target: AutomationTargetContext;
    correlationId: string;
  }): Promise<{
    decision: PolicyDecision;
    reasonCode: string;
    policyId: string | null;
    policyVersion: number | null;
    approvalRequired: boolean;
  }> {
    const denied = (
      reasonCode: string,
      policyId: string | null = null,
      policyVersion: number | null = null,
    ) => ({
      decision: "DENY" as const,
      reasonCode,
      policyId,
      policyVersion,
      approvalRequired: false,
    });
    if (
      input.tenantId !== this.tx.tenantId ||
      input.target.tenantId !== input.tenantId ||
      input.target.targetType !== input.capability.target_type ||
      input.target.targetId !== input.action.target_id
    )
      return denied("AUTOMATION_TARGET_TENANT_OR_ID_MISMATCH");
    if (
      input.capability.safety_class === "PROHIBITED" ||
      !input.capability.automatic_execution_supported ||
      !input.capability.executor_type
    )
      return denied("AUTOMATION_ACTION_NOT_EXECUTABLE");
    const policies = await this.tx.query<{
      id: string;
      version: number;
      mode: PolicyDecision;
      resource_scope_json: unknown;
      parameter_constraints_json: unknown;
      approval_required: boolean;
      effective_from: Date;
      effective_to: Date | null;
    }>(
      `SELECT id,version,mode,resource_scope_json,parameter_constraints_json,
              approval_required,effective_from,effective_to
       FROM automation.action_policies
       WHERE tenant_id=$1 AND action_type=$2 AND target_type=$3 AND state='ACTIVE'
       ORDER BY version DESC FOR SHARE`,
      [
        input.tenantId,
        input.capability.action_type,
        input.capability.target_type,
      ],
    );
    if (!policies.rowCount) return denied("AUTOMATION_POLICY_NOT_CONFIGURED");
    if (policies.rowCount !== 1) return denied("AUTOMATION_POLICY_AMBIGUOUS");
    const policy = policies.rows[0]!;
    const now = Date.now();
    if (
      new Date(policy.effective_from).getTime() > now ||
      (policy.effective_to && new Date(policy.effective_to).getTime() <= now)
    )
      return denied(
        "AUTOMATION_POLICY_NOT_EFFECTIVE",
        policy.id,
        policy.version,
      );
    if (
      !matchesScopeSelector(policy.resource_scope_json, input.target) ||
      !matchesParameterConstraints(
        policy.parameter_constraints_json,
        input.action.parameters,
      )
    )
      return denied(
        "AUTOMATION_POLICY_CONSTRAINT_DENIED",
        policy.id,
        policy.version,
      );
    if (policy.mode === "DENY")
      return denied("AUTOMATION_POLICY_DENIED", policy.id, policy.version);
    if (
      (input.capability.safety_class === "HIGH_RISK" ||
        input.safetyLevel === "HIGH_RISK") &&
      policy.mode === "ALLOW" &&
      !policy.approval_required
    )
      return denied(
        "AUTOMATION_HIGH_RISK_APPROVAL_REQUIRED",
        policy.id,
        policy.version,
      );
    const approvalRequired =
      policy.mode === "REQUIRE_APPROVAL" ||
      policy.approval_required ||
      input.capability.approval_required ||
      input.requiresApproval ||
      input.safetyLevel === "HIGH_RISK";
    return {
      decision: approvalRequired ? "REQUIRE_APPROVAL" : "ALLOW",
      reasonCode: approvalRequired
        ? "AUTOMATION_APPROVAL_REQUIRED"
        : "AUTOMATION_POLICY_ALLOWED",
      policyId: policy.id,
      policyVersion: policy.version,
      approvalRequired,
    };
  }

  async authorize(input: {
    tenantId: string;
    capability: ActionCapability;
    target: AutomationTargetContext;
    correlationId: string;
  }): Promise<{
    allowed: boolean;
    reasonCode: string;
    principalId: string | null;
    permission: string;
    scopeReference: string | null;
  }> {
    const result = {
      allowed: false,
      reasonCode: "AUTOMATION_PRINCIPAL_NOT_CONFIGURED",
      principalId: null as string | null,
      permission: input.capability.required_permission,
      scopeReference: input.target.scopeReference,
    };
    if (
      input.tenantId !== this.tx.tenantId ||
      input.target.tenantId !== input.tenantId ||
      input.target.targetType !== input.capability.target_type
    )
      return { ...result, reasonCode: "AUTOMATION_TENANT_SCOPE_DENIED" };
    const principals = await this.tx.query<{ id: string }>(
      `SELECT id FROM identity.automation_principals
       WHERE tenant_id=$1 AND principal_type='SYSTEM_AUTOMATION'
         AND service_identity=$2 AND active=true FOR SHARE`,
      [input.tenantId, SERVICE_IDENTITY],
    );
    if ((principals.rowCount ?? 0) !== 1)
      return {
        ...result,
        reasonCode:
          (principals.rowCount ?? 0) > 1
            ? "AUTOMATION_PRINCIPAL_AMBIGUOUS"
            : "AUTOMATION_PRINCIPAL_NOT_CONFIGURED",
      };
    const principalId = principals.rows[0]!.id;
    const request: AuthorizationRequest = {
      principal: {
        id: principalId,
        tenant_id: input.tenantId,
        actor_type: "SYSTEM_AUTOMATION",
      },
      action: input.capability.required_permission,
      resource: {
        type: input.capability.target_type.toLowerCase(),
        id: input.target.targetId,
        tenant_id: input.target.tenantId,
      },
      scope: input.target.scope,
      context: {
        correlation_id: input.correlationId,
        action_type: input.capability.action_type,
        target_type: input.target.targetType,
        target_id: input.target.targetId,
        scope_reference: input.target.scopeReference,
      },
    };
    const thisTx = this.tx;
    const port: AuthorizationPort = {
      async evaluate(authorizationRequest) {
        const decision = await evaluateAuthorization(thisTx, {
          principalId: authorizationRequest.principal.id,
          principalType: "SYSTEM_AUTOMATION",
          tenantId: authorizationRequest.principal.tenant_id,
          action: authorizationRequest.action,
          resourceType: authorizationRequest.resource.type,
          resourceId: authorizationRequest.resource.id,
          scope: authorizationRequest.scope,
        });
        return {
          result: decision.result,
          reason: decision.reason,
          ...(decision.matched
            ? {
                scope_reference: `${decision.matched.scopeType}:${decision.matched.scopeId}`,
              }
            : {}),
        };
      },
    };
    const authorization = await port.evaluate(request);
    return {
      allowed: authorization.result === "ALLOW",
      reasonCode:
        authorization.result === "ALLOW"
          ? "AUTOMATION_PRINCIPAL_AUTHORIZED"
          : "AUTOMATION_PRINCIPAL_SCOPE_OR_PERMISSION_DENIED",
      principalId,
      permission: input.capability.required_permission,
      scopeReference:
        authorization.scope_reference ?? input.target.scopeReference,
    };
  }
}
