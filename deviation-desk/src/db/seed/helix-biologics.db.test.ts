import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isRising } from "../../monitoring/watchers";
import { closeSql, getSql } from "../client";
import { resolveRef } from "../resolve-ref";
import { SEED_ANCHOR, seedHelixBiologics, type SeededCompany } from "./helix-biologics";

const sql = getSql();
let helix: SeededCompany;
const ref = (table: string, code: string) => resolveRef(sql, helix.worldId, { table, code });

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
});
afterAll(closeSql);

describe("Helix Biologics seed (docs/DOMAIN.md §Seed)", () => {
  it("has the six rooms, by name", async () => {
    const rooms = await sql<{ name: string }[]>`select name from rooms where world_id = ${helix.worldId} order by name`;
    expect(rooms.map((r) => r.name)).toEqual(["Dock", "Fill Room 3", "Line 4", "QA Office", "QC Lab", "Warehouse"]);
  });

  it("has A-2231 on Line 3 and A-2234 on Line 4, both using gasket lot G-77", async () => {
    const g77 = await ref("material_lots", "G-77");
    const rows = await sql<{ batchCode: string; line: string }[]>`
      select b.batch_code, pl.name as line
      from batches b
      join production_lines pl on pl.world_id = b.world_id and pl.id = b.line_id
      join batch_material_usage u on u.world_id = b.world_id and u.batch_id = b.id
      where b.world_id = ${helix.worldId} and u.material_lot_id = ${g77}
        and b.batch_code in ('A-2231', 'A-2234')
      order by b.batch_code`;
    expect(rows).toEqual([
      { batchCode: "A-2231", line: "Line 3" },
      { batchCode: "A-2234", line: "Line 4" },
    ]);
    const batches = await sql`select 1 from batches where world_id = ${helix.worldId}`;
    expect(batches.length).toBeGreaterThanOrEqual(6);
  });

  it("has four suppliers, a single-source stopper and an approved backup gasket supplier", async () => {
    const rows = await sql<{ material: string; approved: number }[]>`
      select m.name as material, (count(*) filter (where ms.approved))::int as approved
      from materials m join material_suppliers ms on ms.world_id = m.world_id and ms.material_id = m.id
      where m.world_id = ${helix.worldId}
      group by m.name`;
    const approved = Object.fromEntries(rows.map((r) => [r.material, r.approved]));
    expect(approved["Vial stopper, 13 mm bromobutyl"]).toBe(1);
    expect(approved["Filling-needle gasket, silicone"]).toBe(2);
    const suppliers = await sql`select 1 from suppliers where world_id = ${helix.worldId}`;
    expect(suppliers).toHaveLength(4);
  });

  it("has SH-118 at the dock holding A-2231 units", async () => {
    const rows = await sql<{ status: string; batchCode: string }[]>`
      select s.status, b.batch_code
      from shipments s
      join shipment_items si on si.world_id = s.world_id and si.shipment_id = s.id
      join inventory_lots i on i.world_id = si.world_id and i.id = si.inventory_lot_id
      join batches b on b.world_id = i.world_id and b.id = i.batch_id
      where s.world_id = ${helix.worldId} and s.shipment_code = 'SH-118'`;
    expect(rows).toEqual([{ status: "at_dock", batchCode: "A-2231" }]);
  });

  it("has at least five orders, one urgent trial-site order due within 48 hours", async () => {
    const orders = await sql<{ dueAt: Date; priority: string; kind: string }[]>`
      select o.due_at, o.priority, l.kind
      from orders o join locations l on l.world_id = o.world_id and l.id = o.destination_id
      where o.world_id = ${helix.worldId}`;
    expect(orders.length).toBeGreaterThanOrEqual(5);
    const hoursAhead = (o: { dueAt: Date }) => (o.dueAt.getTime() - SEED_ANCHOR.getTime()) / 3_600_000;
    const urgent = orders.filter(
      (o) => o.kind === "trial_site" && o.priority === "patient_critical" && hoursAhead(o) > 0 && hoursAhead(o) <= 48,
    );
    expect(urgent).toHaveLength(1);
  });

  it("has released stock at Montreal DC", async () => {
    const dc = await ref("locations", "Montreal DC");
    const rows = await sql`
      select 1 from inventory_lots i
      join batches b on b.world_id = i.world_id and b.id = i.batch_id
      where i.world_id = ${helix.worldId} and i.location_id = ${dc} and b.status = 'released'`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it("has 14 people, including Priya (Plant Manager) and Marcus (Clinical Ops)", async () => {
    const people = await sql<{ name: string; role: string }[]>`
      select name, role from people where world_id = ${helix.worldId}`;
    expect(people).toHaveLength(14);
    expect(people).toContainEqual({ name: "Priya Raman", role: "Plant Manager" });
    expect(people).toContainEqual({ name: "Marcus Bell", role: "Clinical Ops Manager" });
  });

  it("has 30 days of Fill Room 3 EM readings rising over the final three days", async () => {
    const room = await ref("rooms", "Fill Room 3");
    const rows = await sql<{ value: string }[]>`
      select value from sensor_readings
      where world_id = ${helix.worldId} and subject_id = ${room} and metric = 'em_cfu'
      order by recorded_at`;
    const values = rows.map((r) => Number(r.value));
    expect(values).toHaveLength(30);
    expect(isRising(values)).toBe(true);
    expect(isRising(values.slice(0, -1))).toBe(false);
  });

  it("is missing the Oct 9 Fill Room 3 cleaning record, and only that day", async () => {
    const room = await ref("rooms", "Fill Room 3");
    const days = await sql<{ day: string }[]>`
      select to_char(recorded_at at time zone 'America/Toronto', 'YYYY-MM-DD') as day from records
      where world_id = ${helix.worldId} and record_type = 'cleaning' and subject_id = ${room}`;
    const seen = new Set(days.map((d) => d.day));
    expect(seen.has("2026-10-09")).toBe(false);
    expect(seen.has("2026-10-08")).toBe(true);
    expect(seen.has("2026-10-10")).toBe(true);
    expect(seen.size).toBe(28);
  });

  it("has the Oct 3 Filler 3 maintenance log noting gasket wear", async () => {
    const filler = await ref("equipment", "Filler 3");
    const rows = await sql<{ body: string }[]>`
      select body from records
      where world_id = ${helix.worldId} and record_type = 'maintenance' and subject_id = ${filler}
        and (recorded_at at time zone 'America/Toronto')::date = '2026-10-03'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toMatch(/wear on filling-needle gasket/i);
  });

  it("is deterministic: a second seed produces identical sensor values", async () => {
    const other = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
    const values = async (worldId: string) =>
      (
        await sql<{ value: string }[]>`
          select s.value from sensor_readings s
          join twin_nodes t on t.world_id = s.world_id and t.node_table = s.subject_table and t.node_id = s.subject_id
          where s.world_id = ${worldId}
          -- Rooms share timestamps, so order by subject name too for a stable comparison.
          order by s.recorded_at, s.subject_table, t.label, s.metric`
      ).map((r) => r.value);
    expect(await values(other.worldId)).toEqual(await values(helix.worldId));
  });
});
