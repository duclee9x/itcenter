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
