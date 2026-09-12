import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import {
  authenticate,
  authorize,
  requireStepUpMfa,
  type AuthenticationPort,
  type AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import type {
  UnitOfWork,
  Transaction,
} from "../../../packages/persistence/src/index.js";
import { OperationRegistry } from "../../../packages/persistence/src/operations.js";
import {
  ApplicationError,
  assertVersion,
} from "../../../packages/api-contracts/src/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import { json } from "../../../packages/observability/src/index.js";
import type { Json } from "../../../packages/shared-kernel/src/index.js";
import {
  upsertAssetLifecycleWorkItem,
  resolveAssetLifecycleWorkItem,
} from "../../../modules/work-queue/index.js";
import { assignAsset, reserveAsset } from "../../../modules/asset/index.js";

type Context = { correlation_id: string; causation_id: string };
type Principal = {
  id: string;
  tenant_id: string;
  actor_type: string;
  auth_time?: number;
  acr?: string;
  amr?: readonly string[];
};
type Input = Record<string, unknown>;

async function readBody(req: IncomingMessage): Promise<Input> {
  const raw = await new Promise<string>((resolve, reject) => {
    let value = "";
    req.on("data", (part) => {
      value += part;
      if (value.length > 1_048_576)
        reject(
          new ApplicationError(
            "VALIDATION_ERROR",
            "Request body is too large.",
          ),
        );
    });
    req.on("error", reject);
    req.on("end", () => resolve(value));
  });
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Input;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}
function requiredString(input: Input, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
}
function version(input: Input): number {
  if (
    !Number.isSafeInteger(input.expected_version) ||
    Number(input.expected_version) < 1
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "expected_version is required.",
    );
  return Number(input.expected_version);
}
function requireRecentAuthentication(
  principal: Principal,
  maxAgeSeconds: number,
): void {
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(principal.auth_time) ||
    principal.auth_time! > now ||
    now - principal.auth_time! > maxAgeSeconds
  )
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Recent re-authentication is required.",
    );
}
function assertApproval(
  row: { rowCount: number | null; rows: Record<string, unknown>[] },
  expectedContext: Record<string, unknown> = {},
): void {
  if (!row.rowCount || row.rows[0]!.state !== "APPROVED")
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "A matching approved request is required.",
    );
  if (
    !row.rows[0]!.approved_by ||
    row.rows[0]!.requested_by === row.rows[0]!.approved_by
  )
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "An independent approval decision is required.",
    );
  const context = row.rows[0]!.context;
  if (!context || typeof context !== "object" || Array.isArray(context))
    throw new ApplicationError(
      "BUSINESS_RULE_VIOLATION",
      "Approval context is missing its decision evidence.",
    );
  for (const [key, value] of Object.entries(expectedContext))
    if (
      canonicalJson((context as Record<string, unknown>)[key]) !==
      canonicalJson(value)
    )
      throw new ApplicationError(
        "BUSINESS_RULE_VIOLATION",
        `Approval does not attest ${key}.`,
      );
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
async function eventAudit(input: {
  tx: Transaction;
  config: Config;
  principal: Principal;
  context: Context;
  key: string;
  event: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  command: string;
  reason: string;
  before: unknown;
  after: unknown;
}): Promise<void> {
  const now = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: input.event,
    schema_version: 1,
    occurred_at: now,
    producer: { service: input.config.serviceName, instance: "api" },
    aggregate: {
      type: input.aggregateType,
      id: input.aggregateId,
      version: input.aggregateVersion,
    },
    actor: { type: input.principal.actor_type, id: input.principal.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    tenant_id: input.principal.tenant_id,
    organization_id: input.principal.tenant_id,
    idempotency_key: input.key,
    payload: input.after as { [key: string]: Json },
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.event,
    occurred_at: now,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.command },
    subject: { entity_type: input.aggregateType, entity_id: input.aggregateId },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.command, text: input.reason },
    before: input.before as Json,
    after: input.after as Json,
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
  await input.tx.query(
    "INSERT INTO operations.timeline_events(id,tenant_id,entity_type,entity_id,event_type,summary,payload,source_event_id) VALUES($1,$2,'ASSET',$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,source_event_id) DO NOTHING",
    [
      randomUUID(),
      input.principal.tenant_id,
      input.aggregateId,
      input.event,
      `${input.command}: ${input.reason}`,
      JSON.stringify(input.after),
      randomUUID(),
    ],
  );
}
async function queue(
  tx: Transaction,
  sourceId: string,
  title: string,
  priority = "HIGH",
) {
  await upsertAssetLifecycleWorkItem({ tx, sourceId, title, priority });
}
async function resolveQueue(tx: Transaction, sourceId: string) {
  await resolveAssetLifecycleWorkItem({ tx, sourceId });
}
async function notify(input: {
  tx: Transaction;
  recipientId: string;
  eventType: string;
  subject: string;
  body: string;
  dedupeKey: string;
}) {
  await input.tx.query(
    "INSERT INTO communication.notifications(id,tenant_id,recipient_user_id,event_type,subject,body,dedupe_key) SELECT $1,$2,u.id,$3,$4,$5,$6 FROM identity.users u WHERE u.tenant_id=$2 AND u.id=$7 AND u.employment_status IN ('ACTIVE','TERMINATING') ON CONFLICT(tenant_id,dedupe_key) DO NOTHING",
    [
      randomUUID(),
      input.tx.tenantId,
      input.eventType,
      input.subject,
      input.body,
      input.dedupeKey,
      input.recipientId,
    ],
  );
}
async function permission(input: {
  authorization: AuthorizationPort;
  principal: Principal;
  action: string;
  id: string;
  context: Context;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: {
      type: input.action.startsWith("replacement.")
        ? "replacement"
        : input.action.startsWith("data_wipe.")
          ? "data_wipe"
          : "asset",
      id: input.id,
      tenant_id: input.principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
}

export async function handleAssetLifecycleRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: Context;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}): Promise<boolean> {
  const { req, res, context, config, authentication, authorization, uow } =
    input;
  const path = req.url ?? "";
  const replacementCreate =
    path === "/api/v1/replacements" && req.method === "POST";
  const replacementCommand =
    /^\/api\/v1\/replacements\/([^/]+)\/commands\/(review|plan|mark-new-asset-ready|start-migration|complete-migration)$/.exec(
      path,
    );
  const retirementCandidate =
    /^\/api\/v1\/assets\/([^/]+)\/retirement-candidates$/.exec(path);
  const retire = /^\/api\/v1\/assets\/([^/]+)\/commands\/retire$/.exec(path);
  const wipe = /^\/api\/v1\/assets\/([^/]+)\/commands\/wipe$/.exec(path);
  const disposal = /^\/api\/v1\/assets\/([^/]+)\/commands\/dispose$/.exec(path);
  const reactivate = /^\/api\/v1\/assets\/([^/]+)\/commands\/reactivate$/.exec(
    path,
  );
  if (!(
    replacementCreate ||
    replacementCommand ||
    retirementCandidate ||
    retire ||
    wipe ||
    disposal ||
    reactivate
  ))
    return false;
  if (req.method !== "POST") return false;
  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  const body = await readBody(req);
  const reason = requiredString(body, "reason");
  if (wipe)
    requireStepUpMfa(principal, {
      requiredAcr: config.networkChangeRequiredAcr,
      maxAgeSeconds: config.networkChangeMaxAuthAgeSeconds,
    });
  if (disposal)
    requireRecentAuthentication(
      principal,
      config.networkChangeMaxAuthAgeSeconds,
    );
  const id =
    replacementCommand?.[1] ??
    retirementCandidate?.[1] ??
    retire?.[1] ??
    wipe?.[1] ??
    disposal?.[1] ??
    reactivate?.[1] ??
    String(body.asset_id ?? "new");
  const action = replacementCreate
    ? "replacement.create_candidate"
    : replacementCommand
      ? replacementCommand[2] === "review"
        ? "replacement.review"
        : "replacement.create_candidate"
      : retirementCandidate || retire
        ? "asset.retire"
        : wipe
          ? "data_wipe.execute"
          : disposal
            ? "asset.dispose"
            : "asset.reactivate";
  await permission({ authorization, principal, action, id, context });
  const expected = [
    replacementCommand,
    retire,
    wipe,
    disposal,
    reactivate,
  ].some(Boolean)
    ? version(body)
    : null;
  const operation = replacementCreate
    ? "REPLACEMENT.CREATE_CANDIDATE"
    : replacementCommand
      ? `REPLACEMENT.${replacementCommand[2]!.replaceAll("-", "_").toUpperCase()}`
      : retirementCandidate
        ? "RETIREMENT.CANDIDATE_CREATED"
        : retire
          ? "ASSET.RETIRE"
          : wipe
            ? "DATA_WIPE.START"
            : disposal
              ? "ASSET.DISPOSE"
              : "ASSET.REACTIVATE";
  const result = await uow.run(principal.tenant_id, (tx) =>
    new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation,
        businessScope: id,
        key,
        semanticRequest: body as Json,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        const now = new Date().toISOString();
        let value: Record<string, unknown>;
        let event: string;
        let aggregateType: string;
        let aggregateId: string;
        let aggregateVersion: number;
        let status = 200;
        let before: unknown = null;
        let replacementAssignment: Awaited<
          ReturnType<typeof assignAsset>
        > | null = null;
        let replacementReservation: Awaited<
          ReturnType<typeof reserveAsset>
        > | null = null;
        let verificationEvidence: string | null = null;
        const additionalEvents: {
          event: string;
          aggregateType?: string;
          aggregateId: string;
          aggregateVersion: number;
          payload: Record<string, unknown>;
        }[] = [];
        if (replacementCreate) {
          const assetId = requiredString(body, "asset_id");
          const asset = await tx.query(
            "SELECT id FROM asset.assets WHERE tenant_id=$1 AND id=$2 AND lifecycle_state NOT IN ('RETIRED','DISPOSED')",
            [tx.tenantId, assetId],
          );
          if (!asset.rowCount)
            throw new ApplicationError(
              "NOT_FOUND",
              "Eligible source asset was not found.",
            );
          if (
            !Array.isArray(body.reasons) ||
            !body.reasons.length ||
            !body.assessment ||
            typeof body.assessment !== "object"
          )
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "reasons and assessment evidence are required.",
            );
          const newId = randomUUID();
          await tx.query(
            "INSERT INTO asset.replacement_plans(id,tenant_id,asset_id,state,score,reasons,assessment,target_user_id,target_model,budget,target_date,procurement_required,migration_required,reason,created_by) VALUES($1,$2,$3,'UNDER_REVIEW',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            [
              newId,
              tx.tenantId,
              assetId,
              body.score ?? null,
              JSON.stringify(body.reasons),
              JSON.stringify(body.assessment),
              body.target_user_id ?? null,
              body.target_model ?? null,
              JSON.stringify(body.budget ?? null),
              body.target_date ?? null,
              body.procurement_required === true,
              body.migration_required !== false,
              reason,
              principal.id,
            ],
          );
          value = {
            id: newId,
            replacement_plan_id: newId,
            asset_id: assetId,
            state: "UNDER_REVIEW",
            version: 1,
            score: body.score ?? null,
            reasons: body.reasons,
          };
          await tx.query(
            "INSERT INTO asset.replacement_history(id,tenant_id,plan_id,entity_version,action,snapshot,actor_id,reason) VALUES($1,$2,$3,1,'CANDIDATE_CREATED',$4,$5,$6)",
            [
              randomUUID(),
              tx.tenantId,
              newId,
              JSON.stringify(value),
              principal.id,
              reason,
            ],
          );
          await queue(tx, newId, "Review replacement candidate");
          if (typeof body.target_user_id === "string")
            await notify({
              tx,
              recipientId: body.target_user_id,
              eventType: "REPLACEMENT.CANDIDATE_CREATED",
              subject: "Replacement review opened",
              body: "An asset replacement review has been opened for your assigned equipment.",
              dedupeKey: `replacement-candidate:${newId}:${body.target_user_id}`,
            });
          event = "REPLACEMENT.CANDIDATE_CREATED";
          aggregateType = "REPLACEMENT_PLAN";
          aggregateId = newId;
          aggregateVersion = 1;
          status = 201;
        } else if (replacementCommand) {
          const planId = replacementCommand[1]!;
          const command = replacementCommand[2]!;
          const selected = await tx.query(
            "SELECT * FROM asset.replacement_plans WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [tx.tenantId, planId],
          );
          if (!selected.rowCount)
            throw new ApplicationError(
              "NOT_FOUND",
              "Replacement plan was not found.",
            );
          const plan = selected.rows[0]!;
          assertVersion(plan.version, expected!);
          before = { state: plan.state, version: plan.version };
          const state = String(plan.state);
          let next = state;
          let actionName = command.toUpperCase();
          if (command === "review") {
            const decision = requiredString(body, "decision");
            if (
              ![
                "APPROVE_REPLACEMENT",
                "CONTINUE_USE",
                "REPAIR_FIRST",
                "EXTEND_WARRANTY",
                "DEFER",
              ].includes(decision)
            )
              throw new ApplicationError(
                "VALIDATION_ERROR",
                "Unsupported replacement decision.",
              );
            if (["APPROVE_REPLACEMENT"].includes(decision)) {
              if (!body.approval_id)
                throw new ApplicationError(
                  "BUSINESS_RULE_VIOLATION",
                  "Approval is required for replacement approval.",
                );
              const approval = await tx.query(
                "SELECT r.state,r.requested_by,r.context,(SELECT d.actor_id FROM control.approval_decisions d WHERE d.tenant_id=r.tenant_id AND d.request_id=r.id AND d.decision='APPROVED' ORDER BY d.created_at DESC LIMIT 1) AS approved_by FROM control.approval_requests r WHERE r.tenant_id=$1 AND r.id=$2 AND r.source_type='REPLACEMENT' AND r.source_id=$3",
                [tx.tenantId, body.approval_id, planId],
              );
              assertApproval(approval, {
                decision,
                replacement_plan_id: planId,
              });
            }
            next =
              decision === "DEFER"
                ? "UNDER_REVIEW"
                : decision === "APPROVE_REPLACEMENT"
                  ? "APPROVED"
                  : "CANCELLED";
            await tx.query(
              "UPDATE asset.replacement_plans SET state=$1,review_date=$2,risk_acceptance=$3,version=version+1,updated_at=now() WHERE tenant_id=$4 AND id=$5",
              [
                next,
                body.review_date ?? null,
                body.risk_acceptance ?? null,
                tx.tenantId,
                planId,
              ],
            );
            actionName = decision;
          } else if (command === "plan") {
            if (state !== "APPROVED")
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Only an approved candidate can be planned.",
              );
            if (plan.procurement_required) next = "PROCUREMENT";
            else next = "PLANNED";
            await tx.query(
              "UPDATE asset.replacement_plans SET target_user_id=COALESCE($1,target_user_id),target_model=COALESCE($2,target_model),budget=COALESCE($3,budget),target_date=COALESCE($4,target_date),version=version+1,updated_at=now(),state=$5 WHERE tenant_id=$6 AND id=$7",
              [
                body.target_user_id ?? null,
                body.target_model ?? null,
                body.budget ? JSON.stringify(body.budget) : null,
                body.target_date ?? null,
                next,
                tx.tenantId,
                planId,
              ],
            );
          } else if (command === "mark-new-asset-ready") {
            if (state !== "PLANNED")
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Replacement plan is not awaiting an asset.",
              );
            const newAssetId = requiredString(body, "new_asset_id");
            const newAsset = await tx.query(
              "SELECT lifecycle_state FROM asset.assets WHERE tenant_id=$1 AND id=$2",
              [tx.tenantId, newAssetId],
            );
            if (
              !newAsset.rowCount ||
              newAsset.rows[0]!.lifecycle_state !== "AVAILABLE"
            )
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Replacement asset must be available.",
              );
            await tx.query(
              "UPDATE asset.replacement_plans SET state='NEW_ASSET_READY',new_asset_id=$1,version=version+1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
              [newAssetId, tx.tenantId, planId],
            );
            next = "NEW_ASSET_READY";
          } else if (command === "start-migration") {
            if (state !== "NEW_ASSET_READY")
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "New asset is not ready for migration.",
              );
            await tx.query(
              "UPDATE asset.replacement_plans SET state='MIGRATING',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [tx.tenantId, planId],
            );
            next = "MIGRATING";
          } else {
            if (state !== "MIGRATING" || body.verified !== true)
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Verified cutover is required; source asset remains active.",
              );
            const newAsset = await tx.query(
              "SELECT lifecycle_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2",
              [tx.tenantId, plan.new_asset_id],
            );
            if (
              !newAsset.rowCount ||
              newAsset.rows[0]!.lifecycle_state !== "AVAILABLE" ||
              !plan.target_user_id
            )
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Replacement asset must remain available and a target user must be planned.",
              );
            const readiness =
              body.readiness && typeof body.readiness === "object"
                ? (body.readiness as Record<string, unknown>)
                : {};
            for (const required of ["software", "license", "network", "user"])
              if (readiness[required] !== true)
                throw new ApplicationError(
                  "BUSINESS_RULE_VIOLATION",
                  `Replacement ${required} readiness verification is required.`,
                );
            verificationEvidence = requiredString(
              body,
              "verification_evidence_id",
            );
            replacementReservation = await reserveAsset({
              tx,
              assetId: String(plan.new_asset_id),
              expectedVersion: Number(newAsset.rows[0]!.version),
              requestedFor: String(plan.target_user_id),
              reason,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
              actorType: principal.actor_type,
              actorId: principal.id,
              correlationId: context.correlation_id,
            });
            replacementAssignment = await assignAsset({
              tx,
              assetId: String(plan.new_asset_id),
              expectedVersion: replacementReservation.version,
              userId: String(plan.target_user_id),
              reason,
              actorType: principal.actor_type,
              actorId: principal.id,
              correlationId: context.correlation_id,
            });
            await tx.query(
              "UPDATE asset.replacement_plans SET state='REPLACED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [tx.tenantId, planId],
            );
            next = "REPLACED";
          }
          const v = Number(plan.version) + 1;
          value = {
            id: planId,
            replacement_plan_id: planId,
            asset_id: plan.asset_id,
            old_asset_id: plan.asset_id,
            new_asset_id: plan.new_asset_id ?? body.new_asset_id ?? null,
            state: next,
            version: v,
            decision: body.decision ?? null,
            approved_by:
              command === "review" && body.decision === "APPROVE_REPLACEMENT"
                ? principal.id
                : null,
            target_user_id: body.target_user_id ?? plan.target_user_id ?? null,
            target_model: body.target_model ?? plan.target_model ?? null,
            budget: body.budget ?? plan.budget ?? null,
            target_date: body.target_date ?? plan.target_date ?? null,
            procurement_required: plan.procurement_required,
            migration_required: plan.migration_required,
            completed_at: next === "REPLACED" ? now : null,
            reviewed_by: command === "review" ? principal.id : null,
            reason,
            review_date: body.review_date ?? null,
            risk_acceptance: body.risk_acceptance ?? null,
            verification_evidence_id:
              command === "complete-migration" ? verificationEvidence : null,
          };
          if (replacementReservation)
            additionalEvents.push({
              event: "ASSET.RESERVED",
              aggregateType: "ASSET",
              aggregateId: replacementReservation.asset_id,
              aggregateVersion: replacementReservation.version,
              payload: replacementReservation,
            });
          if (replacementAssignment)
            additionalEvents.push({
              event: "ASSET.ASSIGNED",
              aggregateType: "ASSET",
              aggregateId: replacementAssignment.asset_id,
              aggregateVersion: replacementAssignment.version,
              payload: replacementAssignment,
            });
          if (replacementAssignment)
            await notify({
              tx,
              recipientId: String(plan.target_user_id),
              eventType: "REPLACEMENT.COMPLETED",
              subject: "Replacement device ready",
              body: "Your replacement device is assigned and cutover verification is complete.",
              dedupeKey: `replacement-completed:${planId}:${plan.target_user_id}`,
            });
          await tx.query(
            "INSERT INTO asset.replacement_history(id,tenant_id,plan_id,entity_version,action,snapshot,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              randomUUID(),
              tx.tenantId,
              planId,
              v,
              actionName,
              JSON.stringify(value),
              principal.id,
              reason,
            ],
          );
          if (next === "CANCELLED" || next === "REPLACED")
            await resolveQueue(tx, planId);
          else
            await queue(tx, planId, `Replacement plan ${next.toLowerCase()}`);
          event =
            command === "review"
              ? body.decision === "APPROVE_REPLACEMENT"
                ? "REPLACEMENT.APPROVED"
                : "REPLACEMENT.REVIEWED"
              : command === "plan"
                ? "REPLACEMENT.PLAN_CREATED"
                : command === "mark-new-asset-ready"
                  ? "REPLACEMENT.NEW_ASSET_READY"
                  : command === "start-migration"
                    ? "REPLACEMENT.MIGRATION_STARTED"
                    : "REPLACEMENT.COMPLETED";
          aggregateType = "REPLACEMENT_PLAN";
          aggregateId = planId;
          aggregateVersion = v;
        } else if (retirementCandidate) {
          const assetId = retirementCandidate[1]!;
          const asset = await tx.query(
            "SELECT lifecycle_state,assignment_state FROM asset.assets WHERE tenant_id=$1 AND id=$2",
            [tx.tenantId, assetId],
          );
          if (!asset.rowCount)
            throw new ApplicationError("NOT_FOUND", "Asset was not found.");
          if (
            !["AVAILABLE", "RETURNED", "REPAIR", "ASSIGNED", "IN_USE"].includes(
              String(asset.rows[0]!.lifecycle_state),
            )
          )
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "Asset lifecycle does not permit a retirement candidate.",
            );
          const blockers =
            asset.rows[0]!.assignment_state !== "UNASSIGNED" ||
            ["ASSIGNED", "IN_USE"].includes(
              String(asset.rows[0]!.lifecycle_state),
            )
              ? ["ACTIVE_ASSIGNMENT_OR_LOAN"]
              : [];
          const rid = randomUUID();
          await tx.query(
            "INSERT INTO asset.retirement_records(id,tenant_id,asset_id,state,clearances,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              rid,
              tx.tenantId,
              assetId,
              blockers.length ? "BLOCKED" : "CANDIDATE",
              JSON.stringify(
                blockers.length ? { unresolved_blockers: blockers } : {},
              ),
              reason,
              principal.id,
            ],
          );
          value = {
            id: rid,
            retirement_record_id: rid,
            asset_id: assetId,
            state: blockers.length ? "BLOCKED" : "CANDIDATE",
            version: 1,
            reason,
            blockers,
          };
          await queue(
            tx,
            rid,
            blockers.length
              ? `Retirement blocked: ${blockers.join(", ")}`
              : "Retirement candidate requires review",
          );
          if (blockers.length) {
            additionalEvents.push({
              event: "RETIREMENT.CANDIDATE_CREATED",
              aggregateType: "RETIREMENT",
              aggregateId: rid,
              aggregateVersion: 1,
              payload: value,
            });
            event = "RETIREMENT.BLOCKED";
          } else event = "RETIREMENT.CANDIDATE_CREATED";
          aggregateType = "RETIREMENT";
          aggregateId = rid;
          aggregateVersion = 1;
          status = 201;
          await tx.query(
            "INSERT INTO asset.lifecycle_evidence_history(id,tenant_id,asset_id,related_id,evidence_type,payload,actor_id,reason) VALUES($1,$2,$3,$4,'RETIREMENT_CANDIDATE',$5,$6,$7)",
            [
              randomUUID(),
              tx.tenantId,
              assetId,
              rid,
              JSON.stringify(value),
              principal.id,
              reason,
            ],
          );
        } else if (retire) {
          const retirementId = requiredString(body, "retirement_record_id");
          const approvalId = requiredString(body, "approval_id");
          const record = await tx.query(
            "SELECT * FROM asset.retirement_records WHERE tenant_id=$1 AND id=$2 AND asset_id=$3 FOR UPDATE",
            [tx.tenantId, retirementId, retire[1]!],
          );
          if (!record.rowCount)
            throw new ApplicationError(
              "NOT_FOUND",
              "Retirement candidate was not found.",
            );
          if (!["CANDIDATE", "BLOCKED"].includes(String(record.rows[0]!.state)))
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "Retirement candidate is not pending approval.",
            );
          if (!Number.isSafeInteger(body.retirement_expected_version))
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "retirement_expected_version is required.",
            );
          assertVersion(
            record.rows[0]!.version,
            Number(body.retirement_expected_version),
          );
          const approval = await tx.query(
            "SELECT r.state,r.requested_by,r.context,(SELECT d.actor_id FROM control.approval_decisions d WHERE d.tenant_id=r.tenant_id AND d.request_id=r.id AND d.decision='APPROVED' ORDER BY d.created_at DESC LIMIT 1) AS approved_by FROM control.approval_requests r WHERE r.tenant_id=$1 AND r.id=$2 AND r.source_type='ASSET_RETIREMENT' AND r.source_id=$3",
            [tx.tenantId, approvalId, retirementId],
          );
          const asset = await tx.query(
            "SELECT lifecycle_state,assignment_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [tx.tenantId, retire[1]!],
          );
          assertVersion(asset.rows[0]!.version, version(body));
          const blockers: string[] = [];
          if (asset.rows[0]!.assignment_state !== "UNASSIGNED")
            blockers.push("ACTIVE_ASSIGNMENT_OR_LOAN");
          const licenses = await tx.query(
            "SELECT id FROM license.assignments WHERE tenant_id=$1 AND principal_type='ASSET' AND principal_id=$2 AND state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')",
            [tx.tenantId, retire[1]!],
          );
          if (licenses.rowCount) blockers.push("LICENSE_CLEARANCE_REQUIRED");
          const maintenance = await tx.query(
            "SELECT id FROM maintenance.orders WHERE tenant_id=$1 AND asset_id=$2 AND state NOT IN ('COMPLETED','CANCELLED','FAILED')",
            [tx.tenantId, retire[1]!],
          );
          if (maintenance.rowCount) blockers.push("ACTIVE_MAINTENANCE");
          const incidents = await tx.query(
            "SELECT id FROM incident.relations WHERE tenant_id=$1 AND related_entity_type='ASSET' AND related_entity_id=$2",
            [tx.tenantId, retire[1]!],
          );
          if (incidents.rowCount) blockers.push("INCIDENT_CLEARANCE_REQUIRED");
          const refs =
            body.clearances && typeof body.clearances === "object"
              ? (body.clearances as Record<string, unknown>)
              : {};
          assertApproval(approval, {
            asset_id: retire[1]!,
            clearances: refs,
          });
          for (const required of [
            "legal_hold",
            "retention",
            "financial",
            "incident",
          ])
            if (
              typeof refs[required] !== "string" ||
              !String(refs[required]).trim()
            )
              blockers.push(`${required.toUpperCase()}_CLEARANCE_REQUIRED`);
          if (blockers.length) {
            await tx.query(
              "UPDATE asset.retirement_records SET state='BLOCKED',approval_id=$1,clearances=$2,version=version+1,updated_at=now() WHERE tenant_id=$3 AND id=$4",
              [
                approvalId,
                JSON.stringify({ ...refs, unresolved_blockers: blockers }),
                tx.tenantId,
                retirementId,
              ],
            );
            await queue(
              tx,
              retirementId,
              `Retirement blocked: ${blockers.join(", ")}`,
            );
            value = {
              id: retirementId,
              retirement_record_id: retirementId,
              asset_id: retire[1]!,
              state: "BLOCKED",
              version: Number(record.rows[0]!.version) + 1,
              blockers,
            };
            event = "RETIREMENT.BLOCKED";
            aggregateType = "RETIREMENT";
            aggregateId = retirementId;
            aggregateVersion = Number(record.rows[0]!.version) + 1;
            status = 409;
            await tx.query(
              "INSERT INTO asset.lifecycle_evidence_history(id,tenant_id,asset_id,related_id,evidence_type,payload,actor_id,reason) VALUES($1,$2,$3,$4,'RETIREMENT_BLOCKED',$5,$6,$7)",
              [
                randomUUID(),
                tx.tenantId,
                retire[1]!,
                retirementId,
                JSON.stringify(value),
                principal.id,
                reason,
              ],
            );
          } else {
            if (
              !["AVAILABLE", "RETURNED", "REPAIR"].includes(
                String(asset.rows[0]!.lifecycle_state),
              )
            )
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Asset lifecycle does not permit retirement.",
              );
            const v = Number(asset.rows[0]!.version) + 1;
            await tx.query(
              "UPDATE asset.assets SET lifecycle_state='RETIRED',updated_at=now(),version=$1 WHERE tenant_id=$2 AND id=$3",
              [v, tx.tenantId, retire[1]!],
            );
            await tx.query(
              "INSERT INTO asset.lifecycle_transitions(id,tenant_id,asset_id,from_state,to_state,command_type,actor_type,actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,'RETIRED','ASSET.RETIRE',$5,$6,$7,$8)",
              [
                randomUUID(),
                tx.tenantId,
                retire[1]!,
                asset.rows[0]!.lifecycle_state,
                principal.actor_type,
                principal.id,
                reason,
                context.correlation_id,
              ],
            );
            await tx.query(
              "UPDATE asset.retirement_records SET state='RETIRED',approval_id=$1,clearances=$2,version=version+1,updated_at=now() WHERE tenant_id=$3 AND id=$4",
              [approvalId, JSON.stringify(refs), tx.tenantId, retirementId],
            );
            value = {
              id: retirementId,
              retirement_record_id: retirementId,
              asset_id: retire[1]!,
              state: "RETIRED",
              version: v,
              clearances: refs,
            };
            await queue(
              tx,
              retirementId,
              "Retirement complete; data wipe and disposition remain",
            );
            event = "ASSET.RETIRED";
            aggregateType = "ASSET";
            aggregateId = retire[1]!;
            aggregateVersion = v;
            additionalEvents.push({
              event: "RETIREMENT.APPROVED",
              aggregateId: retirementId,
              aggregateVersion: Number(record.rows[0]!.version) + 1,
              payload: {
                retirement_record_id: retirementId,
                asset_id: retire[1]!,
                approval_id: approvalId,
                approved_by: principal.id,
                clearances: refs,
                version: Number(record.rows[0]!.version) + 1,
              },
            });
            await tx.query(
              "INSERT INTO asset.lifecycle_evidence_history(id,tenant_id,asset_id,related_id,evidence_type,payload,actor_id,reason) VALUES($1,$2,$3,$4,'RETIREMENT_APPROVED',$5,$6,$7)",
              [
                randomUUID(),
                tx.tenantId,
                retire[1]!,
                retirementId,
                JSON.stringify(value),
                principal.id,
                reason,
              ],
            );
          }
        } else if (wipe) {
          const retirementId = requiredString(body, "retirement_record_id");
          const approvalId = requiredString(body, "approval_id");
          const method = requiredString(body, "method");
          if (
            ![
              "CRYPTOGRAPHIC_ERASE",
              "NIST_CLEAR",
              "NIST_PURGE",
              "PHYSICAL_DESTRUCTION",
            ].includes(method)
          )
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "Unsupported symbolic wipe method.",
            );
          const asset = await tx.query(
            "SELECT lifecycle_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [tx.tenantId, wipe[1]!],
          );
          if (!asset.rowCount || asset.rows[0]!.lifecycle_state !== "RETIRED")
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "A retired asset is required before wiping.",
            );
          assertVersion(asset.rows[0]!.version, expected!);
          const retired = await tx.query(
            "SELECT id FROM asset.retirement_records WHERE tenant_id=$1 AND asset_id=$2 AND state='RETIRED'",
            [tx.tenantId, wipe[1]!],
          );
          if (!retired.rowCount || retired.rows[0]!.id !== retirementId)
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "A completed retirement is required before wiping.",
            );
          const approval = await tx.query(
            "SELECT r.state,r.requested_by,r.context,(SELECT d.actor_id FROM control.approval_decisions d WHERE d.tenant_id=r.tenant_id AND d.request_id=r.id AND d.decision='APPROVED' ORDER BY d.created_at DESC LIMIT 1) AS approved_by FROM control.approval_requests r WHERE r.tenant_id=$1 AND r.id=$2 AND r.source_type='DATA_WIPE' AND r.source_id=$3",
            [tx.tenantId, approvalId, retirementId],
          );
          assertApproval(approval, {
            asset_id: wipe[1]!,
            retirement_record_id: retirementId,
            method,
          });
          const agent = await tx.query(
            "SELECT id FROM agent.agents WHERE tenant_id=$1 AND asset_id=$2 AND status IN ('ENROLLED','ONLINE') AND last_seen_at>now()-interval '5 minutes'",
            [tx.tenantId, wipe[1]!],
          );
          if (!agent.rowCount)
            throw new ApplicationError(
              "DEPENDENCY_UNAVAILABLE",
              "A recently online enrolled agent bound to this asset is required.",
              true,
            );
          const generation = await tx.query(
            "SELECT generation,state,method,approval_id FROM asset.data_wipe_jobs WHERE tenant_id=$1 AND asset_id=$2 ORDER BY generation DESC LIMIT 1",
            [tx.tenantId, wipe[1]!],
          );
          if (generation.rowCount) {
            const prior = generation.rows[0]!;
            if (["QUEUED", "CLAIMED"].includes(String(prior.state)))
              throw new ApplicationError(
                "OPERATION_IN_PROGRESS",
                "An earlier wipe operation must be reconciled first.",
              );
            if (prior.state === "COMPLETED")
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "A completed wipe cannot be repeated; reconcile the existing evidence.",
              );
            if (prior.method === method || prior.approval_id === approvalId)
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Retry after a wipe failure requires a different approved method and approval request.",
              );
          }
          const nextGeneration = generation.rowCount
            ? Number(generation.rows[0]!.generation) + 1
            : 1;
          const jobId = randomUUID();
          await tx.query(
            "INSERT INTO asset.data_wipe_jobs(id,tenant_id,asset_id,retirement_id,agent_id,state,method,generation,approval_id,created_by,reason) VALUES($1,$2,$3,$4,$5,'QUEUED',$6,$7,$8,$9,$10)",
            [
              jobId,
              tx.tenantId,
              wipe[1]!,
              retirementId,
              agent.rows[0]!.id,
              method,
              nextGeneration,
              approvalId,
              principal.id,
              reason,
            ],
          );
          await new OperationRegistry(tx).enqueue({
            operation_id: jobId,
            type: "DATA_WIPE",
            target_type: "ASSET",
            target_id: wipe[1]!,
            correlation_id: context.correlation_id,
          });
          value = {
            operation_id: jobId,
            data_wipe_job_id: jobId,
            asset_id: wipe[1]!,
            state: "QUEUED",
            method,
            generation: nextGeneration,
            version: 1,
          };
          await queue(tx, jobId, "Data wipe queued");
          event = "DATA_WIPE.STARTED";
          aggregateType = "DATA_WIPE_JOB";
          aggregateId = jobId;
          aggregateVersion = 1;
          status = 202;
          await tx.query(
            "INSERT INTO asset.lifecycle_evidence_history(id,tenant_id,asset_id,related_id,evidence_type,payload,actor_id,reason) VALUES($1,$2,$3,$4,'DATA_WIPE_STARTED',$5,$6,$7)",
            [
              randomUUID(),
              tx.tenantId,
              wipe[1]!,
              jobId,
              JSON.stringify(value),
              principal.id,
              reason,
            ],
          );
        } else if (disposal) {
          const retirementId = requiredString(body, "retirement_record_id");
          const approvalId = requiredString(body, "approval_id");
          const method = requiredString(body, "method");
          if (
            ![
              "REUSE_INTERNAL",
              "SELL",
              "RECYCLE",
              "RETURN_VENDOR",
              "DONATE",
              "DESTROY",
            ].includes(method)
          )
            throw new ApplicationError(
              "VALIDATION_ERROR",
              "Unsupported disposition method.",
            );
          const asset = await tx.query(
            "SELECT lifecycle_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [tx.tenantId, disposal[1]!],
          );
          if (!asset.rowCount || asset.rows[0]!.lifecycle_state !== "RETIRED")
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "Only a retired asset can be dispositioned.",
            );
          assertVersion(asset.rows[0]!.version, expected!);
          const retirement = await tx.query(
            "SELECT id FROM asset.retirement_records WHERE tenant_id=$1 AND id=$2 AND asset_id=$3 AND state='RETIRED'",
            [tx.tenantId, retirementId, disposal[1]!],
          );
          if (!retirement.rowCount)
            throw new ApplicationError(
              "NOT_FOUND",
              "Retirement record was not found.",
            );
          const approval = await tx.query(
            "SELECT r.state,r.requested_by,r.context,(SELECT d.actor_id FROM control.approval_decisions d WHERE d.tenant_id=r.tenant_id AND d.request_id=r.id AND d.decision='APPROVED' ORDER BY d.created_at DESC LIMIT 1) AS approved_by FROM control.approval_requests r WHERE r.tenant_id=$1 AND r.id=$2 AND r.source_type='ASSET_DISPOSAL' AND r.source_id=$3",
            [tx.tenantId, approvalId, retirementId],
          );
          const clearance =
            body.cleanup_clearances &&
            typeof body.cleanup_clearances === "object"
              ? (body.cleanup_clearances as Record<string, unknown>)
              : {};
          assertApproval(approval, {
            asset_id: disposal[1]!,
            retirement_record_id: retirementId,
            method,
            cleanup_clearances: clearance,
          });
          const wipeResult = await tx.query(
            "SELECT state,result,evidence_document_id,evidence_checksum FROM asset.data_wipe_jobs WHERE tenant_id=$1 AND asset_id=$2 ORDER BY generation DESC LIMIT 1",
            [tx.tenantId, disposal[1]!],
          );
          if (
            method !== "DESTROY" &&
            (!wipeResult.rowCount ||
              wipeResult.rows[0]!.state !== "COMPLETED" ||
              wipeResult.rows[0]!.result !== "PASS" ||
              !wipeResult.rows[0]!.evidence_document_id ||
              !wipeResult.rows[0]!.evidence_checksum)
          )
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "Verified wipe evidence is required before this disposition.",
            );
          if (
            method === "DESTROY" &&
            body.physical_destruction_confirmed !== true
          )
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "Authorized physical destruction evidence is required.",
            );
          const licenses = await tx.query(
            "SELECT id FROM license.assignments WHERE tenant_id=$1 AND principal_type='ASSET' AND principal_id=$2 AND state IN ('ASSIGNED','ACTIVE','SUSPENDED','RECLAIM_PENDING')",
            [tx.tenantId, disposal[1]!],
          );
          if (licenses.rowCount)
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "License/access cleanup remains unresolved.",
            );
          const cleanup =
            body.cleanup_clearances &&
            typeof body.cleanup_clearances === "object"
              ? (body.cleanup_clearances as Record<string, unknown>)
              : {};
          for (const required of ["access", "agent"])
            if (
              typeof cleanup[required] !== "string" ||
              !String(cleanup[required]).trim()
            )
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                `${required.toUpperCase()}_CLEANUP_CLEARANCE_REQUIRED`,
              );
          if (
            method !== "REUSE_INTERNAL" &&
            body.physical_disposition_confirmed !== true
          )
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "Physical disposition confirmation is required before finalization.",
            );
          const did = randomUUID();
          const evidence =
            method === "REUSE_INTERNAL"
              ? null
              : requiredString(body, "physical_evidence_id");
          const checksum =
            method === "REUSE_INTERNAL"
              ? null
              : requiredString(body, "physical_evidence_checksum");
          await tx.query(
            "INSERT INTO asset.disposal_records(id,tenant_id,asset_id,retirement_id,state,method,approval_id,cleanup_clearances,physical_evidence_id,physical_evidence_checksum,confirmed_at,reason,created_by) VALUES($1,$2,$3,$4,'COMPLETED',$5,$6,$7,$8,$9,now(),$10,$11)",
            [
              did,
              tx.tenantId,
              disposal[1]!,
              retirementId,
              method,
              approvalId,
              JSON.stringify(body.cleanup_clearances ?? {}),
              evidence,
              checksum,
              reason,
              principal.id,
            ],
          );
          let v = Number(asset.rows[0]!.version);
          if (method !== "REUSE_INTERNAL") {
            v++;
            await tx.query(
              "UPDATE asset.assets SET lifecycle_state='DISPOSED',updated_at=now(),version=$1 WHERE tenant_id=$2 AND id=$3",
              [v, tx.tenantId, disposal[1]!],
            );
            await tx.query(
              "INSERT INTO asset.lifecycle_transitions(id,tenant_id,asset_id,from_state,to_state,command_type,actor_type,actor_id,reason,correlation_id) VALUES($1,$2,$3,'RETIRED','DISPOSED','ASSET.DISPOSE',$4,$5,$6,$7)",
              [
                randomUUID(),
                tx.tenantId,
                disposal[1]!,
                principal.actor_type,
                principal.id,
                reason,
                context.correlation_id,
              ],
            );
          }
          value = {
            id: did,
            disposal_record_id: did,
            asset_id: disposal[1]!,
            retirement_record_id: retirementId,
            method,
            state: "COMPLETED",
            version: v,
            evidence_document_id:
              wipeResult.rows[0]?.evidence_document_id ?? evidence,
            evidence_checksum:
              wipeResult.rows[0]?.evidence_checksum ?? checksum,
          };
          additionalEvents.push({
            event: "DISPOSAL.APPROVED",
            aggregateId: did,
            aggregateVersion: 1,
            payload: {
              disposal_record_id: did,
              asset_id: disposal[1]!,
              method,
              approval_id: approvalId,
            },
          });
          if (method !== "REUSE_INTERNAL")
            additionalEvents.push({
              event: "DISPOSAL.COMPLETED",
              aggregateId: did,
              aggregateVersion: 1,
              payload: {
                disposal_record_id: did,
                asset_id: disposal[1]!,
                method,
                evidence_document_id: evidence,
                evidence_checksum: checksum,
              },
            });
          await tx.query(
            "INSERT INTO asset.lifecycle_evidence_history(id,tenant_id,asset_id,related_id,evidence_type,payload,actor_id,reason) VALUES($1,$2,$3,$4,'DISPOSAL',$5,$6,$7)",
            [
              randomUUID(),
              tx.tenantId,
              disposal[1]!,
              did,
              JSON.stringify(value),
              principal.id,
              reason,
            ],
          );
          await resolveQueue(tx, retirementId);
          event =
            method === "REUSE_INTERNAL"
              ? "DISPOSAL.COMPLETED"
              : "ASSET.DISPOSED";
          aggregateType = "ASSET";
          aggregateId = disposal[1]!;
          aggregateVersion = v;
        } else {
          const asset = await tx.query(
            "SELECT lifecycle_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [tx.tenantId, reactivate![1]!],
          );
          if (!asset.rowCount || asset.rows[0]!.lifecycle_state !== "RETIRED")
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "Only a retired asset can be reactivated.",
            );
          assertVersion(asset.rows[0]!.version, expected!);
          const reuse = await tx.query(
            "SELECT d.approval_id,r.requested_by,r.state,r.context,(SELECT ad.actor_id FROM control.approval_decisions ad WHERE ad.tenant_id=r.tenant_id AND ad.request_id=r.id AND ad.decision='APPROVED' ORDER BY ad.created_at DESC LIMIT 1) AS approved_by FROM asset.disposal_records d JOIN control.approval_requests r ON r.tenant_id=d.tenant_id AND r.id=d.approval_id WHERE d.tenant_id=$1 AND d.asset_id=$2 AND d.method='REUSE_INTERNAL' AND d.state='COMPLETED' AND r.source_type='ASSET_DISPOSAL' ORDER BY d.created_at DESC LIMIT 1",
            [tx.tenantId, reactivate![1]!],
          );
          if (!reuse.rowCount)
            throw new ApplicationError(
              "BUSINESS_RULE_VIOLATION",
              "An independently approved internal reuse decision is required.",
            );
          assertApproval(reuse, {
            asset_id: reactivate![1]!,
            method: "REUSE_INTERNAL",
          });
          const reconditioningEvidence = requiredString(
            body,
            "reconditioning_evidence_id",
          );
          const reconditioningChecksum = requiredString(
            body,
            "reconditioning_evidence_checksum",
          );
          const v = expected! + 1;
          await tx.query(
            "UPDATE asset.assets SET lifecycle_state='AVAILABLE',assignment_state='UNASSIGNED',updated_at=now(),version=$1 WHERE tenant_id=$2 AND id=$3",
            [v, tx.tenantId, reactivate![1]!],
          );
          value = {
            asset_id: reactivate![1]!,
            from_state: "RETIRED",
            to_state: "AVAILABLE",
            version: v,
            approval_id: reuse.rows[0]!.approval_id,
            reconditioning_evidence_id: reconditioningEvidence,
            reconditioning_evidence_checksum: reconditioningChecksum,
          };
          await tx.query(
            "INSERT INTO asset.lifecycle_transitions(id,tenant_id,asset_id,from_state,to_state,command_type,actor_type,actor_id,reason,correlation_id) VALUES($1,$2,$3,'RETIRED','AVAILABLE','ASSET.REACTIVATE',$4,$5,$6,$7)",
            [
              randomUUID(),
              tx.tenantId,
              reactivate![1]!,
              principal.actor_type,
              principal.id,
              reason,
              context.correlation_id,
            ],
          );
          await tx.query(
            "INSERT INTO asset.lifecycle_evidence_history(id,tenant_id,asset_id,related_id,evidence_type,payload,actor_id,reason) VALUES($1,$2,$3,$3,'REACTIVATION',$4,$5,$6)",
            [
              randomUUID(),
              tx.tenantId,
              reactivate![1]!,
              JSON.stringify({
                approval_id: reuse.rows[0]!.approval_id,
                reconditioning_evidence_id: reconditioningEvidence,
                reconditioning_evidence_checksum: reconditioningChecksum,
              }),
              principal.id,
              reason,
            ],
          );
          event = "ASSET.REACTIVATED";
          aggregateType = "ASSET";
          aggregateId = reactivate![1]!;
          aggregateVersion = v;
        }
        for (const extra of additionalEvents)
          await eventAudit({
            tx,
            config,
            principal,
            context,
            key,
            event: extra.event,
            aggregateType: extra.aggregateType ?? "DISPOSAL",
            aggregateId: extra.aggregateId,
            aggregateVersion: extra.aggregateVersion,
            command: operation,
            reason,
            before: null,
            after: extra.payload,
          });
        await eventAudit({
          tx,
          config,
          principal,
          context,
          key,
          event,
          aggregateType,
          aggregateId,
          aggregateVersion,
          command: operation,
          reason,
          before,
          after: value,
        });
        return { status, body: value as Json };
      },
    ),
  );
  json(res, result.status, { data: result.body, meta: context });
  return true;
}
