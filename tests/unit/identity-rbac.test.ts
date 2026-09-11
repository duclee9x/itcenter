import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAuthorization } from "../../modules/identity/application/authorization.js";
test("RBAC evaluator enforces tenant, explicit deny and scope", async () => {
  const tx = {
    tenantId: "t1",
    query: async () => ({
      rowCount: 2,
      rows: [
        {
          code: "asset.read",
          role_code: "Helpdesk",
          scope_type: "SITE",
          scope_id: "hn",
          source: "Manual",
        },
        {
          code: "asset.read",
          role_code: "Deny",
          scope_type: "SITE",
          scope_id: "hn",
          source: "EXPLICIT_DENY",
        },
      ],
    }),
  } as never;
  assert.equal(
    (
      await evaluateAuthorization(tx, {
        principalId: "u",
        tenantId: "t1",
        action: "asset.read",
        resourceType: "asset",
        resourceId: "a",
        scope: { site: "hn" },
      })
    ).result,
    "DENY",
  );
  assert.equal(
    (
      await evaluateAuthorization(tx, {
        principalId: "u",
        tenantId: "t2",
        action: "asset.read",
        resourceType: "asset",
        resourceId: "a",
        scope: { site: "hn" },
      })
    ).result,
    "DENY",
  );
});
