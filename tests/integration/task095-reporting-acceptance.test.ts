import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AuthenticationPort,
  AuthorizationPort,
} from "../../packages/auth/src/index.js";
import type { CorrelationContext } from "../../packages/shared-kernel/src/index.js";
import type {
  Transaction,
  UnitOfWork,
} from "../../packages/persistence/src/index.js";
import { ApplicationError } from "../../packages/api-contracts/src/index.js";
import {
  KPI_CATALOG,
  calculateKpi,
  queryKpiDrilldownCandidates,
  readKpiSnapshots,
} from "../../modules/reporting/index.js";
import { ticketTerminalStates } from "../../modules/ticket/index.js";
import { handleReportingRoute } from "../../apps/api/src/reporting-routes.js";
import { materializeReportingPeriod } from "../../apps/worker/src/reporting-snapshots.js";
import { testDatabase } from "../helpers.js";

const periodStart = "2026-09-10T00:00:00.000Z";
const periodEnd = "2026-09-11T00:00:00.000Z";
const asOf = periodEnd;
const inside = "2026-09-10T12:00:00.000Z";
const fixedId = () => randomUUID();
const evidenceIdentity = (id: string) =>
  createHash("sha256").update(id).digest("hex");
function responseCapture() {
  const chunks: string[] = [];
  const response = {
    statusCode: 200,
    setHeader() {
      return this;
    },
    writeHead() {
      return this;
    },
    end(value?: string) {
      if (value) chunks.push(value);
    },
  } as unknown as ServerResponse;
  return { response, body: () => chunks.join("") };
}

function drilldown(
  db: Awaited<ReturnType<typeof testDatabase>>,
  tenant: string,
  kpiId: keyof typeof KPI_CATALOG,
  dimensions: Record<string, string> = {},
) {
  return db.uow.run(tenant, (tx) =>
    queryKpiDrilldownCandidates({
      tx,
      kpiId,
      from: periodStart,
      to: periodEnd,
      asOf,
      dimensions,
      offset: 0,
      limit: 100,
    }),
  );
}

async function deniedRouteDrilldown(input: {
  db: Awaited<ReturnType<typeof testDatabase>>;
  tenant: string;
  user: string;
  kpiId: keyof typeof KPI_CATALOG;
}) {
  const checked: string[] = [];
  const authentication: AuthenticationPort = {
    async authenticate() {
      return { id: input.user, tenant_id: input.tenant, actor_type: "USER" };
    },
  };
  const authorization: AuthorizationPort = {
    async evaluate(request) {
      checked.push(request.action);
      const aggregateCost =
        request.action === "procurement.cost.read" &&
        request.resource.id === "aggregate";
      return {
        result:
          request.action === "metric.read" || aggregateCost ? "ALLOW" : "DENY",
        reason: "TASK-095 acceptance authorization",
      };
    },
  };
  const captured = responseCapture();
  await handleReportingRoute({
    req: {
      method: "GET",
      url: `/api/v1/kpis/${input.kpiId}/drilldown?from=${periodStart}&to=${periodEnd}&as_of=${asOf}`,
      headers: { authorization: "Bearer acceptance" },
    } as IncomingMessage,
    res: captured.response,
    context: {
      request_id: "req",
      correlation_id: "corr",
      causation_id: "cause",
    } as CorrelationContext,
    authentication,
    authorization,
    uow: input.db.uow as UnitOfWork,
  });
  return { checked, body: captured.body() };
}

async function addTicket(
  pool: Awaited<ReturnType<typeof testDatabase>>["pool"],
  input: {
    id: string;
    tenant: string;
    user: string;
    code: string;
    state?: string;
    createdAt?: string;
    priority?: string;
    transitionAt?: string;
  },
) {
  await pool.query(
    `INSERT INTO helpdesk.tickets(
       id,tenant_id,ticket_code,title,description,requester_user_id,priority,state,
       source_channel,created_at,updated_at)
     VALUES($1,$2,$3,$4,'fixture',$5,$6,$7,'API',$8,$8)`,
    [
      input.id,
      input.tenant,
      input.code,
      input.code,
      input.user,
      input.priority ?? "P2",
      input.state ?? "NEW",
      input.createdAt ?? inside,
    ],
  );
  if (input.state && input.state !== "NEW")
    await pool.query(
      `INSERT INTO helpdesk.ticket_transitions(
         id,tenant_id,ticket_id,from_state,to_state,command_type,reason,
         actor_type,actor_id,correlation_id,occurred_at)
       VALUES($1,$2,$3,'RESOLVED',$4,'TEST.TRANSITION','acceptance','SYSTEM','test','corr',$5)`,
      [
        fixedId(),
        input.tenant,
        input.id,
        input.state,
        input.transitionAt ?? "2026-09-10T18:00:00.000Z",
      ],
    );
}

async function seedSession(
  pool: Awaited<ReturnType<typeof testDatabase>>["pool"],
  input: {
    tenant: string;
    articleId: string;
    outcome: string;
    deflection?: string | null;
    preTicket: boolean | null;
    at?: string;
  },
) {
  const id = fixedId();
  const resolved =
    input.outcome === "USER_RESOLVED" ? (input.at ?? inside) : null;
  const escalated = input.outcome === "ESCALATED" ? (input.at ?? inside) : null;
  await pool.query(
    `INSERT INTO problem.knowledge_recommendation_sessions(
       id,tenant_id,actor_id,support_context,normalized_context_hash,profile_id,
       profile_version,outcome,deflection_type,request_key,correlation_id,
       started_pre_ticket,resolved_at,escalated_at)
     VALUES($1,$2,'actor','{}','ctx','PROFILE',1,$3,$4,$5,'corr',$6,$7,$8)`,
    [
      id,
      input.tenant,
      input.outcome,
      input.deflection ?? null,
      id,
      input.preTicket,
      resolved,
      escalated,
    ],
  );
  const itemId = fixedId();
  await pool.query(
    `INSERT INTO problem.knowledge_recommendation_items(
       id,tenant_id,session_id,knowledge_id,knowledge_version,rank,score,evidence,
       eligibility_reference,eligibility_evidence,presented_at)
     VALUES($1,$2,$3,$4,1,1,80,'[]',$5,'{}',$6)`,
    [itemId, input.tenant, id, input.articleId, fixedId(), input.at ?? inside],
  );
  if (input.outcome === "NOT_HELPFUL")
    await pool.query(
      `INSERT INTO problem.knowledge_recommendation_interactions(
         id,tenant_id,session_id,item_id,actor_id,interaction_type,idempotency_key,
         request_hash,correlation_id,created_at)
       VALUES($1,$2,$3,$4,'actor','NOT_HELPFUL',$5,'hash','corr',$6)`,
      [fixedId(), input.tenant, id, itemId, id, input.at ?? inside],
    );
  return id;
}

async function addCost(
  pool: Awaited<ReturnType<typeof testDatabase>>["pool"],
  input: {
    tenant: string;
    basis: "ACTUAL" | "ADJUSTMENT" | "COMMITTED";
    amount: string;
    currency: string;
    effectiveAt: string;
    direction?: "CREDIT" | "DEBIT";
  },
) {
  const id = fixedId();
  await pool.query(
    `INSERT INTO procurement.cost_provenance(
       id,tenant_id,target_type,target_id,source_type,source_document_id,
       source_document_version_ref,cost_basis,adjustment_direction,source_amount,
       source_currency,quantity_basis,allocation_method,allocation_role,effective_from,
       idempotency_identity,correlation_id,audit_reference)
     VALUES($1,$2,'ASSET',$3,'INVOICE',$4,'v1',$5,$6,$7,$8,1,'TASK095_TEST','ACTUAL',$9,$10,'corr','audit')`,
    [
      id,
      input.tenant,
      fixedId(),
      fixedId(),
      input.basis,
      input.direction ?? null,
      input.amount,
      input.currency,
      input.effectiveAt,
      evidenceIdentity(id),
    ],
  );
}

test("TASK-095 PostgreSQL acceptance: all nine governed KPI formulas and domain boundaries", async () => {
  const db = await testDatabase();
  const tenant = `task095-${fixedId()}`;
  const otherTenant = `${tenant}-other`;
  const user = fixedId();
  const ids = {
    open: fixedId(),
    closed: fixedId(),
    otherTicket: fixedId(),
    root: fixedId(),
    childA: fixedId(),
    childB: fixedId(),
    standalone: fixedId(),
    workOpen: fixedId(),
    workClosed: fixedId(),
    article: fixedId(),
  };
  try {
    assert.deepEqual(Object.keys(KPI_CATALOG).sort(), [
      "ASSET_CRITICAL_RISK_COUNT",
      "ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT",
      "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
      "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT",
      "KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT",
      "OPS_ACTIONABLE_WORK_QUEUE_COUNT",
      "OPS_ACTIVE_INCIDENT_EPISODES_COUNT",
      "OPS_OPEN_TICKETS_COUNT",
      "PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY",
    ]);

    await db.pool.query(
      `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
       VALUES($1,$2,'U1','u1','User 1','ACTIVE'),($3,$4,'U2','u2','User 2','ACTIVE')`,
      [user, tenant, fixedId(), otherTenant],
    );
    await addTicket(db.pool, { id: ids.open, tenant, user, code: "OPEN" });
    await addTicket(db.pool, {
      id: ids.closed,
      tenant,
      user,
      code: "CLOSED",
      state: "CLOSED",
    });
    await addTicket(db.pool, {
      id: ids.otherTicket,
      tenant,
      user,
      code: "SLA-OTHER",
      priority: "P3",
    });
    await addTicket(db.pool, {
      id: fixedId(),
      tenant: otherTenant,
      user: (
        await db.pool.query<{ id: string }>(
          "SELECT id FROM identity.users WHERE tenant_id=$1",
          [otherTenant],
        )
      ).rows[0]!.id,
      code: "OTHER-TENANT",
    });

    const ticketCount = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "OPS_OPEN_TICKETS_COUNT",
        from: periodStart,
        to: periodEnd,
        asOf,
        dimensions: { priority: "P2" },
      }),
    );
    assert.equal(ticketCount.value, 1);
    assert.equal(ticketCount.status, "COMPLETE");
    assert.deepEqual(ticketCount.dimensions, { priority: "P2" });
    assert.deepEqual(ticketTerminalStates, ["CLOSED", "CANCELLED"]);
    assert.deepEqual(
      (
        await drilldown(db, tenant, "OPS_OPEN_TICKETS_COUNT", {
          priority: "P2",
        })
      ).map((row) => row.resource_id),
      [ids.open],
    );
    const emptyCount = await db.uow.run(`${tenant}-empty`, (tx) =>
      calculateKpi({
        tx,
        kpiId: "OPS_OPEN_TICKETS_COUNT",
        from: periodStart,
        to: periodEnd,
        asOf,
      }),
    );
    assert.equal(emptyCount.value, 0);
    assert.equal(emptyCount.status, "COMPLETE");

    await db.pool.query(
      `INSERT INTO incident.incidents(id,tenant_id,incident_code,title,source,priority,created_at,updated_at)
       VALUES($1,$2,'ROOT','Root','TEST','P1',$5,$5),($3,$2,'CH-A','Child A','TEST','P2',$5,$5),
             ($4,$2,'CH-B','Child B','TEST','P2',$5,$5),($6,$2,'SOLO','Standalone','TEST','P3',$5,$5)`,
      [ids.root, tenant, ids.childA, ids.childB, inside, ids.standalone],
    );
    for (const childId of [ids.childA, ids.childB])
      await db.pool.query(
        `INSERT INTO incident.root_relations(
           id,tenant_id,child_incident_id,root_incident_id,relation_state,origin,
           reason,linked_by_type,linked_by_id,linked_at)
         VALUES($1,$2,$3,$4,'ACTIVE','HUMAN','acceptance','USER','test',$5)`,
        [fixedId(), tenant, childId, ids.root, "2026-09-10T22:00:00.000Z"],
      );
    const incidents = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "OPS_ACTIVE_INCIDENT_EPISODES_COUNT",
        from: periodStart,
        to: periodEnd,
        asOf,
      }),
    );
    assert.equal(incidents.value, 2);
    assert.equal(incidents.status, "COMPLETE");
    assert.equal(
      (await drilldown(db, tenant, "OPS_ACTIVE_INCIDENT_EPISODES_COUNT"))
        .length,
      2,
    );

    await db.pool.query(
      `INSERT INTO operations.work_items(
         id,tenant_id,source_type,source_id,title,priority,owner_team_id,created_at,last_action_at)
       VALUES($1,$2,'TICKET',$3,'Actionable','HIGH','TEST',$5,$5),
             ($4,$2,'INCIDENT',$6,'Closed','LOW','TEST',$5,$5)`,
      [ids.workOpen, tenant, ids.open, ids.workClosed, inside, ids.standalone],
    );
    await db.pool.query(
      `UPDATE operations.work_items SET state='CLOSED',version=2,last_action_at=$3,resolved_at=$3
        WHERE tenant_id=$1 AND id=$2`,
      [tenant, ids.workClosed, "2026-09-10T20:00:00.000Z"],
    );
    const work = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "OPS_ACTIONABLE_WORK_QUEUE_COUNT",
        from: periodStart,
        to: periodEnd,
        asOf,
        dimensions: { priority: "HIGH", source_type: "TICKET" },
      }),
    );
    assert.equal(work.value, 1);
    assert.equal(work.status, "COMPLETE");
    assert.equal(
      (
        await drilldown(db, tenant, "OPS_ACTIONABLE_WORK_QUEUE_COUNT", {
          priority: "HIGH",
          source_type: "TICKET",
        })
      ).length,
      1,
    );

    const slaPolicy = fixedId();
    await db.pool.query(
      `INSERT INTO control.sla_policies(id,tenant_id,code,object_type,version,state)
       VALUES($1,$2,'TASK095','TICKET',1,'ACTIVE')`,
      [slaPolicy, tenant],
    );
    const targets = new Map<string, string>();
    for (const purpose of ["RESPONSE", "RESOLUTION", "RESTORE", "UNKNOWN"]) {
      const target = fixedId();
      targets.set(purpose, target);
      await db.pool.query(
        `INSERT INTO control.sla_targets(
           id,tenant_id,sla_policy_id,name,duration_minutes,start_condition,stop_condition,target_purpose)
         VALUES($1,$2,$3,$4,60,'start','stop',$5)`,
        [target, tenant, slaPolicy, `Misleading ${purpose}`, purpose],
      );
    }
    const addSlaOutcome = async (
      purpose: string,
      outcome: string,
      completedAt: string,
      ticketId = ids.open,
    ) => {
      await db.pool.query(
        `INSERT INTO control.sla_instances(
           id,tenant_id,object_type,object_id,target_id,policy_version,state,started_at,due_at,completed_at)
         VALUES($1,$2,'TICKET',$3,$4,1,$5,$6,$7,$8)`,
        [
          fixedId(),
          tenant,
          ticketId,
          targets.get(purpose),
          outcome,
          periodStart,
          periodEnd,
          completedAt,
        ],
      );
    };
    await addSlaOutcome("RESOLUTION", "MET", inside);
    await addSlaOutcome("RESOLUTION", "BREACHED", inside, ids.closed);
    await addSlaOutcome("RESPONSE", "MET", inside, ids.closed);
    await addSlaOutcome("RESTORE", "MET", inside, ids.closed);
    await addSlaOutcome("RESOLUTION", "MET", periodEnd, ids.otherTicket);
    const sla = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
        from: periodStart,
        to: periodEnd,
        asOf,
      }),
    );
    assert.equal(sla.numerator, 1);
    assert.equal(sla.denominator, 2);
    assert.equal(sla.value, 50);
    assert.equal(sla.status, "COMPLETE");
    const slaP2 = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
        from: periodStart,
        to: periodEnd,
        asOf,
        dimensions: { priority: "P2" },
      }),
    );
    assert.equal(slaP2.value, 50);
    const slaP1 = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
        from: periodStart,
        to: periodEnd,
        asOf,
        dimensions: { priority: "P1" },
      }),
    );
    assert.equal(slaP1.value, null);
    assert.equal(slaP1.status, "COMPLETE_EMPTY");
    assert.equal(
      (await drilldown(db, tenant, "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT"))
        .length,
      2,
    );
    const deniedSla = await deniedRouteDrilldown({
      db,
      tenant,
      user,
      kpiId: "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
    });
    assert.ok(deniedSla.checked.includes("ticket.read"));
    assert.deepEqual(
      (JSON.parse(deniedSla.body) as { data: unknown[] }).data,
      [],
    );
    const emptySla = await db.uow.run(otherTenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
        from: periodStart,
        to: periodEnd,
      }),
    );
    assert.equal(emptySla.value, null);
    assert.equal(emptySla.status, "COMPLETE_EMPTY");
    const emptyKnowledge = await db.uow.run(otherTenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT",
        from: periodStart,
        to: periodEnd,
      }),
    );
    assert.equal(emptyKnowledge.value, null);
    assert.equal(emptyKnowledge.status, "COMPLETE_EMPTY");
    await addSlaOutcome("UNKNOWN", "MET", inside, ids.otherTicket);
    const ambiguousSla = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
        from: periodStart,
        to: periodEnd,
        asOf,
      }),
    );
    assert.equal(ambiguousSla.status, "UNAVAILABLE");
    assert.equal(
      ambiguousSla.source_lineage.reason,
      "AMBIGUOUS_TARGET_PURPOSE",
    );
    const unambiguousPriority = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
        from: periodStart,
        to: periodEnd,
        asOf,
        dimensions: { priority: "P2" },
      }),
    );
    assert.equal(unambiguousPriority.status, "COMPLETE");
    assert.equal(unambiguousPriority.value, 50);
    const ambiguousPriority = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
        from: periodStart,
        to: periodEnd,
        asOf,
        dimensions: { priority: "P3" },
      }),
    );
    assert.equal(ambiguousPriority.status, "UNAVAILABLE");
    assert.equal(
      ambiguousPriority.source_lineage.reason,
      "AMBIGUOUS_TARGET_PURPOSE",
    );
    await assert.rejects(
      drilldown(db, tenant, "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT", {
        priority: "P3",
      }),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "DEPENDENCY_UNAVAILABLE",
    );
    assert.equal(
      (
        await drilldown(db, tenant, "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT", {
          priority: "P2",
        })
      ).length,
      2,
    );

    await db.pool.query(
      `INSERT INTO problem.knowledge_articles(id,tenant_id,slug,title,body,state)
       VALUES($1,$2,'task095','Acceptance','body','PUBLISHED')`,
      [ids.article, tenant],
    );
    await seedSession(db.pool, {
      tenant,
      articleId: ids.article,
      outcome: "USER_RESOLVED",
      deflection: "KNOWLEDGE_RESOLUTION",
      preTicket: true,
    });
    await seedSession(db.pool, {
      tenant,
      articleId: ids.article,
      outcome: "NOT_HELPFUL",
      preTicket: true,
    });
    await seedSession(db.pool, {
      tenant,
      articleId: ids.article,
      outcome: "ESCALATED",
      preTicket: true,
    });
    await seedSession(db.pool, {
      tenant,
      articleId: ids.article,
      outcome: "USER_RESOLVED",
      deflection: "KNOWN_INCIDENT_DEFLECTION",
      preTicket: true,
    });
    const knowledgeResolution = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT",
        from: periodStart,
        to: periodEnd,
      }),
    );
    assert.equal(knowledgeResolution.numerator, 1);
    assert.equal(knowledgeResolution.denominator, 3);
    assert.equal(knowledgeResolution.value, 100 / 3);
    assert.equal(
      (
        await drilldown(
          db,
          tenant,
          "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT",
        )
      ).length,
      3,
    );
    const deniedKnowledgeResolution = await deniedRouteDrilldown({
      db,
      tenant,
      user,
      kpiId: "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT",
    });
    assert.ok(
      deniedKnowledgeResolution.checked.includes(
        "knowledge.recommendation.read",
      ),
    );
    assert.deepEqual(
      (JSON.parse(deniedKnowledgeResolution.body) as { data: unknown[] }).data,
      [],
    );
    const deflections = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT",
        from: periodStart,
        to: periodEnd,
      }),
    );
    assert.equal(deflections.value, 1);
    assert.equal(deflections.status, "COMPLETE");
    assert.equal(
      (await drilldown(db, tenant, "KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT"))
        .length,
      1,
    );
    await seedSession(db.pool, {
      tenant,
      articleId: ids.article,
      outcome: "USER_RESOLVED",
      preTicket: true,
    });
    const ambiguousKnowledge = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "KNOWLEDGE_CONFIRMED_SELF_SERVICE_RESOLUTION_PCT",
        from: periodStart,
        to: periodEnd,
      }),
    );
    assert.equal(ambiguousKnowledge.status, "UNAVAILABLE");

    const category = fixedId();
    const model = fixedId();
    await db.pool.query(
      `INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,'TASK095')`,
      [category, tenant],
    );
    await db.pool.query(
      `INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id)
       VALUES($1,$2,'TASK095','Model',$3)`,
      [model, tenant, category],
    );
    const assetIds = [fixedId(), fixedId(), fixedId(), fixedId()];
    for (let index = 0; index < assetIds.length; index++)
      await db.pool.query(
        `INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$6)`,
        [
          assetIds[index],
          tenant,
          `A-${index}`,
          model,
          index === 3 ? "RETIRED" : "IN_USE",
          inside,
        ],
      );
    const insertRisk = async (
      assetId: string,
      band: string,
      validUntil: string,
      id: string,
    ) =>
      db.pool.query(
        `INSERT INTO asset.risk_assessments(
           id,tenant_id,asset_id,score,band,completeness,profile_id,profile_version,
           contributions,missing_evidence,evidence_references,evidence_identity,trigger,
           calculated_at,as_of,valid_until,correlation_id,actor_type,actor_id)
         VALUES($1,$2,$3,80,$4,100,'ASSET_RISK_V1','1','{}','[]','{}',$5,'TEST',$6,$6,$7,'corr','SYSTEM','test')`,
        [
          id,
          tenant,
          assetId,
          band,
          evidenceIdentity(id),
          new Date(Date.parse(validUntil) - 86_400_000).toISOString(),
          validUntil,
        ],
      );
    const riskIds = [fixedId(), fixedId(), fixedId(), fixedId()];
    await insertRisk(
      assetIds[0]!,
      "CRITICAL",
      "2026-09-11T12:00:00Z",
      riskIds[0]!,
    );
    await insertRisk(
      assetIds[1]!,
      "CRITICAL",
      "2026-09-10T23:00:00Z",
      riskIds[1]!,
    );
    await insertRisk(assetIds[2]!, "HIGH", "2026-09-11T12:00:00Z", riskIds[2]!);
    await insertRisk(
      assetIds[3]!,
      "CRITICAL",
      "2026-09-11T12:00:00Z",
      riskIds[3]!,
    );
    const replacementIds = [fixedId(), fixedId(), fixedId(), fixedId()];
    for (let index = 0; index < assetIds.length; index++)
      await db.pool.query(
        `INSERT INTO asset.replacement_assessments(
           id,tenant_id,asset_id,score,band,completeness,profile_id,profile_version,
           risk_assessment_id,contributions,missing_evidence,evidence_references,evidence_identity,
           trigger,calculated_at,as_of,valid_until,correlation_id,actor_type,actor_id)
         VALUES($1,$2,$3,70,$4,100,'ASSET_REPLACEMENT_V1','1',$5,'{}','[]','{}',$6,'TEST',$7,$7,$8,'corr','SYSTEM','test')`,
        [
          replacementIds[index],
          tenant,
          assetIds[index],
          ["PLAN", "PRIORITY", "REVIEW", "PRIORITY"][index],
          riskIds[index],
          evidenceIdentity(replacementIds[index]!),
          new Date(
            Date.parse(
              index === 1 ? "2026-09-10T23:00:00Z" : "2026-09-11T12:00:00Z",
            ) - 86_400_000,
          ).toISOString(),
          index === 1 ? "2026-09-10T23:00:00Z" : "2026-09-11T12:00:00Z",
        ],
      );
    for (let index = 0; index < assetIds.length; index++)
      await db.pool.query(
        `INSERT INTO asset.scoring_latest(tenant_id,asset_id,risk_assessment_id,replacement_assessment_id)
         VALUES($1,$2,$3,$4)`,
        [tenant, assetIds[index], riskIds[index], replacementIds[index]],
      );
    const risk = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "ASSET_CRITICAL_RISK_COUNT",
        from: periodStart,
        to: periodEnd,
        asOf,
        dimensions: { category_id: category },
      }),
    );
    assert.equal(risk.value, 1);
    assert.equal(
      (
        await drilldown(db, tenant, "ASSET_CRITICAL_RISK_COUNT", {
          category_id: category,
        })
      ).length,
      1,
    );
    const replacement = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT",
        from: periodStart,
        to: periodEnd,
        asOf,
        dimensions: { category_id: category },
      }),
    );
    assert.equal(replacement.value, 1);
    assert.equal(
      (
        await drilldown(db, tenant, "ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT", {
          category_id: category,
        })
      ).length,
      1,
    );

    await addCost(db.pool, {
      tenant,
      basis: "ACTUAL",
      amount: "100",
      currency: "VND",
      effectiveAt: periodStart,
    });
    await addCost(db.pool, {
      tenant,
      basis: "ADJUSTMENT",
      amount: "5",
      currency: "VND",
      direction: "CREDIT",
      effectiveAt: inside,
    });
    await addCost(db.pool, {
      tenant,
      basis: "COMMITTED",
      amount: "50",
      currency: "VND",
      effectiveAt: inside,
    });
    await addCost(db.pool, {
      tenant,
      basis: "ACTUAL",
      amount: "2",
      currency: "USD",
      effectiveAt: inside,
    });
    await addCost(db.pool, {
      tenant,
      basis: "ACTUAL",
      amount: "1000",
      currency: "VND",
      effectiveAt: periodEnd,
    });
    await addCost(db.pool, {
      tenant: otherTenant,
      basis: "ACTUAL",
      amount: "999",
      currency: "VND",
      effectiveAt: inside,
    });
    const priorTimezone = process.env.TZ;
    let spend: Awaited<ReturnType<typeof calculateKpi>>;
    try {
      process.env.TZ = "Pacific/Honolulu";
      spend = await db.uow.run(tenant, (tx) =>
        calculateKpi({
          tx,
          kpiId: "PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY",
          from: periodStart,
          to: periodEnd,
        }),
      );
    } finally {
      if (priorTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = priorTimezone;
    }
    assert.deepEqual(spend.value, [
      { currency: "USD", amount_minor: "2000000", minor_unit_scale: 6 },
      { currency: "VND", amount_minor: "95000000", minor_unit_scale: 6 },
    ]);
    assert.equal(
      (await drilldown(db, tenant, "PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY"))
        .length,
      3,
    );
    const emptySpend = await db.uow.run(tenant, (tx) =>
      calculateKpi({
        tx,
        kpiId: "PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY",
        from: "2026-09-12T00:00:00Z",
        to: "2026-09-13T00:00:00Z",
      }),
    );
    assert.equal(emptySpend.status, "COMPLETE_EMPTY");
    assert.deepEqual(emptySpend.value, []);

    const domainPermissions = [
      ["OPS_OPEN_TICKETS_COUNT", "ticket.read"],
      ["OPS_ACTIVE_INCIDENT_EPISODES_COUNT", "incident.read"],
      ["OPS_ACTIONABLE_WORK_QUEUE_COUNT", "work_item.read"],
      [
        "KNOWLEDGE_KNOWN_INCIDENT_DEFLECTION_COUNT",
        "knowledge.recommendation.read",
      ],
      ["ASSET_CRITICAL_RISK_COUNT", "asset.read"],
      ["ASSET_REPLACEMENT_PLAN_PRIORITY_COUNT", "asset.read"],
      ["PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY", "procurement.cost.read"],
    ] as const;
    for (const [kpiId, requiredPermission] of domainPermissions) {
      const denied = await deniedRouteDrilldown({ db, tenant, user, kpiId });
      assert.ok(
        denied.checked.includes(requiredPermission),
        `${kpiId} must reauthorize ${requiredPermission}`,
      );
      assert.deepEqual(
        (JSON.parse(denied.body) as { data: unknown[] }).data,
        [],
        `${kpiId} must hide unauthorized contribution rows`,
      );
    }
  } finally {
    await db.close();
  }
});

test("TASK-095 snapshots backfill late, deduplicate identical generations, and preserve revisions", async () => {
  const db = await testDatabase();
  const tenant = `task095-snapshot-${fixedId()}`;
  try {
    const user = fixedId();
    await db.pool.query(
      `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
       VALUES($1,$2,'U','u','User','ACTIVE')`,
      [user, tenant],
    );
    await addTicket(db.pool, {
      id: fixedId(),
      tenant,
      user,
      code: "INITIAL",
      createdAt: "2026-09-11T10:00:00.000Z",
    });
    await db.pool.query(
      `INSERT INTO identity.reporting_principals(
         id,tenant_id,service_identity,granted_capabilities)
       VALUES($1,$2,'reporting',ARRAY[
         'reporting.snapshot.materialize','ticket.reporting.read',
         'incident.reporting.read','work_queue.reporting.read','sla.reporting.read',
         'knowledge.reporting.read','asset.scoring.read','procurement.cost.read'
       ]::text[])`,
      [fixedId(), tenant],
    );
    const snapshotInput = {
      kpiId: "OPS_OPEN_TICKETS_COUNT" as const,
      from: "2026-09-11T00:00:00.000Z",
      to: "2026-09-12T00:00:00.000Z",
      asOf: "2026-09-12T00:00:00.000Z",
    };
    const sourceFailure = await db.uow.run(tenant, (tx) => {
      const failingTx = {
        tenantId: tx.tenantId,
        query(sql: string, values?: unknown[]) {
          if (sql.includes("WITH ticket_states"))
            return Promise.reject(new Error("simulated Ticket source failure"));
          return tx.query(sql, values);
        },
      } as unknown as Transaction;
      return calculateKpi({ tx: failingTx, ...snapshotInput });
    });
    assert.equal(sourceFailure.status, "UNAVAILABLE");
    assert.equal(sourceFailure.value, null);
    assert.equal(
      sourceFailure.source_lineage.reason,
      "SOURCE_QUERY_UNAVAILABLE",
    );
    const identical = await Promise.all([
      materializeReportingPeriod({
        uow: db.uow as UnitOfWork,
        tenantId: tenant,
        kpiId: snapshotInput.kpiId,
        periodStart: snapshotInput.from,
        periodEnd: snapshotInput.to,
      }),
      materializeReportingPeriod({
        uow: db.uow as UnitOfWork,
        tenantId: tenant,
        kpiId: snapshotInput.kpiId,
        periodStart: snapshotInput.from,
        periodEnd: snapshotInput.to,
      }),
    ]);
    assert.equal(identical.filter((entry) => entry.created).length, 1);
    assert.deepEqual(identical.map((entry) => entry.revision).sort(), [1, 1]);

    await addTicket(db.pool, {
      id: fixedId(),
      tenant,
      user,
      code: "CORRECTED-GENERATION",
      createdAt: "2026-09-11T11:00:00.000Z",
    });
    const revisions = await Promise.all([
      materializeReportingPeriod({
        uow: db.uow as UnitOfWork,
        tenantId: tenant,
        kpiId: snapshotInput.kpiId,
        periodStart: snapshotInput.from,
        periodEnd: snapshotInput.to,
      }),
      materializeReportingPeriod({
        uow: db.uow as UnitOfWork,
        tenantId: tenant,
        kpiId: snapshotInput.kpiId,
        periodStart: snapshotInput.from,
        periodEnd: snapshotInput.to,
      }),
    ]);
    assert.equal(revisions.filter((entry) => entry.created).length, 1);
    assert.deepEqual(revisions.map((entry) => entry.revision).sort(), [2, 2]);
    const latest = await db.uow.run(tenant, (tx) =>
      readKpiSnapshots({
        tx,
        kpiId: snapshotInput.kpiId,
        from: snapshotInput.from,
        to: snapshotInput.to,
      }),
    );
    assert.equal(latest.length, 1);
    assert.equal(latest[0]!.revision, 2);
    assert.equal(Number(latest[0]!.value), 2);
    const historical = await db.uow.run(tenant, (tx) =>
      readKpiSnapshots({
        tx,
        kpiId: snapshotInput.kpiId,
        from: snapshotInput.from,
        to: snapshotInput.to,
        revision: 1,
      }),
    );
    assert.equal(historical.length, 1);
    assert.equal(Number(historical[0]!.value), 1);
    await assert.rejects(
      db.pool.query(
        `UPDATE reporting.kpi_result_snapshots SET revision=99
          WHERE tenant_id=$1 AND kpi_id=$2 AND revision=1`,
        [tenant, snapshotInput.kpiId],
      ),
    );

    const late = await materializeReportingPeriod({
      uow: db.uow as UnitOfWork,
      tenantId: tenant,
      kpiId: snapshotInput.kpiId,
      periodStart: snapshotInput.from,
      periodEnd: snapshotInput.to,
    });
    assert.equal(late.created, false);
    assert.equal(late.revision, 2);
    assert.equal(
      (
        late.result.source_lineage.materialization as {
          fifteen_minute_target: string;
        }
      ).fifteen_minute_target,
      "LATE",
    );
    assert.equal(late.result.as_of, snapshotInput.to);
    assert.ok(
      Date.parse(late.result.generated_at) > Date.parse(snapshotInput.to),
    );
    const exportAuthentication: AuthenticationPort = {
      async authenticate() {
        return { id: user, tenant_id: tenant, actor_type: "USER" };
      },
    };
    const exportAuthorization: AuthorizationPort = {
      async evaluate() {
        return { result: "ALLOW", reason: "aggregate export permitted" };
      },
    };
    const capturedExport = responseCapture();
    await handleReportingRoute({
      req: {
        method: "GET",
        url: `/api/v1/kpis/OPS_OPEN_TICKETS_COUNT/export.csv?from=${snapshotInput.from}&to=${snapshotInput.to}&revision=1`,
        headers: { authorization: "Bearer acceptance" },
      } as IncomingMessage,
      res: capturedExport.response,
      context: {
        request_id: "req",
        correlation_id: "corr",
      } as CorrelationContext,
      authentication: exportAuthentication,
      authorization: exportAuthorization,
      uow: db.uow as UnitOfWork,
    });
    assert.ok(capturedExport.body().startsWith("tenant_id,kpi_id,kpi_version"));
    assert.ok(
      capturedExport.body().includes(`${tenant},OPS_OPEN_TICKETS_COUNT,1`),
    );
    assert.ok(capturedExport.body().includes(",1,"));
    const exportAudit = await db.pool.query<{
      event_type: string;
      after: Record<string, unknown>;
    }>(
      `SELECT event_type,after FROM audit.audit_events
        WHERE tenant_id=$1 AND event_type='REPORTING.KPI_CSV_EXPORTED'`,
      [tenant],
    );
    assert.equal(exportAudit.rowCount, 1);
    assert.equal(exportAudit.rows[0]!.after.revision, 1);
    assert.equal(exportAudit.rows[0]!.after.format, "CSV_AGGREGATE");
  } finally {
    await db.close();
  }
});

test("TASK-095 drill-down reauthorizes rows and hides unauthorized record metadata", async () => {
  const db = await testDatabase();
  const tenant = `task095-rbac-${fixedId()}`;
  try {
    const user = fixedId();
    const ticketId = fixedId();
    await db.pool.query(
      `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
       VALUES($1,$2,'U','u','User','ACTIVE')`,
      [user, tenant],
    );
    await addTicket(db.pool, {
      id: ticketId,
      tenant,
      user,
      code: "SECRET-TITLE",
    });
    const authentication: AuthenticationPort = {
      async authenticate() {
        return { id: user, tenant_id: tenant, actor_type: "USER" };
      },
    };
    const checked: string[] = [];
    const authorization: AuthorizationPort = {
      async evaluate(request) {
        checked.push(request.action);
        return {
          result: request.action === "ticket.read" ? "DENY" : "ALLOW",
          reason: "acceptance fixture",
        };
      },
    };
    const captured = responseCapture();
    const context = {
      request_id: "req",
      correlation_id: "corr",
    } as CorrelationContext;
    const handled = await handleReportingRoute({
      req: {
        method: "GET",
        url: `/api/v1/kpis/OPS_OPEN_TICKETS_COUNT/drilldown?from=${periodStart}&to=${periodEnd}&as_of=${asOf}`,
        headers: { authorization: "Bearer acceptance" },
      } as IncomingMessage,
      res: captured.response,
      context,
      authentication,
      authorization,
      uow: db.uow as UnitOfWork,
    });
    assert.equal(handled, true);
    assert.ok(checked.includes("metric.read"));
    assert.ok(checked.includes("ticket.read"));
    const responseBody = JSON.parse(captured.body()) as { data: unknown[] };
    assert.deepEqual(responseBody.data, []);
    assert.equal(captured.body().includes(ticketId), false);
    assert.equal(captured.body().includes("SECRET-TITLE"), false);

    const denyFinancial: AuthorizationPort = {
      async evaluate(request) {
        return {
          result: request.action === "procurement.cost.read" ? "DENY" : "ALLOW",
          reason: "financial access denied",
        };
      },
    };
    await assert.rejects(
      handleReportingRoute({
        req: {
          method: "GET",
          url: `/api/v1/kpis/PROCUREMENT_NET_ACTUAL_SPEND_BY_CURRENCY/current?from=${periodStart}&to=${periodEnd}`,
          headers: { authorization: "Bearer acceptance" },
        } as IncomingMessage,
        res: captured.response,
        context,
        authentication,
        authorization: denyFinancial,
        uow: db.uow as UnitOfWork,
      }),
      (error: unknown) =>
        error instanceof ApplicationError && error.code === "PERMISSION_DENIED",
    );

    const catalogCapture = responseCapture();
    await handleReportingRoute({
      req: {
        method: "GET",
        url: "/api/v1/kpis/catalog",
        headers: { authorization: "Bearer acceptance" },
      } as IncomingMessage,
      res: catalogCapture.response,
      context,
      authentication,
      authorization,
      uow: db.uow as UnitOfWork,
    });
    const catalogBody = JSON.parse(catalogCapture.body()) as {
      data: Array<{ kpi_id: string; dimensions: string[] }>;
    };
    assert.equal(catalogBody.data.length, 9);
    assert.deepEqual(
      catalogBody.data.find(
        (entry) => entry.kpi_id === "OPS_OPEN_TICKETS_COUNT",
      )?.dimensions,
      ["priority"],
    );
    assert.deepEqual(
      catalogBody.data.find(
        (entry) => entry.kpi_id === "HELPDESK_RESOLUTION_SLA_COMPLIANCE_PCT",
      )?.dimensions,
      ["priority"],
    );
    await assert.rejects(
      handleReportingRoute({
        req: {
          method: "GET",
          url: `/api/v1/kpis/OPS_OPEN_TICKETS_COUNT/current?from=${periodStart}&to=${periodEnd}&group_by=id`,
          headers: { authorization: "Bearer acceptance" },
        } as IncomingMessage,
        res: captured.response,
        context,
        authentication,
        authorization,
        uow: db.uow as UnitOfWork,
      }),
      (error: unknown) =>
        error instanceof ApplicationError && error.code === "VALIDATION_ERROR",
    );

    const denyExport: AuthorizationPort = {
      async evaluate(request) {
        return {
          result: request.action === "report.export" ? "DENY" : "ALLOW",
          reason: "export denied",
        };
      },
    };
    await assert.rejects(
      handleReportingRoute({
        req: {
          method: "GET",
          url: `/api/v1/kpis/OPS_OPEN_TICKETS_COUNT/export.csv?from=${periodStart}&to=${periodEnd}`,
          headers: { authorization: "Bearer acceptance" },
        } as IncomingMessage,
        res: captured.response,
        context,
        authentication,
        authorization: denyExport,
        uow: db.uow as UnitOfWork,
      }),
      (error: unknown) =>
        error instanceof ApplicationError && error.code === "PERMISSION_DENIED",
    );
  } finally {
    await db.close();
  }
});
