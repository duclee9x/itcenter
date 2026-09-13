import pg from "pg";
export interface SqlExecutor {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}
export interface Transaction extends SqlExecutor {
  readonly tenantId: string;
}
export interface UnitOfWork {
  run<T>(
    tenantId: string,
    work: (tx: Transaction) => Promise<T>,
    options?: {
      isolationLevel?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
    },
  ): Promise<T>;
}
export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: pg.Pool) {}
  async run<T>(
    tenantId: string,
    work: (tx: Transaction) => Promise<T>,
    options: {
      isolationLevel?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
    } = {},
  ): Promise<T> {
    if (!tenantId.trim()) throw new Error("Tenant context is required");
    const client = await this.pool.connect();
    try {
      await client.query(
        `BEGIN ISOLATION LEVEL ${options.isolationLevel ?? "READ COMMITTED"}`,
      );
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [
        tenantId,
      ]);
      let active = true;
      const tx: Transaction = {
        tenantId,
        query: (...args) => {
          if (!active) throw new Error("Transaction is closed");
          return client.query(...args);
        },
      };
      try {
        const result = await work(tx);
        const commit = await client.query("COMMIT");
        // PostgreSQL returns ROLLBACK, without throwing, if a caught SQL error
        // left the transaction aborted. Never return an uncommitted result.
        if (commit.command !== "COMMIT")
          throw new Error("Transaction did not commit");
        return result;
      } finally {
        active = false;
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
}

export async function databaseReady(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1 FROM platform.outbox_events LIMIT 0");
    return true;
  } catch {
    return false;
  }
}
