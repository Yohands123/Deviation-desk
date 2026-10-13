/**
 * Capacity and cost figures for one world, computed in code so agents never do the arithmetic
 * (CLAUDE.md principle 10). Used by the get_capacity, get_costs and get_resources tools and by the
 * Scheduler's optimizer call.
 */
import type { Sql } from "./client";
import { getInventoryPosition } from "./inventory";

export interface ResourceLoad {
  id: string;
  name: string;
  kind: "fill_line" | "sterility_test" | "qa_release" | "dispatch";
  lineId: string | null;
  lineName: string | null;
  lineStatus: string | null;
  capacity: number;
  capacityBasis: "per_day" | "concurrent";
  taskHours: number;
  /** Jobs using the resource right now (null when the twin does not track it). */
  inUse: number | null;
  free: number | null;
  notes: string | null;
}

export async function getCapacity(sql: Sql, worldId: string): Promise<ResourceLoad[]> {
  const rows = await sql<Omit<ResourceLoad, "inUse" | "free">[]>`
    select r.id, r.name, r.kind, r.line_id, l.name as line_name, l.status as line_status, r.capacity, r.capacity_basis, r.task_hours, r.notes
    from capacity_resources r
    left join production_lines l on l.world_id = r.world_id and l.id = r.line_id
    where r.world_id = ${worldId}
    order by r.kind, r.name`;
  const [counts] = await sql<{ inTesting: number; atDock: number }[]>`
    select (select count(*) from batches where world_id = ${worldId} and status = 'in_testing')::int as in_testing,
      (select count(*) from shipments where world_id = ${worldId} and status = 'at_dock')::int as at_dock`;
  const producing = await sql<{ lineId: string; n: number }[]>`
    select line_id, count(*)::int as n from batches where world_id = ${worldId} and status = 'in_production' group by line_id`;

  return rows.map((r) => {
    let inUse: number | null = null;
    if (r.kind === "fill_line") inUse = r.lineStatus === "running" ? (producing.find((p) => p.lineId === r.lineId)?.n ?? 0) : r.capacity;
    if (r.kind === "sterility_test") inUse = counts?.inTesting ?? 0;
    if (r.kind === "dispatch") inUse = counts?.atDock ?? 0;
    return { ...r, inUse, free: inUse === null ? null : Math.max(0, r.capacity - inUse) };
  });
}

export interface BatchExposure {
  batchCode: string;
  status: string;
  product: string;
  unitPriceUsd: number;
  units: { inStock: number; onHold: number; staged: number; inTransit: number; delivered: number };
  valueUsd: { inStock: number; onHold: number; staged: number; inTransit: number; delivered: number };
}

/** Where each batch's units are, and what they are worth. Staged = in planned or at-dock shipments. */
export async function batchExposure(sql: Sql, worldId: string, batchCodes: string[]): Promise<BatchExposure[]> {
  const rows = await sql<Array<{ batchCode: string; status: string; product: string; unitPriceUsd: string; inStock: number; onHold: number; staged: number; inTransit: number; delivered: number }>>`
    select b.batch_code, b.status, p.name as product, p.unit_price_usd,
      coalesce((select sum(i.quantity) from inventory_lots i where i.world_id = b.world_id and i.batch_id = b.id), 0)::int as in_stock,
      coalesce((select sum(i.quantity) from inventory_lots i where i.world_id = b.world_id and i.batch_id = b.id and i.on_hold), 0)::int as on_hold,
      ${shipped(sql, ["planned", "at_dock", "held"])} as staged,
      ${shipped(sql, ["in_transit"])} as in_transit,
      ${shipped(sql, ["delivered"])} as delivered
    from batches b join products p on p.world_id = b.world_id and p.id = b.product_id
    where b.world_id = ${worldId} and b.batch_code in ${sql(batchCodes.length > 0 ? batchCodes : ["-"])}
    order by b.batch_code`;
  return rows.map(({ unitPriceUsd, inStock, onHold, staged, inTransit, delivered, ...b }) => {
    const price = Number(unitPriceUsd);
    const units = { inStock, onHold, staged, inTransit, delivered };
    const value = (n: number) => Math.round(n * price * 100) / 100;
    return {
      ...b,
      unitPriceUsd: price,
      units,
      valueUsd: { inStock: value(inStock), onHold: value(onHold), staged: value(staged), inTransit: value(inTransit), delivered: value(delivered) },
    };
  });
}

function shipped(sql: Sql, statuses: string[]) {
  return sql`coalesce((select sum(si.quantity) from shipment_items si
    join shipments s on s.world_id = si.world_id and s.id = si.shipment_id
    join inventory_lots i on i.world_id = si.world_id and i.id = si.inventory_lot_id
    where si.world_id = b.world_id and i.batch_id = b.id and s.status in ${sql(statuses)}), 0)::int`;
}

export interface OrderValue {
  orderCode: string;
  destination: string;
  priority: string;
  dueAt: Date;
  quantity: number;
  valueUsd: number;
  covered: boolean;
}

/** Upcoming orders, their value, and whether clean supply covers them. */
export async function orderValues(sql: Sql, worldId: string): Promise<OrderValue[]> {
  const position = await getInventoryPosition(sql, worldId);
  const prices = await sql<{ orderCode: string; price: string }[]>`
    select o.order_code, p.unit_price_usd as price from orders o join products p on p.world_id = o.world_id and p.id = o.product_id
    where o.world_id = ${worldId}`;
  const priceOf = new Map(prices.map((p) => [p.orderCode, Number(p.price)]));
  return position.orders.map((o) => ({
    orderCode: o.orderCode,
    destination: o.destination,
    priority: o.priority,
    dueAt: o.dueAt,
    quantity: o.quantity,
    valueUsd: Math.round(o.quantity * (priceOf.get(o.orderCode) ?? 0) * 100) / 100,
    covered: o.covered,
  }));
}
