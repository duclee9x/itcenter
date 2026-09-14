import { ApplicationError } from "../../api-contracts/src/index.js";
import { AsyncLocalStorage } from "node:async_hooks";
export interface Principal {
  id: string;
  tenant_id: string;
  actor_type: string;
  auth_method?: "OIDC_ACCESS_TOKEN" | "MTLS" | "TEST" | "INTERNAL";
  issuer?: string;
  subject?: string;
  /** OIDC assurance claims copied only from a verified token. */
  auth_time?: number;
  acr?: string;
  amr?: readonly string[];
}
export interface AuthorizationRequest {
  principal: Principal;
  action: string;
  resource: { type: string; id: string; tenant_id: string };
  scope: Readonly<Record<string, string>>;
  context: Readonly<Record<string, unknown>>;
}
export interface AuthorizationDecision {
  result: "ALLOW" | "DENY";
  reason: string;
  scope_reference?: string;
}
export interface AuthorizationPort {
  evaluate(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}
export const denyAll: AuthorizationPort = {
  async evaluate() {
    return {
      result: "DENY",
      reason: "Authorization provider is not configured",
    };
  },
};
export async function authorize(
  port: AuthorizationPort,
  request: AuthorizationRequest,
): Promise<void> {
  if (
    !request.principal.id ||
    !request.principal.tenant_id ||
    request.principal.tenant_id !== request.resource.tenant_id
  )
    throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
  if ((await port.evaluate(request)).result !== "ALLOW")
    throw new ApplicationError("PERMISSION_DENIED", "Access denied.");
}
export interface AuthenticationPort {
  /** True only for the production adapter that binds identities using X-Tenant-ID. */
  readonly tenantContextRequired?: boolean;
  isReady?(): Promise<boolean>;
  authenticate(
    token: string,
    tenantSelector?: TenantSelectorInput,
  ): Promise<Principal>;
}
export interface TenantSelectorInput {
  values: readonly string[];
  requestId?: string;
  correlationId?: string;
  causationId?: string;
}
interface RequestAuthentication {
  port: AuthenticationPort;
  token: string;
  principal: Principal;
}
const requestAuthentication = new AsyncLocalStorage<RequestAuthentication>();

function bearerToken(header: string | undefined): string {
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(header ?? "");
  if (!match)
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required.",
    );
  return match[1]!;
}

export async function withAuthenticatedRequest<T>(input: {
  port: AuthenticationPort;
  authorization: string | undefined;
  tenantSelector: TenantSelectorInput;
  work: () => Promise<T>;
}): Promise<T> {
  const token = bearerToken(input.authorization);
  const principal = await input.port.authenticate(token, input.tenantSelector);
  if (!principal.id || !principal.tenant_id)
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Invalid authenticated principal.",
    );
  return requestAuthentication.run(
    { port: input.port, token, principal },
    input.work,
  );
}
export const unavailableAuthentication: AuthenticationPort = {
  async isReady() {
    return false;
  },
  async authenticate() {
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Authentication provider is not configured.",
    );
  },
};
export async function authenticate(
  port: AuthenticationPort,
  header: string | undefined,
  tenantSelector?: TenantSelectorInput,
): Promise<Principal> {
  const token = bearerToken(header);
  const context = requestAuthentication.getStore();
  if (context?.port === port && context.token === token)
    return context.principal;
  const principal = await port.authenticate(token, tenantSelector);
  if (!principal.id || !principal.tenant_id)
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Invalid authenticated principal.",
    );
  return principal;
}

export function requireStepUpMfa(
  principal: Principal,
  requirements: { requiredAcr: string; maxAgeSeconds: number; now?: number },
): void {
  const now = requirements.now ?? Math.floor(Date.now() / 1000);
  const fresh =
    Number.isSafeInteger(principal.auth_time) &&
    principal.auth_time! <= now &&
    now - principal.auth_time! <= requirements.maxAgeSeconds;
  if (
    principal.acr !== requirements.requiredAcr ||
    !principal.amr?.includes("mfa") ||
    !fresh
  ) {
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Recent multi-factor authentication is required.",
      false,
      {
        "WWW-Authenticate": `Bearer error="insufficient_user_authentication", acr_values="${requirements.requiredAcr}", max_age="${requirements.maxAgeSeconds}"`,
      },
    );
  }
}
