import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { agentServer } from "../../apps/agent-gateway/src/server.js";
import type { AgentDeploymentAdapters } from "../../apps/agent-gateway/src/software-deployment-routes.js";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { resolveDeploymentAgentContext } from "../../modules/agent/index.js";
import { nextDeploymentCandidate } from "../../modules/software/index.js";
import { createLicenseEntitlement } from "../../modules/license/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const config = () =>
  loadConfig({
    DATABASE_SECRET_REF: "env:TEST",
    APP_ENV: "test",
    LOG_LEVEL: "error",
  });

test("software deployment is tenant-scoped, fail-closed, leased and verified", async () => {
  const db = await testDatabase();
  const tenantId = "tenant-deployment";
  const assetId = randomUUID();
  const agentId = randomUUID();
  const productId = randomUUID();
  const versionId = randomUUID();
  const artifactId = randomUUID();
  const checksum = "a".repeat(64);
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Laptop')",
    [randomUUID(), tenantId],
  );
  const category = await db.pool.query(
    "SELECT id FROM asset.categories WHERE tenant_id=$1",
    [tenantId],
  );
  const modelId = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Example','Laptop',$3)",
    [modelId, tenantId, category.rows[0]!.id],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id) VALUES($1,$2,'AST-DEPLOY-1',$3)",
    [assetId, tenantId, modelId],
  );
  await db.pool.query(
    `INSERT INTO software.software_products
       (id,tenant_id,product_code,name,vendor,category,classification,owner_id,
        support_team,supported_os,supported_asset_classes,visibility,
        license_required)
     VALUES($1,$2,'EDITOR-DEPLOY','Editor','Example Vendor','DEVELOPMENT',
            'APPROVED','team-it','service-desk',ARRAY['linux'],ARRAY['Laptop'],
            'IT_ONLY',true)`,
    [productId, tenantId],
  );
  await db.pool.query(
    `INSERT INTO software.software_versions
       (id,tenant_id,product_id,version_label,state)
     VALUES($1,$2,$3,'1.0.0','PUBLISHED')`,
    [versionId, tenantId, productId],
  );
  await db.pool.query(
    `INSERT INTO artifact.artifact_versions
       (id,tenant_id,software_version_id,filename,media_type,size_bytes,
        source_type,checksum_sha256,storage_ref,signature_status,scan_status,
        review_status,state,uploaded_by,reviewed_by)
     VALUES($1,$2,$3,'editor.pkg','application/octet-stream',1024,
            'VENDOR_OFFICIAL',$4,'artifact/editor-1.0.0','VALID','PASSED',
            'APPROVED','ACTIVE','uploader','reviewer')`,
    [artifactId, tenantId, versionId, checksum],
  );
  await db.pool.query(
    "UPDATE software.software_versions SET approved_artifact_version_id=$1 WHERE tenant_id=$2 AND id=$3",
    [artifactId, tenantId, versionId],
  );
  await db.pool.query(
    "UPDATE software.software_products SET published_version_id=$1 WHERE tenant_id=$2 AND id=$3",
    [versionId, tenantId, productId],
  );
  await db.pool.query(
    `INSERT INTO agent.agents(id,tenant_id,asset_id,agent_version,status,last_seen_at)
     VALUES($1,$2,$3,'test-agent','ONLINE',now())`,
    [agentId, tenantId, assetId],
  );
  await db.uow.run(tenantId, (tx) =>
    createLicenseEntitlement({
      tx,
      softwareProductId: productId,
      licenseType: "PER_DEVICE",
      quantity: 1,
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      renewalNoticeDays: 14,
      restrictions: [],
      actorId: "license-fixture",
      reason: "Create one device license for deployment test",
    }),
  );

  let actorType = "USER";
  let principalId = "deployment-operator";
  let tenant = tenantId;
  let allowed = true;
  const auth = {
    async authenticate() {
      return { id: principalId, tenant_id: tenant, actor_type: actorType };
    },
  };
  const authorization = {
    async evaluate() {
      return {
        result: allowed ? ("ALLOW" as const) : ("DENY" as const),
        reason: "test policy",
      };
    },
  };
  const api = apiServer(
    config(),
    async () => true,
    auth,
    authorization,
    db.uow,
  );
  const managerUrl = await listen(api);
  const post = (base: string, path: string, key: string, body: object) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
  const get = (base: string, path: string) =>
    fetch(base + path, { headers: { authorization: "Bearer test" } });
  const agentAuth = {
    async authenticate() {
      return { id: agentId, tenant_id: tenantId, actor_type: "AGENT" };
    },
  };
  const noDelivery = agentServer(config(), async () => true, agentAuth, db.uow);
  const noDeliveryUrl = await listen(noDelivery);
  const deliveryCalls: string[] = [];
  const adapters: AgentDeploymentAdapters = {
    artifactDelivery: {
      async issueDownloadGrant(input) {
        deliveryCalls.push(input.storageRef);
        return {
          url: "https://artifacts.example.test/signed/editor.pkg",
          expiresAt: input.expiresAt,
        };
      },
    },
  };
  const gateway = agentServer(
    config(),
    async () => true,
    agentAuth,
    db.uow,
    adapters,
  );
  const gatewayUrl = await listen(gateway);
  try {
    const createdResponse = await post(
      managerUrl,
      "/api/v1/software/deployment-campaigns",
      "campaign-create",
      {
        software_version_id: versionId,
        asset_ids: [assetId],
        initial_stage_percent: 100,
        failure_threshold_percent: 50,
        max_attempts: 2,
        stop_on_security_failure: true,
        reason: "Deploy approved editor release",
      },
    );
    assert.equal(
      createdResponse.status,
      201,
      await createdResponse.clone().text(),
    );
    const campaign = (
      (await createdResponse.json()) as {
        data: { id: string; version: number };
      }
    ).data;
    tenant = "other-tenant";
    const tenantRead = await get(
      managerUrl,
      `/api/v1/software/deployment-campaigns/${campaign.id}`,
    );
    assert.equal(tenantRead.status, 404);
    tenant = tenantId;
    allowed = false;
    const denied = await post(
      managerUrl,
      `/api/v1/software/deployment-campaigns/${campaign.id}/commands/start`,
      "start-denied",
      { expected_version: 1, reason: "Start rollout" },
    );
    assert.equal(denied.status, 403);
    allowed = true;
    const started = await post(
      managerUrl,
      `/api/v1/software/deployment-campaigns/${campaign.id}/commands/start`,
      "campaign-start",
      { expected_version: 1, reason: "Start rollout" },
    );
    assert.equal(started.status, 200, await started.clone().text());
    const targetsResponse = await get(
      managerUrl,
      `/api/v1/software/deployment-campaigns/${campaign.id}/targets`,
    );
    const target = (
      (await targetsResponse.json()) as {
        data: Array<{ id: string; state: string; version: number }>;
      }
    ).data[0]!;
    assert.equal(target.state, "QUEUED");

    const unavailable = await post(
      noDeliveryUrl,
      "/api/v1/agent/deployments/claim",
      "claim-without-delivery",
      {},
    );
    assert.equal(unavailable.status, 503);
    const untouched = await db.pool.query(
      "SELECT state,attempt_count FROM software.deployment_targets WHERE tenant_id=$1 AND id=$2",
      [tenantId, target.id],
    );
    assert.deepEqual(untouched.rows[0], { state: "QUEUED", attempt_count: 0 });

    actorType = "AGENT";
    principalId = agentId;
    const candidate = await db.uow.run(tenantId, async (tx) => {
      const agent = await resolveDeploymentAgentContext({ tx, agentId });
      return nextDeploymentCandidate(tx, { assetId: agent.asset_id });
    });
    assert.ok(candidate);
    const claim = await post(
      gatewayUrl,
      "/api/v1/agent/deployments/claim",
      "agent-claim",
      {},
    );
    assert.equal(claim.status, 200, await claim.clone().text());
    const job = (
      (await claim.json()) as {
        data: {
          target_id: string;
          lease_id: string;
          download_url: string;
          download_expires_at: string;
        };
      }
    ).data;
    assert.equal(job.target_id, target.id);
    assert.match(job.download_url, /^https:\/\//);
    assert.ok(Date.parse(job.download_expires_at) <= Date.now() + 120_000);
    assert.deepEqual(deliveryCalls, ["artifact/editor-1.0.0"]);
    const claimReplay = await post(
      gatewayUrl,
      "/api/v1/agent/deployments/claim",
      "agent-claim",
      {},
    );
    assert.equal(claimReplay.status, 200);
    const replayJob = (
      (await claimReplay.json()) as { data: { lease_id: string } }
    ).data;
    assert.equal(replayJob.lease_id, job.lease_id);

    const reportBody = {
      lease_id: job.lease_id,
      outcome: "POSTCHECK_VERIFIED",
      precheck_passed: true,
      checksum_verified: true,
      signature_verified: true,
      installer_exit_code: 0,
      observed_product_code: "EDITOR-DEPLOY",
      observed_version: "1.0.0",
      summary: "Install done token=SHOULD_NOT_PERSIST",
    };
    const reported = await post(
      gatewayUrl,
      `/api/v1/agent/deployments/${target.id}/commands/report`,
      "agent-report",
      reportBody,
    );
    assert.equal(reported.status, 200, await reported.clone().text());
    const reportResult = (
      (await reported.json()) as {
        data: { state: string; installation_id: string };
      }
    ).data;
    assert.equal(reportResult.state, "SUCCESS");
    const licenseAssignment = await db.pool.query(
      `SELECT a.state,a.principal_type,a.principal_id,r.state AS reservation_state
         FROM license.assignments a
         JOIN license.deployment_reservations r
           ON r.tenant_id=a.tenant_id AND r.id=a.reservation_id
        WHERE a.tenant_id=$1 AND r.deployment_target_id=$2`,
      [tenantId, target.id],
    );
    assert.deepEqual(licenseAssignment.rows[0], {
      state: "ACTIVE",
      principal_type: "ASSET",
      principal_id: assetId,
      reservation_state: "ASSIGNED",
    });
    const reportReplay = await post(
      gatewayUrl,
      `/api/v1/agent/deployments/${target.id}/commands/report`,
      "agent-report",
      reportBody,
    );
    assert.equal(reportReplay.status, 200);
    assert.equal(
      (
        (await reportReplay.json()) as {
          data: { installation_id: string };
        }
      ).data.installation_id,
      reportResult.installation_id,
    );

    const installation = await db.pool.query(
      "SELECT state,artifact_checksum_sha256 FROM software.software_installations WHERE tenant_id=$1 AND asset_id=$2 AND product_id=$3",
      [tenantId, assetId, productId],
    );
    assert.deepEqual(installation.rows[0], {
      state: "INSTALLED",
      artifact_checksum_sha256: checksum,
    });
    const attempt = await db.pool.query(
      "SELECT outcome,summary FROM software.deployment_attempts WHERE tenant_id=$1 AND target_id=$2",
      [tenantId, target.id],
    );
    assert.equal(attempt.rows.length, 1);
    assert.equal(attempt.rows[0]!.outcome, "SUCCESS");
    assert.match(attempt.rows[0]!.summary, /token=\[REDACTED\]/i);
    assert.doesNotMatch(attempt.rows[0]!.summary, /SHOULD_NOT_PERSIST/);
    await assert.rejects(
      db.pool.query(
        "UPDATE software.deployment_attempts SET summary='mutated' WHERE tenant_id=$1 AND target_id=$2",
        [tenantId, target.id],
      ),
      /append-only/,
    );
    const campaignAfter = await db.pool.query(
      "SELECT state FROM software.deployments WHERE tenant_id=$1 AND id=$2",
      [tenantId, campaign.id],
    );
    assert.equal(campaignAfter.rows[0]!.state, "COMPLETED");
    const effects = await db.pool.query(
      `SELECT count(*) FILTER (WHERE event_type='SOFTWARE.INSTALLATION_VERIFIED')::int AS verified,
              count(*) FILTER (WHERE event_type='SOFTWARE.DEPLOYMENT_CAMPAIGN_COMPLETED')::int AS completed
         FROM platform.outbox_events WHERE tenant_id=$1`,
      [tenantId],
    );
    assert.deepEqual(effects.rows[0], { verified: 1, completed: 1 });
    const audits = await db.pool.query(
      "SELECT count(*)::int AS count FROM audit.audit_events WHERE tenant_id=$1 AND event_type='SOFTWARE.INSTALLATION_VERIFIED'",
      [tenantId],
    );
    assert.equal(audits.rows[0]!.count, 1);

    actorType = "USER";
    principalId = "deployment-operator";
    const secondCreated = await post(
      managerUrl,
      "/api/v1/software/deployment-campaigns",
      "security-campaign-create",
      {
        software_version_id: versionId,
        asset_ids: [assetId],
        initial_stage_percent: 100,
        failure_threshold_percent: 50,
        max_attempts: 2,
        stop_on_security_failure: true,
        reason: "Verify security stop behavior",
      },
    );
    assert.equal(secondCreated.status, 201);
    const secondCampaign = (
      (await secondCreated.json()) as { data: { id: string } }
    ).data;
    const secondStarted = await post(
      managerUrl,
      `/api/v1/software/deployment-campaigns/${secondCampaign.id}/commands/start`,
      "security-campaign-start",
      { expected_version: 1, reason: "Start security test rollout" },
    );
    assert.equal(secondStarted.status, 200);
    const secondTargets = await get(
      managerUrl,
      `/api/v1/software/deployment-campaigns/${secondCampaign.id}/targets`,
    );
    const secondTarget = (
      (await secondTargets.json()) as {
        data: Array<{ id: string }>;
      }
    ).data[0]!;
    actorType = "AGENT";
    principalId = agentId;
    const secondClaim = await post(
      gatewayUrl,
      "/api/v1/agent/deployments/claim",
      "security-agent-claim",
      {},
    );
    assert.equal(secondClaim.status, 200);
    const securityJob = (
      (await secondClaim.json()) as { data: { lease_id: string } }
    ).data;
    const rejected = await post(
      gatewayUrl,
      `/api/v1/agent/deployments/${secondTarget.id}/commands/report`,
      "security-agent-report",
      {
        lease_id: securityJob.lease_id,
        outcome: "ARTIFACT_REJECTED",
        precheck_passed: true,
        checksum_verified: false,
        signature_verified: false,
        error_code: "SIGNATURE_INVALID",
        summary: "Publisher signature did not verify",
      },
    );
    assert.equal(rejected.status, 200, await rejected.clone().text());
    const stoppedCampaign = await db.pool.query(
      "SELECT state FROM software.deployments WHERE tenant_id=$1 AND id=$2",
      [tenantId, secondCampaign.id],
    );
    assert.equal(stoppedCampaign.rows[0]!.state, "STOPPED");
    const stoppedTarget = await db.pool.query(
      "SELECT state,security_failure,version FROM software.deployment_targets WHERE tenant_id=$1 AND id=$2",
      [tenantId, secondTarget.id],
    );
    assert.deepEqual(stoppedTarget.rows[0], {
      state: "FAILED",
      security_failure: true,
      version: 4,
    });
    actorType = "USER";
    principalId = "deployment-operator";
    const retryDenied = await post(
      managerUrl,
      `/api/v1/software/deployment-targets/${secondTarget.id}/commands/retry`,
      "security-retry-denied",
      { expected_version: 4, reason: "Retry rejected artifact" },
    );
    assert.equal(retryDenied.status, 422);
  } finally {
    for (const server of [api, noDelivery, gateway])
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await db.close();
  }
});
