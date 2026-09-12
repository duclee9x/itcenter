import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  contractAlertTask,
  processContractAlertAndExpiryBatch,
} from "../../apps/worker/src/contract-alerts.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { testDatabase } from "../helpers.js";

test("TASK-076 schedules version-bound Contract alerts once and expires without notice config", async () => {
  const db = await testDatabase();
  const tenant = `tenant-task076-${randomUUID()}`;
  const supplier = randomUUID();
  const config = loadConfig(
    { DATABASE_SECRET_REF: "env:TEST", APP_ENV: "test", LOG_LEVEL: "error" },
    "worker",
    3002,
  );
  const now = Date.now();
  const effective = new Date(now - 10 * 86_400_000).toISOString();
  const futureEnd = new Date(now + 5 * 86_400_000).toISOString();
  const pastEnd = new Date(now - 1000).toISOString();
  await db.pool.query(
    "INSERT INTO procurement.suppliers(id,tenant_id,code,legal_name,state,created_by) VALUES($1,$2,'T076-SUP','Phase 4 Supplier','APPROVED','test')",
    [supplier, tenant],
  );
  const contracts = [
    {
      end: futureEnd,
      notice: {
        renewal_notice_date: new Date(now - 1000).toISOString(),
        renewal_notice_period_days: 1,
      },
    },
    { end: futureEnd, notice: { renewal_notice_period_days: 10 } },
    { end: futureEnd, notice: {} },
    { end: pastEnd, notice: {} },
  ];
  const ids: string[] = [];
  const versionIds: string[] = [];
  for (let index = 0; index < contracts.length; index++) {
    const id = randomUUID();
    const versionId = randomUUID();
    ids.push(id);
    versionIds.push(versionId);
    await db.uow.run(tenant, async (tx) => {
      await tx.query(
        `INSERT INTO contract.contracts(id,tenant_id,contract_code,supplier_id,supplier_display_snapshot,lifecycle_state,effective_at,end_at,current_version_id,current_version_number,created_by,correlation_id)
         VALUES($1,$2,$3,$4,'Phase 4 Supplier','ACTIVE',$5,$6,$7,1,'test','task076-test')`,
        [
          id,
          tenant,
          `T076-${index}`,
          supplier,
          effective,
          contracts[index]!.end,
          versionId,
        ],
      );
      const snapshot = {
        effective_at: effective,
        end_at: contracts[index]!.end,
        ...contracts[index]!.notice,
      };
      await tx.query(
        `INSERT INTO contract.contract_versions(id,tenant_id,contract_id,version_number,commercial_snapshot,fingerprint,source,created_by)
         VALUES($1,$2,$3,1,$4,$5,'CREATE','test')`,
        [versionId, tenant, id, JSON.stringify(snapshot), "a".repeat(64)],
      );
    });
  }
  try {
    const scheduler = { pool: db.pool, uow: db.uow, config };
    await Promise.all([
      processContractAlertAndExpiryBatch(scheduler),
      processContractAlertAndExpiryBatch(scheduler),
    ]);
    const amendedVersionId = randomUUID();
    const amendedNoticeDate = new Date(now - 2000).toISOString();
    await db.uow.run(tenant, async (tx) => {
      const snapshot = {
        effective_at: effective,
        end_at: futureEnd,
        renewal_notice_date: amendedNoticeDate,
      };
      await tx.query(
        `INSERT INTO contract.contract_versions(id,tenant_id,contract_id,version_number,commercial_snapshot,fingerprint,source,reason,created_by)
         VALUES($1,$2,$3,2,$4,$5,'AMENDMENT','Changed renewal notice terms','test')`,
        [
          amendedVersionId,
          tenant,
          ids[0],
          JSON.stringify(snapshot),
          "c".repeat(64),
        ],
      );
      await tx.query(
        "UPDATE contract.contracts SET current_version_id=$3,current_version_number=2,version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, ids[0], amendedVersionId],
      );
    });
    await Promise.all([
      processContractAlertAndExpiryBatch(scheduler),
      processContractAlertAndExpiryBatch(scheduler),
    ]);
    const facts = await db.pool.query(
      "SELECT contract_id,contract_version_id,trigger_source FROM contract.alert_facts WHERE tenant_id=$1 ORDER BY contract_id,contract_version_id",
      [tenant],
    );
    assert.equal(facts.rowCount, 3);
    const expectedFacts: [string, string, string][] = [
      [ids[0]!, versionIds[0]!, "EXPLICIT_DATE"],
      [ids[1]!, versionIds[1]!, "NOTICE_PERIOD"],
      [ids[0]!, amendedVersionId, "EXPLICIT_DATE"],
    ];
    expectedFacts.sort((left, right) =>
      `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`),
    );
    assert.deepEqual(
      facts.rows.map((row) => [
        row.contract_id,
        row.contract_version_id,
        row.trigger_source,
      ]),
      expectedFacts,
    );
    const dueEvents = await db.pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='CONTRACT.RENEWAL_NOTICE_DUE'",
      [tenant],
    );
    assert.equal(dueEvents.rows[0]!.count, 3);
    const alerts = await db.pool.query(
      "SELECT count(*)::int AS count FROM operations.work_items WHERE tenant_id=$1 AND source_type='CONTRACT_ALERT'",
      [tenant],
    );
    assert.equal(alerts.rows[0]!.count, 3);
    await assert.rejects(
      db.pool.query("TRUNCATE contract.alert_facts"),
      /Contract alert history is append-only/,
    );
    const lifecycle = await db.pool.query(
      "SELECT lifecycle_state FROM contract.contracts WHERE tenant_id=$1 AND id=$2",
      [tenant, ids[3]],
    );
    assert.equal(lifecycle.rows[0]!.lifecycle_state, "EXPIRED");
    const expiryEvents = await db.pool.query(
      "SELECT count(*)::int AS count FROM platform.outbox_events WHERE tenant_id=$1 AND event_type='CONTRACT.EXPIRED'",
      [tenant],
    );
    assert.equal(expiryEvents.rows[0]!.count, 1);
    assert.equal(typeof contractAlertTask, "function");
  } finally {
    await db.close();
  }
});
