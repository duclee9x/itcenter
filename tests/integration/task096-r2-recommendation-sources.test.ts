import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AuthorizationPort } from "../../packages/auth/src/index.js";
import type { Transaction } from "../../packages/persistence/src/index.js";
import { ApplicationError } from "../../packages/api-contracts/src/index.js";
import { PostgresOutboxWriter } from "../../packages/messaging/src/index.js";
import {
  attachIncidentToRoot,
  detachIncidentFromRoot,
  queryIncidentCorrelationRecommendationSource,
  createIncident,
} from "../../modules/incident/index.js";
import { queryReplacementCandidateRecommendationSource } from "../../modules/asset/index.js";
import { testDatabase } from "../helpers.js";

const principal = (tenant_id: string) => ({
  id: "recommendation-source-reader",
  tenant_id,
  actor_type: "USER",
});
const allow: AuthorizationPort = {
  async evaluate() {
    return { result: "ALLOW", reason: "test grant" };
  },
};
const deny: AuthorizationPort = {
  async evaluate() {
    return { result: "DENY", reason: "no grant" };
  },
};

async function decisionFixture(
  db: Awaited<ReturnType<typeof testDatabase>>,
  tenant: string,
  outcome: "REVIEW_REQUIRED" | "AUTO_LINK" | "NO_LINK",
  code: string,
  options: {
    withCandidate?: boolean;
    rootState?: string;
    subjectId?: string;
  } = {},
) {
  const eventId = randomUUID();
  const decisionId = randomUUID();
  await db.uow.run(tenant, async (tx) => {
    const subject = await createIncident({
      tx,
      incidentCode: `${code}-SUBJECT`,
      title: "source subject",
      source: "TEST",
      priority: "P2",
    });
    const root = await createIncident({
      tx,
      incidentCode: `${code}-ROOT`,
      title: "source root",
      source: "TEST",
      priority: "P2",
    });
    const decisionSubjectId = options.subjectId ?? subject.id;
    await tx.query(
      "UPDATE incident.incidents SET state=$1,version=version+1,updated_at=now() WHERE tenant_id=$2 AND id=$3",
      [options.rootState ?? "INVESTIGATING", tenant, root.id],
    );
    await new PostgresOutboxWriter(tx).append({
      event_id: eventId,
      event_type: "INCIDENT.CREATED",
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      producer: { service: "task096-r2-test", instance: "integration" },
      aggregate: { type: "INCIDENT", id: decisionSubjectId, version: 1 },
      actor: { type: "USER", id: principal(tenant).id },
      correlation_id: `corr-${code}`,
      causation_id: randomUUID(),
      tenant_id: tenant,
      organization_id: tenant,
      idempotency_key: `event-${code}`,
      payload: { incident_id: decisionSubjectId },
    });
    await tx.query(
      `INSERT INTO incident.correlation_decisions
       (id,tenant_id,subject_incident_id,source_event_id,evaluation_identity,profile_id,profile_version,evidence_fingerprint,outcome,selected_root_incident_id,confidence,reason_code,candidate_count,decision_evidence,actor_type,actor_id,correlation_id)
       VALUES($1,$2,$3,$4,$5,'TASK-092-V1',1,$6,$7,$8,77,'AMBIGUOUS_CANDIDATES',$9,'{}','SYSTEM_CORRELATION','test',$10)`,
      [
        decisionId,
        tenant,
        decisionSubjectId,
        eventId,
        `evaluation-${code}`,
        `fingerprint-${code}`,
        outcome,
        outcome === "AUTO_LINK" ? root.id : null,
        options.withCandidate === false ? 0 : 1,
        `corr-${code}`,
      ],
    );
    if (options.withCandidate !== false)
      await tx.query(
        `INSERT INTO incident.correlation_decision_candidates
         (id,tenant_id,decision_id,candidate_root_incident_id,raw_score,confidence,strong_signals,eligible,evidence)
         VALUES($1,$2,$3,$4,72,77,'["SAME_SERVICE"]',true,'{"contributions":[{"code":"SAME_SERVICE","points":72}]}'::jsonb)`,
        [randomUUID(), tenant, decisionId, root.id],
      );
  });
  const subject = options.subjectId
    ? { rows: [{ id: options.subjectId }] }
    : await db.pool.query<{ id: string }>(
        "SELECT id FROM incident.incidents WHERE tenant_id=$1 AND incident_code=$2",
        [tenant, `${code}-SUBJECT`],
      );
  const root = await db.pool.query<{ id: string }>(
    "SELECT id FROM incident.incidents WHERE tenant_id=$1 AND incident_code=$2",
    [tenant, `${code}-ROOT`],
  );
  return {
    subjectId: subject.rows[0]!.id,
    rootId: root.rows[0]!.id,
    decisionId,
  };
}

async function assetFixture(
  db: Awaited<ReturnType<typeof testDatabase>>,
  tenant: string,
  band: "PLAN" | "PRIORITY" | "REVIEW",
  state = "UNDER_REVIEW",
  current = true,
  stale = false,
) {
  const categoryId = randomUUID();
  const modelId = randomUUID();
  const assetId = randomUUID();
  const assessmentId = randomUUID();
  const latestAssessmentId = current ? assessmentId : randomUUID();
  const candidateId = randomUUID();
  await db.pool.query(
    "INSERT INTO asset.categories(id,tenant_id,name) VALUES($1,$2,$3)",
    [categoryId, tenant, `category-${assetId}`],
  );
  await db.pool.query(
    "INSERT INTO asset.models(id,tenant_id,manufacturer,model_name,category_id) VALUES($1,$2,'test',$3,$4)",
    [modelId, tenant, `model-${assetId}`, categoryId],
  );
  await db.pool.query(
    "INSERT INTO asset.assets(id,tenant_id,asset_code,asset_model_id,lifecycle_state) VALUES($1,$2,$3,$4,'IN_USE')",
    [assetId, tenant, `asset-${assetId}`, modelId],
  );
  await db.pool.query(
    `INSERT INTO asset.replacement_assessments
     (id,tenant_id,asset_id,score,band,completeness,profile_id,profile_version,contributions,missing_evidence,evidence_references,evidence_identity,trigger,calculated_at,as_of,valid_until,correlation_id,actor_type,actor_id)
     VALUES($1,$2,$3,85,$4,80,'TASK-094-REPLACEMENT','1','{"risk":{"score":34}}','[]','{}',$5,'EVIDENCE_CHANGED',CASE WHEN $6 THEN now()-interval '25 hours' ELSE now()-interval '1 hour' END,CASE WHEN $6 THEN now()-interval '25 hours' ELSE now()-interval '1 hour' END,CASE WHEN $6 THEN now()-interval '1 hour' ELSE now()+interval '23 hours' END,'corr','SYSTEM','scoring')`,
    [assessmentId, tenant, assetId, band, "a".repeat(64), stale],
  );
  if (!current)
    await db.pool.query(
      `INSERT INTO asset.replacement_assessments
       (id,tenant_id,asset_id,score,band,completeness,profile_id,profile_version,contributions,missing_evidence,evidence_references,evidence_identity,trigger,calculated_at,as_of,valid_until,correlation_id,actor_type,actor_id)
       VALUES($1,$2,$3,70,'PLAN',70,'TASK-094-REPLACEMENT','1','{}','[]','{}',$4,'EVIDENCE_CHANGED',now()-interval '1 hour',now()-interval '1 hour',now()+interval '23 hours','corr','SYSTEM','scoring')`,
      [latestAssessmentId, tenant, assetId, "b".repeat(64)],
    );
  await db.pool.query(
    "INSERT INTO asset.scoring_latest(tenant_id,asset_id,replacement_assessment_id) VALUES($1,$2,$3)",
    [tenant, assetId, latestAssessmentId],
  );
  await db.pool.query(
    `INSERT INTO asset.replacement_plans
     (id,tenant_id,asset_id,state,score,reasons,assessment,recommendation_assessment_id,scoring_profile_id,scoring_profile_version,reason,created_by)
     VALUES($1,$2,$3,$4,85,'["HIGH_REPLACEMENT_PRIORITY"]','{}',$5,'TASK-094-REPLACEMENT','1','test candidate','test')`,
    [candidateId, tenant, assetId, state, assessmentId],
  );
  return { assetId, assessmentId, candidateId };
}

test("TASK-096-R2 Incident source exposes only latest eligible REVIEW decision with stable canonical evidence", async () => {
  const db = await testDatabase();
  const tenant = `task096-r2-incident-${randomUUID()}`;
  try {
    const review = await decisionFixture(
      db,
      tenant,
      "REVIEW_REQUIRED",
      "review",
    );
    await decisionFixture(
      db,
      `foreign-${tenant}`,
      "REVIEW_REQUIRED",
      "foreign",
    );
    await decisionFixture(db, tenant, "AUTO_LINK", "auto");
    await decisionFixture(db, tenant, "NO_LINK", "none");
    const replacedReview = await decisionFixture(
      db,
      tenant,
      "REVIEW_REQUIRED",
      "superseded",
    );
    await decisionFixture(db, tenant, "NO_LINK", "superseding", {
      subjectId: replacedReview.subjectId,
      withCandidate: false,
    });
    const resolved = await decisionFixture(
      db,
      tenant,
      "REVIEW_REQUIRED",
      "resolved",
    );
    await db.pool.query(
      `INSERT INTO incident.correlation_reviews(id,tenant_id,decision_id,subject_incident_id,result,actor_id,reason,correlation_id)
       VALUES($1,$2,$3,$4,'REJECTED','operator','reviewed','corr')`,
      [randomUUID(), tenant, resolved.decisionId, resolved.subjectId],
    );
    const attached = await decisionFixture(
      db,
      tenant,
      "REVIEW_REQUIRED",
      "attached",
    );
    await db.uow.run(tenant, (tx) =>
      attachIncidentToRoot({
        tx,
        incidentId: attached.subjectId,
        rootIncidentId: attached.rootId,
        decisionId: attached.decisionId,
        expectedVersion: 1,
        actorId: "operator",
        reason: "Confirmed common Root",
        correlationId: "manual-review",
      }),
    );
    const suppressed = await decisionFixture(
      db,
      tenant,
      "REVIEW_REQUIRED",
      "suppressed",
    );
    await db.uow.run(tenant, async (tx) => {
      await attachIncidentToRoot({
        tx,
        incidentId: suppressed.subjectId,
        rootIncidentId: suppressed.rootId,
        decisionId: suppressed.decisionId,
        expectedVersion: 1,
        actorId: "operator",
        reason: "Temporary canonical link",
        correlationId: "manual-review",
      });
      await detachIncidentFromRoot({
        tx,
        incidentId: suppressed.subjectId,
        expectedVersion: 2,
        actorId: "operator",
        reason: "Detach suppresses this proposed relationship",
      });
    });

    const result = await db.uow.run(tenant, (tx) =>
      queryIncidentCorrelationRecommendationSource({
        tx,
        tenant_id: tenant,
        principal: principal(tenant),
        authorization: allow,
        correlation_id: "feed",
      }),
    );
    assert.equal(result.availability, "AVAILABLE");
    if (result.availability !== "AVAILABLE") return;
    assert.deepEqual(
      result.items.map((item) => item.decision_id),
      [review.decisionId],
    );
    assert.equal(result.items[0]!.source_generation, review.decisionId);
    assert.equal(result.items[0]!.profile_id, "TASK-092-V1");
    assert.equal(result.items[0]!.profile_version, 1);
    assert.deepEqual(result.items[0]!.reason_codes, ["AMBIGUOUS_CANDIDATES"]);
    assert.deepEqual(result.items[0]!.candidates[0]!.evidence_categories, [
      "SAME_SERVICE",
    ]);
    assert.ok(
      !result.items.some(
        (item) => item.decision_id === replacedReview.decisionId,
      ),
    );
    assert.ok(
      !result.items.some((item) => item.decision_id === attached.decisionId),
    );
    assert.ok(
      !result.items.some((item) => item.decision_id === suppressed.decisionId),
    );

    const incidentDenied: AuthorizationPort = {
      async evaluate(request) {
        return {
          result:
            request.action === "incident.correlation.read" ? "ALLOW" : "DENY",
          reason: "source Incident read denied",
        };
      },
    };
    const hidden = await db.uow.run(tenant, (tx) =>
      queryIncidentCorrelationRecommendationSource({
        tx,
        tenant_id: tenant,
        principal: principal(tenant),
        authorization: incidentDenied,
        correlation_id: "hidden",
      }),
    );
    assert.deepEqual(hidden, {
      availability: "AVAILABLE_EMPTY",
      items: [],
      next_offset: null,
    });

    const scoped = await db.uow.run(tenant, (tx) =>
      queryIncidentCorrelationRecommendationSource({
        tx,
        tenant_id: tenant,
        principal: principal(tenant),
        authorization: allow,
        correlation_id: "feed",
        incident_id: review.subjectId,
      }),
    );
    assert.equal(scoped.availability, "AVAILABLE");
    if (scoped.availability === "AVAILABLE")
      assert.equal(scoped.items.length, 1);

    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        queryIncidentCorrelationRecommendationSource({
          tx,
          tenant_id: tenant,
          principal: principal(tenant),
          authorization: deny,
          correlation_id: "denied",
        }),
      ),
      (error: unknown) =>
        error instanceof ApplicationError && error.code === "PERMISSION_DENIED",
    );
  } finally {
    await db.close();
  }
});

test("TASK-096-R2 Replacement source requires active review, linked current fresh PLAN/PRIORITY assessment, and scoped read", async () => {
  const db = await testDatabase();
  const tenant = `task096-r2-asset-${randomUUID()}`;
  try {
    const priority = await assetFixture(db, tenant, "PRIORITY");
    const plan = await assetFixture(db, tenant, "PLAN");
    await assetFixture(db, tenant, "REVIEW");
    await assetFixture(db, tenant, "PLAN", "CANCELLED");
    await assetFixture(db, tenant, "PLAN", "UNDER_REVIEW", false);
    await assetFixture(db, tenant, "PLAN", "UNDER_REVIEW", true, true);
    const result = await db.uow.run(tenant, (tx) =>
      queryReplacementCandidateRecommendationSource({
        tx,
        tenant_id: tenant,
        principal: principal(tenant),
        authorization: allow,
        correlation_id: "feed",
        as_of: new Date().toISOString(),
      }),
    );
    assert.equal(result.availability, "AVAILABLE");
    if (result.availability !== "AVAILABLE") return;
    assert.deepEqual(
      new Set(result.items.map((item) => item.candidate_id)),
      new Set([priority.candidateId, plan.candidateId]),
    );
    const priorityItem = result.items.find(
      (item) => item.candidate_id === priority.candidateId,
    )!;
    assert.equal(priorityItem.assessment_id, priority.assessmentId);
    assert.equal(priorityItem.band, "PRIORITY");
    assert.equal(priorityItem.freshness, "CURRENT");
    assert.deepEqual(priorityItem.source_generation, {
      candidate_id: priority.candidateId,
      candidate_version: 1,
      assessment_id: priority.assessmentId,
    });
    assert.ok(
      !result.items.some(
        (item) =>
          item.candidate_id === priority.candidateId &&
          item.candidate_state !== "UNDER_REVIEW",
      ),
    );

    const empty = await db.uow.run(tenant, (tx) =>
      queryReplacementCandidateRecommendationSource({
        tx,
        tenant_id: tenant,
        principal: principal(tenant),
        authorization: allow,
        correlation_id: "empty",
        asset_id: randomUUID(),
      }),
    );
    assert.equal(empty.availability, "AVAILABLE_EMPTY");
    const hiddenAsset: AuthorizationPort = {
      async evaluate(request) {
        return {
          result: request.resource.id === tenant ? "ALLOW" : "DENY",
          reason: "resource Asset read denied",
        };
      },
    };
    const hidden = await db.uow.run(tenant, (tx) =>
      queryReplacementCandidateRecommendationSource({
        tx,
        tenant_id: tenant,
        principal: principal(tenant),
        authorization: hiddenAsset,
        correlation_id: "hidden",
      }),
    );
    assert.deepEqual(hidden, {
      availability: "AVAILABLE_EMPTY",
      items: [],
      next_offset: null,
    });
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        queryReplacementCandidateRecommendationSource({
          tx,
          tenant_id: tenant,
          principal: principal(tenant),
          authorization: deny,
          correlation_id: "denied",
        }),
      ),
      (error: unknown) =>
        error instanceof ApplicationError && error.code === "PERMISSION_DENIED",
    );
    await assert.rejects(
      db.uow.run("other-tenant", (tx) =>
        queryReplacementCandidateRecommendationSource({
          tx,
          tenant_id: tenant,
          principal: principal(tenant),
          authorization: allow,
          correlation_id: "cross-tenant",
        }),
      ),
      (error: unknown) =>
        error instanceof ApplicationError && error.code === "PERMISSION_DENIED",
    );
  } finally {
    await db.close();
  }
});

test("TASK-096-R2 query failures remain SOURCE_UNAVAILABLE rather than AVAILABLE_EMPTY", async () => {
  const tenant = "source-failure-tenant";
  const tx = {
    tenantId: tenant,
    async query(sql: string) {
      if (/^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT)/.test(sql))
        return { rows: [], rowCount: 0 };
      throw new Error("injected source outage");
    },
  } as never;
  const result = await queryReplacementCandidateRecommendationSource({
    tx,
    tenant_id: tenant,
    principal: principal(tenant),
    authorization: allow,
    correlation_id: "failure",
  });
  assert.deepEqual(result, {
    availability: "SOURCE_UNAVAILABLE",
    items: [],
    reason: "SOURCE_QUERY_FAILED",
  });
  const incidentResult = await queryIncidentCorrelationRecommendationSource({
    tx,
    tenant_id: tenant,
    principal: principal(tenant),
    authorization: allow,
    correlation_id: "failure",
  });
  assert.deepEqual(incidentResult, {
    availability: "SOURCE_UNAVAILABLE",
    items: [],
    reason: "SOURCE_QUERY_FAILED",
  });
});

test("TASK-096-R2 failed PostgreSQL source reads roll back to savepoint and leave the transaction usable", async () => {
  const db = await testDatabase();
  const tenant = `task096-r2-savepoint-${randomUUID()}`;
  try {
    const result = await db.uow.run(tenant, async (tx) => {
      const brokenTx = {
        tenantId: tx.tenantId,
        query(sql: string, values?: unknown[]) {
          if (sql.includes("WITH latest_decisions"))
            return tx.query(
              "SELECT missing_source_column FROM incident.incidents",
            );
          return tx.query(sql, values);
        },
      } as unknown as Transaction;
      const source = await queryIncidentCorrelationRecommendationSource({
        tx: brokenTx,
        tenant_id: tenant,
        principal: principal(tenant),
        authorization: allow,
        correlation_id: "savepoint",
      });
      const recovered = await tx.query<{ value: number }>("SELECT 1 AS value");
      assert.equal(Number(recovered.rows[0]!.value), 1);
      return source;
    });
    assert.equal(result.availability, "SOURCE_UNAVAILABLE");
  } finally {
    await db.close();
  }
});
