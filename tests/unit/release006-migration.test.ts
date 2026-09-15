import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMigrationSessionSettings,
  DEFAULT_MIGRATION_LOCK_TIMEOUT,
  DEFAULT_MIGRATION_STATEMENT_TIMEOUT,
} from "../../database/scripts/runner.js";

test("migration session receives the canonical timeout settings", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push(values === undefined ? { sql } : { sql, values });
      return {} as never;
    },
  } as unknown as Pick<import("pg").PoolClient, "query">;
  await applyMigrationSessionSettings(client);
  assert.deepEqual(calls, [
    {
      sql: "SELECT set_config('lock_timeout', $1, false)",
      values: [DEFAULT_MIGRATION_LOCK_TIMEOUT],
    },
    {
      sql: "SELECT set_config('statement_timeout', $1, false)",
      values: [DEFAULT_MIGRATION_STATEMENT_TIMEOUT],
    },
  ]);
});
