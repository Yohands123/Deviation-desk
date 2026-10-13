import type { Sql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";

/**
 * Resolves an object the model named by id or by code (e.g. "A-2231") to an id in this world.
 * An id is checked to exist in the world, so a model can never reach a row in another world.
 */
export async function resolveSubject(
  sql: Sql,
  worldId: string,
  table: string,
  ref: { id?: string | undefined; code?: string | undefined },
): Promise<string> {
  if (ref.id) {
    const [row] = await sql`select 1 from ${sql(table)} where world_id = ${worldId} and id::text = ${ref.id}`;
    if (!row) throw new Error(`No ${table} row with id ${ref.id}`);
    return ref.id;
  }
  if (ref.code) return resolveRef(sql, worldId, { table, code: ref.code });
  throw new Error("Give either an id or a code.");
}
