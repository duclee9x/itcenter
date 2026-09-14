import type { Transaction } from "../../../packages/persistence/src/index.js";
export interface AuthorizationInput {
  principalId: string;
  principalType?:
    | "USER"
    | "SYSTEM_AUTOMATION"
    | "SYSTEM_CORRELATION"
    | "SYSTEM_ASSET_SCORING"
    | "SYSTEM_RECOMMENDATION"
    | "SYSTEM_REPORTING";
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
  if (input.tenantId !== tx.tenantId)
    return { result: "DENY", reason: "Tenant scope does not match" };
  if (input.principalType === "SYSTEM_REPORTING") {
    const result = await tx.query<{ allowed: boolean }>(
      `SELECT active AND $3=ANY(granted_capabilities) AS allowed
       FROM identity.reporting_principals
       WHERE tenant_id=$1 AND id=$2 AND principal_type='SYSTEM_REPORTING'`,
      [input.tenantId, input.principalId, input.action],
    );
    return result.rows[0]?.allowed
      ? {
          result: "ALLOW",
          reason: "Explicit tenant-scoped reporting capability",
        }
      : {
          result: "DENY",
          reason: "No active reporting capability covers this target",
        };
  }
  if (
    input.principalType === "SYSTEM_AUTOMATION" ||
    input.principalType === "SYSTEM_CORRELATION" ||
    input.principalType === "SYSTEM_ASSET_SCORING" ||
    input.principalType === "SYSTEM_RECOMMENDATION"
  ) {
    const effectiveAt =
      input.at ??
      (await tx.query<{ at: Date }>("SELECT clock_timestamp() AS at")).rows[0]!
        .at;
    const principalTable =
      input.principalType === "SYSTEM_AUTOMATION"
        ? "identity.automation_principals"
        : input.principalType === "SYSTEM_CORRELATION"
          ? "identity.correlation_principals"
          : input.principalType === "SYSTEM_ASSET_SCORING"
            ? "identity.asset_scoring_principals"
            : "identity.recommendation_principals";
    const rows = await tx.query<{
      code: string;
      role_code: string;
      scope_type: string;
      scope_id: string;
      source: string;
    }>(
      `SELECT p.code,r.code AS role_code,rb.scope_type,rb.scope_id,rb.source
       FROM ${principalTable} ap
       JOIN identity.role_bindings rb ON rb.tenant_id=ap.tenant_id
         AND rb.principal_id=ap.id
       JOIN identity.roles r ON r.tenant_id=rb.tenant_id AND r.id=rb.role_id
       JOIN identity.role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
       JOIN identity.permissions p ON p.id=rp.permission_id
       WHERE ap.tenant_id=$1 AND ap.id=$2 AND ap.active=true
         AND rb.principal_type=$6 AND rb.revoked_at IS NULL AND rb.valid_from<=$3
         AND (rb.valid_until IS NULL OR rb.valid_until>$3)
         AND p.code=$4 AND lower(p.resource_type)=lower($5)
         AND r.status='ACTIVE'
       FOR SHARE OF ap,rb,r,rp`,
      [
        input.tenantId,
        input.principalId,
        effectiveAt,
        input.action,
        input.resourceType,
        input.principalType,
      ],
    );
    const denied = rows.rows.find((row) => row.source === "EXPLICIT_DENY");
    if (denied)
      return {
        result: "DENY",
        reason: `Explicit automation grant denial for ${denied.code}`,
      };
    const match = rows.rows.find(
      (row) =>
        row.scope_type !== "GLOBAL" &&
        row.scope_id !== "*" &&
        input.scope[row.scope_type.toLowerCase()] === row.scope_id &&
        (row.scope_type !== "TENANT" || input.scope.tenant === input.tenantId),
    );
    return match
      ? {
          result: "ALLOW",
          reason: `System principal grant ${match.code} covers ${match.scope_type}:${match.scope_id}`,
          matched: {
            role: match.role_code,
            permission: match.code,
            scopeType: match.scope_type,
            scopeId: match.scope_id,
          },
        }
      : {
          result: "DENY",
          reason: "No active scoped system principal grant covers this target",
        };
  }
  const rows = await tx.query(
    `SELECT p.code, r.code AS role_code, rb.scope_type, rb.scope_id, rb.source,
            false AS temporary
 FROM identity.role_bindings rb JOIN identity.roles r ON r.id=rb.role_id AND r.tenant_id=rb.tenant_id
 JOIN identity.role_permissions rp ON rp.role_id=r.id AND rp.tenant_id=r.tenant_id JOIN identity.permissions p ON p.id=rp.permission_id
 JOIN identity.users u ON u.tenant_id=rb.tenant_id AND u.id=rb.principal_id
 WHERE rb.tenant_id=$1 AND rb.principal_type='USER' AND rb.principal_id=$2 AND rb.revoked_at IS NULL AND u.employment_status='ACTIVE' AND u.archived_at IS NULL AND p.code=$3 AND rb.valid_from<= $4 AND (rb.valid_until IS NULL OR rb.valid_until>$4)
 UNION ALL
 SELECT p.code, 'TEMPORARY_GRANT' AS role_code, tg.scope_type, tg.scope_id, 'Temporary Elevation' AS source,
        true AS temporary
 FROM identity.temporary_grants tg JOIN identity.permissions p ON p.id=tg.permission_id
 JOIN identity.users u ON u.tenant_id=tg.tenant_id AND u.id=tg.principal_id
 WHERE tg.tenant_id=$1 AND tg.principal_id=$2 AND u.employment_status='ACTIVE' AND u.archived_at IS NULL AND tg.revoked_at IS NULL AND p.code=$3 AND tg.valid_from<= $4 AND tg.valid_until>$4`,
    [input.tenantId, input.principalId, input.action, at],
  );
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
