/**
 * Checks that every cited source is a real row in the agent's world (CLAUDE.md principle 3).
 * A source naming a table agents cannot cite, or a row id that does not exist in this world,
 * is rejected: dropped from the answer and kept on the DecisionRecord for audit and evals.
 */
import type { Sql } from "@/db/client";
import type { z } from "zod";
import type { Source } from "./contract";

type SourceRow = z.infer<typeof Source>;

/** World-scoped tables with an `id` column that agents may cite. */
export const CITABLE_TABLES = new Set([
  "sites",
  "rooms",
  "production_lines",
  "equipment",
  "suppliers",
  "materials",
  "material_lots",
  "products",
  "batches",
  "locations",
  "inventory_lots",
  "orders",
  "shipments",
  "sensor_readings",
  "people",
  "records",
  "incidents",
  "incident_events",
  "evidence",
  "tasks",
  "decision_records",
]);

export async function verifySources(
  sql: Sql,
  worldId: string,
  sources: SourceRow[],
): Promise<{ kept: SourceRow[]; rejected: SourceRow[] }> {
  const idsByTable = new Map<string, Set<string>>();
  for (const s of sources) {
    if (!CITABLE_TABLES.has(s.table)) continue;
    const ids = idsByTable.get(s.table) ?? new Set<string>();
    ids.add(s.rowId);
    idsByTable.set(s.table, ids);
  }

  const existing = new Set<string>();
  for (const [table, ids] of idsByTable) {
    // Compare as text: ids are uuids except sensor_readings and incident_events (bigint).
    const rows = await sql<{ id: string }[]>`
      select id::text as id from ${sql(table)}
      where world_id = ${worldId} and id::text in ${sql([...ids])}`;
    for (const r of rows) existing.add(`${table}:${r.id}`);
  }

  const kept: SourceRow[] = [];
  const rejected: SourceRow[] = [];
  for (const s of sources) (existing.has(`${s.table}:${s.rowId}`) ? kept : rejected).push(s);
  return { kept, rejected };
}
