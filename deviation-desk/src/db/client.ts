import "server-only";
import postgres from "postgres";

export type Sql = postgres.Sql;
export type TransactionSql = postgres.TransactionSql;

let pool: Sql | undefined;

/**
 * Shared connection pool for server code (tools, workflows, scripts).
 * Result columns come back camelCase; objects passed to sql(...) are written as snake_case.
 */
export function getSql(): Sql {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local; the local Supabase default is " +
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
  }
  pool = postgres(url, {
    transform: postgres.camel,
    onnotice: (n) => console.info(`[postgres] ${String(n.message)}`),
  });
  return pool;
}

export async function closeSql(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
}
