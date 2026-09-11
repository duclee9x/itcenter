import type { Permission } from "../domain/model.js";
// Platform permission needed by the bootstrap operation query; no grant is implied.
export const permissions: readonly Permission[] = [
  { code: "session.revoke", resource_type: "session", action: "revoke" },
  {
    code: "authorization.evaluate",
    resource_type: "authorization",
    action: "evaluate",
  },
  { code: "operation.read", resource_type: "operation", action: "read" },
  { code: "user.read", resource_type: "user", action: "read" },
  { code: "role_binding.read", resource_type: "role_binding", action: "read" },
  { code: "rbac.manage", resource_type: "rbac", action: "manage" },
];
