import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../helpers.js";
import {
  createIncident,
  queryActiveIncidentEpisodesAt,
  queryIncidentStateAt,
  transitionIncident,
} from "../../modules/incident/index.js";
import {
  queryActionableWorkItemsAt,
  queryWorkItemStateAt,
} from "../../modules/work-queue/index.js";

test("TASK-095-R2 reconstructs Incident episodes and Work Queue state after a late snapshot boundary", async () => {
  const db = await testDatabase();
  const tenant = `task095-r2-${randomUUID()}`;
  const at = (value: string) => `${value}Z`;
  try {
    const a = randomUUID(),
      b = randomUUID(),
      root = randomUUID(),
      w1 = randomUUID(),
      w2 = randomUUID();
    await db.pool.query(
      `INSERT INTO incident.incidents(id,tenant_id,incident_code,title,source,priority,created_at,updated_at)
      VALUES($1,$2,'A','A','TEST','P1',$3,$3),($4,$2,'B','B','TEST','P1',$5,$5)`,
      [a, tenant, at("2026-09-12T21:00:00"), b, at("2026-09-12T22:00:00")],
    );
    await db.pool.query(
      "UPDATE incident.incidents SET state='RESOLVED',version=2,updated_at=$3 WHERE tenant_id=$1 AND id=$2",
      [tenant, a, at("2026-09-12T23:30:00")],
    );
    const late = await db.uow.run(tenant, (tx) =>
      queryActiveIncidentEpisodesAt({ tx, asOf: at("2026-09-13T00:00:00") }),
    );
    assert.deepEqual(late, {
      coverage: "COMPLETE",
      episode_ids: [a, b].sort(),
    });
    await db.pool.query(
      `INSERT INTO incident.incidents(id,tenant_id,incident_code,title,source,priority,created_at,updated_at)
       VALUES($1,$2,'R','R','TEST','P1',$3,$3)`,
      [root, tenant, at("2026-09-12T23:00:00")],
    );
    await db.pool.query(
      `INSERT INTO incident.root_relations(id,tenant_id,child_incident_id,root_incident_id,relation_state,origin,reason,linked_by_type,linked_by_id,linked_at)
      VALUES($1,$2,$3,$4,'ACTIVE','HUMAN','test','USER','u',$5),($6,$2,$7,$4,'ACTIVE','HUMAN','test','USER','u',$5)`,
      [
        randomUUID(),
        tenant,
        a,
        root,
        at("2026-09-12T23:00:00"),
        randomUUID(),
        b,
      ],
    );
    const atLink = await db.uow.run(tenant, (tx) =>
      queryActiveIncidentEpisodesAt({
        tx,
        asOf: at("2026-09-12T23:00:00"),
      }),
    );
    assert.deepEqual(atLink, { coverage: "COMPLETE", episode_ids: [root] });
    const immediatelyBeforeLink = await db.uow.run(tenant, (tx) =>
      queryActiveIncidentEpisodesAt({
        tx,
        asOf: at("2026-09-12T22:59:59"),
      }),
    );
    assert.equal(immediatelyBeforeLink.episode_ids.length, 2);
    const beforeRoot = await db.uow.run(tenant, (tx) =>
      queryActiveIncidentEpisodesAt({ tx, asOf: at("2026-09-12T22:30:00") }),
    );
    assert.equal(beforeRoot.episode_ids.length, 2);
    const afterRoot = await db.uow.run(tenant, (tx) =>
      queryActiveIncidentEpisodesAt({ tx, asOf: at("2026-09-12T23:30:00") }),
    );
    assert.deepEqual(afterRoot, { coverage: "COMPLETE", episode_ids: [root] });
    await db.pool.query(
      `UPDATE incident.root_relations SET relation_state='DETACHED',detached_at=$3,
         detached_by_type='USER',detached_by_id='test',detach_reason='test'
        WHERE tenant_id=$1 AND child_incident_id=$2`,
      [tenant, b, at("2026-09-13T00:00:00")],
    );
    const immediatelyBeforeDetach = await db.uow.run(tenant, (tx) =>
      queryActiveIncidentEpisodesAt({
        tx,
        asOf: at("2026-09-12T23:59:59"),
      }),
    );
    assert.deepEqual(immediatelyBeforeDetach, {
      coverage: "COMPLETE",
      episode_ids: [root],
    });
    const atDetach = await db.uow.run(tenant, (tx) =>
      queryActiveIncidentEpisodesAt({
        tx,
        asOf: at("2026-09-13T00:00:00"),
      }),
    );
    assert.equal(atDetach.episode_ids.length, 2);
    assert.ok(atDetach.episode_ids.includes(root));
    assert.ok(atDetach.episode_ids.includes(b));
    await db.pool.query(
      `INSERT INTO operations.work_items(id,tenant_id,source_type,source_id,title,priority,owner_team_id,created_at,last_action_at)
      VALUES($1,$2,'TICKET',$3,'one','HIGH','TEST',$4,$4),($5,$2,'TICKET',$6,'two','HIGH','TEST',$7,$7)`,
      [
        w1,
        tenant,
        randomUUID(),
        at("2026-09-12T20:00:00"),
        w2,
        randomUUID(),
        at("2026-09-12T21:00:00"),
      ],
    );
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        "UPDATE operations.work_items SET state='RESOLVED',version=2,last_action_at=$3,resolved_at=$3 WHERE tenant_id=$1 AND id=$2",
        [tenant, w1, at("2026-09-12T23:00:00")],
      );
      const visible = await tx.query(
        "SELECT 1 FROM operations.work_item_state_transitions WHERE tenant_id=$1 AND work_item_id=$2 AND to_state='RESOLVED'",
        [tenant, w1],
      );
      assert.equal(visible.rowCount, 1);
    });
    const workTransitions = await db.pool.query<{ to_state: string }>(
      "SELECT to_state FROM operations.work_item_state_transitions WHERE tenant_id=$1 AND work_item_id=$2 ORDER BY transition_sequence",
      [tenant, w1],
    );
    assert.deepEqual(
      workTransitions.rows.map((row) => row.to_state),
      ["NEW", "RESOLVED"],
    );
    const work = await db.uow.run(tenant, (tx) =>
      queryActionableWorkItemsAt({ tx, asOf: at("2026-09-13T00:00:00") }),
    );
    assert.deepEqual(work, { coverage: "COMPLETE", work_item_ids: [w2] });
    const beforeCompletion = await db.uow.run(tenant, (tx) =>
      queryActionableWorkItemsAt({
        tx,
        asOf: at("2026-09-12T22:30:00"),
      }),
    );
    assert.deepEqual(
      new Set(beforeCompletion.work_item_ids),
      new Set([w1, w2]),
    );
    assert.deepEqual(
      await db.uow.run(tenant, (tx) =>
        queryWorkItemStateAt({
          tx,
          workItemId: w2,
          asOf: at("2026-09-12T20:59:00"),
        }),
      ),
      { coverage: "NOT_YET_CREATED", state: null },
    );
    assert.deepEqual(
      await db.uow.run(tenant, (tx) =>
        queryWorkItemStateAt({
          tx,
          workItemId: w2,
          asOf: at("2026-09-12T21:01:00"),
        }),
      ),
      { coverage: "KNOWN_STATE", state: "NEW" },
    );
  } finally {
    await db.close();
  }
});

test("TASK-095-R2 triggers record only state changes and roll back current state with failed history writes", async () => {
  const db = await testDatabase();
  const tenant = `task095-r2-trigger-${randomUUID()}`;
  try {
    const createdValue = await db.uow.run(tenant, (tx) =>
      createIncident({
        tx,
        incidentCode: "HISTORY-1",
        title: "History test",
        source: "TEST",
        priority: "P2",
      }),
    );
    const oneAnchor = await db.pool.query(
      "SELECT from_state,to_state,coverage_kind FROM incident.state_transitions WHERE tenant_id=$1 AND incident_id=$2",
      [tenant, createdValue.id],
    );
    assert.equal(oneAnchor.rowCount, 1);
    assert.equal(oneAnchor.rows[0]!.from_state, null);
    assert.equal(oneAnchor.rows[0]!.to_state, "DETECTED");
    assert.equal(oneAnchor.rows[0]!.coverage_kind, "CREATE");
    await db.pool.query(
      "UPDATE incident.incidents SET priority='P1',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [tenant, createdValue.id],
    );
    await db.pool.query(
      "UPDATE incident.incidents SET state='DETECTED',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [tenant, createdValue.id],
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT 1 FROM incident.state_transitions WHERE tenant_id=$1 AND incident_id=$2",
          [tenant, createdValue.id],
        )
      ).rowCount,
      1,
    );
    const workId = randomUUID();
    await db.pool.query(
      "INSERT INTO operations.work_items(id,tenant_id,source_type,source_id,title,priority,owner_team_id) VALUES($1,$2,'TICKET',$3,'history','HIGH','TEST')",
      [workId, tenant, randomUUID()],
    );
    await db.pool.query(
      "UPDATE operations.work_items SET title='metadata only',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [tenant, workId],
    );
    await db.pool.query(
      "UPDATE operations.work_items SET state='NEW',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [tenant, workId],
    );
    const initialWorkHistory = await db.pool.query<{
      tenant_id: string;
      from_state: string | null;
      to_state: string;
      coverage_kind: string;
      transition_sequence: number;
    }>(
      "SELECT tenant_id,from_state,to_state,coverage_kind,transition_sequence FROM operations.work_item_state_transitions WHERE tenant_id=$1 AND work_item_id=$2",
      [tenant, workId],
    );
    assert.equal(initialWorkHistory.rowCount, 1);
    assert.deepEqual(initialWorkHistory.rows[0], {
      tenant_id: tenant,
      from_state: null,
      to_state: "NEW",
      coverage_kind: "CREATE",
      transition_sequence: 1,
    });
    await db.pool.query(
      `CREATE FUNCTION incident.fail_history_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected history failure'; END $$`,
    );
    await db.pool.query(
      `CREATE TRIGGER fail_history_test BEFORE INSERT ON incident.state_transitions FOR EACH ROW EXECUTE FUNCTION incident.fail_history_test()`,
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE incident.incidents SET state='INVESTIGATING',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, createdValue.id],
      ),
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
          [tenant, createdValue.id],
        )
      ).rows[0]!.state,
      "DETECTED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT 1 FROM incident.state_transitions WHERE tenant_id=$1 AND incident_id=$2 AND to_state='INVESTIGATING'",
          [tenant, createdValue.id],
        )
      ).rowCount,
      0,
    );
    await db.pool.query(
      "DROP TRIGGER fail_history_test ON incident.state_transitions",
    );
    await db.pool.query("DROP FUNCTION incident.fail_history_test()");
    await db.pool.query(
      `CREATE FUNCTION operations.fail_history_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected history failure'; END $$`,
    );
    await db.pool.query(
      `CREATE TRIGGER fail_history_test BEFORE INSERT ON operations.work_item_state_transitions FOR EACH ROW EXECUTE FUNCTION operations.fail_history_test()`,
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE operations.work_items SET state='RESOLVED',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, workId],
      ),
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT state FROM operations.work_items WHERE tenant_id=$1 AND id=$2",
          [tenant, workId],
        )
      ).rows[0]!.state,
      "NEW",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT 1 FROM operations.work_item_state_transitions WHERE tenant_id=$1 AND work_item_id=$2 AND to_state='RESOLVED'",
          [tenant, workId],
        )
      ).rowCount,
      0,
    );
  } finally {
    await db.close();
  }
});

test("TASK-095-R2 concurrent Incident transitions serialize by expected version and equal timestamps order by entity version", async () => {
  const db = await testDatabase();
  const tenant = `task095-r2-race-${randomUUID()}`;
  try {
    const created = await db.uow.run(tenant, (tx) =>
      createIncident({
        tx,
        incidentCode: "RACE-1",
        title: "Race",
        source: "TEST",
        priority: "P2",
      }),
    );
    const attempt = () =>
      db.uow.run(tenant, (tx) =>
        transitionIncident({
          tx,
          incidentId: created.id,
          expectedVersion: 1,
          targetState: "INVESTIGATING",
          reason: "race test",
        }).then(async (value) => {
          const visible = await tx.query(
            "SELECT 1 FROM incident.state_transitions WHERE tenant_id=$1 AND incident_id=$2 AND to_state='INVESTIGATING'",
            [tenant, created.id],
          );
          assert.equal(visible.rowCount, 1);
          return value;
        }),
      );
    const outcomes = await Promise.allSettled([attempt(), attempt()]);
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((x) => x.status === "rejected").length, 1);
    await assert.rejects(attempt());
    const history = await db.pool.query<{ transition_sequence: number }>(
      "SELECT transition_sequence FROM incident.state_transitions WHERE tenant_id=$1 AND incident_id=$2 ORDER BY transition_sequence",
      [tenant, created.id],
    );
    assert.equal(history.rowCount, 2);
    assert.ok(
      history.rows[1]!.transition_sequence >
        history.rows[0]!.transition_sequence,
    );
    const tiedIncident = await db.uow.run(tenant, (tx) =>
      createIncident({
        tx,
        incidentCode: "TIE-1",
        title: "Tie timestamp",
        source: "TEST",
        priority: "P2",
      }),
    );
    const createdAt = await db.pool.query<{ created_at: Date | string }>(
      "SELECT created_at FROM incident.incidents WHERE tenant_id=$1 AND id=$2",
      [tenant, tiedIncident.id],
    );
    const tie = new Date(
      Date.parse(String(createdAt.rows[0]!.created_at)) + 2000,
    ).toISOString();
    const immediatelyBeforeCreate = new Date(
      Date.parse(String(createdAt.rows[0]!.created_at)) - 1,
    ).toISOString();
    assert.deepEqual(
      await db.uow.run(tenant, (tx) =>
        queryIncidentStateAt({
          tx,
          incidentId: tiedIncident.id,
          asOf: immediatelyBeforeCreate,
        }),
      ),
      { coverage: "NOT_YET_CREATED", state: null },
    );
    await db.pool.query(
      "UPDATE incident.incidents SET state='INVESTIGATING',version=2,updated_at=$3 WHERE tenant_id=$1 AND id=$2",
      [tenant, tiedIncident.id, tie],
    );
    await db.pool.query(
      "UPDATE incident.incidents SET state='IDENTIFIED',version=3,updated_at=$3 WHERE tenant_id=$1 AND id=$2",
      [tenant, tiedIncident.id, tie],
    );
    const stateAt = await db.uow.run(tenant, (tx) =>
      queryIncidentStateAt({ tx, incidentId: tiedIncident.id, asOf: tie }),
    );
    assert.deepEqual(stateAt, { coverage: "KNOWN_STATE", state: "IDENTIFIED" });
    assert.deepEqual(
      await db.uow.run(`${tenant}-other`, (tx) =>
        queryIncidentStateAt({
          tx,
          incidentId: tiedIncident.id,
          asOf: tie,
        }),
      ),
      { coverage: "UNAVAILABLE", state: null },
    );
  } finally {
    await db.close();
  }
});
