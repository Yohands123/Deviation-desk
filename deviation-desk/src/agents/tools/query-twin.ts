import { z } from "zod";
import { getSql } from "@/db/client";
import type { AgentTool } from "./types";

/** Columns agents may read and filter on, per table. Anything else is not exposed. */
const COLUMNS = {
  rooms: ["id", "name", "department", "room_type", "cleanliness_class", "status", "site_id"],
  equipment: ["id", "name", "equipment_type", "status", "last_maintenance_at", "room_id", "line_id"],
  production_lines: ["id", "name", "status", "units_per_hour", "room_id"],
  products: ["id", "name", "storage_condition", "release_test_days"],
  batches: ["id", "batch_code", "status", "produced_at", "quantity", "product_id", "line_id"],
  materials: ["id", "name"],
  material_lots: ["id", "lot_code", "material_id", "supplier_id", "received_at"],
  suppliers: ["id", "name", "country"],
  locations: ["id", "name", "kind"],
  inventory_lots: ["id", "batch_id", "location_id", "quantity", "on_hold"],
  orders: ["id", "order_code", "product_id", "destination_id", "quantity", "due_at", "priority", "status"],
  shipments: ["id", "shipment_code", "origin_id", "destination_id", "order_id", "carrier", "status", "storage_condition"],
  people: ["id", "name", "role", "shift", "site_id"],
  records: ["id", "record_type", "subject_table", "subject_id", "title", "recorded_at"],
} as const satisfies Record<string, readonly string[]>;

type QueryableTable = keyof typeof COLUMNS;
const TABLES = Object.keys(COLUMNS) as [QueryableTable, ...QueryableTable[]];

const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const input = z.object({
  table: z
    .enum(TABLES)
    .describe(
      "Table to read. Columns: " +
        Object.entries(COLUMNS)
          .map(([t, cols]) => `${t}(${cols.join(", ")})`)
          .join("; "),
    ),
  filters: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({})
    .describe('Equality filters on columns of the chosen table, e.g. {"batch_code": "A-2231"}.'),
  limit: z.number().int().min(1).max(50).default(20),
});

export const queryTwin: AgentTool<typeof input> = {
  name: "query_twin",
  description:
    "Look up rows in the company twin by equality filters. Returns up to `limit` rows; each has an id to cite as a source with this table name.",
  input,
  async run({ table, filters, limit }, ctx) {
    const sql = getSql();
    const allowed: readonly string[] = COLUMNS[table];
    const conditions = Object.entries(filters).map(([key, value]) => {
      const column = toSnake(key);
      if (!allowed.includes(column)) {
        throw new Error(`Cannot filter ${table} on "${key}". Columns: ${allowed.join(", ")}`);
      }
      return sql`and ${sql(column)}::text = ${String(value)}`;
    });
    const rows = await sql`
      select ${sql(allowed)} from ${sql(table)}
      where world_id = ${ctx.worldId} ${conditions}
      order by id
      limit ${limit}`;
    return { table, rows };
  },
};
