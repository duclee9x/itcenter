import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAuthorization } from "../../modules/identity/application/authorization.js";
import {
  grantTemporary,
  revokeTemporary,
} from "../../modules/identity/application/privilege.js";
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

test("temporary grants require reason and bounded validity and revoke by version", async () => {
  const queries: string[] = [];
  const tx = {
    tenantId: "t1",
    query: async (sql: string) => {
      queries.push(sql);
      return sql.startsWith("SELECT")
        ? { rowCount: 1, rows: [{ id: "u" }] }
        : { rowCount: 1, rows: [] };
    },
  } as never;
  await assert.rejects(
    grantTemporary({
      tx,
      principalId: "u",
      permissionId: "p",
      scopeType: "SITE",
      scopeId: "s",
      validFrom: new Date(2000),
      validUntil: new Date(1000),
      reason: "",
    }),
    { code: "VALIDATION_ERROR" },
  );
  const grant = await grantTemporary({
    tx,
    principalId: "u",
    permissionId: "p",
    scopeType: "SITE",
    scopeId: "s",
    validFrom: new Date(1000),
    validUntil: new Date(2000),
    reason: "incident response",
  });
  assert.equal(grant.version, 1);
  await revokeTemporary(tx, grant.id, grant.version);
  assert.match(queries.at(-1)!, /revoked_at/);
});
