import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type { CorrelationContext } from "../../../packages/shared-kernel/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import {
  startOffboarding,
  createOffboardingCase,
  startExistingOffboarding,
  readOffboardingCase,
  recordOffboardingClearance,
  resolveOffboardingClearance,
  transitionOffboardingCase,
  addRecoveryAction,
  beginOffboardingReconciliation,
  endOffboardingReconciliation,
  resolveOffboardingRecoveryAction,
} from "../../../modules/identity/index.js";
import {
  cancelReturnRequest,
  listUserAssetsForOffboarding,
  requestReturn,
  readReturnRequestState,
} from "../../../modules/asset/index.js";
import {
  listUserLicenseAssignmentsForOffboarding,
  transitionLicenseAssignment,
} from "../../../modules/license/index.js";
import {
  createOffboardingWorkItem,
  resolveOffboardingWorkItem,
} from "../../../modules/work-queue/index.js";
import { json } from "../../../packages/observability/src/index.js";

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > 65536)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
    chunks.push(b);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* mapped below */
  }
  throw new ApplicationError("VALIDATION_ERROR", "A JSON object is required.");
}
function text(b: Record<string, unknown>, key: string) {
  const v = b[key];
  if (typeof v !== "string" || !v.trim())
    throw new ApplicationError("VALIDATION_ERROR", `${key} is required.`);
  return v.trim();
}
function int(b: Record<string, unknown>, key: string) {
  const v = b[key];
  if (!Number.isSafeInteger(v))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${key} must be an integer.`,
    );
  return Number(v);
}
function fields(b: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(b).some((k) => !allowed.includes(k)))
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Unsupported request field.",
    );
}

async function effects(input: {
  tx: Transaction;
  config: Config;
  principal: { id: string; actor_type: string; tenant_id: string };
  context: CorrelationContext;
  key: string;
  eventType: string;
  caseId: string;
  aggregateType?: string;
  aggregateId?: string;
  version: number;
  reason: string;
  payload: Record<string, unknown>;
}) {
  const at = new Date().toISOString();
  await new PostgresOutboxWriter(input.tx).append({
    event_id: randomUUID(),
    event_type: input.eventType,
    schema_version: 1,
    occurred_at: at,
    producer: { service: input.config.serviceName, instance: "api" },
    aggregate: {
      type: input.aggregateType ?? "OFFBOARDING_CASE",
      id: input.aggregateId ?? input.caseId,
      version: input.version,
    },
    actor: { type: input.principal.actor_type, id: input.principal.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    tenant_id: input.principal.tenant_id,
    organization_id: input.principal.tenant_id,
    idempotency_key: input.key,
    payload: input.payload as never,
  });
  await new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.eventType,
    occurred_at: at,
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.eventType },
    subject: {
      entity_type: input.aggregateType ?? "OFFBOARDING_CASE",
      entity_id: input.aggregateId ?? input.caseId,
    },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.eventType, text: input.reason },
    before: null,
    after: input.payload as never,
    outcome: { status: "SUCCESS" },
    classification: "INTERNAL",
    relations: [],
    evidence: [],
  });
}

async function processClearances(input: {
  uow: UnitOfWork;
  tenantId: string;
  caseId: string;
  userId: string;
  actorId: string;
  reason: string;
  config: Config;
  principal: { id: string; actor_type: string; tenant_id: string };
  context: CorrelationContext;
  key: string;
}) {
  const reconciliationToken = await input.uow.run(input.tenantId, (tx) =>
    beginOffboardingReconciliation(tx, input.caseId),
  );
  try {
    const existing = await input.uow.run(input.tenantId, (tx) =>
      readOffboardingCase(tx, input.caseId),
    );
    for (const task of existing.clearances)
      if (task.state === "PENDING" && task.clearance_type === "ASSET_RETURN") {
        try {
          const ref = JSON.parse(task.detail) as { return_request_id?: string };
          if (ref.return_request_id) {
            const state = await input.uow.run(input.tenantId, (tx) =>
              readReturnRequestState(tx, ref.return_request_id!),
            );
            if (state.status === "FULFILLED")
              await input.uow.run(input.tenantId, (tx) =>
                recordOffboardingClearance({
                  tx,
                  caseId: input.caseId,
                  type: "ASSET_RETURN",
                  resourceId: String(task.resource_id),
                  state: "SUCCEEDED",
                  detail: "Asset return was confirmed by the Asset domain.",
                }),
              );
          }
        } catch {
          /* keep clearance actionable */
        }
      }
    const assets = await input.uow.run(input.tenantId, (tx) =>
      listUserAssetsForOffboarding(tx, input.userId),
    );
    for (const a of assets) {
      try {
        if (a.risk_state === "MISSING") {
          await input.uow.run(input.tenantId, async (tx) => {
            await recordOffboardingClearance({
              tx,
              caseId: input.caseId,
              type: "ASSET_RETURN",
              resourceId: a.id,
              state: "BLOCKED",
              detail: `Asset ${a.asset_code} is marked missing; investigate or record an approved exception.`,
            });
            await createOffboardingWorkItem({
              tx,
              caseId: input.caseId,
              title: `Investigate missing asset ${a.asset_code} during offboarding`,
            });
          });
          continue;
        }
        if (a.return_request_id) {
          await input.uow.run(input.tenantId, (tx) =>
            recordOffboardingClearance({
              tx,
              caseId: input.caseId,
              type: "ASSET_RETURN",
              resourceId: a.id,
              state: "PENDING",
              detail: JSON.stringify({
                asset_id: a.id,
                return_request_id: a.return_request_id,
                asset_version: a.version,
              }),
            }),
          );
          continue;
        }
        const request = await input.uow.run(input.tenantId, (tx) =>
          requestReturn({
            tx,
            assetId: a.id,
            expectedVersion: a.version,
            dueAt: new Date(Date.now() + 30 * 86400000).toISOString(),
            reason: input.reason,
          }),
        );
        await input.uow.run(input.tenantId, async (tx) => {
          await recordOffboardingClearance({
            tx,
            caseId: input.caseId,
            type: "ASSET_RETURN",
            resourceId: a.id,
            state: "PENDING",
            detail: JSON.stringify({
              asset_id: a.id,
              return_request_id: request.return_request_id,
              asset_version: request.version,
            }),
          });
          await effects({
            tx,
            config: input.config,
            principal: input.principal,
            context: input.context,
            key: `${input.key}:asset:${a.id}`,
            eventType: "ASSET.RETURN_REQUESTED",
            caseId: input.caseId,
            aggregateType: "ASSET",
            aggregateId: a.id,
            version: request.version,
            reason: input.reason,
            payload: {
              asset_id: a.id,
              assignment_id: request.assignment_id,
              user_id: request.user_id,
              due_at: request.due_at,
              reason: input.reason,
              return_request_id: request.return_request_id,
              offboarding_case_id: input.caseId,
            },
          });
        });
      } catch (e) {
        await input.uow.run(input.tenantId, async (tx) => {
          await recordOffboardingClearance({
            tx,
            caseId: input.caseId,
            type: "ASSET_RETURN",
            resourceId: a.id,
            state: "BLOCKED",
            detail:
              e instanceof Error ? e.message : "Asset return request failed.",
          });
          await createOffboardingWorkItem({
            tx,
            caseId: input.caseId,
            title: `Resolve asset return for offboarding ${input.caseId}`,
          });
        });
      }
    }
    const licenses = await input.uow.run(input.tenantId, (tx) =>
      listUserLicenseAssignmentsForOffboarding(tx, input.userId),
    );
    for (const l of licenses) {
      try {
        if (["CANCELLED", "RECLAIMED", "EXPIRED"].includes(l.state)) {
          await input.uow.run(input.tenantId, (tx) =>
            recordOffboardingClearance({
              tx,
              caseId: input.caseId,
              type: "LICENSE",
              resourceId: l.id,
              state: "SUCCEEDED",
              detail: `License is in terminal non-capacity state ${l.state}.`,
            }),
          );
          continue;
        }
        const action =
          l.state === "ASSIGNED"
            ? "CANCEL"
            : ["ACTIVE", "SUSPENDED"].includes(l.state)
              ? "RECLAIM"
              : null;
        if (!action) {
          await input.uow.run(input.tenantId, (tx) =>
            recordOffboardingClearance({
              tx,
              caseId: input.caseId,
              type: "LICENSE",
              resourceId: l.id,
              state: "PENDING",
              detail: `License assignment is ${l.state}; reconcile through License domain.`,
            }),
          );
          continue;
        }
        const result = await input.uow.run(input.tenantId, (tx) =>
          transitionLicenseAssignment({
            tx,
            assignmentId: l.id,
            expectedVersion: l.version,
            action,
            actorId: input.actorId,
            reason: input.reason,
          }),
        );
        const done =
          result.state === "CANCELLED" || result.state === "RECLAIMED";
        const eventType =
          action === "CANCEL"
            ? "LICENSE.ASSIGNMENT_CANCELLED"
            : "LICENSE.RECLAIM_PENDING";
        await input.uow.run(input.tenantId, async (tx) => {
          await recordOffboardingClearance({
            tx,
            caseId: input.caseId,
            type: "LICENSE",
            resourceId: l.id,
            state: done ? "SUCCEEDED" : "PENDING",
            detail: `License assignment transitioned to ${result.state}.`,
          });
          await effects({
            tx,
            config: input.config,
            principal: input.principal,
            context: input.context,
            key: `${input.key}:license:${l.id}`,
            eventType,
            caseId: input.caseId,
            aggregateType: "LICENSE_ASSIGNMENT",
            aggregateId: l.id,
            version: result.version,
            reason: input.reason,
            payload: {
              assignment_id: l.id,
              entitlement_id: String(result.entitlement_id),
              principal_type: "USER",
              principal_id: input.userId,
              state: result.state,
              ...(action === "CANCEL"
                ? { cancelled_at: result.cancelled_at, reason: input.reason }
                : { reason: input.reason, grace_until: null }),
            },
          });
        });
        if (!done)
          await input.uow.run(input.tenantId, (tx) =>
            createOffboardingWorkItem({
              tx,
              caseId: input.caseId,
              title: `Complete license reclaim for offboarding ${input.caseId}`,
            }),
          );
      } catch (e) {
        await input.uow.run(input.tenantId, async (tx) => {
          await recordOffboardingClearance({
            tx,
            caseId: input.caseId,
            type: "LICENSE",
            resourceId: l.id,
            state: "BLOCKED",
            detail: e instanceof Error ? e.message : "License cleanup failed.",
          });
          await createOffboardingWorkItem({
            tx,
            caseId: input.caseId,
            title: `Resolve license cleanup for offboarding ${input.caseId}`,
          });
        });
      }
    }
    const clear = await input.uow.run(input.tenantId, (tx) =>
      readOffboardingCase(tx, input.caseId),
    );
    if (
      clear.state === "IN_PROGRESS" &&
      clear.clearances.some((x) => x.state === "BLOCKED")
    ) {
      await input.uow.run(input.tenantId, async (tx) => {
        const changed = await transitionOffboardingCase({
          tx,
          caseId: input.caseId,
          expectedVersion: Number(clear.version),
          command: "BLOCK",
          reason: input.reason,
          actorId: input.actorId,
          correlationId: input.context.correlation_id,
          allowReconciliation: true,
        });
        await effects({
          tx,
          config: input.config,
          principal: input.principal,
          context: input.context,
          key: `${input.key}:blocked`,
          eventType: "OFFBOARDING.BLOCKED",
          caseId: input.caseId,
          version: changed.version,
          reason: input.reason,
          payload: {
            offboarding_case_id: input.caseId,
            user_id: String(clear.user_id),
            case_version: changed.version,
            from_state: changed.from_state,
            to_state: changed.state,
            blocking_task_ids: clear.clearances
              .filter((x) => x.state === "BLOCKED")
              .map((x) => x.id),
            reason: input.reason,
            blocked_at: new Date().toISOString(),
          },
        });
      });
    }
    if (
      clear.state === "BLOCKED" &&
      !clear.clearances.some((x) => x.state === "BLOCKED")
    ) {
      await input.uow.run(input.tenantId, async (tx) => {
        const changed = await transitionOffboardingCase({
          tx,
          caseId: input.caseId,
          expectedVersion: Number(clear.version),
          command: "RESUME",
          reason: input.reason,
          actorId: input.actorId,
          correlationId: input.context.correlation_id,
          allowReconciliation: true,
        });
        await effects({
          tx,
          config: input.config,
          principal: input.principal,
          context: input.context,
          key: `${input.key}:resumed`,
          eventType: "OFFBOARDING.RESUMED",
          caseId: input.caseId,
          version: changed.version,
          reason: input.reason,
          payload: {
            offboarding_case_id: input.caseId,
            user_id: String(clear.user_id),
            case_version: changed.version,
            from_state: changed.from_state,
            to_state: changed.state,
            resolved_blocker_ids: clear.clearances
              .filter((x) => x.state !== "BLOCKED")
              .map((x) => x.id),
            reason: input.reason,
            resumed_at: new Date().toISOString(),
          },
        });
      });
    }
    await input.uow.run(input.tenantId, (tx) =>
      createOffboardingWorkItem({
        tx,
        caseId: input.caseId,
        title: `Complete offboarding ${input.caseId}`,
      }),
    );
  } finally {
    await input.uow.run(input.tenantId, (tx) =>
      endOffboardingReconciliation(tx, input.caseId, reconciliationToken),
    );
  }
}

export async function handleOffboardingRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  context: CorrelationContext;
  config: Config;
  authentication: AuthenticationPort;
  authorization: AuthorizationPort;
  uow: UnitOfWork;
}): Promise<boolean> {
  const { req, res, context, config, authentication, authorization, uow } =
    input;
  const method = req.method ?? "";
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const start = /^\/api\/v1\/users\/([^/]+)\/commands\/start-offboarding$/.exec(
    path,
  );
  const create = /^\/api\/v1\/users\/([^/]+)\/offboarding-cases$/.exec(path);
  const one = /^\/api\/v1\/offboarding-cases\/([^/]+)$/.exec(path);
  const cmd =
    /^\/api\/v1\/offboarding-cases\/([^/]+)\/commands\/(start|resume|mark-ready|complete|cancel|request-cancel|complete-cancellation|reconcile|resolve-recovery|resolve-clearance)$/.exec(
      path,
    );
  if (
    !(method === "POST" && (start || create || cmd)) &&
    !(method === "GET" && one)
  )
    return false;
  const principal = await authenticate(
    authentication,
    req.headers.authorization,
  );
  const resourceId = start
    ? start[1]!
    : create
      ? create[1]!
      : cmd
        ? cmd[1]!
        : one?.[1];
  if (!resourceId)
    throw new ApplicationError(
      "NOT_FOUND",
      "Offboarding resource was not found.",
    );
  const action =
    cmd?.[2] === "resolve-recovery" ||
    cmd?.[2] === "cancel" ||
    cmd?.[2] === "request-cancel" ||
    cmd?.[2] === "complete-cancellation"
      ? "identity.offboard.cancel"
      : "identity.offboard";
  await authorize(authorization, {
    principal,
    action,
    resource: {
      type: start || create ? "user" : "offboarding_case",
      id: resourceId,
      tenant_id: principal.tenant_id,
    },
    scope: {},
    context: { ...context },
  });
  if (method === "GET") {
    const data = await uow.run(principal.tenant_id, (tx) =>
      readOffboardingCase(tx, resourceId),
    );
    json(res, 200, { data, meta: context });
    return true;
  }
  const b = await body(req);
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim())
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  if (create) {
    fields(b, ["expected_user_version", "termination_request_id", "reason"]);
    const result = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "OFFBOARDING.CREATE",
          businessScope: resourceId,
          key,
          semanticRequest: b as never,
          expiresAt: new Date(Date.now() + 86400000),
        },
        async () => {
          const created = await createOffboardingCase({
            tx,
            userId: resourceId,
            expectedUserVersion: int(b, "expected_user_version"),
            terminationRequestId: text(b, "termination_request_id"),
            reason: text(b, "reason"),
            actorId: principal.id,
            correlationId: context.correlation_id,
          });
          await effects({
            tx,
            config,
            principal,
            context,
            key,
            eventType: "OFFBOARDING.CREATED",
            caseId: created.id,
            version: created.version,
            reason: text(b, "reason"),
            payload: {
              offboarding_case_id: created.id,
              user_id: resourceId,
              pre_offboarding_user_state: created.pre_offboarding_user_state,
              termination_request_id: text(b, "termination_request_id"),
              reason: text(b, "reason"),
              created_at: new Date().toISOString(),
            },
          });
          return { status: 201, body: created as never };
        },
      ),
    );
    json(res, result.status, { data: result.body, meta: context });
    return true;
  }
  if (start) {
    fields(b, ["expected_user_version", "termination_request_id", "reason"]);
    const result = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "OFFBOARDING.START",
          businessScope: resourceId,
          key,
          semanticRequest: b as never,
          expiresAt: new Date(Date.now() + 86400000),
        },
        async () => {
          const created = await startOffboarding({
            tx,
            userId: resourceId,
            expectedUserVersion: int(b, "expected_user_version"),
            terminationRequestId: text(b, "termination_request_id"),
            reason: text(b, "reason"),
            actorId: principal.id,
            correlationId: context.correlation_id,
          });
          await effects({
            tx,
            config,
            principal,
            context,
            key: `${key}:created`,
            eventType: "OFFBOARDING.CREATED",
            caseId: created.id,
            version: 1,
            reason: text(b, "reason"),
            payload: {
              offboarding_case_id: created.id,
              user_id: resourceId,
              pre_offboarding_user_state: created.pre_offboarding_user_state,
              termination_request_id: text(b, "termination_request_id"),
              reason: text(b, "reason"),
              created_at: new Date().toISOString(),
            },
          });
          await effects({
            tx,
            config,
            principal,
            context,
            key,
            eventType: "OFFBOARDING.STARTED",
            caseId: created.id,
            version: created.version,
            reason: text(b, "reason"),
            payload: {
              offboarding_case_id: created.id,
              user_id: resourceId,
              case_version: created.version,
              user_version: created.user_version,
              from_state: "INITIATED",
              to_state: "IN_PROGRESS",
              pre_offboarding_user_state: created.pre_offboarding_user_state,
              termination_request_id: text(b, "termination_request_id"),
              started_at: new Date().toISOString(),
              reason: text(b, "reason"),
            },
          });
          await effects({
            tx,
            config,
            principal,
            context,
            key: `${key}:user-terminating`,
            eventType: "USER.TERMINATING",
            caseId: created.id,
            aggregateType: "USER",
            aggregateId: resourceId,
            version: created.user_version,
            reason: text(b, "reason"),
            payload: {
              user_id: resourceId,
              effective_at: new Date().toISOString(),
              termination_source: text(b, "termination_request_id"),
              offboarding_case_id: created.id,
            },
          });
          return { status: 201, body: created as never };
        },
      ),
    );
    const data = result.body as { id: string; user_id: string };
    const current = await uow.run(principal.tenant_id, (tx) =>
      readOffboardingCase(tx, data.id),
    );
    if (["IN_PROGRESS", "BLOCKED"].includes(current.state))
      await processClearances({
        uow,
        tenantId: principal.tenant_id,
        caseId: data.id,
        userId: data.user_id,
        actorId: principal.id,
        reason: text(b, "reason"),
        config,
        principal,
        context,
        key,
      });
    json(res, result.status, {
      data: await uow.run(principal.tenant_id, (tx) =>
        readOffboardingCase(tx, data.id),
      ),
      meta: context,
    });
    return true;
  }
  const caseId = cmd![1]!;
  const actionName = cmd![2]!;
  if (actionName === "resolve-clearance") {
    fields(b, [
      "clearance_id",
      "expected_clearance_version",
      "disposition",
      "evidence_reference",
      "reason",
    ]);
    const disposition = text(b, "disposition");
    if (!["WAIVED", "ACCEPTED_EXCEPTION"].includes(disposition))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Only policy-authorized waiver or accepted exception is allowed.",
      );
    await authorize(authorization, {
      principal,
      action: "identity.offboard.exception",
      resource: {
        type: "offboarding_case",
        id: caseId,
        tenant_id: principal.tenant_id,
      },
      scope: {},
      context: { ...context },
    });
    const result = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "OFFBOARDING.RESOLVE_CLEARANCE_EXCEPTION",
          businessScope: caseId,
          key,
          semanticRequest: b as never,
          expiresAt: new Date(Date.now() + 86400000),
        },
        async () => {
          const clearance = await resolveOffboardingClearance({
            tx,
            caseId,
            clearanceId: text(b, "clearance_id"),
            expectedVersion: int(b, "expected_clearance_version"),
            disposition: disposition as "WAIVED" | "ACCEPTED_EXCEPTION",
            evidenceReference: text(b, "evidence_reference"),
            reason: text(b, "reason"),
            actorId: principal.id,
            authorized: true,
          });
          const c = await readOffboardingCase(tx, caseId);
          await effects({
            tx,
            config,
            principal,
            context,
            key,
            eventType: "OFFBOARDING.CLEARANCE_EXCEPTION_RECORDED",
            caseId,
            version: Number(c.version),
            reason: text(b, "reason"),
            payload: {
              case_id: caseId,
              clearance_id: clearance.id,
              disposition: clearance.state,
              version: clearance.version,
              evidence_reference: text(b, "evidence_reference"),
            },
          });
          return { status: 200, body: clearance as never };
        },
      ),
    );
    json(res, result.status, { data: result.body, meta: context });
    return true;
  }
  if (actionName === "resolve-recovery") {
    fields(b, [
      "recovery_action_id",
      "expected_recovery_version",
      "disposition",
      "evidence_reference",
      "reason",
    ]);
    const disposition = text(b, "disposition");
    if (!["SUCCEEDED", "WAIVED", "ACCEPTED_EXCEPTION"].includes(disposition))
      throw new ApplicationError("VALIDATION_ERROR", "disposition is invalid.");
    if (disposition !== "SUCCEEDED")
      await authorize(authorization, {
        principal,
        action: "identity.offboard.exception",
        resource: {
          type: "offboarding_case",
          id: caseId,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
    const caseState = await uow.run(principal.tenant_id, (tx) =>
      readOffboardingCase(tx, caseId),
    );
    const recoveryAction = caseState.recovery_actions.find(
      (a) => a.id === text(b, "recovery_action_id"),
    );
    if (!recoveryAction)
      throw new ApplicationError("NOT_FOUND", "Recovery action was not found.");
    if (
      disposition === "SUCCEEDED" &&
      recoveryAction.action_type === "RECOVER_ASSET_RETURN"
    ) {
      const clearance = caseState.clearances.find(
        (c) =>
          c.clearance_type === "ASSET_RETURN" &&
          c.resource_id === recoveryAction.source_action_id,
      );
      if (!clearance)
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "Asset return recovery reference is missing.",
        );
      let returnInfo: { return_request_id?: string; asset_version?: number };
      try {
        returnInfo = JSON.parse(clearance.detail) as {
          return_request_id?: string;
          asset_version?: number;
        };
      } catch {
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "Asset return recovery reference is invalid.",
        );
      }
      const returnRequestId = returnInfo.return_request_id;
      const expectedAssetVersion = returnInfo.asset_version;
      if (
        typeof returnRequestId !== "string" ||
        !returnRequestId ||
        typeof expectedAssetVersion !== "number" ||
        !Number.isSafeInteger(expectedAssetVersion)
      )
        throw new ApplicationError(
          "BUSINESS_RULE_VIOLATION",
          "Asset return recovery data is incomplete.",
        );
      await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "OFFBOARDING.ASSET_RETURN_RECOVERY",
            businessScope: returnRequestId,
            key: `${key}:asset-return`,
            semanticRequest: {
              asset_id: recoveryAction.source_action_id,
              return_request_id: returnRequestId,
              expected_version: expectedAssetVersion,
              reason: text(b, "reason"),
            },
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const restored = await cancelReturnRequest({
              tx,
              assetId: recoveryAction.source_action_id,
              returnRequestId,
              expectedVersion: expectedAssetVersion,
              reason: text(b, "reason"),
            });
            await effects({
              tx,
              config,
              principal,
              context,
              key: `${key}:asset-return`,
              eventType: "ASSET.RETURN_REQUEST_CANCELLED",
              caseId,
              aggregateType: "ASSET",
              aggregateId: recoveryAction.source_action_id,
              version: restored.version,
              reason: text(b, "reason"),
              payload: {
                asset_id: recoveryAction.source_action_id,
                return_request_id: restored.return_request_id,
                reason: text(b, "reason"),
                offboarding_case_id: caseId,
              },
            });
            return { status: 200, body: restored as never };
          },
        ),
      );
    }
    const result = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "OFFBOARDING.RESOLVE_RECOVERY_ACTION",
          businessScope: caseId,
          key,
          semanticRequest: b as never,
          expiresAt: new Date(Date.now() + 86400000),
        },
        async () => {
          const recovery = await resolveOffboardingRecoveryAction({
            tx,
            caseId,
            actionId: text(b, "recovery_action_id"),
            expectedVersion: int(b, "expected_recovery_version"),
            disposition: disposition as
              "SUCCEEDED" | "WAIVED" | "ACCEPTED_EXCEPTION",
            evidenceReference: text(b, "evidence_reference"),
            reason: text(b, "reason"),
            actorId: principal.id,
            authorized: disposition !== "SUCCEEDED",
          });
          const c = await readOffboardingCase(tx, caseId);
          await effects({
            tx,
            config,
            principal,
            context,
            key,
            eventType: "OFFBOARDING.RECOVERY_ACTION_UPDATED",
            caseId,
            version: Number(c.version),
            reason: text(b, "reason"),
            payload: {
              case_id: caseId,
              recovery_action_id: recovery.id,
              disposition: recovery.disposition,
              version: recovery.version,
            },
          });
          return { status: 200, body: recovery as never };
        },
      ),
    );
    json(res, result.status, { data: result.body, meta: context });
    return true;
  }
  fields(b, [
    "expected_version",
    "user_expected_version",
    "reason",
    "withdrawal_reference",
  ]);
  if (actionName === "reconcile") {
    await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "OFFBOARDING.RECONCILE",
          businessScope: caseId,
          key,
          semanticRequest: b as never,
          expiresAt: new Date(Date.now() + 86400000),
        },
        async () => ({ status: 200, body: { case_id: caseId } }),
      ),
    );
    const c = await uow.run(principal.tenant_id, (tx) =>
      readOffboardingCase(tx, caseId),
    );
    if (
      [
        "READY_TO_CLOSE",
        "COMPLETED",
        "CANCELLED",
        "CANCELLATION_PENDING",
      ].includes(c.state)
    ) {
      json(res, 200, { data: c, meta: context });
      return true;
    }
    await processClearances({
      uow,
      tenantId: principal.tenant_id,
      caseId,
      userId: String(c.user_id),
      actorId: principal.id,
      reason: text(b, "reason"),
      config,
      principal,
      context,
      key,
    });
    json(res, 200, {
      data: await uow.run(principal.tenant_id, (tx) =>
        readOffboardingCase(tx, caseId),
      ),
      meta: context,
    });
    return true;
  }
  if (actionName === "start") {
    fields(b, ["expected_version", "user_expected_version", "reason"]);
    const before = await uow.run(principal.tenant_id, (tx) =>
      readOffboardingCase(tx, caseId),
    );
    const result = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "OFFBOARDING.START",
          businessScope: caseId,
          key,
          semanticRequest: b as never,
          expiresAt: new Date(Date.now() + 86400000),
        },
        async () => {
          const started = await startExistingOffboarding({
            tx,
            caseId,
            expectedCaseVersion: int(b, "expected_version"),
            expectedUserVersion: int(b, "user_expected_version"),
            reason: text(b, "reason"),
            actorId: principal.id,
            correlationId: context.correlation_id,
          });
          await effects({
            tx,
            config,
            principal,
            context,
            key,
            eventType: "OFFBOARDING.STARTED",
            caseId,
            version: started.version,
            reason: text(b, "reason"),
            payload: {
              offboarding_case_id: caseId,
              user_id: started.user_id,
              case_version: started.version,
              user_version: started.user_version,
              from_state: "INITIATED",
              to_state: "IN_PROGRESS",
              pre_offboarding_user_state: started.pre_offboarding_user_state,
              termination_request_id: String(before.termination_request_id),
              started_at: new Date().toISOString(),
              reason: text(b, "reason"),
            },
          });
          await effects({
            tx,
            config,
            principal,
            context,
            key: `${key}:user-terminating`,
            eventType: "USER.TERMINATING",
            caseId,
            aggregateType: "USER",
            aggregateId: started.user_id,
            version: started.user_version,
            reason: text(b, "reason"),
            payload: {
              user_id: started.user_id,
              effective_at: new Date().toISOString(),
              termination_source: String(before.termination_request_id),
              offboarding_case_id: caseId,
            },
          });
          return { status: 200, body: started as never };
        },
      ),
    );
    const started = result.body as { id: string; user_id: string };
    await processClearances({
      uow,
      tenantId: principal.tenant_id,
      caseId,
      userId: started.user_id,
      actorId: principal.id,
      reason: text(b, "reason"),
      config,
      principal,
      context,
      key,
    });
    json(res, result.status, {
      data: await uow.run(principal.tenant_id, (tx) =>
        readOffboardingCase(tx, caseId),
      ),
      meta: context,
    });
    return true;
  }
  const command =
    actionName === "resume"
      ? "RESUME"
      : actionName === "mark-ready"
        ? "MARK_READY"
        : actionName === "complete"
          ? "COMPLETE"
          : actionName === "cancel"
            ? "CANCEL"
            : actionName === "request-cancel"
              ? "REQUEST_CANCEL"
              : "COMPLETE_CANCELLATION";
  const before = await uow.run(principal.tenant_id, (tx) =>
    readOffboardingCase(tx, caseId),
  );
  const result = await uow.run(principal.tenant_id, (tx) =>
    new PostgresIdempotencyStore(tx).execute(
      {
        principalId: principal.id,
        operation: `OFFBOARDING.${command}`,
        businessScope: caseId,
        key,
        semanticRequest: b as never,
        expiresAt: new Date(Date.now() + 86400000),
      },
      async () => {
        const lifecycleBefore = await tx.query(
          "SELECT employment_status FROM identity.users WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [principal.tenant_id, before.user_id],
        );
        const changed = await transitionOffboardingCase({
          tx,
          caseId,
          expectedVersion: int(b, "expected_version"),
          command,
          reason: text(b, "reason"),
          actorId: principal.id,
          correlationId: context.correlation_id,
          ...(typeof b.withdrawal_reference === "string"
            ? { withdrawalReference: b.withdrawal_reference }
            : {}),
          ...(Number.isSafeInteger(b.user_expected_version)
            ? { userExpectedVersion: Number(b.user_expected_version) }
            : {}),
        });
        if (
          command === "COMPLETE" &&
          lifecycleBefore.rows[0]?.employment_status !== "TERMINATED"
        ) {
          const lifecycleAfter = await tx.query(
            "SELECT version FROM identity.users WHERE tenant_id=$1 AND id=$2",
            [principal.tenant_id, before.user_id],
          );
          await effects({
            tx,
            config,
            principal,
            context,
            key: `${key}:user-terminated`,
            eventType: "USER.TERMINATED",
            caseId,
            aggregateType: "USER",
            aggregateId: String(before.user_id),
            version: Number(lifecycleAfter.rows[0]!.version),
            reason: text(b, "reason"),
            payload: {
              user_id: String(before.user_id),
              terminated_at: new Date().toISOString(),
              offboarding_case_id: caseId,
              clearance_state: "SUCCEEDED",
            },
          });
        }
        const eventType =
          command === "RESUME"
            ? "OFFBOARDING.RESUMED"
            : command === "MARK_READY"
              ? "OFFBOARDING.READY_TO_CLOSE"
              : command === "REQUEST_CANCEL"
                ? "OFFBOARDING.CANCELLATION_REQUESTED"
                : command === "COMPLETE_CANCELLATION" || command === "CANCEL"
                  ? "OFFBOARDING.CANCELLED"
                  : "OFFBOARDING.COMPLETED";
        if (command === "REQUEST_CANCEL") {
          await addRecoveryAction({
            tx,
            caseId,
            sourceActionId: caseId,
            actionType: "RESTORE_ACCESS_OR_ACCEPT_EXCEPTION",
            reason: text(b, "reason"),
          });
          for (const task of before.clearances)
            if (task.state !== "SUCCEEDED")
              await addRecoveryAction({
                tx,
                caseId,
                sourceActionId: String(task.resource_id ?? task.id),
                actionType: `RECOVER_${task.clearance_type}`,
                reason: text(b, "reason"),
              });
        }
        const after = await readOffboardingCase(tx, caseId);
        const userState = await tx.query(
          "SELECT employment_status,version FROM identity.users WHERE tenant_id=$1 AND id=$2",
          [principal.tenant_id, before.user_id],
        );
        const recoveryActions = after.recovery_actions;
        const eventAt = new Date().toISOString();
        await effects({
          tx,
          config,
          principal,
          context,
          key,
          eventType,
          caseId,
          version: changed.version,
          reason: text(b, "reason"),
          payload: {
            offboarding_case_id: caseId,
            case_id: caseId,
            user_id: String(before.user_id),
            case_version: changed.version,
            user_version: Number(userState.rows[0]!.version),
            from_state: changed.from_state,
            to_state: changed.state,
            user_lifecycle_state: String(userState.rows[0]!.employment_status),
            pre_offboarding_user_state: String(
              after.pre_offboarding_user_state,
            ),
            termination_request_id: String(after.termination_request_id),
            termination_request_withdrawal_reference:
              after.termination_request_withdrawal_reference ?? null,
            recovery_action_ids: recoveryActions.map((a) => a.id),
            recovery_dispositions: recoveryActions.map((a) => ({
              recovery_action_id: a.id,
              disposition: a.disposition,
            })),
            mandatory_task_summary: after.clearances.map((c) => ({
              clearance_id: c.id,
              type: c.clearance_type,
              state: c.state,
            })),
            clearance_summary: after.clearances.map((c) => ({
              clearance_id: c.id,
              type: c.clearance_type,
              state: c.state,
            })),
            reason: text(b, "reason"),
            requested_at: eventAt,
            ready_at: eventAt,
            completed_at: eventAt,
            cancelled_at: eventAt,
          },
        });
        if (
          command === "COMPLETE" ||
          command === "CANCEL" ||
          command === "COMPLETE_CANCELLATION"
        )
          await resolveOffboardingWorkItem({ tx, caseId });
        return { status: 200, body: changed as never };
      },
    ),
  );
  json(res, result.status, { data: result.body, meta: context });
  return true;
}
