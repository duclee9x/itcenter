import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { assertEvent } from "../../packages/event-contracts/src/index.js";
import { errorResponse } from "../../packages/api-contracts/src/index.js";
import { requestContext } from "../../packages/observability/src/index.js";
import { event } from "../helpers.js";
test("event envelope requires metadata and rejects invalid version and fields", () => {
  const value = { ...event(), published_at: new Date().toISOString() };
  assertEvent(value);
  for (const field of [
    "event_id",
    "actor",
    "aggregate",
    "correlation_id",
    "causation_id",
    "tenant_id",
    "payload",
  ]) {
    const bad: Record<string, unknown> = { ...value };
    delete bad[field];
    assert.throws(() => assertEvent(bad));
  }
  assert.throws(() => assertEvent({ ...value, schema_version: 0 }));
  assert.throws(() => assertEvent({ ...value, event_id: "bad" }));
});
test("error response conforms to schema and API contract exposes only bootstrap routes", () => {
  const schema = JSON.parse(
    readFileSync("contracts/json-schema/error-envelope.v1.json", "utf8"),
  );
  assert.equal(
    new Ajv().compile(schema)(
      errorResponse(new Error("private"), requestContext("corr")).body,
    ),
    true,
  );
  const api = JSON.parse(
    readFileSync("contracts/openapi/bootstrap.v1.json", "utf8"),
  );
  assert.deepEqual(
    Object.keys(api.paths).sort(),
    [
      "/api/v1/auth/logout",
      "/api/v1/authorization/evaluate",
      "/api/v1/authorization/evaluate-batch",
      "/api/v1/health/live",
      "/api/v1/health/ready",
      "/api/v1/me",
      "/api/v1/operations/{id}",
    ].sort(),
  );
  assert.deepEqual(api.components.schemas.Error.properties, schema.properties);
  for (const path of ["/api/v1/me", "/api/v1/operations/{id}"])
    assert.ok(api.paths[path].get.security);
});
