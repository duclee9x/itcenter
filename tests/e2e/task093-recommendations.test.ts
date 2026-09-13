import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { refreshSearchEntity } from "../../modules/search/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("TASK-093 recommendation presentation, feedback, resolution, and Ticket handoff preserve boundaries", async () => {
  const db = await testDatabase();
  const tenant = `task093-e2e-${randomUUID()}`;
  const actorId = randomUUID();
  const serviceId = randomUUID();
  const knownErrorId = randomUUID();
  const articleIds = Array.from({ length: 4 }, () => randomUUID());
  const operatorArticleId = randomUUID();
  let allowKnowledgeRead = true;
  let allowIncidentRead = true;
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
        return {
          result:
            request.action === "knowledge.read.operator" ||
            (request.action === "knowledge.read" && !allowKnowledgeRead) ||
            (request.action === "incident.read" && !allowIncidentRead)
              ? "DENY"
              : "ALLOW",
          reason: "TASK-093 isolated end-user policy",
        };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  const headers = {
    authorization: "Bearer test",
    "content-type": "application/json",
  };
  let primaryError: unknown;
  try {
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
         VALUES($1,$2,'TASK093-E2E','task093-e2e','Recommendation User','ACTIVE')`,
        [actorId, tenant],
      );
      await tx.query(
        `INSERT INTO service.services(id,tenant_id,key,name) VALUES($1,$2,'VPN','VPN Service')`,
        [serviceId, tenant],
      );
      await tx.query(
        `INSERT INTO problem.problems(id,tenant_id,code,title,state,workaround)
         VALUES($1,$2,'KE-TASK093','VPN connection timeout','KNOWN_ERROR','Approved reconnect guidance')`,
        [knownErrorId, tenant],
      );
      for (const [index, articleId] of articleIds.entries()) {
        await tx.query(
          `INSERT INTO problem.knowledge_articles(id,tenant_id,slug,title,body,state,audience)
           VALUES($1,$2,$3,$4,$5,'PUBLISHED','END_USER_SAFE')`,
          [
            articleId,
            tenant,
            `VPN-E2E-${index}`,
            `VPN connection timeout guide ${index}`,
            "Reconnect VPN using the approved steps.",
          ],
        );
        await tx.query(
          `INSERT INTO problem.knowledge_applicability(id,tenant_id,knowledge_id,target_type,service_id,created_by)
           VALUES($1,$2,$3,'SERVICE',$4,$5)`,
          [randomUUID(), tenant, articleId, serviceId, actorId],
        );
        await tx.query(
          `INSERT INTO problem.knowledge_applicability(id,tenant_id,knowledge_id,target_type,problem_id,created_by)
           VALUES($1,$2,$3,'KNOWN_ERROR',$4,$5)`,
          [randomUUID(), tenant, articleId, knownErrorId, actorId],
        );
        await refreshSearchEntity(tx, "KNOWLEDGE", articleId);
      }
      await tx.query(
        `INSERT INTO problem.knowledge_articles(id,tenant_id,slug,title,body,state,audience)
         VALUES($1,$2,'VPN-OPS-E2E','Secret VPN operator restart procedure','Privileged repair steps','PUBLISHED','OPERATOR_ONLY')`,
        [operatorArticleId, tenant],
      );
      await tx.query(
        `INSERT INTO problem.knowledge_applicability(id,tenant_id,knowledge_id,target_type,problem_id,created_by)
         VALUES($1,$2,$3,'KNOWN_ERROR',$4,$5)`,
        [randomUUID(), tenant, operatorArticleId, knownErrorId, actorId],
      );
      await refreshSearchEntity(tx, "KNOWLEDGE", operatorArticleId);
    });

    const createSession = async (key: string) =>
      fetch(`${url}/api/v1/knowledge/recommendation-sessions`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": key },
        body: JSON.stringify({
          support_context: {
            description: "VPN connection timeout",
            category: "VPN connection timeout",
            service_id: serviceId,
            known_error_id: knownErrorId,
          },
        }),
      });
    const createdResponse = await createSession("recommend-1");
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()) as {
      data: {
        id: string;
        outcome: string;
        profile_id: string;
        profile_version: number;
        version: number;
        recommendations: Array<{
          item_id: string;
          knowledge_id: string;
          knowledge_version: number;
          score: number;
          evidence: unknown[];
          eligibility_evidence: {
            decision: string;
            permission: string;
            audience: string;
            knowledge_version: number;
          };
          title: string;
          body: string;
        }>;
      };
    };
    assert.equal(created.data.outcome, "PRESENTED");
    assert.equal(created.data.profile_id, "TASK-093-SELF-SERVICE");
    assert.equal(created.data.profile_version, 1);
    assert.equal(created.data.recommendations.length, 3);
    assert.ok(
      created.data.recommendations.every(
        (item) =>
          item.score >= 70 &&
          item.knowledge_version === 1 &&
          item.evidence.length > 0 &&
          item.eligibility_evidence.decision === "ALLOW" &&
          item.eligibility_evidence.permission === "knowledge.read" &&
          item.eligibility_evidence.audience === "END_USER_SAFE" &&
          item.eligibility_evidence.knowledge_version === 1,
      ),
    );
    assert.ok(created.data.recommendations[0]!.body.includes("approved steps"));
    assert.doesNotMatch(
      JSON.stringify(created.data.recommendations),
      /Secret VPN operator/,
    );
    const replay = await createSession("recommend-1");
    assert.equal(replay.status, 201);
    const replayBody = (await replay.json()) as { data: { id: string } };
    assert.equal(replayBody.data.id, created.data.id);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM problem.knowledge_recommendation_sessions WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0]!.n,
      1,
    );

    const item = created.data.recommendations[0]!;
    const select = await fetch(
      `${url}/api/v1/knowledge/recommendation-sessions/${created.data.id}/commands/select`,
      {
        method: "POST",
        headers: { ...headers, "idempotency-key": "select-1" },
        body: JSON.stringify({ item_id: item.item_id, expected_version: 1 }),
      },
    );
    assert.equal(select.status, 200);
    const helpful = await fetch(
      `${url}/api/v1/knowledge/recommendation-sessions/${created.data.id}/commands/feedback`,
      {
        method: "POST",
        headers: { ...headers, "idempotency-key": "helpful-1" },
        body: JSON.stringify({
          item_id: item.item_id,
          feedback: "HELPFUL",
          expected_version: 1,
        }),
      },
    );
    assert.equal(helpful.status, 200);
    assert.equal(
      ((await helpful.json()) as { data: { outcome: string } }).data.outcome,
      "PRESENTED",
    );
    const confirm = () =>
      fetch(
        `${url}/api/v1/knowledge/recommendation-sessions/${created.data.id}/commands/confirm-resolution`,
        {
          method: "POST",
          headers: { ...headers, "idempotency-key": "resolve-1" },
          body: JSON.stringify({ expected_version: 1 }),
        },
      );
    const resolved = await confirm();
    assert.equal(resolved.status, 200);
    assert.equal(
      (
        (await resolved.json()) as {
          data: { outcome: string; deflection_type: string };
        }
      ).data.outcome,
      "USER_RESOLVED",
    );
    const resolutionReplay = await confirm();
    assert.equal(resolutionReplay.status, 200);
    const resolutionRows = await db.pool.query(
      `SELECT count(*)::int AS n FROM problem.knowledge_recommendation_interactions
        WHERE tenant_id=$1 AND session_id=$2 AND interaction_type='ISSUE_RESOLVED'`,
      [tenant, created.data.id],
    );
    assert.equal(resolutionRows.rows[0]!.n, 1);
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "UPDATE problem.knowledge_articles SET state='ARCHIVED',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, item.knowledge_id],
      );
    });
    const staleSession = await fetch(
      `${url}/api/v1/knowledge/recommendation-sessions/${created.data.id}`,
      { headers },
    );
    const staleBody = await staleSession.text();
    assert.equal(staleSession.status, 200);
    assert.doesNotMatch(staleBody, new RegExp(item.knowledge_id, "i"));
    assert.doesNotMatch(
      staleBody,
      new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    const escalationSessionResponse = await createSession("recommend-2");
    const escalationSession = (await escalationSessionResponse.json()) as {
      data: { id: string; recommendations: Array<{ item_id: string }> };
    };
    const notHelpful = await fetch(
      `${url}/api/v1/knowledge/recommendation-sessions/${escalationSession.data.id}/commands/feedback`,
      {
        method: "POST",
        headers: { ...headers, "idempotency-key": "not-helpful-1" },
        body: JSON.stringify({
          item_id: escalationSession.data.recommendations[0]!.item_id,
          feedback: "NOT_HELPFUL",
          expected_version: 1,
        }),
      },
    );
    assert.equal(notHelpful.status, 200);
    assert.equal(
      ((await notHelpful.json()) as { data: { outcome: string } }).data.outcome,
      "NOT_HELPFUL",
    );
    const escalate = () =>
      fetch(
        `${url}/api/v1/knowledge/recommendation-sessions/${escalationSession.data.id}/commands/escalate`,
        {
          method: "POST",
          headers: { ...headers, "idempotency-key": "escalate-1" },
          body: JSON.stringify({ expected_version: 2 }),
        },
      );
    const escalated = await escalate();
    assert.equal(escalated.status, 201);
    const escalatedBody = (await escalated.json()) as {
      data: {
        outcome: string;
        ticket_id: string;
        ticket: { source_context: { type: string; reference_id: string } };
      };
    };
    assert.equal(escalatedBody.data.outcome, "ESCALATED");
    assert.equal(
      escalatedBody.data.ticket.source_context.type,
      "KNOWLEDGE_RECOMMENDATION",
    );
    assert.equal(
      escalatedBody.data.ticket.source_context.reference_id,
      escalationSession.data.id,
    );
    const ticketContext = await db.pool.query<{
      description: string;
      state: string;
    }>(
      "SELECT description,state FROM helpdesk.tickets WHERE tenant_id=$1 AND id=$2",
      [tenant, escalatedBody.data.ticket_id],
    );
    assert.equal(ticketContext.rows[0]!.description, "VPN connection timeout");
    assert.equal(ticketContext.rows[0]!.state, "NEW");
    const escalationReplay = await escalate();
    assert.equal(escalationReplay.status, 201);
    const confirmAfterTicket = (key: string) =>
      fetch(
        `${url}/api/v1/knowledge/recommendation-sessions/${escalationSession.data.id}/commands/confirm-resolution`,
        {
          method: "POST",
          headers: { ...headers, "idempotency-key": key },
          body: JSON.stringify({ expected_version: 3 }),
        },
      );
    const firstPostTicketConfirmation = await confirmAfterTicket(
      "ticket-resolution-confirm-1",
    );
    assert.equal(firstPostTicketConfirmation.status, 200);
    const repeatedPostTicketConfirmation = await confirmAfterTicket(
      "ticket-resolution-confirm-2",
    );
    assert.equal(repeatedPostTicketConfirmation.status, 200);
    assert.equal(
      (
        await db.pool.query(
          `SELECT count(*)::int AS n FROM problem.knowledge_recommendation_interactions
            WHERE tenant_id=$1 AND session_id=$2 AND interaction_type='ISSUE_RESOLVED'`,
          [tenant, escalationSession.data.id],
        )
      ).rows[0]!.n,
      1,
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM helpdesk.tickets WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0]!.n,
      1,
    );

    const raceSessionResponse = await createSession("recommend-3");
    const raceSession = (await raceSessionResponse.json()) as {
      data: { id: string };
    };
    const raceCommand = (name: string, path: string) =>
      fetch(
        `${url}/api/v1/knowledge/recommendation-sessions/${raceSession.data.id}/commands/${path}`,
        {
          method: "POST",
          headers: { ...headers, "idempotency-key": `race-${name}` },
          body: JSON.stringify({ expected_version: 1 }),
        },
      );
    const race = await Promise.all([
      raceCommand("resolve", "confirm-resolution"),
      raceCommand("escalate", "escalate"),
    ]);
    assert.equal(race.filter((response) => response.ok).length, 1);
    const finalSession = await fetch(
      `${url}/api/v1/knowledge/recommendation-sessions/${raceSession.data.id}`,
      { headers },
    );
    assert.equal(finalSession.status, 200);
    const finalBody = (await finalSession.json()) as {
      data: { outcome: string };
    };
    assert.ok(["USER_RESOLVED", "ESCALATED"].includes(finalBody.data.outcome));
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM helpdesk.tickets WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0]!.n,
      1 + Number(finalBody.data.outcome === "ESCALATED"),
    );

    const noRecommendation = await fetch(
      `${url}/api/v1/knowledge/recommendation-sessions`,
      {
        method: "POST",
        headers: { ...headers, "idempotency-key": "no-recommendation-1" },
        body: JSON.stringify({
          support_context: {
            description: "Printer amber light blinks four times",
          },
        }),
      },
    );
    assert.equal(noRecommendation.status, 201);
    const noRecommendationBody = (await noRecommendation.json()) as {
      data: { id: string; outcome: string; recommendations: unknown[] };
    };
    assert.equal(noRecommendationBody.data.outcome, "NO_RECOMMENDATION");
    assert.equal(noRecommendationBody.data.recommendations.length, 0);
    const noRecommendationEscalation = await fetch(
      `${url}/api/v1/knowledge/recommendation-sessions/${noRecommendationBody.data.id}/commands/escalate`,
      {
        method: "POST",
        headers: {
          ...headers,
          "idempotency-key": "no-recommendation-escalate",
        },
        body: JSON.stringify({ expected_version: 1 }),
      },
    );
    assert.equal(noRecommendationEscalation.status, 201);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM helpdesk.tickets WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0]!.n,
      2 + Number(finalBody.data.outcome === "ESCALATED"),
    );

    allowKnowledgeRead = false;
    const accessRevoked = await fetch(
      `${url}/api/v1/knowledge/recommendation-sessions/${escalationSession.data.id}`,
      { headers },
    );
    const revokedBody = await accessRevoked.text();
    assert.equal(accessRevoked.status, 200);
    assert.doesNotMatch(revokedBody, /VPN connection timeout guide/);

    allowIncidentRead = false;
    const unauthorizedIncidentContext = await fetch(
      `${url}/api/v1/knowledge/recommendation-sessions`,
      {
        method: "POST",
        headers: { ...headers, "idempotency-key": "denied-incident-context" },
        body: JSON.stringify({
          support_context: {
            description: "VPN connection timeout",
            incident_id: randomUUID(),
          },
        }),
      },
    );
    assert.equal(unauthorizedIncidentContext.status, 403);

    const immutableEvidence = await db.pool.query(
      "SELECT count(*)::int AS n FROM problem.knowledge_recommendation_items WHERE tenant_id=$1",
      [tenant],
    );
    assert.equal(immutableEvidence.rows[0]!.n, 9);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await close(server);
    try {
      await db.close();
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
    }
  }
});
