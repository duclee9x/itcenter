import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import type { Config } from "../../../packages/config/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  activateRule,
  createRule,
  deactivateRule,
  denyUnconfiguredAutomationPolicy,
  denyUnconfiguredAutomationPrincipal,
  getIntent,
  publishVersion,
  resolveConflict,
  simulateRule,
  setScopedKillSwitch,
  updateDraft,
  type RuleDefinition,
} from "../../../modules/automation/index.js";
import { recordAutomationTimelineEvent } from "../../../modules/work-queue/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Body = Record<string, unknown>;
async function readBody(req: IncomingMessage): Promise<Body> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 65536)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
  }
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw 0;
    return value as Body;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}
function key(req: IncomingMessage) {
  const value = req.headers["idempotency-key"];
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return value.trim();
}
function expected(body: Body) {
  if (
    !Number.isSafeInteger(body.expected_version) ||
    Number(body.expected_version) < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version must be a positive integer.",
    );
  return Number(body.expected_version);
}
function definition(body: Body): RuleDefinition {
  return {
    name: String(body.name ?? ""),
    ...(Number.isSafeInteger(body.priority)
      ? { priority: Number(body.priority) }
      : {}),
    ownerUserId: String(body.owner_user_id ?? ""),
    ownerTeamId: String(body.owner_team_id ?? ""),
    purpose: String(body.purpose ?? ""),
    reviewDate: String(body.review_date ?? ""),
    trigger: body.trigger as RuleDefinition["trigger"],
    condition: body.condition,
    action: body.action as RuleDefinition["action"],
    safetyLevel: String(body.safety_level) as RuleDefinition["safetyLevel"],
    requiresApproval: body.requires_approval === true,
  };
}
function auditAndEvent(input: {
  tx: Parameters<typeof createRule>[0];
  config: Config;
  tenantId: string;
  actor: { id: string; actor_type: string };
  context: CorrelationContext;
  key: string;
  type: string;
  aggregateId: string;
  version: number;
  payload: Record<string, unknown>;
  reason?: string;
}) {
  const now = new Date().toISOString();
  const eventId = randomUUID();
  return (async () => {
    await new PostgresOutboxWriter(input.tx).append({
      event_id: eventId,
      event_type: input.type,
      schema_version: 1,
      occurred_at: now,
      producer: { service: input.config.serviceName, instance: "api" },
      aggregate: {
        type: "AUTOMATION_RULE",
        id: input.aggregateId,
        version: input.version,
      },
      actor: { type: input.actor.actor_type, id: input.actor.id },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      tenant_id: input.tenantId,
      organization_id: input.tenantId,
      idempotency_key: input.key,
      payload: input.payload as never,
    });
    await new PostgresAudit(input.tx).append({
      id: randomUUID(),
      tenant_id: input.tenantId,
      event_type: input.type,
      occurred_at: now,
      actor: { type: input.actor.actor_type, id: input.actor.id },
      action: { command_type: input.type },
      subject: { entity_type: "AUTOMATION_RULE", entity_id: input.aggregateId },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      reason: { code: input.type, text: input.reason ?? input.type },
      before: null,
      after: input.payload as never,
      outcome: { status: "SUCCESS" },
      classification: "INTERNAL",
      relations: [],
      evidence: [],
    });
    if (
      input.type !== "AUTOMATION.RULE_SIMULATED" &&
      input.type !== "AUTOMATION.KILL_SWITCH_CHANGED"
    )
      await recordAutomationTimelineEvent({
        tx: input.tx,
        entityType: "AUTOMATION_RULE",
        entityId: input.aggregateId,
        eventType: input.type,
        summary:
          input.type === "AUTOMATION.RULE_ACTIVATED"
            ? `Automation rule ${input.aggregateId} activated`
            : input.type === "AUTOMATION.RULE_DEACTIVATED"
              ? `Automation rule ${input.aggregateId} deactivated`
              : `Automation rule ${input.aggregateId} changed`,
        payload: input.payload,
        sourceEventId: eventId,
      });
  })();
}
function auditIntent(input: {
  tx: Parameters<typeof getIntent>[0];
  tenantId: string;
  actor: { id: string; actor_type: string };
  context: CorrelationContext;
  type: string;
  id: string;
  key: string;
  payload: Record<string, unknown>;
  reason: string;
}) {
  const now = new Date().toISOString();
  const eventId = randomUUID();
  return (async () => {
    await new PostgresOutboxWriter(input.tx).append({
      event_id: eventId,
      event_type: input.type,
      schema_version: 1,
      occurred_at: now,
      producer: { service: "itcenter-api", instance: "api" },
      aggregate: { type: "AUTOMATION_CONFLICT", id: input.id, version: 1 },
      actor: { type: input.actor.actor_type, id: input.actor.id },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      tenant_id: input.tenantId,
      organization_id: input.tenantId,
      idempotency_key: input.key,
      payload: input.payload as never,
    });
    await new PostgresAudit(input.tx).append({
      id: randomUUID(),
      tenant_id: input.tenantId,
      event_type: input.type,
      occurred_at: now,
      actor: { type: input.actor.actor_type, id: input.actor.id },
      action: { command_type: input.type },
      subject: { entity_type: "AUTOMATION_CONFLICT", entity_id: input.id },
      correlation_id: input.context.correlation_id,
      causation_id: input.context.causation_id,
      reason: { code: input.type, text: input.reason },
      before: null,
      after: input.payload as never,
      outcome: { status: "SUCCESS" },
      classification: "INTERNAL",
      relations: [],
      evidence: [],
    });
    await recordAutomationTimelineEvent({
      tx: input.tx,
      entityType: "AUTOMATION_CONFLICT",
      entityId: input.id,
      eventType: input.type,
      summary: "Automation intent conflict was explicitly resolved",
      payload: input.payload,
      sourceEventId: eventId,
    });
  })();
}
function permission(method: string, operation: string) {
  if (operation === "conflict-read") return "automation.intent.read";
  if (method === "GET")
    return operation === "intent"
      ? "automation.intent.read"
      : "automation.rule.read";
  if (operation === "create") return "automation.rule.create";
  if (operation === "simulate") return "automation.simulate";
  if (operation === "activate") return "automation.activate_low_risk";
  if (operation === "deactivate") return "automation.disable";
  if (operation === "resolve") return "automation.intent.resolve";
  if (operation === "kill-switch") return "automation.disable";
  return "automation.rule.edit";
}

export async function handleAutomationRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}): Promise<boolean> {
  const req = input.req;
  const method = req.method ?? "GET";
  const pathname = req.url?.split("?")[0] ?? "";
  const create = method === "POST" && pathname === "/api/v1/automation-rules";
  const rulesList = method === "GET" && pathname === "/api/v1/automation-rules";
  const ruleMatch =
    method === "GET"
      ? pathname.match(/^\/api\/v1\/automation-rules\/([0-9a-f-]{36})$/i)
      : null;
  const command = pathname.match(
    /^\/api\/v1\/automation-rules\/([0-9a-f-]{36})\/commands\/(update-draft|publish|activate|deactivate|simulate)$/i,
  );
  const intent =
    method === "GET"
      ? pathname.match(/^\/api\/v1\/action-intents\/([0-9a-f-]{36})$/i)
      : null;
  const conflict = pathname.match(
    /^\/api\/v1\/automation-conflicts\/([0-9a-f-]{36})\/commands\/resolve$/i,
  );
  const conflictRead =
    method === "GET"
      ? pathname.match(/^\/api\/v1\/automation-conflicts\/([0-9a-f-]{36})$/i)
      : null;
  const killSwitch =
    method === "POST" && pathname === "/api/v1/automation/kill-switch";
  if (!(
    create ||
    rulesList ||
    ruleMatch ||
    command ||
    intent ||
    conflict ||
    conflictRead ||
    killSwitch
  ))
    return false;
  const principal = await authenticate(
    input.authentication,
    req.headers.authorization,
  );
  const operation = create
    ? "create"
    : (command?.[2] ??
      (intent
        ? "intent"
        : conflict
          ? "resolve"
          : conflictRead
            ? "conflict-read"
            : killSwitch
              ? "kill-switch"
              : "read"));
  const resourceType = intent
    ? "action_intent"
    : conflict || conflictRead
      ? "automation_conflict"
      : "automation_rule";
  const resourceId =
    command?.[1] ??
    ruleMatch?.[1] ??
    intent?.[1] ??
    conflict?.[1] ??
    conflictRead?.[1] ??
    "collection";
  await authorize(input.authorization, {
    principal,
    action: permission(method, operation),
    resource: {
      type: resourceType,
      id: resourceId,
      tenant_id: principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
  const body = method === "POST" ? await readBody(req) : {};
  if (rulesList) {
    const value = await input.uow.run(principal.tenant_id, async (tx) => {
      const rows = await tx.query(
        "SELECT id,code,name,state,entity_version,active_version_id,draft_version_id,owner_user_id,owner_team_id,purpose,review_date FROM automation.rules WHERE tenant_id=$1 ORDER BY code",
        [principal.tenant_id],
      );
      return rows.rows;
    });
    json(input.res, 200, { data: value, meta: input.context });
    return true;
  }
  if (ruleMatch) {
    const value = await input.uow.run(principal.tenant_id, async (tx) => {
      const row = await tx.query(
        "SELECT r.*,COALESCE(jsonb_agg(jsonb_build_object('version',v.version,'state',v.state,'trigger',v.trigger_json,'condition',v.condition_json,'action',v.action_json,'priority',v.priority,'safety_level',v.safety_level,'content_hash',v.content_hash) ORDER BY v.version),'[]'::jsonb) AS versions FROM automation.rules r LEFT JOIN automation.rule_versions v ON v.tenant_id=r.tenant_id AND v.rule_id=r.id WHERE r.tenant_id=$1 AND r.id=$2 GROUP BY r.id",
        [principal.tenant_id, ruleMatch[1]],
      );
      if (!row.rowCount)
        throw new ApplicationError(
          "NOT_FOUND",
          "Automation rule was not found.",
        );
      return row.rows[0];
    });
    json(input.res, 200, { data: value, meta: input.context });
    return true;
  }
  if (intent) {
    const value = await input.uow.run(principal.tenant_id, (tx) =>
      getIntent(tx, intent[1]!),
    );
    json(input.res, 200, { data: value, meta: input.context });
    return true;
  }
  if (conflictRead) {
    const value = await input.uow.run(principal.tenant_id, async (tx) => {
      const row = await tx.query(
        `SELECT c.*,COALESCE(jsonb_agg(jsonb_build_object('intent_id',i.id,'state',i.state,'policy_decision',i.policy_decision,'target_type',i.target_type,'target_id',i.target_id,'action_type',i.action_type,'desired_state',i.desired_state)) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) AS intents
        FROM automation.intent_conflicts c LEFT JOIN automation.intent_conflict_members m ON m.tenant_id=c.tenant_id AND m.conflict_id=c.id LEFT JOIN automation.action_intents i ON i.tenant_id=m.tenant_id AND i.id=m.action_intent_id
        WHERE c.tenant_id=$1 AND c.id=$2 GROUP BY c.id`,
        [principal.tenant_id, conflictRead[1]],
      );
      if (!row.rowCount)
        throw new ApplicationError(
          "NOT_FOUND",
          "Automation conflict was not found.",
        );
      return row.rows[0];
    });
    json(input.res, 200, { data: value, meta: input.context });
    return true;
  }
  const idempotencyKey = key(req);
  const result = await input.uow.run(principal.tenant_id, async (tx) =>
    new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: `AUTOMATION.${operation.toUpperCase()}`,
        businessScope: resourceId,
        key: idempotencyKey,
        semanticRequest: body as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        let value: Record<string, unknown>;
        let eventType: string;
        let aggregateId: string;
        if (create) {
          value = await createRule(tx, {
            code: String(body.code ?? ""),
            actorId: principal.id,
            definition: definition(body),
          });
          eventType = "AUTOMATION.RULE_CREATED";
          aggregateId = String(value.id);
        } else if (command?.[2] === "update-draft") {
          value = await updateDraft(tx, {
            ruleId: command[1]!,
            expectedVersion: expected(body),
            actorId: principal.id,
            definition: definition(body),
          });
          eventType = "AUTOMATION.RULE_DRAFT_UPDATED";
          aggregateId = command[1]!;
        } else if (command?.[2] === "publish") {
          value = await publishVersion(tx, {
            ruleId: command[1]!,
            expectedVersion: expected(body),
            actorId: principal.id,
          });
          eventType = "AUTOMATION.RULE_VERSION_PUBLISHED";
          aggregateId = command[1]!;
        } else if (command?.[2] === "activate") {
          const safety = await tx.query<{ safety_level: string }>(
            "SELECT safety_level FROM automation.rule_versions WHERE tenant_id=$1 AND rule_id=$2 AND version=$3 AND state='PUBLISHED'",
            [principal.tenant_id, command[1], Number(body.rule_version)],
          );
          if (!safety.rowCount)
            throw new ApplicationError(
              "NOT_FOUND",
              "Published version not found.",
            );
          if (safety.rows[0]!.safety_level === "HIGH_RISK")
            await authorize(input.authorization, {
              principal,
              action: "automation.activate_high_risk",
              resource: {
                type: "automation_rule",
                id: command[1]!,
                tenant_id: principal.tenant_id,
              },
              scope: {},
              context: { ...input.context },
            });
          value = await activateRule(tx, {
            ruleId: command[1]!,
            ruleVersion: Number(body.rule_version),
            expectedVersion: expected(body),
            actorId: principal.id,
            ...(typeof body.approval_id === "string"
              ? { approvalId: body.approval_id }
              : {}),
          });
          eventType = "AUTOMATION.RULE_ACTIVATED";
          aggregateId = command[1]!;
        } else if (command?.[2] === "deactivate") {
          value = await deactivateRule(tx, {
            ruleId: command[1]!,
            expectedVersion: expected(body),
          });
          eventType = "AUTOMATION.RULE_DEACTIVATED";
          aggregateId = command[1]!;
        } else if (killSwitch) {
          const scopeType = String(body.scope_type);
          if (!(["GLOBAL", "CATEGORY", "RULE"] as string[]).includes(scopeType))
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "scope_type must be GLOBAL, CATEGORY or RULE.",
            );
          const scopeKey =
            scopeType === "GLOBAL" ? "*" : String(body.scope_key ?? "");
          if (!scopeKey || scopeKey === "undefined")
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "scope_key is required for category and rule kill switches.",
            );
          if (typeof body.enabled !== "boolean")
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "enabled must be a boolean.",
            );
          await setScopedKillSwitch({
            tx,
            scopeType: scopeType as "GLOBAL" | "CATEGORY" | "RULE",
            scopeKey,
            enabled: body.enabled,
            actorId: principal.id,
            reason: String(body.reason ?? ""),
          });
          value = {
            scope_type: scopeType,
            scope_key: scopeKey,
            enabled: body.enabled,
          };
          eventType = "AUTOMATION.KILL_SWITCH_CHANGED";
          aggregateId = scopeType === "RULE" ? scopeKey : randomUUID();
        } else if (command?.[2] === "simulate") {
          const event = body.event as Record<string, unknown> | undefined;
          if (
            !event ||
            typeof event.event_type !== "string" ||
            typeof event.payload !== "object" ||
            event.payload === null ||
            Array.isArray(event.payload)
          )
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "Simulation requires an event_type and payload.",
            );
          value = await simulateRule(tx, {
            ruleId: command[1]!,
            ...(Number.isSafeInteger(body.rule_version)
              ? { ruleVersion: Number(body.rule_version) }
              : {}),
            eventType: event.event_type,
            ...(typeof event.event_id === "string"
              ? { eventId: event.event_id }
              : {}),
            payload: event.payload as Record<string, unknown>,
            context: (body.context && typeof body.context === "object"
              ? body.context
              : {}) as Record<string, unknown>,
            authorization: denyUnconfiguredAutomationPrincipal,
            policy: denyUnconfiguredAutomationPolicy,
          });
          eventType = "AUTOMATION.RULE_SIMULATED";
          aggregateId = command[1]!;
        } else if (conflict) {
          const selected = Array.isArray(body.selected_intent_ids)
            ? body.selected_intent_ids.filter(
                (v): v is string => typeof v === "string",
              )
            : [];
          value = await resolveConflict(tx, {
            conflictId: conflict[1]!,
            expectedVersion: expected(body),
            actorId: principal.id,
            reason: String(body.reason ?? ""),
            selectedIntentIds: selected,
            authorization: denyUnconfiguredAutomationPrincipal,
          });
          eventType = "AUTOMATION.INTENT_CONFLICT_RESOLVED";
          aggregateId = conflict[1]!;
        } else
          throw new ApplicationError(
            "NOT_FOUND",
            "Unsupported automation command.",
          );
        if (eventType === "AUTOMATION.INTENT_CONFLICT_RESOLVED")
          await auditIntent({
            tx,
            tenantId: principal.tenant_id,
            actor: principal,
            context: input.context,
            type: eventType,
            id: aggregateId,
            key: idempotencyKey,
            payload: value,
            reason: String(body.reason),
          });
        else
          await auditAndEvent({
            tx,
            config: input.config,
            tenantId: principal.tenant_id,
            actor: principal,
            context: input.context,
            key: idempotencyKey,
            type: eventType,
            aggregateId,
            version: Number(value.entity_version ?? value.version ?? 1),
            payload: value,
            ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
          });
        return { status: create ? 201 : 200, body: value as never };
      },
    ),
  );
  json(input.res, result.status, { data: result.body, meta: input.context });
  return true;
}
