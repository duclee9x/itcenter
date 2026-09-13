import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AuthorizationPort } from "../../packages/auth/src/index.js";
import { ApplicationError } from "../../packages/api-contracts/src/index.js";
import {
  classifySlaTargetPurpose,
  parseSlaTargetPurpose,
  queryResolutionSlaOutcome,
  queryResolutionSlaDrilldown,
  startSla,
} from "../../modules/control-plane/index.js";
import { testDatabase } from "../helpers.js";

const allow: AuthorizationPort = {
  async evaluate() {
    return { result: "ALLOW", reason: "scoped test grant" };
  },
};
const principal = {
  id: "sla-admin",
  tenant_id: "tenant-test",
  actor_type: "USER",
};
const start = "2026-06-01T00:00:00.000Z",
  end = "2026-06-02T00:00:00.000Z";

async function policyAndTarget(
  db: Awaited<ReturnType<typeof testDatabase>>,
  tenant: string,
  purpose: string,
  name: string,
) {
  const policyId = randomUUID(),
    targetId = randomUUID();
  await db.pool.query(
    `INSERT INTO control.sla_policies(id,tenant_id,code,object_type,version,state)
     VALUES($1,$2,$3,'TICKET',1,'ACTIVE')`,
    [policyId, tenant, `p-${policyId}`],
  );
  await db.pool.query(
    `INSERT INTO control.sla_targets(id,tenant_id,sla_policy_id,name,duration_minutes,start_condition,stop_condition,target_purpose)
     VALUES($1,$2,$3,$4,60,'create','complete',$5)`,
    [targetId, tenant, policyId, name, purpose],
  );
  return { policyId, targetId };
}

async function outcome(
  db: Awaited<ReturnType<typeof testDatabase>>,
  tenant: string,
  targetId: string,
  state: string,
  completedAt: string | null,
  policyVersion = 1,
) {
  await db.pool.query(
    `INSERT INTO control.sla_instances(id,tenant_id,object_type,object_id,target_id,policy_version,state,started_at,due_at,completed_at)
     VALUES($1,$2,'TICKET',$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      tenant,
      randomUUID(),
      targetId,
      policyVersion,
      state,
      "2026-05-31T00:00:00Z",
      "2026-06-01T01:00:00Z",
      completedAt,
    ],
  );
}

test("TASK-095-R3 ResolutionSlaOutcomeQuery filters typed purpose and uses [start,end) canonical finalization", async () => {
  const db = await testDatabase();
  const tenant = `task095-r3-kpi-${randomUUID()}`;
  try {
    const response = await policyAndTarget(
      db,
      tenant,
      "RESPONSE",
      "Resolution SLA",
    );
    const resolution = await policyAndTarget(
      db,
      tenant,
      "RESOLUTION",
      "First Response",
    );
    const restore = await policyAndTarget(db, tenant, "RESTORE", "Restore SLA");
    const acknowledge = await policyAndTarget(
      db,
      tenant,
      "ACKNOWLEDGE",
      "Acknowledgement",
    );
    const other = await policyAndTarget(db, tenant, "OTHER", "Other target");
    const purposes = await db.pool.query<{ target_purpose: string }>(
      `SELECT target_purpose FROM control.sla_targets WHERE tenant_id=$1 ORDER BY target_purpose`,
      [tenant],
    );
    assert.deepEqual(
      purposes.rows.map((row) => row.target_purpose),
      ["ACKNOWLEDGE", "OTHER", "RESOLUTION", "RESPONSE", "RESTORE"],
    );
    assert.equal(acknowledge.targetId.length, 36);
    assert.equal(other.targetId.length, 36);
    const otherTenant = `other-${randomUUID()}`;
    const foreign = await policyAndTarget(
      db,
      otherTenant,
      "RESOLUTION",
      "Resolution",
    );
    await outcome(
      db,
      tenant,
      response.targetId,
      "MET",
      "2026-06-01T00:00:00.000Z",
    );
    await outcome(
      db,
      tenant,
      resolution.targetId,
      "BREACHED",
      "2026-06-01T12:00:00.000Z",
    );
    await outcome(
      db,
      tenant,
      restore.targetId,
      "MET",
      "2026-06-01T14:00:00.000Z",
    );
    await outcome(db, tenant, resolution.targetId, "MET", start);
    await outcome(db, tenant, resolution.targetId, "MET", end);
    await outcome(
      db,
      otherTenant,
      foreign.targetId,
      "MET",
      "2026-06-01T10:00:00.000Z",
    );
    await assert.rejects(
      db.pool.query(
        `INSERT INTO control.sla_instances(id,tenant_id,object_type,object_id,target_id,policy_version,started_at,due_at)
         VALUES($1,$2,'TICKET',$3,$4,1,$5,$6)`,
        [randomUUID(), tenant, randomUUID(), foreign.targetId, start, end],
      ),
    );

    const result = await db.uow.run(tenant, (tx) =>
      queryResolutionSlaOutcome({ tx, startAt: start, endAt: end }),
    );
    assert.equal(result.coverage, "AVAILABLE");
    assert.equal(result.numerator, 1n);
    assert.equal(result.denominator, 2n);
    const drilldown = await db.uow.run(tenant, (tx) =>
      queryResolutionSlaDrilldown({
        tx,
        startAt: start,
        endAt: end,
        offset: 0,
        limit: 20,
      }),
    );
    assert.equal(drilldown.length, 2);
    assert.ok(drilldown.every((row) => row.target_id === resolution.targetId));
    assert.ok(
      drilldown.every(
        (row) => new Date(row.completed_at).toISOString() !== end,
      ),
    );

    const emptyTenant = `empty-${randomUUID()}`;
    const empty = await db.uow.run(emptyTenant, (tx) =>
      queryResolutionSlaOutcome({ tx, startAt: start, endAt: end }),
    );
    assert.equal(empty.coverage, "AVAILABLE_EMPTY");
    assert.equal(empty.denominator, 0n);
  } finally {
    await db.close();
  }
});

test("TASK-095-R3 SLA start binds the canonical target purpose and policy version", async () => {
  const db = await testDatabase();
  const tenant = `task095-r3-start-${randomUUID()}`;
  try {
    const target = await policyAndTarget(
      db,
      tenant,
      "RESOLUTION",
      "Named Response SLA",
    );
    const created = await db.uow.run(tenant, (tx) =>
      startSla({
        tx,
        objectType: "TICKET",
        objectId: randomUUID(),
        targetId: target.targetId,
        now: start,
      }),
    );
    assert.equal(created.target_purpose, "RESOLUTION");
    const row = await db.pool.query<{
      policy_version: number;
      target_id: string;
    }>(
      "SELECT policy_version,target_id FROM control.sla_instances WHERE tenant_id=$1 AND id=$2",
      [tenant, created.id],
    );
    assert.deepEqual(row.rows[0], {
      policy_version: 1,
      target_id: target.targetId,
    });
  } finally {
    await db.close();
  }
});

test("TASK-095-R3 unknown legacy purpose makes KPI evidence ambiguous until authorized, idempotent classification", async () => {
  const db = await testDatabase();
  const tenant = `task095-r3-classify-${randomUUID()}`;
  const actor = { ...principal, tenant_id: tenant };
  try {
    const known = await policyAndTarget(db, tenant, "RESOLUTION", "Known");
    const legacy = await policyAndTarget(
      db,
      tenant,
      "UNKNOWN",
      "Resolution SLA",
    );
    await outcome(
      db,
      tenant,
      known.targetId,
      "MET",
      "2026-06-01T12:00:00.000Z",
    );
    await outcome(
      db,
      tenant,
      legacy.targetId,
      "BREACHED",
      "2026-06-01T13:00:00.000Z",
    );
    const ambiguous = await db.uow.run(tenant, (tx) =>
      queryResolutionSlaOutcome({ tx, startAt: start, endAt: end }),
    );
    assert.equal(ambiguous.coverage, "AMBIGUOUS_TARGET_PURPOSE");

    const key = `classify-${randomUUID()}`;
    const input = {
      authorization: allow,
      principal: actor,
      targetId: legacy.targetId,
      targetPurpose: "RESOLUTION" as const,
      expectedVersion: 1,
      reason: "Verified against the approved SLA configuration record.",
      correlationId: "corr-r3",
      idempotencyKey: key,
    };
    const first = await db.uow.run(tenant, (tx) =>
      classifySlaTargetPurpose({ tx, ...input }),
    );
    const replay = await db.uow.run(tenant, (tx) =>
      classifySlaTargetPurpose({ tx, ...input }),
    );
    assert.equal(first.created, true);
    assert.equal(first.version, 2);
    assert.equal(replay.created, false);
    assert.equal(replay.id, first.id);
    const history = await db.pool.query(
      "SELECT count(*)::int AS n FROM control.sla_target_purpose_changes WHERE tenant_id=$1 AND sla_target_id=$2",
      [tenant, legacy.targetId],
    );
    assert.equal(history.rows[0].n, 1);
    const resolved = await db.uow.run(tenant, (tx) =>
      queryResolutionSlaOutcome({ tx, startAt: start, endAt: end }),
    );
    assert.equal(resolved.coverage, "AVAILABLE");
    assert.equal(resolved.numerator, 1n);
    assert.equal(resolved.denominator, 2n);

    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        classifySlaTargetPurpose({
          tx,
          authorization: allow,
          principal: actor,
          targetId: legacy.targetId,
          targetPurpose: "RESPONSE",
          expectedVersion: 2,
          reason: "attempt purpose rewrite",
          correlationId: "corr-r3",
          idempotencyKey: `new-${randomUUID()}`,
        }),
      ),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "BUSINESS_RULE_VIOLATION",
    );
    const denied: AuthorizationPort = {
      async evaluate() {
        return { result: "DENY", reason: "no grant" };
      },
    };
    await assert.rejects(
      db.uow.run(tenant, (tx) =>
        classifySlaTargetPurpose({ ...input, tx, authorization: denied }),
      ),
      { code: "PERMISSION_DENIED" },
    );
    await assert.throws(() => parseSlaTargetPurpose("resolution"), {
      code: "VALIDATION_ERROR",
    });
    await assert.rejects(
      db.uow.run(`wrong-${tenant}`, (tx) =>
        classifySlaTargetPurpose({ ...input, tx }),
      ),
      { code: "PERMISSION_DENIED" },
    );

    await assert.rejects(
      db.pool.query(
        `UPDATE control.sla_target_purpose_changes SET reason='rewritten' WHERE tenant_id=$1 AND id=$2`,
        [tenant, first.id],
      ),
    );
  } finally {
    await db.close();
  }
});

test("TASK-095-R3 final outcomes without the canonical completed_at cannot be assigned to a period", async () => {
  const db = await testDatabase();
  const tenant = `task095-r3-untimed-${randomUUID()}`;
  try {
    const target = await policyAndTarget(
      db,
      tenant,
      "RESOLUTION",
      "Resolution",
    );
    await outcome(db, tenant, target.targetId, "MET", null);
    const result = await db.uow.run(tenant, (tx) =>
      queryResolutionSlaOutcome({ tx, startAt: start, endAt: end }),
    );
    assert.equal(result.coverage, "FINALIZATION_TIMESTAMP_UNAVAILABLE");
  } finally {
    await db.close();
  }
});

test("TASK-095-R3 distinguishes a failed SLA source query from an available empty result", async () => {
  const tx = {
    tenantId: `task095-r3-failed-${randomUUID()}`,
    async query() {
      throw new Error("simulated SLA query outage");
    },
  } as never;
  await assert.rejects(
    queryResolutionSlaOutcome({ tx, startAt: start, endAt: end }),
    /simulated SLA query outage/,
  );
});
