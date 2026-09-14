import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

test("TASK-096 feed exposes each source availability and enforces recommendation authorization", async () => {
  const db = await testDatabase();
  const tenant = `task096-api-${randomUUID()}`;
  const server = apiServer(
    loadConfig({
      DATABASE_SECRET_REF: "env:TEST",
      APP_ENV: "test",
      LOG_LEVEL: "error",
    }),
    async () => true,
    {
      async authenticate() {
        return {
          id: "recommendation-reader",
          tenant_id: tenant,
          actor_type: "USER",
        };
      },
    },
    {
      async evaluate() {
        return { result: "ALLOW", reason: "TASK-096 acceptance grant" };
      },
    },
    db.uow,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/recommendations`,
      {
        headers: { authorization: "Bearer task096-test" },
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const result = (await response.json()) as {
      data: unknown[];
      availability: Record<string, { status: string }>;
    };
    assert.deepEqual(result.data, []);
    assert.deepEqual(result.availability, {
      INCIDENT_CORRELATION_REVIEW: { status: "AVAILABLE_EMPTY" },
      KNOWLEDGE_GUIDANCE: { status: "AVAILABLE_EMPTY" },
      ASSET_REPLACEMENT_REVIEW: { status: "AVAILABLE_EMPTY" },
    });

    const recommendationId = randomUUID();
    const sourceId = randomUUID();
    const revisionId = randomUUID();
    const sessionId = randomUUID();
    const generation = { session_id: sessionId, item_id: sourceId };
    await db.pool.query(
      `INSERT INTO recommendation.recommendations(
         id,tenant_id,family,source_domain,source_type,source_id,contexts,
         current_state,source_generation_key,latest_revision,initial_provenance,
         created_at,refreshed_at
       ) VALUES($1,$2,'KNOWLEDGE_GUIDANCE','KNOWLEDGE','KNOWLEDGE_RECOMMENDATION_ITEM',
         $3,$4,'ACTIVE','test-generation',1,'INITIAL_RECONCILIATION',now(),now())`,
      [
        recommendationId,
        tenant,
        sourceId,
        JSON.stringify([{ type: "RECOMMENDATION_SESSION", id: sessionId }]),
      ],
    );
    await db.pool.query(
      `INSERT INTO recommendation.recommendation_revisions(
         id,tenant_id,recommendation_id,revision,source_generation_key,
         source_generation,source_version,reason_codes,evidence_summary,
         freshness,generated_at
       ) VALUES($1,$2,$3,1,'test-generation',$4,'{}','{}','{}','{}',now())`,
      [revisionId, tenant, recommendationId, JSON.stringify(generation)],
    );
    const hidden = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/recommendations/${recommendationId}`,
      { headers: { authorization: "Bearer task096-test" } },
    );
    assert.equal(hidden.status, 404);
    const interaction = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/recommendations/${recommendationId}/commands/interact`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer task096-test",
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({ interaction: "DISMISSED", revision: 1 }),
      },
    );
    assert.equal(interaction.status, 404);
    const interactionCount = await db.pool.query<{ count: string }>(
      `SELECT count(*) FROM recommendation.recommendation_interactions
        WHERE tenant_id=$1 AND recommendation_id=$2`,
      [tenant, recommendationId],
    );
    assert.equal(interactionCount.rows[0]!.count, "0");

    const invalid = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/recommendations?family=AI_RECOMMENDATION`,
      { headers: { authorization: "Bearer task096-test" } },
    );
    assert.equal(invalid.status, 400);

    const partialServer = apiServer(
      loadConfig({
        DATABASE_SECRET_REF: "env:TEST",
        APP_ENV: "test",
        LOG_LEVEL: "error",
      }),
      async () => true,
      {
        async authenticate() {
          return {
            id: "recommendation-reader",
            tenant_id: tenant,
            actor_type: "USER",
          };
        },
      },
      {
        async evaluate(request) {
          return request.action === "incident.correlation.read"
            ? { result: "DENY", reason: "Incident source unavailable to actor" }
            : { result: "ALLOW", reason: "source read allowed" };
        },
      },
      db.uow,
    );
    await new Promise<void>((resolve) =>
      partialServer.listen(0, "127.0.0.1", resolve),
    );
    try {
      const partialAddress = partialServer.address() as AddressInfo;
      const partialResponse = await fetch(
        `http://127.0.0.1:${partialAddress.port}/api/v1/recommendations`,
        { headers: { authorization: "Bearer task096-test" } },
      );
      assert.equal(partialResponse.status, 200);
      const partial = (await partialResponse.json()) as {
        availability: Record<string, { status: string }>;
      };
      assert.deepEqual(partial.availability, {
        INCIDENT_CORRELATION_REVIEW: {
          status: "SOURCE_UNAVAILABLE",
          reason: "SOURCE_ACCESS_DENIED",
        },
        KNOWLEDGE_GUIDANCE: { status: "AVAILABLE_EMPTY" },
        ASSET_REPLACEMENT_REVIEW: { status: "AVAILABLE_EMPTY" },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        (partialServer as Server).close((error) =>
          error ? reject(error) : resolve(),
        ),
      );
    }

    const deniedServer = apiServer(
      loadConfig({
        DATABASE_SECRET_REF: "env:TEST",
        APP_ENV: "test",
        LOG_LEVEL: "error",
      }),
      async () => true,
      {
        async authenticate() {
          return {
            id: "recommendation-reader",
            tenant_id: tenant,
            actor_type: "USER",
          };
        },
      },
      {
        async evaluate() {
          return { result: "DENY", reason: "missing recommendation.read" };
        },
      },
      db.uow,
    );
    await new Promise<void>((resolve) =>
      deniedServer.listen(0, "127.0.0.1", resolve),
    );
    try {
      const deniedAddress = deniedServer.address() as AddressInfo;
      const denied = await fetch(
        `http://127.0.0.1:${deniedAddress.port}/api/v1/recommendations`,
        {
          headers: { authorization: "Bearer task096-test" },
        },
      );
      assert.equal(denied.status, 403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        (deniedServer as Server).close((error) =>
          error ? reject(error) : resolve(),
        ),
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      (server as Server).close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
