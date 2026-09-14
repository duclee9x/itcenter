import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { ApplicationError } from "../../../packages/api-contracts/src/index.js";
import { PostgresAudit } from "../../../modules/audit/index.js";

/** Trusted control-plane operation. Deliberately has no HTTP route. */
export async function bootstrapInitialAdministrator(input: {
  uow: UnitOfWork;
  issuer: string;
  subject: string;
  tenantId: string;
  localUserId: string;
  adminRoleId: string;
  operatorId: string;
  reason: string;
}): Promise<{ identityLinkId: string; membershipId: string }> {
  if (
    !input.issuer.startsWith("https://") ||
    !input.subject.trim() ||
    !input.tenantId.trim() ||
    !input.operatorId.trim() ||
    !input.reason.trim()
  )
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Bootstrap identity and operator context are required.",
    );
  return input.uow.run(
    input.tenantId,
    async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(70911097)");
      const completed = await tx.query(
        "SELECT singleton FROM identity.initial_admin_bootstrap WHERE singleton=true",
      );
      if (completed.rowCount)
        throw new ApplicationError(
          "PERMISSION_DENIED",
          "Initial administrator bootstrap is already complete.",
        );
      const administrator = await tx.query(
        `SELECT 1 FROM identity.role_bindings rb
       JOIN identity.role_permissions rp ON rp.tenant_id=rb.tenant_id AND rp.role_id=rb.role_id
       JOIN identity.roles r ON r.tenant_id=rb.tenant_id AND r.id=rb.role_id
       JOIN identity.permissions p ON p.id=rp.permission_id
       JOIN identity.users u ON u.tenant_id=rb.tenant_id AND u.id=rb.principal_id
       WHERE rb.principal_type='USER' AND rb.revoked_at IS NULL AND rb.valid_from<=now()
         AND (rb.valid_until IS NULL OR rb.valid_until>now()) AND p.code='rbac.manage'
         AND r.status='ACTIVE'
         AND u.employment_status='ACTIVE' AND u.archived_at IS NULL LIMIT 1`,
      );
      if (administrator.rowCount)
        throw new ApplicationError(
          "PERMISSION_DENIED",
          "An active platform administrator already exists.",
        );
      const user = await tx.query(
        "SELECT id FROM identity.users WHERE tenant_id=$1 AND id=$2 AND employment_status='ACTIVE' AND archived_at IS NULL",
        [input.tenantId, input.localUserId],
      );
      if (!user.rowCount)
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "An active tenant-local user is required.",
        );
      const role = await tx.query(
        `SELECT r.id FROM identity.roles r
       JOIN identity.role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
       JOIN identity.permissions p ON p.id=rp.permission_id
       WHERE r.tenant_id=$1 AND r.id=$2 AND r.status='ACTIVE' AND p.code='rbac.manage'`,
        [input.tenantId, input.adminRoleId],
      );
      if (!role.rowCount)
        throw new ApplicationError(
          "VALIDATION_ERROR",
          "The selected active role is not an administrator role.",
        );

      const identityLinkId = randomUUID();
      const membershipId = randomUUID();
      const bindingId = randomUUID();
      await tx.query(
        `INSERT INTO identity.identity_links(id,issuer,principal_type,subject,provenance,created_by,verified_at)
       VALUES($1,$2,'HUMAN',$3,'TRUSTED_BOOTSTRAP',$4,now())`,
        [identityLinkId, input.issuer, input.subject, input.operatorId],
      );
      await tx.query(
        `INSERT INTO identity.tenant_memberships(id,tenant_id,identity_link_id,principal_type,local_user_id,granted_by,provenance)
       VALUES($1,$2,$3,'HUMAN',$4,$5,'TRUSTED_BOOTSTRAP')`,
        [
          membershipId,
          input.tenantId,
          identityLinkId,
          input.localUserId,
          input.operatorId,
        ],
      );
      await tx.query(
        `INSERT INTO identity.role_bindings(id,tenant_id,principal_type,principal_id,role_id,scope_type,scope_id,source,valid_from,reason,created_by)
       VALUES($1,$2,'USER',$3,$4,'TENANT',$2,'BOOTSTRAP',now(),$5,$6)`,
        [
          bindingId,
          input.tenantId,
          input.localUserId,
          input.adminRoleId,
          input.reason,
          input.localUserId,
        ],
      );
      await tx.query(
        `INSERT INTO identity.initial_admin_bootstrap(singleton,identity_link_id,tenant_id,tenant_membership_id,local_user_id,role_id,completed_by)
       VALUES(true,$1,$2,$3,$4,$5,$6)`,
        [
          identityLinkId,
          input.tenantId,
          membershipId,
          input.localUserId,
          input.adminRoleId,
          input.operatorId,
        ],
      );
      await new PostgresAudit(tx).append({
        id: randomUUID(),
        tenant_id: input.tenantId,
        event_type: "IDENTITY.INITIAL_ADMIN_BOOTSTRAPPED",
        occurred_at: new Date().toISOString(),
        actor: { type: "CONTROL_PLANE", id: input.operatorId },
        action: { command_type: "IDENTITY.BOOTSTRAP_INITIAL_ADMIN" },
        subject: { entity_type: "USER", entity_id: input.localUserId },
        correlation_id: randomUUID(),
        causation_id: randomUUID(),
        reason: { code: "TRUSTED_BOOTSTRAP", text: input.reason },
        before: null,
        after: {
          identity_link_id: identityLinkId,
          tenant_membership_id: membershipId,
          role_id: input.adminRoleId,
        },
        outcome: { status: "SUCCESS" },
        classification: "RESTRICTED",
        relations: [],
        evidence: [],
      });
      return { identityLinkId, membershipId };
    },
    { isolationLevel: "SERIALIZABLE" },
  );
}
