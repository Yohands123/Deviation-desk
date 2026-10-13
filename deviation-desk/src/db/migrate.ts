import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./client";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Applies db/migrations/NNNN_name.sql files in order, once each, in one transaction.
 * A checksum catches edits to a migration that already ran: add a new migration instead.
 * Returns the names of the migrations applied by this call.
 */
export async function migrate(sql: Sql, dir: string): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => MIGRATION_FILE.test(f)).sort();

  return sql.begin(async (tx) => {
    // Serialize concurrent runs (e.g. two test workers starting at once).
    await tx`select pg_advisory_xact_lock(hashtext('deviation-desk:migrate'))`;
    const [{ exists } = { exists: false }] = await tx<{ exists: boolean }[]>`
      select to_regclass('public.schema_migrations') is not null as exists`;
    if (!exists) {
      await tx`
        create table schema_migrations (
          name text primary key,
          checksum text not null,
          applied_at timestamptz not null default now()
        )`;
      await tx`alter table schema_migrations enable row level security`;
    }

    const rows = await tx<{ name: string; checksum: string }[]>`select name, checksum from schema_migrations`;
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const ran: string[] = [];

    for (const file of files) {
      // Normalize line endings so a Windows checkout (CRLF) hashes the same as everyone else's.
      const body = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
      const checksum = createHash("sha256").update(body).digest("hex");
      const previous = applied.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`${file} changed after it was applied. Add a new migration instead of editing it.`);
        }
        continue;
      }
      await tx.unsafe(body);
      await tx`insert into schema_migrations ${tx({ name: file, checksum })}`;
      ran.push(file);
    }
    return ran;
  });
}
