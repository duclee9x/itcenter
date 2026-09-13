import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { agentServer } from "../../apps/agent-gateway/src/server.js";
import { applyAutomationExecutionEvent } from "../../apps/worker/src/automation-executions.js";
import { markExpiredExecutionsUnknown } from "../../modules/automation/index.js";
import {
  permissions as identityPermissions,
  seedPermissions,
} from "../../modules/identity/index.js";
import { testDatabase } from "../helpers.js";
import { loadConfig } from "../../packages/config/src/index.js";
import type { EventEnvelope } from "../../packages/event-contracts/src/index.js";

const tenant = "task091-e2e";
const actorId = randomUUID();
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

async function fixture(db: Awaited<ReturnType<typeof testDatabase>>) {
  const ids = {
    site: randomUUID(),
    category: randomUUID(),
    model: randomUUID(),
    asset: randomUUID(),
    agent: randomUUID(),
    automationPrincipal: randomUUID(),
    role: randomUUID(),
    policy: randomUUID(),
  };
  const now = new Date().toISOString();
  await db.uow.run(tenant, async (tx) => {
    await seedPermissions(tx, identityPermissions);
    await tx.query(
      "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,$2,$3,'TASK091 Site','SITE')",
      [ids.site, tenant, `S-${ids.site.slice(0, 8)}`],
    );
    await tx.query(
      "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'TASK091')",
      [ids.category, tenant],
    );
    await tx.query(
      "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Test','Agent Host',$3)",
      [ids.model, tenant, ids.category],
    );
    await tx.query(
      "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,current_location_id) VALUES($1,$2,$3,$4,$5)",
      [ids.asset, tenant, `A-${ids.asset.slice(0, 8)}`, ids.model, ids.site],
    );
    await tx.query(
      "INSERT INTO agent.agents(id,tenant_id,asset_id,agent_version,status,last_seen_at,agent_runtime_id,agent_session_id) VALUES($1,$2,$3,'test','ONLINE',$4,$5,$6)",
      [
        ids.agent,
        tenant,
        ids.asset,
        now,
        randomUUID(),
        `session-${randomUUID()}`,
      ],
    );
    await tx.query(
      "INSERT INTO identity.automation_principals(id,tenant_id,service_identity,created_by) VALUES($1,$2,'itcenter.task090.automation',$3)",
      [ids.automationPrincipal, tenant, actorId],
    );
    await tx.query(
      "INSERT INTO identity.roles(id,tenant_id,code,name,type,status) VALUES($1,$2,'TASK091_AUTOMATION','Task091','CUSTOM','ACTIVE')",
      [ids.role, tenant],
    );
    await tx.query(
      "INSERT INTO identity.role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM identity.permissions WHERE code='agent.restart'",
      [tenant, ids.role],
    );
    await tx.query(
      "INSERT INTO identity.role_bindings(id,tenant_id,principal_type,principal_id,role_id,scope_type,scope_id,source,valid_from,reason,created_by) VALUES($1,$2,'SYSTEM_AUTOMATION',$3,$4,'SITE',$5,'TASK091_TEST',now()-interval '1 minute','explicit test grant',$6)",
      [
        randomUUID(),
        tenant,
        ids.automationPrincipal,
        ids.role,
        ids.site,
        actorId,
      ],
    );
    await tx.query(
      `INSERT INTO automation.action_policies(id,tenant_id,action_type,target_type,version,state,mode,resource_scope_json,parameter_constraints_json,approval_required,effective_from,content_hash,created_by,changed_by,reason,activated_at)
      VALUES($1,$2,'RESTART_AGENT','AGENT',1,'ACTIVE','ALLOW',$3::jsonb,'{}',false,now()-interval '1 minute','task091',$4,$4,'explicit test policy',now())`,
      [ids.policy, tenant, JSON.stringify({ site: ids.site }), actorId],
    );
  });
  return ids;
}

async function readyIntent(
  db: Awaited<ReturnType<typeof testDatabase>>,
  ids: Awaited<ReturnType<typeof fixture>>,
) {
  const id = randomUUID(),
    sourceEventId = randomUUID(),
    correlationId = randomUUID();
  await db.uow.run(tenant, async (tx) => {
    await tx.query(
      `INSERT INTO automation.action_intents(
      id,tenant_id,source_event_id,target_type,target_id,action_domain,action_type,normalized_parameters_json,
      policy_decision,approval_context_hash,deduplication_key,conflict_scope_key,exclusivity_group,desired_state,state,
      reason_code,correlation_id,capability_id,capability_version,policy_id,policy_version,principal_id,required_permission,
      authorization_scope_reference,authorization_decision,approval_requirement,approval_result,kill_switch_result,conflict_result,decision_evidence_json)
      VALUES($1,$2,$3,'AGENT',$4,'agent','RESTART_AGENT','{}','ALLOW','test-context',$5,$6,'AGENT_SERVICE_CONTROL',NULL,'READY',
        'POLICY_GATE',$7,'09000000-0000-4000-8000-000000000001',1,$8,1,$9,'agent.restart',$10,'ALLOW','NOT_REQUIRED','NOT_REQUIRED','ALLOW','CLEAR',$11::jsonb)`,
      [
        id,
        tenant,
        sourceEventId,
        ids.agent,
        `dedupe:${id}`,
        `scope:${id}`,
        correlationId,
        ids.policy,
        ids.automationPrincipal,
        `SITE:${ids.site}`,
        JSON.stringify({
          safety_level: "SAFE",
          requires_approval: false,
          capability: { conflict_group: "AGENT_SERVICE_CONTROL" },
        }),
      ],
    );
  });
  const event: EventEnvelope = {
    event_id: randomUUID(),
    event_type: "AUTOMATION.INTENT_READY",
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
    producer: { service: "test", instance: "e2e" },
    aggregate: { type: "ACTION_INTENT", id, version: 1 },
    actor: { type: "AUTOMATION", id: null },
    correlation_id: correlationId,
    causation_id: sourceEventId,
    tenant_id: tenant,
    organization_id: tenant,
    idempotency_key: `ready:${id}`,
    payload: { intent_id: id, intent_state: "READY" },
  };
  await applyAutomationExecutionEvent(db.uow, event);
  const execution = await db.pool.query<{
    id: string;
    command_id: string;
    state: string;
    entity_version: number;
  }>(
    "SELECT id,command_id,state,entity_version FROM automation.action_executions WHERE tenant_id=$1 AND intent_id=$2",
    [tenant, id],
  );
  assert.equal(execution.rowCount, 1);
  return {
    intentId: id,
    executionId: execution.rows[0]!.id,
    commandId: execution.rows[0]!.command_id,
    sourceEventId,
    correlationId,
  };
}

function agentAuth(agentId: string, tenantId = tenant, actorType = "AGENT") {
  return {
    async authenticate() {
      return { id: agentId, tenant_id: tenantId, actor_type: actorType };
    },
  };
}
function userAuth() {
  return {
    async authenticate() {
      return { id: actorId, tenant_id: tenant, actor_type: "USER" };
    },
  };
}
const allowAuthorization = {
  async evaluate() {
    return {
      result: "ALLOW" as const,
      reason: "isolated TASK091 test authorization",
    };
  },
};

test("TASK-091 dispatch is authenticated, redelivery preserves command ID, and only a new runtime marker verifies restart", async () => {
  const db = await testDatabase();
  const ids = await fixture(db);
  const ready = await readyIntent(db, ids);
  const server = agentServer(
    config,
    async () => true,
    agentAuth(ids.agent),
    db.uow,
  );
  const url = await listen(server);
  const headers = {
    authorization: "Bearer test-agent",
    "content-type": "application/json",
  };
  try {
    const claim = () =>
      fetch(`${url}/api/v1/agent/automation-actions/claim`, {
        method: "POST",
        headers,
        body: "{}",
      });
    const first = await claim();
    assert.equal(first.status, 200);
    const command = ((await first.json()) as { data: Record<string, unknown> })
      .data;
    assert.equal(command.action_type, "RESTART_AGENT");
    assert.equal(command.target_agent_id, ids.agent);
    assert.equal(Object.hasOwn(command, "command"), false);
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM automation.action_executions WHERE id=$1",
          [ready.executionId],
        )
      ).rows[0]!.state,
      "DISPATCHED",
    );
    const replay = (await claim()).json() as Promise<{
      data: Record<string, unknown>;
    }>;
    assert.equal((await replay).data.command_id, command.command_id);
    const accept = await fetch(
      `${url}/api/v1/agent/automation-actions/${command.command_id}/commands/accept`,
      { method: "POST", headers, body: "{}" },
    );
    assert.equal(accept.status, 200);
    const acceptance = await db.pool.query<{ payload: EventEnvelope }>(
      "SELECT payload FROM platform.outbox_events WHERE event_type='AGENT.AUTOMATION_ACTION_ACCEPTED' AND tenant_id=$1 ORDER BY created_at DESC LIMIT 1",
      [tenant],
    );
    await applyAutomationExecutionEvent(db.uow, acceptance.rows[0]!.payload);
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM automation.action_executions WHERE id=$1",
          [ready.executionId],
        )
      ).rows[0]!.state,
      "VERIFYING",
    );
    const heartbeat = async (runtime: string) => {
      const response = await fetch(`${url}/api/v1/agent/heartbeat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          agent_version: "test",
          agent_runtime_id: runtime,
          session_id: `s-${runtime}`,
        }),
      });
      assert.equal(response.status, 200);
      const eventRow = await db.pool.query<{ payload: EventEnvelope }>(
        "SELECT payload FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='AGENT.ONLINE' ORDER BY created_at DESC LIMIT 1",
        [tenant],
      );
      await applyAutomationExecutionEvent(db.uow, eventRow.rows[0]!.payload);
    };
    const baseline = String(
      (
        await db.pool.query<{ agent_runtime_id: string }>(
          "SELECT agent_runtime_id FROM agent.agents WHERE id=$1",
          [ids.agent],
        )
      ).rows[0]!.agent_runtime_id,
    );
    await heartbeat(baseline);
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM automation.action_executions WHERE id=$1",
          [ready.executionId],
        )
      ).rows[0]!.state,
      "VERIFYING",
    );
    await heartbeat(randomUUID());
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM automation.action_executions WHERE id=$1",
          [ready.executionId],
        )
      ).rows[0]!.state,
      "SUCCEEDED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM automation.action_executions WHERE intent_id=$1",
          [ready.intentId],
        )
      ).rows[0]!.n,
      1,
    );
  } finally {
    await close(server);
    await db.close();
  }
});

test("TASK-091 fails closed on an Agent identity from another tenant and a kill switch", async () => {
  const db = await testDatabase();
  const ids = await fixture(db);
  const ready = await readyIntent(db, ids);
  const foreignServer = agentServer(
    config,
    async () => true,
    agentAuth(ids.agent, "foreign-tenant"),
    db.uow,
  );
  const foreignUrl = await listen(foreignServer);
  try {
    const response = await fetch(
      `${foreignUrl}/api/v1/agent/automation-actions/claim`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer other-tenant",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(response.status, 401);
    await db.uow.run(tenant, (tx) =>
      tx.query(
        "INSERT INTO automation.kill_switches(tenant_id,scope_type,scope_key,enabled,changed_by,reason) VALUES($1,'GLOBAL','*',true,$2,'test kill switch')",
        [tenant, actorId],
      ),
    );
    const server = agentServer(
      config,
      async () => true,
      agentAuth(ids.agent),
      db.uow,
    );
    const url = await listen(server);
    try {
      const response = await fetch(
        `${url}/api/v1/agent/automation-actions/claim`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer test-agent",
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { data: unknown }).data, null);
      const execution = await db.pool.query<{
        state: string;
        reason_code: string | null;
        dispatched_at: Date | null;
      }>(
        "SELECT state,reason_code,dispatched_at FROM automation.action_executions WHERE id=$1",
        [ready.executionId],
      );
      assert.equal(execution.rows[0]!.state, "FAILED");
      assert.equal(
        execution.rows[0]!.reason_code,
        "AUTOMATION_KILL_SWITCH_ACTIVE",
      );
      assert.equal(execution.rows[0]!.dispatched_at, null);
    } finally {
      await close(server);
    }
  } finally {
    await close(foreignServer);
    await db.close();
  }
});

test("TASK-091 rechecks the scoped SYSTEM_AUTOMATION grant before dispatch", async () => {
  const db = await testDatabase();
  const ids = await fixture(db);
  await db.uow.run(tenant, async (tx) => {
    await tx.query(
      "DELETE FROM identity.role_permissions WHERE tenant_id=$1 AND role_id=$2 AND permission_id=(SELECT id FROM identity.permissions WHERE code='agent.restart')",
      [tenant, ids.role],
    );
  });
  const missingGrantIntent = await readyIntent(db, ids);
  const server = agentServer(
    config,
    async () => true,
    agentAuth(ids.agent),
    db.uow,
  );
  const url = await listen(server);
  const headers = {
    authorization: "Bearer task091-agent",
    "content-type": "application/json",
  };
  try {
    const claim = async () =>
      fetch(`${url}/api/v1/agent/automation-actions/claim`, {
        method: "POST",
        headers,
        body: "{}",
      });
    const denied = await claim();
    assert.equal(denied.status, 200);
    assert.equal(((await denied.json()) as { data: unknown }).data, null);
    const first = await db.pool.query<{ state: string; reason_code: string }>(
      "SELECT state,reason_code FROM automation.action_executions WHERE tenant_id=$1 AND intent_id=$2",
      [tenant, missingGrantIntent.intentId],
    );
    assert.equal(first.rows[0]!.state, "FAILED");
    assert.equal(first.rows[0]!.reason_code, "AUTOMATION_AUTHORIZATION_DENIED");

    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "INSERT INTO identity.role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM identity.permissions WHERE code='agent.restart'",
        [tenant, ids.role],
      );
      await tx.query(
        "UPDATE identity.role_bindings SET scope_id=$1 WHERE tenant_id=$2 AND principal_type='SYSTEM_AUTOMATION' AND principal_id=$3 AND role_id=$4",
        [randomUUID(), tenant, ids.automationPrincipal, ids.role],
      );
    });
    const wrongScopeIntent = await readyIntent(db, ids);
    const scopeDenied = await claim();
    assert.equal(scopeDenied.status, 200);
    assert.equal(((await scopeDenied.json()) as { data: unknown }).data, null);
    const second = await db.pool.query<{ state: string; reason_code: string }>(
      "SELECT state,reason_code FROM automation.action_executions WHERE tenant_id=$1 AND intent_id=$2",
      [tenant, wrongScopeIntent.intentId],
    );
    assert.equal(second.rows[0]!.state, "FAILED");
    assert.equal(
      second.rows[0]!.reason_code,
      "AUTOMATION_AUTHORIZATION_DENIED",
    );

    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "UPDATE identity.role_bindings SET scope_id=$1 WHERE tenant_id=$2 AND principal_type='SYSTEM_AUTOMATION' AND principal_id=$3 AND role_id=$4",
        [ids.site, tenant, ids.automationPrincipal, ids.role],
      );
    });
    const revokedPolicyIntent = await readyIntent(db, ids);
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "UPDATE automation.action_policies SET state='INACTIVE',deactivated_at=now(),deactivated_by=$1,deactivation_reason='Revoked during execution recheck',entity_version=entity_version+1 WHERE tenant_id=$2 AND id=$3 AND state='ACTIVE'",
        [actorId, tenant, ids.policy],
      );
    });
    const policyDenied = await claim();
    assert.equal(policyDenied.status, 200);
    assert.equal(((await policyDenied.json()) as { data: unknown }).data, null);
    const third = await db.pool.query<{ state: string; reason_code: string }>(
      "SELECT state,reason_code FROM automation.action_executions WHERE tenant_id=$1 AND intent_id=$2",
      [tenant, revokedPolicyIntent.intentId],
    );
    assert.equal(third.rows[0]!.state, "FAILED");
    assert.equal(third.rows[0]!.reason_code, "AUTOMATION_POLICY_DENIED");
    const evidence = await db.pool.query<{
      result_evidence_json: Record<string, unknown>;
    }>(
      "SELECT result_evidence_json FROM automation.action_executions WHERE tenant_id=$1 AND intent_id=$2",
      [tenant, revokedPolicyIntent.intentId],
    );
    assert.equal(
      (evidence.rows[0]!.result_evidence_json as { reason_code: string })
        .reason_code,
      "AUTOMATION_POLICY_NOT_CONFIGURED",
    );
  } finally {
    await close(server);
    await db.close();
  }
});

test("TASK-091 operator cancel uses scoped permission, expected version and idempotency", async () => {
  const db = await testDatabase();
  const ids = await fixture(db);
  const ready = await readyIntent(db, ids);
  const server = apiServer(
    config,
    async () => true,
    userAuth(),
    allowAuthorization,
    db.uow,
  );
  const url = await listen(server);
  const headers = {
    authorization: "Bearer operator",
    "content-type": "application/json",
    "idempotency-key": "cancel-task091-1",
  };
  try {
    const response = await fetch(
      `${url}/api/v1/automation/action-executions/${ready.executionId}/commands/cancel`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          expected_version: 1,
          reason: "Operator stopped before Agent delivery",
        }),
      },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { state: string } };
    assert.equal(body.data.state, "CANCELLED");
    const replay = await fetch(
      `${url}/api/v1/automation/action-executions/${ready.executionId}/commands/cancel`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          expected_version: 1,
          reason: "Operator stopped before Agent delivery",
        }),
      },
    );
    assert.equal(replay.status, 200);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM automation.action_executions WHERE intent_id=$1",
          [ready.intentId],
        )
      ).rows[0]!.n,
      1,
    );
  } finally {
    await close(server);
    await db.close();
  }
});

test("TASK-091 verification timeout is UNKNOWN, creates one fallback, and forbids post-acceptance cancellation", async () => {
  const db = await testDatabase();
  const ids = await fixture(db);
  const ready = await readyIntent(db, ids);
  const server = agentServer(
    config,
    async () => true,
    agentAuth(ids.agent),
    db.uow,
  );
  const url = await listen(server);
  const headers = {
    authorization: "Bearer agent",
    "content-type": "application/json",
  };
  try {
    const claim = await fetch(`${url}/api/v1/agent/automation-actions/claim`, {
      method: "POST",
      headers,
      body: "{}",
    });
    const command = ((await claim.json()) as { data: { command_id: string } })
      .data;
    const accepted = await fetch(
      `${url}/api/v1/agent/automation-actions/${command.command_id}/commands/accept`,
      { method: "POST", headers, body: "{}" },
    );
    assert.equal(accepted.status, 200);
    const fact = await db.pool.query<{ payload: EventEnvelope }>(
      "SELECT payload FROM platform.outbox_events WHERE event_type='AGENT.AUTOMATION_ACTION_ACCEPTED' AND tenant_id=$1 ORDER BY created_at DESC LIMIT 1",
      [tenant],
    );
    await applyAutomationExecutionEvent(db.uow, fact.rows[0]!.payload);
    const current = await db.pool.query<{
      entity_version: number;
      verification_deadline: Date;
      state: string;
    }>(
      "SELECT entity_version,verification_deadline,state FROM automation.action_executions WHERE id=$1",
      [ready.executionId],
    );
    assert.equal(current.rows[0]!.state, "VERIFYING");
    const serverApi = apiServer(
      config,
      async () => true,
      userAuth(),
      allowAuthorization,
      db.uow,
    );
    const api = await listen(serverApi);
    try {
      const cancel = await fetch(
        `${api}/api/v1/automation/action-executions/${ready.executionId}/commands/cancel`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer operator",
            "content-type": "application/json",
            "idempotency-key": "after-accept-cancel",
          },
          body: JSON.stringify({
            expected_version: current.rows[0]!.entity_version,
            reason: "Attempt to cancel after Agent acceptance",
          }),
        },
      );
      assert.equal(cancel.status, 409);
    } finally {
      await close(serverApi);
    }
    const expiredAt = new Date(
      new Date(current.rows[0]!.verification_deadline).getTime() + 1000,
    );
    assert.equal(
      await db.uow.run(tenant, (tx) =>
        markExpiredExecutionsUnknown(tx, expiredAt),
      ),
      1,
    );
    const unknown = await db.pool.query<{ payload: EventEnvelope }>(
      "SELECT payload FROM platform.outbox_events WHERE event_type='AUTOMATION.ACTION_UNKNOWN' AND tenant_id=$1 AND aggregate_id=$2 ORDER BY created_at DESC LIMIT 1",
      [tenant, ready.executionId],
    );
    await applyAutomationExecutionEvent(db.uow, unknown.rows[0]!.payload);
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM automation.action_executions WHERE id=$1",
          [ready.executionId],
        )
      ).rows[0]!.state,
      "UNKNOWN",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM operations.work_items WHERE tenant_id=$1 AND source_type='AUTOMATION_EXECUTION' AND source_id=$2",
          [tenant, ready.executionId],
        )
      ).rows[0]!.n,
      1,
    );
    assert.equal(
      await db.uow.run(tenant, (tx) =>
        markExpiredExecutionsUnknown(tx, new Date(expiredAt.getTime() + 1000)),
      ),
      0,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM automation.action_executions WHERE intent_id=$1",
          [ready.intentId],
        )
      ).rows[0]!.n,
      1,
    );
  } finally {
    await close(server);
    await db.close();
  }
});

test("TASK-091 reconciled manual retry gets new linked IDs and repeats dispatch controls", async () => {
  const db = await testDatabase();
  const ids = await fixture(db);
  const ready = await readyIntent(db, ids);
  const agent = agentServer(
    config,
    async () => true,
    agentAuth(ids.agent),
    db.uow,
  );
  const agentUrl = await listen(agent);
  const agentHeaders = {
    authorization: "Bearer agent",
    "content-type": "application/json",
  };
  try {
    const first = await fetch(
      `${agentUrl}/api/v1/agent/automation-actions/claim`,
      { method: "POST", headers: agentHeaders, body: "{}" },
    );
    const command = ((await first.json()) as { data: { command_id: string } })
      .data;
    const rejection = await fetch(
      `${agentUrl}/api/v1/agent/automation-actions/${command.command_id}/commands/report`,
      {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({
          outcome: "REJECTED",
          reason_code: "AGENT_BUSY",
        }),
      },
    );
    assert.equal(rejection.status, 200);
    const rejected = await db.pool.query<{ payload: EventEnvelope }>(
      "SELECT payload FROM platform.outbox_events WHERE event_type='AGENT.AUTOMATION_ACTION_REJECTED' AND tenant_id=$1 ORDER BY created_at DESC LIMIT 1",
      [tenant],
    );
    await applyAutomationExecutionEvent(db.uow, rejected.rows[0]!.payload);
    const old = await db.pool.query<{
      entity_version: number;
      state: string;
      attempt_number: number;
      command_id: string;
    }>(
      "SELECT entity_version,state,attempt_number,command_id FROM automation.action_executions WHERE id=$1",
      [ready.executionId],
    );
    assert.equal(old.rows[0]!.state, "FAILED");
    const apiServerInstance = apiServer(
      config,
      async () => true,
      userAuth(),
      allowAuthorization,
      db.uow,
    );
    const api = await listen(apiServerInstance);
    try {
      const headers = {
        authorization: "Bearer operator",
        "content-type": "application/json",
        "idempotency-key": "manual-retry-1",
      };
      const response = await fetch(
        `${api}/api/v1/automation/action-executions/${ready.executionId}/commands/retry`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            expected_version: old.rows[0]!.entity_version,
            reason:
              "Agent was repaired and operator verified service is stopped",
            reconciliation_evidence:
              "Operator confirmed agent process remained stopped after explicit console and host check.",
          }),
        },
      );
      assert.equal(response.status, 200);
      const result = (
        (await response.json()) as {
          data: {
            id: string;
            command_id: string;
            state: string;
            attempt_number: number;
            previous_execution_id: string;
          };
        }
      ).data;
      assert.equal(result.state, "PENDING");
      assert.equal(result.attempt_number, 2);
      assert.equal(result.previous_execution_id, ready.executionId);
      assert.notEqual(result.id, ready.executionId);
      assert.notEqual(result.command_id, old.rows[0]!.command_id);
      const replay = await fetch(
        `${api}/api/v1/automation/action-executions/${ready.executionId}/commands/retry`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            expected_version: old.rows[0]!.entity_version,
            reason:
              "Agent was repaired and operator verified service is stopped",
            reconciliation_evidence:
              "Operator confirmed agent process remained stopped after explicit console and host check.",
          }),
        },
      );
      assert.equal(replay.status, 200);
      assert.equal(
        ((await replay.json()) as { data: { id: string } }).data.id,
        result.id,
      );
      const second = await fetch(
        `${agentUrl}/api/v1/agent/automation-actions/claim`,
        { method: "POST", headers: agentHeaders, body: "{}" },
      );
      const delivered = (
        (await second.json()) as {
          data: { command_id: string; execution_id: string };
        }
      ).data;
      assert.equal(delivered.execution_id, result.id);
      assert.equal(delivered.command_id, result.command_id);
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*)::int AS n FROM automation.action_executions WHERE tenant_id=$1 AND intent_id=$2",
            [tenant, ready.intentId],
          )
        ).rows[0]!.n,
        2,
      );
    } finally {
      await close(apiServerInstance);
    }
  } finally {
    await close(agent);
    await db.close();
  }
});
