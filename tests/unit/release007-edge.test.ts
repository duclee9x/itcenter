import assert from "node:assert/strict";
import test from "node:test";
import {
  API_BODY_LIMIT_BYTES,
  GENERAL_RATE_LIMIT,
  MUTATION_RATE_LIMIT,
  TokenBucketLimiter,
  createApiEdgePolicy,
  trustedClientIp,
} from "../../apps/api/src/edge-policy.js";

function request(
  path: string,
  method = "GET",
  remoteAddress = "172.20.0.2",
  headers: Record<string, string> = {},
) {
  return { url: path, method, headers, socket: { remoteAddress } } as never;
}

function response() {
  const headers = new Map<string, string>();
  return {
    headers,
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    end() {},
  } as {
    headers: Map<string, string>;
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(): void;
  };
}

test("R7 defaults are normative and limiter state is bounded", () => {
  assert.deepEqual(GENERAL_RATE_LIMIT, {
    rate: 300,
    windowSeconds: 60,
    burst: 100,
  });
  assert.deepEqual(MUTATION_RATE_LIMIT, {
    rate: 60,
    windowSeconds: 60,
    burst: 20,
  });
  let now = 0;
  const limiter = new TokenBucketLimiter(2, () => now);
  const policy = { rate: 1, windowSeconds: 60, burst: 0 };
  assert.equal(limiter.consume("a", policy).allowed, true);
  assert.equal(limiter.consume("a", policy).allowed, false);
  assert.equal(limiter.consume("b", policy).allowed, true);
  assert.equal(limiter.consume("c", policy).allowed, true);
  assert.equal(limiter.size(), 2);
  now = 120_001;
  assert.equal(limiter.consume("d", policy).allowed, true);
  assert.equal(limiter.size(), 1);
});

test("only a private Caddy hop may supply the client IP", () => {
  assert.equal(
    trustedClientIp(
      request("/api/v1/x", "GET", "172.20.0.2", {
        "x-forwarded-for": "203.0.113.7",
      }),
    ),
    "203.0.113.7",
  );
  assert.equal(
    trustedClientIp(
      request("/api/v1/x", "GET", "203.0.113.9", {
        "x-forwarded-for": "10.0.0.4",
      }),
    ),
    "203.0.113.9",
  );
});

test("health bypasses edge quota, API mutations use both buckets, and body is bounded", () => {
  const policy = createApiEdgePolicy({
    general: { rate: 1, windowSeconds: 60, burst: 0 },
    mutations: { rate: 1, windowSeconds: 60, burst: 0 },
  });
  const context = { requestId: "r7", correlationId: "r7" } as never;
  assert.equal(
    policy.beforeRoute(
      request("/api/v1/health/ready"),
      response() as never,
      context,
    ),
    false,
  );
  assert.equal(
    policy.beforeRoute(request("/api/v1/items"), response() as never, context),
    false,
  );
  const limited = response();
  assert.equal(
    policy.beforeRoute(request("/api/v1/items"), limited as never, context),
    true,
  );
  assert.equal(limited.statusCode, 429);
  const oversized = response();
  assert.equal(
    policy.beforeRoute(
      request("/api/v1/items", "POST", "172.20.0.3", {
        "content-length": String(API_BODY_LIMIT_BYTES + 1),
      }),
      oversized as never,
      context,
    ),
    true,
  );
  assert.equal(oversized.statusCode, 413);
});
