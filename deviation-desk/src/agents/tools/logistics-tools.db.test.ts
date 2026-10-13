import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/db/client";
import { createDrillWorld } from "@/db/create-drill-world";
import { resolveRef } from "@/db/resolve-ref";
import { SEED_ANCHOR, seedHelixBiologics } from "@/db/seed/helix-biologics";
import { optimizerIsUp } from "@/lib/optimizer";
import { runReadingWatchers } from "@/monitoring/run-watchers";
import { tools } from ".";
import type { ToolContext } from "./types";

const sql = getSql();
let ctx: ToolContext;
let liveWorldId: string;
let optimizerUp = false;

async function call(name: string, input: unknown): Promise<Record<string, unknown>> {
  const tool = tools[name];
  if (!tool) throw new Error(`no tool ${name}`);
  return (await tool.run(tool.input.parse(input), ctx)) as Record<string, unknown>;
}

beforeAll(async () => {
  const helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  liveWorldId = helix.worldId;
  // A drill at the seed's anchor time, so due dates and the order horizon line up with the seed.
  const drill = await createDrillWorld(sql, helix.worldId, 3, { simClock: SEED_ANCHOR });
  ctx = { worldId: drill.id, companyId: helix.companyId, incidentId: null, agentId: "test" };
  optimizerUp = await optimizerIsUp();
  if (!optimizerUp) console.warn("Optimizer not running (npm run optimizer); skipping optimize_routes tests.");
});
afterAll(closeSql);

type Orders = Array<{ order: string; covered: boolean; blockedShipments: string[] }>;

describe("get_inventory", () => {
  it("finds the urgent trial order without supply, and clean stock at Montreal DC", async () => {
    const result = await call("get_inventory", {});
    const orders = result.orders as Orders;
    expect(orders.find((o) => o.order === "ORD-1045")?.covered).toBe(false);
    expect(orders.find((o) => o.order === "ORD-1044")?.covered).toBe(true);
    const available = result.available as Array<{ batch: string; location: string }>;
    expect(available.some((l) => l.batch === "A-2227" && l.location === "Montreal DC")).toBe(true);
  });

  it("shows an order losing its supply when its stock goes on hold", async () => {
    await sql`
      update inventory_lots set on_hold = true
      where world_id = ${ctx.worldId} and batch_id = ${await resolveRef(sql, ctx.worldId, { table: "batches", code: "A-2230" })}`;
    const orders = (await call("get_inventory", {})).orders as Orders;
    expect(orders.find((o) => o.order === "ORD-1044")).toMatchObject({ covered: false, blockedShipments: ["SH-119"] });
  });
});

describe("get_shipment_telemetry", () => {
  it("reports SH-117 inside its range with no excursions", async () => {
    const result = await call("get_shipment_telemetry", { shipmentCode: "SH-117" });
    expect(result.rangeC).toEqual({ minC: 2, maxC: 8 });
    expect(result.excursions).toEqual([]);
    expect((result.readings as unknown[]).length).toBe(12);
  });
});

describe("get_approved_suppliers", () => {
  it("shows stoppers as single source and gaskets with an approved backup", async () => {
    const result = await call("get_approved_suppliers", { supplier: "Kestrel" });
    const materials = result.materials as Array<{ material: string; singleSource: boolean; suppliers: Array<{ name: string }> }>;
    expect(materials).toHaveLength(1);
    expect(materials[0]?.singleSource).toBe(false);
    expect(materials[0]?.suppliers.map((s) => s.name)).toEqual(["Arbor Polymer Seals", "Kestrel Seals"]);
    const stoppers = (await call("get_approved_suppliers", { material: "stopper" })).materials as Array<{ singleSource: boolean }>;
    expect(stoppers[0]?.singleSource).toBe(true);
  });
});

describe("optimize_routes", () => {
  it("covers ORD-1045 from stock that can reach trial site 212 in time", async (t) => {
    if (!optimizerUp) t.skip();
    const result = await call("optimize_routes", { orderCode: "ORD-1045" });
    const plan = result.result as { feasible: boolean; allocations: Array<{ location: string; quantity: number }>; arrivesWithinHours: number };
    expect(plan.feasible).toBe(true);
    expect(plan.allocations).toEqual([{ location: "Montreal DC", quantity: 150 }]);
    expect(plan.arrivesWithinHours).toBe(22);
  });
});

describe("runReadingWatchers", () => {
  it("emits one excursion event for a burst of warm readings, then nothing on the next scan", async () => {
    const now = new Date();
    const sh117 = await resolveRef(sql, liveWorldId, { table: "shipments", code: "SH-117" });
    const [{ companyId } = { companyId: "" }] = await sql<{ companyId: string }[]>`select company_id from worlds where id = ${liveWorldId}`;
    for (const [minutesAgo, value] of [[20, 9.4], [10, 10.1]] as const) {
      await sql`insert into sensor_readings ${sql({ worldId: liveWorldId, companyId, subjectTable: "shipments", subjectId: sh117, metric: "temp_c", value, recordedAt: new Date(now.getTime() - minutesAgo * 60_000) })}`;
    }
    const mine = (events: Awaited<ReturnType<typeof runReadingWatchers>>) => events.filter((e) => e.data.worldId === liveWorldId);

    const first = mine(await runReadingWatchers(sql, now));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: "shipment/temp_excursion", data: { subjectId: sh117, value: 10.1 } });
    expect(mine(await runReadingWatchers(sql, new Date(now.getTime() + 1000)))).toEqual([]);
  });
});
