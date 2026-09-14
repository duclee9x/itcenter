import type pg from "pg";
import type { MigrationManifestEntry } from "./migration-manifest.js";

const DATABASE_TIMEOUT_MS = 1500;
const SCHEMA_CACHE_MS = 5000;

export interface PersistenceReadinessComponent {
  id: "database" | "schema";
  state: "READY" | "NOT_READY";
  criticality: "MANDATORY";
  reasonCode?: "DATABASE_UNAVAILABLE" | "SCHEMA_INCOMPATIBLE";
  lastSuccessfulCheckAt?: string;
  lastStateChangeAt: string;
}

export class PostgresReadiness {
  private schemaCache:
    { compatible: boolean; checkedAt: number; expiresAt: number } | undefined;
  private databaseState: boolean | undefined;
  private databaseStateChangedAt: number | undefined;
  private schemaState: boolean | undefined;
  private schemaStateChangedAt: number | undefined;

  constructor(
    private readonly pool: pg.Pool,
    private readonly expected: readonly MigrationManifestEntry[],
    private readonly now: () => number = Date.now,
    private readonly schemaCacheMs = SCHEMA_CACHE_MS,
  ) {
    if (!expected.length) throw new Error("Expected schema manifest is empty");
    if (!Number.isSafeInteger(schemaCacheMs) || schemaCacheMs < 0)
      throw new Error("Invalid schema readiness cache interval");
  }

  async components(): Promise<PersistenceReadinessComponent[]> {
    const checkedAt = this.now();
    const database = await this.checkDatabase();
    const schema = await this.checkSchema(checkedAt);
    if (this.databaseState !== database) {
      this.databaseState = database;
      this.databaseStateChangedAt = this.now();
    }
    if (this.schemaState !== schema.compatible) {
      this.schemaState = schema.compatible;
      this.schemaStateChangedAt = schema.checkedAt;
    }
    return [
      {
        id: "database",
        state: database ? "READY" : "NOT_READY",
        criticality: "MANDATORY",
        ...(!database ? { reasonCode: "DATABASE_UNAVAILABLE" } : {}),
        lastStateChangeAt: new Date(this.databaseStateChangedAt!).toISOString(),
      },
      {
        id: "schema",
        state: schema.compatible ? "READY" : "NOT_READY",
        criticality: "MANDATORY",
        ...(!schema.compatible ? { reasonCode: "SCHEMA_INCOMPATIBLE" } : {}),
        ...(schema.compatible
          ? { lastSuccessfulCheckAt: new Date(schema.checkedAt).toISOString() }
          : {}),
        lastStateChangeAt: new Date(this.schemaStateChangedAt!).toISOString(),
      },
    ];
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.queryBounded("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  private async checkSchema(
    checkedAt: number,
  ): Promise<{ compatible: boolean; checkedAt: number }> {
    if (this.schemaCache && checkedAt < this.schemaCache.expiresAt)
      return this.schemaCache;
    let compatible = false;
    try {
      const result = await this.queryBounded<{ compatible: boolean }>(
        `WITH expected(name,checksum) AS (
           SELECT * FROM unnest($1::text[],$2::text[])
         ), actual AS (
           SELECT name,checksum FROM migration_meta.applied
         ), mismatch AS (
           SELECT e.name FROM expected e LEFT JOIN actual a USING(name)
             WHERE a.name IS NULL OR a.checksum<>e.checksum
           UNION ALL
           SELECT a.name FROM actual a LEFT JOIN expected e USING(name)
             WHERE e.name IS NULL
         )
         SELECT NOT EXISTS(SELECT 1 FROM mismatch) AS compatible`,
        [
          this.expected.map((entry) => entry.name),
          this.expected.map((entry) => entry.checksum),
        ],
      );
      compatible = result.rows[0]?.compatible === true;
    } catch {
      compatible = false;
    }
    this.schemaCache = {
      compatible,
      checkedAt,
      expiresAt: checkedAt + this.schemaCacheMs,
    };
    return this.schemaCache;
  }

  private async queryBounded<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = '${DATABASE_TIMEOUT_MS}ms'`,
      );
      const result = await client.query<R>(text, values);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // A failed connection is released for the pool to discard.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
