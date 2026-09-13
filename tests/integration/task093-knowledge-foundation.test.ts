import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createKnowledge,
  isKnowledgeSearchCandidateCurrent,
  queryKnowledgeRecommendationEligibility,
  readKnowledgeRecommendationEligibility,
  replaceKnowledgeApplicability,
  updateKnowledgeAudience,
  type KnowledgeApplicabilityResolver,
} from "../../modules/problem/index.js";
import {
  createIncident,
  incidentRecommendationContextQuery,
} from "../../modules/incident/index.js";
import {
  createPlatform,
  createService,
  createServiceEnvironment,
  platformQueryPort,
  serviceEnvironmentQueryPort,
  serviceQueryPort,
} from "../../modules/service/index.js";
import { readSoftwareProductReference } from "../../modules/software/index.js";
import { createTicket } from "../../modules/ticket/index.js";
import {
  findSearchCandidates,
  refreshSearchEntity,
} from "../../modules/search/index.js";
import { applySearchEvent } from "../../apps/worker/src/search-indexer.js";
import { event, testDatabase } from "../helpers.js";

test("TASK-093 R2 fail-closed Knowledge audience, typed applicability and Search projection", async () => {
  const db = await testDatabase();
  const tenant = `task093-r2-${randomUUID()}`;
  let serviceId = "";
  let platformId = "";
  let environmentId = "";
  const productId = randomUUID();
  const problemId = randomUUID();
  let articleId = "";
  const foreignTenant = `${tenant}-foreign`;
  let foreignServiceId = "";
  try {
    await db.uow.run(tenant, async (tx) => {
      const service = await createService({ tx, key: "ERP", name: "ERP" });
      const platform = await createPlatform({
        tx,
        key: "LINUX-TEST",
        family: "LINUX",
        name: "Ubuntu Test",
      });
      const environment = await createServiceEnvironment({
        tx,
        serviceId: service.id,
        key: "PRODUCTION",
        name: "Production",
      });
      serviceId = service.id;
      platformId = platform.id;
      environmentId = environment.id;
    });
    await db.uow.run(foreignTenant, async (tx) => {
      foreignServiceId = (
        await createService({
          tx,
          key: "FOREIGN",
          name: "Foreign Service",
        })
      ).id;
    });
    // IDs are created by the owner APIs and are retained for typed links.
    const refs = await db.uow.run(tenant, async (tx) => {
      const serviceResult = await tx.query<{ id: string }>(
        "SELECT id FROM service.services WHERE tenant_id=$1 AND key='ERP'",
        [tenant],
      );
      const platformResult = await tx.query<{ id: string }>(
        "SELECT id FROM service.platforms WHERE tenant_id=$1 AND key='LINUX-TEST'",
        [tenant],
      );
      const environmentResult = await tx.query<{ id: string }>(
        "SELECT id FROM service.environments WHERE tenant_id=$1 AND key='PRODUCTION'",
        [tenant],
      );
      const actualServiceId = serviceResult.rows[0]!.id;
      await tx.query(
        `INSERT INTO software.software_products(id,tenant_id,product_code,name,vendor,category,owner_id,support_team)
         VALUES($1,$2,'TASK093-R2','Foundation Product','vendor','software','owner','support')`,
        [productId, tenant],
      );
      await tx.query(
        `INSERT INTO problem.problems(id,tenant_id,code,title,state)
         VALUES($1,$2,'TASK093-KE','Known Error','KNOWN_ERROR')`,
        [problemId, tenant],
      );
      const article = await createKnowledge({
        tx,
        code: `TASK093-${randomUUID()}`,
        title: "R2 indexed knowledge unique phrase",
        body: "Governed body text used for retrieval",
      });
      articleId = article.id;
      await tx.query(
        "UPDATE problem.knowledge_articles SET state='PUBLISHED' WHERE tenant_id=$1 AND id=$2",
        [tenant, article.id],
      );
      return {
        serviceId: actualServiceId,
        platformId: platformResult.rows[0]!.id,
        environmentId: environmentResult.rows[0]!.id,
      };
    });
    assert.equal(refs.serviceId, serviceId);
    assert.equal(refs.platformId, platformId);
    assert.equal(refs.environmentId, environmentId);
    await db.uow.run(tenant, async (tx) => {
      const before = await readKnowledgeRecommendationEligibility({
        tx,
        knowledgeId: articleId,
        knowledgeVersion: 1,
      });
      assert.deepEqual(before, { eligible: false });
      const changed = await updateKnowledgeAudience({
        tx,
        id: articleId,
        expectedVersion: 1,
        audience: "END_USER_SAFE",
      });
      assert.equal(changed.after.audience, "END_USER_SAFE");
      const eligible = await readKnowledgeRecommendationEligibility({
        tx,
        knowledgeId: articleId,
        knowledgeVersion: 2,
      });
      assert.equal(eligible.eligible, true);
      const eligibilityContext = {
        request_id: "r2-request",
        correlation_id: "r2-correlation",
        causation_id: "r2-cause",
      };
      const allowKnowledgeRead = {
        async evaluate(request: { action: string }) {
          return {
            result:
              request.action === "knowledge.read"
                ? ("ALLOW" as const)
                : ("DENY" as const),
            reason: "test scoped read",
          };
        },
      };
      assert.equal(
        (
          await queryKnowledgeRecommendationEligibility({
            tx,
            authorization: allowKnowledgeRead,
            principal: {
              id: "end-user",
              tenant_id: tenant,
              actor_type: "USER",
            },
            context: eligibilityContext,
            knowledgeId: articleId,
            knowledgeVersion: 2,
          })
        ).eligible,
        true,
      );
      assert.deepEqual(
        await queryKnowledgeRecommendationEligibility({
          tx,
          authorization: {
            async evaluate() {
              return { result: "DENY", reason: "denied" };
            },
          },
          principal: { id: "end-user", tenant_id: tenant, actor_type: "USER" },
          context: eligibilityContext,
          knowledgeId: articleId,
          knowledgeVersion: 2,
        }),
        { eligible: false },
      );
      const resolver: KnowledgeApplicabilityResolver = async (
        targetTx,
        target,
      ) => {
        if (target.type === "SERVICE") {
          const value = await serviceQueryPort(targetTx).get(tenant, target.id);
          return { exists: Boolean(value), active: value?.state === "ACTIVE" };
        }
        if (target.type === "PLATFORM") {
          const value = await platformQueryPort(targetTx).get(
            tenant,
            target.id,
          );
          return { exists: Boolean(value), active: value?.state === "ACTIVE" };
        }
        if (target.type === "SERVICE_ENVIRONMENT") {
          const value = await serviceEnvironmentQueryPort(targetTx).get(
            tenant,
            target.id,
          );
          return { exists: Boolean(value), active: value?.state === "ACTIVE" };
        }
        if (target.type === "SOFTWARE_PRODUCT") {
          const value = await readSoftwareProductReference(targetTx, target.id);
          return { exists: Boolean(value), active: value?.active === true };
        }
        return { exists: false, active: false };
      };
      await replaceKnowledgeApplicability({
        tx,
        id: articleId,
        expectedVersion: 2,
        actorId: "knowledge-manager",
        targets: [
          { type: "SERVICE", id: refs.serviceId },
          { type: "PLATFORM", id: refs.platformId },
          { type: "SERVICE_ENVIRONMENT", id: refs.environmentId },
          { type: "SOFTWARE_PRODUCT", id: productId },
          { type: "KNOWN_ERROR", id: problemId },
        ],
        resolveTarget: resolver,
      });
      await refreshSearchEntity(tx, "KNOWLEDGE", articleId);
      const candidates = await findSearchCandidates({
        tx,
        q: "R2 indexed knowledge unique phrase",
        types: ["KNOWLEDGE"],
        limit: 10,
      });
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0]!.authorization_action, "knowledge.read");
      assert.equal(candidates[0]!.filter_fields.version, 3);
      const serviceOnlyResolver: KnowledgeApplicabilityResolver = async (
        targetTx,
        target,
      ) => {
        if (target.type === "SERVICE") {
          const value = await serviceQueryPort(targetTx).get(
            targetTx.tenantId,
            target.id,
          );
          return { exists: Boolean(value), active: value?.state === "ACTIVE" };
        }
        return { exists: false, active: false };
      };
      await assert.rejects(
        replaceKnowledgeApplicability({
          tx,
          id: articleId,
          expectedVersion: 3,
          actorId: "knowledge-manager",
          targets: [{ type: "SERVICE", id: foreignServiceId }],
          resolveTarget: serviceOnlyResolver,
        }),
        /Applicability target was not found/,
      );
      await assert.rejects(
        replaceKnowledgeApplicability({
          tx,
          id: articleId,
          expectedVersion: 3,
          actorId: "knowledge-manager",
          targets: [{ type: "SERVICE", id: "legacy-service-label" } as never],
          resolveTarget: serviceOnlyResolver,
        }),
        /Applicability target is invalid/,
      );
      await tx.query(
        "UPDATE service.services SET state='INACTIVE',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, refs.serviceId],
      );
      await assert.rejects(
        replaceKnowledgeApplicability({
          tx,
          id: articleId,
          expectedVersion: 3,
          actorId: "knowledge-manager",
          targets: [{ type: "SERVICE", id: refs.serviceId }],
          resolveTarget: serviceOnlyResolver,
        }),
        /Inactive applicability targets cannot be added/,
      );
    });
    const serviceEvent = {
      ...event(tenant),
      published_at: new Date().toISOString(),
      event_type: "SERVICE.DEACTIVATED",
      aggregate: { type: "SERVICE", id: refs.serviceId, version: 2 },
      payload: {},
    };
    assert.equal(await applySearchEvent(db.uow, serviceEvent), "processed");
    assert.equal(await applySearchEvent(db.uow, serviceEvent), "duplicate");
    await db.uow.run(tenant, async (tx) => {
      const refreshed = await findSearchCandidates({
        tx,
        q: "R2 indexed knowledge unique phrase",
        types: ["KNOWLEDGE"],
        limit: 10,
      });
      const applicable = refreshed[0]!.filter_fields.applicability as {
        type: string;
      }[];
      assert.equal(
        applicable.some((item) => item.type === "SERVICE"),
        false,
      );
      assert.equal(
        applicable.some((item) => item.type === "SERVICE_ENVIRONMENT"),
        false,
      );
      assert.equal(
        await isKnowledgeSearchCandidateCurrent({
          tx,
          knowledgeId: articleId,
          knowledgeVersion: 3,
          audience: "END_USER_SAFE",
        }),
        true,
      );
      await tx.query(
        "UPDATE problem.knowledge_articles SET state='ARCHIVED',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, articleId],
      );
      assert.equal(
        await isKnowledgeSearchCandidateCurrent({
          tx,
          knowledgeId: articleId,
          knowledgeVersion: 3,
          audience: "END_USER_SAFE",
        }),
        false,
      );
      await refreshSearchEntity(tx, "KNOWLEDGE", articleId, 4);
      const hidden = await findSearchCandidates({
        tx,
        q: "R2 indexed knowledge unique phrase",
        types: ["KNOWLEDGE"],
        limit: 10,
      });
      assert.equal(hidden.length, 0);
    });
  } finally {
    await db.close();
  }
});

test("TASK-093 R2 exposes only tenant-scoped Incident context and preserves typed Ticket source provenance", async () => {
  const db = await testDatabase();
  const tenant = `task093-r2-query-${randomUUID()}`;
  const serviceId = randomUUID();
  const userId = randomUUID();
  const sourceId = randomUUID();
  let sourcedTicketId = "";
  try {
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "INSERT INTO service.services(id,tenant_id,key,name) VALUES($1,$2,'MAIL','Mail Service')",
        [serviceId, tenant],
      );
      await tx.query(
        `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
         VALUES($1,$2,'TASK093-R2-USER','task093-r2-user','R2 User','ACTIVE')`,
        [userId, tenant],
      );
      const root = await createIncident({
        tx,
        incidentCode: "TASK093-R2-ROOT",
        title: "Mail outage",
        source: "TEST",
        priority: "P2",
        serviceId,
      });
      const child = await createIncident({
        tx,
        incidentCode: "TASK093-R2-CHILD",
        title: "Mailbox unavailable",
        source: "TEST",
        priority: "P2",
        serviceId,
      });
      await tx.query(
        `INSERT INTO incident.root_relations(id,tenant_id,child_incident_id,root_incident_id,
          relation_state,origin,reason,linked_by_type,linked_by_id)
         VALUES($1,$2,$3,$4,'ACTIVE','HUMAN','same outage','USER','operator')`,
        [randomUUID(), tenant, child.id, root.id],
      );
      const context = await incidentRecommendationContextQuery(tx).execute({
        incidentId: child.id,
      });
      assert.equal(context?.active_root?.id, root.id);
      assert.deepEqual(context?.service_ids, [serviceId]);
      assert.equal(
        await incidentRecommendationContextQuery(tx).execute({
          incidentId: randomUUID(),
        }),
        null,
      );
      const ticket = await createTicket({
        tx,
        ticketCode: "TASK093-R2-TICKET",
        title: "Mail issue",
        description: "Mailbox unavailable",
        requesterUserId: userId,
        priority: "P3",
        sourceChannel: "PORTAL",
        sourceContext: {
          type: "KNOWLEDGE_RECOMMENDATION",
          referenceId: sourceId,
        },
      });
      assert.deepEqual(ticket.source_context, {
        type: "KNOWLEDGE_RECOMMENDATION",
        reference_id: sourceId,
      });
      const persisted = await tx.query(
        "SELECT source_context_type,source_context_reference_id FROM helpdesk.tickets WHERE tenant_id=$1 AND id=$2",
        [tenant, ticket.id],
      );
      assert.equal(
        persisted.rows[0]!.source_context_type,
        "KNOWLEDGE_RECOMMENDATION",
      );
      sourcedTicketId = ticket.id;
      const ordinary = await createTicket({
        tx,
        ticketCode: "TASK093-R2-TICKET-LEGACY",
        title: "Ordinary issue",
        description: "No source context",
        requesterUserId: userId,
        priority: "P3",
        sourceChannel: "PORTAL",
      });
      assert.equal("source_context" in ordinary, false);
    });
    await assert.rejects(
      db.pool.query(
        "UPDATE helpdesk.tickets SET source_context_reference_id=$1 WHERE tenant_id=$2 AND id=$3",
        [randomUUID(), tenant, sourcedTicketId],
      ),
      /ticket source context is immutable/,
    );
  } finally {
    await db.close();
  }
});
