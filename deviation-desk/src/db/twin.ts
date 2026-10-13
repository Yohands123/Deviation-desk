import type { Sql } from "./client";
import { WorldRow } from "./rows";

export async function getWorld(sql: Sql, worldId: string): Promise<WorldRow> {
  const [row] = await sql`select * from worlds where id = ${worldId}`;
  if (!row) throw new Error(`World ${worldId} not found`);
  return WorldRow.parse(row);
}

export async function getLiveWorld(sql: Sql, companyId: string): Promise<WorldRow | null> {
  const [row] = await sql`select * from worlds where company_id = ${companyId} and kind = 'live'`;
  return row ? WorldRow.parse(row) : null;
}
