/**
 * Inventory position for one world: what stock is usable, what is at risk, and which upcoming
 * orders have no clean, active shipment. Deterministic so agents never do this arithmetic
 * (CLAUDE.md principle 10). Used by the get_inventory tool and by shortfall detection.
 *
 * Conventions: inventory_lots.quantity is stock on hand at that location. Planned and at-dock
 * shipments reserve stock from their lots; in-transit and delivered stock has already left.
 */
import type { Sql } from "./client";

export const ORDER_HORIZON_DAYS = 14;
const STOCKING_KINDS = new Set(["warehouse_bay", "distribution_center"]);
const ACTIVE_SHIPMENT = new Set(["planned", "at_dock", "in_transit", "delivered"]);

export interface StockLot {
  id: string;
  batchCode: string;
  batchStatus: string;
  producedAt: Date | null;
  locationName: string;
  locationKind: string;
  quantity: number;
  onHold: boolean;
  /** Reserved by planned or at-dock shipments. */
  committed: number;
}

export interface OrderRow {
  id: string;
  orderCode: string;
  destination: string;
  quantity: number;
  dueAt: Date;
  priority: string;
  status: string;
}

export interface OrderShipment {
  shipmentCode: string;
  orderId: string;
  status: string;
  /** Every item comes from a released batch with no hold. False when the shipment carries nothing. */
  clean: boolean;
}

export interface OrderCoverage extends OrderRow {
  covered: boolean;
  coveringShipments: string[];
  /** Shipments for this order that are held or carry held/unreleased stock. */
  blockedShipments: string[];
}

export interface InventoryPosition {
  asOf: Date;
  available: Array<StockLot & { free: number }>;
  atRisk: StockLot[];
  pending: StockLot[];
  orders: OrderCoverage[];
  uncovered: OrderCoverage[];
}

export function computePosition(
  lots: StockLot[],
  orders: OrderRow[],
  shipments: OrderShipment[],
  asOf: Date,
  horizonDays = ORDER_HORIZON_DAYS,
): InventoryPosition {
  const available: InventoryPosition["available"] = [];
  const atRisk: StockLot[] = [];
  const pending: StockLot[] = [];
  for (const lot of lots) {
    if (lot.onHold || lot.batchStatus === "quarantined" || lot.batchStatus === "rejected") atRisk.push(lot);
    else if (lot.batchStatus !== "released") pending.push(lot);
    else if (STOCKING_KINDS.has(lot.locationKind) && lot.quantity - lot.committed > 0) {
      available.push({ ...lot, free: lot.quantity - lot.committed });
    }
  }

  const horizonEnd = asOf.getTime() + horizonDays * 86_400_000;
  const coverage = orders
    .filter((o) => !["delivered", "cancelled"].includes(o.status) && o.dueAt.getTime() <= horizonEnd)
    .map((o): OrderCoverage => {
      const forOrder = shipments.filter((s) => s.orderId === o.id);
      const good = forOrder.filter((s) => ACTIVE_SHIPMENT.has(s.status) && s.clean);
      const blocked = forOrder.filter((s) => s.status === "held" || (ACTIVE_SHIPMENT.has(s.status) && !s.clean));
      return {
        ...o,
        covered: good.length > 0,
        coveringShipments: good.map((s) => s.shipmentCode),
        blockedShipments: blocked.map((s) => s.shipmentCode),
      };
    })
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  return { asOf, available, atRisk, pending, orders: coverage, uncovered: coverage.filter((o) => !o.covered) };
}

/** The world's current time: its simulated clock for drills, the wall clock otherwise. */
export async function worldClock(sql: Sql, worldId: string): Promise<Date> {
  const [row] = await sql<{ simClock: Date | null }[]>`select sim_clock from worlds where id = ${worldId}`;
  if (!row) throw new Error(`World ${worldId} not found`);
  return row.simClock ?? new Date();
}

export async function getInventoryPosition(sql: Sql, worldId: string): Promise<InventoryPosition> {
  const lots = await sql<Array<Omit<StockLot, "quantity" | "committed"> & { quantity: number; committed: number }>>`
    select i.id, b.batch_code, b.status as batch_status, b.produced_at, l.name as location_name, l.kind as location_kind,
      i.quantity, i.on_hold,
      coalesce((select sum(si.quantity) from shipment_items si
        join shipments s on s.world_id = si.world_id and s.id = si.shipment_id
        where si.world_id = i.world_id and si.inventory_lot_id = i.id and s.status in ('planned', 'at_dock')), 0)::int as committed
    from inventory_lots i
    join batches b on b.world_id = i.world_id and b.id = i.batch_id
    join locations l on l.world_id = i.world_id and l.id = i.location_id
    where i.world_id = ${worldId}
    order by b.produced_at, l.name`;
  const orders = await sql<OrderRow[]>`
    select o.id, o.order_code, l.name as destination, o.quantity, o.due_at, o.priority, o.status
    from orders o join locations l on l.world_id = o.world_id and l.id = o.destination_id
    where o.world_id = ${worldId}`;
  const shipments = await sql<OrderShipment[]>`
    select s.shipment_code, s.order_id, s.status,
      coalesce(bool_and(i.id is not null and not i.on_hold and b.status = 'released'), false) as clean
    from shipments s
    left join shipment_items si on si.world_id = s.world_id and si.shipment_id = s.id
    left join inventory_lots i on i.world_id = si.world_id and i.id = si.inventory_lot_id
    left join batches b on b.world_id = i.world_id and b.id = i.batch_id
    where s.world_id = ${worldId} and s.order_id is not null
    group by s.id, s.shipment_code, s.order_id, s.status`;
  return computePosition(lots, orders, shipments, await worldClock(sql, worldId));
}
