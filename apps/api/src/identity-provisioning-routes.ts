import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../../../packages/config/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import {
  authenticate,
  authorize,
  type AuthenticationPort,
  type AuthorizationPort,
  type Principal,
} from "../../../packages/auth/src/index.js";
import type {
  CorrelationContext,
  Json,
} from "../../../packages/shared-kernel/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { PostgresIdempotencyStore } from "../../../packages/messaging/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";
import { json } from "../../../packages/observability/src/index.js";

type Body = Record<string, unknown>;
const servicePrincipalTables: Readonly<Record<string, string>> = {
  SYSTEM_AUTOMATION: "identity.automation_principals",
  SYSTEM_CORRELATION: "identity.correlation_principals",
  SYSTEM_ASSET_SCORING: "identity.asset_scoring_principals",
  SYSTEM_RECOMMENDATION: "identity.recommendation_principals",
  SYSTEM_REPORTING: "identity.reporting_principals",
};

async function body(req: IncomingMessage): Promise<Body> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 16384)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request body is too large.",
      );
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Body;
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A JSON object is required.",
    );
  }
}

function text(input: unknown, field: string, max = 512): string {
  if (typeof input !== "string" || !input.trim() || input.length > max)
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return input.trim();
}

function opaqueIdentity(input: unknown, field: string): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > 512 ||
    input.includes("\u0000")
  )
    throw new ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return input;
}

function uuid(input: unknown, field: string): string {
  const value = text(input, field, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${field} must be a canonical identifier.`,
    );
  return value;
}

function idempotencyKey(req: IncomingMessage): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !key.trim() || key.length > 200)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
  return key.trim();
}

async function permit(input: {
  authorization: AuthorizationPort;
  principal: Principal;
  context: CorrelationContext;
  action: string;
  type: string;
}) {
  await authorize(input.authorization, {
    principal: input.principal,
    action: input.action,
    resource: {
      type: input.type,
      id: "tenant-provisioning",
      tenant_id: input.principal.tenant_id,
    },
    scope: {},
    context: { ...input.context },
  });
}

function audit(input: {
  tx: Parameters<UnitOfWork["run"]>[1] extends (tx: infer T) => Promise<unknown>
    ? T
    : never;
  principal: Principal;
  context: CorrelationContext;
  type: string;
  id: string;
  command: string;
  key: string;
  reason: string;
  before?: Json | null;
  after: Json;
}) {
  return new PostgresAudit(input.tx).append({
    id: randomUUID(),
    tenant_id: input.principal.tenant_id,
    event_type: input.command,
    occurred_at: new Date().toISOString(),
    actor: { type: input.principal.actor_type, id: input.principal.id },
    action: { command_type: input.command, idempotency_key: input.key },
    subject: { entity_type: input.type, entity_id: input.id },
    correlation_id: input.context.correlation_id,
    causation_id: input.context.causation_id,
    reason: { code: input.command, text: input.reason },
    before: input.before ?? null,
    after: input.after,
    outcome: { status: "SUCCESS" },
    classification: "RESTRICTED",
    relations: [],
    evidence: [],
  });
}

function stored(status: number, body: Json) {
  return { status, body };
}

export async function handleIdentityProvisioningRoute(input: {
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
  const url = req.url?.split("?")[0] ?? "";
  if (req.method === "POST" && url === "/api/v1/identity/links") {
    const principal = await authenticate(
      authentication,
      req.headers.authorization,
    );
    await permit({
      authorization,
      principal,
      context,
      action: "identity.external_identity.manage",
      type: "external_identity",
    });
    const inputBody = await body(req);
    const kind = inputBody.principal_type;
    const emergency = inputBody.emergency_identity === true;
    if (
      inputBody.emergency_identity !== undefined &&
      typeof inputBody.emergency_identity !== "boolean"
    )
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "emergency_identity must be a boolean.",
      );
    if (emergency && kind !== "HUMAN")
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Only human identities may be marked for emergency access.",
      );
    if (emergency)
      await permit({
        authorization,
        principal,
        context,
        action: "identity.emergency_identity.manage",
        type: "emergency_identity",
      });
    const externalKey =
      kind === "HUMAN"
        ? opaqueIdentity(inputBody.subject, "subject")
        : kind === "SERVICE"
          ? opaqueIdentity(inputBody.client_id, "client_id")
          : "";
    if (!externalKey)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "principal_type must be HUMAN or SERVICE.",
      );
    const reason = text(inputBody.reason, "reason");
    const key = idempotencyKey(req);
    if (inputBody.issuer !== config.oidcIssuer)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Only the configured trusted issuer may be provisioned.",
      );
    try {
      const result = await uow.run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "IDENTITY.LINK_EXTERNAL",
            businessScope: `${kind}:${config.oidcIssuer}`,
            key,
            semanticRequest: {
              principal_type: kind as string,
              issuer: config.oidcIssuer!,
              external_key: externalKey,
              emergency_identity: emergency,
              reason,
            },
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          async () => {
            const id = randomUUID();
            const inserted = await tx.query<{ id: string }>(
              `INSERT INTO identity.identity_links(id,issuer,principal_type,identity_class,subject,client_id,provenance,created_by,verified_at)
           VALUES($1,$2,$3,$4,$5,$6,'OPERATOR_PROVISIONING',$7,now()) RETURNING id`,
              [
                id,
                config.oidcIssuer,
                kind,
                emergency ? "EMERGENCY" : "STANDARD",
                kind === "HUMAN" ? externalKey : null,
                kind === "SERVICE" ? externalKey : null,
                principal.id,
              ],
            );
            await audit({
              tx,
              principal,
              context,
              type: "IDENTITY_LINK",
              id,
              command: emergency
                ? "IDENTITY.LINK_EMERGENCY_EXTERNAL"
                : "IDENTITY.LINK_EXTERNAL",
              key,
              reason,
              after: {
                id,
                principal_type: kind as string,
                issuer: config.oidcIssuer!,
                identity_class: emergency ? "EMERGENCY" : "STANDARD",
              },
            });
            return stored(201, { identity_link_id: inserted.rows[0]!.id });
          },
        ),
      );
      json(res, result.status, result.body);
    } catch (error) {
      if ((error as { code?: string })?.code === "23505")
        throw new ApplicationError(
          "IDENTITY_LINK_CONFLICT",
          "External identity is already linked.",
        );
      throw error;
    }
    return true;
  }

  if (req.method === "POST" && url === "/api/v1/identity/tenant-memberships") {
    const principal = await authenticate(
      authentication,
      req.headers.authorization,
    );
    await permit({
      authorization,
      principal,
      context,
      action: "identity.tenant_membership.manage",
      type: "tenant_membership",
    });
    const inputBody = await body(req);
    const identityLinkId = uuid(inputBody.identity_link_id, "identity_link_id");
    const principalType = inputBody.principal_type;
    const human = principalType === "HUMAN";
    const service = principalType === "SERVICE";
    if (!human && !service)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "principal_type must be HUMAN or SERVICE.",
      );
    const localUserId = human
      ? uuid(inputBody.local_user_id, "local_user_id")
      : null;
    const systemType = service
      ? text(inputBody.system_principal_type, "system_principal_type", 64)
      : null;
    const systemId = service
      ? uuid(inputBody.system_principal_id, "system_principal_id")
      : null;
    const table = systemType ? servicePrincipalTables[systemType] : undefined;
    if (service && !table)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Unsupported service principal type.",
      );
    const reason = text(inputBody.reason, "reason");
    const key = idempotencyKey(req);
    const result = await uow
      .run(principal.tenant_id, (tx) =>
        new PostgresIdempotencyStore(tx).execute(
          {
            principalId: principal.id,
            operation: "IDENTITY.GRANT_TENANT_MEMBERSHIP",
            businessScope: principal.tenant_id,
            key,
            semanticRequest: {
              identity_link_id: identityLinkId,
              principal_type: principalType as string,
              local_user_id: localUserId,
              system_principal_type: systemType,
              system_principal_id: systemId,
              reason,
            },
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          async () => {
            const link = await tx.query<{
              status: string;
              principal_type: string;
            }>(
              "SELECT status,principal_type FROM identity.identity_links WHERE id=$1 AND issuer=$2",
              [identityLinkId, config.oidcIssuer],
            );
            if (
              !link.rowCount ||
              link.rows[0]!.status !== "ACTIVE" ||
              link.rows[0]!.principal_type !== (human ? "HUMAN" : "SERVICE")
            )
              throw new ApplicationError(
                "VALIDATION_ERROR",
                "Identity link is unavailable for this membership.",
              );
            if (human) {
              const user = await tx.query(
                "SELECT id FROM identity.users WHERE tenant_id=$1 AND id=$2 AND employment_status='ACTIVE' AND archived_at IS NULL",
                [principal.tenant_id, localUserId],
              );
              if (!user.rowCount)
                throw new ApplicationError(
                  "VALIDATION_ERROR",
                  "Active tenant-local user is required.",
                );
            } else {
              const target = await tx.query(
                `SELECT id FROM ${table} WHERE tenant_id=$1 AND id=$2 AND active=true`,
                [principal.tenant_id, systemId],
              );
              if (!target.rowCount)
                throw new ApplicationError(
                  "VALIDATION_ERROR",
                  "Active tenant-scoped service principal is required.",
                );
            }
            const id = randomUUID();
            await tx.query(
              `INSERT INTO identity.tenant_memberships(id,tenant_id,identity_link_id,principal_type,local_user_id,system_principal_type,system_principal_id,granted_by,provenance)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'OPERATOR_PROVISIONING')`,
              [
                id,
                principal.tenant_id,
                identityLinkId,
                human ? "HUMAN" : "SERVICE",
                localUserId,
                systemType,
                systemId,
                principal.id,
              ],
            );
            await audit({
              tx,
              principal,
              context,
              type: "TENANT_MEMBERSHIP",
              id,
              command: "IDENTITY.GRANT_TENANT_MEMBERSHIP",
              key,
              reason,
              after: {
                id,
                identity_link_id: identityLinkId,
                principal_type: principalType as string,
                local_user_id: localUserId,
                system_principal_type: systemType,
                system_principal_id: systemId,
              },
            });
            return stored(201, { tenant_membership_id: id });
          },
        ),
      )
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === "23505")
          throw new ApplicationError(
            "IDENTITY_LINK_CONFLICT",
            "An active tenant membership already exists for this identity.",
          );
        throw error;
      });
    json(res, result.status, result.body);
    return true;
  }

  const revoke =
    /^\/api\/v1\/identity\/tenant-memberships\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/revoke$/i.exec(
      url,
    );
  if (req.method === "POST" && revoke) {
    const principal = await authenticate(
      authentication,
      req.headers.authorization,
    );
    await permit({
      authorization,
      principal,
      context,
      action: "identity.tenant_membership.manage",
      type: "tenant_membership",
    });
    const inputBody = await body(req);
    const reason = text(inputBody.reason, "reason");
    const expectedVersion = inputBody.expected_version;
    if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "expected_version must be a positive integer.",
      );
    const key = idempotencyKey(req);
    const result = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "IDENTITY.REVOKE_TENANT_MEMBERSHIP",
          businessScope: revoke[1]!,
          key,
          semanticRequest: {
            membership_id: revoke[1]!,
            expected_version: Number(expectedVersion),
            reason,
          },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        async () => {
          const changed = await tx.query<{ version: number }>(
            `UPDATE identity.tenant_memberships SET status='REVOKED',revoked_at=now(),revoked_by=$4,updated_at=now(),version=version+1
         WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' AND version=$3 RETURNING version`,
            [
              principal.tenant_id,
              revoke[1]!,
              Number(expectedVersion),
              principal.id,
            ],
          );
          if (!changed.rowCount)
            throw new ApplicationError(
              "VERSION_CONFLICT",
              "Membership is no longer active or has changed.",
            );
          await audit({
            tx,
            principal,
            context,
            type: "TENANT_MEMBERSHIP",
            id: revoke[1]!,
            command: "IDENTITY.REVOKE_TENANT_MEMBERSHIP",
            key,
            reason,
            before: { status: "ACTIVE", version: Number(expectedVersion) },
            after: {
              status: "REVOKED",
              version: Number(changed.rows[0]!.version),
            },
          });
          return stored(200, {
            tenant_membership_id: revoke[1]!,
            status: "REVOKED",
            version: Number(changed.rows[0]!.version),
          });
        },
      ),
    );
    json(res, result.status, result.body);
    return true;
  }

  const revokeLink =
    /^\/api\/v1\/identity\/links\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/revoke$/i.exec(
      url,
    );
  if (req.method === "POST" && revokeLink) {
    const principal = await authenticate(
      authentication,
      req.headers.authorization,
    );
    await permit({
      authorization,
      principal,
      context,
      action: "identity.external_identity.manage",
      type: "external_identity",
    });
    const inputBody = await body(req);
    const reason = text(inputBody.reason, "reason");
    const expectedVersion = inputBody.expected_version;
    if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1)
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "expected_version must be a positive integer.",
      );
    const key = idempotencyKey(req);
    const result = await uow.run(principal.tenant_id, (tx) =>
      new PostgresIdempotencyStore(tx).execute(
        {
          principalId: principal.id,
          operation: "IDENTITY.UNLINK_EXTERNAL",
          businessScope: revokeLink[1]!,
          key,
          semanticRequest: {
            identity_link_id: revokeLink[1]!,
            expected_version: Number(expectedVersion),
            reason,
          },
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        async () => {
          const link = await tx.query<{
            id: string;
            status: string;
            version: number;
          }>(
            `SELECT id,status,version FROM identity.identity_links
             WHERE id=$1 AND issuer=$2 FOR UPDATE`,
            [revokeLink[1]!, config.oidcIssuer],
          );
          if (!link.rowCount)
            throw new ApplicationError("NOT_FOUND", "Identity link not found.");
          if (
            link.rows[0]!.status !== "ACTIVE" ||
            link.rows[0]!.version !== Number(expectedVersion)
          )
            throw new ApplicationError(
              "VERSION_CONFLICT",
              "Identity link is no longer active or has changed.",
            );
          const otherTenantMembership = await tx.query(
            `SELECT 1 FROM identity.tenant_memberships
             WHERE identity_link_id=$1 AND status='ACTIVE' AND tenant_id<>$2 LIMIT 1`,
            [revokeLink[1]!, principal.tenant_id],
          );
          if (otherTenantMembership.rowCount)
            throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
          const changed = await tx.query<{ version: number }>(
            `UPDATE identity.identity_links SET status='REVOKED',updated_at=now(),version=version+1
             WHERE id=$1 AND status='ACTIVE' AND version=$2 RETURNING version`,
            [revokeLink[1]!, Number(expectedVersion)],
          );
          if (!changed.rowCount)
            throw new ApplicationError(
              "VERSION_CONFLICT",
              "Identity link has changed.",
            );
          await audit({
            tx,
            principal,
            context,
            type: "IDENTITY_LINK",
            id: revokeLink[1]!,
            command: "IDENTITY.UNLINK_EXTERNAL",
            key,
            reason,
            before: { status: "ACTIVE", version: Number(expectedVersion) },
            after: {
              status: "REVOKED",
              version: Number(changed.rows[0]!.version),
            },
          });
          return stored(200, {
            identity_link_id: revokeLink[1]!,
            status: "REVOKED",
            version: Number(changed.rows[0]!.version),
          });
        },
      ),
    );
    json(res, result.status, result.body);
    return true;
  }
  return false;
}
