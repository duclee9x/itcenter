import type { Config } from "../../../packages/config/src/index.js";
import {
  createHttpServer,
  json,
} from "../../../packages/observability/src/index.js";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
} from "../../../packages/auth/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { OperationRegistry } from "../../../packages/persistence/src/operations.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  evaluateAuthorization,
  grantTemporary,
  revokeSession,
  revokeTemporary,
} from "../../../modules/identity/index.js";
import {
  createAsset,
  assignAsset,
  reserveAsset,
  transferAsset,
  requestReturn,
  receiveReturn,
  transitionLifecycle,
} from "../../../modules/asset/index.js";
import {
  createTicket,
  enrichTicket,
  transitionTicket,
} from "../../../modules/ticket/index.js";
import {
  createTicketWorkItem,
  resolveWorkItem,
} from "../../../modules/work-queue/index.js";
import { normalizeMonitoringEvent } from "../../../modules/monitoring/index.js";
import { issueEnrollmentToken } from "../../../modules/agent/index.js";
import {
  createApproval,
  decideApproval,
  startSla,
  transitionSla,
} from "../../../modules/control-plane/index.js";
import {
  createProblem,
  transitionRecord,
} from "../../../modules/problem/index.js";
import {
  createMaintenance,
  createWarranty,
  transitionMaintenance,
} from "../../../modules/maintenance/index.js";
import {
  createIncident,
  correlateIncident,
  declareMajor,
  publishCommunication,
  transitionIncident,
} from "../../../modules/incident/index.js";
import {
  PostgresIdempotencyStore,
  PostgresOutboxWriter,
} from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import { randomUUID } from "node:crypto";
export function apiServer(
  config: Config,
  ready: () => Promise<boolean>,
  authentication: AuthenticationPort,
  authorization: AuthorizationPort,
  uow: UnitOfWork,
) {
  return createHttpServer(config, ready, async (req, res, context) => {
    if (req.method !== "GET" && req.method !== "POST") return false;
    const searchMatch = /^\/api\/v1\/search(?:\?q=([^&]+))?$/.exec(
      req.url ?? "",
    );
    const timelineMatch = /^\/api\/v1\/tickets\/([^/]+)\/timeline$/.exec(
      req.url ?? "",
    );
    if (req.method === "GET" && (searchMatch || timelineMatch)) {
      const principal = await authenticate(
        authentication,
        req.headers.authorization,
      );
      const result = await uow.run(principal.tenant_id, async (tx) => {
        if (timelineMatch)
          return (
            await tx.query(
              "SELECT id,event_type,summary,payload,occurred_at FROM operations.timeline_events WHERE tenant_id=$1 AND entity_type='TICKET' AND entity_id=$2 ORDER BY occurred_at DESC",
              [principal.tenant_id, timelineMatch[1]!],
            )
          ).rows;
        const q = decodeURIComponent(searchMatch?.[1] ?? "").trim();
        if (!q) return [];
        return (
          await tx.query(
            "SELECT entity_type,entity_id,exact_key,searchable_text,updated_at FROM operations.search_documents WHERE tenant_id=$1 AND (exact_key=$2 OR searchable_text LIKE $3) ORDER BY CASE WHEN exact_key=$2 THEN 0 ELSE 1 END, updated_at DESC LIMIT 50",
            [principal.tenant_id, q, `${q}%`],
          )
        ).rows;
      });
      json(res, 200, { data: result, meta: context });
      return true;
    }
    const retireMatch = /^\/api\/v1\/assets\/([^/]+)\/commands\/retire$/.exec(
      req.url ?? "",
    );
    const reserveMatch = /^\/api\/v1\/assets\/([^/]+)\/commands\/reserve$/.exec(
      req.url ?? "",
    );
    const assignMatch = /^\/api\/v1\/assets\/([^/]+)\/commands\/assign$/.exec(
      req.url ?? "",
    );
    const transferMatch =
      /^\/api\/v1\/assets\/([^/]+)\/commands\/transfer$/.exec(req.url ?? "");
    const requestReturnMatch =
      /^\/api\/v1\/assets\/([^/]+)\/commands\/request-return$/.exec(
        req.url ?? "",
      );
    const receiveReturnMatch =
      /^\/api\/v1\/assets\/([^/]+)\/commands\/receive-return$/.exec(
        req.url ?? "",
      );
    const ticketCreateMatch = req.url === "/api/v1/tickets";
    const ticketCommandMatch =
      /^\/api\/v1\/tickets\/([^/]+)\/commands\/([^/]+)$/.exec(req.url ?? "");
    const workResolveMatch =
      /^\/api\/v1\/work-items\/([^/]+)\/commands\/resolve$/.exec(req.url ?? "");
    const incidentTransitionMatch =
      /^\/api\/v1\/incidents\/([^/]+)\/commands\/transition$/.exec(
        req.url ?? "",
      );
    const incidentCorrelateMatch =
      /^\/api\/v1\/incidents\/([^/]+)\/commands\/correlate$/.exec(
        req.url ?? "",
      );
    const majorMatch =
      /^\/api\/v1\/incidents\/([^/]+)\/commands\/declare-major$/.exec(
        req.url ?? "",
      );
    const communicationMatch =
      /^\/api\/v1\/incidents\/([^/]+)\/communications$/.exec(req.url ?? "");
    const slaTransitionMatch =
      /^\/api\/v1\/sla-instances\/([^/]+)\/commands\/transition$/.exec(
        req.url ?? "",
      );
    const approvalDecisionMatch =
      /^\/api\/v1\/approvals\/([^/]+)\/commands\/(approve|reject)$/.exec(
        req.url ?? "",
      );
    const recordTransitionMatch =
      /^\/api\/v1\/(problems|changes|knowledge)\/([^/]+)\/commands\/transition$/.exec(
        req.url ?? "",
      );
    const recordCreateKind =
      req.url === "/api/v1/problems"
        ? "PROBLEM"
        : req.url === "/api/v1/changes"
          ? "CHANGE"
          : req.url === "/api/v1/knowledge"
            ? "KNOWLEDGE"
            : null;
    const maintenanceTransitionMatch =
      /^\/api\/v1\/maintenance\/([^/]+)\/commands\/transition$/.exec(
        req.url ?? "",
      );
    const isWarrantyCreate = req.url === "/api/v1/warranties";
    const isMaintenanceCreate = req.url === "/api/v1/maintenance";
    if (
      req.method === "POST" &&
      (maintenanceTransitionMatch || isWarrantyCreate || isMaintenanceCreate)
    ) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      await authorize(authorization, {
        principal,
        action: "maintenance.manage",
        resource: {
          type: "maintenance",
          id:
            maintenanceTransitionMatch?.[1] ?? String(input.asset_id ?? "new"),
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: maintenanceTransitionMatch
              ? "MAINTENANCE.TRANSITION"
              : isWarrantyCreate
                ? "WARRANTY.CREATE"
                : "MAINTENANCE.CREATE",
            businessScope:
              maintenanceTransitionMatch?.[1] ??
              String(input.asset_id ?? "new"),
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const value = maintenanceTransitionMatch
              ? await transitionMaintenance({
                  tx,
                  id: maintenanceTransitionMatch[1]!,
                  expectedVersion: input.expected_version as number,
                  targetState: input.target_state as string,
                  reason: input.reason as string,
                })
              : isWarrantyCreate
                ? await createWarranty({
                    tx,
                    assetId: input.asset_id as string,
                    provider: input.provider as string,
                    contractRef: input.contract_ref as string | undefined,
                    startsAt: input.starts_at as string,
                    endsAt: input.ends_at as string,
                    coverage: input.coverage as string,
                  })
                : await createMaintenance({
                    tx,
                    assetId: input.asset_id as string,
                    title: input.title as string,
                    description: input.description as string,
                    warrantyId: input.warranty_id as string | undefined,
                  });
            const output = value as unknown as Record<string, unknown>;
            const eventType = maintenanceTransitionMatch
              ? "MAINTENANCE.STATE_CHANGED"
              : isWarrantyCreate
                ? "WARRANTY.CREATED"
                : "MAINTENANCE.CREATED";
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: eventType,
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: isWarrantyCreate ? "WARRANTY" : "MAINTENANCE",
                id: value.id,
                version: (output.version as number | undefined) ?? 1,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: value,
            });
            return {
              status: maintenanceTransitionMatch ? 200 : 201,
              body: value,
            };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && (recordCreateKind || recordTransitionMatch)) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const kind =
        recordCreateKind ??
        (recordTransitionMatch![1] === "problems"
          ? "PROBLEM"
          : recordTransitionMatch![1] === "changes"
            ? "CHANGE"
            : "KNOWLEDGE");
      const isTransition = Boolean(recordTransitionMatch);
      const permission =
        kind === "PROBLEM"
          ? "problem.manage"
          : kind === "CHANGE"
            ? "change.manage"
            : "knowledge.manage";
      await authorize(authorization, {
        principal,
        action: permission,
        resource: {
          type: kind.toLowerCase(),
          id: recordTransitionMatch?.[2] ?? String(input.code ?? "new"),
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: isTransition ? `${kind}.TRANSITION` : `${kind}.CREATE`,
            businessScope:
              recordTransitionMatch?.[2] ?? String(input.code ?? "new"),
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const value = isTransition
              ? await transitionRecord({
                  tx,
                  kind: kind as "PROBLEM" | "CHANGE" | "KNOWLEDGE",
                  id: recordTransitionMatch![2]!,
                  expectedVersion: input.expected_version as number,
                  targetState: input.target_state as string,
                  reason: input.reason as string,
                })
              : await createProblem({
                  tx,
                  kind: kind as "PROBLEM" | "CHANGE" | "KNOWLEDGE",
                  code: input.code as string,
                  title: input.title as string,
                  body: input.body as string | undefined,
                  risk: input.risk as string | undefined,
                  impact: input.impact as string | undefined,
                  implementationPlan: input.implementation_plan as
                    string | undefined,
                });
            const now = new Date().toISOString();
            const eventType = isTransition
              ? `${kind}.STATE_CHANGED`
              : `${kind}.CREATED`;
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: eventType,
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: { type: kind, id: value.id, version: value.version },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: value,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: eventType,
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: eventType },
              subject: { entity_type: kind, entity_id: value.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: eventType,
                text: (input.reason as string) ?? "Record created",
              },
              before: null,
              after: value,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: isTransition ? 200 : 201, body: value };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (
      req.method === "POST" &&
      (req.url === "/api/v1/approvals" || approvalDecisionMatch)
    ) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const isDecision = Boolean(approvalDecisionMatch);
      await authorize(authorization, {
        principal,
        action: isDecision ? "approval.decide" : "approval.create",
        resource: {
          type: "approval",
          id: approvalDecisionMatch?.[1] ?? String(input.source_id ?? "new"),
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: isDecision ? "APPROVAL.DECIDE" : "APPROVAL.CREATE",
            businessScope:
              approvalDecisionMatch?.[1] ?? String(input.source_id ?? "new"),
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const value = isDecision
              ? await decideApproval({
                  tx,
                  requestId: approvalDecisionMatch![1]!,
                  expectedVersion: input.expected_version as number,
                  actorId: principal.id,
                  decision:
                    approvalDecisionMatch![2] === "approve"
                      ? "APPROVED"
                      : "REJECTED",
                  reason: input.reason as string,
                })
              : await createApproval({
                  tx,
                  sourceType: input.source_type as string,
                  sourceId: input.source_id as string,
                  policyId: input.policy_id as string,
                  policyVersion: input.policy_version as number,
                  requesterId: principal.id,
                  context: input.context,
                });
            const now = new Date().toISOString();
            const eventType = isDecision
              ? `APPROVAL.${value.state}`
              : "APPROVAL.CREATED";
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: eventType,
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "APPROVAL",
                id: value.id,
                version: value.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: value,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: eventType,
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: eventType },
              subject: { entity_type: "APPROVAL", entity_id: value.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: eventType,
                text: (input.reason as string) ?? "Approval created",
              },
              before: null,
              after: value,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: isDecision ? 200 : 201, body: value };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (
      req.method === "POST" &&
      (req.url === "/api/v1/sla-instances" || slaTransitionMatch)
    ) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const isTransition = Boolean(slaTransitionMatch);
      await authorize(authorization, {
        principal,
        action: "sla.manage",
        resource: {
          type: "sla",
          id: slaTransitionMatch?.[1] ?? String(input.object_id ?? "new"),
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: isTransition ? "SLA.TRANSITION" : "SLA.START",
            businessScope:
              slaTransitionMatch?.[1] ?? String(input.object_id ?? "new"),
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const value = isTransition
              ? await transitionSla({
                  tx,
                  instanceId: slaTransitionMatch![1]!,
                  expectedVersion: input.expected_version as number,
                  targetState: input.target_state as string,
                  reason: input.reason as string,
                })
              : await startSla({
                  tx,
                  objectType: input.object_type as string,
                  objectId: input.object_id as string,
                  targetId: input.target_id as string,
                  now:
                    typeof input.started_at === "string"
                      ? input.started_at
                      : new Date().toISOString(),
                });
            const now = new Date().toISOString();
            const eventType = isTransition
              ? "SLA.STATE_CHANGED"
              : "SLA.STARTED";
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: eventType,
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "SLA_INSTANCE",
                id: value.id,
                version: value.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: value,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: eventType,
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: eventType },
              subject: { entity_type: "SLA_INSTANCE", entity_id: value.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: eventType,
                text: (input.reason as string) ?? "SLA started",
              },
              before: null,
              after: value,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: isTransition ? 200 : 201, body: value };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && (majorMatch || communicationMatch)) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const isMajor = Boolean(majorMatch);
      await authorize(authorization, {
        principal,
        action: isMajor ? "incident.declare_major" : "incident.communicate",
        resource: {
          type: "incident",
          id: (majorMatch ?? communicationMatch)![1]!,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: isMajor
              ? "INCIDENT.DECLARE_MAJOR"
              : "INCIDENT.COMMUNICATE",
            businessScope: (majorMatch ?? communicationMatch)![1]!,
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const value = isMajor
              ? await declareMajor({
                  tx,
                  incidentId: (majorMatch ?? communicationMatch)![1]!,
                  expectedVersion: input.expected_version as number,
                  reason: input.reason as string,
                  cadence: input.communication_cadence as string,
                })
              : await publishCommunication({
                  tx,
                  incidentId: communicationMatch![1]!,
                  audience: input.audience as string,
                  channel: input.channel as string,
                  subject: input.subject as string,
                  body: input.body as string,
                });
            const now = new Date().toISOString();
            const eventType = isMajor
              ? "INCIDENT.MAJOR_DECLARED"
              : "INCIDENT.COMMUNICATION.PUBLISHED";
            const output = value as unknown as Record<string, unknown>;
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: eventType,
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "INCIDENT",
                id: (output.id ?? output.incident_id) as string,
                version: (output.version as number | undefined) ?? 1,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: value,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: eventType,
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: eventType },
              subject: {
                entity_type: "INCIDENT",
                entity_id: (output.id ?? output.incident_id) as string,
              },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: eventType,
                text:
                  (input.reason as string) ??
                  (input.subject as string) ??
                  "Major incident communication",
              },
              before: null,
              after: value,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 201, body: value };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (
      req.method === "POST" &&
      (req.url === "/api/v1/incidents" ||
        incidentTransitionMatch ||
        incidentCorrelateMatch)
    ) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const isTransition = Boolean(incidentTransitionMatch);
      const isCorrelation = Boolean(incidentCorrelateMatch);
      const action = isCorrelation
        ? "incident.correlate"
        : isTransition
          ? "incident.update"
          : "incident.create";
      await authorize(authorization, {
        principal,
        action,
        resource: {
          type: "incident",
          id:
            incidentTransitionMatch?.[1] ??
            incidentCorrelateMatch?.[1] ??
            String(input.incident_code ?? "new"),
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: isCorrelation
              ? "INCIDENT.CORRELATE"
              : isTransition
                ? "INCIDENT.TRANSITION"
                : "INCIDENT.CREATE",
            businessScope:
              incidentTransitionMatch?.[1] ??
              incidentCorrelateMatch?.[1] ??
              String(input.incident_code ?? "new"),
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const value = isCorrelation
              ? await correlateIncident({
                  tx,
                  childIncidentId: incidentCorrelateMatch![1]!,
                  rootIncidentId: input.root_incident_id as string,
                  relatedEntityType: input.related_entity_type as
                    "INCIDENT" | "TICKET",
                  relatedEntityId: input.related_entity_id as string,
                  reason: input.reason as string,
                  score: input.correlation_score as number | undefined,
                })
              : isTransition
                ? await transitionIncident({
                    tx,
                    incidentId: incidentTransitionMatch![1]!,
                    expectedVersion: input.expected_version as number,
                    targetState: input.target_state as string,
                    reason: input.reason as string,
                    verification: input.verification as string | undefined,
                    resolutionSummary: input.resolution_summary as
                      string | undefined,
                    postChecks: input.post_checks as string | undefined,
                  })
                : await createIncident({
                    tx,
                    incidentCode: input.incident_code as string,
                    title: input.title as string,
                    source: input.source as string,
                    monitoringEventId: input.monitoring_event_id as
                      string | undefined,
                    priority: input.priority as string,
                    serviceId: input.service_id as string | undefined,
                  });
            const now = new Date().toISOString();
            const output = value as unknown as Record<string, unknown>;
            const eventType = isCorrelation
              ? "INCIDENT.CORRELATED"
              : isTransition
                ? "INCIDENT.STATE_CHANGED"
                : "INCIDENT.CREATED";
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: eventType,
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "INCIDENT",
                id: (output.id ?? output.root_incident_id) as string,
                version: (output.version as number | undefined) ?? 1,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: value,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: eventType,
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: eventType },
              subject: {
                entity_type: "INCIDENT",
                entity_id: (output.id ?? output.root_incident_id) as string,
              },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: eventType,
                text: (input.reason as string) ?? "Incident created",
              },
              before: null,
              after: value,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return {
              status: isTransition || isCorrelation ? 200 : 201,
              body: value,
            };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && req.url === "/api/v1/agents/enroll") {
      const principal = await authenticate(
        authentication,
        req.headers.authorization,
      );
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      if (
        typeof input.asset_id !== "string" ||
        typeof input.agent_version !== "string"
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "asset_id and agent_version are required.",
        );
      await authorize(authorization, {
        principal,
        action: "agent.enroll",
        resource: {
          type: "agent",
          id: input.asset_id,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, async (tx) => {
        const enrollment = await issueEnrollmentToken({
          tx,
          assetId: input.asset_id as string,
          agentVersion: input.agent_version as string,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
        const now = new Date().toISOString();
        await new PostgresOutboxWriter(tx).append({
          event_id: randomUUID(),
          event_type: "AGENT.ENROLLED",
          schema_version: 1,
          occurred_at: now,
          producer: { service: config.serviceName, instance: "api" },
          aggregate: { type: "AGENT", id: enrollment.id, version: 1 },
          actor: { type: principal.actor_type, id: principal.id },
          correlation_id: context.correlation_id,
          causation_id: context.causation_id,
          tenant_id: principal.tenant_id,
          organization_id: principal.tenant_id,
          idempotency_key: randomUUID(),
          payload: {
            agent_id: enrollment.id,
            asset_id: enrollment.asset_id,
            agent_version: enrollment.agent_version,
            enrolled_at: now,
          },
        });
        return enrollment;
      });
      json(res, 201, { data: result, meta: context });
      return true;
    }
    if (req.method === "POST" && req.url === "/api/v1/monitoring/events") {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const event = normalizeMonitoringEvent(input);
      await authorize(authorization, {
        principal,
        action: "monitoring.event.write",
        resource: {
          type: "monitoring_event",
          id: event.provider_event_id,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "MONITORING.EVENT.WRITE",
            businessScope: `${event.source}:${event.provider_event_id}`,
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const inserted = await tx.query(
              "INSERT INTO monitoring.events(id,tenant_id,source,provider_event_id,asset_id,service_id,metric,observed_value,threshold,severity,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id,source,provider_event_id) DO NOTHING RETURNING id,source,provider_event_id,asset_id,service_id,metric,observed_value,threshold,severity,observed_at",
              [
                randomUUID(),
                principal.tenant_id,
                event.source,
                event.provider_event_id,
                event.asset_id,
                event.service_id,
                event.metric,
                event.observed_value,
                event.threshold,
                event.severity,
                event.observed_at,
              ],
            );
            const observation =
              inserted.rows[0] ??
              (
                await tx.query(
                  "SELECT id,source,provider_event_id,asset_id,service_id,metric,observed_value,threshold,severity,observed_at FROM monitoring.events WHERE tenant_id=$1 AND source=$2 AND provider_event_id=$3",
                  [principal.tenant_id, event.source, event.provider_event_id],
                )
              ).rows[0];
            if (!observation)
              throw new ApplicationError(
                "BUSINESS_RULE_VIOLATION",
                "Monitoring event could not be persisted.",
              );
            const eventType =
              event.severity === "RECOVERED"
                ? "MONITORING.RECOVERED"
                : "MONITORING.CRITICAL";
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: eventType,
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "MONITORING_EVENT",
                id: observation.id,
                version: 1,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: observation,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: eventType,
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: "MONITORING.EVENT.WRITE" },
              subject: {
                entity_type: "MONITORING_EVENT",
                entity_id: observation.id,
              },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: { code: "MONITORING_INGESTED", text: event.source },
              before: null,
              after: observation,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 201, body: observation };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && workResolveMatch) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      if (
        !Number.isSafeInteger(input.expected_version) ||
        typeof input.reason !== "string"
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "expected_version and reason are required.",
        );
      await authorize(authorization, {
        principal,
        action: "work_item.resolve",
        resource: {
          type: "work_item",
          id: workResolveMatch[1]!,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "WORK_ITEM.RESOLVE",
            businessScope: workResolveMatch[1]!,
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const item = await resolveWorkItem({
              tx,
              workItemId: workResolveMatch[1]!,
              expectedVersion: input.expected_version as number,
              reason: input.reason as string,
            });
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "WORK_ITEM.RESOLVED",
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "WORK_ITEM",
                id: item.id,
                version: item.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: item,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: "WORK_ITEM.RESOLVED",
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: "WORK_ITEM.RESOLVE" },
              subject: { entity_type: "WORK_ITEM", entity_id: item.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: "WORK_ITEM_RESOLVED",
                text: input.reason as string,
              },
              before: { version: input.expected_version as number },
              after: item,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 200, body: item };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && (ticketCreateMatch || ticketCommandMatch)) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const action = ticketCreateMatch
        ? "ticket.create"
        : ticketCommandMatch![2] === "resolve"
          ? "ticket.resolve"
          : ticketCommandMatch![2] === "reopen"
            ? "ticket.reopen"
            : ticketCommandMatch![2] === "assign"
              ? "ticket.assign"
              : ticketCommandMatch![2] === "enrich"
                ? "ticket.update"
                : "ticket.update";
      const scopeId = ticketCreateMatch
        ? principal.id
        : ticketCommandMatch![1]!;
      await authorize(authorization, {
        principal,
        action,
        resource: {
          type: "ticket",
          id: scopeId,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: ticketCreateMatch
              ? "TICKET.CREATE"
              : `TICKET.${ticketCommandMatch![2]!.toUpperCase()}`,
            businessScope: scopeId,
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const value = ticketCreateMatch
              ? await createTicket({
                  tx,
                  ticketCode: input.ticket_code as string,
                  title: input.title as string,
                  description: input.description as string,
                  requesterUserId: input.requester_user_id as string,
                  priority: input.priority as string,
                  sourceChannel: input.source_channel as string,
                })
              : ticketCommandMatch![2] === "enrich"
                ? await enrichTicket({
                    tx,
                    ticketId: ticketCommandMatch![1]!,
                    expectedVersion: input.expected_version as number,
                    ...(typeof input.asset_id === "string"
                      ? { assetId: input.asset_id }
                      : {}),
                    reason: input.reason as string,
                  })
                : await transitionTicket({
                    tx,
                    ticketId: ticketCommandMatch![1]!,
                    expectedVersion: input.expected_version as number,
                    targetState:
                      ticketCommandMatch![2] === "assign"
                        ? "ASSIGNED"
                        : ticketCommandMatch![2] === "start"
                          ? "IN_PROGRESS"
                          : ticketCommandMatch![2] === "request-info"
                            ? "WAITING_USER"
                            : ticketCommandMatch![2] === "resolve"
                              ? "RESOLVED"
                              : ticketCommandMatch![2] === "reopen"
                                ? "REOPENED"
                                : ticketCommandMatch![2]!.toUpperCase(),
                    reason: input.reason as string,
                    actorType: principal.actor_type,
                    actorId: principal.id,
                    correlationId: context.correlation_id,
                    ...(typeof input.assignee_user_id === "string"
                      ? { assigneeUserId: input.assignee_user_id }
                      : {}),
                    ...(typeof input.resolution_code === "string"
                      ? { resolutionCode: input.resolution_code }
                      : {}),
                  });
            let workItem:
              Awaited<ReturnType<typeof createTicketWorkItem>> | undefined;
            if (ticketCreateMatch) {
              workItem = await createTicketWorkItem({
                tx,
                ticketId: value.id,
                title: input.title as string,
                priority: input.priority as string,
              });
              const createdAt = new Date().toISOString();
              await new PostgresOutboxWriter(tx).append({
                event_id: randomUUID(),
                event_type: "WORK_ITEM.CREATED",
                schema_version: 1,
                occurred_at: createdAt,
                producer: { service: config.serviceName, instance: "api" },
                aggregate: {
                  type: "WORK_ITEM",
                  id: workItem.id,
                  version: workItem.version,
                },
                actor: { type: principal.actor_type, id: principal.id },
                correlation_id: context.correlation_id,
                causation_id: context.causation_id,
                tenant_id: principal.tenant_id,
                organization_id: principal.tenant_id,
                idempotency_key: key,
                payload: workItem,
              });
              await tx.query(
                "INSERT INTO operations.timeline_events(id,tenant_id,entity_type,entity_id,event_type,summary,payload,source_event_id) VALUES($1,$2,'TICKET',$3,'TICKET.CREATED',$4,$5,$6)",
                [
                  randomUUID(),
                  principal.tenant_id,
                  value.id,
                  `Ticket ${input.ticket_code as string} created`,
                  JSON.stringify(value),
                  randomUUID(),
                ],
              );
              await tx.query(
                "INSERT INTO communication.notifications(id,tenant_id,recipient_user_id,event_type,subject,body,dedupe_key) VALUES($1,$2,$3,'TICKET.CREATED',$4,$5,$6) ON CONFLICT DO NOTHING",
                [
                  randomUUID(),
                  principal.tenant_id,
                  input.requester_user_id as string,
                  "Ticket created",
                  `Ticket ${input.ticket_code as string} was created.`,
                  `ticket-created:${value.id}`,
                ],
              );
              await tx.query(
                "INSERT INTO operations.search_documents(id,tenant_id,entity_type,entity_id,exact_key,searchable_text) VALUES($1,$2,'TICKET',$3,$4,$5) ON CONFLICT (tenant_id,entity_type,entity_id) DO UPDATE SET exact_key=EXCLUDED.exact_key,searchable_text=EXCLUDED.searchable_text,updated_at=now()",
                [
                  randomUUID(),
                  principal.tenant_id,
                  value.id,
                  input.ticket_code as string,
                  `${input.ticket_code as string} ${input.title as string}`,
                ],
              );
            }
            const eventType = ticketCreateMatch
              ? "TICKET.CREATED"
              : ticketCommandMatch![2] === "enrich"
                ? "TICKET.ENRICHED"
                : ticketCommandMatch![2] === "resolve"
                  ? "TICKET.RESOLVED"
                  : ticketCommandMatch![2] === "reopen"
                    ? "TICKET.REOPENED"
                    : "TICKET.STATE_CHANGED";
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: eventType,
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "TICKET",
                id: value.id,
                version: value.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: value,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: eventType,
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: {
                command_type: ticketCreateMatch
                  ? "TICKET.CREATE"
                  : `TICKET.${ticketCommandMatch![2]!.toUpperCase()}`,
              },
              subject: { entity_type: "TICKET", entity_id: value.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: eventType,
                text: (input.reason as string) ?? "Ticket created",
              },
              before: null,
              after: value,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 201, body: value };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && (requestReturnMatch || receiveReturnMatch)) {
      const match = requestReturnMatch ?? receiveReturnMatch!;
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const request = Boolean(requestReturnMatch);
      const action = request ? "asset.request_return" : "asset.receive_return";
      await authorize(authorization, {
        principal,
        action,
        resource: {
          type: "asset",
          id: match[1]!,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const required = request
        ? Number.isSafeInteger(input.expected_version) &&
          typeof input.due_at === "string" &&
          typeof input.reason === "string"
        : Number.isSafeInteger(input.expected_version) &&
          typeof input.return_request_id === "string" &&
          typeof input.received_location_id === "string" &&
          typeof input.condition_grade === "string" &&
          typeof input.notes === "string";
      if (!required)
        throw new ApplicationError(
          "VALIDATION_ERROR",
          request
            ? "expected_version, due_at and reason are required."
            : "expected_version, return_request_id, received_location_id, condition_grade and notes are required.",
        );
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: request
              ? "ASSET.REQUEST_RETURN"
              : "ASSET.RECEIVE_RETURN",
            businessScope: match[1]!,
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const value = request
              ? await requestReturn({
                  tx,
                  assetId: match[1]!,
                  expectedVersion: input.expected_version as number,
                  dueAt: input.due_at as string,
                  reason: input.reason as string,
                })
              : await receiveReturn({
                  tx,
                  assetId: match[1]!,
                  expectedVersion: input.expected_version as number,
                  returnRequestId: input.return_request_id as string,
                  receivedLocationId: input.received_location_id as string,
                  conditionGrade: input.condition_grade as string,
                  notes: input.notes as string,
                });
            const eventType = request
              ? "ASSET.RETURN_REQUESTED"
              : "ASSET.RETURNED";
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: eventType,
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "ASSET",
                id: value.asset_id,
                version: value.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: value,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: eventType,
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: {
                command_type: request
                  ? "ASSET.REQUEST_RETURN"
                  : "ASSET.RECEIVE_RETURN",
              },
              subject: { entity_type: "ASSET", entity_id: value.asset_id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: eventType,
                text: request
                  ? (input.reason as string)
                  : (input.notes as string),
              },
              before: { version: input.expected_version as number },
              after: value,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 201, body: value };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && transferMatch) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      if (
        !Number.isSafeInteger(input.expected_version) ||
        typeof input.to_location_id !== "string" ||
        typeof input.to_user_id !== "string" ||
        typeof input.reason !== "string"
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "expected_version, to_location_id, to_user_id and reason are required.",
        );
      await authorize(authorization, {
        principal,
        action: "asset.transfer",
        resource: {
          type: "asset",
          id: transferMatch[1]!,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "ASSET.TRANSFER",
            businessScope: transferMatch[1]!,
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const movement = await transferAsset({
              tx,
              assetId: transferMatch[1]!,
              expectedVersion: input.expected_version as number,
              toLocationId: input.to_location_id as string,
              toUserId: input.to_user_id as string,
              reason: input.reason as string,
              actorType: principal.actor_type,
              actorId: principal.id,
              correlationId: context.correlation_id,
            });
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "ASSET.TRANSFERRED",
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "ASSET",
                id: movement.asset_id,
                version: movement.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: movement,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: "ASSET.TRANSFERRED",
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: "ASSET.TRANSFER" },
              subject: { entity_type: "ASSET", entity_id: movement.asset_id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: "ASSET_TRANSFERRED",
                text: input.reason as string,
              },
              before: { version: input.expected_version as number },
              after: movement,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 201, body: movement };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && assignMatch) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      if (
        !Number.isSafeInteger(input.expected_version) ||
        typeof input.user_id !== "string" ||
        typeof input.reason !== "string"
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "expected_version, user_id and reason are required.",
        );
      await authorize(authorization, {
        principal,
        action: "asset.assign",
        resource: {
          type: "asset",
          id: assignMatch[1]!,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "ASSET.ASSIGN",
            businessScope: assignMatch[1]!,
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const assignment = await assignAsset({
              tx,
              assetId: assignMatch[1]!,
              expectedVersion: input.expected_version as number,
              userId: input.user_id as string,
              reason: input.reason as string,
              actorType: principal.actor_type,
              actorId: principal.id,
              correlationId: context.correlation_id,
            });
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "ASSET.ASSIGNED",
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "ASSET",
                id: assignment.asset_id,
                version: assignment.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: assignment,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: "ASSET.ASSIGNED",
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: "ASSET.ASSIGN" },
              subject: { entity_type: "ASSET", entity_id: assignment.asset_id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: { code: "ASSET_ASSIGNED", text: input.reason as string },
              before: { version: input.expected_version as number },
              after: assignment,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 201, body: assignment };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && reserveMatch) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      if (
        !Number.isSafeInteger(input.expected_version) ||
        typeof input.requested_for !== "string" ||
        typeof input.reason !== "string" ||
        typeof input.expires_at !== "string"
      )
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "expected_version, requested_for, reason and expires_at are required.",
        );
      await authorize(authorization, {
        principal,
        action: "asset.reserve",
        resource: {
          type: "asset",
          id: reserveMatch[1]!,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "ASSET.RESERVE",
            businessScope: reserveMatch[1]!,
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const reservation = await reserveAsset({
              tx,
              assetId: reserveMatch[1]!,
              expectedVersion: input.expected_version as number,
              requestedFor: input.requested_for as string,
              reason: input.reason as string,
              expiresAt: input.expires_at as string,
              actorType: principal.actor_type,
              actorId: principal.id,
              correlationId: context.correlation_id,
            });
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "ASSET.RESERVED",
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "ASSET",
                id: reservation.asset_id,
                version: reservation.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: reservation,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: "ASSET.RESERVED",
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: "ASSET.RESERVE" },
              subject: {
                entity_type: "ASSET",
                entity_id: reservation.asset_id,
              },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: { code: "ASSET_RESERVED", text: input.reason as string },
              before: { version: input.expected_version as number },
              after: reservation,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 201, body: reservation };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && retireMatch) {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const expected = input.expected_version;
      if (!Number.isSafeInteger(expected) || typeof input.reason !== "string")
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "expected_version and reason are required.",
        );
      await authorize(authorization, {
        principal,
        action: "asset.retire",
        resource: {
          type: "asset",
          id: retireMatch[1]!,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "ASSET.RETIRE",
            businessScope: retireMatch[1]!,
            key,
            semanticRequest: {
              expected_version: expected as number,
              reason: input.reason as string,
            },
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const changed = await transitionLifecycle({
              tx,
              assetId: retireMatch[1]!,
              expectedVersion: expected as number,
              targetState: "RETIRED",
              actorType: principal.actor_type,
              actorId: principal.id,
              reason: input.reason as string,
              correlationId: context.correlation_id,
              commandType: "ASSET.RETIRE",
            });
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "ASSET.RETIRED",
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "ASSET",
                id: changed.id,
                version: changed.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: changed,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: "ASSET.RETIRED",
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: "ASSET.RETIRE" },
              subject: { entity_type: "ASSET", entity_id: changed.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: { code: "ASSET_RETIRED", text: input.reason as string },
              before: {
                lifecycle_state: changed.from_state,
                version: expected as number,
              },
              after: changed,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 200, body: changed };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.url === "/api/v1/me") {
      const principal = await authenticate(
        authentication,
        req.headers.authorization,
      );
      json(res, 200, { data: principal, meta: context });
      return true;
    }
    if (req.method === "POST" && req.url === "/api/v1/auth/logout") {
      const principal = await authenticate(
        authentication,
        req.headers.authorization,
      );
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: { session_id?: string; expected_version?: number };
      try {
        input = JSON.parse(body) as typeof input;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      if (!input.session_id || !Number.isInteger(input.expected_version))
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "session_id and expected_version are required.",
        );
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim())
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Idempotency-Key is required.",
        );
      await authorize(authorization, {
        principal,
        action: "session.revoke",
        resource: {
          type: "session",
          id: input.session_id,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, async (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "AUTH.REVOKE_SESSION",
            businessScope: input.session_id!,
            key: idempotencyKey,
            semanticRequest: {
              session_id: input.session_id!,
              expected_version: input.expected_version!,
            },
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          async () => {
            await revokeSession(tx, input.session_id!, input.expected_version!);
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "AUTH.SESSION_REVOKED",
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "SESSION",
                id: input.session_id!,
                version: input.expected_version! + 1,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: idempotencyKey,
              payload: { session_id: input.session_id!, user_id: principal.id },
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: "AUTH.SESSION_REVOKED",
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: "AUTH.REVOKE_SESSION" },
              subject: { entity_type: "SESSION", entity_id: input.session_id! },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: {
                code: "USER_LOGOUT",
                text: "Session revoked by authenticated principal",
              },
              before: { version: input.expected_version!, revoked: false },
              after: { version: input.expected_version! + 1, revoked: true },
              outcome: { status: "SUCCESS" },
              classification: "SECURITY",
              relations: [],
              evidence: [],
            });
            return { status: 200, body: { revoked: true } };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (req.method === "POST" && req.url === "/api/v1/assets") {
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
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(body) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      await authorize(authorization, {
        principal,
        action: "asset.create",
        resource: {
          type: "asset",
          id: String(input.asset_code ?? "asset"),
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "ASSET.CREATE",
            businessScope: String(input.asset_code ?? "asset"),
            key,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const asset = await createAsset({
              tx,
              assetCode: String(input.asset_code ?? ""),
              modelId: String(input.model_id ?? ""),
              ...(typeof input.asset_tag === "string"
                ? { assetTag: input.asset_tag }
                : {}),
              ...(typeof input.serial_number === "string"
                ? { serialNumber: input.serial_number }
                : {}),
              ...(typeof input.location_id === "string"
                ? { locationId: input.location_id }
                : {}),
            });
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "ASSET.CREATED",
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: { type: "ASSET", id: asset.id, version: 1 },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: key,
              payload: asset,
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: "ASSET.CREATED",
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: "ASSET.CREATE" },
              subject: { entity_type: "ASSET", entity_id: asset.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: { code: "ASSET_REGISTERED", text: "Asset registered" },
              before: null,
              after: asset,
              outcome: { status: "SUCCESS" },
              classification: "INTERNAL",
              relations: [],
              evidence: [],
            });
            return { status: 201, body: asset };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (
      req.method === "POST" &&
      (req.url === "/api/v1/temporary-grants" ||
        /^\/api\/v1\/temporary-grants\/[^/]+\/commands\/revoke$/.test(
          req.url ?? "",
        ))
    ) {
      const principal = await authenticate(
        authentication,
        req.headers.authorization,
      );
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim())
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "Idempotency-Key is required.",
        );
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: Record<string, unknown> = {};
      try {
        input = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      const revokeMatch =
        /^\/api\/v1\/temporary-grants\/([^/]+)\/commands\/revoke$/.exec(
          req.url ?? "",
        );
      if (revokeMatch) {
        const expectedVersion =
          typeof input.expected_version === "number"
            ? input.expected_version
            : undefined;
        if (
          expectedVersion === undefined ||
          !Number.isSafeInteger(expectedVersion)
        )
          throw new ApplicationError(
            "VALIDATION_ERROR",
            "expected_version is required.",
          );
        await authorize(authorization, {
          principal,
          action: "rbac.manage",
          resource: {
            type: "temporary_grant",
            id: revokeMatch[1]!,
            tenant_id: principal.tenant_id,
          },
          scope: {},
          context: { ...context },
        });
        const result = await uow.run(principal.tenant_id, (tx) =>
          new PostgresIdempotencyStore(tx).execute(
            {
              principalId: principal.id,
              operation: "PRIVILEGE.REVOKE_TEMPORARY",
              businessScope: revokeMatch[1]!,
              key: idempotencyKey,
              semanticRequest: {
                grant_id: revokeMatch[1]!,
                expected_version: expectedVersion,
              },
              expiresAt: new Date(Date.now() + 86400000),
            },
            async () => {
              await revokeTemporary(tx, revokeMatch[1]!, expectedVersion);
              const now = new Date().toISOString();
              await new PostgresOutboxWriter(tx).append({
                event_id: randomUUID(),
                event_type: "RBAC.TEMPORARY_GRANT_REVOKED",
                schema_version: 1,
                occurred_at: now,
                producer: { service: config.serviceName, instance: "api" },
                aggregate: {
                  type: "TEMPORARY_GRANT",
                  id: revokeMatch[1]!,
                  version: expectedVersion + 1,
                },
                actor: { type: principal.actor_type, id: principal.id },
                correlation_id: context.correlation_id,
                causation_id: context.causation_id,
                tenant_id: principal.tenant_id,
                organization_id: principal.tenant_id,
                idempotency_key: idempotencyKey,
                payload: { grant_id: revokeMatch[1]!, reason: "REVOKED" },
              });
              await new PostgresAudit(tx).append({
                id: randomUUID(),
                tenant_id: principal.tenant_id,
                event_type: "RBAC.TEMPORARY_GRANT_REVOKED",
                occurred_at: now,
                actor: { type: principal.actor_type, id: principal.id },
                action: { command_type: "PRIVILEGE.REVOKE_TEMPORARY" },
                subject: {
                  entity_type: "TEMPORARY_GRANT",
                  entity_id: revokeMatch[1]!,
                },
                correlation_id: context.correlation_id,
                causation_id: context.causation_id,
                reason: {
                  code: "PRIVILEGE_REVOKED",
                  text: "Temporary grant revoked",
                },
                before: { version: expectedVersion, revoked: false },
                after: { version: expectedVersion + 1, revoked: true },
                outcome: { status: "SUCCESS" },
                classification: "SECURITY",
                relations: [],
                evidence: [],
              });
              return {
                status: 200,
                body: { grant_id: revokeMatch[1]!, revoked: true },
              };
            },
          ),
        );
        json(res, result.status, { data: result.body, meta: context });
        return true;
      }
      for (const key of [
        "principal_id",
        "permission_id",
        "scope_type",
        "scope_id",
        "valid_from",
        "valid_until",
        "reason",
      ])
        if (typeof input[key] !== "string" || !(input[key] as string).trim())
          throw new ApplicationError("VALIDATION_ERROR", `${key} is required.`);
      await authorize(authorization, {
        principal,
        action: "rbac.manage",
        resource: {
          type: "rbac",
          id: String(input.principal_id),
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "PRIVILEGE.GRANT_TEMPORARY",
            businessScope: String(input.principal_id),
            key: idempotencyKey,
            semanticRequest: input as never,
            expiresAt: new Date(Date.now() + 86400000),
          },
          async () => {
            const grant = await grantTemporary({
              tx,
              principalId: String(input.principal_id),
              permissionId: String(input.permission_id),
              scopeType: String(input.scope_type),
              scopeId: String(input.scope_id),
              validFrom: new Date(String(input.valid_from)),
              validUntil: new Date(String(input.valid_until)),
              reason: String(input.reason),
            });
            const now = new Date().toISOString();
            await new PostgresOutboxWriter(tx).append({
              event_id: randomUUID(),
              event_type: "RBAC.TEMPORARY_GRANT_CREATED",
              schema_version: 1,
              occurred_at: now,
              producer: { service: config.serviceName, instance: "api" },
              aggregate: {
                type: "TEMPORARY_GRANT",
                id: grant.id,
                version: grant.version,
              },
              actor: { type: principal.actor_type, id: principal.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              tenant_id: principal.tenant_id,
              organization_id: principal.tenant_id,
              idempotency_key: idempotencyKey,
              payload: {
                grant_id: grant.id,
                principal_id: String(input.principal_id),
                permission_id: String(input.permission_id),
                scope_type: String(input.scope_type),
                scope_id: String(input.scope_id),
                valid_until: String(input.valid_until),
              },
            });
            await new PostgresAudit(tx).append({
              id: randomUUID(),
              tenant_id: principal.tenant_id,
              event_type: "RBAC.TEMPORARY_GRANT_CREATED",
              occurred_at: now,
              actor: { type: principal.actor_type, id: principal.id },
              action: { command_type: "PRIVILEGE.GRANT_TEMPORARY" },
              subject: { entity_type: "TEMPORARY_GRANT", entity_id: grant.id },
              correlation_id: context.correlation_id,
              causation_id: context.causation_id,
              reason: { code: "PRIVILEGE_GRANTED", text: String(input.reason) },
              before: null,
              after: {
                grant_id: grant.id,
                version: grant.version,
                scope_type: String(input.scope_type),
                scope_id: String(input.scope_id),
              },
              outcome: { status: "SUCCESS" },
              classification: "SECURITY",
              relations: [],
              evidence: [],
            });
            return { status: 201, body: grant };
          },
        ),
      );
      json(res, result.status, { data: result.body, meta: context });
      return true;
    }
    if (
      req.method === "POST" &&
      (req.url === "/api/v1/authorization/evaluate" ||
        req.url === "/api/v1/authorization/evaluate-batch")
    ) {
      const principal = await authenticate(
        authentication,
        req.headers.authorization,
      );
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
      let input: {
        action?: string;
        resource_type?: string;
        resource_id?: string;
        scope?: Record<string, string>;
      };
      try {
        input = JSON.parse(body) as typeof input;
      } catch {
        throw new ApplicationError("VALIDATION_ERROR", "Invalid JSON request.");
      }
      if (req.url.endsWith("-batch")) {
        const list = input as unknown as Array<typeof input>;
        if (!Array.isArray(list) || list.length < 1 || list.length > 50)
          throw new ApplicationError(
            "VALIDATION_ERROR",
            "Batch must contain between 1 and 50 evaluations.",
          );
        const decisions = await uow.run(principal.tenant_id, async (tx) =>
          Promise.all(
            list.map((item) => {
              if (!item.action || !item.resource_type || !item.resource_id)
                throw new ApplicationError(
                  "VALIDATION_ERROR",
                  "Each evaluation requires action, resource_type and resource_id.",
                );
              return evaluateAuthorization(tx, {
                principalId: principal.id,
                tenantId: principal.tenant_id,
                action: item.action,
                resourceType: item.resource_type,
                resourceId: item.resource_id,
                scope: item.scope ?? {},
              });
            }),
          ),
        );
        json(res, 200, { data: decisions, meta: context });
        return true;
      }
      if (!input.action || !input.resource_type || !input.resource_id)
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "action, resource_type and resource_id are required.",
        );
      await authorize(authorization, {
        principal,
        action: "authorization.evaluate",
        resource: {
          type: "authorization",
          id: input.resource_id,
          tenant_id: principal.tenant_id,
        },
        scope: {},
        context: { ...context },
      });
      const decision = await uow.run(principal.tenant_id, (tx) =>
        evaluateAuthorization(tx, {
          principalId: principal.id,
          tenantId: principal.tenant_id,
          action: input.action!,
          resourceType: input.resource_type!,
          resourceId: input.resource_id!,
          scope: input.scope ?? {},
        }),
      );
      json(res, 200, { data: decision, meta: context });
      return true;
    }
    const match = /^\/api\/v1\/operations\/([^/?]+)$/.exec(req.url ?? "");
    if (!match) return false;
    const principal = await authenticate(
        authentication,
        req.headers.authorization,
      ),
      id = match[1]!;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new ApplicationError("VALIDATION_ERROR", "Invalid operation ID.");
    await authorize(authorization, {
      principal,
      action: "operation.read",
      resource: { type: "operation", id, tenant_id: principal.tenant_id },
      scope: {},
      context: { ...context },
    });
    const operation = await uow.run(principal.tenant_id, (tx) =>
      new OperationRegistry(tx).find(id),
    );
    if (!operation)
      throw new ApplicationError("NOT_FOUND", "Operation not found.");
    json(res, 200, { data: operation, meta: context });
    return true;
  });
}
