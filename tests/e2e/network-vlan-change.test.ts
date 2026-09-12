import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("controlled VLAN changes require approved implementation and record verification or rollback", async () => {
  const db = await testDatabase();
  const actorId = randomUUID();
  const policyId = randomUUID();
  const changes = [randomUUID(), randomUUID(), randomUUID()];
  await db.pool.query(
    "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,'tenant-a','NETWORK-CHANGE',1,'ACTIVE')",
    [policyId],
  );
  for (const [index, id] of changes.entries()) {
    await db.pool.query(
      "INSERT INTO problem.changes(id,tenant_id,code,title,state,risk,impact,implementation_plan) VALUES($1,'tenant-a',$2,$3,'IMPLEMENTING','HIGH','SERVICE','Approved implementation and rollback plan')",
      [id, `CHG-NET-${index}`, `VLAN change ${index}`],
    );
    await db.pool.query(
      "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state) VALUES($1,'tenant-a','CHANGE',$2,$3,1,$4,'APPROVED')",
      [randomUUID(), id, policyId, randomUUID()],
    );
  }

  let tenant = "tenant-a";
  let permitted = true;
  let sawHighRiskContext = false;
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return { id: actorId, tenant_id: tenant, actor_type: "USER" };
      },
    },
    {
      async evaluate(request) {
        sawHighRiskContext ||=
          request.context.mfa_required === true &&
          request.context.reauth_required === true;
        return {
          result: permitted ? "ALLOW" : "DENY",
          reason: "test policy",
        };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  const post = (path: string, key: string, body: object) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
  const create = (changeId: string, key: string) =>
    post("/api/v1/network/vlan-changes", key, {
      change_id: changeId,
      target_device: "SW-HN-01",
      target_port: "Gi1/0/7",
      previous_vlan: "20",
      desired_vlan: "30",
      reason: "Approved guest network migration",
      rollback_plan: "Restore VLAN 20 and verify endpoint connectivity",
    });
  try {
    const created = await create(changes[0]!, "create-vlan-one");
    assert.equal(
      created.status,
      201,
      JSON.stringify(await created.clone().json()),
    );
    const operation = ((await created.json()) as { data: { id: string } }).data;
    const replay = await create(changes[0]!, "create-vlan-one");
    assert.equal(replay.status, 201);
    assert.equal(
      ((await replay.json()) as { data: { id: string } }).data.id,
      operation.id,
    );
    const conflictCreate = await post(
      "/api/v1/network/vlan-changes",
      "create-vlan-one",
      {
        change_id: changes[0],
        target_device: "SW-HN-01",
        target_port: "Gi1/0/7",
        previous_vlan: "20",
        desired_vlan: "40",
        reason: "Changed request",
        rollback_plan: "Restore VLAN 20",
      },
    );
    assert.equal(conflictCreate.status, 409);

    permitted = false;
    const denied = await create(changes[1]!, "denied-create");
    assert.equal(denied.status, 403);
    permitted = true;

    tenant = "tenant-b";
    const isolated = await post(
      `/api/v1/network/vlan-changes/${operation.id}/commands/start`,
      "foreign-start",
      { expected_version: 1 },
    );
    assert.equal(isolated.status, 404);
    tenant = "tenant-a";

    const started = await post(
      `/api/v1/network/vlan-changes/${operation.id}/commands/start`,
      "start-vlan-one",
      { expected_version: 1 },
    );
    assert.equal(
      started.status,
      200,
      JSON.stringify(await started.clone().json()),
    );
    const staleStart = await post(
      `/api/v1/network/vlan-changes/${operation.id}/commands/start`,
      "stale-start",
      { expected_version: 1 },
    );
    assert.equal(staleStart.status, 409);
    const implementation = await post(
      `/api/v1/network/vlan-changes/${operation.id}/commands/record-implementation`,
      "implementation-vlan-one",
      {
        expected_version: 2,
        result: "APPLIED",
        reason: "Operator recorded the approved configuration action",
        evidence: { reference_id: "operator-log-17" },
      },
    );
    assert.equal(implementation.status, 200);
    const verification = await post(
      `/api/v1/network/vlan-changes/${operation.id}/commands/verify`,
      "verify-vlan-one",
      {
        expected_version: 3,
        observed_vlan: "31",
        technical_passed: true,
        service_passed: false,
        monitoring_passed: true,
        reason: "Service check failed after implementation",
        evidence: { reference_id: "connectivity-check-17" },
      },
    );
    assert.equal(verification.status, 200);
    assert.equal(
      ((await verification.json()) as { data: { state: string } }).data.state,
      "ROLLBACK_REQUIRED",
    );
    const rolledBack = await post(
      `/api/v1/network/vlan-changes/${operation.id}/commands/rollback`,
      "rollback-vlan-one",
      {
        expected_version: 4,
        trigger: "Post-change service verification failed",
        steps: ["restore VLAN 20", "verify connectivity"],
        restored_vlan: "20",
        verification_passed: true,
        reason: "Previous VLAN restored and checked",
        evidence: { reference_id: "rollback-check-17" },
      },
    );
    assert.equal(rolledBack.status, 200);
    assert.equal(
      ((await rolledBack.json()) as { data: { state: string } }).data.state,
      "ROLLED_BACK",
    );

    const second = await create(changes[1]!, "create-vlan-two");
    const secondId = ((await second.json()) as { data: { id: string } }).data
      .id;
    const secondStart = await post(
      `/api/v1/network/vlan-changes/${secondId}/commands/start`,
      "start-vlan-two",
      { expected_version: 1 },
    );
    assert.equal(secondStart.status, 200);
    await post(
      `/api/v1/network/vlan-changes/${secondId}/commands/record-implementation`,
      "implementation-vlan-two",
      {
        expected_version: 2,
        result: "APPLIED",
        reason: "Configuration action recorded",
        evidence: { reference_id: "operator-log-18" },
      },
    );
    const passed = await post(
      `/api/v1/network/vlan-changes/${secondId}/commands/verify`,
      "verify-vlan-two",
      {
        expected_version: 3,
        observed_vlan: "30",
        technical_passed: true,
        service_passed: true,
        monitoring_passed: true,
        reason: "All verification checks passed",
        evidence: { reference_id: "verification-18" },
      },
    );
    assert.equal(passed.status, 200);
    assert.equal(
      ((await passed.json()) as { data: { state: string } }).data.state,
      "COMPLETED",
    );
    assert.equal(sawHighRiskContext, true);

    const third = await create(changes[2]!, "create-vlan-three");
    const thirdId = ((await third.json()) as { data: { id: string } }).data.id;
    await post(
      `/api/v1/network/vlan-changes/${thirdId}/commands/start`,
      "start-vlan-three",
      { expected_version: 1 },
    );
    const failedImplementation = await post(
      `/api/v1/network/vlan-changes/${thirdId}/commands/record-implementation`,
      "implementation-vlan-three",
      {
        expected_version: 2,
        result: "FAILED",
        reason: "Operator reported a partial configuration failure",
        evidence: { reference_id: "operator-log-19" },
      },
    );
    assert.equal(failedImplementation.status, 200);
    const failedRollback = await post(
      `/api/v1/network/vlan-changes/${thirdId}/commands/rollback`,
      "rollback-vlan-three",
      {
        expected_version: 3,
        trigger: "Implementation failed and may be partial",
        steps: ["attempt restore VLAN 20"],
        restored_vlan: "99",
        verification_passed: false,
        reason: "Previous VLAN could not be verified",
        evidence: { reference_id: "rollback-check-19" },
      },
    );
    assert.equal(failedRollback.status, 200);
    assert.equal(
      ((await failedRollback.json()) as { data: { state: string } }).data.state,
      "FAILED",
    );

    const unapprovedChange = randomUUID();
    await db.pool.query(
      "INSERT INTO problem.changes(id,tenant_id,code,title,state) VALUES($1,'tenant-a','CHG-NET-UNAPPROVED','Unapproved VLAN change','IMPLEMENTING')",
      [unapprovedChange],
    );
    const unapprovedOp = await create(unapprovedChange, "unapproved-create");
    const unapprovedId = (
      (await unapprovedOp.json()) as { data: { id: string } }
    ).data.id;
    const unapprovedStart = await post(
      `/api/v1/network/vlan-changes/${unapprovedId}/commands/start`,
      "unapproved-start",
      { expected_version: 1 },
    );
    assert.equal(unapprovedStart.status, 422);

    const evidence = await db.pool.query(
      "SELECT phase FROM network.vlan_change_evidence WHERE tenant_id='tenant-a' ORDER BY created_at,id",
    );
    assert.deepEqual(
      evidence.rows.map((row) => row.phase),
      [
        "IMPLEMENTATION",
        "VERIFICATION",
        "ROLLBACK",
        "IMPLEMENTATION",
        "VERIFICATION",
        "IMPLEMENTATION",
        "ROLLBACK",
      ],
    );
    const effects = await db.pool.query(
      "SELECT event_type FROM platform.outbox_events WHERE tenant_id='tenant-a' AND aggregate_type='NETWORK_VLAN_CHANGE' ORDER BY created_at,event_id",
    );
    assert.equal(effects.rowCount, 14);
    await assert.rejects(
      db.pool.query(
        "INSERT INTO network.vlan_change_evidence(id,tenant_id,vlan_change_id,phase,actor_id,reason,evidence) VALUES($1,'tenant-b',$2,'ROLLBACK',$3,'Cross-tenant constraint test','{}'::jsonb)",
        [randomUUID(), operation.id, actorId],
      ),
      /foreign key constraint/i,
    );
    await assert.rejects(
      db.pool.query(
        "INSERT INTO network.vlan_changes(id,tenant_id,change_id,target_device,target_port,previous_vlan,desired_vlan,reason,rollback_plan) VALUES($1,'tenant-a',$2,'SW-HN-01','Gi1/0/8','20','20','invalid state','restore previous VLAN')",
        [randomUUID(), randomUUID()],
      ),
      /check constraint/i,
    );
  } finally {
    server.close();
    await db.close();
  }
});
