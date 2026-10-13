import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "./client";
import { CLONED_TABLES, NOT_CLONED_TABLES, createDrillWorld } from "./create-drill-world";
import { resolveRef } from "./resolve-ref";
import type { WorldRow } from "./rows";
import { seedHelixBiologics, type SeededCompany } from "./seed/helix-biologics";
import { traceImpact } from "./trace-impact";

const sql = getSql();
let helix: SeededCompany;
let drill: WorldRow;

async function count(table: string, worldId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)} where world_id = ${worldId}`;
  return row?.n ?? 0;
}

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  drill = await createDrillWorld(sql, helix.worldId, 4471);
});
afterAll(closeSql);

describe("createDrillWorld", () => {
  it("creates a drill world that records its source and seed", () => {
    expect(drill.kind).toBe("drill");
    expect(drill.clonedFrom).toBe(helix.worldId);
    expect(drill.seed).toBe(4471);
    expect(drill.companyId).toBe(helix.companyId);
    expect(drill.simClock).toBeInstanceOf(Date);
  });

  it("copies every twin table row for row", async () => {
    for (const table of CLONED_TABLES) {
      expect.soft(await count(table, drill.id), table).toBe(await count(table, helix.worldId));
    }
    expect(await count("sensor_readings", drill.id)).toBeGreaterThan(0);
  });

  it("keeps object ids identical across worlds", async () => {
    const a2231 = { table: "batches", code: "A-2231" };
    const id = await resolveRef(sql, helix.worldId, a2231);
    expect(await resolveRef(sql, drill.id, a2231)).toBe(id);
    const ids = async (worldId: string) =>
      (await traceImpact(sql, worldId, { table: "batches", id }, 3)).map((n) => `${n.table}:${n.id}`).sort();
    expect(await ids(drill.id)).toEqual(await ids(helix.worldId));
  });

  it("isolates drill changes from live", async () => {
    const id = await resolveRef(sql, drill.id, { table: "batches", code: "A-2231" });
    await sql`update batches set status = 'quarantined' where world_id = ${drill.id} and id = ${id}`;
    const [live] = await sql<{ status: string }[]>`
      select status from batches where world_id = ${helix.worldId} and id = ${id}`;
    expect(live?.status).toBe("in_testing");
  });

  it("rejects links from drill rows to rows that exist only in live", async () => {
    const materialId = await resolveRef(sql, helix.worldId, { table: "materials", code: "Filling-needle gasket, silicone" });
    const [lot] = await sql<{ id: string }[]>`
      insert into material_lots ${sql({
        worldId: helix.worldId,
        companyId: helix.companyId,
        materialId,
        lotCode: `G-LIVE-${crypto.randomUUID().slice(0, 6)}`,
      })}
      returning id`;
    const batchId = await resolveRef(sql, drill.id, { table: "batches", code: "A-2231" });
    await expect(
      sql`insert into batch_material_usage ${sql({ worldId: drill.id, companyId: helix.companyId, batchId, materialLotId: lot?.id ?? null })}`,
    ).rejects.toThrow(/foreign key/);
  });

  it("starts with no incidents or audit history", async () => {
    for (const table of NOT_CLONED_TABLES) expect.soft(await count(table, drill.id), table).toBe(0);
  });

  it("accounts for every world-scoped table as cloned or deliberately not cloned", async () => {
    const rows = await sql<{ tableName: string }[]>`
      select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'world_id' and t.table_type = 'BASE TABLE'
        and c.table_name <> 'drill_runs'`;
    const known = new Set<string>([...CLONED_TABLES, ...NOT_CLONED_TABLES]);
    expect(rows.map((r) => r.tableName).filter((t) => !known.has(t))).toEqual([]);
  });

  it("refuses a non-integer seed and an unknown world", async () => {
    await expect(createDrillWorld(sql, helix.worldId, 1.5)).rejects.toThrow(/integer/);
    await expect(createDrillWorld(sql, crypto.randomUUID(), 1)).rejects.toThrow(/not found/);
  });
});
