import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, PoolClient, QueryResultRow } from "pg";
import { Config } from "./config";

@Injectable()
export class Database implements OnApplicationShutdown {
  readonly pool: Pool;
  private readonly transactions = new AsyncLocalStorage<PoolClient>();
  constructor(private readonly config: Config) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
    this.pool.on("error", () =>
      console.error("Idle database connection failed"),
    );
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const current = this.transactions.getStore();
    if (current) return work(current);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      const result = await this.transactions.run(client, () => work(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ) {
    return (this.transactions.getStore() ?? this.pool).query<T>(sql, values);
  }

  async migrate(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(701001)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const [index, file] of [
        "001-booking.sql",
        "002-telegram.sql",
        "003-message-order.sql",
        "004-booking-settings.sql",
      ].entries()) {
        const version = index + 1;
        const exists = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [version],
        );
        if (!exists.rowCount) {
          await client.query(
            await readFile(resolve(__dirname, "../migrations", file), "utf8"),
          );
          if (version === 4)
            await client.query(
              "INSERT INTO booking_settings (notice_minutes,horizon_days,window_minutes) VALUES ($1,$2,$3)",
              [
                this.config.noticeMinutes,
                this.config.horizonDays,
                this.config.windowMinutes,
              ],
            );
          await client.query(
            "INSERT INTO schema_migrations (version) VALUES ($1)",
            [version],
          );
        }
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
