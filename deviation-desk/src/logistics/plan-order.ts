/**
 * Earliest realistic supply for an order (the Scheduler's optimize_schedule tool). Physics does not
 * speed up (CLAUDE.md principle 8): a new batch is filled on a free line, tested for the product's
 * full sterility period, reviewed by QA, dispatched and trucked. The optimizer schedules those steps
 * on shared capacity (principle 10); code assigns the results to orders and shows the trade-offs.
 */
import type { Sql } from "@/db/client";
import { getCapacity } from "@/db/capacity";
import { getInventoryPosition } from "@/db/inventory";
import { schedule, type ScheduleRequest } from "@/lib/optimizer";
import { worldNow } from "@/regulatory/deadlines";
import { assign, serviceOrder, tradeOff, type Demand, type Supply } from "./assign";

const HOUR_MS = 3_600_000;
const SITE_TIME_ZONE = "America/Toronto";
/** Fills start at the beginning of the day shift. */
const SHIFT_START_HOUR = 6;
const SITE = "site";
/** New batches the plan may schedule for one order's shortfall. */
const MAX_NEW_BATCHES = 16;

/** Whole hours from `now` until the next shift start at the site (0 if it is exactly now). */
export function hoursToShiftStart(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SITE_TIME_ZONE, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const hours = (SHIFT_START_HOUR - hour - minute / 60 + 24) % 24;
  return Math.ceil(hours);
}

/** Shortest transit over the lane network (lanes chain through the DC), from each origin. */
export function transitTable(lanes: Array<{ origin: string; destination: string; hours: number }>, origins: string[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const origin of origins) {
    const best: Record<string, number> = { [origin]: 0 };
    const queue = [origin];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      for (const l of lanes) {
        if (l.origin !== at) continue;
        const via = (best[at] ?? 0) + l.hours;
        if (best[l.destination] === undefined || via < (best[l.destination] ?? Infinity)) {
          best[l.destination] = via;
          queue.push(l.destination);
        }
      }
    }
    delete best[origin];
    out.set(origin, best);
  }
  return out;
}

export interface OrderPlan {
  asOf: string;
  order: { id: string; orderCode: string; destination: string; quantity: number; priority: string; dueAt: string };
  /** The order's own supply in normal priority order. */
  target: { sources: Array<{ label: string; kind: Supply["kind"]; units: number }>; arrivesAt: string | null; lateHours: number | null; onTime: boolean };
  /** What serving this order first would gain it and cost the others; null if it gains nothing. */
  ifServedFirst: { arrivesAt: string | null; bumped: Array<{ orderCode: string; from: string | null; to: string | null; delayHours: number | null }> } | null;
  /** Every competing order's plan. */
  plan: Array<{ orderCode: string; priority: string; dueAt: string; sources: string[]; arrivesAt: string | null; lateHours: number | null }>;
  supplies: Array<{ id: string; label: string; kind: Supply["kind"]; units: number; readyAt: string }>;
  newBatch: { line: string | null; fillStartsAt: string; testEndsAt: string; releasedAt: string; readyAt: string } | null;
  realism: string[];
  optimizer: { optimal: boolean; note: string };
}

export async function planOrder(sql: Sql, worldId: string, orderCode: string): Promise<OrderPlan> {
  const now = await worldNow(sql, worldId);
  const at = (hours: number) => new Date(now.getTime() + hours * HOUR_MS).toISOString();
  const hoursUntil = (d: Date) => Math.round((d.getTime() - now.getTime()) / HOUR_MS);

  const [order] = await sql<
    Array<{ id: string; orderCode: string; destination: string; quantity: number; priority: Demand["priority"]; dueAt: Date; productId: string; testDays: number; storage: string; batchSize: number }>
  >`
    select o.id, o.order_code, l.name as destination, o.quantity, o.priority, o.due_at, p.id as product_id,
      p.release_test_days as test_days, p.storage_condition as storage,
      coalesce((select round(avg(b.quantity)) from batches b where b.world_id = o.world_id and b.product_id = p.id), 0)::int as batch_size
    from orders o
    join locations l on l.world_id = o.world_id and l.id = o.destination_id
    join products p on p.world_id = o.world_id and p.id = o.product_id
    where o.world_id = ${worldId} and o.order_code = ${orderCode}`;
  if (!order) throw new Error(`Order ${orderCode} not found.`);

  const resources = await getCapacity(sql, worldId);
  const lines = resources.filter((r) => r.kind === "fill_line" && r.lineStatus === "running");
  const incubators = resources.find((r) => r.kind === "sterility_test");
  const qa = resources.find((r) => r.kind === "qa_release");
  const dispatch = resources.find((r) => r.kind === "dispatch");
  if (!incubators || !qa || !dispatch) throw new Error("This company has no capacity data for testing, QA release or dispatch.");
  const testHours = order.testDays * 24;
  const dispatchHours = dispatch.taskHours;

  // Transit: stock on site (warehouse bays, dock) leaves from whichever site location is quickest.
  const lanes = await sql<Array<{ origin: string; originKind: string; destination: string; hours: string }>>`
    select o.name as origin, o.kind as origin_kind, d.name as destination, l.transit_hours as hours
    from lanes l join locations o on o.world_id = l.world_id and o.id = l.origin_id join locations d on d.world_id = l.world_id and d.id = l.destination_id
    where l.world_id = ${worldId} and l.storage_condition = ${order.storage}`;
  const siteNames = new Set(lanes.filter((l) => l.originKind === "warehouse_bay" || l.originKind === "dock").map((l) => l.origin));
  const graph = lanes.map((l) => ({ origin: siteNames.has(l.origin) ? SITE : l.origin, destination: l.destination, hours: Number(l.hours) }));
  const position = await getInventoryPosition(sql, worldId);
  const batches = await sql<Array<{ batchCode: string; status: string; producedAt: Date; line: string | null; units: number; lineId: string | null }>>`
    select b.batch_code, b.status, b.produced_at, pl.name as line, b.line_id,
      coalesce((select sum(i.quantity) from inventory_lots i where i.world_id = b.world_id and i.batch_id = b.id and not i.on_hold), b.quantity)::int as units
    from batches b left join production_lines pl on pl.world_id = b.world_id and pl.id = b.line_id
    where b.world_id = ${worldId} and b.product_id = ${order.productId} and b.status in ('in_production', 'in_testing', 'quarantined')
    order by b.produced_at`;
  const productBatches = new Set(
    (await sql<{ batchCode: string }[]>`select batch_code from batches where world_id = ${worldId} and product_id = ${order.productId}`).map((b) => b.batchCode),
  );

  const releasedByLocation = new Map<string, { units: number; kind: string }>();
  for (const lot of position.available) {
    if (!productBatches.has(lot.batchCode)) continue;
    const entry = releasedByLocation.get(lot.locationName) ?? { units: 0, kind: lot.locationKind };
    entry.units += lot.free;
    releasedByLocation.set(lot.locationName, entry);
  }
  const origins = [...new Set([SITE, ...[...releasedByLocation.keys()].map((l) => (siteNames.has(l) ? SITE : l))])];
  const transit = transitTable(graph, origins);
  const transitFrom = (location: string) => transit.get(siteNames.has(location) ? SITE : location) ?? {};

  // ─── Jobs for the optimizer ───
  const toShift = Math.max(1, hoursToShiftStart(now));
  const req: ScheduleRequest = {
    horizon_hours: testHours + 40 * 24,
    resources: [
      ...lines.map((l) => ({ id: `line:${l.lineName}`, capacity: l.capacity })),
      { id: "incubators", capacity: incubators.capacity },
      { id: "qa", capacity: qa.capacity },
      { id: "dispatch", capacity: dispatch.capacity },
    ],
    jobs: [],
  };
  const release = (prefix: string) => [
    { id: `${prefix}qa`, duration_hours: 24, resources: ["qa"] },
    { id: `${prefix}dispatch`, duration_hours: dispatchHours, resources: ["dispatch"] },
  ];
  const supplyJobs: Array<{ jobId: string; supply: Omit<Supply, "readyHours"> }> = [];

  for (const b of batches) {
    const remaining = Math.max(0, hoursUntil(new Date(b.producedAt.getTime() + testHours * HOUR_MS)));
    if (b.status === "quarantined") {
      // Held stock cannot ship, but its test still occupies an incubator slot.
      if (remaining > 0) req.jobs.push({ id: `held:${b.batchCode}`, tasks: [{ id: "test", duration_hours: remaining, resources: ["incubators"], fixed_start_hours: 0 }] });
      continue;
    }
    const tasks =
      b.status === "in_production"
        ? [
            ...(b.line && lines.some((l) => l.lineName === b.line) ? [{ id: "fill", duration_hours: toShift, resources: [`line:${b.line}`], fixed_start_hours: 0 }] : []),
            { id: "test", duration_hours: testHours, resources: ["incubators"] },
            ...release(""),
          ]
        : [...(remaining > 0 ? [{ id: "test", duration_hours: remaining, resources: ["incubators"], fixed_start_hours: 0 }] : []), ...release("")];
    req.jobs.push({ id: b.batchCode, tasks });
    supplyJobs.push({
      jobId: b.batchCode,
      supply: { id: b.batchCode, label: `Batch ${b.batchCode} (${b.status === "in_production" ? "being filled" : "in sterility testing"})`, kind: b.status === "in_production" ? "in_production" : "in_testing", units: b.units, transitHours: transitFrom(SITE) },
    });
  }
  // ─── Orders competing for the same product ───
  const demands: Demand[] = position.uncovered
    .filter((o) => o.orderCode !== orderCode)
    .map((o) => ({ orderCode: o.orderCode, destination: o.destination, quantity: o.quantity, priority: o.priority as Demand["priority"], dueHours: hoursUntil(o.dueAt) }));
  demands.push({ orderCode, destination: order.destination, quantity: order.quantity, priority: order.priority, dueHours: hoursUntil(order.dueAt) });

  // As many new batches as the shortfall needs (at least one, to show what production would take).
  const onHand = [...releasedByLocation.values()].reduce((n, r) => n + r.units, 0) + supplyJobs.reduce((n, j) => n + j.supply.units, 0);
  const shortfall = demands.reduce((n, d) => n + d.quantity, 0) - onHand;
  const newBatches = order.batchSize > 0 ? Math.min(MAX_NEW_BATCHES, Math.max(1, Math.ceil(shortfall / order.batchSize))) : 0;
  if (lines.length > 0) {
    for (let i = 1; i <= newBatches; i++) {
      const id = `new-batch-${i}`;
      req.jobs.push({
        id,
        tasks: [
          { id: "fill", duration_hours: 24, resources: lines.map((l) => `line:${l.lineName}`), earliest_start_hours: toShift },
          { id: "test", duration_hours: testHours, resources: ["incubators"] },
          ...release(""),
        ],
      });
      supplyJobs.push({ jobId: id, supply: { id, label: newBatches > 1 ? `New batch ${i}` : "A new batch", kind: "new_batch", units: order.batchSize, transitHours: transitFrom(SITE) } });
    }
  }

  const solved = await schedule(req);
  if (!solved.feasible) throw new Error(`The optimizer found no schedule: ${solved.note}`);
  const endOf = new Map(solved.jobs.map((j) => [j.id, j]));

  const supplies: Supply[] = [
    ...[...releasedByLocation.entries()].map(([location, { units }]) => ({
      id: `stock:${location}`,
      label: `Released stock at ${location}`,
      kind: "released_stock" as const,
      units,
      readyHours: dispatchHours,
      transitHours: transitFrom(location),
    })),
    ...supplyJobs.flatMap(({ jobId, supply }) => {
      const job = endOf.get(jobId);
      return job ? [{ ...supply, readyHours: job.end_hours }] : [];
    }),
  ];

  const normal = assign(serviceOrder(demands), supplies);
  const mine = normal.find((a) => a.orderCode === orderCode);
  const kindOf = new Map(supplies.map((s) => [s.id, s.kind]));
  const trade = tradeOff(orderCode, demands, supplies);
  const gains = trade.firstArrivesHours !== null && (trade.normalArrivesHours === null || trade.firstArrivesHours < trade.normalArrivesHours);
  const newJob = endOf.get("new-batch-1");
  const task = (id: string) => newJob?.tasks.find((t) => t.id === id);

  return {
    asOf: now.toISOString(),
    order: { id: order.id, orderCode, destination: order.destination, quantity: order.quantity, priority: order.priority, dueAt: order.dueAt.toISOString() },
    target: {
      sources: (mine?.parts ?? []).map((p) => ({ label: p.label, kind: kindOf.get(p.supplyId) ?? "released_stock", units: p.units })),
      arrivesAt: mine?.arrivesHours != null ? at(mine.arrivesHours) : null,
      lateHours: mine?.lateHours ?? null,
      onTime: mine?.lateHours === 0,
    },
    ifServedFirst: gains
      ? {
          arrivesAt: trade.firstArrivesHours !== null ? at(trade.firstArrivesHours) : null,
          bumped: trade.bumped.map((b) => ({ orderCode: b.orderCode, from: b.fromHours !== null ? at(b.fromHours) : null, to: b.toHours !== null ? at(b.toHours) : null, delayHours: b.delayHours })),
        }
      : null,
    plan: serviceOrder(demands).map((d) => {
      const a = normal.find((x) => x.orderCode === d.orderCode);
      return { orderCode: d.orderCode, priority: d.priority, dueAt: at(d.dueHours), sources: (a?.parts ?? []).map((p) => `${p.units} from ${p.label}`), arrivesAt: a?.arrivesHours != null ? at(a.arrivesHours) : null, lateHours: a?.lateHours ?? null };
    }),
    supplies: supplies.map((s) => ({ id: s.id, label: s.label, kind: s.kind, units: s.units, readyAt: at(s.readyHours) })),
    newBatch:
      newJob && task("fill") && task("test") && task("qa")
        ? {
            line: task("fill")?.resource.replace(/^line:/, "") ?? null,
            fillStartsAt: at(task("fill")?.start_hours ?? 0),
            testEndsAt: at(task("test")?.end_hours ?? 0),
            releasedAt: at(task("qa")?.end_hours ?? 0),
            readyAt: at(newJob.end_hours),
          }
        : null,
    realism: [
      `Sterility testing takes ${order.testDays} days; no batch is released earlier.`,
      "Batches still in testing count as supply only if their sterility test passes.",
      `QA reviews up to ${qa.capacity} batch records per day after testing.`,
      `Each fill line makes one batch per day; ${lines.length} line(s) running.`,
      `${incubators.capacity} incubator slots are shared by every test in progress.`,
    ],
    optimizer: { optimal: solved.optimal, note: solved.note },
  };
}
