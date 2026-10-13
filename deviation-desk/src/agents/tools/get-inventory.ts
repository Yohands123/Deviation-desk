import { z } from "zod";
import { getSql } from "@/db/client";
import { getInventoryPosition, ORDER_HORIZON_DAYS } from "@/db/inventory";
import type { AgentTool } from "./types";

const input = z.object({});

export const getInventory: AgentTool<typeof input> = {
  name: "get_inventory",
  description: `Compute the stock position now: available stock (released, not on hold, free of reservations), stock at risk (on hold or quarantined), pending stock (in testing), and which orders due in the next ${ORDER_HORIZON_DAYS} days are not covered by a clean, active shipment. Cite stock as table "inventory_lots" and orders as "orders".`,
  input,
  async run(_input, ctx) {
    const p = await getInventoryPosition(getSql(), ctx.worldId);
    const lotView = (l: { id: string; batchCode: string; batchStatus: string; locationName: string; quantity: number; onHold: boolean }) => ({
      id: l.id,
      batch: l.batchCode,
      batchStatus: l.batchStatus,
      location: l.locationName,
      quantity: l.quantity,
      onHold: l.onHold,
    });
    return {
      citeAs: { stock: "inventory_lots", orders: "orders" },
      asOf: p.asOf,
      available: p.available.map((l) => ({ ...lotView(l), free: l.free })),
      atRisk: p.atRisk.map(lotView),
      pending: p.pending.map(lotView),
      orders: p.orders.map((o) => ({
        id: o.id,
        order: o.orderCode,
        destination: o.destination,
        quantity: o.quantity,
        dueAt: o.dueAt,
        priority: o.priority,
        covered: o.covered,
        coveringShipments: o.coveringShipments,
        blockedShipments: o.blockedShipments,
      })),
    };
  },
};
