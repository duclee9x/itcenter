import type { AuthorizationPort } from "../../../packages/auth/src/index.js";
import type { UnitOfWork } from "../../../packages/persistence/src/index.js";
import { evaluateAuthorization } from "../../../modules/identity/index.js";

const supported = new Set([
  "USER",
  "SYSTEM_AUTOMATION",
  "SYSTEM_CORRELATION",
  "SYSTEM_ASSET_SCORING",
  "SYSTEM_RECOMMENDATION",
  "SYSTEM_REPORTING",
]);

export function postgresAuthorization(uow: UnitOfWork): AuthorizationPort {
  return {
    async evaluate(request) {
      if (!supported.has(request.principal.actor_type))
        return { result: "DENY", reason: "Unsupported principal type" };
      try {
        return await uow.run(request.principal.tenant_id, (tx) =>
          evaluateAuthorization(tx, {
            principalId: request.principal.id,
            principalType: request.principal.actor_type as
              | "USER"
              | "SYSTEM_AUTOMATION"
              | "SYSTEM_CORRELATION"
              | "SYSTEM_ASSET_SCORING"
              | "SYSTEM_RECOMMENDATION"
              | "SYSTEM_REPORTING",
            tenantId: request.principal.tenant_id,
            action: request.action,
            resourceType: request.resource.type,
            resourceId: request.resource.id,
            scope: request.scope,
          }),
        );
      } catch {
        return { result: "DENY", reason: "Authorization unavailable" };
      }
    },
  };
}
