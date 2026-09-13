import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { apiServer } from "../../apps/api/src/server.js";
import { createIncident } from "../../modules/incident/index.js";
import { PostgresOutboxWriter } from "../../packages/messaging/src/index.js";
import { loadConfig } from "../../packages/config/src/index.js";
import type { EventEnvelope } from "../../packages/event-contracts/src/index.js";
import { testDatabase } from "../helpers.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("correlation attach/detach API enforces command idempotency and writes history", async () => {
  const db = await testDatabase();
  const tenant = `correlation-api-${randomUUID()}`;
  const actorId = randomUUID();
  let incidentId = "";
  let rootIncidentId = "";
  let decisionId = "";
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
      async evaluate() {
        return { result: "ALLOW", reason: "correlation API test" };
      },
    },
    db.uow,
  );
  try {
    await db.uow.run(tenant, async (tx) => {
      const root = await createIncident({
        tx,
        incidentCode: "API-ROOT",
        title: "Root incident",
        source: "test",
        priority: "P2",
      });
      const child = await createIncident({
        tx,
        incidentCode: "API-CHILD",
        title: "Child incident",
        source: "test",
        priority: "P2",
      });
      rootIncidentId = root.id;
      incidentId = child.id;
      const sourceEventId = randomUUID();
      const correlationId = randomUUID();
      const sourceEvent: EventEnvelope = {
        event_id: sourceEventId,
        event_type: "INCIDENT.CREATED",
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        producer: { service: "test", instance: "integration" },
        aggregate: { type: "INCIDENT", id: child.id, version: 1 },
        actor: { type: "USER", id: actorId },
        correlation_id: correlationId,
        causation_id: randomUUID(),
        tenant_id: tenant,
        organization_id: tenant,
        idempotency_key: randomUUID(),
        payload: { incident_id: child.id },
      };
      await new PostgresOutboxWriter(tx).append(sourceEvent);
      await tx.query(
        `INSERT INTO incident.correlation_decisions
          (id,tenant_id,subject_incident_id,source_event_id,evaluation_identity,profile_id,profile_version,evidence_fingerprint,outcome,confidence,reason_code,candidate_count,decision_evidence,actor_type,actor_id,correlation_id)
         VALUES($1,$2,$3,$4,$5,'TASK-092-V1',1,'api','REVIEW_REQUIRED',70,'CORRELATION_AMBIGUOUS',1,'{}','SYSTEM_CORRELATION','test',$6)`,
        [
          randomUUID(),
          tenant,
          child.id,
          sourceEventId,
          randomUUID(),
          correlationId,
        ],
      );
      decisionId = (
        await tx.query<{ id: string }>(
          "SELECT id FROM incident.correlation_decisions WHERE tenant_id=$1 AND subject_incident_id=$2",
          [tenant, child.id],
        )
      ).rows[0]!.id;
    });
    const base = await listen(server);
    const post = (path: string, body: object, key: string) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify(body),
      });
    const attachBody = {
      expected_version: 1,
      decision_id: decisionId,
      root_incident_id: rootIncidentId,
      reason: "Operator confirmed the shared incident scope",
    };
    const attachKey = randomUUID();
    const firstAttach = await post(
      `/api/v1/incidents/${incidentId}/commands/correlation-attach`,
      attachBody,
      attachKey,
    );
    assert.equal(firstAttach.status, 200);
    const replayAttach = await post(
      `/api/v1/incidents/${incidentId}/commands/correlation-attach`,
      attachBody,
      attachKey,
    );
    assert.equal(replayAttach.status, 200);
    const originalAttachResult = (await firstAttach.json()) as {
      data: unknown;
    };
    const replayAttachResult = (await replayAttach.json()) as {
      data: unknown;
    };
    assert.deepEqual(replayAttachResult.data, originalAttachResult.data);
    const detachKey = randomUUID();
    const detach = await post(
      `/api/v1/incidents/${incidentId}/commands/correlation-detach`,
      { expected_version: 2, reason: "Operator removed the grouping" },
      detachKey,
    );
    assert.equal(detach.status, 200);
    assert.equal(
      ((await detach.json()) as { data: { relation_state: string } }).data
        .relation_state,
      "DETACHED",
    );
    const history = await fetch(
      `${base}/api/v1/incidents/${incidentId}/correlations`,
      {
        headers: { authorization: "Bearer test" },
      },
    );
    assert.equal(history.status, 200);
    await db.uow.run(tenant, async (tx) => {
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM audit.audit_events WHERE tenant_id=$1 AND event_type IN ('INCIDENT.LINKED_TO_ROOT','INCIDENT.DETACHED_FROM_ROOT')",
            [tenant],
          )
        ).rowCount,
        2,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM platform.outbox_events WHERE tenant_id=$1 AND event_type IN ('INCIDENT.LINKED_TO_ROOT','INCIDENT.DETACHED_FROM_ROOT')",
            [tenant],
          )
        ).rowCount,
        2,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM operations.timeline_events WHERE tenant_id=$1 AND entity_id=$2 AND event_type IN ('INCIDENT.LINKED_TO_ROOT','INCIDENT.DETACHED_FROM_ROOT')",
            [tenant, incidentId],
          )
        ).rowCount,
        2,
      );
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
