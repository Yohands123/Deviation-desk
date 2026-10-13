/**
 * Which supply serves which order, once every supply's ready time is known (from stock on hand or
 * the optimizer's schedule). Pure and deterministic; the Scheduler agent explains the result.
 */

export interface Supply {
  id: string;
  label: string;
  kind: "released_stock" | "in_testing" | "in_production" | "new_batch";
  units: number;
  /** Hours from now until it can leave the site (released, reviewed and dispatched). */
  readyHours: number;
  /** Hours in transit to each destination. Missing: no lane. */
  transitHours: Record<string, number>;
}

export interface Demand {
  orderCode: string;
  destination: string;
  quantity: number;
  priority: "routine" | "high" | "patient_critical";
  /** Hours from now until due (negative if already late). */
  dueHours: number;
}

export interface Assignment {
  orderCode: string;
  /** The supplies used, soonest first; empty when the order cannot be met in full. */
  parts: Array<{ supplyId: string; label: string; units: number; arrivesHours: number }>;
  /** When the last part arrives; null when the order cannot be met in full. */
  arrivesHours: number | null;
  lateHours: number | null;
}

const RANK = { patient_critical: 0, high: 1, routine: 2 } as const;

/** Orders in service order: most urgent priority first, then earliest due. */
export function serviceOrder(demands: Demand[]): Demand[] {
  return [...demands].sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.dueHours - b.dueHours || a.orderCode.localeCompare(b.orderCode));
}

/**
 * Greedy: each order, in the given order, takes units from the supplies that reach it soonest until
 * it is met; it arrives when its last part does. Units taken are gone for later orders.
 */
export function assign(orders: Demand[], supplies: Supply[]): Assignment[] {
  const left = new Map(supplies.map((s) => [s.id, s.units]));
  return orders.map((o) => {
    const reachable = supplies
      .flatMap((s) => {
        const transit = s.transitHours[o.destination];
        return transit === undefined || (left.get(s.id) ?? 0) <= 0 ? [] : [{ s, arrives: s.readyHours + transit }];
      })
      .sort((a, b) => a.arrives - b.arrives || a.s.id.localeCompare(b.s.id));
    const parts: Assignment["parts"] = [];
    let need = o.quantity;
    for (const { s, arrives } of reachable) {
      if (need === 0) break;
      const take = Math.min(need, left.get(s.id) ?? 0);
      parts.push({ supplyId: s.id, label: s.label, units: take, arrivesHours: arrives });
      need -= take;
    }
    if (need > 0) return { orderCode: o.orderCode, parts: [], arrivesHours: null, lateHours: null };
    for (const p of parts) left.set(p.supplyId, (left.get(p.supplyId) ?? 0) - p.units);
    const arrives = Math.max(...parts.map((p) => p.arrivesHours));
    return { orderCode: o.orderCode, parts, arrivesHours: arrives, lateHours: Math.max(0, arrives - o.dueHours) };
  });
}

export interface TradeOff {
  /** The target order's arrival when served in normal priority order, and when served first. */
  normalArrivesHours: number | null;
  firstArrivesHours: number | null;
  /** Orders that would arrive later if the target were served first. */
  bumped: Array<{ orderCode: string; fromHours: number | null; toHours: number | null; delayHours: number | null }>;
}

/** What serving the target order first would gain it, and cost everyone else. */
export function tradeOff(target: string, demands: Demand[], supplies: Supply[]): TradeOff {
  const normal = assign(serviceOrder(demands), supplies);
  const first = assign(
    serviceOrder(demands).sort((a, b) => Number(b.orderCode === target) - Number(a.orderCode === target)),
    supplies,
  );
  const at = (list: Assignment[], code: string) => list.find((a) => a.orderCode === code)?.arrivesHours ?? null;
  const bumped = demands
    .filter((d) => d.orderCode !== target)
    .map((d) => {
      const from = at(normal, d.orderCode);
      const to = at(first, d.orderCode);
      const delay = from === null ? null : to === null ? null : to - from;
      return { orderCode: d.orderCode, fromHours: from, toHours: to, delayHours: delay };
    })
    .filter((b) => b.delayHours === null ? b.fromHours !== null : b.delayHours > 0);
  return { normalArrivesHours: at(normal, target), firstArrivesHours: at(first, target), bumped };
}
