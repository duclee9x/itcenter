import type { Transaction } from "../../../packages/persistence/src/index.js";
export interface AuthorizationInput {
  principalId: string;
  tenantId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  scope: Readonly<Record<string, string>>;
  at?: Date;
}
export interface AuthorizationDecision {
  result: "ALLOW" | "DENY";
  reason: string;
  matched?: {
    role: string;
    permission: string;
    scopeType: string;
    scopeId: string;
  };
}
export async function evaluateAuthorization(
  tx: Transaction,
  input: AuthorizationInput,
): Promise<AuthorizationDecision> {
  const at = input.at ?? new Date();
  const rows = await tx.query(
    `SELECT p.code, r.code AS role_code, rb.scope_type, rb.scope_id, rb.source,
            false AS temporary
 FROM identity.role_bindings rb JOIN identity.roles r ON r.id=rb.role_id AND r.tenant_id=rb.tenant_id
 JOIN identity.role_permissions rp ON rp.role_id=r.id AND rp.tenant_id=r.tenant_id JOIN identity.permissions p ON p.id=rp.permission_id
 WHERE rb.tenant_id=$1 AND rb.principal_id=$2 AND p.code=$3 AND rb.valid_from<= $4 AND (rb.valid_until IS NULL OR rb.valid_until>$4)
 UNION ALL
 SELECT p.code, 'TEMPORARY_GRANT' AS role_code, tg.scope_type, tg.scope_id, 'Temporary Elevation' AS source,
        true AS temporary
 FROM identity.temporary_grants tg JOIN identity.permissions p ON p.id=tg.permission_id
 WHERE tg.tenant_id=$1 AND tg.principal_id=$2 AND p.code=$3 AND tg.valid_from<= $4 AND tg.valid_until>$4`,
    [input.tenantId, input.principalId, input.action, at],
  );
  if (input.tenantId !== tx.tenantId)
    return { result: "DENY", reason: "Tenant scope does not match" };
  const denied = rows.rows.find((r) => r.source === "EXPLICIT_DENY");
  if (denied)
    return {
      result: "DENY",
      reason: `Explicit deny for ${denied.code} in ${denied.scope_type}:${denied.scope_id}`,
    };
  const match = rows.rows.find(
    (r) =>
      r.scope_type === "TENANT" ||
      r.scope_type === "GLOBAL" ||
      input.scope[r.scope_type.toLowerCase()] === r.scope_id,
  );
  if (match)
    return {
      result: "ALLOW",
      reason: `Role ${match.role_code} grants ${match.code} in ${match.scope_type}:${match.scope_id}`,
      matched: {
        role: match.role_code,
        permission: match.code,
        scopeType: match.scope_type,
        scopeId: match.scope_id,
      },
    };
  return {
    result: "DENY",
    reason:
      "No active role binding grants this permission in the requested scope",
  };
}
