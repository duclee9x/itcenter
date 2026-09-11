import { ApplicationError } from "../../api-contracts/src/index.js";
export interface Principal {
  id: string;
  tenant_id: string;
  actor_type: string;
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
  authenticate(token: string): Promise<Principal>;
}
export const unavailableAuthentication: AuthenticationPort = {
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
): Promise<Principal> {
  if (!header?.startsWith("Bearer ") || header.length <= 7)
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required.",
    );
  const principal = await port.authenticate(header.slice(7));
  if (!principal.id || !principal.tenant_id)
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Invalid authenticated principal.",
    );
  return principal;
}
