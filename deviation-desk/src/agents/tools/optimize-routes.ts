import { z } from "zod";
import { getSql } from "@/db/client";
import { getInventoryPosition } from "@/db/inventory";
import { allocate } from "@/lib/optimizer";
import type { AgentTool } from "./types";

const input = z.object({ orderCode: z.string().describe('e.g. "ORD-1045".') });

export const optimizeRoutes: AgentTool<typeof input> = {
  name: "optimize_routes",
  description:
    'Plan supply for one order with the optimizer: gathers available stock per location, the transport lanes to the order\'s destination, and the time left before it is due, then returns the least-cost on-time allocation (or why none exists) and the sources it considered. Cite the order as table "orders".',
  input,
  async run({ orderCode }, ctx) {
    const sql = getSql();
    const [order] = await sql<{ id: string; quantity: number; dueAt: Date; destinationId: string; destination: string; storageCondition: string }[]>`
      select o.id, o.quantity, o.due_at, o.destination_id, l.name as destination, p.storage_condition
      from orders o
      join locations l on l.world_id = o.world_id and l.id = o.destination_id
      join products p on p.world_id = o.world_id and p.id = o.product_id
      where o.world_id = ${ctx.worldId} and o.order_code = ${orderCode}`;
    if (!order) throw new Error(`No order ${orderCode}`);

    const position = await getInventoryPosition(sql, ctx.worldId);
    const freeByLocation = new Map<string, number>();
    for (const lot of position.available) freeByLocation.set(lot.locationName, (freeByLocation.get(lot.locationName) ?? 0) + lot.free);

    const lanes = await sql<{ origin: string; transitHours: string; costPerUnit: string }[]>`
      select l.name as origin, ln.transit_hours, ln.cost_per_unit
      from lanes ln join locations l on l.world_id = ln.world_id and l.id = ln.origin_id
      where ln.world_id = ${ctx.worldId} and ln.destination_id = ${order.destinationId}
        and ln.storage_condition = ${order.storageCondition}`;
    const laneByOrigin = new Map(lanes.map((l) => [l.origin, { transitHours: Number(l.transitHours), costPerUnit: Number(l.costPerUnit) }]));

    const dueInHours = Math.round(((order.dueAt.getTime() - position.asOf.getTime()) / 3_600_000) * 10) / 10;
    const considered = [...freeByLocation].map(([location, available]) => {
      const lane = laneByOrigin.get(location);
      return {
        location,
        available,
        transitHours: lane?.transitHours ?? null,
        costPerUnit: lane?.costPerUnit ?? null,
        excludedBecause: !lane ? "no lane to the destination" : lane.transitHours > dueInHours ? "cannot arrive before the due time" : null,
      };
    });

    const sources = considered
      .filter((c) => c.transitHours !== null && c.costPerUnit !== null)
      .map((c) => ({ location_id: c.location, available: c.available, cost_per_unit: c.costPerUnit ?? 0, transit_hours: c.transitHours ?? 0 }));
    const result = await allocate({ sources, demand: { order_id: orderCode, quantity: order.quantity, due_in_hours: dueInHours } });

    const arrivesWithinHours = result.feasible
      ? Math.max(...result.allocations.map((a) => laneByOrigin.get(a.location_id)?.transitHours ?? 0))
      : null;
    return {
      citeAs: { order: "orders" },
      order: { id: order.id, orderCode, quantity: order.quantity, destination: order.destination, dueInHours },
      result: {
        feasible: result.feasible,
        allocations: result.allocations.map((a) => ({ location: a.location_id, quantity: a.quantity })),
        totalCost: Math.round(result.total_cost * 100) / 100,
        arrivesWithinHours,
        note: result.note,
      },
      sourcesConsidered: considered,
    };
  },
};
