import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, unlink, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { testDatabase } from "../helpers.js";
import { migrate } from "../../database/scripts/runner.js";

test("TASK-095-R3 migrates legacy SLA target names to UNKNOWN without text inference", async () => {
  const db = await testDatabase(false);
  const temp = await mkdtemp(path.join(tmpdir(), "task095-r3-migrations-"));
  try {
    await cp("database/migrations", temp, { recursive: true });
    await unlink(
      path.join(temp, "control/20260924_001_task095_r3_sla_target_purpose.sql"),
    );
    await migrate(db.pool, temp);
    const tenant = `task095-r3-legacy-${randomUUID()}`;
    const policy = randomUUID(),
      resolutionByName = randomUUID(),
      responseByName = randomUUID();
    await db.pool.query(
      `INSERT INTO control.sla_policies(id,tenant_id,code,object_type,version,state)
       VALUES($1,$2,'P','TICKET',1,'ACTIVE')`,
      [policy, tenant],
    );
    await db.pool.query(
      `INSERT INTO control.sla_targets(id,tenant_id,sla_policy_id,name,duration_minutes,start_condition,stop_condition)
       VALUES($1,$3,$2,'Resolution SLA',240,'ticket-created','ticket-resolved'),
             ($4,$3,$2,'First Response',30,'ticket-created','first-response')`,
      [resolutionByName, policy, tenant, responseByName],
    );
    await migrate(db.pool);
    const rows = await db.pool.query<{
      id: string;
      target_purpose: string;
      version: number;
    }>(
      `SELECT id,target_purpose,version FROM control.sla_targets WHERE tenant_id=$1 ORDER BY id`,
      [tenant],
    );
    assert.equal(rows.rowCount, 2);
    assert.ok(
      rows.rows.every(
        (row) => row.target_purpose === "UNKNOWN" && row.version === 1,
      ),
    );
    const allowed = await db.pool.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.check_constraints
        WHERE constraint_schema='control' AND constraint_name='sla_targets_target_purpose_check'`,
    );
    assert.equal(allowed.rowCount, 1);
    await assert.rejects(
      db.pool.query(
        `INSERT INTO control.sla_targets(id,tenant_id,sla_policy_id,name,duration_minutes,start_condition,stop_condition,target_purpose)
       VALUES($1,$2,$3,'invalid',30,'a','b','FUZZY')`,
        [randomUUID(), tenant, policy],
      ),
    );
    await assert.rejects(
      db.pool.query(
        `INSERT INTO control.sla_targets(id,tenant_id,sla_policy_id,name,duration_minutes,start_condition,stop_condition)
         VALUES($1,$2,$3,'missing typed purpose',30,'a','b')`,
        [randomUUID(), tenant, policy],
      ),
    );
  } finally {
    await db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
