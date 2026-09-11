import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, databaseUrl } from "../../packages/config/src/index.js";
import {
  ApplicationError,
  errorResponse,
  assertVersion,
} from "../../packages/api-contracts/src/index.js";
import {
  requestContext,
  logger,
  Metrics,
} from "../../packages/observability/src/index.js";
import {
  authorize,
  denyAll,
  type AuthorizationPort,
} from "../../packages/auth/src/index.js";
import { requestHash } from "../../packages/messaging/src/index.js";
import { WorkerHost } from "../../apps/worker/src/host.js";
const env = { DATABASE_SECRET_REF: "env:TEST_URL" };
test("configuration validates ports, environment, log level and secret refs", () => {
  assert.equal(loadConfig(env).port, 3000);
  for (const values of [
    { PORT: "0" },
    { APP_ENV: "unknown" },
    { LOG_LEVEL: "verbose" },
    { DATABASE_SECRET_REF: "password" },
  ])
    assert.throws(() => loadConfig({ ...env, ...values }));
  assert.throws(() => loadConfig({ ...env, APP_ENV: "production" }));
  const production = loadConfig({
    APP_ENV: "production",
    DATABASE_SECRET_REF: "file:/run/secrets/database",
  });
  assert.throws(() =>
    databaseUrl(production, {
      resolve: () => "postgres://app:password@host/db?sslmode=verify-full",
    }),
  );
  assert.throws(() =>
    databaseUrl(production, { resolve: () => "postgres://app:secret@host/db" }),
  );
});
test("canonical error classes map HTTP status; unknown exceptions are sanitized", () => {
  const ctx = requestContext("corr");
  const codes = {
    VALIDATION_ERROR: 400,
    AUTHENTICATION_REQUIRED: 401,
    PERMISSION_DENIED: 403,
    NOT_FOUND: 404,
    VERSION_CONFLICT: 409,
    IDEMPOTENCY_KEY_CONFLICT: 409,
    BUSINESS_RULE_VIOLATION: 422,
    DEPENDENCY_UNAVAILABLE: 503,
    INTERNAL_ERROR: 500,
  } as const;
  for (const [code, status] of Object.entries(codes))
    assert.equal(
      errorResponse(
        new ApplicationError(code as keyof typeof codes, "safe"),
        ctx,
      ).status,
      status,
    );
  const response = errorResponse(new Error("password=secret SQL stack"), ctx);
  assert.equal(response.body.error.code, "INTERNAL_ERROR");
  assert.ok(!JSON.stringify(response).includes("secret"));
  assert.equal(response.body.meta.correlation_id, "corr");
});
test("correlation preserves valid ID and generates unique request IDs", () => {
  const a = requestContext("corr"),
    b = requestContext("corr");
  assert.equal(a.correlation_id, b.correlation_id);
  assert.notEqual(a.request_id, b.request_id);
  assert.notEqual(requestContext("bad\nheader").correlation_id, "bad\nheader");
});
test("structured logging carries service/environment/context and respects level", () => {
  const lines: string[] = [];
  const log = logger(
    { serviceName: "api", environment: "test", logLevel: "warn" },
    (line) => lines.push(line),
  );
  log("info", "ignored");
  log("error", "failed", requestContext("corr"));
  assert.equal(lines.length, 1);
  const value = JSON.parse(lines[0]!);
  assert.equal(value.service_name, "api");
  assert.equal(value.environment, "test");
  assert.equal(value.correlation_id, "corr");
  const metrics = new Metrics();
  metrics.increment("requests");
  assert.equal(metrics.snapshot().requests, 1);
});
test("authorization allows through adapter, denies by default, rejects cross-tenant before adapter", async () => {
  const request = {
    principal: { id: "user", tenant_id: "a", actor_type: "USER" },
    action: "user.read",
    resource: { type: "user", id: "user", tenant_id: "a" },
    scope: {},
    context: {},
  };
  const allow: AuthorizationPort = {
    async evaluate() {
      return { result: "ALLOW", reason: "test fixture" };
    },
  };
  await authorize(allow, request);
  await assert.rejects(authorize(denyAll, request), {
    code: "PERMISSION_DENIED",
  });
  await assert.rejects(
    authorize(allow, {
      ...request,
      resource: { ...request.resource, tenant_id: "b" },
    }),
    { code: "PERMISSION_DENIED" },
  );
});
test("canonical hashes preserve semantic equality and detect changed content", () => {
  assert.equal(requestHash({ b: 2, a: 1 }), requestHash({ a: 1, b: 2 }));
  assert.notEqual(requestHash([1, 2]), requestHash([2, 1]));
  assert.throws(() => requestHash(NaN));
  assert.throws(() => assertVersion(2, 1), { code: "VERSION_CONFLICT" });
});
test("worker hosts a task and waits for graceful abort", async () => {
  const host = new WorkerHost();
  let stopped = false;
  host.start([
    {
      name: "test-consumer",
      run: (signal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              stopped = true;
              resolve();
            },
            { once: true },
          ),
        ),
    },
  ]);
  await host.stop();
  assert.equal(stopped, true);
  assert.throws(() => host.start([]));
});

test("audit policy rejects nested secret fields before persistence", async () => {
  const { assertNoSecretFields } =
    await import("../../modules/audit/domain/audit-policy.js");
  assert.throws(
    () => assertNoSecretFields({ after: { access_token: "never-persist" } }),
    /Sensitive data/,
  );
  assertNoSecretFields({ after: { display_name: "Synthetic" } });
});
