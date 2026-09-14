import {
  customFetch,
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import type {
  AuthenticationPort,
  Principal,
  TenantSelectorInput,
} from "../../../packages/auth/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";

type IdentityRow = {
  id: string;
  principal_type: "HUMAN" | "SERVICE";
  status: string;
  identity_class: "STANDARD" | "EMERGENCY";
};
type MembershipRow = {
  local_user_id: string | null;
  system_principal_type: string | null;
  system_principal_id: string | null;
  employment_status: string | null;
  archived_at: Date | null;
};
export type AuthenticationEvent =
  | "success"
  | "invalid_token"
  | "identity_not_provisioned"
  | "tenant_context_required"
  | "invalid_tenant_context"
  | "membership_denied"
  | "user_inactive"
  | "provider_unavailable"
  | "emergency_use";

const serviceTables: Readonly<Record<string, string>> = {
  SYSTEM_AUTOMATION: "identity.automation_principals",
  SYSTEM_CORRELATION: "identity.correlation_principals",
  SYSTEM_ASSET_SCORING: "identity.asset_scoring_principals",
  SYSTEM_RECOMMENDATION: "identity.recommendation_principals",
  SYSTEM_REPORTING: "identity.reporting_principals",
};

function failAuthentication(): never {
  throw new ApplicationError(
    "AUTHENTICATION_REQUIRED",
    "Authentication is required.",
    false,
    {
      "WWW-Authenticate": 'Bearer realm="api"',
    },
  );
}

export function requestedTenantId(
  selector: TenantSelectorInput | undefined,
): string {
  const values = selector?.values ?? [];
  if (values.length === 0)
    throw new ApplicationError(
      "TENANT_CONTEXT_REQUIRED",
      "X-Tenant-ID is required.",
    );
  if (
    values.length !== 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(values[0]!)
  )
    throw new ApplicationError(
      "INVALID_TENANT_CONTEXT",
      "X-Tenant-ID is invalid.",
    );
  return values[0]!;
}

function requiredString(payload: JWTPayload, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" || !value.trim()) failAuthentication();
  return value;
}

export class OidcApiAuthentication implements AuthenticationPort {
  readonly tenantContextRequired = true;
  private constructor(
    private readonly pool: pg.Pool,
    private readonly uow: UnitOfWork,
    private readonly issuer: string,
    private readonly audience: string,
    private readonly jwks: ReturnType<typeof createRemoteJWKSet>,
    private readonly onEvent?: (event: AuthenticationEvent) => void,
  ) {}

  static async create(input: {
    pool: pg.Pool;
    uow: UnitOfWork;
    issuer: string;
    audience: string;
    onEvent?: (event: AuthenticationEvent) => void;
    fetcher?: typeof fetch;
  }): Promise<OidcApiAuthentication> {
    const issuer = input.issuer;
    const fetcher = input.fetcher ?? fetch;
    const discoveryUrl = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
    let metadata: { issuer?: string; jwks_uri?: string };
    try {
      const response = await fetcher(discoveryUrl, {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("discovery unavailable");
      metadata = (await response.json()) as typeof metadata;
    } catch {
      throw new Error("OIDC discovery could not be initialized");
    }
    if (metadata.issuer !== issuer || !metadata.jwks_uri)
      throw new Error("OIDC discovery issuer mismatch");
    const jwksUrl = new URL(metadata.jwks_uri);
    if (
      jwksUrl.protocol !== "https:" ||
      jwksUrl.username ||
      jwksUrl.password ||
      jwksUrl.hash
    )
      throw new Error("OIDC JWKS must use HTTPS");
    try {
      const response = await fetcher(jwksUrl, {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("JWKS unavailable");
      const document = (await response.json()) as {
        keys?: Array<{
          kty?: string;
          use?: string;
          alg?: string;
          key_ops?: string[];
        }>;
      };
      if (
        !document.keys?.some(
          (key) =>
            key.kty === "RSA" &&
            (!key.use || key.use === "sig") &&
            (!key.alg || key.alg === "RS256") &&
            (!key.key_ops || key.key_ops.includes("verify")),
        )
      )
        throw new Error("No trusted RS256 signing key");
    } catch {
      throw new Error("OIDC signing keys could not be initialized");
    }
    const jwks = createRemoteJWKSet(jwksUrl, {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
      cacheMaxAge: 600000,
      [customFetch]: (url, options) => fetcher(url, options),
    });
    return new OidcApiAuthentication(
      input.pool,
      input.uow,
      issuer,
      input.audience,
      jwks,
      input.onEvent,
    );
  }

  async isReady(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1 FROM identity.identity_links LIMIT 0");
      await this.pool.query(
        "SELECT 1 FROM identity.tenant_memberships LIMIT 0",
      );
      return true;
    } catch {
      return false;
    }
  }

  async authenticate(
    token: string,
    selector?: TenantSelectorInput,
  ): Promise<Principal> {
    try {
      const principal = await this.resolvePrincipal(token, selector);
      this.onEvent?.("success");
      return principal;
    } catch (error) {
      const code =
        error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
      const event: AuthenticationEvent =
        code === "IDENTITY_NOT_PROVISIONED"
          ? "identity_not_provisioned"
          : code === "TENANT_CONTEXT_REQUIRED"
            ? "tenant_context_required"
            : code === "INVALID_TENANT_CONTEXT"
              ? "invalid_tenant_context"
              : code === "TENANT_MEMBERSHIP_DENIED"
                ? "membership_denied"
                : code === "DEPENDENCY_UNAVAILABLE"
                  ? "provider_unavailable"
                  : code === "PERMISSION_DENIED"
                    ? "user_inactive"
                    : "invalid_token";
      this.onEvent?.(event);
      throw error;
    }
  }

  private async resolvePrincipal(
    token: string,
    selector?: TenantSelectorInput,
  ): Promise<Principal> {
    const payload = await verifyOidcAccessToken(
      token,
      this.jwks,
      this.issuer,
      this.audience,
    );
    const subject = requiredString(payload, "sub");
    const clientId = requiredString(payload, "client_id");
    let identities: IdentityRow[];
    try {
      // RFC 9068 client-credentials tokens identify the client application in sub.
      // Keep the HUMAN and SERVICE namespaces disjoint; client_id alone is shared
      // by interactive users of the same OAuth client and is never sufficient.
      const serviceToken = subject === clientId;
      const result = await this.pool.query<IdentityRow>(
        `SELECT id,principal_type,status,identity_class FROM identity.identity_links
         WHERE issuer=$1 AND principal_type=$2 AND ${serviceToken ? "client_id" : "subject"}=$3`,
        [
          this.issuer,
          serviceToken ? "SERVICE" : "HUMAN",
          serviceToken ? clientId : subject,
        ],
      );
      identities = result.rows;
    } catch {
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Identity service is unavailable.",
        true,
      );
    }
    if (identities.length !== 1) {
      if (identities.length > 1) failAuthentication();
      throw new ApplicationError(
        "IDENTITY_NOT_PROVISIONED",
        "Identity is not provisioned.",
      );
    }
    const identity = identities[0]!;
    if (identity.status !== "ACTIVE")
      throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
    if (
      identity.identity_class === "EMERGENCY" &&
      (!Array.isArray(payload.amr) || !payload.amr.includes("mfa"))
    )
      throw new ApplicationError(
        "AUTHENTICATION_REQUIRED",
        "Authentication is required.",
      );

    // Contract precedence: authenticate and resolve the external identity before exposing selector errors.
    const requestedTenant = requestedTenantId(selector);
    let membership: MembershipRow | undefined;
    try {
      membership = await this.uow.run(requestedTenant, async (tx) => {
        const result = await tx.query<MembershipRow>(
          `SELECT m.local_user_id,m.system_principal_type,m.system_principal_id,
                  u.employment_status,u.archived_at
           FROM identity.tenant_memberships m
           LEFT JOIN identity.users u ON u.tenant_id=m.tenant_id AND u.id=m.local_user_id
           WHERE m.tenant_id=$1 AND m.identity_link_id=$2 AND m.principal_type=$3 AND m.status='ACTIVE'`,
          [requestedTenant, identity.id, identity.principal_type],
        );
        return result.rows[0];
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Tenant authorization is unavailable.",
        true,
      );
    }
    if (!membership)
      throw new ApplicationError("TENANT_MEMBERSHIP_DENIED", "Access denied.");

    let id: string;
    let actorType: string;
    if (identity.principal_type === "HUMAN") {
      if (
        !membership.local_user_id ||
        membership.employment_status !== "ACTIVE" ||
        membership.archived_at
      )
        throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
      id = membership.local_user_id;
      actorType = "USER";
    } else {
      const principalType = membership.system_principal_type;
      const table = principalType ? serviceTables[principalType] : undefined;
      if (!table || !membership.system_principal_id)
        throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
      try {
        const result = await this.uow.run(requestedTenant, (tx) =>
          tx.query<{ id: string }>(
            `SELECT id FROM ${table} WHERE tenant_id=$1 AND id=$2 AND active=true`,
            [requestedTenant, membership!.system_principal_id],
          ),
        );
        if (!result.rowCount)
          throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(
          "DEPENDENCY_UNAVAILABLE",
          "Service authorization is unavailable.",
          true,
        );
      }
      id = membership.system_principal_id;
      actorType = principalType!;
    }
    const assurance = {
      ...(Number.isSafeInteger(payload.auth_time)
        ? { auth_time: payload.auth_time as number }
        : {}),
      ...(typeof payload.acr === "string" ? { acr: payload.acr } : {}),
      ...(Array.isArray(payload.amr) &&
      payload.amr.every((item) => typeof item === "string")
        ? { amr: payload.amr as string[] }
        : {}),
    };
    const principal: Principal = {
      id,
      tenant_id: requestedTenant,
      actor_type: actorType,
      auth_method: "OIDC_ACCESS_TOKEN",
      issuer: this.issuer,
      subject,
      ...assurance,
    };
    if (identity.identity_class === "EMERGENCY") {
      try {
        await this.uow.run(requestedTenant, (tx) =>
          new PostgresAudit(tx).append({
            id: randomUUID(),
            tenant_id: requestedTenant,
            event_type: "IDENTITY.EMERGENCY_IDENTITY_USED",
            occurred_at: new Date().toISOString(),
            actor: { type: actorType, id },
            action: { command_type: "OIDC.EMERGENCY_AUTHENTICATION" },
            subject: { entity_type: "IDENTITY_LINK", entity_id: identity.id },
            correlation_id: selector?.correlationId ?? randomUUID(),
            causation_id:
              selector?.causationId ?? selector?.requestId ?? randomUUID(),
            reason: {
              code: "EMERGENCY_IDENTITY_USE",
              text: "Emergency OIDC identity authenticated.",
            },
            before: null,
            after: {
              identity_link_id: identity.id,
              authentication_method: "OIDC_ACCESS_TOKEN",
              mfa_asserted: true,
            },
            outcome: { status: "SUCCESS" },
            classification: "RESTRICTED",
            relations: [],
            evidence: [],
          }),
        );
        this.onEvent?.("emergency_use");
      } catch {
        throw new ApplicationError(
          "DEPENDENCY_UNAVAILABLE",
          "Emergency authentication audit is unavailable.",
          true,
        );
      }
    }
    return principal;
  }
}

export async function verifyOidcAccessToken(
  token: string,
  jwks: JWTVerifyGetKey,
  issuer: string,
  audience: string,
): Promise<JWTPayload> {
  try {
    const verified = await jwtVerify(token, jwks, {
      issuer,
      audience,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });
    const typ = verified.protectedHeader.typ?.toLowerCase();
    if (typ !== "at+jwt" && typ !== "application/at+jwt") failAuthentication();
    const payload = verified.payload;
    requiredString(payload, "sub");
    requiredString(payload, "jti");
    requiredString(payload, "client_id");
    if (
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp)
    )
      failAuthentication();
    if (payload.iat! > Math.floor(Date.now() / 1000) + 30) failAuthentication();
    return payload;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    if (error instanceof TypeError && /fetch|network/i.test(error.message))
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Authentication provider is unavailable.",
        true,
      );
    if (
      error instanceof Error &&
      (error.name === "JWKSTimeout" || error.name === "JWKSInvalid")
    )
      throw new ApplicationError(
        "DEPENDENCY_UNAVAILABLE",
        "Authentication provider is unavailable.",
        true,
      );
    failAuthentication();
  }
}
