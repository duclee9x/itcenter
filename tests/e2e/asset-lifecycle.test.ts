import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { agentServer } from "../../apps/agent-gateway/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";
const config = loadConfig({
  DATABASE_SECRET_REF: "env:TEST",
  APP_ENV: "test",
  LOG_LEVEL: "error",
});
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("replacement candidate is tenant-bound, versioned, auditable and idempotent", async () => {
  const db = await testDatabase();
  const { randomUUID } = await import("node:crypto");
  const actorId = randomUUID(),
    categoryId = randomUUID(),
    modelId = randomUUID(),
    assetId = randomUUID();
  await db.pool.query(
    "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,'tenant-a','REPL-A','replacement-actor','Replacement Actor','ACTIVE')",
    [actorId],
  );
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,'tenant-a','Replacement Laptop')",
    [categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,'tenant-a','Vendor','Replacement Model',$2)",
    [modelId, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state) VALUES($1,'tenant-a','AST-REPL',$2,'AVAILABLE')",
    [assetId, modelId],
  );
  const server = apiServer(
    config,
    async () => true,
    {
      async authenticate() {
        return { id: actorId, tenant_id: "tenant-a", actor_type: "USER" };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW", reason: "test policy" };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  try {
    const command = {
      asset_id: assetId,
      score: 71,
      reasons: ["Repair frequency"],
      assessment: { repair_count: 3, evidence_ref: "maintenance-report-1" },
      reason: "Repeated hardware faults",
      migration_required: true,
    };
    const send = (body: object) =>
      fetch(`${url}/api/v1/replacements`, {
        method: "POST",
        headers: {
          authorization: "Bearer verified",
          "content-type": "application/json",
          "idempotency-key": "replacement-create",
        },
        body: JSON.stringify(body),
      });
    const createdResponse = await send(command);
    assert.equal(createdResponse.status, 201);
    const created = (
      (await createdResponse.json()) as {
        data: { id: string; state: string; version: number };
      }
    ).data;
    assert.equal(created.state, "UNDER_REVIEW");
    assert.equal(created.version, 1);
    const replay = await send(command);
    assert.equal(replay.status, 201);
    assert.deepEqual(
      ((await replay.json()) as { data: unknown }).data,
      created,
    );
    assert.equal((await send({ ...command, score: 72 })).status, 409);
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT state,version FROM asset.replacement_plans WHERE id=$1",
          [created.id],
        )
      ).rows[0],
      { state: "UNDER_REVIEW", version: 1 },
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM asset.replacement_history WHERE plan_id=$1",
          [created.id],
        )
      ).rows[0]!.n,
      1,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM platform.outbox_events WHERE aggregate_id=$1 AND event_type='REPLACEMENT.CANDIDATE_CREATED'",
          [created.id],
        )
      ).rows[0]!.n,
      1,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM operations.work_items WHERE tenant_id='tenant-a' AND source_type='ASSET_LIFECYCLE' AND source_id=$1 AND state='NEW'",
          [created.id],
        )
      ).rows[0]!.n,
      1,
    );
  } finally {
    await close(server);
    await db.close();
  }
});

test("replacement cutover assigns the ready asset only after explicit verified migration", async () => {
  const db = await testDatabase();
  const { randomUUID } = await import("node:crypto");
  const actorId = randomUUID(),
    approverId = randomUUID(),
    targetId = randomUUID(),
    categoryId = randomUUID(),
    modelId = randomUUID(),
    oldAssetId = randomUUID(),
    newAssetId = randomUUID(),
    policyId = randomUUID();
  await db.pool.query(
    "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,'tenant-a','MIG-A','migration-actor','Migration Actor','ACTIVE'),($2,'tenant-a','MIG-B','migration-approver','Migration Approver','ACTIVE'),($3,'tenant-a','MIG-C','migration-user','Migration User','ACTIVE')",
    [actorId, approverId, targetId],
  );
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,'tenant-a','Migration Laptop')",
    [categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,'tenant-a','Vendor','Migration Model',$2)",
    [modelId, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state,assignment_state) VALUES($1,'tenant-a','AST-MIG-OLD',$2,'IN_USE','ASSIGNED'),($3,'tenant-a','AST-MIG-NEW',$2,'AVAILABLE','UNASSIGNED')",
    [oldAssetId, modelId, newAssetId],
  );
  await db.pool.query(
    "INSERT INTO asset.assignments(id,tenant_id,asset_id,user_id,reason) VALUES($1,'tenant-a',$2,$3,'Old asset remains in service during migration')",
    [randomUUID(), oldAssetId, targetId],
  );
  const server = apiServer(
    config,
    async () => true,
    {
      async authenticate() {
        return { id: actorId, tenant_id: "tenant-a", actor_type: "USER" };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW", reason: "test policy" };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  const command = (path: string, key: string, body: object) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer verified",
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
  try {
    const candidateRes = await command(
      "/api/v1/replacements",
      "replace-create",
      {
        asset_id: oldAssetId,
        reasons: ["End of support"],
        assessment: { support_end_date: "2026-01-01" },
        target_user_id: targetId,
        target_model: "Migration Model",
        reason: "Approved replacement",
      },
    );
    assert.equal(candidateRes.status, 201);
    const candidate = ((await candidateRes.json()) as { data: { id: string } })
      .data;
    await db.pool.query(
      "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,'tenant-a','replacement',1,'ACTIVE')",
      [policyId],
    );
    const approvalId = randomUUID();
    await db.pool.query(
      "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state,context) VALUES($1,'tenant-a','REPLACEMENT',$2,$3,1,$4,'APPROVED',$5)",
      [
        approvalId,
        candidate.id,
        policyId,
        actorId,
        JSON.stringify({
          decision: "APPROVE_REPLACEMENT",
          replacement_plan_id: candidate.id,
        }),
      ],
    );
    await db.pool.query(
      "INSERT INTO control.approval_decisions(id,tenant_id,request_id,actor_id,decision,reason) VALUES($1,'tenant-a',$2,$3,'APPROVED','Independent replacement review')",
      [randomUUID(), approvalId, approverId],
    );
    const review = await command(
      `/api/v1/replacements/${candidate.id}/commands/review`,
      "replace-review",
      {
        expected_version: 1,
        decision: "APPROVE_REPLACEMENT",
        approval_id: approvalId,
        reason: "Business approval",
      },
    );
    assert.equal(review.status, 200);
    assert.equal(
      (
        await command(
          `/api/v1/replacements/${candidate.id}/commands/plan`,
          "replace-plan",
          {
            expected_version: 2,
            target_user_id: targetId,
            target_model: "Migration Model",
            reason: "Plan ready",
          },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await command(
          `/api/v1/replacements/${candidate.id}/commands/mark-new-asset-ready`,
          "replace-ready",
          {
            expected_version: 3,
            new_asset_id: newAssetId,
            reason: "Preparation verified",
          },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await command(
          `/api/v1/replacements/${candidate.id}/commands/start-migration`,
          "replace-start",
          { expected_version: 4, reason: "Begin data migration" },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await command(
          `/api/v1/replacements/${candidate.id}/commands/complete-migration`,
          "replace-complete",
          {
            expected_version: 5,
            verified: true,
            readiness: {
              software: true,
              license: true,
              network: true,
              user: true,
            },
            verification_evidence_id: "cutover-check-1",
            reason: "User verified cutover",
          },
        )
      ).status,
      200,
    );
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT lifecycle_state,assignment_state FROM asset.assets WHERE tenant_id='tenant-a' AND id=$1",
          [oldAssetId],
        )
      ).rows[0],
      { lifecycle_state: "IN_USE", assignment_state: "ASSIGNED" },
    );
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT lifecycle_state,assignment_state FROM asset.assets WHERE tenant_id='tenant-a' AND id=$1",
          [newAssetId],
        )
      ).rows[0],
      { lifecycle_state: "ASSIGNED", assignment_state: "ASSIGNED" },
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM asset.assignments WHERE tenant_id='tenant-a' AND asset_id=$1 AND user_id=$2 AND status='ACTIVE'",
          [newAssetId, targetId],
        )
      ).rows[0]!.n,
      1,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM platform.outbox_events WHERE event_type='REPLACEMENT.COMPLETED' AND aggregate_id=$1",
          [candidate.id],
        )
      ).rows[0]!.n,
      1,
    );
  } finally {
    await close(server);
    await db.close();
  }
});

test("retirement requires separate approved evidence and persists retirement history", async () => {
  const db = await testDatabase();
  const { randomUUID } = await import("node:crypto");
  const actorId = randomUUID(),
    approverId = randomUUID(),
    categoryId = randomUUID(),
    modelId = randomUUID(),
    locationId = randomUUID(),
    assetId = randomUUID(),
    assignmentId = randomUUID(),
    policyId = randomUUID();
  await db.pool.query(
    "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,'tenant-a','RET-A','retire-actor','Retire Actor','ACTIVE'),($2,'tenant-a','RET-B','retire-approver','Retire Approver','ACTIVE')",
    [actorId, approverId],
  );
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,'tenant-a','Retirement Laptop')",
    [categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,'tenant-a','RET-ROOM','Retirement Return Room','ROOM')",
    [locationId],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,'tenant-a','Vendor','Retirement Model',$2)",
    [modelId, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state,assignment_state) VALUES($1,'tenant-a','AST-RET',$2,'IN_USE','ASSIGNED')",
    [assetId, modelId],
  );
  await db.pool.query(
    "INSERT INTO asset.assignments(id,tenant_id,asset_id,user_id,reason) VALUES($1,'tenant-a',$2,$3,'Awaiting return before retirement')",
    [assignmentId, assetId, actorId],
  );
  const server = apiServer(
    config,
    async () => true,
    {
      async authenticate() {
        return { id: actorId, tenant_id: "tenant-a", actor_type: "USER" };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW", reason: "test policy" };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  try {
    const candidateResponse = await fetch(
      `${url}/api/v1/assets/${assetId}/retirement-candidates`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified",
          "content-type": "application/json",
          "idempotency-key": "retirement-candidate",
        },
        body: JSON.stringify({ reason: "End of service" }),
      },
    );
    assert.equal(candidateResponse.status, 201);
    const candidate = (
      (await candidateResponse.json()) as {
        data: { id: string; state: string; blockers: string[] };
      }
    ).data;
    assert.equal(candidate.state, "BLOCKED");
    assert.deepEqual(candidate.blockers, ["ACTIVE_ASSIGNMENT_OR_LOAN"]);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM operations.work_items WHERE tenant_id='tenant-a' AND source_type='ASSET_LIFECYCLE' AND source_id=$1 AND state='NEW'",
          [candidate.id],
        )
      ).rows[0]!.n,
      1,
    );
    await db.pool.query(
      "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,'tenant-a','asset-retirement',1,'ACTIVE')",
      [policyId],
    );
    const approvalId = randomUUID();
    const clearances = {
      legal_hold: "legal-case-clearance-1",
      retention: "retention-clearance-1",
      financial: "finance-clearance-1",
      incident: "incident-clearance-1",
    };
    await db.pool.query(
      "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state,context) VALUES($1,'tenant-a','ASSET_RETIREMENT',$2,$3,1,$4,'APPROVED',$5)",
      [
        approvalId,
        candidate.id,
        policyId,
        actorId,
        JSON.stringify({ asset_id: assetId, clearances }),
      ],
    );
    await db.pool.query(
      "INSERT INTO control.approval_decisions(id,tenant_id,request_id,actor_id,decision,reason) VALUES($1,'tenant-a',$2,$3,'APPROVED','Independent retirement approval')",
      [randomUUID(), approvalId, approverId],
    );
    const incompleteApprovalId = randomUUID();
    await db.pool.query(
      "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state,context) VALUES($1,'tenant-a','ASSET_RETIREMENT',$2,$3,1,$4,'APPROVED',$5)",
      [
        incompleteApprovalId,
        candidate.id,
        policyId,
        actorId,
        JSON.stringify({ asset_id: assetId, clearances: {} }),
      ],
    );
    await db.pool.query(
      "INSERT INTO control.approval_decisions(id,tenant_id,request_id,actor_id,decision,reason) VALUES($1,'tenant-a',$2,$3,'APPROVED','Approval did not clear required items')",
      [randomUUID(), incompleteApprovalId, approverId],
    );
    const blocked = await fetch(
      `${url}/api/v1/assets/${assetId}/commands/retire`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified",
          "content-type": "application/json",
          "idempotency-key": "retirement-blocked",
        },
        body: JSON.stringify({
          retirement_record_id: candidate.id,
          approval_id: incompleteApprovalId,
          expected_version: 1,
          retirement_expected_version: 1,
          reason: "Clearance review",
        }),
      },
    );
    assert.equal(blocked.status, 409);
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT state,version FROM asset.retirement_records WHERE tenant_id='tenant-a' AND id=$1",
          [candidate.id],
        )
      ).rows[0],
      { state: "BLOCKED", version: 2 },
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT lifecycle_state FROM asset.assets WHERE tenant_id='tenant-a' AND id=$1",
          [assetId],
        )
      ).rows[0]!.lifecycle_state,
      "IN_USE",
    );
    const requestReturn = await fetch(
      `${url}/api/v1/assets/${assetId}/commands/request-return`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified",
          "content-type": "application/json",
          "idempotency-key": "retirement-return-request",
        },
        body: JSON.stringify({
          expected_version: 1,
          due_at: new Date(Date.now() + 86400000).toISOString(),
          reason: "Return device before retirement",
        }),
      },
    );
    assert.equal(requestReturn.status, 201);
    const returnRequestId = (
      (await requestReturn.json()) as {
        data: { return_request_id: string };
      }
    ).data.return_request_id;
    const receiveReturn = await fetch(
      `${url}/api/v1/assets/${assetId}/commands/receive-return`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified",
          "content-type": "application/json",
          "idempotency-key": "retirement-return-receive",
        },
        body: JSON.stringify({
          expected_version: 2,
          return_request_id: returnRequestId,
          received_location_id: locationId,
          condition_grade: "B",
          notes: "Physical return received for retirement",
        }),
      },
    );
    assert.equal(receiveReturn.status, 201);
    const retiredResponse = await fetch(
      `${url}/api/v1/assets/${assetId}/commands/retire`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified",
          "content-type": "application/json",
          "idempotency-key": "retirement-command",
        },
        body: JSON.stringify({
          retirement_record_id: candidate.id,
          approval_id: approvalId,
          expected_version: 3,
          retirement_expected_version: 2,
          reason: "Approved end-of-service retirement",
          clearances,
        }),
      },
    );
    assert.equal(retiredResponse.status, 200);
    assert.equal(
      (
        await db.pool.query(
          "SELECT lifecycle_state,version FROM asset.assets WHERE tenant_id='tenant-a' AND id=$1",
          [assetId],
        )
      ).rows[0]!.lifecycle_state,
      "RETIRED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT state,approval_id FROM asset.retirement_records WHERE tenant_id='tenant-a' AND id=$1",
          [candidate.id],
        )
      ).rows[0]!.state,
      "RETIRED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM platform.outbox_events WHERE aggregate_id=$1 AND event_type='ASSET.RETIRED'",
          [assetId],
        )
      ).rows[0]!.n,
      1,
    );
  } finally {
    await close(server);
    await db.close();
  }
});

test("wipe agent claim is capability-scoped and a failed report is durable/idempotent", async () => {
  const db = await testDatabase();
  const { randomUUID } = await import("node:crypto");
  const agentId = randomUUID(),
    categoryId = randomUUID(),
    modelId = randomUUID(),
    assetId = randomUUID(),
    retirementId = randomUUID(),
    jobId = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,'tenant-a','Wipe Laptop')",
    [categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,'tenant-a','Vendor','Wipe Model',$2)",
    [modelId, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state) VALUES($1,'tenant-a','AST-WIPE',$2,'RETIRED')",
    [assetId, modelId],
  );
  await db.pool.query(
    "INSERT INTO asset.retirement_records(id,tenant_id,asset_id,state,reason,created_by) VALUES($1,'tenant-a',$2,'RETIRED','Retired','operator')",
    [retirementId, assetId],
  );
  await db.pool.query(
    "INSERT INTO agent.agents(id,tenant_id,asset_id,agent_version,status,last_seen_at) VALUES($1,'tenant-a',$2,'test','ONLINE',now())",
    [agentId, assetId],
  );
  await db.pool.query(
    "INSERT INTO asset.data_wipe_jobs(id,tenant_id,asset_id,retirement_id,agent_id,state,method,generation,approval_id,created_by,reason) VALUES($1,'tenant-a',$2,$3,$4,'QUEUED','NIST_CLEAR',1,$5,'operator','approved wipe')",
    [jobId, assetId, retirementId, agentId, randomUUID()],
  );
  await db.pool.query(
    "INSERT INTO platform.operations(operation_id,tenant_id,type,target_type,target_id,state,correlation_id) VALUES($1,'tenant-a','DATA_WIPE','ASSET',$2,'QUEUED','wipe-test')",
    [jobId, assetId],
  );
  const server = agentServer(
    config,
    async () => true,
    {
      async authenticate() {
        return { id: agentId, tenant_id: "tenant-a", actor_type: "AGENT" };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  try {
    const claim = await fetch(`${url}/api/v1/agent/data-wipes/claim`, {
      method: "POST",
      headers: {
        authorization: "Bearer enrolled-agent",
        "content-type": "application/json",
        "idempotency-key": "claim-unsupported",
      },
      body: JSON.stringify({ supported_methods: ["CRYPTOGRAPHIC_ERASE"] }),
    });
    assert.equal(claim.status, 204);
    const supportedClaim = await fetch(`${url}/api/v1/agent/data-wipes/claim`, {
      method: "POST",
      headers: {
        authorization: "Bearer enrolled-agent",
        "content-type": "application/json",
        "idempotency-key": "claim-supported",
      },
      body: JSON.stringify({ supported_methods: ["NIST_CLEAR"] }),
    });
    assert.equal(supportedClaim.status, 200);
    const command = {
      expected_version: 2,
      result: "FAIL",
      error_code: "WIPE_FAILED",
      reason: "Device reported failure",
    };
    const report = () =>
      fetch(`${url}/api/v1/agent/data-wipes/${jobId}/commands/report`, {
        method: "POST",
        headers: {
          authorization: "Bearer enrolled-agent",
          "content-type": "application/json",
          "idempotency-key": "wipe-report",
        },
        body: JSON.stringify(command),
      });
    assert.equal((await report()).status, 200);
    assert.equal((await report()).status, 200);
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT state,result,version FROM asset.data_wipe_jobs WHERE tenant_id='tenant-a' AND id=$1",
          [jobId],
        )
      ).rows[0],
      { state: "FAILED", result: "FAIL", version: 3 },
    );
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT state,error_code,version FROM platform.operations WHERE tenant_id='tenant-a' AND operation_id=$1",
          [jobId],
        )
      ).rows[0],
      { state: "FAILED", error_code: "WIPE_FAILED", version: 3 },
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM platform.outbox_events WHERE aggregate_id=$1 AND event_type='DATA_WIPE.FAILED'",
          [jobId],
        )
      ).rows[0]!.n,
      1,
    );
  } finally {
    await close(server);
    await db.close();
  }
});

test("approved wipe evidence gates disposal and finalizes the Asset only after handover", async () => {
  const db = await testDatabase();
  const { randomUUID } = await import("node:crypto");
  const actorId = randomUUID(),
    approverId = randomUUID(),
    agentId = randomUUID(),
    categoryId = randomUUID(),
    modelId = randomUUID(),
    assetId = randomUUID(),
    retirementId = randomUUID(),
    policyId = randomUUID();
  const checksum = "a".repeat(64);
  await db.pool.query(
    "INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status) VALUES($1,'tenant-a','DSP-A','dispose-actor','Dispose Actor','ACTIVE'),($2,'tenant-a','DSP-B','dispose-approver','Dispose Approver','ACTIVE')",
    [actorId, approverId],
  );
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,'tenant-a','Disposal Laptop')",
    [categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,'tenant-a','Vendor','Disposal Model',$2)",
    [modelId, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state) VALUES($1,'tenant-a','AST-DISPOSE',$2,'RETIRED')",
    [assetId, modelId],
  );
  await db.pool.query(
    "INSERT INTO asset.retirement_records(id,tenant_id,asset_id,state,approval_id,clearances,reason,created_by) VALUES($1,'tenant-a',$2,'RETIRED',$3,'{}','Retired','operator')",
    [retirementId, assetId, randomUUID()],
  );
  await db.pool.query(
    "INSERT INTO agent.agents(id,tenant_id,asset_id,agent_version,status,last_seen_at) VALUES($1,'tenant-a',$2,'test','ONLINE',now())",
    [agentId, assetId],
  );
  await db.pool.query(
    "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,'tenant-a','lifecycle',1,'ACTIVE')",
    [policyId],
  );
  let currentActorId = actorId;
  const authenticated = {
    async authenticate() {
      return {
        id: currentActorId,
        tenant_id: "tenant-a",
        actor_type: "USER",
        auth_time: Math.floor(Date.now() / 1000),
        acr: config.networkChangeRequiredAcr,
        amr: ["mfa"],
      };
    },
  };
  const authz = {
    async evaluate() {
      return { result: "ALLOW" as const, reason: "test policy" };
    },
  };
  const api = apiServer(config, async () => true, authenticated, authz, db.uow);
  const apiUrl = await listen(api);
  let agent: Server | null = null;
  try {
    const command = (path: string, key: string, value: object) =>
      fetch(`${apiUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: "Bearer verified",
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify(value),
      });
    const wipeApprovalResponse = await command(
      "/api/v1/approvals",
      "wipe-approval-create",
      {
        source_type: "DATA_WIPE",
        source_id: retirementId,
        policy_id: policyId,
        policy_version: 1,
        context: {
          asset_id: assetId,
          retirement_record_id: retirementId,
          method: "NIST_CLEAR",
        },
      },
    );
    assert.equal(wipeApprovalResponse.status, 201);
    const wipeApproval = (
      (await wipeApprovalResponse.json()) as { data: { id: string } }
    ).data;
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM communication.notifications WHERE tenant_id='tenant-a' AND recipient_user_id=$1 AND event_type='APPROVAL.CREATED'",
          [approverId],
        )
      ).rows[0]!.n,
      1,
    );
    currentActorId = approverId;
    assert.equal(
      (
        await command(
          `/api/v1/approvals/${wipeApproval.id}/commands/approve`,
          "wipe-approval-decide",
          { expected_version: 1, reason: "Wipe evidence policy approved" },
        )
      ).status,
      200,
    );
    currentActorId = actorId;
    const wipeResponse = await command(
      `/api/v1/assets/${assetId}/commands/wipe`,
      "wipe-start",
      {
        expected_version: 1,
        retirement_record_id: retirementId,
        approval_id: wipeApproval.id,
        method: "NIST_CLEAR",
        reason: "Approved secure wipe",
      },
    );
    assert.equal(wipeResponse.status, 202, await wipeResponse.clone().text());
    const job = (
      (await wipeResponse.json()) as { data: { data_wipe_job_id: string } }
    ).data;
    agent = agentServer(
      config,
      async () => true,
      {
        async authenticate() {
          return { id: agentId, tenant_id: "tenant-a", actor_type: "AGENT" };
        },
      },
      db.uow,
      undefined,
      {
        async inspect() {
          return {
            checksumSha256: checksum,
            sizeBytes: 12,
            mediaType: "application/json",
          };
        },
      },
    );
    const agentUrl = await listen(agent);
    const claim = await fetch(`${agentUrl}/api/v1/agent/data-wipes/claim`, {
      method: "POST",
      headers: {
        authorization: "Bearer enrolled-agent",
        "content-type": "application/json",
        "idempotency-key": "wipe-claim",
      },
      body: JSON.stringify({ supported_methods: ["NIST_CLEAR"] }),
    });
    assert.equal(claim.status, 200);
    const claimed = ((await claim.json()) as { data: { version: number } })
      .data;
    const report = await fetch(
      `${agentUrl}/api/v1/agent/data-wipes/${job.data_wipe_job_id}/commands/report`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer enrolled-agent",
          "content-type": "application/json",
          "idempotency-key": "wipe-pass",
        },
        body: JSON.stringify({
          expected_version: claimed.version,
          result: "PASS",
          verification_result: "VERIFIED",
          evidence_document_id: "wipe-certificate-01",
          evidence_storage_ref: "artifact://tenant-a/wipe-01",
          evidence_checksum: checksum,
          reason: "Wipe verified",
        }),
      },
    );
    assert.equal(report.status, 200);
    const cleanup = {
      access: "access-revocation-clearance-01",
      agent: "agent-retirement-clearance-01",
    };
    const disposalApprovalResponse = await command(
      "/api/v1/approvals",
      "disposal-approval-create",
      {
        source_type: "ASSET_DISPOSAL",
        source_id: retirementId,
        policy_id: policyId,
        policy_version: 1,
        context: {
          asset_id: assetId,
          retirement_record_id: retirementId,
          method: "RECYCLE",
          cleanup_clearances: cleanup,
        },
      },
    );
    assert.equal(disposalApprovalResponse.status, 201);
    const disposalApproval = (
      (await disposalApprovalResponse.json()) as { data: { id: string } }
    ).data;
    currentActorId = approverId;
    assert.equal(
      (
        await command(
          `/api/v1/approvals/${disposalApproval.id}/commands/approve`,
          "disposal-approval-decide",
          { expected_version: 1, reason: "Physical handover approved" },
        )
      ).status,
      200,
    );
    currentActorId = actorId;
    const disposed = await command(
      `/api/v1/assets/${assetId}/commands/dispose`,
      "disposal-finalize",
      {
        expected_version: 1,
        retirement_record_id: retirementId,
        approval_id: disposalApproval.id,
        method: "RECYCLE",
        cleanup_clearances: cleanup,
        physical_disposition_confirmed: true,
        physical_evidence_id: "recycler-certificate-01",
        physical_evidence_checksum: checksum,
        reason: "Recycler handover confirmed",
      },
    );
    assert.equal(disposed.status, 200);
    assert.equal(
      (
        await db.pool.query(
          "SELECT lifecycle_state,version FROM asset.assets WHERE tenant_id='tenant-a' AND id=$1",
          [assetId],
        )
      ).rows[0]!.lifecycle_state,
      "DISPOSED",
    );
    assert.equal(
      (
        await command(
          `/api/v1/assets/${assetId}/commands/reactivate`,
          "disposed-reactivation-denied",
          {
            expected_version: 2,
            reconditioning_evidence_id: "must-not-reactivate",
            reconditioning_evidence_checksum: checksum,
            reason: "Disposed assets are terminal",
          },
        )
      ).status,
      422,
    );
    const reuseAssetId = randomUUID();
    const reuseRetirementId = randomUUID();
    await db.pool.query(
      "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state) VALUES($1,'tenant-a','AST-REUSE',$2,'RETIRED')",
      [reuseAssetId, modelId],
    );
    await db.pool.query(
      "INSERT INTO asset.retirement_records(id,tenant_id,asset_id,state,approval_id,reason,created_by) VALUES($1,'tenant-a',$2,'RETIRED',$3,'Approved for internal reuse','operator')",
      [reuseRetirementId, reuseAssetId, randomUUID()],
    );
    await db.pool.query(
      "INSERT INTO asset.data_wipe_jobs(id,tenant_id,asset_id,retirement_id,agent_id,state,method,generation,approval_id,completed_at,result,verification_result,evidence_document_id,evidence_checksum,created_by,reason) VALUES($1,'tenant-a',$2,$3,$4,'COMPLETED','NIST_CLEAR',1,$5,now(),'PASS','VERIFIED','reuse-wipe-certificate',$6,'operator','Verified reuse wipe')",
      [
        randomUUID(),
        reuseAssetId,
        reuseRetirementId,
        agentId,
        randomUUID(),
        checksum,
      ],
    );
    const reuseApprovalId = randomUUID();
    await db.pool.query(
      "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state,context) VALUES($1,'tenant-a','ASSET_DISPOSAL',$2,$3,1,$4,'APPROVED',$5)",
      [
        reuseApprovalId,
        reuseRetirementId,
        policyId,
        actorId,
        JSON.stringify({
          asset_id: reuseAssetId,
          retirement_record_id: reuseRetirementId,
          method: "REUSE_INTERNAL",
          cleanup_clearances: cleanup,
        }),
      ],
    );
    await db.pool.query(
      "INSERT INTO control.approval_decisions(id,tenant_id,request_id,actor_id,decision,reason) VALUES($1,'tenant-a',$2,$3,'APPROVED','Internal reuse approved')",
      [randomUUID(), reuseApprovalId, approverId],
    );
    const reused = await command(
      `/api/v1/assets/${reuseAssetId}/commands/dispose`,
      "internal-reuse-decision",
      {
        expected_version: 1,
        retirement_record_id: reuseRetirementId,
        approval_id: reuseApprovalId,
        method: "REUSE_INTERNAL",
        cleanup_clearances: cleanup,
        reason: "Approved internal reuse",
      },
    );
    assert.equal(reused.status, 200, await reused.clone().text());
    const reactivated = await command(
      `/api/v1/assets/${reuseAssetId}/commands/reactivate`,
      "internal-reuse-reactivation",
      {
        expected_version: 1,
        reconditioning_evidence_id: "reconditioning-record-01",
        reconditioning_evidence_checksum: checksum,
        reason: "Reconditioned for internal use",
      },
    );
    assert.equal(reactivated.status, 200, await reactivated.clone().text());
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT lifecycle_state,assignment_state,version FROM asset.assets WHERE tenant_id='tenant-a' AND id=$1",
          [reuseAssetId],
        )
      ).rows[0],
      {
        lifecycle_state: "AVAILABLE",
        assignment_state: "UNASSIGNED",
        version: 2,
      },
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM platform.outbox_events WHERE tenant_id='tenant-a' AND aggregate_id=$1 AND event_type='ASSET.REACTIVATED'",
          [reuseAssetId],
        )
      ).rows[0]!.n,
      1,
    );
    for (const eventType of [
      "DATA_WIPE.COMPLETED",
      "DISPOSAL.APPROVED",
      "DISPOSAL.COMPLETED",
      "ASSET.DISPOSED",
    ])
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*)::int AS n FROM platform.outbox_events WHERE tenant_id='tenant-a' AND event_type=$1",
            [eventType],
          )
        ).rows[0]!.n,
        ["DISPOSAL.APPROVED", "DISPOSAL.COMPLETED"].includes(eventType) ? 2 : 1,
        eventType,
      );
  } finally {
    if (agent) await close(agent);
    await close(api);
    await db.close();
  }
});
