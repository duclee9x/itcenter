import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import {
  createLicenseEntitlement,
  createLicenseAssignment,
  transitionLicenseAssignment,
} from "../../modules/license/index.js";
import { receiveReturn } from "../../modules/asset/index.js";
import { createSession } from "../../modules/identity/index.js";
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

test("offboarding coordinates Asset return and License cancel/reclaim through owning commands", async () => {
  const db = await testDatabase();
  const tenant = "tenant-offboarding";
  const user = randomUUID();
  const assetId = randomUUID();
  let allowed = true;
  await db.pool.query(
    "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,$2,'USR-OFF-1','user-off-1','Offboarding User','ACTIVE')",
    [user, tenant],
  );
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Offboarding Devices')",
    [randomUUID(), tenant],
  );
  const category = await db.pool.query(
    "SELECT id FROM asset.categories WHERE tenant_id=$1",
    [tenant],
  );
  const model = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Example','Offboarding Laptop',$3)",
    [model, tenant, category.rows[0]!.id],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state,assignment_state) VALUES($1,$2,'AST-OFF-1',$3,'ASSIGNED','ASSIGNED')",
    [assetId, tenant, model],
  );
  await db.pool.query(
    "INSERT INTO asset.assignments(id,tenant_id,asset_id,user_id,reason) VALUES($1,$2,$3,$4,'Offboarding E2E fixture')",
    [randomUUID(), tenant, assetId, user],
  );
  const location = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,$2,'OFF-REC','Offboarding Receiving','STORAGE')",
    [location, tenant],
  );
  const products = [randomUUID(), randomUUID()];
  for (let i = 0; i < products.length; i++)
    await db.pool.query(
      `INSERT INTO software.software_products(id,tenant_id,product_code,name,vendor,category,classification,owner_id,support_team,supported_os,supported_asset_classes,visibility,license_required) VALUES($1,$2,$3,$4,'Example','PRODUCTIVITY','APPROVED','it','it',ARRAY[]::text[],ARRAY[]::text[],'IT_ONLY',true)`,
      [products[i], tenant, `OFF-LIC-${i}`, `Offboarding License ${i}`],
    );
  const entitlements = [] as string[];
  for (const product of products) {
    const e = await db.uow.run(tenant, (tx) =>
      createLicenseEntitlement({
        tx,
        softwareProductId: product,
        licenseType: "PER_USER",
        quantity: 5,
        validFrom: new Date(Date.now() - 60000).toISOString(),
        restrictions: [],
        actorId: "fixture",
        reason: "Offboarding E2E entitlement",
      }),
    );
    entitlements.push(e.id);
  }
  const first = await db.uow.run(tenant, (tx) =>
    createLicenseAssignment({
      tx,
      entitlementId: entitlements[0]!,
      principalType: "USER",
      principalId: user,
      actorId: "fixture",
      reason: "Offboarding E2E assigned",
    }),
  );
  const second = await db.uow.run(tenant, (tx) =>
    createLicenseAssignment({
      tx,
      entitlementId: entitlements[1]!,
      principalType: "USER",
      principalId: user,
      actorId: "fixture",
      reason: "Offboarding E2E active",
    }),
  );
  await db.uow.run(tenant, (tx) =>
    transitionLicenseAssignment({
      tx,
      assignmentId: String(second.id),
      expectedVersion: 1,
      action: "ACTIVATE",
      actorId: "fixture",
      reason: "Activate E2E license",
    }),
  );
  const session = await db.uow.run(tenant, (tx) =>
    createSession(tx, {
      tenantId: tenant,
      userId: user,
      authMethod: "OIDC",
      now: new Date(),
      idleMs: 3600000,
      absoluteMs: 7200000,
    }),
  );
  const authentication = {
    async authenticate() {
      return { id: "operator", tenant_id: tenant, actor_type: "USER" };
    },
  };
  const authorization = {
    async evaluate() {
      return {
        result: allowed ? ("ALLOW" as const) : ("DENY" as const),
        reason: "E2E policy",
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
  const base = await listen(api);
  const post = (path: string, key: string, value: object) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: "Bearer e2e",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(value),
    });
  try {
    const started = await post(
      `/api/v1/users/${user}/commands/start-offboarding`,
      "off-start",
      {
        expected_user_version: 1,
        termination_request_id: "MANUAL-TERM-01",
        reason: "Employee departure approved",
      },
    );
    assert.equal(started.status, 201);
    const startPayload = (await started.json()) as {
      data: {
        id: string;
        version: number;
        clearances: Array<{
          clearance_type: string;
          resource_id: string;
          state: string;
          detail: string;
        }>;
      };
    };
    assert.equal(startPayload.data.version, 2);
    const caseId = startPayload.data.id;
    const blockedClose = await post(
      `/api/v1/offboarding-cases/${caseId}/commands/mark-ready`,
      "off-too-early",
      { expected_version: 2, reason: "Attempt premature close" },
    );
    assert.equal(blockedClose.status, 422);
    const revoked = await db.pool.query(
      "SELECT revoked_at FROM identity.sessions WHERE tenant_id=$1 AND id=$2",
      [tenant, session.id],
    );
    assert.ok(revoked.rows[0]!.revoked_at);
    const replay = await post(
      `/api/v1/users/${user}/commands/start-offboarding`,
      "off-start",
      {
        expected_user_version: 1,
        termination_request_id: "MANUAL-TERM-01",
        reason: "Employee departure approved",
      },
    );
    assert.equal(replay.status, 201);
    assert.equal(
      ((await replay.json()) as { data: { id: string } }).data.id,
      caseId,
    );
    const assignments = await db.pool.query(
      "SELECT id,state FROM license.assignments WHERE tenant_id=$1 AND principal_id=$2 ORDER BY id",
      [tenant, user],
    );
    assert.deepEqual(
      assignments.rows.map((r) => r.state).sort(),
      ["CANCELLED", "RECLAIM_PENDING"].sort(),
    );
    const actionable = await db.pool.query(
      "SELECT state FROM operations.work_items WHERE tenant_id=$1 AND source_type='OFFBOARDING' AND source_id=$2",
      [tenant, caseId],
    );
    assert.equal(actionable.rows[0]!.state, "NEW");
    const assetTask = startPayload.data.clearances.find(
      (x) => x.clearance_type === "ASSET_RETURN",
    )!;
    const returnInfo = JSON.parse(assetTask.detail) as {
      return_request_id: string;
      asset_version: number;
    };
    await db.uow.run(tenant, (tx) =>
      receiveReturn({
        tx,
        assetId,
        expectedVersion: returnInfo.asset_version,
        returnRequestId: returnInfo.return_request_id,
        receivedLocationId: location,
        conditionGrade: "B",
        notes: "Received for offboarding",
      }),
    );
    const licenseState = await db.pool.query(
      "SELECT version FROM license.assignments WHERE tenant_id=$1 AND id=$2",
      [tenant, second.id],
    );
    await db.uow.run(tenant, (tx) =>
      transitionLicenseAssignment({
        tx,
        assignmentId: String(second.id),
        expectedVersion: Number(licenseState.rows[0]!.version),
        action: "COMPLETE_RECLAIM",
        actorId: "license-operator",
        reason: "Provider reclaim verified",
        verificationReference: "provider-ticket-42",
      }),
    );
    const reconciled = await post(
      `/api/v1/offboarding-cases/${caseId}/commands/reconcile`,
      "off-reconcile",
      { reason: "Verify returned asset and reclaimed license" },
    );
    assert.equal(reconciled.status, 200);
    assert.equal(
      (
        await post(
          `/api/v1/offboarding-cases/${caseId}/commands/reconcile`,
          "off-reconcile",
          { reason: "Verify returned asset and reclaimed license" },
        )
      ).status,
      200,
    );
    const ready = await post(
      `/api/v1/offboarding-cases/${caseId}/commands/mark-ready`,
      "off-ready",
      { expected_version: 2, reason: "All clearances verified" },
    );
    assert.equal(ready.status, 200);
    const complete = await post(
      `/api/v1/offboarding-cases/${caseId}/commands/complete`,
      "off-complete",
      {
        expected_version: 3,
        user_expected_version: 2,
        reason: "Finalize approved departure",
      },
    );
    assert.equal(complete.status, 200);
    const final = await db.pool.query(
      "SELECT state FROM identity.offboarding_cases WHERE tenant_id=$1 AND id=$2",
      [tenant, caseId],
    );
    assert.equal(final.rows[0]!.state, "COMPLETED");
    const lifecycle = await db.pool.query(
      "SELECT employment_status FROM identity.users WHERE tenant_id=$1 AND id=$2",
      [tenant, user],
    );
    assert.equal(lifecycle.rows[0]!.employment_status, "TERMINATED");
    const events = await db.pool.query(
      "SELECT event_type FROM platform.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2",
      [tenant, caseId],
    );
    assert.ok(events.rows.some((r) => r.event_type === "OFFBOARDING.STARTED"));
    assert.ok(
      events.rows.some((r) => r.event_type === "OFFBOARDING.COMPLETED"),
    );
    allowed = false;
    const denied = await post(
      `/api/v1/users/${randomUUID()}/commands/start-offboarding`,
      "off-denied",
      {
        expected_user_version: 1,
        termination_request_id: "MANUAL-TERM-DENY",
        reason: "Denied by policy",
      },
    );
    assert.equal(denied.status, 403);
    assert.equal(String(first.state), "ASSIGNED");
  } finally {
    await new Promise<void>((resolve, reject) =>
      api.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});

test("COMPLETE and REQUEST_CANCEL serialize on offboarding case version", async () => {
  const db = await testDatabase();
  const tenant = "tenant-offboarding-race";
  const user = randomUUID();
  await db.pool.query(
    "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,$2,'USR-OFF-RACE','user-off-race','Race User','ACTIVE')",
    [user, tenant],
  );
  const auth = {
    async authenticate() {
      return { id: "operator", tenant_id: tenant, actor_type: "USER" };
    },
  };
  const authorization = {
    async evaluate() {
      return { result: "ALLOW" as const, reason: "race test" };
    },
  };
  const api = apiServer(
    config(),
    async () => true,
    auth,
    authorization,
    db.uow,
  );
  const base = await listen(api);
  const post = (path: string, key: string, value: object) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: "Bearer e2e",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(value),
    });
  try {
    const start = await post(
      `/api/v1/users/${user}/commands/start-offboarding`,
      "race-start",
      {
        expected_user_version: 1,
        termination_request_id: "TERM-RACE-1",
        reason: "Race test departure",
      },
    );
    const data = (await start.json()) as { data: { id: string } };
    const id = data.data.id;
    assert.equal(
      (
        await post(
          `/api/v1/offboarding-cases/${id}/commands/mark-ready`,
          "race-ready",
          { expected_version: 2, reason: "No outstanding clearances" },
        )
      ).status,
      200,
    );
    const attempts = await Promise.all([
      post(
        `/api/v1/offboarding-cases/${id}/commands/complete`,
        "race-complete",
        {
          expected_version: 3,
          user_expected_version: 2,
          reason: "Complete race",
        },
      ),
      post(
        `/api/v1/offboarding-cases/${id}/commands/request-cancel`,
        "race-cancel",
        {
          expected_version: 3,
          withdrawal_reference: "HR-WITHDRAW-RACE",
          reason: "Cancel race",
        },
      ),
    ]);
    assert.equal(attempts.filter((r) => r.status === 200).length, 1);
    assert.ok(attempts.some((r) => r.status === 409));
    const state = await db.pool.query(
      "SELECT state,version FROM identity.offboarding_cases WHERE tenant_id=$1 AND id=$2",
      [tenant, id],
    );
    assert.equal(Number(state.rows[0]!.version), 4);
    assert.ok(
      ["COMPLETED", "CANCELLATION_PENDING"].includes(
        String(state.rows[0]!.state),
      ),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      api.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});

test("offboarding cancellation requires recovered actions and never restores TERMINATED", async () => {
  const db = await testDatabase();
  const tenant = "tenant-offboarding-cancel";
  const user = randomUUID();
  const assetId = randomUUID();
  const categoryId = randomUUID();
  const modelId = randomUUID();
  await db.pool.query(
    "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,$2,'USR-OFF-CANCEL','user-off-cancel','Cancel User','ACTIVE')",
    [user, tenant],
  );
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Cancellation Devices')",
    [categoryId, tenant],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Example','Cancellation Laptop',$3)",
    [modelId, tenant, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state,assignment_state) VALUES($1,$2,'AST-OFF-CANCEL',$3,'ASSIGNED','ASSIGNED')",
    [assetId, tenant, modelId],
  );
  await db.pool.query(
    "INSERT INTO asset.assignments(id,tenant_id,asset_id,user_id,reason) VALUES($1,$2,$3,$4,'Cancellation fixture')",
    [randomUUID(), tenant, assetId, user],
  );
  const auth = {
    async authenticate() {
      return { id: "operator", tenant_id: tenant, actor_type: "USER" };
    },
  };
  const authorization = {
    async evaluate() {
      return { result: "ALLOW" as const, reason: "cancel test" };
    },
  };
  const api = apiServer(
    config(),
    async () => true,
    auth,
    authorization,
    db.uow,
  );
  const base = await listen(api);
  const post = (path: string, key: string, value: object) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: "Bearer e2e",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(value),
    });
  try {
    const created = await post(
      `/api/v1/users/${user}/offboarding-cases`,
      "cancel-create",
      {
        expected_user_version: 1,
        termination_request_id: "TERM-CANCEL-1",
        reason: "Cancel flow test",
      },
    );
    assert.equal(created.status, 201);
    const draft = (await created.json()) as {
      data: { id: string; state: string; version: number };
    };
    assert.equal(draft.data.state, "INITIATED");
    assert.equal(draft.data.version, 1);
    const caseId = draft.data.id;
    assert.equal(
      (
        await post(
          `/api/v1/offboarding-cases/${caseId}/commands/start`,
          "cancel-start",
          {
            expected_version: 1,
            user_expected_version: 1,
            reason: "Start cancellation flow test",
          },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await post(
          `/api/v1/offboarding-cases/${caseId}/commands/request-cancel`,
          "cancel-request",
          {
            expected_version: 2,
            withdrawal_reference: "HR-WITHDRAW-1",
            reason: "Termination withdrawn",
          },
        )
      ).status,
      200,
    );
    const pending = await db.pool.query(
      "SELECT id,version,action_type,source_action_id FROM identity.offboarding_recovery_actions WHERE tenant_id=$1 AND offboarding_case_id=$2",
      [tenant, caseId],
    );
    assert.equal(pending.rowCount, 2);
    const premature = await post(
      `/api/v1/offboarding-cases/${caseId}/commands/complete-cancellation`,
      "cancel-premature",
      {
        expected_version: 3,
        user_expected_version: 2,
        withdrawal_reference: "HR-WITHDRAW-1",
        reason: "Should be blocked",
      },
    );
    assert.equal(premature.status, 422);
    const accessRecovery = pending.rows.find(
      (r) => r.action_type === "RESTORE_ACCESS_OR_ACCEPT_EXCEPTION",
    )!;
    const assetRecovery = pending.rows.find(
      (r) => r.action_type === "RECOVER_ASSET_RETURN",
    )!;
    const recoveryCommand = {
      recovery_action_id: accessRecovery.id,
      expected_recovery_version: 1,
      disposition: "SUCCEEDED",
      evidence_reference: "access-restored-approval-7",
      reason: "Access recovery verified",
    };
    assert.equal(
      (
        await post(
          `/api/v1/offboarding-cases/${caseId}/commands/resolve-recovery`,
          "cancel-recovery",
          recoveryCommand,
        )
      ).status,
      200,
    );
    const assetCommand = {
      recovery_action_id: assetRecovery.id,
      expected_recovery_version: 1,
      disposition: "SUCCEEDED",
      evidence_reference: "asset-return-request-cancelled",
      reason: "Restore pending asset return",
    };
    assert.equal(
      (
        await post(
          `/api/v1/offboarding-cases/${caseId}/commands/resolve-recovery`,
          "cancel-asset-recovery",
          assetCommand,
        )
      ).status,
      200,
    );
    const assetAfterRecovery = await db.pool.query(
      "SELECT assignment_state,version FROM asset.assets WHERE tenant_id=$1 AND id=$2",
      [tenant, assetId],
    );
    assert.equal(assetAfterRecovery.rows[0]!.assignment_state, "ASSIGNED");
    assert.equal(
      (
        await post(
          `/api/v1/offboarding-cases/${caseId}/commands/resolve-recovery`,
          "cancel-recovery",
          recoveryCommand,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await post(
          `/api/v1/offboarding-cases/${caseId}/commands/complete-cancellation`,
          "cancel-complete",
          {
            expected_version: 3,
            user_expected_version: 2,
            withdrawal_reference: "HR-WITHDRAW-1",
            reason: "Withdrawal confirmed",
          },
        )
      ).status,
      200,
    );
    const restored = await db.pool.query(
      "SELECT employment_status FROM identity.users WHERE tenant_id=$1 AND id=$2",
      [tenant, user],
    );
    assert.equal(restored.rows[0]!.employment_status, "ACTIVE");
    const returnCancelled = await db.pool.query(
      "SELECT status,cancelled_reason FROM asset.return_requests WHERE tenant_id=$1 AND asset_id=$2",
      [tenant, assetId],
    );
    assert.equal(returnCancelled.rows[0]!.status, "CANCELLED");
    assert.equal(
      returnCancelled.rows[0]!.cancelled_reason,
      "Restore pending asset return",
    );

    const secondUser = randomUUID();
    await db.pool.query(
      "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,$2,'USR-OFF-TERM','user-off-term','Terminated User','ACTIVE')",
      [secondUser, tenant],
    );
    const secondStart = await post(
      `/api/v1/users/${secondUser}/commands/start-offboarding`,
      "term-start",
      {
        expected_user_version: 1,
        termination_request_id: "TERM-CANCEL-2",
        reason: "Second cancellation flow",
      },
    );
    const secondId = ((await secondStart.json()) as { data: { id: string } })
      .data.id;
    await post(
      `/api/v1/offboarding-cases/${secondId}/commands/request-cancel`,
      "term-request-cancel",
      {
        expected_version: 2,
        withdrawal_reference: "HR-WITHDRAW-2",
        reason: "Late cancellation requested",
      },
    );
    await db.pool.query(
      "UPDATE identity.users SET employment_status='TERMINATED',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [tenant, secondUser],
    );
    const forbidden = await post(
      `/api/v1/offboarding-cases/${secondId}/commands/complete-cancellation`,
      "term-complete-cancel",
      {
        expected_version: 3,
        user_expected_version: 3,
        withdrawal_reference: "HR-WITHDRAW-2",
        reason: "Cannot reactivate terminal user",
      },
    );
    assert.equal(forbidden.status, 422);
    const terminal = await db.pool.query(
      "SELECT employment_status FROM identity.users WHERE tenant_id=$1 AND id=$2",
      [tenant, secondUser],
    );
    assert.equal(terminal.rows[0]!.employment_status, "TERMINATED");

    const draftUser = randomUUID();
    await db.pool.query(
      "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,$2,'USR-OFF-DRAFT','user-off-draft','Draft User','ACTIVE')",
      [draftUser, tenant],
    );
    const initiated = await post(
      `/api/v1/users/${draftUser}/offboarding-cases`,
      "draft-create",
      {
        expected_user_version: 1,
        termination_request_id: "TERM-DRAFT-1",
        reason: "No compensation cancellation",
      },
    );
    const initiatedCase = ((await initiated.json()) as { data: { id: string } })
      .data.id;
    assert.equal(
      (
        await post(
          `/api/v1/offboarding-cases/${initiatedCase}/commands/cancel`,
          "draft-cancel",
          { expected_version: 1, reason: "Withdraw before start" },
        )
      ).status,
      200,
    );
    const draftLifecycle = await db.pool.query(
      "SELECT employment_status FROM identity.users WHERE tenant_id=$1 AND id=$2",
      [tenant, draftUser],
    );
    assert.equal(draftLifecycle.rows[0]!.employment_status, "ACTIVE");
  } finally {
    await new Promise<void>((resolve, reject) =>
      api.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});

test("a missing assigned asset blocks offboarding and reconciliation resumes after the owner resolves it", async () => {
  const db = await testDatabase();
  const tenant = "tenant-offboarding-missing";
  const user = randomUUID();
  const assetId = randomUUID();
  const categoryId = randomUUID();
  const modelId = randomUUID();
  await db.pool.query(
    "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,$2,'USR-OFF-MISSING','user-off-missing','Missing Asset User','ACTIVE')",
    [user, tenant],
  );
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Missing Device Category')",
    [categoryId, tenant],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Example','Missing Device',$3)",
    [modelId, tenant, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state,assignment_state,risk_state) VALUES($1,$2,'AST-OFF-MISSING',$3,'ASSIGNED','ASSIGNED','UNKNOWN')",
    [assetId, tenant, modelId],
  );
  await db.pool.query(
    "INSERT INTO asset.assignments(id,tenant_id,asset_id,user_id,reason) VALUES($1,$2,$3,$4,'Missing asset E2E fixture')",
    [randomUUID(), tenant, assetId, user],
  );
  const auth = {
    async authenticate() {
      return { id: "operator", tenant_id: tenant, actor_type: "USER" };
    },
  };
  const authorization = {
    async evaluate() {
      return { result: "ALLOW" as const, reason: "missing asset test" };
    },
  };
  const api = apiServer(
    config(),
    async () => true,
    auth,
    authorization,
    db.uow,
  );
  const base = await listen(api);
  const post = (path: string, key: string, value: object) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        authorization: "Bearer e2e",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(value),
    });
  try {
    const started = await post(
      `/api/v1/users/${user}/commands/start-offboarding`,
      "missing-start",
      {
        expected_user_version: 1,
        termination_request_id: "TERM-MISSING-1",
        reason: "Missing asset investigation",
      },
    );
    assert.equal(started.status, 201);
    const payload = (await started.json()) as {
      data: {
        id: string;
        state: string;
        version: number;
        clearances: Array<{
          state: string;
          version: number;
          resource_id: string;
          asset_recovery_state: string;
        }>;
      };
    };
    assert.equal(payload.data.state, "IN_PROGRESS");
    const returnClearance = payload.data.clearances.find(
      (clearance) => clearance.resource_id === assetId,
    );
    assert.equal(returnClearance?.asset_recovery_state, "PENDING_RETURN");
    assert.ok(returnClearance);
    const unreturned = await post(
      `/api/v1/offboarding-cases/${payload.data.id}/assets/${assetId}/commands/recovery-state`,
      "unreturned-mark",
      {
        expected_clearance_version: returnClearance.version,
        state: "UNRETURNED",
        reason: "The return obligation is overdue and unresolved",
      },
    );
    assert.equal(unreturned.status, 200);
    const unreturnedCase = await fetch(
      `${base}/api/v1/offboarding-cases/${payload.data.id}`,
      { headers: { authorization: "Bearer e2e" } },
    );
    const unreturnedPayload = (await unreturnedCase.json()) as {
      data: {
        clearances: Array<{ version: number; asset_recovery_state: string }>;
      };
    };
    const unreturnedClearance = unreturnedPayload.data.clearances.find(
      (clearance) => clearance.asset_recovery_state === "UNRETURNED",
    );
    assert.ok(unreturnedClearance);
    const missing = await post(
      `/api/v1/offboarding-cases/${payload.data.id}/assets/${assetId}/commands/recovery-state`,
      "missing-mark",
      {
        expected_clearance_version: unreturnedClearance.version,
        state: "MISSING",
        reason: "Operator confirmed the assigned Asset cannot be located",
      },
    );
    assert.equal(missing.status, 200);
    const riskAfterMissing = await db.pool.query(
      "SELECT risk_state FROM asset.assets WHERE tenant_id=$1 AND id=$2",
      [tenant, assetId],
    );
    assert.equal(riskAfterMissing.rows[0]!.risk_state, "UNKNOWN");
    const blocked = await fetch(
      `${base}/api/v1/offboarding-cases/${payload.data.id}`,
      {
        headers: { authorization: "Bearer e2e" },
      },
    );
    const blockedPayload = (await blocked.json()) as {
      data: {
        state: string;
        version: number;
        clearances: Array<{
          state: string;
          version: number;
          asset_recovery_state: string;
        }>;
      };
    };
    assert.equal(blockedPayload.data.state, "BLOCKED");
    assert.ok(
      blockedPayload.data.clearances.some(
        (c) => c.state === "BLOCKED" && c.asset_recovery_state === "MISSING",
      ),
    );
    const premature = await post(
      `/api/v1/offboarding-cases/${payload.data.id}/commands/mark-ready`,
      "missing-ready",
      {
        expected_version: blockedPayload.data.version,
        reason: "Cannot close with missing asset",
      },
    );
    assert.equal(premature.status, 422);
    const item = await db.pool.query(
      "SELECT state FROM operations.work_items WHERE tenant_id=$1 AND source_type='OFFBOARDING' AND source_id=$2",
      [tenant, payload.data.id],
    );
    assert.equal(item.rows[0]!.state, "NEW");
    const blockedReturn = blockedPayload.data.clearances.find(
      (c) => c.asset_recovery_state === "MISSING",
    );
    assert.ok(blockedReturn);
    const located = await post(
      `/api/v1/offboarding-cases/${payload.data.id}/assets/${assetId}/commands/recovery-state`,
      "missing-located",
      {
        expected_clearance_version: blockedReturn.version,
        state: "PENDING_RETURN",
        reason:
          "Asset was located and is now available for the existing return request",
      },
    );
    assert.equal(located.status, 200);
    const retried = await post(
      `/api/v1/offboarding-cases/${payload.data.id}/commands/reconcile`,
      "missing-reconcile",
      { reason: "Asset located; request return" },
    );
    assert.equal(retried.status, 200);
    const after = (await retried.json()) as {
      data: {
        state: string;
        clearances: Array<{ state: string; asset_recovery_state: string }>;
      };
    };
    assert.equal(after.data.state, "IN_PROGRESS");
    assert.ok(
      after.data.clearances.some(
        (c) =>
          c.state === "PENDING" && c.asset_recovery_state === "PENDING_RETURN",
      ),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      api.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
