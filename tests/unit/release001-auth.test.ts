import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  UnsecuredJWT,
} from "jose";
import { ApplicationError } from "../../packages/api-contracts/src/index.js";
import {
  authenticate,
  withAuthenticatedRequest,
  type AuthenticationPort,
} from "../../packages/auth/src/index.js";
import { loadConfig } from "../../packages/config/src/index.js";
import {
  requestedTenantId,
  verifyOidcAccessToken,
} from "../../modules/identity/infrastructure/oidc-authentication.js";
import { postgresAuthorization } from "../../apps/api/src/postgres-authorization.js";
import type { UnitOfWork } from "../../packages/persistence/src/index.js";
import { OidcApiAuthentication } from "../../modules/identity/infrastructure/oidc-authentication.js";

const issuer = "https://issuer.example";
const audience = "itcenter-api";
const now = Math.floor(Date.now() / 1000);

async function signingFixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await (await import("jose")).exportJWK(publicKey);
  jwk.kid = "key-1";
  jwk.use = "sig";
  jwk.alg = "RS256";
  const resolver = createLocalJWKSet({ keys: [jwk] });
  const token = (
    claims: Record<string, unknown> = {},
    typ = "at+jwt",
    kid = "key-1",
  ) => {
    const jwt = new SignJWT({
      client_id: "web-client",
      jti: "jti-1",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid, typ })
      .setIssuer(typeof claims.iss === "string" ? claims.iss : issuer)
      .setAudience(typeof claims.aud === "string" ? claims.aud : audience)
      .setSubject(typeof claims.sub === "string" ? claims.sub : "subject-1")
      .setIssuedAt(typeof claims.iat === "number" ? claims.iat : now)
      .setExpirationTime(
        typeof claims.exp === "number" ? claims.exp : now + 300,
      );
    if (typeof claims.nbf === "number") jwt.setNotBefore(claims.nbf);
    return jwt.sign(privateKey);
  };
  return { token, resolver };
}

test("RELEASE-001 OIDC validates signed RFC 9068 RS256 access tokens", async () => {
  const fixture = await signingFixture();
  const token = await fixture.token();
  const payload = await verifyOidcAccessToken(
    token,
    fixture.resolver,
    issuer,
    audience,
  );
  assert.equal(payload.sub, "subject-1");
  assert.equal(payload.client_id, "web-client");
});

test("RELEASE-001 rejects wrong issuer, audience, expiry, nbf, token type, and missing RFC 9068 claims", async () => {
  const fixture = await signingFixture();
  const invalid = [
    ["issuer", await fixture.token({ iss: "https://other.example" })],
    ["audience", await fixture.token({ aud: "other-api" })],
    ["expired", await fixture.token({ exp: now - 100 })],
    ["nbf", await fixture.token({ nbf: now + 600 })],
    ["token type", await fixture.token({}, "JWT")],
    ["jti", await fixture.token({ jti: undefined })],
    ["client_id", await fixture.token({ client_id: undefined })],
    ["future iat", await fixture.token({ iat: now + 600 })],
  ];
  for (const [claim, token] of invalid) {
    try {
      await verifyOidcAccessToken(token!, fixture.resolver, issuer, audience);
      assert.fail(`accepted invalid ${claim}`);
    } catch (error) {
      assert.equal(
        (error as ApplicationError).code,
        "AUTHENTICATION_REQUIRED",
        String(claim),
      );
    }
  }
  const unsecured = new UnsecuredJWT({
    sub: "subject-1",
    client_id: "web-client",
    jti: "jti-1",
    iat: now,
    exp: now + 60,
    iss: issuer,
    aud: audience,
  }).encode();
  await assert.rejects(
    verifyOidcAccessToken(unsecured, fixture.resolver, issuer, audience),
    { code: "AUTHENTICATION_REQUIRED" },
  );
});

test("RELEASE-001 rejects unknown kid and maps unavailable JWKS to fail-closed service error", async () => {
  const fixture = await signingFixture();
  const unknown = await fixture.token({}, "at+jwt", "unknown-key");
  await assert.rejects(
    verifyOidcAccessToken(unknown, fixture.resolver, issuer, audience),
    { code: "AUTHENTICATION_REQUIRED" },
  );
  const unavailable = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    verifyOidcAccessToken(await fixture.token(), unavailable, issuer, audience),
    { code: "DEPENDENCY_UNAVAILABLE" },
  );
});

test("RELEASE-001 rejects invalid signatures and algorithms outside the RS256 allow-list", async () => {
  const fixture = await signingFixture();
  const wrongPair = await generateKeyPair("RS256");
  const forged = await new SignJWT({
    client_id: "web-client",
    jti: "jti-forged",
  })
    .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "at+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("subject-1")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(wrongPair.privateKey);
  await assert.rejects(
    verifyOidcAccessToken(forged, fixture.resolver, issuer, audience),
    { code: "AUTHENTICATION_REQUIRED" },
  );
  const rsa384 = await generateKeyPair("RS384");
  const substituted = await new SignJWT({
    client_id: "web-client",
    jti: "jti-substituted",
  })
    .setProtectedHeader({ alg: "RS384", kid: "key-1", typ: "at+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("subject-1")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(rsa384.privateKey);
  await assert.rejects(
    verifyOidcAccessToken(substituted, fixture.resolver, issuer, audience),
    { code: "AUTHENTICATION_REQUIRED" },
  );
});

test("RELEASE-001 production config requires OIDC issuer and audience and rejects bypass mode", () => {
  const base = {
    APP_ENV: "production",
    DATABASE_SECRET_REF: "file:/run/secrets/db",
  };
  assert.throws(() => loadConfig(base), /AUTH_MODE=oidc/);
  assert.throws(
    () => loadConfig({ ...base, AUTH_MODE: "oidc", OIDC_ISSUER: issuer }),
    /OIDC_ISSUER and OIDC_AUDIENCE/,
  );
  assert.throws(
    () => loadConfig({ ...base, AUTH_MODE: "unavailable" }),
    /AUTH_MODE=oidc/,
  );
  assert.throws(() =>
    loadConfig({
      ...base,
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "http://issuer",
      OIDC_AUDIENCE: audience,
    }),
  );
  const valid = loadConfig({
    ...base,
    AUTH_MODE: "oidc",
    OIDC_ISSUER: issuer,
    OIDC_AUDIENCE: audience,
  });
  assert.equal(valid.authMode, "oidc");
});

test("RELEASE-001 tenant selector rejects missing, malformed and duplicate values", () => {
  assert.throws(() => requestedTenantId(undefined), {
    code: "TENANT_CONTEXT_REQUIRED",
  });
  assert.throws(() => requestedTenantId({ values: [] }), {
    code: "TENANT_CONTEXT_REQUIRED",
  });
  for (const values of [[""], ["  "], ["bad/value"], ["tenant-a", "tenant-b"]])
    assert.throws(() => requestedTenantId({ values }), {
      code: "INVALID_TENANT_CONTEXT",
    });
  assert.equal(
    requestedTenantId({ values: ["tenant-A:west"] }),
    "tenant-A:west",
  );
});

test("RELEASE-001 request auth caches one tenant-bound principal and rejects malformed bearer credentials", async () => {
  let calls = 0;
  let seenTenant = "";
  const adapter: AuthenticationPort = {
    async authenticate(token, selector) {
      calls++;
      assert.equal(token, "signed-token");
      seenTenant = selector?.values[0] ?? "";
      return { id: "local-user", tenant_id: seenTenant, actor_type: "USER" };
    },
  };
  await withAuthenticatedRequest({
    port: adapter,
    authorization: "Bearer signed-token",
    tenantSelector: { values: ["tenant-b"] },
    work: async () => {
      assert.equal(
        (await authenticate(adapter, "Bearer signed-token")).tenant_id,
        "tenant-b",
      );
    },
  });
  assert.equal(calls, 1);
  assert.equal(seenTenant, "tenant-b");
  for (const authorization of [undefined, "Basic abc", "Bearer ", "Bearer a b"])
    await assert.rejects(
      withAuthenticatedRequest({
        port: adapter,
        authorization,
        tenantSelector: { values: [] },
        work: async () => undefined,
      }),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "AUTHENTICATION_REQUIRED",
    );
});

test("RELEASE-001 RBAC query failures fail closed", async () => {
  const uow: UnitOfWork = {
    async run() {
      throw new Error("database unavailable");
    },
  };
  const decision = await postgresAuthorization(uow).evaluate({
    principal: {
      id: "local-user",
      tenant_id: "tenant-a",
      actor_type: "USER",
    },
    action: "asset.read",
    resource: { type: "asset", id: "asset-1", tenant_id: "tenant-a" },
    scope: {},
    context: {},
  });
  assert.equal(decision.result, "DENY");
});

test("RELEASE-001 identity and membership persistence failures never create a principal", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "auth-dependency-key";
  jwk.use = "sig";
  jwk.alg = "RS256";
  const fetcher: typeof fetch = async (url) =>
    String(url).endsWith("/.well-known/openid-configuration")
      ? new Response(
          JSON.stringify({
            issuer,
            jwks_uri: "https://issuer.example/jwks",
          }),
          { status: 200 },
        )
      : new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  const token = await new SignJWT({ client_id: "web", jti: "auth-jti" })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid, typ: "at+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("auth-subject")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const noIdentityStore = await OidcApiAuthentication.create({
    pool: {
      async query() {
        throw new Error("identity database unavailable");
      },
    } as never,
    uow: {} as UnitOfWork,
    issuer,
    audience,
    fetcher,
  });
  await assert.rejects(
    noIdentityStore.authenticate(token, { values: ["tenant-a"] }),
    { code: "DEPENDENCY_UNAVAILABLE" },
  );

  const identityStore = await OidcApiAuthentication.create({
    pool: {
      async query() {
        return {
          rows: [
            {
              id: "identity-link",
              principal_type: "HUMAN",
              status: "ACTIVE",
              identity_class: "STANDARD",
            },
          ],
        };
      },
    } as never,
    uow: {
      async run() {
        throw new Error("membership database unavailable");
      },
    } as UnitOfWork,
    issuer,
    audience,
    fetcher,
  });
  await assert.rejects(
    identityStore.authenticate(token, { values: ["tenant-a"] }),
    { code: "DEPENDENCY_UNAVAILABLE" },
  );
});
