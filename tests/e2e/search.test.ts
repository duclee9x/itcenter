import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { apiServer } from "../../apps/api/src/server.js";
import { loadConfig } from "../../packages/config/src/index.js";
import type { UnitOfWork } from "../../packages/persistence/src/index.js";
import {
  exactCanonicalFallback,
  refreshSearchEntity,
} from "../../modules/search/index.js";
import { testDatabase } from "../helpers.js";

const config = loadConfig({
  DATABASE_SECRET_REF: "env:TEST",
  APP_ENV: "test",
  LOG_LEVEL: "error",
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("search ranks exact identifiers, binds cursors and filters denied rows", async () => {
  const db = await testDatabase();
  const principalId = randomUUID();
  const ticketIds = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ];
  const deniedIds = new Set<string>();
  try {
    await db.pool.query(
      `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
       VALUES($1,'tenant-a','USR-SEARCH','search-user','Search User','ACTIVE')`,
      [principalId],
    );
    const tickets = [
      [ticketIds[0]!, "SRCH-01", "Cursor Máy chủ alert"],
      [ticketIds[1]!, "SRCH-02", "Cursor Máy chủ private denied details"],
      [ticketIds[2]!, "SRCH-03", "Cursor SRCH-02 appears in notes"],
    ];
    await db.uow.run("tenant-a", async (tx) => {
      for (const [id, code, title] of tickets) {
        await tx.query(
          `INSERT INTO helpdesk.tickets(id,tenant_id,ticket_code,title,description,requester_user_id)
           VALUES($1,$2,$3,$4,'search integration fixture',$5)`,
          [id, "tenant-a", code, title, principalId],
        );
        await refreshSearchEntity(tx, "TICKET", id!);
      }
    });

    const server = apiServer(
      config,
      async () => true,
      {
        async authenticate() {
          return { id: principalId, tenant_id: "tenant-a", actor_type: "USER" };
        },
      },
      {
        async evaluate(request) {
          if (request.action === "search.reindex")
            return { result: "ALLOW", reason: "search test operator" };
          assert.equal(request.action, "ticket.read");
          return {
            result: deniedIds.has(request.resource.id) ? "DENY" : "ALLOW",
            reason: "search test policy",
          };
        },
      },
      db.uow,
    );
    const url = await listen(server);
    const get = (path: string) =>
      fetch(url + path, { headers: { authorization: "Bearer verified" } });
    try {
      const exact = await get("/api/v1/search?q=SRCH-02&types=TICKET");
      assert.equal(exact.status, 200);
      const exactBody = (await exact.json()) as {
        data: { id: string; score: number }[];
      };
      assert.equal(exactBody.data[0]?.id, ticketIds[1]);
      assert.equal(exactBody.data[0]?.score, 100);

      const punctuationOnly = await get("/api/v1/search?q=%21%21%21");
      assert.equal(punctuationOnly.status, 400);

      const normalized = await get("/api/v1/search?q=may%20chu&types=TICKET");
      assert.equal(normalized.status, 200);
      assert.equal(
        ((await normalized.json()) as { data: unknown[] }).data.length,
        2,
      );

      const firstPage = await get(
        "/api/v1/search?q=cursor&types=TICKET&limit=1",
      );
      const firstBody = (await firstPage.json()) as {
        data: { id: string }[];
        meta: { next_cursor: string | null };
      };
      assert.equal(firstBody.data.length, 1);
      assert.ok(firstBody.meta.next_cursor);

      deniedIds.add(ticketIds[1]!);
      const secondPage = await get(
        `/api/v1/search?q=cursor&types=TICKET&limit=1&cursor=${encodeURIComponent(firstBody.meta.next_cursor!)}`,
      );
      const secondBody = (await secondPage.json()) as {
        data: { id: string; title: string }[];
      };
      assert.equal(secondBody.data.length, 1);
      assert.equal(secondBody.data[0]?.id, ticketIds[2]);
      assert.ok(!JSON.stringify(secondBody).includes("private denied details"));

      const changedQuery = await get(
        `/api/v1/search?q=other&types=TICKET&cursor=${encodeURIComponent(firstBody.meta.next_cursor!)}`,
      );
      assert.equal(changedQuery.status, 400);

      const autocomplete = await get(
        "/api/v1/search/autocomplete?q=SRCH&types=TICKET",
      );
      const autocompleteBody = (await autocomplete.json()) as {
        data: { id: string }[];
      };
      assert.ok(autocompleteBody.data.every((row) => row.id !== ticketIds[1]));

      const reindexRequest = () =>
        fetch(url + "/api/v1/search/reindex", {
          method: "POST",
          headers: {
            authorization: "Bearer verified",
            "content-type": "application/json",
            "idempotency-key": "search-reindex-page-one",
          },
          body: JSON.stringify({
            entity_type: "TICKET",
            limit: 2,
            reason: "Rebuild derived search documents",
          }),
        });
      const reindex = await reindexRequest();
      assert.equal(reindex.status, 200);
      const reindexBody = (await reindex.json()) as {
        data: { indexed: number; next_id: string | null };
      };
      assert.equal(reindexBody.data.indexed, 2);
      assert.ok(reindexBody.data.next_id);
      const retry = await reindexRequest();
      assert.equal(retry.status, 200);
      assert.deepEqual(
        ((await retry.json()) as { data: unknown }).data,
        reindexBody.data,
      );
    } finally {
      await close(server);
    }
  } finally {
    await db.close();
  }
});

test("search falls back to exact canonical lookups when the index is unavailable", async () => {
  const db = await testDatabase();
  const principalId = randomUUID();
  const secondUserId = randomUUID();
  const ticketId = randomUUID();
  try {
    await db.pool.query(
      `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
       VALUES($1,'tenant-a','USR-FALLBACK','fallback-user','Fallback User','ACTIVE')`,
      [principalId],
    );
    await db.pool.query(
      `INSERT INTO identity.users(id,tenant_id,display_code,username,display_name,employment_status)
       VALUES($1,'tenant-a','USR-EXACT-9001','EXACT-9001','Exact User','ACTIVE')`,
      [secondUserId],
    );
    await db.pool.query(
      `INSERT INTO helpdesk.tickets(id,tenant_id,ticket_code,title,description,requester_user_id)
       VALUES($1,'tenant-a','EXACT-9001','Canonical record','fallback fixture',$2)`,
      [ticketId, principalId],
    );
    const fallbackCandidates = await db.uow.run("tenant-a", (tx) =>
      exactCanonicalFallback({
        tx,
        q: "EXACT-9001",
        types: ["TICKET", "USER"],
      }),
    );
    assert.ok(fallbackCandidates.some((row) => row.entity_id === ticketId));
    assert.ok(fallbackCandidates.some((row) => row.entity_id === secondUserId));
    const unavailableIndex: UnitOfWork = {
      run(tenantId, work) {
        return db.uow.run(tenantId, (tx) =>
          work({
            tenantId,
            query(sql, values) {
              if (sql.includes("FROM operations.search_documents"))
                return Promise.reject(
                  new Error("search projection unavailable"),
                );
              return tx.query(sql, values);
            },
          }),
        );
      },
    };
    const server = apiServer(
      config,
      async () => true,
      {
        async authenticate() {
          return { id: principalId, tenant_id: "tenant-a", actor_type: "USER" };
        },
      },
      {
        async evaluate() {
          return { result: "ALLOW", reason: "search fallback test" };
        },
      },
      unavailableIndex,
    );
    const url = await listen(server);
    try {
      const response = await fetch(
        `${url}/api/v1/search?q=EXACT-9001&limit=1`,
        { headers: { authorization: "Bearer verified" } },
      );
      const responseText = await response.text();
      assert.equal(response.status, 200, responseText);
      const body = JSON.parse(responseText) as {
        data: { id: string }[];
        meta: { index_state: string; next_cursor: string | null };
      };
      assert.equal(body.data[0]?.id, ticketId);
      assert.equal(body.meta.index_state, "DEGRADED");
      assert.ok(body.meta.next_cursor);
      const filtered = await fetch(
        `${url}/api/v1/search?q=EXACT-9001&state=NEW`,
        { headers: { authorization: "Bearer verified" } },
      );
      const filteredBody = (await filtered.json()) as {
        data: { id: string }[];
      };
      assert.deepEqual(
        filteredBody.data.map((row) => row.id),
        [ticketId],
      );
      const next = await fetch(
        `${url}/api/v1/search?q=EXACT-9001&limit=1&cursor=${encodeURIComponent(body.meta.next_cursor!)}`,
        { headers: { authorization: "Bearer verified" } },
      );
      const nextBody = (await next.json()) as { data: { id: string }[] };
      assert.equal(nextBody.data[0]?.id, secondUserId);
    } finally {
      await close(server);
    }
  } finally {
    await db.close();
  }
});
