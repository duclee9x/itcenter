import type { Principal } from "../../../packages/auth/src/index.js";
import { randomUUID } from "node:crypto";
import type {
  Transaction,
  UnitOfWork,
} from "../../../packages/persistence/src/index.js";
import type { PendingEvent } from "../../../packages/event-contracts/src/index.js";
import type { AuditRecord } from "../../audit/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { validateClaims, type OidcClaims, type OidcVerifier } from "./oidc.js";
import { createSession } from "./sessions.js";
export interface OidcAuthenticationPort {
  // Adapter must verify signature, issuer, audience, expiry and map subject to canonical tenant/user.
  // Never trust unverified role claims. No adapter is installed by TASK-000.
  authenticate(accessToken: string): Promise<Principal>;
}

export interface LoginEffects {
  appendEvent(event: PendingEvent): Promise<void>;
  appendAudit(record: AuditRecord): Promise<void>;
}

export async function authenticateOidcLogin(input: {
  token: string;
  verifier: OidcVerifier;
  expected: { issuer: string; audience: string; tenantId: string };
  uow: UnitOfWork;
  effects: (tx: Transaction) => LoginEffects;
  providerId: string;
  serviceName: string;
  correlationId: string;
  causationId: string;
  now?: Date;
  idleMs: number;
  absoluteMs: number;
  sourceIp?: string;
}): Promise<Principal & { session_id: string; expires_at: string }> {
  const now = input.now ?? new Date();
  let claims: OidcClaims | undefined;
  try {
    claims = await input.verifier.verify(input.token);
    validateClaims(claims, {
      ...input.expected,
      now: Math.floor(now.getTime() / 1000),
    });
    const result = await input.uow.run(claims.tenantId, async (tx) => {
      const session = await createSession(tx, {
        tenantId: claims!.tenantId,
        userId: claims!.userId,
        authMethod: "OIDC",
        now,
        idleMs: input.idleMs,
        absoluteMs: input.absoluteMs,
        ...(input.sourceIp ? { sourceIp: input.sourceIp } : {}),
      });
      const actor = { type: "USER", id: claims!.userId },
        event: PendingEvent = {
          event_id: randomUUID(),
          event_type: "AUTH.LOGIN_SUCCESS",
          schema_version: 1,
          occurred_at: now.toISOString(),
          producer: { service: input.serviceName, instance: "api" },
          aggregate: { type: "SESSION", id: session.id, version: 1 },
          actor,
          correlation_id: input.correlationId,
          causation_id: input.causationId,
          tenant_id: claims!.tenantId,
          organization_id: claims!.tenantId,
          idempotency_key: `login:${session.id}`,
          payload: {
            user_id: claims!.userId,
            session_id: session.id,
            provider_id: input.providerId,
            auth_method: "OIDC",
            risk_state: "NORMAL",
          },
        };
      await input.effects(tx).appendEvent(event);
      await input.effects(tx).appendAudit({
        id: randomUUID(),
        tenant_id: claims!.tenantId,
        event_type: "AUTH.LOGIN_SUCCESS",
        occurred_at: now.toISOString(),
        actor,
        action: { command_type: "AUTH.LOGIN" },
        subject: { entity_type: "USER", entity_id: claims!.userId },
        correlation_id: input.correlationId,
        causation_id: input.causationId,
        reason: { code: "OIDC_LOGIN", text: "OIDC authentication succeeded" },
        before: null,
        after: { session_id: session.id, auth_method: "OIDC" },
        outcome: { status: "SUCCESS" },
        classification: "SECURITY",
        relations: [],
        evidence: [],
      });
      return session;
    });
    return {
      id: claims.userId,
      tenant_id: claims.tenantId,
      actor_type: "USER",
      ...(claims.auth_time !== undefined
        ? { auth_time: claims.auth_time }
        : {}),
      ...(claims.acr !== undefined ? { acr: claims.acr } : {}),
      ...(claims.amr !== undefined ? { amr: [...claims.amr] } : {}),
      session_id: result.id,
      expires_at: result.expiresAt.toISOString(),
    };
  } catch (error) {
    await input.uow.run(input.expected.tenantId, async (tx) => {
      const effects = input.effects(tx),
        hint = claims?.subject
          ? `subject:${claims.subject.slice(0, 8)}`
          : "unknown";
      await effects.appendEvent({
        event_id: randomUUID(),
        event_type: "AUTH.LOGIN_FAILED",
        schema_version: 1,
        occurred_at: now.toISOString(),
        producer: { service: input.serviceName, instance: "api" },
        aggregate: {
          type: "AUTHENTICATION",
          id: input.expected.tenantId,
          version: 1,
        },
        actor: { type: "EXTERNAL_USER", id: null },
        correlation_id: input.correlationId,
        causation_id: input.causationId,
        tenant_id: input.expected.tenantId,
        organization_id: input.expected.tenantId,
        idempotency_key: `login-failed:${input.correlationId}`,
        payload: {
          principal_hint: hint,
          provider_id: input.providerId,
          reason_code: "AUTHENTICATION_FAILED",
          source_context: "OIDC",
        },
      });
      await effects.appendAudit({
        id: randomUUID(),
        tenant_id: input.expected.tenantId,
        event_type: "AUTH.LOGIN_FAILED",
        occurred_at: now.toISOString(),
        actor: { type: "EXTERNAL_USER", id: null },
        action: { command_type: "AUTH.LOGIN" },
        subject: { entity_type: "TENANT", entity_id: input.expected.tenantId },
        correlation_id: input.correlationId,
        causation_id: input.causationId,
        reason: {
          code: "AUTHENTICATION_FAILED",
          text: "OIDC authentication failed",
        },
        before: null,
        after: { provider_id: input.providerId },
        outcome: { status: "FAILURE" },
        classification: "SECURITY",
        relations: [],
        evidence: [],
      });
    });
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "OIDC authentication failed.",
    );
  }
}
