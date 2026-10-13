import { z } from "zod";
import { getSql } from "@/db/client";
import { getInventoryPosition } from "@/db/inventory";
import { planOrder } from "@/logistics/plan-order";
import type { AgentTool } from "./types";

const orderInput = z.object({ orderCode: z.string().describe('e.g. "ORD-1045"') });

export const getOrder: AgentTool<typeof orderInput> = {
  name: "get_order",
  description:
    'One order: product, destination, quantity, due time, priority, whether an active clean shipment covers it, and the open incidents and held batches of the same product that could affect it. Cite the order as table "orders" and incidents as "incidents".',
  input: orderInput,
  async run({ orderCode }, ctx) {
    const sql = getSql();
    const [order] = await sql<{ id: string; productId: string }[]>`
      select o.id, o.order_code, p.id as product_id, p.name as product, l.name as destination, o.quantity, o.due_at, o.priority, o.status, o.logged_at
      from orders o join products p on p.world_id = o.world_id and p.id = o.product_id join locations l on l.world_id = o.world_id and l.id = o.destination_id
      where o.world_id = ${ctx.worldId} and o.order_code = ${orderCode}`;
    if (!order) return { error: `No order ${orderCode}.` };
    const coverage = (await getInventoryPosition(sql, ctx.worldId)).orders.find((o) => o.orderCode === orderCode);
    const heldBatches = await sql`
      select id, batch_code, status from batches
      where world_id = ${ctx.worldId} and product_id = ${order.productId}
        and (status in ('quarantined', 'rejected') or exists (select 1 from inventory_lots i where i.world_id = batches.world_id and i.batch_id = batches.id and i.on_hold))
      order by batch_code`;
    const openIncidents = await sql`
      select id, code, title, incident_type, severity, status from incidents where world_id = ${ctx.worldId} and status <> 'closed' order by opened_at`;
    const { productId: _, ...rest } = order;
    return {
      citeAs: { order: "orders", incidents: "incidents", batches: "batches" },
      order: rest,
      covered: coverage?.covered ?? false,
      coveringShipments: coverage?.coveringShipments ?? [],
      blockedShipments: coverage?.blockedShipments ?? [],
      heldBatches,
      openIncidents,
    };
  },
};

export const optimizeSchedule: AgentTool<typeof orderInput> = {
  name: "optimize_schedule",
  description:
    "Plan the earliest realistic supply for an order. The optimizer schedules fills, sterility tests, QA release and dispatch on shared capacity; code assigns supplies to every competing order by priority. Returns the order's sources and arrival, every competing order's plan, what serving this order first would gain it and which orders it would delay (with hours), and when a new batch could be ready. Use these figures exactly; never compute dates yourself. Cite the order (\"orders\") and capacity resources (\"capacity_resources\").",
  input: orderInput,
  async run({ orderCode }, ctx) {
    const sql = getSql();
    const plan = await planOrder(sql, ctx.worldId, orderCode);
    const resources = await sql`select id, name from capacity_resources where world_id = ${ctx.worldId} order by name`;
    return { citeAs: { order: "orders", resources: "capacity_resources" }, resources, ...plan };
  },
};
