import test from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import {
  PostgresReadiness,
  type MigrationManifestEntry,
} from "../../packages/persistence/src/index.js";

type FakePool = Pick<pg.Pool, "connect">;
function fakePool(input: {
  compatible: boolean;
  failDatabase?: boolean;
  failSchema?: boolean;
}) {
  let schemaCalls = 0;
  const statements: string[] = [];
  const client = {
    async query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string) {
      statements.push(text);
      if (text.includes("SELECT 1") && input.failDatabase)
        throw new Error("database unavailable");
      if (text.includes("WITH expected") && input.failSchema)
        throw new Error("schema metadata unavailable");
      if (text.includes("WITH expected")) {
        schemaCalls += 1;
        return {
          rows: [{ compatible: input.compatible }] as unknown as R[],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      }
      return {
        rows: [] as R[],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as FakePool;
  return {
    pool: pool as pg.Pool,
    schemaCalls: () => schemaCalls,
    statements: () => statements,
  };
}

const manifest: MigrationManifestEntry[] = [
  { name: "platform/one.sql", checksum: "a".repeat(64) },
];

test("Postgres readiness requires connectivity and exact schema compatibility", async () => {
  const exact = fakePool({ compatible: true });
  const readiness = new PostgresReadiness(exact.pool, manifest);
  assert.deepEqual(
    (await readiness.components()).map(({ id, state }) => [id, state]),
    [
      ["database", "READY"],
      ["schema", "READY"],
    ],
  );
  assert.equal(exact.schemaCalls(), 1);

  const behind = new PostgresReadiness(
    fakePool({ compatible: false }).pool,
    manifest,
  );
  assert.equal(
    (await behind.components())[1]?.reasonCode,
    "SCHEMA_INCOMPATIBLE",
  );

  const unavailable = new PostgresReadiness(
    fakePool({ compatible: true, failDatabase: true }).pool,
    manifest,
  );
  const failed = await unavailable.components();
  assert.equal(failed[0]?.reasonCode, "DATABASE_UNAVAILABLE");
});

test("schema metadata result is cached for a bounded interval", async () => {
  let now = 100;
  const fake = fakePool({ compatible: true });
  const readiness = new PostgresReadiness(fake.pool, manifest, () => now, 5000);
  await readiness.components();
  now += 4999;
  await readiness.components();
  assert.equal(fake.schemaCalls(), 1);
  assert.ok(
    fake
      .statements()
      .every(
        (statement) =>
          !/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(statement),
      ),
  );
  now += 2;
  await readiness.components();
  assert.equal(fake.schemaCalls(), 2);
});
