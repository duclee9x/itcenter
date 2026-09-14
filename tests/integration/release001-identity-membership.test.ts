import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { testDatabase } from "../helpers.js";
import { OidcApiAuthentication } from "../../modules/identity/infrastructure/oidc-authentication.js";
import { postgresAuthorization } from "../../apps/api/src/postgres-authorization.js";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { bootstrapInitialAdministrator } from "../../modules/identity/infrastructure/bootstrap-administrator.js";

test(
  "RELEASE-001 identity links are provider-subject keyed and support explicit per-tenant local users",
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async () => {
    const db = await testDatabase();
    const issuer = "https://issuer.example/";
    const subject = `user-${randomUUID()}`;
    const linkId = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    try {
      await db.pool.query(
        `INSERT INTO identity.identity_links(id,issuer,principal_type,subject,provenance,created_by)
       VALUES($1,$2,'HUMAN',$3,'TEST','test')`,
        [linkId, issuer, subject],
      );
      await assert.rejects(
        db.pool.query(
          `INSERT INTO identity.identity_links(id,issuer,principal_type,subject,provenance,created_by)
         VALUES($1,$2,'HUMAN',$3,'TEST','test')`,
          [randomUUID(), issuer, subject],
        ),
        (error: unknown) => (error as { code?: string }).code === "23505",
      );
      await assert.rejects(
        db.pool.query(
          `INSERT INTO identity.identity_links(id,issuer,principal_type,identity_class,client_id,provenance,created_by)
           VALUES($1,$2,'SERVICE','EMERGENCY','forbidden-service','TEST','test')`,
          [randomUUID(), issuer],
        ),
        (error: unknown) => (error as { code?: string }).code === "23514",
      );
      await db.pool.query(
        `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
       VALUES($1,'tenant-a','A-1','alice','Alice','ACTIVE'),($2,'tenant-b','B-1','alice','Alice','ACTIVE')`,
        [userA, userB],
      );
      const membershipA = randomUUID();
      const membershipB = randomUUID();
      await db.pool.query(
        `INSERT INTO identity.tenant_memberships(id,tenant_id,identity_link_id,principal_type,local_user_id,granted_by,provenance)
       VALUES($1,'tenant-a',$3,'HUMAN',$4,'operator','TEST'),($2,'tenant-b',$3,'HUMAN',$5,'operator','TEST')`,
        [membershipA, membershipB, linkId, userA, userB],
      );
      const resolved = await db.pool.query<{
        tenant_id: string;
        local_user_id: string;
      }>(
        `SELECT tenant_id,local_user_id FROM identity.tenant_memberships
       WHERE identity_link_id=$1 AND status='ACTIVE' ORDER BY tenant_id`,
        [linkId],
      );
      assert.deepEqual(resolved.rows, [
        { tenant_id: "tenant-a", local_user_id: userA },
        { tenant_id: "tenant-b", local_user_id: userB },
      ]);
      await db.pool.query(
        `INSERT INTO identity.external_identities(id,tenant_id,user_id,provider_id,provider_type,external_subject)
       VALUES($1,'tenant-a',$2,'legacy-provider','OIDC',$3)`,
        [randomUUID(), userA, `legacy-${randomUUID()}`],
      );
      const noGuessedLink = await db.pool.query(
        `SELECT id FROM identity.identity_links WHERE issuer='legacy-provider'`,
      );
      assert.equal(noGuessedLink.rowCount, 0);
      await db.pool.query(
        `UPDATE identity.tenant_memberships SET status='REVOKED',revoked_at=now(),revoked_by='operator',version=version+1
       WHERE id=$1 AND tenant_id='tenant-a'`,
        [membershipA],
      );
      const stillActive = await db.pool.query(
        `SELECT id FROM identity.tenant_memberships WHERE identity_link_id=$1 AND tenant_id='tenant-a' AND status='ACTIVE'`,
        [linkId],
      );
      const otherTenant = await db.pool.query(
        `SELECT local_user_id FROM identity.tenant_memberships WHERE identity_link_id=$1 AND tenant_id='tenant-b' AND status='ACTIVE'`,
        [linkId],
      );
      assert.equal(stillActive.rowCount, 0);
      assert.equal(otherTenant.rows[0]?.local_user_id, userB);
      await assert.rejects(
        db.pool.query(
          `INSERT INTO identity.tenant_memberships(id,tenant_id,identity_link_id,principal_type,system_principal_type,system_principal_id,granted_by,provenance)
         VALUES($1,'tenant-c',$2,'SERVICE','SYSTEM_AUTOMATION',$3,'operator','TEST')`,
          [randomUUID(), linkId, randomUUID()],
        ),
        (error: unknown) => (error as { code?: string }).code === "23503",
      );
    } finally {
      await db.close();
    }
  },
);

test(
  "RELEASE-001 trusted bootstrap atomically creates the first OIDC admin binding, audits it, and refuses replay",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await testDatabase();
    const tenant = `bootstrap-${randomUUID()}`;
    const userId = randomUUID();
    const roleId = randomUUID();
    const permissionId = randomUUID();
    const subject = `bootstrap-sub-${randomUUID()}`;
    try {
      await db.pool.query(
        `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
         VALUES($1,$2,'BOOTSTRAP-USER','bootstrap-user','Bootstrap User','ACTIVE')`,
        [userId, tenant],
      );
      await db.pool.query(
        `INSERT INTO identity.permissions(id,code,resource_type,action)
         VALUES($1,'rbac.manage','rbac','manage') ON CONFLICT(code) DO NOTHING`,
        [permissionId],
      );
      const permission = await db.pool.query<{ id: string }>(
        "SELECT id FROM identity.permissions WHERE code='rbac.manage'",
      );
      await db.pool.query(
        `INSERT INTO identity.roles(id,tenant_id,code,name,type,status)
         VALUES($1,$2,'INITIAL_ADMIN','Initial Administrator','LOCAL','ACTIVE')`,
        [roleId, tenant],
      );
      await db.pool.query(
        "INSERT INTO identity.role_permissions(tenant_id,role_id,permission_id) VALUES($1,$2,$3)",
        [tenant, roleId, permission.rows[0]!.id],
      );
      const bootstrapInput = {
        uow: db.uow,
        issuer: "https://issuer.example/",
        subject,
        tenantId: tenant,
        localUserId: userId,
        adminRoleId: roleId,
        operatorId: "release001-control-plane",
        reason:
          "First administrator provisioned by trusted deployment operator",
      };
      const attempts = await Promise.allSettled([
        bootstrapInitialAdministrator(bootstrapInput),
        bootstrapInitialAdministrator(bootstrapInput),
      ]);
      assert.equal(
        attempts.filter((attempt) => attempt.status === "fulfilled").length,
        1,
      );
      assert.equal(
        attempts.filter((attempt) => attempt.status === "rejected").length,
        1,
      );
      const successful = attempts.find(
        (attempt) => attempt.status === "fulfilled",
      );
      assert.ok(successful && successful.status === "fulfilled");
      const result = successful.value;
      const state = await db.pool.query(
        `SELECT il.principal_type,il.subject,tm.status,tm.local_user_id,rb.scope_type,rb.scope_id
         FROM identity.identity_links il
         JOIN identity.tenant_memberships tm ON tm.identity_link_id=il.id
         JOIN identity.role_bindings rb ON rb.tenant_id=tm.tenant_id AND rb.principal_id=tm.local_user_id
         WHERE il.id=$1 AND tm.id=$2`,
        [result.identityLinkId, result.membershipId],
      );
      assert.equal(state.rowCount, 1);
      assert.deepEqual(state.rows[0], {
        principal_type: "HUMAN",
        subject,
        status: "ACTIVE",
        local_user_id: userId,
        scope_type: "TENANT",
        scope_id: tenant,
      });
      const audit = await db.pool.query(
        `SELECT id FROM audit.audit_events WHERE tenant_id=$1 AND event_type='IDENTITY.INITIAL_ADMIN_BOOTSTRAPPED'`,
        [tenant],
      );
      assert.equal(audit.rowCount, 1);
      await assert.rejects(
        bootstrapInitialAdministrator({
          uow: db.uow,
          issuer: "https://issuer.example/",
          subject: `different-${subject}`,
          tenantId: tenant,
          localUserId: userId,
          adminRoleId: roleId,
          operatorId: "release001-control-plane",
          reason: "Unauthorized replay attempt",
        }),
        { code: "PERMISSION_DENIED" },
      );
      const passwordColumns = await db.pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='identity' AND table_name='users' AND column_name ILIKE '%password%'`,
      );
      assert.equal(passwordColumns.rowCount, 0);
    } finally {
      await db.close();
    }
  },
);

test(
  "RELEASE-001 validates OIDC before resolving X-Tenant-ID to the selected membership and tenant-local principal",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = await testDatabase();
    const issuer = "https://issuer.example/";
    const audience = "itcenter-api";
    const keyPair = await generateKeyPair("RS256");
    const rotatedKeyPair = await generateKeyPair("RS256");
    const signingJwk = await exportJWK(keyPair.publicKey);
    const rotatedJwk = await exportJWK(rotatedKeyPair.publicKey);
    signingJwk.kid = "integration-key";
    signingJwk.use = "sig";
    signingJwk.alg = "RS256";
    rotatedJwk.kid = "rotated-key";
    rotatedJwk.use = "sig";
    rotatedJwk.alg = "RS256";
    let trustedKeys = [signingJwk];
    const fetcher: typeof fetch = async (url) => {
      const requested = String(url);
      if (requested.endsWith("/.well-known/openid-configuration"))
        return new Response(
          JSON.stringify({ issuer, jwks_uri: "https://issuer.example/jwks" }),
          { status: 200 },
        );
      if (requested === "https://issuer.example/jwks")
        return new Response(JSON.stringify({ keys: trustedKeys }), {
          status: 200,
        });
      return new Response("not found", { status: 404 });
    };
    const adapter = await OidcApiAuthentication.create({
      pool: db.pool,
      uow: db.uow,
      issuer,
      audience,
      fetcher,
    });
    const humanLinkId = randomUUID();
    const serviceLinkId = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const servicePrincipalId = randomUUID();
    try {
      await db.pool.query(
        `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
         VALUES($1,'tenant-a','A-2','same-login','User A','ACTIVE'),($2,'tenant-b','B-2','same-login','User B','ACTIVE')`,
        [userA, userB],
      );
      await db.pool.query(
        `INSERT INTO identity.identity_links(id,issuer,principal_type,subject,provenance,created_by)
         VALUES($1,$2,'HUMAN','human-oidc','TEST','test')`,
        [humanLinkId, issuer],
      );
      await db.pool.query(
        `INSERT INTO identity.tenant_memberships(id,tenant_id,identity_link_id,principal_type,local_user_id,granted_by,provenance)
         VALUES($1,'tenant-a',$3,'HUMAN',$4,'test','TEST'),($2,'tenant-b',$3,'HUMAN',$5,'test','TEST')`,
        [randomUUID(), randomUUID(), humanLinkId, userA, userB],
      );
      await db.pool.query(
        `INSERT INTO identity.recommendation_principals(id,tenant_id,service_identity)
         VALUES($1,'tenant-b','recommendation')`,
        [servicePrincipalId],
      );
      await db.pool.query(
        `INSERT INTO identity.identity_links(id,issuer,principal_type,client_id,provenance,created_by)
         VALUES($1,$2,'SERVICE','recommendation-client','TEST','test')`,
        [serviceLinkId, issuer],
      );
      await db.pool.query(
        `INSERT INTO identity.tenant_memberships(id,tenant_id,identity_link_id,principal_type,system_principal_type,system_principal_id,granted_by,provenance)
         VALUES($1,'tenant-b',$2,'SERVICE','SYSTEM_RECOMMENDATION',$3,'test','TEST')`,
        [randomUUID(), serviceLinkId, servicePrincipalId],
      );

      const issue = (
        sub: string,
        clientId = "web-client",
        extra: Record<string, unknown> = {},
        kid = "integration-key",
        signingKey = keyPair.privateKey,
      ) =>
        new SignJWT({ client_id: clientId, jti: randomUUID(), ...extra })
          .setProtectedHeader({
            alg: "RS256",
            kid,
            typ: "at+jwt",
          })
          .setIssuer(issuer)
          .setAudience(audience)
          .setSubject(sub)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(signingKey);
      const token = await issue("human-oidc", "web-client", {
        tenant_id: "tenant-a",
        groups: ["admin"],
      });
      const inA = await adapter.authenticate(token, { values: ["tenant-a"] });
      const inB = await adapter.authenticate(token, { values: ["tenant-b"] });
      assert.equal(inA.id, userA);
      assert.equal(inA.tenant_id, "tenant-a");
      assert.equal(inB.id, userB);
      assert.equal(inB.tenant_id, "tenant-b");
      assert.equal(inB.actor_type, "USER");
      trustedKeys = [signingJwk, rotatedJwk];
      const realNow = Date.now;
      Date.now = () => realNow() + 31000;
      try {
        const rotatedToken = await issue(
          "human-oidc",
          "web-client",
          {},
          "rotated-key",
          rotatedKeyPair.privateKey,
        );
        assert.equal(
          (await adapter.authenticate(rotatedToken, { values: ["tenant-a"] }))
            .id,
          userA,
        );
      } finally {
        Date.now = realNow;
      }
      const operationPermission = randomUUID();
      const roleId = randomUUID();
      const bindingId = randomUUID();
      await db.pool.query(
        `INSERT INTO identity.permissions(id,code,resource_type,action)
         VALUES($1,'release001.test.operation.read','operation','read') ON CONFLICT(code) DO NOTHING`,
        [operationPermission],
      );
      const permission = await db.pool.query<{ id: string }>(
        "SELECT id FROM identity.permissions WHERE code='release001.test.operation.read'",
      );
      await db.pool.query(
        `INSERT INTO identity.roles(id,tenant_id,code,name,type,status)
         VALUES($1,'tenant-a','release001-test','Release Test','LOCAL','ACTIVE')`,
        [roleId],
      );
      await db.pool.query(
        "INSERT INTO identity.role_permissions(tenant_id,role_id,permission_id) VALUES('tenant-a',$1,$2)",
        [roleId, permission.rows[0]!.id],
      );
      await db.pool.query(
        `INSERT INTO identity.role_bindings(id,tenant_id,principal_type,principal_id,role_id,scope_type,scope_id,source,valid_from,reason,created_by)
         VALUES($1,'tenant-a','USER',$2,$3,'TENANT','tenant-a','TEST',to_timestamp(0),'test',$2)`,
        [bindingId, userA, roleId],
      );
      const evidence = await db.pool.query(
        `SELECT rb.principal_id,rb.principal_type,rb.scope_type,rb.scope_id,rb.revoked_at,
                u.employment_status,r.status AS role_status,p.code
         FROM identity.role_bindings rb JOIN identity.users u ON u.tenant_id=rb.tenant_id AND u.id=rb.principal_id
         JOIN identity.roles r ON r.tenant_id=rb.tenant_id AND r.id=rb.role_id
         JOIN identity.role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
         JOIN identity.permissions p ON p.id=rp.permission_id WHERE rb.id=$1`,
        [bindingId],
      );
      assert.equal(evidence.rowCount, 1, JSON.stringify(evidence.rows));
      assert.equal(
        evidence.rows[0]!.code,
        "release001.test.operation.read",
        JSON.stringify(evidence.rows),
      );
      const authz = postgresAuthorization(db.uow);
      const authzRequest = {
        principal: inA,
        action: "release001.test.operation.read",
        resource: {
          type: "operation",
          id: "test-resource",
          tenant_id: "tenant-a",
        },
        scope: {},
        context: {},
      };
      const candidates = await db.pool.query(
        `SELECT p.code,rb.scope_type,rb.scope_id,u.employment_status,r.status AS role_status
         FROM identity.role_bindings rb JOIN identity.roles r ON r.id=rb.role_id AND r.tenant_id=rb.tenant_id
         JOIN identity.role_permissions rp ON rp.role_id=r.id AND rp.tenant_id=r.tenant_id
         JOIN identity.permissions p ON p.id=rp.permission_id
         JOIN identity.users u ON u.tenant_id=rb.tenant_id AND u.id=rb.principal_id
         WHERE rb.tenant_id=$1 AND rb.principal_type='USER' AND rb.principal_id=$2 AND rb.revoked_at IS NULL
           AND u.employment_status='ACTIVE' AND u.archived_at IS NULL AND p.code=$3 AND rb.valid_from<=$4`,
        ["tenant-a", userA, "release001.test.operation.read", new Date()],
      );
      assert.equal(candidates.rowCount, 1, JSON.stringify(candidates.rows));
      const granted = await authz.evaluate(authzRequest);
      assert.equal(granted.result, "ALLOW", granted.reason);
      await db.pool.query(
        "UPDATE identity.role_bindings SET revoked_at=now() WHERE id=$1",
        [bindingId],
      );
      assert.equal((await authz.evaluate(authzRequest)).result, "DENY");

      const managementRoleId = randomUUID();
      const managementBindingId = randomUUID();
      const provisionedUserId = randomUUID();
      await db.pool.query(
        `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
         VALUES($1,'tenant-a','A-3','provisioned','Provisioned User','ACTIVE')`,
        [provisionedUserId],
      );
      await db.pool.query(
        `INSERT INTO identity.roles(id,tenant_id,code,name,type,status)
         VALUES($1,'tenant-a','release001-identity-admin','Identity Admin','LOCAL','ACTIVE')`,
        [managementRoleId],
      );
      const managementPermissions = await db.pool.query<{ id: string }>(
        `SELECT id FROM identity.permissions
         WHERE code IN ('identity.external_identity.manage','identity.tenant_membership.manage','identity.emergency_identity.manage')`,
      );
      assert.equal(managementPermissions.rowCount, 3);
      for (const permission of managementPermissions.rows)
        await db.pool.query(
          "INSERT INTO identity.role_permissions(tenant_id,role_id,permission_id) VALUES('tenant-a',$1,$2)",
          [managementRoleId, permission.id],
        );
      await db.pool.query(
        `INSERT INTO identity.role_bindings(id,tenant_id,principal_type,principal_id,role_id,scope_type,scope_id,source,valid_from,reason,created_by)
         VALUES($1,'tenant-a','USER',$2,$3,'TENANT','tenant-a','TEST',to_timestamp(0),'test',$2)`,
        [managementBindingId, userA, managementRoleId],
      );
      const api = apiServer(
        loadConfig({
          APP_ENV: "test",
          DATABASE_SECRET_REF: "env:TEST_DATABASE_URL",
          AUTH_MODE: "oidc",
          OIDC_ISSUER: issuer,
          OIDC_AUDIENCE: audience,
        }),
        async () => true,
        adapter,
        postgresAuthorization(db.uow),
        db.uow,
      );
      await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
      const apiAddress = api.address() as AddressInfo;
      const apiBase = `http://127.0.0.1:${apiAddress.port}`;
      try {
        const createLinkRequest = {
          issuer,
          principal_type: "HUMAN",
          subject: "provisioned-user-subject",
          reason: "Operator confirmed the identity mapping",
        };
        const send = (path: string, payload: unknown, idempotencyKey: string) =>
          fetch(`${apiBase}${path}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "X-Tenant-ID": "tenant-a",
              "Idempotency-Key": idempotencyKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
        const firstLink = await send(
          "/api/v1/identity/links",
          createLinkRequest,
          "link-once",
        );
        assert.equal(firstLink.status, 201);
        const firstLinkBody = (await firstLink.json()) as {
          identity_link_id: string;
        };
        const retriedLink = await send(
          "/api/v1/identity/links",
          createLinkRequest,
          "link-once",
        );
        assert.equal(retriedLink.status, 201);
        assert.deepEqual(await retriedLink.json(), firstLinkBody);

        const emergencyLink = await send(
          "/api/v1/identity/links",
          {
            issuer,
            principal_type: "HUMAN",
            subject: "emergency-user-subject",
            emergency_identity: true,
            reason: "Pre-provisioned emergency OIDC identity",
          },
          "emergency-link-once",
        );
        assert.equal(emergencyLink.status, 201);
        const emergencyLinkBody = (await emergencyLink.json()) as {
          identity_link_id: string;
        };
        const emergencyClass = await db.pool.query<{ identity_class: string }>(
          "SELECT identity_class FROM identity.identity_links WHERE id=$1",
          [emergencyLinkBody.identity_link_id],
        );
        assert.equal(emergencyClass.rows[0]?.identity_class, "EMERGENCY");
        const emergencyGrant = await send(
          "/api/v1/identity/tenant-memberships",
          {
            identity_link_id: emergencyLinkBody.identity_link_id,
            principal_type: "HUMAN",
            local_user_id: provisionedUserId,
            reason: "Emergency access is explicitly pre-provisioned",
          },
          "emergency-membership-once",
        );
        assert.equal(emergencyGrant.status, 201);

        const grantRequest = {
          identity_link_id: firstLinkBody.identity_link_id,
          principal_type: "HUMAN",
          local_user_id: provisionedUserId,
          reason: "Provisioned into the second tenant-local account",
        };
        const grant = await send(
          "/api/v1/identity/tenant-memberships",
          grantRequest,
          "membership-once",
        );
        const grantText = await grant.text();
        assert.equal(grant.status, 201, grantText);
        const grantBody = JSON.parse(grantText) as {
          tenant_membership_id: string;
        };
        const retriedGrant = await send(
          "/api/v1/identity/tenant-memberships",
          grantRequest,
          "membership-once",
        );
        assert.equal(retriedGrant.status, 201);
        assert.deepEqual(await retriedGrant.json(), grantBody);
        const revokeRequest = {
          expected_version: 1,
          reason: "Access provision is no longer needed",
        };
        const revoke = await send(
          `/api/v1/identity/tenant-memberships/${grantBody.tenant_membership_id}/revoke`,
          revokeRequest,
          "membership-revoke-once",
        );
        assert.equal(revoke.status, 200);
        assert.equal(
          ((await revoke.json()) as { status: string }).status,
          "REVOKED",
        );
        const unlink = await send(
          `/api/v1/identity/links/${firstLinkBody.identity_link_id}/revoke`,
          {
            expected_version: 1,
            reason: "Provisioned identity is no longer trusted",
          },
          "identity-unlink-once",
        );
        assert.equal(unlink.status, 200);
        assert.equal(
          ((await unlink.json()) as { status: string }).status,
          "REVOKED",
        );
        const blockedGlobalUnlink = await send(
          `/api/v1/identity/links/${humanLinkId}/revoke`,
          {
            expected_version: 1,
            reason: "Must not revoke another tenant's active identity",
          },
          "identity-unlink-cross-tenant",
        );
        assert.equal(blockedGlobalUnlink.status, 403);
        const effects = await db.pool.query<{ event_type: string }>(
          `SELECT event_type FROM audit.audit_events WHERE tenant_id='tenant-a'
           AND event_type IN ('IDENTITY.LINK_EXTERNAL','IDENTITY.GRANT_TENANT_MEMBERSHIP','IDENTITY.REVOKE_TENANT_MEMBERSHIP','IDENTITY.UNLINK_EXTERNAL')
           ORDER BY event_type`,
        );
        assert.deepEqual(
          effects.rows.map((row) => row.event_type),
          [
            "IDENTITY.GRANT_TENANT_MEMBERSHIP",
            "IDENTITY.GRANT_TENANT_MEMBERSHIP",
            "IDENTITY.LINK_EXTERNAL",
            "IDENTITY.REVOKE_TENANT_MEMBERSHIP",
            "IDENTITY.UNLINK_EXTERNAL",
          ],
        );
        const emergencyToken = await issue(
          "emergency-user-subject",
          "web-client",
          {
            amr: ["mfa"],
            tenant_id: "tenant-a",
          },
        );
        assert.equal(
          (
            await adapter.authenticate(emergencyToken, {
              values: ["tenant-a"],
              requestId: randomUUID(),
              correlationId: randomUUID(),
            })
          ).id,
          provisionedUserId,
        );
        await assert.rejects(
          adapter.authenticate(
            await issue("emergency-user-subject", "web-client"),
            { values: ["tenant-a"] },
          ),
          { code: "AUTHENTICATION_REQUIRED" },
        );
        const emergencyAudit = await db.pool.query(
          `SELECT id FROM audit.audit_events WHERE tenant_id='tenant-a'
           AND event_type='IDENTITY.EMERGENCY_IDENTITY_USED'`,
        );
        assert.equal(emergencyAudit.rowCount, 1);
      } finally {
        await new Promise<void>((resolve, reject) =>
          api.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await assert.rejects(adapter.authenticate(token, { values: [] }), {
        code: "TENANT_CONTEXT_REQUIRED",
      });
      await assert.rejects(adapter.authenticate("bad-token", { values: [] }), {
        code: "AUTHENTICATION_REQUIRED",
      });
      await assert.rejects(
        adapter.authenticate(await issue("unknown-sub"), {
          values: ["tenant-a"],
        }),
        { code: "IDENTITY_NOT_PROVISIONED" },
      );
      await assert.rejects(
        adapter.authenticate(token, { values: ["tenant-c"] }),
        {
          code: "TENANT_MEMBERSHIP_DENIED",
        },
      );

      const serviceToken = await issue(
        "recommendation-client",
        "recommendation-client",
      );
      const service = await adapter.authenticate(serviceToken, {
        values: ["tenant-b"],
      });
      assert.equal(service.id, servicePrincipalId);
      assert.equal(service.actor_type, "SYSTEM_RECOMMENDATION");
      await db.pool.query(
        `UPDATE identity.tenant_memberships SET status='REVOKED',revoked_at=now(),revoked_by='operator',version=version+1
         WHERE tenant_id='tenant-a' AND identity_link_id=$1 AND status='ACTIVE'`,
        [humanLinkId],
      );
      await assert.rejects(
        adapter.authenticate(token, { values: ["tenant-a"] }),
        {
          code: "TENANT_MEMBERSHIP_DENIED",
        },
      );
      assert.equal(
        (await adapter.authenticate(token, { values: ["tenant-b"] })).id,
        userB,
      );
      await db.pool.query(
        "UPDATE identity.users SET employment_status='SUSPENDED' WHERE tenant_id='tenant-b' AND id=$1",
        [userB],
      );
      await assert.rejects(
        adapter.authenticate(token, { values: ["tenant-b"] }),
        {
          code: "PERMISSION_DENIED",
        },
      );
    } finally {
      await db.close();
    }
  },
);
