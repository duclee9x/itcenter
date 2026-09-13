import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { apiServer } from "../../apps/api/src/server.js";
import { applySearchEvent } from "../../apps/worker/src/search-indexer.js";
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

test("Knowledge read/search enforce audience and canonical version; TICKET.CREATE preserves optional typed source context", async () => {
  const db = await testDatabase();
  const tenant = `task093-r2-e2e-${randomUUID()}`;
  const actorId = randomUUID();
  const safeId = randomUUID();
  const operatorId = randomUUID();
  const recommendationId = randomUUID();
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
        const allow = request.action !== "knowledge.read.operator";
        return {
          result: allow ? "ALLOW" : "DENY",
          reason: "audience test policy",
        };
      },
    },
    db.uow,
  );
  const url = await listen(server);
  try {
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
         VALUES($1,$2,'TASK093-R2-E2E','task093-r2-e2e','Self Service User','ACTIVE')`,
        [actorId, tenant],
      );
      await tx.query(
        `INSERT INTO problem.knowledge_articles(id,tenant_id,slug,title,body,state,audience)
         VALUES($1,$3,'SAFE-E2E','Safe article distinctive term','Safe article body','PUBLISHED','END_USER_SAFE'),
               ($2,$3,'OPS-E2E','Secret operator article distinctive term','Privileged instructions','PUBLISHED','OPERATOR_ONLY')`,
        [safeId, operatorId, tenant],
      );
      await refreshSearchEntity(tx, "KNOWLEDGE", safeId);
      await refreshSearchEntity(tx, "KNOWLEDGE", operatorId);
    });
    const headers = {
      authorization: "Bearer test",
      "content-type": "application/json",
    };
    const safeRead = await fetch(`${url}/api/v1/knowledge/${safeId}`, {
      headers,
    });
    assert.equal(safeRead.status, 200);
    const deniedOperatorRead = await fetch(
      `${url}/api/v1/knowledge/${operatorId}`,
      { headers },
    );
    assert.equal(deniedOperatorRead.status, 403);

    const search = await fetch(
      `${url}/api/v1/search?q=distinctive%20term&types=KNOWLEDGE`,
      { headers },
    );
    assert.equal(search.status, 200);
    const searchBody = await search.text();
    assert.match(searchBody, /Safe article distinctive term/);
    assert.doesNotMatch(searchBody, /Secret operator article/);

    const audienceChange = () =>
      fetch(`${url}/api/v1/knowledge/${safeId}/commands/set-audience`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": "knowledge-audience-change" },
        body: JSON.stringify({
          expected_version: 1,
          audience: "OPERATOR_ONLY",
          reason: "Procedure is restricted to operators",
        }),
      });
    const changed = await audienceChange();
    assert.equal(changed.status, 200);
    const replayedChange = await audienceChange();
    assert.equal(replayedChange.status, 200);
    const changedEvent = await db.pool.query<{ payload: never }>(
      `SELECT payload FROM platform.outbox_events
        WHERE tenant_id=$1 AND aggregate_type='KNOWLEDGE' AND aggregate_id=$2
          AND event_type='KNOWLEDGE.UPDATED' ORDER BY created_at DESC LIMIT 1`,
      [tenant, safeId],
    );
    assert.equal(
      await applySearchEvent(db.uow, changedEvent.rows[0]!.payload),
      "processed",
    );
    const indexedPermission = await db.pool.query(
      `SELECT authorization_action,source_version FROM operations.search_documents
        WHERE tenant_id=$1 AND entity_type='KNOWLEDGE' AND entity_id=$2`,
      [tenant, safeId],
    );
    assert.equal(
      indexedPermission.rows[0]!.authorization_action,
      "knowledge.read.operator",
    );
    assert.equal(Number(indexedPermission.rows[0]!.source_version), 2);
    const audienceDeniedRead = await fetch(
      `${url}/api/v1/knowledge/${safeId}`,
      { headers },
    );
    assert.equal(audienceDeniedRead.status, 403);

    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "UPDATE problem.knowledge_articles SET state='ARCHIVED',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, safeId],
      );
    });
    const staleSearch = await fetch(
      `${url}/api/v1/search?q=distinctive%20term&types=KNOWLEDGE`,
      { headers },
    );
    const staleBody = await staleSearch.text();
    assert.equal(staleSearch.status, 200);
    assert.doesNotMatch(staleBody, /Safe article distinctive term/);

    const createTicket = (ticketCode: string) =>
      fetch(`${url}/api/v1/tickets`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": `create-${ticketCode}` },
        body: JSON.stringify({
          ticket_code: ticketCode,
          title: "Issue after self-service",
          description: "Context carried forward",
          requester_user_id: actorId,
          priority: "P3",
          source_channel: "PORTAL",
          ...(ticketCode.endsWith("WITH-SOURCE")
            ? {
                source_context: {
                  type: "KNOWLEDGE_RECOMMENDATION",
                  reference_id: recommendationId,
                },
              }
            : {}),
        }),
      });
    const sourcedResponse = await createTicket("TASK093-WITH-SOURCE");
    assert.equal(sourcedResponse.status, 201);
    const sourced = (await sourcedResponse.json()) as {
      data: {
        id: string;
        source_context: { type: string; reference_id: string };
      };
    };
    assert.deepEqual(sourced.data.source_context, {
      type: "KNOWLEDGE_RECOMMENDATION",
      reference_id: recommendationId,
    });
    const replayedResponse = await createTicket("TASK093-WITH-SOURCE");
    assert.equal(replayedResponse.status, 201);
    const replayed = (await replayedResponse.json()) as {
      data: { id: string };
    };
    assert.equal(replayed.data.id, sourced.data.id);
    const plainResponse = await createTicket("TASK093-PLAIN");
    assert.equal(plainResponse.status, 201);
    const plain = (await plainResponse.json()) as {
      data: Record<string, unknown>;
    };
    assert.equal("source_context" in plain.data, false);
    const persisted = await db.pool.query(
      `SELECT source_context_type,source_context_reference_id FROM helpdesk.tickets
        WHERE tenant_id=$1 AND ticket_code='TASK093-WITH-SOURCE'`,
      [tenant],
    );
    assert.equal(
      persisted.rows[0]!.source_context_type,
      "KNOWLEDGE_RECOMMENDATION",
    );
    assert.equal(persisted.rowCount, 1);
  } finally {
    await close(server);
    await db.close();
  }
});
