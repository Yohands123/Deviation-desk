/**
 * Maps human-facing object codes (as used in scenarios, docs and the UI) to row ids in one world.
 * Example: { table: "batches", code: "A-2231" } → the id of batch A-2231 in that world.
 */
import type { Sql } from "./client";

const CODE_COLUMN = {
  sites: "name",
  rooms: "name",
  production_lines: "name",
  equipment: "name",
  suppliers: "name",
  materials: "name",
  material_lots: "lot_code",
  products: "name",
  batches: "batch_code",
  locations: "name",
  orders: "order_code",
  shipments: "shipment_code",
  people: "name",
  incidents: "code",
} as const;

export type RefTable = keyof typeof CODE_COLUMN;

export function isRefTable(table: string): table is RefTable {
  return Object.hasOwn(CODE_COLUMN, table);
}

export async function resolveRef(sql: Sql, worldId: string, ref: { table: string; code: string }): Promise<string> {
  if (!isRefTable(ref.table)) throw new Error(`Cannot resolve references to table "${ref.table}"`);
  const rows = await sql<{ id: string }[]>`
    select id from ${sql(ref.table)}
    where world_id = ${worldId} and ${sql(CODE_COLUMN[ref.table])} = ${ref.code}
    limit 2`;
  const [first, second] = rows;
  if (!first) throw new Error(`No ${ref.table} row "${ref.code}" in world ${worldId}`);
  if (second) throw new Error(`"${ref.code}" matches more than one ${ref.table} row in world ${worldId}`);
  return first.id;
}
