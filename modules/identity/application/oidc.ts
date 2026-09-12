import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
export interface OidcClaims {
  issuer: string;
  audience: string | string[];
  subject: string;
  expiresAt: number;
  tenantId: string;
  userId: string;
  auth_time?: number;
  acr?: string;
  amr?: string[];
}
export interface OidcVerifier {
  verify(token: string): Promise<OidcClaims>;
}
export function validateClaims(
  claims: OidcClaims,
  expected: {
    issuer: string;
    audience: string;
    tenantId: string;
    now?: number;
  },
): void {
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  if (
    claims.issuer !== expected.issuer ||
    !(Array.isArray(claims.audience)
      ? claims.audience.includes(expected.audience)
      : claims.audience === expected.audience)
  )
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Invalid OIDC issuer or audience.",
    );
  if (
    !claims.subject ||
    !claims.userId ||
    claims.tenantId !== expected.tenantId ||
    !Number.isFinite(claims.expiresAt) ||
    claims.expiresAt <= now
  )
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Invalid or expired OIDC identity.",
    );
  if (
    (claims.auth_time !== undefined &&
      (!Number.isSafeInteger(claims.auth_time) ||
        claims.auth_time < 0 ||
        claims.auth_time > now)) ||
    (claims.acr !== undefined &&
      (typeof claims.acr !== "string" || claims.acr.length > 256)) ||
    (claims.amr !== undefined &&
      (!Array.isArray(claims.amr) ||
        claims.amr.length > 16 ||
        claims.amr.some(
          (method) => typeof method !== "string" || method.length > 64,
        )))
  )
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Invalid OIDC authentication assurance claims.",
    );
}
