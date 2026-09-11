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
