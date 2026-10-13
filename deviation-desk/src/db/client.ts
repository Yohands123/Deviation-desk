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
  // Hosted: Supabase's transaction pooler (port 6543) cannot use prepared statements, and each
  // serverless instance keeps only a few connections.
  const pooler = /:6543\//.test(url) || /[?&]pgbouncer=true/.test(url);
  pool = postgres(url, {
    prepare: !pooler,
    max: process.env.VERCEL ? 3 : 10,
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
