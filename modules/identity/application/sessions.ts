import { randomUUID } from "node:crypto";
import type { Transaction } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
export async function createSession(
  tx: Transaction,
  input: {
    tenantId: string;
    userId: string;
    authMethod: "OIDC" | "SAML" | "LDAP";
    now: Date;
    idleMs: number;
    absoluteMs: number;
    sourceIp?: string;
  },
): Promise<{ id: string; expiresAt: Date }> {
  if (input.tenantId !== tx.tenantId)
    throw new ApplicationError("PERMISSION_DENIED", "Tenant mismatch.");
  if (
    !Number.isFinite(input.idleMs) ||
    !Number.isFinite(input.absoluteMs) ||
    input.idleMs <= 0 ||
    input.absoluteMs <= 0 ||
    input.absoluteMs < input.idleMs
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Session expiry durations are invalid.",
    );
  const user = await tx.query(
    "SELECT id FROM identity.users WHERE tenant_id=$1 AND id=$2 AND employment_status='ACTIVE' AND archived_at IS NULL",
    [input.tenantId, input.userId],
  );
  if (!user.rowCount)
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Only active users may obtain a session.",
    );
  const id = randomUUID(),
    idle = new Date(input.now.getTime() + input.idleMs),
    absolute = new Date(input.now.getTime() + input.absoluteMs);
  await tx.query(
    "INSERT INTO identity.sessions(id,tenant_id,user_id,auth_method,created_at,last_activity,idle_expires_at,absolute_expires_at,source_ip) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8)",
    [
      id,
      input.tenantId,
      input.userId,
      input.authMethod,
      input.now,
      idle,
      absolute,
      input.sourceIp ?? null,
    ],
  );
  return { id, expiresAt: absolute < idle ? absolute : idle };
}
export async function revokeSession(
  tx: Transaction,
  id: string,
  expectedVersion: number,
  now = new Date(),
): Promise<void> {
  const row = await tx.query(
    "UPDATE identity.sessions SET revoked_at=$3,version=version+1 WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL AND version=$4 RETURNING id",
    [tx.tenantId, id, now, expectedVersion],
  );
  if (!row.rowCount)
    throw new ApplicationError(
      "VERSION_CONFLICT",
      "Session is already revoked, expired, or changed.",
    );
}
export async function assertSessionActive(
  tx: Transaction,
  id: string,
  now = new Date(),
): Promise<{ user_id: string; tenant_id: string; version: number }> {
  const row = await tx.query<{
    user_id: string;
    tenant_id: string;
    version: number;
  }>(
    "SELECT s.user_id,s.tenant_id,s.version FROM identity.sessions s JOIN identity.users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id WHERE s.id=$1 AND s.tenant_id=$2 AND u.employment_status='ACTIVE' AND u.archived_at IS NULL AND s.revoked_at IS NULL AND s.idle_expires_at>$3 AND s.absolute_expires_at>$3 FOR UPDATE",
    [id, tx.tenantId, now],
  );
  if (!row.rowCount)
    throw new ApplicationError(
      "AUTHENTICATION_REQUIRED",
      "Session is expired or revoked.",
    );
  return row.rows[0]!;
}
