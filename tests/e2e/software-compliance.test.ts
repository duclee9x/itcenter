import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { agentServer } from "../../apps/agent-gateway/src/server.js";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
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

async function fixture(tenantId: string, category = "Laptop") {
  const db = await testDatabase();
  const categoryId = randomUUID();
  const modelId = randomUUID();
  const assetId = randomUUID();
  const agentId = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,$3)",
    [categoryId, tenantId, category],
  );
  await db.pool.query(
    `INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id)
     VALUES($1,$2,'Example','Compliance Endpoint',$3)`,
    [modelId, tenantId, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id) VALUES($1,$2,$3,$4)",
    [assetId, tenantId, `AST-${randomUUID().slice(0, 8)}`, modelId],
  );
  await db.pool.query(
    `INSERT INTO agent.agents(id,tenant_id,asset_id,agent_version,status,last_seen_at)
     VALUES($1,$2,$3,'test-agent','ONLINE',now())`,
    [agentId, tenantId, assetId],
  );
  const approvalPolicyId = randomUUID();
  await db.pool.query(
    `INSERT INTO control.approval_policies(id,tenant_id,code,version,state)
     VALUES($1,$2,'SOFTWARE_COMPLIANCE',1,'ACTIVE')`,
    [approvalPolicyId, tenantId],
  );
  let principalId: string = randomUUID();
  let principalTenant = tenantId;
  let actorType = "USER";
  let allowed = true;
  let currentAgentId: string = agentId;
  const authentication = {
    async authenticate() {
      return {
        id: principalId,
        tenant_id: principalTenant,
        actor_type: actorType,
      };
    },
  };
  const authorization = {
    async evaluate() {
      return {
        result: allowed ? ("ALLOW" as const) : ("DENY" as const),
        reason: "software compliance test policy",
      };
    },
  };
  const api = apiServer(
    config(),
    async () => true,
    authentication,
    authorization,
    db.uow,
  );
  const gateway = agentServer(
    config(),
    async () => true,
    {
      async authenticate() {
        return {
          id: currentAgentId,
          tenant_id: tenantId,
          actor_type: "AGENT",
        };
      },
    },
    db.uow,
  );
  const apiUrl = await listen(api);
  const agentUrl = await listen(gateway);
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
  const sendInventory = (
    key: string,
    inventory: object[],
    inventoryComplete = true,
    observedAt = new Date().toISOString(),
  ) =>
    post(agentUrl, "/api/v1/agent/inventory", key, {
      dataset: "software",
      inventory,
      inventory_complete: inventoryComplete,
      observed_at: observedAt,
    });
  const setActor = (id: string, type = "USER") => {
    principalId = id;
    actorType = type;
  };
  const close = async () => {
    api.closeAllConnections();
    gateway.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => api.close(() => resolve())),
      new Promise<void>((resolve) => gateway.close(() => resolve())),
    ]);
    await db.close();
  };
  return {
    db,
    tenantId,
    assetId,
    agentId,
    approvalPolicyId,
    get apiUrl() {
      return apiUrl;
    },
    get agentUrl() {
      return agentUrl;
    },
    post,
    get,
    sendInventory,
    setActor,
    setAllowed(value: boolean) {
      allowed = value;
    },
    setTenant(value: string) {
      principalTenant = value;
    },
    setAgent(value: string) {
      currentAgentId = value;
    },
    close,
  };
}

async function createProduct(
  fx: Awaited<ReturnType<typeof fixture>>,
  input: {
    name: string;
    code: string;
    classification: string;
    vendor?: string;
  },
) {
  const id = randomUUID();
  await fx.db.pool.query(
    `INSERT INTO software.software_products
       (id,tenant_id,product_code,name,vendor,category,classification,owner_id,
        support_team,visibility)
     VALUES($1,$2,$3,$4,$5,'UTILITY',$6,'software-owner','SOFTWARE_SECURITY','IT_ONLY')`,
    [
      id,
      fx.tenantId,
      input.code,
      input.name,
      input.vendor ?? "Example Vendor",
      input.classification,
    ],
  );
  return id;
}

async function data<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

test("software inventory is normalized, idempotent, tenant-bound and detects only actionable installations", async () => {
  const fx = await fixture("tenant-software-inventory");
  try {
    const productId = await createProduct(fx, {
      name: "Example Browser",
      code: "EXAMPLE-BROWSER",
      classification: "PROHIBITED",
    });
    const alias = await fx.post(
      fx.apiUrl,
      `/api/v1/software/products/${productId}/aliases`,
      "browser-alias",
      { alias: "Example Browser x64", reason: "Verified vendor package alias" },
    );
    assert.equal(alias.status, 201, await alias.clone().text());
    const observedAt = new Date().toISOString();
    const inventory = [
      {
        name: "Example Browser x64",
        publisher: "Example Vendor",
        version: "5.2.1",
        package_identifier: "com.example.browser",
        install_scope: "DEVICE",
      },
    ];
    const first = await fx.sendInventory(
      "inventory-first",
      inventory,
      true,
      observedAt,
    );
    assert.equal(first.status, 200, await first.clone().text());
    const report = await data<{ id: string }>(first.clone());
    const duplicate = await fx.sendInventory(
      "inventory-first",
      inventory,
      true,
      observedAt,
    );
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await data(duplicate), report);
    const changedRetry = await fx.sendInventory(
      "inventory-first",
      [{ ...inventory[0]!, version: "6.0" }],
      true,
      observedAt,
    );
    assert.equal(changedRetry.status, 409);

    const installs = await fx.db.pool.query(
      "SELECT id,product_id,classification,state FROM software.inventory_installations WHERE tenant_id=$1",
      [fx.tenantId],
    );
    assert.equal(installs.rowCount, 1);
    assert.equal(installs.rows[0]!.product_id, productId);
    assert.equal(installs.rows[0]!.classification, "PROHIBITED");
    const exceptions = await fx.db.pool.query(
      "SELECT id,state FROM software.software_exceptions WHERE tenant_id=$1",
      [fx.tenantId],
    );
    assert.equal(exceptions.rowCount, 1);
    assert.equal(exceptions.rows[0]!.state, "OPEN");
    const workItems = await fx.db.pool.query(
      "SELECT id,state FROM operations.work_items WHERE tenant_id=$1 AND source_type='SOFTWARE_EXCEPTION'",
      [fx.tenantId],
    );
    assert.equal(workItems.rowCount, 1);
    const reports = await fx.db.pool.query(
      "SELECT count(*)::int AS count FROM software.inventory_reports WHERE tenant_id=$1",
      [fx.tenantId],
    );
    assert.equal(reports.rows[0]!.count, 1);
    const event = await fx.db.pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='SOFTWARE.UNAUTHORIZED_DETECTED'",
      [fx.tenantId],
    );
    assert.equal(event.rows[0]!.count, 1);
    const detectedPayload = await fx.db.pool.query(
      `SELECT payload->'payload' AS payload FROM platform.outbox_events
        WHERE tenant_id=$1 AND event_type='SOFTWARE.UNAUTHORIZED_DETECTED'`,
      [fx.tenantId],
    );
    assert.equal(
      detectedPayload.rows[0]!.payload.software_exception_id,
      exceptions.rows[0]!.id,
    );

    const partial = await fx.sendInventory(
      "inventory-partial",
      [],
      false,
      new Date(Date.parse(observedAt) + 1000).toISOString(),
    );
    assert.equal(partial.status, 200, await partial.clone().text());
    const stillPresent = await fx.db.pool.query(
      "SELECT state FROM software.inventory_installations WHERE tenant_id=$1 AND product_id=$2",
      [fx.tenantId, productId],
    );
    assert.equal(stillPresent.rows[0]!.state, "PRESENT");
    const stale = await fx.sendInventory(
      "inventory-stale",
      inventory,
      true,
      new Date(Date.parse(observedAt) - 1000).toISOString(),
    );
    assert.equal(stale.status, 409);

    const unknown = await fx.sendInventory(
      "inventory-unknown",
      [
        {
          name: "Uncatalogued Utility",
          version: "1.0",
          package_identifier: "unknown.utility",
        },
      ],
      false,
      new Date(Date.parse(observedAt) + 2000).toISOString(),
    );
    assert.equal(unknown.status, 200, await unknown.clone().text());
    const unknownId = String(
      (
        await fx.db.pool.query(
          "SELECT id FROM software.inventory_installations WHERE tenant_id=$1 AND normalized_name='Uncatalogued Utility'",
          [fx.tenantId],
        )
      ).rows[0]!.id,
    );
    await fx.db.pool.query(
      "UPDATE software.inventory_installations SET first_seen_at=now()-interval '73 hours' WHERE tenant_id=$1 AND id=$2",
      [fx.tenantId, unknownId],
    );
    const beforeReview = await fx.db.pool.query(
      "SELECT count(*)::int AS count FROM software.software_exceptions e JOIN software.inventory_installations i ON i.tenant_id=e.tenant_id AND i.id=e.installation_id WHERE e.tenant_id=$1 AND i.id=$2",
      [fx.tenantId, unknownId],
    );
    assert.equal(beforeReview.rows[0]!.count, 0);
    const review = await fx.post(
      fx.apiUrl,
      `/api/v1/software/inventory/${unknownId}/commands/review`,
      "review-unknown",
      { reason: "Unknown package exceeded review grace period" },
    );
    assert.equal(review.status, 200, await review.clone().text());
    const detected = await fx.db.pool.query(
      "SELECT state FROM software.software_exceptions WHERE tenant_id=$1 AND installation_id=$2",
      [fx.tenantId, unknownId],
    );
    assert.equal(detected.rows[0]!.state, "OPEN");
    const unknownRemoval = await fx.post(
      fx.apiUrl,
      `/api/v1/software/exceptions/${String((await fx.db.pool.query("SELECT id FROM software.software_exceptions WHERE tenant_id=$1 AND installation_id=$2", [fx.tenantId, unknownId])).rows[0]!.id)}/commands/request-removal`,
      "unknown-removal",
      {
        expected_version: 1,
        reason: "Operator requests manual investigation/removal",
      },
    );
    assert.equal(
      unknownRemoval.status,
      200,
      await unknownRemoval.clone().text(),
    );
    const noAutomaticJob = await data<{
      automatic_dispatch: boolean;
      removal_job_id: string | null;
    }>(unknownRemoval.clone());
    assert.equal(noAutomaticJob.automatic_dispatch, false);
    assert.equal(noAutomaticJob.removal_job_id, null);

    fx.setTenant("other-tenant");
    const tenantDenied = await fx.get(fx.apiUrl, "/api/v1/software/exceptions");
    assert.equal(tenantDenied.status, 200);
    assert.deepEqual(await data(tenantDenied), []);
  } finally {
    await fx.close();
  }
});

test("software exception approval, false-positive decision and expiry retain history", async () => {
  const fx = await fixture("tenant-software-exceptions");
  try {
    const productId = await createProduct(fx, {
      name: "Restricted Design Tool",
      code: "RESTRICTED-DESIGN",
      classification: "RESTRICTED",
    });
    const firstObserved = new Date();
    const installed = await fx.sendInventory(
      "restricted-inventory-1",
      [
        {
          name: "Restricted Design Tool",
          publisher: "Example Vendor",
          version: "2.0",
        },
      ],
      true,
      firstObserved.toISOString(),
    );
    assert.equal(installed.status, 200, await installed.clone().text());
    const exceptionRow = await fx.db.pool.query(
      "SELECT id,state,version FROM software.software_exceptions WHERE tenant_id=$1",
      [fx.tenantId],
    );
    const exceptionId = String(exceptionRow.rows[0]!.id);
    const request = await fx.post(
      fx.apiUrl,
      `/api/v1/software/exceptions/${exceptionId}/commands/request-approval`,
      "exception-approval-request",
      {
        expected_version: 1,
        reason: "Temporary business use requested",
        policy_id: fx.approvalPolicyId,
        policy_version: 1,
      },
    );
    assert.equal(request.status, 200, await request.clone().text());
    const requestResult = await data<{
      approval_request_id: string;
      version: number;
    }>(request.clone());
    assert.equal(requestResult.version, 2);
    const workItemBeforeApproval = await fx.db.pool.query(
      "SELECT state FROM operations.work_items WHERE tenant_id=$1 AND source_type='SOFTWARE_EXCEPTION' AND source_id=$2",
      [fx.tenantId, exceptionId],
    );
    assert.equal(workItemBeforeApproval.rows[0]!.state, "NEW");
    const approverId = randomUUID();
    fx.setActor(approverId);
    const decision = await fx.post(
      fx.apiUrl,
      `/api/v1/approvals/${requestResult.approval_request_id}/commands/approve`,
      "exception-approval-decision",
      { expected_version: 1, reason: "Approved for a bounded project period" },
    );
    assert.equal(decision.status, 200, await decision.clone().text());
    fx.setActor(randomUUID());
    const approved = await fx.post(
      fx.apiUrl,
      `/api/v1/software/exceptions/${exceptionId}/commands/approve-temporary`,
      "exception-temporary-approval",
      {
        expected_version: 2,
        reason: "Apply the approved temporary exception",
        approval_request_id: requestResult.approval_request_id,
        approved_until: new Date(Date.now() + 250).toISOString(),
      },
    );
    assert.equal(approved.status, 200, await approved.clone().text());
    const afterApproval = await fx.db.pool.query(
      "SELECT state,version,approved_until FROM software.software_exceptions WHERE tenant_id=$1 AND id=$2",
      [fx.tenantId, exceptionId],
    );
    assert.equal(afterApproval.rows[0]!.state, "APPROVED_TEMPORARY");
    const resolvedWorkItem = await fx.db.pool.query(
      "SELECT state FROM operations.work_items WHERE tenant_id=$1 AND source_type='SOFTWARE_EXCEPTION' AND source_id=$2",
      [fx.tenantId, exceptionId],
    );
    assert.equal(resolvedWorkItem.rows[0]!.state, "RESOLVED");

    await new Promise((resolve) => setTimeout(resolve, 300));
    const reevaluated = await fx.sendInventory(
      "restricted-inventory-after-expiry",
      [
        {
          name: "Restricted Design Tool",
          publisher: "Example Vendor",
          version: "2.0",
        },
      ],
      true,
      new Date(firstObserved.getTime() + 1000).toISOString(),
    );
    assert.equal(reevaluated.status, 200, await reevaluated.clone().text());
    const reopened = await fx.db.pool.query(
      "SELECT state,version FROM software.software_exceptions WHERE tenant_id=$1 AND id=$2",
      [fx.tenantId, exceptionId],
    );
    assert.equal(reopened.rows[0]!.state, "OPEN");
    assert.equal(Number(reopened.rows[0]!.version), 4);
    const reopenedWorkItem = await fx.db.pool.query(
      "SELECT state,version FROM operations.work_items WHERE tenant_id=$1 AND source_type='SOFTWARE_EXCEPTION' AND source_id=$2",
      [fx.tenantId, exceptionId],
    );
    assert.equal(reopenedWorkItem.rows[0]!.state, "NEW");
    assert.ok(Number(reopenedWorkItem.rows[0]!.version) > 1);

    fx.setAllowed(false);
    const denied = await fx.post(
      fx.apiUrl,
      `/api/v1/software/exceptions/${exceptionId}/commands/mark-false-positive`,
      "false-positive-denied",
      {
        expected_version: 4,
        reason: "inspected",
        evidence_reference: "review-1",
      },
    );
    assert.equal(denied.status, 403);
    fx.setAllowed(true);
    const falsePositive = await fx.post(
      fx.apiUrl,
      `/api/v1/software/exceptions/${exceptionId}/commands/mark-false-positive`,
      "false-positive-decision",
      {
        expected_version: 4,
        reason: "Catalog match is a known false positive",
        evidence_reference: "SEC-REVIEW-12",
      },
    );
    assert.equal(falsePositive.status, 200, await falsePositive.clone().text());
    const history = await fx.db.pool.query(
      "SELECT to_state,version FROM software.software_exception_history WHERE tenant_id=$1 AND exception_id=$2 ORDER BY version",
      [fx.tenantId, exceptionId],
    );
    assert.deepEqual(
      history.rows.map((row) => row.to_state),
      [
        "OPEN",
        "WAITING_APPROVAL",
        "APPROVED_TEMPORARY",
        "OPEN",
        "FALSE_POSITIVE",
      ],
    );
    const terminalSync = await fx.sendInventory(
      "restricted-inventory-after-false-positive",
      [
        {
          name: "Restricted Design Tool",
          publisher: "Example Vendor",
          version: "2.0",
        },
      ],
      true,
      new Date(firstObserved.getTime() + 2000).toISOString(),
    );
    assert.equal(terminalSync.status, 200, await terminalSync.clone().text());
    const count = await fx.db.pool.query(
      "SELECT count(*)::int AS count FROM software.software_exceptions WHERE tenant_id=$1",
      [fx.tenantId],
    );
    assert.equal(count.rows[0]!.count, 1);
    const audits = await fx.db.pool.query(
      "SELECT count(*)::int AS count FROM audit.audit_events WHERE tenant_id=$1 AND event_type='SOFTWARE.EXCEPTION_UPDATED'",
      [fx.tenantId],
    );
    assert.ok(audits.rows[0]!.count >= 4);
    void productId;
  } finally {
    await fx.close();
  }
});

test("approved symbolic removal is leased, fail-closed on risky assets and verified by later inventory", async () => {
  const fx = await fixture("tenant-software-removal");
  try {
    const productId = await createProduct(fx, {
      name: "Prohibited Torrent Client",
      code: "PROHIBITED-TORRENT",
      classification: "PROHIBITED",
    });
    const installedAt = new Date();
    const inventory = await fx.sendInventory(
      "removal-install-inventory",
      [
        {
          name: "Prohibited Torrent Client",
          publisher: "Example Vendor",
          version: "3.1",
          package_identifier: "vendor.torrent",
        },
      ],
      true,
      installedAt.toISOString(),
    );
    assert.equal(inventory.status, 200, await inventory.clone().text());
    const exception = await fx.db.pool.query(
      "SELECT id,version FROM software.software_exceptions WHERE tenant_id=$1",
      [fx.tenantId],
    );
    const exceptionId = String(exception.rows[0]!.id);
    const profileResponse = await fx.post(
      fx.apiUrl,
      `/api/v1/software/products/${productId}/uninstall-profiles`,
      "profile-create",
      {
        symbolic_method: "PACKAGE_IDENTIFIER",
        auto_removal_allowed: true,
        no_business_dependency_attested: true,
        owner_id: randomUUID(),
        reason: "Security review confirms safe automatic removal",
      },
    );
    assert.equal(
      profileResponse.status,
      201,
      await profileResponse.clone().text(),
    );
    const profile = await data<{ id: string; version: number }>(
      profileResponse.clone(),
    );
    const approval = await fx.post(
      fx.apiUrl,
      "/api/v1/approvals",
      "profile-approval-request",
      {
        source_type: "SOFTWARE_UNINSTALL_PROFILE",
        source_id: profile.id,
        policy_id: fx.approvalPolicyId,
        policy_version: 1,
        context: { reason: "Review symbolic uninstall policy" },
      },
    );
    assert.equal(approval.status, 201, await approval.clone().text());
    const approvalRequest = await data<{ id: string }>(approval.clone());
    fx.setActor(randomUUID());
    const decision = await fx.post(
      fx.apiUrl,
      `/api/v1/approvals/${approvalRequest.id}/commands/approve`,
      "profile-approval-decision",
      { expected_version: 1, reason: "Profile reviewed and approved" },
    );
    assert.equal(decision.status, 200, await decision.clone().text());
    fx.setActor(randomUUID());
    const profileApproved = await fx.post(
      fx.apiUrl,
      `/api/v1/software/uninstall-profiles/${profile.id}/commands/approve`,
      "profile-apply-approval",
      {
        expected_version: 1,
        approval_request_id: approvalRequest.id,
        reason: "Apply distinct approval",
      },
    );
    assert.equal(
      profileApproved.status,
      200,
      await profileApproved.clone().text(),
    );

    const removal = await fx.post(
      fx.apiUrl,
      `/api/v1/software/exceptions/${exceptionId}/commands/request-removal`,
      "removal-request",
      { expected_version: 1, reason: "Remove prohibited software" },
    );
    assert.equal(removal.status, 200, await removal.clone().text());
    const removalValue = await data<{
      state: string;
      version: number;
      removal_job_id: string;
      automatic_dispatch: boolean;
    }>(removal.clone());
    assert.equal(removalValue.state, "REMOVAL_PENDING");
    assert.equal(removalValue.automatic_dispatch, true);
    const work = await fx.db.pool.query(
      "SELECT state FROM operations.work_items WHERE tenant_id=$1 AND source_type='SOFTWARE_EXCEPTION' AND source_id=$2",
      [fx.tenantId, exceptionId],
    );
    assert.equal(work.rows[0]!.state, "NEW");

    const claimBody = { supported_methods: ["PACKAGE_IDENTIFIER"] };
    const claim = await fx.post(
      fx.agentUrl,
      "/api/v1/agent/software-removals/claim",
      "removal-claim-1",
      claimBody,
    );
    assert.equal(claim.status, 200, await claim.clone().text());
    const job = await data<{
      id: string;
      lease_id: string;
      attempt_number: number;
    }>(claim.clone());
    assert.equal(job.id, removalValue.removal_job_id);
    assert.equal(job.attempt_number, 1);
    const replayClaim = await fx.post(
      fx.agentUrl,
      "/api/v1/agent/software-removals/claim",
      "removal-claim-1",
      claimBody,
    );
    assert.equal(replayClaim.status, 200);
    assert.deepEqual(await data(replayClaim), job);
    const noDuplicateClaim = await fx.post(
      fx.agentUrl,
      "/api/v1/agent/software-removals/claim",
      "removal-claim-2",
      claimBody,
    );
    assert.equal(noDuplicateClaim.status, 200);
    assert.equal(await data(noDuplicateClaim), null);

    const retryableFailure = await fx.post(
      fx.agentUrl,
      `/api/v1/agent/software-removals/${job.id}/commands/report`,
      "removal-report-attempt-1",
      {
        lease_id: job.lease_id,
        outcome: "FAILED",
        retryable: true,
        error_code: "PACKAGE_MANAGER_BUSY",
        summary: "Package manager is busy; retry is safe",
      },
    );
    assert.equal(
      retryableFailure.status,
      200,
      await retryableFailure.clone().text(),
    );
    assert.equal(
      (await data<{ state: string }>(retryableFailure.clone())).state,
      "QUEUED",
    );
    const retryClaim = await fx.post(
      fx.agentUrl,
      "/api/v1/agent/software-removals/claim",
      "removal-claim-3",
      claimBody,
    );
    assert.equal(retryClaim.status, 200, await retryClaim.clone().text());
    const retryJob = await data<typeof job>(retryClaim.clone());
    assert.equal(retryJob.attempt_number, 2);
    const staleReport = await fx.post(
      fx.agentUrl,
      `/api/v1/agent/software-removals/${job.id}/commands/report`,
      "stale-removal-report",
      {
        lease_id: job.lease_id,
        outcome: "REMOVAL_REPORTED",
        retryable: false,
      },
    );
    assert.equal(staleReport.status, 409, await staleReport.clone().text());

    const report = await fx.post(
      fx.agentUrl,
      `/api/v1/agent/software-removals/${job.id}/commands/report`,
      "removal-report",
      {
        lease_id: retryJob.lease_id,
        outcome: "REMOVAL_REPORTED",
        retryable: false,
        summary: "Package manager removed package",
      },
    );
    assert.equal(report.status, 200, await report.clone().text());
    assert.equal(
      (await data<{ requires_inventory_verification: boolean }>(report.clone()))
        .requires_inventory_verification,
      true,
    );
    const removalEvents = await fx.db.pool.query(
      `SELECT event_type,payload->'payload' AS payload
         FROM platform.outbox_events
        WHERE tenant_id=$1 AND event_type IN
          ('SOFTWARE.REMOVAL_JOB_CLAIMED','SOFTWARE.REMOVAL_FAILED','SOFTWARE.REMOVAL_JOB_REPORTED')
        ORDER BY created_at,event_id`,
      [fx.tenantId],
    );
    const claimedEvent = removalEvents.rows.find(
      (row) => row.event_type === "SOFTWARE.REMOVAL_JOB_CLAIMED",
    );
    const reportedEvent = removalEvents.rows.find(
      (row) => row.event_type === "SOFTWARE.REMOVAL_JOB_REPORTED",
    );
    assert.equal(claimedEvent?.payload.removal_job_id, job.id);
    assert.equal(claimedEvent?.payload.agent_id, fx.agentId);
    assert.equal(reportedEvent?.payload.removal_job_id, job.id);
    assert.equal(reportedEvent?.payload.outcome, "REMOVAL_REPORTED");
    const stillPending = await fx.db.pool.query(
      "SELECT state FROM software.software_exceptions WHERE tenant_id=$1 AND id=$2",
      [fx.tenantId, exceptionId],
    );
    assert.equal(stillPending.rows[0]!.state, "REMOVAL_PENDING");

    const absent = await fx.sendInventory(
      "removal-verification-inventory",
      [],
      true,
      new Date(installedAt.getTime() + 1000).toISOString(),
    );
    assert.equal(absent.status, 200, await absent.clone().text());
    const resolved = await fx.db.pool.query(
      "SELECT state FROM software.software_exceptions WHERE tenant_id=$1 AND id=$2",
      [fx.tenantId, exceptionId],
    );
    assert.equal(resolved.rows[0]!.state, "RESOLVED");
    const resolvedWork = await fx.db.pool.query(
      "SELECT state FROM operations.work_items WHERE tenant_id=$1 AND source_type='SOFTWARE_EXCEPTION' AND source_id=$2",
      [fx.tenantId, exceptionId],
    );
    assert.equal(resolvedWork.rows[0]!.state, "RESOLVED");
    const removedEvent = await fx.db.pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='SOFTWARE.REMOVED'",
      [fx.tenantId],
    );
    assert.equal(removedEvent.rows[0]!.count, 1);

    const riskTenant = "tenant-software-risk";
    const risky = await fixture(riskTenant, "Server");
    try {
      const riskProduct = await createProduct(risky, {
        name: "Prohibited Torrent Client",
        code: "PROHIBITED-TORRENT",
        classification: "PROHIBITED",
      });
      const riskyProfile = await risky.post(
        risky.apiUrl,
        `/api/v1/software/products/${riskProduct}/uninstall-profiles`,
        "risk-profile-create",
        {
          symbolic_method: "PACKAGE_IDENTIFIER",
          auto_removal_allowed: true,
          no_business_dependency_attested: true,
          owner_id: randomUUID(),
          reason:
            "Approved profile for test; server risk must still block dispatch",
        },
      );
      const riskyProfileValue = await data<{ id: string }>(
        riskyProfile.clone(),
      );
      const riskApproval = await risky.post(
        risky.apiUrl,
        "/api/v1/approvals",
        "risk-profile-approval",
        {
          source_type: "SOFTWARE_UNINSTALL_PROFILE",
          source_id: riskyProfileValue.id,
          policy_id: risky.approvalPolicyId,
          policy_version: 1,
          context: { reason: "Profile approval" },
        },
      );
      const riskApprovalValue = await data<{ id: string }>(
        riskApproval.clone(),
      );
      risky.setActor(randomUUID());
      await risky.post(
        risky.apiUrl,
        `/api/v1/approvals/${riskApprovalValue.id}/commands/approve`,
        "risk-profile-decision",
        { expected_version: 1, reason: "Approved" },
      );
      risky.setActor(randomUUID());
      await risky.post(
        risky.apiUrl,
        `/api/v1/software/uninstall-profiles/${riskyProfileValue.id}/commands/approve`,
        "risk-profile-apply",
        {
          expected_version: 1,
          approval_request_id: riskApprovalValue.id,
          reason: "Apply approval",
        },
      );
      const riskyInventory = await risky.sendInventory("risk-install", [
        {
          name: "Prohibited Torrent Client",
          publisher: "Example Vendor",
          version: "3.1",
          package_identifier: "vendor.torrent",
        },
      ]);
      assert.equal(
        riskyInventory.status,
        200,
        await riskyInventory.clone().text(),
      );
      const riskyException = await risky.db.pool.query(
        "SELECT id FROM software.software_exceptions WHERE tenant_id=$1",
        [riskTenant],
      );
      const blocked = await risky.post(
        risky.apiUrl,
        `/api/v1/software/exceptions/${String(riskyException.rows[0]!.id)}/commands/request-removal`,
        "risky-removal",
        { expected_version: 1, reason: "Manual removal request for server" },
      );
      assert.equal(blocked.status, 200, await blocked.clone().text());
      const blockedValue = await data<{
        automatic_dispatch: boolean;
        removal_job_id: string | null;
      }>(blocked.clone());
      assert.equal(blockedValue.automatic_dispatch, false);
      assert.equal(blockedValue.removal_job_id, null);
    } finally {
      await risky.close();
    }
  } finally {
    await fx.close();
  }
});
