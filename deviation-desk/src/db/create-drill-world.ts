/**
 * Start a drill by cloning a world's twin into a new, isolated drill world (CLAUDE.md §9).
 *
 * Rows are copied with only world_id changed, so every object keeps its id: batch A-2231 has the
 * same id in live and in the drill, which makes drill-vs-live comparison and eval scoring simple.
 * Composite (world_id, id) keys mean the copies can never reference rows in the source world.
 */
import type { Sql } from "./client";
import { WorldRow } from "./rows";

/** Twin tables copied into a drill, in foreign-key order. */
export const CLONED_TABLES = [
  "sites",
  "rooms",
  "production_lines",
  "equipment",
  "suppliers",
  "materials",
  "material_suppliers",
  "material_lots",
  "products",
  "batches",
  "batch_equipment_usage",
  "batch_material_usage",
  "locations",
  "lanes",
  "inventory_lots",
  "orders",
  "shipments",
  "shipment_items",
  "sensor_readings",
  "people",
  "records",
] as const;

/** World-scoped tables a drill starts empty: incident history and the audit trail stay in their own world. */
export const NOT_CLONED_TABLES = [
  "incidents",
  "incident_events",
  "seats",
  "evidence",
  "tasks",
  "agent_runs",
  "decision_records",
  "approvals",
  "sim_effects", // each drill's own simulation log
] as const;

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export interface CreateDrillWorldOptions {
  /** Simulated start time. Defaults to the source world's clock, or now for a live source. */
  simClock?: Date;
}

export async function createDrillWorld(
  sql: Sql,
  fromWorldId: string,
  seed: number,
  options: CreateDrillWorldOptions = {},
): Promise<WorldRow> {
  if (!Number.isSafeInteger(seed)) throw new Error("Drill seed must be an integer");

  return sql.begin(async (tx) => {
    // Share lock: the source can't be archived while it is being copied.
    const [sourceRow] = await tx`select * from worlds where id = ${fromWorldId} for share`;
    if (!sourceRow) throw new Error(`World ${fromWorldId} not found`);
    const source = WorldRow.parse(sourceRow);
    if (source.status !== "active") throw new Error(`World ${fromWorldId} is archived and cannot be cloned`);

    const [createdRow] = await tx`
      insert into worlds ${tx({
        companyId: source.companyId,
        kind: "drill",
        clonedFrom: source.id,
        seed,
        simClock: options.simClock ?? source.simClock ?? new Date(),
      })}
      returning *`;
    const created = WorldRow.parse(createdRow);

    const columns = await tx<{ tableName: string; columnName: string }[]>`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ${tx(CLONED_TABLES)}
        and column_name <> 'world_id'
        and is_generated = 'NEVER'
      order by table_name, ordinal_position`;

    for (const table of CLONED_TABLES) {
      const cols = columns.filter((c) => c.tableName === table).map((c) => quoteIdent(c.columnName));
      if (cols.length === 0) throw new Error(`No columns found for ${table}`);
      // Identifiers come from the fixed table list and information_schema, never from input.
      const list = cols.join(", ");
      await tx.unsafe(
        `insert into ${quoteIdent(table)} (world_id, ${list}) select $1::uuid, ${list} from ${quoteIdent(table)} where world_id = $2`,
        [created.id, source.id],
      );
    }
    return created;
  });
}
