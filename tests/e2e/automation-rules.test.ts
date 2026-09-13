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
  activateActionPolicy,
  createActionPolicyDraft,
  deactivateActionPolicy,
  PostgresAutomationSecurity,
  type ActionCapabilityPort,
  type AutomationTargetPort,
  type ActionAuthorization,
  type AutomationPolicyPort,
  type RuleDefinition,
} from "../../modules/automation/index.js";

const allowAuth: ActionAuthorization = {
  async authorize({ capability, target }) {
    return {
      allowed: true,
      reasonCode: "AUTHORIZED",
      principalId: "09000000-0000-4000-8000-000000000099",
      permission: capability.required_permission,
      scopeReference: target.scopeReference,
    };
  },
};
const allowPolicy: AutomationPolicyPort = {
  async decide({ action: descriptor }) {
    return {
      decision: "ALLOW",
      reasonCode: "POLICY_ALLOWED",
      policyId:
        descriptor.action_type === "CREATE_RECORD"
          ? "09000000-0000-4000-8000-000000000096"
          : "09000000-0000-4000-8000-000000000098",
      policyVersion: 1,
      approvalRequired: false,
    };
  },
};
const approvalPolicy: AutomationPolicyPort = {
  async decide({ action: descriptor }) {
    return {
      decision: "REQUIRE_APPROVAL",
      reasonCode: "APPROVAL_REQUIRED",
      policyId:
        descriptor.action_type === "CREATE_RECORD"
          ? "09000000-0000-4000-8000-000000000096"
          : "09000000-0000-4000-8000-000000000098",
      policyVersion: 1,
      approvalRequired: true,
    };
  },
};
const fakeCapabilities: ActionCapabilityPort = {
  async resolve({ action: descriptor }) {
    const id =
      descriptor.action_type === "CREATE_RECORD"
        ? "09000000-0000-4000-8000-000000000011"
        : "09000000-0000-4000-8000-000000000010";
    return {
      id,
      action_type: descriptor.action_type,
      target_type: descriptor.target_type,
      version: 1,
      required_permission: "agent.restart",
      safety_class: "SAFE_AUTOMATION" as const,
      automatic_execution_supported: true,
      approval_supported: true,
      approval_required: false,
      conflict_group: descriptor.exclusivity_group,
      parameter_schema_json: { type: "object" },
      executor_type: "TEST_ONLY_INTENT_FIXTURE",
    };
  },
};
const fakeTargets: AutomationTargetPort = {
  async resolveTarget({ tenantId, targetType, targetId }) {
    return {
      tenantId,
      targetType,
      targetId,
      scope: { site: "TEST-SITE" },
      scopeReference: "SITE:TEST-SITE",
    };
  },
};
const testPorts = {
  capabilities: fakeCapabilities,
  targets: fakeTargets,
};
async function seedTestCapabilities(
  db: Awaited<ReturnType<typeof testDatabase>>,
) {
  await db.uow.run(tenant, async (tx) => {
    for (const [id, actionType, group] of [
      [
        "09000000-0000-4000-8000-000000000010",
        "UPDATE_FIELD",
        "ASSET_OPERATIONAL_STATE",
      ],
      [
        "09000000-0000-4000-8000-000000000011",
        "CREATE_RECORD",
        "ASSET_DIAGNOSTICS",
      ],
    ])
      await tx.query(
        `INSERT INTO automation.action_capabilities(id,action_type,target_type,version,required_permission,safety_class,automatic_execution_supported,approval_supported,approval_required,conflict_group,parameter_schema_json,executor_type,content_hash)
         VALUES($1,$2,'ASSET',1,'agent.restart','SAFE_AUTOMATION',true,true,false,$3,'{"type":"object"}','TEST_ONLY_INTENT_FIXTURE','test') ON CONFLICT(action_type,target_type,version) DO NOTHING`,
        [id, actionType, group],
      );
    for (const [id, actionType, mode] of [
      ["09000000-0000-4000-8000-000000000098", "UPDATE_FIELD", "ALLOW"],
      ["09000000-0000-4000-8000-000000000096", "CREATE_RECORD", "ALLOW"],
    ])
      await tx.query(
        `INSERT INTO automation.action_policies(id,tenant_id,action_type,target_type,version,state,mode,resource_scope_json,parameter_constraints_json,approval_required,effective_from,content_hash,created_by,changed_by,reason,activated_at)
         VALUES($1,$2,$3,'ASSET',1,'ACTIVE',$4,'{}','{}',false,now()-interval '1 minute','test',$5,$5,'test fixture',now()) ON CONFLICT(tenant_id,action_type,target_type,version) DO NOTHING`,
        [id, tenant, actionType, mode, actor],
      );
    await tx.query(
      "INSERT INTO identity.automation_principals(id,tenant_id,service_identity,created_by) VALUES('09000000-0000-4000-8000-000000000099',$1,'test.fixture.automation',$2) ON CONFLICT(tenant_id,id) DO NOTHING",
      [tenant, actor],
    );
  });
}
async function evaluateFixture(
  tx: Parameters<typeof evaluateEvent>[0],
  event: Parameters<typeof evaluateEvent>[1],
  authorization = allowAuth,
  policy = allowPolicy,
) {
  return evaluateEvent(tx, event, authorization, policy, testPorts);
}
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
  await seedTestCapabilities(db);
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
function approvedAutomationIntentEvent(approvalId: string): EventEnvelope {
  const now = new Date().toISOString();
  return {
    event_id: randomUUID(),
    event_type: "APPROVAL.APPROVED",
    schema_version: 1,
    occurred_at: now,
    published_at: now,
    producer: { service: "automation-test", instance: "e2e" },
    aggregate: { type: "APPROVAL_REQUEST", id: approvalId, version: 1 },
    actor: { type: "SYSTEM", id: null },
    correlation_id: randomUUID(),
    causation_id: randomUUID(),
    tenant_id: tenant,
    organization_id: tenant,
    idempotency_key: randomUUID(),
    payload: { approval_request_id: approvalId },
  };
}

test("TASK-090 versions rules immutably; simulation never creates production evidence", async () => {
  const db = await testDatabase();
  try {
    await seedTestCapabilities(db);
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
        ...testPorts,
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
      evaluateFixture(tx, input()),
    );
    assert.equal(draftResult.length, 0);
    const active = await createActive(db, "MATCHING_ACTIVE", action());
    const unmatched = input();
    unmatched.event_type = "MONITORING.WARNING";
    const unmatchedResult = await db.uow.run(tenant, (tx) =>
      evaluateFixture(tx, unmatched),
    );
    assert.equal(unmatchedResult.length, 0);
    await db.uow.run(tenant, (tx) =>
      deactivateRule(tx, {
        ruleId: active.id,
        expectedVersion: active.entity_version,
      }),
    );
    const inactiveResult = await db.uow.run(tenant, (tx) =>
      evaluateFixture(tx, input()),
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
      evaluateFixture(tx, allowEvent),
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
      evaluateFixture(
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
      evaluateFixture(tx, input(), allowAuth, denyUnconfiguredAutomationPolicy),
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

    const unsupported = await db.uow.run(tenant, (tx) =>
      evaluateEvent(tx, input(), allowAuth, allowPolicy),
    );
    assert.equal(
      (
        unsupported as unknown as {
          action_intents: { state: string; reason_code: string }[];
        }
      ).action_intents[0]!.state,
      "BLOCKED",
    );
    const failedAuth: ActionAuthorization = {
      async authorize() {
        throw new Error("authorization backend unavailable");
      },
    };
    const failedPolicy: AutomationPolicyPort = {
      async decide() {
        throw new Error("policy backend unavailable");
      },
    };
    const backendFailure = await db.uow.run(tenant, (tx) =>
      evaluateEvent(tx, input(), failedAuth, failedPolicy, testPorts),
    );
    assert.equal(
      (backendFailure as unknown as { action_intents: { state: string }[] })
        .action_intents[0]!.state,
      "BLOCKED",
    );
  } finally {
    await db.close();
  }
});

test("TASK-090 requires explicit policy and canonical scoped SYSTEM_AUTOMATION authorization for READY", async () => {
  const db = await testDatabase();
  const scopedTenant = "automation-security-positive";
  const actorId = randomUUID();
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const locationId = randomUUID();
  const otherLocationId = randomUUID();
  const categoryId = randomUUID();
  const modelId = randomUUID();
  const assetId = randomUUID();
  const agentId = randomUUID();
  const otherAssetId = randomUUID();
  const otherAgentId = randomUUID();
  const foreignTenant = "automation-security-foreign";
  const foreignSiteId = randomUUID();
  const foreignCategoryId = randomUUID();
  const foreignModelId = randomUUID();
  const foreignAssetId = randomUUID();
  const foreignAgentId = randomUUID();
  const principalId = randomUUID();
  const roleId = randomUUID();
  const event = {
    ...input(),
    tenant_id: scopedTenant,
    correlation_id: randomUUID(),
    payload: { cpu: 99 },
  };
  const freshEvent = () => ({
    ...event,
    event_id: randomUUID(),
    occurred_at: new Date(Date.now() + 5_000).toISOString(),
  });
  const restartAction = {
    target_type: "AGENT",
    target_id: agentId,
    action_domain: "agent",
    action_type: "RESTART_AGENT",
    parameters: {},
    exclusivity_group: "AGENT_SERVICE_CONTROL",
  };
  try {
    await db.uow.run(scopedTenant, async (tx) => {
      await tx.query(
        "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,$2,'SITE-A','Site A','SITE')",
        [siteId, scopedTenant],
      );
      await tx.query(
        "INSERT INTO asset.locations(id,tenant_id,code,name,type,parent_id) VALUES($1,$2,'ROOM-A','Room A','ROOM',$3)",
        [locationId, scopedTenant, siteId],
      );
      await tx.query(
        "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,$2,'SITE-B','Site B','SITE')",
        [otherSiteId, scopedTenant],
      );
      await tx.query(
        "INSERT INTO asset.locations(id,tenant_id,code,name,type,parent_id) VALUES($1,$2,'ROOM-B','Room B','ROOM',$3)",
        [otherLocationId, scopedTenant, otherSiteId],
      );
      await tx.query(
        "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Automation test')",
        [categoryId, scopedTenant],
      );
      await tx.query(
        "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Test','Agent host',$3)",
        [modelId, scopedTenant, categoryId],
      );
      await tx.query(
        "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,current_location_id) VALUES($1,$2,'AUTO-HOST',$3,$4)",
        [assetId, scopedTenant, modelId, locationId],
      );
      await tx.query(
        "INSERT INTO agent.agents(id,tenant_id,asset_id,agent_version,status) VALUES($1,$2,$3,'test','ONLINE')",
        [agentId, scopedTenant, assetId],
      );
      await tx.query(
        "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,current_location_id) VALUES($1,$2,'AUTO-HOST-B',$3,$4)",
        [otherAssetId, scopedTenant, modelId, otherLocationId],
      );
      await tx.query(
        "INSERT INTO agent.agents(id,tenant_id,asset_id,agent_version,status) VALUES($1,$2,$3,'test','ONLINE')",
        [otherAgentId, scopedTenant, otherAssetId],
      );
      await tx.query(
        "INSERT INTO asset.locations(id,tenant_id,code,name,type) VALUES($1,$2,'FOREIGN-SITE','Foreign site','SITE')",
        [foreignSiteId, foreignTenant],
      );
      await tx.query(
        "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'Foreign automation test')",
        [foreignCategoryId, foreignTenant],
      );
      await tx.query(
        "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'Test','Foreign agent host',$3)",
        [foreignModelId, foreignTenant, foreignCategoryId],
      );
      await tx.query(
        "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,current_location_id) VALUES($1,$2,'FOREIGN-HOST',$3,$4)",
        [foreignAssetId, foreignTenant, foreignModelId, foreignSiteId],
      );
      await tx.query(
        "INSERT INTO agent.agents(id,tenant_id,asset_id,agent_version,status) VALUES($1,$2,$3,'test','ONLINE')",
        [foreignAgentId, foreignTenant, foreignAssetId],
      );
      await tx.query(
        "INSERT INTO identity.permissions(id,code,resource_type,action) VALUES($1,'agent.restart','agent','restart') ON CONFLICT(code) DO NOTHING",
        [randomUUID()],
      );
      await tx.query(
        "INSERT INTO identity.roles(id,tenant_id,code,name,type,status) VALUES($1,$2,'AUTO_TEST','Automation test','CUSTOM','ACTIVE')",
        [roleId, scopedTenant],
      );
      await tx.query(
        "INSERT INTO identity.role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM identity.permissions WHERE code='agent.restart'",
        [scopedTenant, roleId],
      );
      await tx.query(
        "INSERT INTO identity.automation_principals(id,tenant_id,service_identity,created_by) VALUES($1,$2,'itcenter.task090.automation',$3)",
        [principalId, scopedTenant, actorId],
      );
      await tx.query(
        `INSERT INTO identity.role_bindings(id,tenant_id,principal_type,principal_id,role_id,scope_type,scope_id,source,valid_from,reason,created_by)
         VALUES($1,$2,'SYSTEM_AUTOMATION',$3,$4,'SITE',$5,'TASK090_TEST',now()-interval '1 minute','explicit test grant',$6)`,
        [randomUUID(), scopedTenant, principalId, roleId, siteId, actorId],
      );
      const draft = await createActionPolicyDraft(tx, {
        actionType: "RESTART_AGENT",
        targetType: "AGENT",
        actorId,
        draft: {
          mode: "ALLOW",
          resourceScope: { site: siteId },
          parameterConstraints: {},
          approvalRequired: false,
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          reason: "Explicit isolated test policy",
        },
      });
      await activateActionPolicy(tx, {
        policyId: draft.id,
        expectedVersion: draft.entity_version,
        actorId,
        reason: "Authorize one safe test action",
      });
      const rule = await createRule(tx, {
        code: "SAFE_RESTART",
        actorId,
        definition: definition(restartAction),
      });
      const published = await publishVersion(tx, {
        ruleId: rule.id,
        expectedVersion: rule.entity_version,
        actorId,
      });
      await activateRule(tx, {
        ruleId: rule.id,
        ruleVersion: published.version,
        expectedVersion: published.entity_version,
        actorId,
      });
    });

    const evaluated = await db.uow.run(scopedTenant, (tx) => {
      const security = new PostgresAutomationSecurity(tx);
      return evaluateEvent(tx, event, security, security, {
        capabilities: security,
        targets: security,
      });
    });
    const ready = (
      evaluated as unknown as {
        action_intents: { id: string; state: string }[];
      }
    ).action_intents[0]!;
    assert.equal(ready.state, "READY");
    const evidence = await db.pool.query<{
      policy_id: string;
      policy_version: number;
      principal_id: string;
      required_permission: string;
      authorization_scope_reference: string;
      authorization_decision: string;
      approval_result: string;
      kill_switch_result: string;
    }>(
      `SELECT policy_id,policy_version,principal_id,required_permission,
              authorization_scope_reference,authorization_decision,approval_result,kill_switch_result
       FROM automation.action_intents WHERE tenant_id=$1 AND id=$2`,
      [scopedTenant, ready.id],
    );
    assert.equal(evidence.rows[0]!.policy_version, 1);
    assert.equal(evidence.rows[0]!.principal_id, principalId);
    assert.equal(evidence.rows[0]!.required_permission, "agent.restart");
    assert.equal(evidence.rows[0]!.authorization_decision, "ALLOW");
    assert.equal(evidence.rows[0]!.approval_result, "NOT_REQUIRED");
    assert.equal(evidence.rows[0]!.kill_switch_result, "ALLOW");
    await assert.rejects(
      db.pool.query(
        "UPDATE automation.action_policies SET mode='DENY' WHERE tenant_id=$1 AND id=$2",
        [scopedTenant, evidence.rows[0]!.policy_id],
      ),
      /immutable/,
    );

    const wrongScopeAction = { ...restartAction, target_id: otherAgentId };
    await db.uow.run(scopedTenant, async (tx) => {
      const rule = await createRule(tx, {
        code: "WRONG_SCOPE",
        actorId,
        definition: definition(wrongScopeAction),
      });
      const published = await publishVersion(tx, {
        ruleId: rule.id,
        expectedVersion: rule.entity_version,
        actorId,
      });
      await activateRule(tx, {
        ruleId: rule.id,
        ruleVersion: published.version,
        expectedVersion: published.entity_version,
        actorId,
      });
    });
    const wrongScope = freshEvent();
    const denied = await db.uow.run(scopedTenant, (tx) => {
      const security = new PostgresAutomationSecurity(tx);
      return evaluateEvent(tx, wrongScope, security, security, {
        capabilities: security,
        targets: security,
      });
    });
    assert.equal(
      (
        denied as unknown as {
          action_intents: { state: string; target_id: string }[];
        }
      ).action_intents.find((intent) => intent.target_id === otherAgentId)!
        .state,
      "BLOCKED",
    );

    let evaluationReady!: () => void;
    let releaseEvaluation!: () => void;
    const readyToCommit = new Promise<void>((resolve) => {
      evaluationReady = resolve;
    });
    const holdEvaluation = new Promise<void>((resolve) => {
      releaseEvaluation = resolve;
    });
    const concurrentEvaluation = db.uow.run(scopedTenant, async (tx) => {
      const security = new PostgresAutomationSecurity(tx);
      const result = await evaluateEvent(tx, freshEvent(), security, security, {
        capabilities: security,
        targets: security,
      });
      evaluationReady();
      await holdEvaluation;
      return result;
    });
    await readyToCommit;
    let revokeStarted!: () => void;
    const revocationStarted = new Promise<void>((resolve) => {
      revokeStarted = resolve;
    });
    let revocationFinished = false;
    const concurrentRevocation = db.uow.run(scopedTenant, async (tx) => {
      revokeStarted();
      await tx.query(
        "UPDATE identity.role_bindings SET revoked_at=now(),version=version+1 WHERE tenant_id=$1 AND principal_id=$2",
        [scopedTenant, principalId],
      );
      revocationFinished = true;
    });
    await revocationStarted;
    await new Promise((resolve) => setTimeout(resolve, 25));
    const grantChangeWaitedForDecision = !revocationFinished;
    releaseEvaluation();
    const [serializedEvaluation] = await Promise.all([
      concurrentEvaluation,
      concurrentRevocation,
    ]);
    assert.ok(grantChangeWaitedForDecision);
    assert.equal(
      (
        serializedEvaluation as unknown as {
          action_intents: { state: string; target_id: string }[];
        }
      ).action_intents.find((intent) => intent.target_id === agentId)!.state,
      "READY",
    );
    const revoked = await db.uow.run(scopedTenant, (tx) => {
      const security = new PostgresAutomationSecurity(tx);
      return evaluateEvent(tx, freshEvent(), security, security, {
        capabilities: security,
        targets: security,
      });
    });
    assert.equal(
      (revoked as unknown as { action_intents: { state: string }[] })
        .action_intents[0]!.state,
      "BLOCKED",
    );

    const foreignRuleAction = { ...restartAction, target_id: foreignAgentId };
    await db.uow.run(scopedTenant, async (tx) => {
      const rule = await createRule(tx, {
        code: "FOREIGN_TENANT_TARGET",
        actorId,
        definition: definition(foreignRuleAction),
      });
      const published = await publishVersion(tx, {
        ruleId: rule.id,
        expectedVersion: rule.entity_version,
        actorId,
      });
      await activateRule(tx, {
        ruleId: rule.id,
        ruleVersion: published.version,
        expectedVersion: published.entity_version,
        actorId,
      });
      await tx.query(
        "UPDATE identity.role_bindings SET revoked_at=NULL,version=version+1 WHERE tenant_id=$1 AND principal_id=$2",
        [scopedTenant, principalId],
      );
    });
    const foreignEvent = freshEvent();
    const foreignResult = await db.uow.run(scopedTenant, (tx) => {
      const security = new PostgresAutomationSecurity(tx);
      return evaluateEvent(tx, foreignEvent, security, security, {
        capabilities: security,
        targets: security,
      });
    });
    assert.equal(
      (
        foreignResult as unknown as {
          action_intents: { state: string; target_id: string }[];
        }
      ).action_intents.find((intent) => intent.target_id === foreignAgentId)!
        .state,
      "BLOCKED",
    );

    const activePolicy = await db.pool.query<{
      id: string;
      entity_version: number;
    }>(
      "SELECT id,entity_version FROM automation.action_policies WHERE tenant_id=$1 AND action_type='RESTART_AGENT' AND state='ACTIVE'",
      [scopedTenant],
    );
    await db.uow.run(scopedTenant, (tx) =>
      deactivateActionPolicy(tx, {
        policyId: activePolicy.rows[0]!.id,
        expectedVersion: activePolicy.rows[0]!.entity_version,
        actorId,
        reason: "Exercise fail closed without policy",
      }),
    );
    const noPolicy = await db.uow.run(scopedTenant, (tx) => {
      const security = new PostgresAutomationSecurity(tx);
      return evaluateEvent(tx, freshEvent(), security, security, {
        capabilities: security,
        targets: security,
      });
    });
    assert.equal(
      (
        noPolicy as unknown as {
          action_intents: { state: string; target_id: string }[];
        }
      ).action_intents.find((intent) => intent.target_id === agentId)!.state,
      "BLOCKED",
    );

    const policyModes: ("DENY" | "REQUIRE_APPROVAL")[] = [
      "DENY",
      "REQUIRE_APPROVAL",
    ];
    let currentPolicyId = "";
    let currentPolicyVersion = 0;
    for (const mode of policyModes) {
      const existingActive = await db.pool.query<{
        id: string;
        entity_version: number;
      }>(
        "SELECT id,entity_version FROM automation.action_policies WHERE tenant_id=$1 AND action_type='RESTART_AGENT' AND state='ACTIVE'",
        [scopedTenant],
      );
      if (existingActive.rowCount)
        await db.uow.run(scopedTenant, (tx) =>
          deactivateActionPolicy(tx, {
            policyId: existingActive.rows[0]!.id,
            expectedVersion: existingActive.rows[0]!.entity_version,
            actorId,
            reason: "Replace active test policy version",
          }),
        );
      const createdPolicy = await db.uow.run(scopedTenant, async (tx) => {
        const draft = await createActionPolicyDraft(tx, {
          actionType: "RESTART_AGENT",
          targetType: "AGENT",
          actorId,
          draft: {
            mode,
            resourceScope: { site: siteId },
            parameterConstraints: {},
            approvalRequired: mode === "REQUIRE_APPROVAL",
            effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
            reason: `Explicit ${mode} test policy`,
          },
        });
        await activateActionPolicy(tx, {
          policyId: draft.id,
          expectedVersion: draft.entity_version,
          actorId,
          reason: `Activate ${mode} policy test`,
        });
        return { id: draft.id, version: draft.version };
      });
      currentPolicyId = createdPolicy.id;
      currentPolicyVersion = createdPolicy.version;
      const modeEvent = freshEvent();
      const modeResult = await db.uow.run(scopedTenant, (tx) => {
        const security = new PostgresAutomationSecurity(tx);
        return evaluateEvent(tx, modeEvent, security, security, {
          capabilities: security,
          targets: security,
        });
      });
      const modeIntent = (
        modeResult as unknown as {
          action_intents: { id: string; state: string; target_id: string }[];
        }
      ).action_intents.find((intent) => intent.target_id === agentId)!;
      assert.equal(
        modeIntent.state,
        mode === "DENY" ? "BLOCKED" : "PENDING_APPROVAL",
      );
      if (mode === "REQUIRE_APPROVAL") {
        const approvalPolicyId = randomUUID();
        const approvalId = randomUUID();
        const hashRow = await db.pool.query<{ approval_context_hash: string }>(
          "SELECT approval_context_hash FROM automation.action_intents WHERE tenant_id=$1 AND id=$2",
          [scopedTenant, modeIntent.id],
        );
        await db.uow.run(scopedTenant, async (tx) => {
          await tx.query(
            "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,$2,'TASK090_SECURITY',1,'ACTIVE')",
            [approvalPolicyId, scopedTenant],
          );
          await tx.query(
            "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state,context) VALUES($1,$2,'AUTOMATION_ACTION_INTENT',$3,$4,1,$5,'APPROVED',$6)",
            [
              approvalId,
              scopedTenant,
              modeIntent.id,
              approvalPolicyId,
              actorId,
              JSON.stringify({
                intent_id: modeIntent.id,
                context_hash: hashRow.rows[0]!.approval_context_hash,
              }),
            ],
          );
          const security = new PostgresAutomationSecurity(tx);
          assert.equal(
            await recheckIntentApproval(tx, {
              approvalId,
              eventId: randomUUID(),
              authorization: security,
              policy: security,
              capabilities: security,
              targets: security,
            }),
            true,
          );
        });
        const promoted = await db.pool.query<{
          state: string;
          policy_id: string;
          policy_version: number;
        }>(
          "SELECT state,policy_id,policy_version FROM automation.action_intents WHERE tenant_id=$1 AND id=$2",
          [scopedTenant, modeIntent.id],
        );
        assert.deepEqual(
          [
            promoted.rows[0]!.state,
            promoted.rows[0]!.policy_id,
            promoted.rows[0]!.policy_version,
          ],
          ["READY", currentPolicyId, currentPolicyVersion],
        );
      }
    }
    const staleEvent = freshEvent();
    const staleEvaluation = await db.uow.run(scopedTenant, (tx) => {
      const security = new PostgresAutomationSecurity(tx);
      return evaluateEvent(tx, staleEvent, security, security, {
        capabilities: security,
        targets: security,
      });
    });
    const staleIntent = (
      staleEvaluation as unknown as {
        action_intents: { id: string; state: string; target_id: string }[];
      }
    ).action_intents.find((intent) => intent.target_id === agentId)!;
    assert.equal(staleIntent.state, "PENDING_APPROVAL");
    const staleApprovalId = randomUUID();
    const staleApprovalPolicyId = randomUUID();
    const staleContext = await db.pool.query<{ approval_context_hash: string }>(
      "SELECT approval_context_hash FROM automation.action_intents WHERE tenant_id=$1 AND id=$2",
      [scopedTenant, staleIntent.id],
    );
    await db.uow.run(scopedTenant, (tx) =>
      tx.query(
        "INSERT INTO control.approval_policies(id,tenant_id,code,version,state) VALUES($1,$2,'TASK090_SECURITY_STALE',1,'ACTIVE')",
        [staleApprovalPolicyId, scopedTenant],
      ),
    );
    await db.uow.run(scopedTenant, (tx) =>
      tx.query(
        "INSERT INTO control.approval_requests(id,tenant_id,source_type,source_id,policy_id,policy_version,requested_by,state,context) VALUES($1,$2,'AUTOMATION_ACTION_INTENT',$3,$4,1,$5,'APPROVED',$6)",
        [
          staleApprovalId,
          scopedTenant,
          staleIntent.id,
          staleApprovalPolicyId,
          actorId,
          JSON.stringify({
            intent_id: staleIntent.id,
            context_hash: staleContext.rows[0]!.approval_context_hash,
          }),
        ],
      ),
    );
    const beforeRotation = await db.pool.query<{
      id: string;
      entity_version: number;
    }>(
      "SELECT id,entity_version FROM automation.action_policies WHERE tenant_id=$1 AND action_type='RESTART_AGENT' AND state='ACTIVE'",
      [scopedTenant],
    );
    await db.uow.run(scopedTenant, (tx) =>
      deactivateActionPolicy(tx, {
        policyId: beforeRotation.rows[0]!.id,
        expectedVersion: beforeRotation.rows[0]!.entity_version,
        actorId,
        reason: "Make pending approval stale",
      }),
    );
    await db.uow.run(scopedTenant, async (tx) => {
      const draft = await createActionPolicyDraft(tx, {
        actionType: "RESTART_AGENT",
        targetType: "AGENT",
        actorId,
        draft: {
          mode: "REQUIRE_APPROVAL",
          resourceScope: { site: siteId },
          parameterConstraints: {},
          approvalRequired: true,
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          reason: "New approval-bound policy version",
        },
      });
      await activateActionPolicy(tx, {
        policyId: draft.id,
        expectedVersion: draft.entity_version,
        actorId,
        reason: "Activate new approval context",
      });
      const security = new PostgresAutomationSecurity(tx);
      assert.equal(
        await recheckIntentApproval(tx, {
          approvalId: staleApprovalId,
          eventId: randomUUID(),
          authorization: security,
          policy: security,
          capabilities: security,
          targets: security,
        }),
        false,
      );
      await tx.query(
        "INSERT INTO automation.kill_switches(tenant_id,scope_type,scope_key,enabled,changed_by,reason) VALUES($1,'GLOBAL','*',true,$2,'security test') ON CONFLICT(tenant_id,scope_type,scope_key) DO UPDATE SET enabled=true,changed_by=EXCLUDED.changed_by,reason=EXCLUDED.reason",
        [scopedTenant, actorId],
      );
      const killed = await evaluateEvent(tx, freshEvent(), security, security, {
        capabilities: security,
        targets: security,
      });
      assert.ok(
        (
          killed as unknown as { action_intents: { state: string }[] }
        ).action_intents.some((intent) => intent.state === "BLOCKED"),
      );
    });
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
    await Promise.all([
      applyAutomationEvent(db.uow, delivered, {
        authorization: allowAuth,
        policy: allowPolicy,
        ...testPorts,
      }),
      applyAutomationEvent(db.uow, delivered, {
        authorization: allowAuth,
        policy: allowPolicy,
        ...testPorts,
      }),
    ]);
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
      ...testPorts,
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
      ...testPorts,
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
    await applyAutomationEvent(db.uow, envelope(event), {
      authorization: allowAuth,
      policy: approvalPolicy,
      ...testPorts,
    });
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
    });
    await applyAutomationEvent(
      db.uow,
      approvedAutomationIntentEvent(approvalId),
      {
        authorization: allowAuth,
        policy: approvalPolicy,
        ...testPorts,
      },
    );
    const promoted = await db.pool.query(
      "SELECT state,approval_id FROM automation.action_intents WHERE tenant_id=$1 AND id=$2",
      [tenant, intent.id],
    );
    assert.equal(promoted.rows[0]!.state, "READY");
    assert.equal(promoted.rows[0]!.approval_id, approvalId);
    const reviewWork = await db.pool.query<{ state: string }>(
      "SELECT state FROM operations.work_items WHERE tenant_id=$1 AND source_type='AUTOMATION_REVIEW' AND source_id=$2",
      [tenant, intent.id],
    );
    assert.equal(reviewWork.rows[0]!.state, "RESOLVED");

    const pendingEvent = input();
    await db.uow.run(tenant, (tx) =>
      evaluateFixture(tx, pendingEvent, allowAuth, approvalPolicy),
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
          policy: approvalPolicy,
          ...testPorts,
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
      const result = await evaluateFixture(tx, input(), allowAuth, allowPolicy);
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
    const policyResponse = await request("/api/v1/automation-action-policies", {
      action_type: "RESTART_AGENT",
      target_type: "AGENT",
      mode: "ALLOW",
      resource_scope: { site: randomUUID() },
      parameter_constraints: {},
      approval_required: false,
      effective_from: new Date(Date.now() - 60_000).toISOString(),
      reason: "Explicit policy API test",
    });
    assert.equal(policyResponse.status, 201);
    const policy = (await policyResponse.json()) as {
      data: { id: string; entity_version: number };
    };
    const policyDraftUpdate = await request(
      `/api/v1/automation-action-policies/${policy.data.id}/commands/update-draft`,
      {
        expected_version: policy.data.entity_version,
        mode: "ALLOW",
        resource_scope: { site: randomUUID() },
        parameter_constraints: {},
        approval_required: false,
        effective_from: new Date(Date.now() - 60_000).toISOString(),
        reason: "Revise the draft policy before publication",
      },
    );
    assert.equal(policyDraftUpdate.status, 200);
    const updatedPolicy = (await policyDraftUpdate.json()) as {
      data: { entity_version: number };
    };
    const policyActivation = await request(
      `/api/v1/automation-action-policies/${policy.data.id}/commands/activate`,
      {
        expected_version: updatedPolicy.data.entity_version,
        reason: "Authorize test policy",
      },
    );
    assert.equal(policyActivation.status, 200);
    const policyRead = await request("/api/v1/automation-action-policies");
    assert.equal(policyRead.status, 200);
    const policyEvents = await db.pool.query(
      `SELECT
         (SELECT count(*)::int FROM platform.outbox_events WHERE tenant_id=$1 AND event_type IN ('AUTOMATION.ACTION_POLICY_CREATED','AUTOMATION.ACTION_POLICY_VERSION_PUBLISHED','AUTOMATION.ACTION_POLICY_ACTIVATED')) AS outbox_count,
         (SELECT count(*)::int FROM audit.audit_events WHERE tenant_id=$1 AND event_type IN ('AUTOMATION.ACTION_POLICY_CREATED','AUTOMATION.ACTION_POLICY_VERSION_PUBLISHED','AUTOMATION.ACTION_POLICY_ACTIVATED')) AS audit_count,
         (SELECT count(*)::int FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='AUTOMATION.ACTION_POLICY_UPDATED') AS draft_updated_count`,
      [tenant],
    );
    assert.equal(policyEvents.rows[0]!.outbox_count, 3);
    assert.equal(policyEvents.rows[0]!.audit_count, 3);
    assert.equal(policyEvents.rows[0]!.draft_updated_count, 1);
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
