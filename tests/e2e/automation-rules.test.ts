import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import type { EventEnvelope } from "../../packages/event-contracts/src/index.js";
import { testDatabase } from "../helpers.js";
import { applyAutomationEvent } from "../../apps/worker/src/automation-evaluator.js";
import { applyAutomationWorkItemEvent } from "../../apps/worker/src/automation-conflict-work-items.js";
import {
  activateRule,
  createRule,
  deactivateRule,
  denyUnconfiguredAutomationPolicy,
  denyUnconfiguredAutomationPrincipal,
  evaluateEvent,
  publishVersion,
  recheckIntentApproval,
  simulateRule,
  type ActionAuthorization,
  type AutomationPolicyPort,
  type RuleDefinition,
} from "../../modules/automation/index.js";

const allowAuth: ActionAuthorization = {
  async authorize() {
    return { allowed: true, reasonCode: "AUTHORIZED" };
  },
};
const allowPolicy: AutomationPolicyPort = {
  async decide() {
    return { decision: "ALLOW", reasonCode: "POLICY_ALLOWED" };
  },
};
const approvalPolicy: AutomationPolicyPort = {
  async decide() {
    return { decision: "REQUIRE_APPROVAL", reasonCode: "APPROVAL_REQUIRED" };
  },
};
const tenant = "automation-test";
const actor = randomUUID();
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function definition(
  action: Record<string, unknown>,
  extra: Partial<RuleDefinition> = {},
): RuleDefinition {
  return {
    name: "Rule",
    ownerUserId: actor,
    ownerTeamId: "OPS",
    purpose: "Automated operational response",
    reviewDate: "2027-01-01",
    trigger: { type: "EVENT", event_type: "MONITORING.CRITICAL" },
    condition: { path: "event.cpu", op: "greater_than_or_equal", value: 90 },
    action: action as unknown as RuleDefinition["action"],
    safetyLevel: "SAFE",
    requiresApproval: false,
    ...extra,
  };
}
function action(state?: string): Record<string, unknown> {
  return {
    target_type: "ASSET",
    target_id: "asset-0001",
    action_domain: "asset",
    action_type: "UPDATE_FIELD",
    parameters: { field: "operational_state", value: state ?? "ONLINE" },
    exclusivity_group: "ASSET_OPERATIONAL_STATE",
    desired_state: state ?? "ONLINE",
  };
}
async function createActive(
  db: Awaited<ReturnType<typeof testDatabase>>,
  code: string,
  actionValue: Record<string, unknown>,
  extra?: Partial<RuleDefinition>,
) {
  return db.uow.run(tenant, async (tx) => {
    const created = await createRule(tx, {
      code,
      actorId: actor,
      definition: definition(actionValue, extra),
    });
    const published = await publishVersion(tx, {
      ruleId: created.id,
      expectedVersion: created.entity_version,
      actorId: actor,
    });
    const active = await activateRule(tx, {
      ruleId: created.id,
      ruleVersion: published.version,
      expectedVersion: published.entity_version,
      actorId: actor,
    });
    return { ...active, code };
  });
}
function input(eventId = randomUUID()) {
  return {
    event_id: eventId,
    event_type: "MONITORING.CRITICAL",
    tenant_id: tenant,
    correlation_id: randomUUID(),
    causation_id: randomUUID(),
    occurred_at: new Date(Date.now() + 1000).toISOString(),
    payload: { cpu: 95, host_id: "host-1" },
  };
}
function envelope(value: ReturnType<typeof input>): EventEnvelope {
  const now = new Date().toISOString();
  return {
    event_id: value.event_id,
    event_type: value.event_type,
    schema_version: 1,
    occurred_at: value.occurred_at,
    published_at: now,
    producer: { service: "automation-test", instance: "e2e" },
    aggregate: { type: "MONITORING_OBSERVATION", id: randomUUID(), version: 1 },
    actor: { type: "SYSTEM", id: null },
    correlation_id: value.correlation_id,
    causation_id: value.causation_id,
    tenant_id: value.tenant_id,
    organization_id: value.tenant_id,
    idempotency_key: randomUUID(),
    payload: value.payload,
  };
}

test("TASK-090 versions rules immutably; simulation never creates production evidence", async () => {
  const db = await testDatabase();
  try {
    const created = await db.uow.run(tenant, (tx) =>
      createRule(tx, {
        code: "VERSIONED_RULE",
        actorId: actor,
        definition: definition(action()),
      }),
    );
    const simulated = await db.uow.run(tenant, (tx) =>
      simulateRule(tx, {
        ruleId: created.id,
        eventType: "MONITORING.CRITICAL",
        eventId: randomUUID(),
        payload: { cpu: 98 },
        authorization: allowAuth,
        policy: allowPolicy,
      }),
    );
    assert.equal(simulated.mode, "SIMULATION");
    assert.equal(simulated.match_result, true);
    assert.equal(simulated.executable, false);
    const noEvidence = await db.pool.query(
      "SELECT count(*)::int AS n FROM automation.rule_evaluations WHERE tenant_id=$1",
      [tenant],
    );
    assert.equal(noEvidence.rows[0]!.n, 0);
    const published = await db.uow.run(tenant, (tx) =>
      publishVersion(tx, {
        ruleId: created.id,
        expectedVersion: created.entity_version,
        actorId: actor,
      }),
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE automation.rule_versions SET condition_json='{}' WHERE tenant_id=$1 AND rule_id=$2 AND version=1",
        [tenant, created.id],
      ),
      /immutable/,
    );
    const draft = await db.uow.run(tenant, (tx) =>
      import("../../modules/automation/index.js").then(({ updateDraft }) =>
        updateDraft(tx, {
          ruleId: created.id,
          expectedVersion: published.entity_version,
          actorId: actor,
          definition: definition(action("OFFLINE")),
        }),
      ),
    );
    assert.ok(draft.draft_version_id);
    const rule = await db.pool.query(
      "SELECT state,active_version_id FROM automation.rules WHERE tenant_id=$1 AND id=$2",
      [tenant, created.id],
    );
    assert.equal(rule.rows[0]!.state, "DRAFT");
  } finally {
    await db.close();
  }
});

test("only active rules with matching event triggers evaluate", async () => {
  const db = await testDatabase();
  try {
    const created = await db.uow.run(tenant, (tx) =>
      createRule(tx, {
        code: "ACTIVE_ONLY",
        actorId: actor,
        definition: definition(action()),
      }),
    );
    const draftResult = await db.uow.run(tenant, (tx) =>
      evaluateEvent(tx, input(), allowAuth, allowPolicy),
    );
    assert.equal(draftResult.length, 0);
    const active = await createActive(db, "MATCHING_ACTIVE", action());
    const unmatched = input();
    unmatched.event_type = "MONITORING.WARNING";
    const unmatchedResult = await db.uow.run(tenant, (tx) =>
      evaluateEvent(tx, unmatched, allowAuth, allowPolicy),
    );
    assert.equal(unmatchedResult.length, 0);
    await db.uow.run(tenant, (tx) =>
      deactivateRule(tx, {
        ruleId: active.id,
        expectedVersion: active.entity_version,
      }),
    );
    const inactiveResult = await db.uow.run(tenant, (tx) =>
      evaluateEvent(tx, input(), allowAuth, allowPolicy),
    );
    assert.equal(inactiveResult.length, 0);
    const count = await db.pool.query(
      "SELECT count(*)::int AS n FROM automation.action_intents WHERE tenant_id=$1",
      [tenant],
    );
    assert.equal(count.rows[0]!.n, 0);
    assert.ok(created.id);
  } finally {
    await db.close();
  }
});

test("TASK-090 allows authorized ALLOW intents and blocks when policy or Automation Principal is unavailable", async () => {
  const db = await testDatabase();
  try {
    await createActive(db, "ALLOW_RULE", action());
    const allowEvent = input();
    const allowed = await db.uow.run(tenant, (tx) =>
      evaluateEvent(tx, allowEvent, allowAuth, allowPolicy),
    );
    assert.equal(
      (allowed as unknown as { action_intents: { state: string }[] })
        .action_intents[0]!.state,
      "READY",
    );
    const durableEvaluation = await db.pool.query<{
      action_intent_ids: string[];
    }>(
      "SELECT action_intent_ids FROM automation.rule_evaluations WHERE tenant_id=$1 AND source_event_id=$2",
      [tenant, allowEvent.event_id],
    );
    assert.equal(durableEvaluation.rowCount, 1);
    assert.equal(durableEvaluation.rows[0]!.action_intent_ids.length, 1);
    const denied = await db.uow.run(tenant, (tx) =>
      evaluateEvent(
        tx,
        input(),
        denyUnconfiguredAutomationPrincipal,
        allowPolicy,
      ),
    );
    assert.equal(
      (
        denied as unknown as {
          action_intents: { state: string; reason_code: string }[];
        }
      ).action_intents[0]!.state,
      "BLOCKED",
    );
    const policyDenied = await db.uow.run(tenant, (tx) =>
      evaluateEvent(tx, input(), allowAuth, denyUnconfiguredAutomationPolicy),
    );
    assert.equal(
      (
        policyDenied as unknown as {
          action_intents: { state: string; policy_decision: string }[];
        }
      ).action_intents[0]!.state,
      "BLOCKED",
    );
    const counts = await db.pool.query(
      "SELECT state,count(*)::int AS n FROM automation.action_intents WHERE tenant_id=$1 GROUP BY state",
      [tenant],
    );
    assert.equal(Number(counts.rows.find((r) => r.state === "READY")?.n), 1);
  } finally {
    await db.close();
  }
});

test("identical intents deduplicate contributors; incompatible intents create one conflict fallback", async () => {
  const db = await testDatabase();
  try {
    await createActive(db, "IDENTICAL_A", action());
    await createActive(db, "IDENTICAL_B", action());
    const same = input();
    const delivered = envelope(same);
    await applyAutomationEvent(db.uow, delivered, {
      authorization: allowAuth,
      policy: allowPolicy,
    });
    await applyAutomationEvent(db.uow, delivered, {
      authorization: allowAuth,
      policy: allowPolicy,
    });
    const canonical = await db.pool.query(
      "SELECT id FROM automation.action_intents WHERE tenant_id=$1 AND source_event_id=$2",
      [tenant, same.event_id],
    );
    assert.equal(canonical.rowCount, 1);
    const contributors = await db.pool.query(
      "SELECT count(*)::int AS n FROM automation.action_intent_contributors WHERE tenant_id=$1 AND action_intent_id=$2",
      [tenant, canonical.rows[0]!.id],
    );
    assert.equal(contributors.rows[0]!.n, 2);
    const evaluated = await db.pool.query(
      "SELECT count(*)::int AS n FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='AUTOMATION.RULE_EVALUATED' AND causation_id=$2",
      [tenant, same.event_id],
    );
    assert.equal(evaluated.rows[0]!.n, 2);

    const diagnostic = action("CAPTURED");
    diagnostic.action_type = "CREATE_RECORD";
    diagnostic.parameters = { record_type: "DIAGNOSTIC_SNAPSHOT" };
    diagnostic.exclusivity_group = "ASSET_DIAGNOSTICS";
    await createActive(db, "COMPATIBLE_DIAGNOSTIC", diagnostic);
    const compatibleEvent = input();
    await applyAutomationEvent(db.uow, envelope(compatibleEvent), {
      authorization: allowAuth,
      policy: allowPolicy,
    });
    const compatible = await db.pool.query(
      "SELECT state,count(*)::int AS n FROM automation.action_intents WHERE tenant_id=$1 AND source_event_id=$2 GROUP BY state",
      [tenant, compatibleEvent.event_id],
    );
    assert.deepEqual(
      compatible.rows.map((row) => [row.state, row.n]),
      [["READY", 2]],
    );

    await createActive(db, "CONFLICT_ON", action("ONLINE"), {
      priority: 100,
    });
    await createActive(db, "CONFLICT_OFF", action("OFFLINE"), {
      priority: -100,
    });
    const conflictEvent = input();
    await applyAutomationEvent(db.uow, envelope(conflictEvent), {
      authorization: allowAuth,
      policy: allowPolicy,
    });
    const states = await db.pool.query(
      "SELECT DISTINCT state FROM automation.action_intents WHERE tenant_id=$1 AND source_event_id=$2 AND exclusivity_group='ASSET_OPERATIONAL_STATE'",
      [tenant, conflictEvent.event_id],
    );
    assert.deepEqual(
      states.rows.map((r) => r.state),
      ["CONFLICTED"],
    );
    const conflictEvents = await db.pool.query<{ payload: EventEnvelope }>(
      "SELECT payload FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='AUTOMATION.INTENT_CONFLICTED'",
      [tenant],
    );
    for (const row of conflictEvents.rows)
      await applyAutomationWorkItemEvent(db.uow, row.payload);
    for (const row of conflictEvents.rows)
      await applyAutomationWorkItemEvent(db.uow, row.payload);
    const work = await db.pool.query(
      "SELECT count(*)::int AS n FROM operations.work_items WHERE tenant_id=$1 AND source_type='AUTOMATION_CONFLICT'",
      [tenant],
    );
    assert.equal(work.rows[0]!.n, 1);
  } finally {
    await db.close();
  }
});

test("approval binding promotes only an exact intent context and kill switch blocks new READY intents", async () => {
  const db = await testDatabase();
  try {
    const approvalRule = await createActive(db, "APPROVAL_RULE", action(), {
      safetyLevel: "CONTROLLED",
    });
    const event = input();
    await db.uow.run(tenant, (tx) =>
      evaluateEvent(tx, event, allowAuth, approvalPolicy),
    );
    const intent = (
      await db.pool.query(
        "SELECT id,approval_context_hash,state FROM automation.action_intents WHERE tenant_id=$1 AND source_event_id=$2",
        [tenant, event.event_id],
      )
    ).rows[0]!;
    assert.equal(intent.state, "PENDING_APPROVAL");
    const approvalId = randomUUID(),
      policyId = randomUUID();
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,$2,'AUTOMATION_TEST',1,'ACTIVE')",
        [policyId, tenant],
      );
      await tx.query(
        "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state,context) VALUES($1,$2,'AUTOMATION_ACTION_INTENT',$3,$4,1,$5,'APPROVED',$6)",
        [
          approvalId,
          tenant,
          intent.id,
          policyId,
          actor,
          JSON.stringify({
            intent_id: intent.id,
            context_hash: intent.approval_context_hash,
          }),
        ],
      );
      assert.equal(
        await recheckIntentApproval(tx, {
          approvalId,
          eventId: randomUUID(),
          authorization: allowAuth,
        }),
        true,
      );
    });
    const promoted = await db.pool.query(
      "SELECT state,approval_id FROM automation.action_intents WHERE tenant_id=$1 AND id=$2",
      [tenant, intent.id],
    );
    assert.equal(promoted.rows[0]!.state, "READY");
    assert.equal(promoted.rows[0]!.approval_id, approvalId);

    const pendingEvent = input();
    await db.uow.run(tenant, (tx) =>
      evaluateEvent(tx, pendingEvent, allowAuth, approvalPolicy),
    );
    const pendingIntent = (
      await db.pool.query(
        "SELECT id,approval_context_hash,state FROM automation.action_intents WHERE tenant_id=$1 AND source_event_id=$2",
        [tenant, pendingEvent.event_id],
      )
    ).rows[0]!;
    const staleApprovalId = randomUUID();
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state,context) VALUES($1,$2,'AUTOMATION_ACTION_INTENT',$3,$4,1,$5,'APPROVED',$6)",
        [
          staleApprovalId,
          tenant,
          pendingIntent.id,
          policyId,
          actor,
          JSON.stringify({
            intent_id: pendingIntent.id,
            context_hash: pendingIntent.approval_context_hash,
          }),
        ],
      );
      await tx.query(
        "INSERT INTO automation.kill_switches(tenant_id,scope_type,scope_key,enabled,changed_by,reason) VALUES($1,'RULE',$2,true,$3,'rule disabled during approval')",
        [tenant, approvalRule.id, actor],
      );
      assert.equal(
        await recheckIntentApproval(tx, {
          approvalId: staleApprovalId,
          eventId: randomUUID(),
          authorization: allowAuth,
        }),
        false,
      );
    });
    const stillPending = await db.pool.query(
      "SELECT state FROM automation.action_intents WHERE tenant_id=$1 AND id=$2",
      [tenant, pendingIntent.id],
    );
    assert.equal(stillPending.rows[0]!.state, "PENDING_APPROVAL");
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "INSERT INTO automation.kill_switches(tenant_id,scope_type,scope_key,enabled,changed_by,reason) VALUES($1,'GLOBAL','*',true,$2,'maintenance')",
        [tenant, actor],
      );
      const result = await evaluateEvent(tx, input(), allowAuth, allowPolicy);
      assert.equal(
        (result as unknown as { action_intents: { state: string }[] })
          .action_intents[0]!.state,
        "BLOCKED",
      );
    });
  } finally {
    await db.close();
  }
});

test("automation rule API enforces auth, idempotent commands, audit and outbox", async () => {
  const db = await testDatabase();
  await db.pool.query(
    `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
     VALUES($1,$2,'AUTOMATION-API','automation-api','Automation API','ACTIVE')`,
    [actor, tenant],
  );
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return { id: actor, tenant_id: tenant, actor_type: "USER" };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW", reason: "automation API E2E" };
      },
    },
    db.uow,
  );
  try {
    const base = await listen(server);
    const request = (
      path: string,
      body?: Record<string, unknown>,
      key = randomUUID(),
    ) =>
      fetch(`${base}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: "Bearer verified",
          ...(body
            ? {
                "content-type": "application/json",
                "idempotency-key": key,
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const ruleBody = {
      code: "API_RULE",
      name: "API rule",
      owner_user_id: actor,
      owner_team_id: "OPS",
      purpose: "Exercise the authenticated rule API",
      review_date: "2027-01-01",
      trigger: { type: "EVENT", event_type: "MONITORING.CRITICAL" },
      condition: { path: "event.cpu", op: "greater_than", value: 90 },
      action: action(),
      safety_level: "SAFE",
      requires_approval: false,
    };
    const idem = randomUUID();
    const createdResponse = await request(
      "/api/v1/automation-rules",
      ruleBody,
      idem,
    );
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as {
      data: { id: string; entity_version: number };
    };
    const replay = await request("/api/v1/automation-rules", ruleBody, idem);
    assert.equal(replay.status, 201);
    assert.deepEqual(
      ((await replay.json()) as { data: unknown }).data,
      created.data,
    );
    const publishedResponse = await request(
      `/api/v1/automation-rules/${created.data.id}/commands/publish`,
      { expected_version: created.data.entity_version },
    );
    assert.equal(publishedResponse.status, 200);
    const published = (await publishedResponse.json()) as {
      data: { entity_version: number; version: number };
    };
    const activatedResponse = await request(
      `/api/v1/automation-rules/${created.data.id}/commands/activate`,
      {
        expected_version: published.data.entity_version,
        rule_version: published.data.version,
      },
    );
    assert.equal(activatedResponse.status, 200);
    const read = await request(`/api/v1/automation-rules/${created.data.id}`);
    assert.equal(read.status, 200);
    const records = await db.pool.query(
      `SELECT
        (SELECT count(*)::int FROM platform.outbox_events WHERE tenant_id=$1 AND event_type IN ('AUTOMATION.RULE_CREATED','AUTOMATION.RULE_VERSION_PUBLISHED','AUTOMATION.RULE_ACTIVATED')) AS outbox_count,
        (SELECT count(*)::int FROM audit.audit_events WHERE tenant_id=$1 AND event_type IN ('AUTOMATION.RULE_CREATED','AUTOMATION.RULE_VERSION_PUBLISHED','AUTOMATION.RULE_ACTIVATED')) AS audit_count`,
      [tenant],
    );
    assert.equal(records.rows[0]!.outbox_count, 3);
    assert.equal(records.rows[0]!.audit_count, 3);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
