import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../helpers.js";
import {
  createIncident,
  attachIncidentToRoot,
  detachIncidentFromRoot,
} from "../../modules/incident/index.js";
import { PostgresOutboxWriter } from "../../packages/messaging/src/index.js";
import {
  processIncidentCorrelationEvent,
  recordIncidentCorrelationProcessingFailure,
} from "../../apps/worker/src/incident-correlation.js";
import type { EventEnvelope } from "../../packages/event-contracts/src/index.js";

test("manual Root attach/detach preserves history, lifecycle and suppression", async () => {
  const db = await testDatabase();
  const tenant = `correlation-${randomUUID()}`;
  try {
    await db.uow.run(tenant, async (tx) => {
      const root = await createIncident({
        tx,
        incidentCode: "ROOT-1",
        title: "Root",
        source: "test",
        priority: "P2",
      });
      const child = await createIncident({
        tx,
        incidentCode: "CHILD-1",
        title: "Child",
        source: "test",
        priority: "P2",
      });
      const cause: EventEnvelope = {
        event_id: randomUUID(),
        event_type: "INCIDENT.CREATED",
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        producer: { service: "test", instance: "integration" },
        aggregate: { type: "INCIDENT", id: child.id, version: 1 },
        actor: { type: "USER", id: "operator" },
        correlation_id: randomUUID(),
        causation_id: randomUUID(),
        tenant_id: tenant,
        organization_id: tenant,
        idempotency_key: randomUUID(),
        payload: { id: child.id },
      };
      await new PostgresOutboxWriter(tx).append(cause);
      await tx.query(
        `INSERT INTO incident.correlation_decisions
        (id,tenant_id,subject_incident_id,source_event_id,evaluation_identity,profile_id,profile_version,evidence_fingerprint,outcome,confidence,reason_code,candidate_count,decision_evidence,actor_type,actor_id,correlation_id)
        VALUES($1,$2,$3,$4,$5,'TASK-092-V1',1,'fingerprint','NO_LINK',0,'INSUFFICIENT',0,'{}','SYSTEM_CORRELATION','test',$6)`,
        [
          randomUUID(),
          tenant,
          child.id,
          cause.event_id,
          randomUUID(),
          cause.correlation_id,
        ],
      );
      const decision = await tx.query<{ id: string }>(
        "SELECT id FROM incident.correlation_decisions WHERE tenant_id=$1 AND subject_incident_id=$2",
        [tenant, child.id],
      );
      const attached = await attachIncidentToRoot({
        tx,
        incidentId: child.id,
        rootIncidentId: root.id,
        decisionId: decision.rows[0]!.id,
        expectedVersion: 1,
        actorId: "operator",
        reason: "Confirmed common outage",
        correlationId: cause.correlation_id,
      });
      assert.equal(attached.version, 2);
      const detached = await detachIncidentFromRoot({
        tx,
        incidentId: child.id,
        expectedVersion: 2,
        actorId: "operator",
        reason: "Root grouping was incorrect",
      });
      assert.equal(detached.relation_state, "DETACHED");
      const state = await tx.query<{
        state: string;
        root_incident_id: string | null;
        version: number;
      }>(
        "SELECT state,root_incident_id,version FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
        [tenant, child.id],
      );
      assert.deepEqual(state.rows[0], {
        state: "DETECTED",
        root_incident_id: null,
        version: 3,
      });
      const history = await tx.query<{ relation_state: string }>(
        "SELECT relation_state FROM incident.root_relations WHERE tenant_id=$1 AND child_incident_id=$2 ORDER BY linked_at",
        [tenant, child.id],
      );
      assert.deepEqual(
        history.rows.map((row) => row.relation_state),
        ["DETACHED"],
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.correlation_active_suppressions WHERE tenant_id=$1 AND child_incident_id=$2 AND root_incident_id=$3",
            [tenant, child.id, root.id],
          )
        ).rowCount,
        1,
      );
      const reattached = await attachIncidentToRoot({
        tx,
        incidentId: child.id,
        rootIncidentId: root.id,
        decisionId: decision.rows[0]!.id,
        expectedVersion: 3,
        actorId: "operator",
        reason: "Reviewed and confirmed the Root relationship",
        correlationId: cause.correlation_id,
      });
      assert.equal(reattached.version, 4);
      assert.equal(reattached.suppression_overridden, true);
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.correlation_suppression_overrides WHERE tenant_id=$1",
            [tenant],
          )
        ).rowCount,
        1,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.root_relations WHERE tenant_id=$1 AND relation_state='DETACHED'",
            [tenant],
          )
        ).rowCount,
        1,
      );
    });
  } finally {
    await db.close();
  }
});

test("missing SYSTEM_CORRELATION grant fails closed and creates one review item", async () => {
  const db = await testDatabase();
  const tenant = `correlation-${randomUUID()}`;
  try {
    let trigger!: EventEnvelope;
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "INSERT INTO identity.correlation_principals(id,tenant_id,service_identity) VALUES($1,$2,'incident-correlation')",
        [randomUUID(), tenant],
      );
      for (let index = 0; index < 2; index++) {
        const monitoringId = randomUUID();
        await tx.query(
          `INSERT INTO monitoring.events(id,tenant_id,source,provider_event_id,source_correlation_key,metric,observed_value,severity,observed_at)
           VALUES($1,$2,'monitor',$3,'problem:no-grant','cpu.utilization','96','CRITICAL',now())`,
          [monitoringId, tenant, `provider-no-grant-${index}`],
        );
        const incident = await createIncident({
          tx,
          incidentCode: `NO-GRANT-${index}`,
          title: `Alert ${index}`,
          source: "monitor",
          monitoringEventId: monitoringId,
          priority: "P1",
        });
        const event: EventEnvelope = {
          event_id: randomUUID(),
          event_type: "INCIDENT.CREATED",
          schema_version: 1,
          occurred_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          producer: { service: "test", instance: "integration" },
          aggregate: { type: "INCIDENT", id: incident.id, version: 1 },
          actor: { type: "SYSTEM", id: "test" },
          correlation_id: randomUUID(),
          causation_id: randomUUID(),
          tenant_id: tenant,
          organization_id: tenant,
          idempotency_key: randomUUID(),
          payload: { incident_id: incident.id },
        };
        await new PostgresOutboxWriter(tx).append(event);
        if (index === 1) trigger = event;
      }
    });
    assert.equal(
      await processIncidentCorrelationEvent(db.uow, trigger),
      "processed",
    );
    assert.equal(
      await processIncidentCorrelationEvent(db.uow, trigger),
      "duplicate",
    );
    await db.uow.run(tenant, async (tx) => {
      const decisions = await tx.query<{
        outcome: string;
        reason_code: string;
      }>(
        "SELECT outcome,reason_code FROM incident.correlation_decisions WHERE tenant_id=$1",
        [tenant],
      );
      assert.equal(decisions.rowCount, 1);
      assert.equal(decisions.rows[0]!.outcome, "REVIEW_REQUIRED");
      assert.equal(
        decisions.rows[0]!.reason_code,
        "SYSTEM_CORRELATION_NOT_AUTHORIZED",
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.correlation_clusters WHERE tenant_id=$1",
            [tenant],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.root_relations WHERE tenant_id=$1 AND relation_state='ACTIVE'",
            [tenant],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM operations.work_items WHERE tenant_id=$1 AND source_type='CORRELATION_REVIEW'",
            [tenant],
          )
        ).rowCount,
        1,
      );
    });
  } finally {
    await db.close();
  }
});

test("correlation worker retry budget exhausts once into actionable human work", async () => {
  const db = await testDatabase();
  const tenant = `correlation-${randomUUID()}`;
  try {
    let event!: EventEnvelope;
    let incidentId = "";
    await db.uow.run(tenant, async (tx) => {
      const incident = await createIncident({
        tx,
        incidentCode: "RETRY-INC-1",
        title: "Correlation processing failure",
        source: "test",
        priority: "P2",
      });
      incidentId = incident.id;
      event = {
        event_id: randomUUID(),
        event_type: "INCIDENT.CREATED",
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
        producer: { service: "test", instance: "integration" },
        aggregate: { type: "INCIDENT", id: incident.id, version: 1 },
        actor: { type: "SYSTEM", id: "test" },
        correlation_id: randomUUID(),
        causation_id: randomUUID(),
        tenant_id: tenant,
        organization_id: tenant,
        idempotency_key: randomUUID(),
        payload: { incident_id: incident.id },
      };
      await new PostgresOutboxWriter(tx).append(event);
    });
    for (let attempt = 0; attempt < 5; attempt++)
      await recordIncidentCorrelationProcessingFailure(
        db.uow,
        event,
        new Error("opaque internal failure"),
      );
    await recordIncidentCorrelationProcessingFailure(
      db.uow,
      event,
      new Error("redelivered failure after exhaustion"),
    );
    await db.uow.run(tenant, async (tx) => {
      const failure = await tx.query<{
        attempt_count: number;
        state: string;
        last_error_code: string;
      }>(
        "SELECT attempt_count,state,last_error_code FROM incident.correlation_processing_failures WHERE tenant_id=$1 AND event_id=$2",
        [tenant, event.event_id],
      );
      assert.deepEqual(failure.rows[0], {
        attempt_count: 5,
        state: "EXHAUSTED",
        last_error_code: "CORRELATION_PROCESSING_FAILED",
      });
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM operations.work_items WHERE tenant_id=$1 AND source_type='CORRELATION_REVIEW' AND source_id=$2",
            [tenant, event.event_id],
          )
        ).rowCount,
        1,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM audit.audit_events WHERE tenant_id=$1 AND subject->>'entity_id'=$2 AND event_type='INCIDENT.CORRELATION_PROCESSING_FAILED'",
            [tenant, incidentId],
          )
        ).rowCount,
        1,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM operations.timeline_events WHERE tenant_id=$1 AND entity_id=$2 AND source_event_id=$3",
            [tenant, incidentId, event.event_id],
          )
        ).rowCount,
        1,
      );
    });
  } finally {
    await db.close();
  }
});

test("concurrent human attach to two Roots has one durable winner", async () => {
  const db = await testDatabase();
  const tenant = `correlation-${randomUUID()}`;
  try {
    let incidentId = "";
    let rootA = "";
    let rootB = "";
    let decisionId = "";
    let correlationId = "";
    await db.uow.run(tenant, async (tx) => {
      const root1 = await createIncident({
        tx,
        incidentCode: "RACE-ROOT-A",
        title: "Root A",
        source: "test",
        priority: "P1",
      });
      const root2 = await createIncident({
        tx,
        incidentCode: "RACE-ROOT-B",
        title: "Root B",
        source: "test",
        priority: "P1",
      });
      const child = await createIncident({
        tx,
        incidentCode: "RACE-CHILD",
        title: "Ambiguous incident",
        source: "test",
        priority: "P1",
      });
      incidentId = child.id;
      rootA = root1.id;
      rootB = root2.id;
      const sourceEventId = randomUUID();
      correlationId = randomUUID();
      await new PostgresOutboxWriter(tx).append({
        event_id: sourceEventId,
        event_type: "INCIDENT.CREATED",
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        producer: { service: "test", instance: "integration" },
        aggregate: { type: "INCIDENT", id: child.id, version: 1 },
        actor: { type: "USER", id: "operator" },
        correlation_id: correlationId,
        causation_id: randomUUID(),
        tenant_id: tenant,
        organization_id: tenant,
        idempotency_key: randomUUID(),
        payload: { incident_id: child.id },
      });
      await tx.query(
        `INSERT INTO incident.correlation_decisions
         (id,tenant_id,subject_incident_id,source_event_id,evaluation_identity,profile_id,profile_version,evidence_fingerprint,outcome,confidence,reason_code,candidate_count,decision_evidence,actor_type,actor_id,correlation_id)
         VALUES($1,$2,$3,$4,$5,'TASK-092-V1',1,'race','REVIEW_REQUIRED',60,'AMBIGUOUS',2,'{}','SYSTEM_CORRELATION','test',$6)`,
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
    const results = await Promise.allSettled(
      [rootA, rootB].map((rootIncidentId) =>
        db.uow.run(tenant, (tx) =>
          attachIncidentToRoot({
            tx,
            incidentId,
            rootIncidentId,
            decisionId,
            expectedVersion: 1,
            actorId: "operator",
            reason: "Concurrent review decision",
            correlationId,
          }),
        ),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    await db.uow.run(tenant, async (tx) => {
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.root_relations WHERE tenant_id=$1 AND child_incident_id=$2 AND relation_state='ACTIVE'",
            [tenant, incidentId],
          )
        ).rowCount,
        1,
      );
      const current = await tx.query<{ root_incident_id: string }>(
        "SELECT root_incident_id FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
        [tenant, incidentId],
      );
      assert.ok([rootA, rootB].includes(current.rows[0]!.root_incident_id));
    });
  } finally {
    await db.close();
  }
});

test("deterministic source correlation creates one authorized Root and one active link", async () => {
  const db = await testDatabase();
  const tenant = `correlation-${randomUUID()}`;
  try {
    let first!: EventEnvelope;
    let second!: EventEnvelope;
    let secondIncidentId = "";
    await db.uow.run(tenant, async (tx) => {
      const principalId = randomUUID();
      const roleId = randomUUID();
      await tx.query(
        "INSERT INTO identity.correlation_principals(id,tenant_id,service_identity) VALUES($1,$2,'incident-correlation')",
        [principalId, tenant],
      );
      await tx.query(
        "INSERT INTO identity.roles(id,tenant_id,code,name,type,status) VALUES($1,$2,'CORRELATION_LINKER','Correlation linker','SYSTEM','ACTIVE')",
        [roleId, tenant],
      );
      await tx.query(
        "INSERT INTO identity.role_permissions(tenant_id,role_id,permission_id) SELECT $1,$2,id FROM identity.permissions WHERE code='incident.correlation.link'",
        [tenant, roleId],
      );
      await tx.query(
        "INSERT INTO identity.role_bindings(id,tenant_id,principal_type,principal_id,role_id,scope_type,scope_id,source,valid_from,reason,created_by) VALUES($1,$2,'SYSTEM_CORRELATION',$3,$4,'TENANT',$2,'EXPLICIT',now(),'test grant',$5)",
        [randomUUID(), tenant, principalId, roleId, randomUUID()],
      );
      for (let index = 0; index < 2; index++) {
        const monitoringId = randomUUID();
        await tx.query(
          `INSERT INTO monitoring.events(id,tenant_id,source,provider_event_id,source_correlation_key,metric,observed_value,severity,observed_at)
          VALUES($1,$2,'monitor',$3,'problem:77','cpu.utilization','96','CRITICAL',now())`,
          [monitoringId, tenant, `provider-${index}`],
        );
        const incident = await createIncident({
          tx,
          incidentCode: `INC-${index}`,
          title: `Alert ${index}`,
          source: "monitor",
          monitoringEventId: monitoringId,
          priority: "P1",
        });
        const eventId = randomUUID();
        const envelope: EventEnvelope = {
          event_id: eventId,
          event_type: "INCIDENT.CREATED",
          schema_version: 1,
          occurred_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          producer: { service: "test", instance: "integration" },
          aggregate: { type: "INCIDENT", id: incident.id, version: 1 },
          actor: { type: "SYSTEM", id: "test" },
          correlation_id: randomUUID(),
          causation_id: randomUUID(),
          tenant_id: tenant,
          organization_id: tenant,
          idempotency_key: randomUUID(),
          payload: { incident_id: incident.id },
        };
        await new PostgresOutboxWriter(tx).append(envelope);
        if (index === 0) first = envelope;
        else {
          second = envelope;
          secondIncidentId = incident.id;
        }
      }
    });
    await Promise.all([
      processIncidentCorrelationEvent(db.uow, first),
      processIncidentCorrelationEvent(db.uow, second),
    ]);
    assert.equal(
      await processIncidentCorrelationEvent(db.uow, second),
      "duplicate",
    );
    await db.uow.run(tenant, async (tx) => {
      const decisions = await tx.query<{
        outcome: string;
        confidence: number;
        reason_code: string;
      }>(
        "SELECT outcome,confidence,reason_code FROM incident.correlation_decisions WHERE tenant_id=$1 AND subject_incident_id=$2",
        [tenant, secondIncidentId],
      );
      assert.equal(decisions.rowCount, 1);
      assert.ok(
        decisions.rows.every(
          (decision) =>
            decision.outcome === "AUTO_LINK" && decision.confidence === 100,
        ),
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.root_relations WHERE tenant_id=$1 AND relation_state='ACTIVE'",
            [tenant],
          )
        ).rowCount,
        2,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='INCIDENT.LINKED_TO_ROOT'",
            [tenant],
          )
        ).rowCount,
        2,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.correlation_clusters WHERE tenant_id=$1 AND status='ACTIVE'",
            [tenant],
          )
        ).rowCount,
        1,
      );
      const reviewItems = await tx.query<{ title: string; source_id: string }>(
        "SELECT title,source_id FROM operations.work_items WHERE tenant_id=$1 AND source_type='CORRELATION_REVIEW'",
        [tenant],
      );
      assert.deepEqual(reviewItems.rows, []);
    });
    const reevaluationEvent: EventEnvelope = {
      ...second,
      event_id: randomUUID(),
      occurred_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      idempotency_key: randomUUID(),
      aggregate: { ...second.aggregate, version: 3 },
      payload: {
        incident_id: secondIncidentId,
        evidence_epoch: "manual-detach",
      },
    };
    await db.uow.run(tenant, async (tx) => {
      await detachIncidentFromRoot({
        tx,
        incidentId: secondIncidentId,
        expectedVersion: 2,
        actorId: "operator",
        reason: "The incident is not part of this Root",
      });
      await new PostgresOutboxWriter(tx).append(reevaluationEvent);
    });
    await processIncidentCorrelationEvent(db.uow, reevaluationEvent);
    await db.uow.run(tenant, async (tx) => {
      const decisions = await tx.query<{ outcome: string }>(
        "SELECT outcome FROM incident.correlation_decisions WHERE tenant_id=$1 AND subject_incident_id=$2 ORDER BY created_at",
        [tenant, secondIncidentId],
      );
      assert.equal(decisions.rowCount, 2);
      assert.equal(decisions.rows[1]!.outcome, "NO_LINK");
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.root_relations WHERE tenant_id=$1 AND child_incident_id=$2 AND relation_state='ACTIVE'",
            [tenant, secondIncidentId],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT 1 FROM incident.correlation_active_suppressions WHERE tenant_id=$1 AND child_incident_id=$2",
            [tenant, secondIncidentId],
          )
        ).rowCount,
        1,
      );
    });
  } finally {
    await db.close();
  }
});
