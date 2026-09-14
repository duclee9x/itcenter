import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { apiServer } from "../../apps/api/src/server.js";
import { ApplicationError } from "../../packages/api-contracts/src/index.js";
import type {
  AuthenticationPort,
  AuthorizationPort,
} from "../../packages/auth/src/index.js";
import { loadConfig } from "../../packages/config/src/index.js";
import type { UnitOfWork } from "../../packages/persistence/src/index.js";

test("RELEASE-001 protects tenant APIs by default, authenticates before tenant errors, and keeps only health public", async () => {
  const authentication: AuthenticationPort = {
    tenantContextRequired: true,
    async authenticate(token, selector) {
      if (token !== "valid")
        throw new ApplicationError(
          "AUTHENTICATION_REQUIRED",
          "Authentication is required.",
        );
      const values = selector?.values ?? [];
      if (!values.length)
        throw new ApplicationError(
          "TENANT_CONTEXT_REQUIRED",
          "X-Tenant-ID is required.",
        );
      if (
        values.length !== 1 ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(values[0]!)
      )
        throw new ApplicationError(
          "INVALID_TENANT_CONTEXT",
          "X-Tenant-ID is invalid.",
        );
      return { id: "local-user", tenant_id: values[0]!, actor_type: "USER" };
    },
  };
  const authorization: AuthorizationPort = {
    async evaluate() {
      return { result: "DENY", reason: "test deny" };
    },
  };
  const uow: UnitOfWork = {
    async run(tenant, work) {
      if (!tenant || typeof work !== "function")
        throw new Error("invalid test unit of work call");
      throw new Error("unexpected route database access");
    },
  };
  const server = apiServer(
    loadConfig({
      APP_ENV: "test",
      DATABASE_SECRET_REF: "env:TEST_DATABASE_URL",
    }),
    async () => true,
    authentication,
    authorization,
    uow,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const noCredential = await fetch(`${base}/api/v1/not-a-route`, {
      headers: { "X-Tenant-ID": "tenant-a" },
    });
    assert.equal(noCredential.status, 401);
    const invalidBeforeTenant = await fetch(`${base}/api/v1/not-a-route`, {
      headers: { Authorization: "Bearer bad" },
    });
    assert.equal(invalidBeforeTenant.status, 401);
    const missingTenant = await fetch(`${base}/api/v1/not-a-route`, {
      headers: { Authorization: "Bearer valid" },
    });
    assert.equal(missingTenant.status, 400);
    assert.equal(
      ((await missingTenant.json()) as { error: { code: string } }).error.code,
      "TENANT_CONTEXT_REQUIRED",
    );
    const invalidTenant = await fetch(`${base}/api/v1/not-a-route`, {
      headers: {
        Authorization: "Bearer valid",
        "X-Tenant-ID": "tenant a",
      },
    });
    assert.equal(invalidTenant.status, 400);
    assert.equal(
      ((await invalidTenant.json()) as { error: { code: string } }).error.code,
      "INVALID_TENANT_CONTEXT",
    );
    const duplicateTenant = await fetch(`${base}/api/v1/not-a-route`, {
      headers: [
        ["Authorization", "Bearer valid"],
        ["X-Tenant-ID", "tenant-a"],
        ["X-Tenant-ID", "tenant-b"],
      ],
    });
    assert.equal(duplicateTenant.status, 400);
    assert.equal(
      ((await duplicateTenant.json()) as { error: { code: string } }).error
        .code,
      "INVALID_TENANT_CONTEXT",
    );
    const protectedUnknown = await fetch(`${base}/api/v1/not-a-route`, {
      headers: { Authorization: "Bearer valid", "X-Tenant-ID": "tenant-a" },
    });
    assert.equal(protectedUnknown.status, 404);
    const capabilities = await fetch(`${base}/api/v1/health/capabilities`, {
      headers: { Authorization: "Bearer valid", "X-Tenant-ID": "tenant-a" },
    });
    assert.equal(capabilities.status, 403);
    const live = await fetch(`${base}/api/v1/health/live`, {
      headers: { Authorization: "Bearer bad", "X-Tenant-ID": "tenant-a" },
    });
    assert.equal(live.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
