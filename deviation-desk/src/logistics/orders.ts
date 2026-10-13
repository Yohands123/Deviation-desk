/**
 * Logging an order (the Orders page and the eval's urgent-order trigger) and judging its urgency.
 * Urgency is a rule, not a judgment, so code decides it; the Order Desk explains.
 */
import type { Sql } from "@/db/client";

const HOUR_MS = 3_600_000;
/** Orders due within this many hours are urgent unless already covered. */
export const URGENT_WITHIN_HOURS = 72;

export interface NewOrder {
  worldId: string;
  companyId: string;
  productId: string;
  destinationId: string;
  quantity: number;
  dueAt: Date;
  priority: "routine" | "high" | "patient_critical";
  loggedBy: string | null;
  loggedAt: Date;
}

export async function logOrder(sql: Sql, order: NewOrder): Promise<{ id: string; orderCode: string }> {
  return sql.begin(async (tx) => {
    // One order code at a time per world.
    await tx`select pg_advisory_xact_lock(hashtext(${`order-code:${order.worldId}`}))`;
    const [{ next } = { next: 1001 }] = await tx<{ next: number }[]>`
      select coalesce(max(substring(order_code from '^ORD-(\\d+)$')::int), 1000) + 1 as next from orders where world_id = ${order.worldId}`;
    const orderCode = `ORD-${next}`;
    const [row] = await tx<{ id: string }[]>`insert into orders ${tx({ ...order, orderCode })} returning id`;
    if (!row) throw new Error("Failed to log the order");
    return { id: row.id, orderCode };
  });
}

export function isUrgent(order: { priority: string; dueAt: Date }, covered: boolean, now: Date): boolean {
  if (covered) return false;
  return order.priority === "patient_critical" || order.dueAt.getTime() - now.getTime() <= URGENT_WITHIN_HOURS * HOUR_MS;
}
