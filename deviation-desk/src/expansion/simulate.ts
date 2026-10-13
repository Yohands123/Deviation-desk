/**
 * Simulate before you build (CLAUDE.md Phase 7). A proposal is judged by running the same stress
 * tests on two copies of the company: as it is, and with the change applied. Everything here is
 * code and the optimizer, so the comparison is arithmetic, not an agent's opinion. The what-if
 * worlds are drill-kind copies (nothing they do can leave), archived when the run finishes.
 */
import type { Sql } from "@/db/client";
import { getCapacity } from "@/db/capacity";
import { createDrillWorld } from "@/db/create-drill-world";
import { logOrder } from "@/logistics/orders";
import { planOrder } from "@/logistics/plan-order";
import { worldNow } from "@/regulatory/deadlines";
import { applyChange, type Change } from "./change";

const HOUR_MS = 3_600_000;

/** The stress orders, relative to the world's clock: a rush, a trial-site emergency, a surge. */
export const STRESS_ORDERS = [
  { name: "Rush", destination: "Northshore Hospital Pharmacy", quantity: 9_000, dueInHours: 36, priority: "high" },
  { name: "Trial emergency", destination: "Trial site 212 (study HLX-201-04)", quantity: 4_000, dueInHours: 72, priority: "patient_critical" },
  { name: "Surge", destination: "Lakeview Specialty Pharmacy", quantity: 40_000, dueInHours: 28 * 24, priority: "routine" },
] as const;

export interface StressResult {
  orders: Array<{ name: string; quantity: number; dueAt: string; arrivesAt: string | null; lateHours: number | null; onTime: boolean }>;
  onTime: number;
  /** Total hours late across stress orders that can be met; unmet ones are counted separately. */
  lateHours: number;
  unmet: number;
  /** With the first running fill line halted: when the surge could still arrive. */
  outage: { haltedLine: string | null; linesLeft: number; surgeArrivesAt: string | null; surgeLateHours: number | null };
  singleSourceMaterials: string[];
  capacity: { fillLines: number; testSlots: number; qaReviewsPerDay: number };
}

export async function runStressTests(sql: Sql, worldId: string, companyId: string): Promise<StressResult> {
  const now = await worldNow(sql, worldId);
  const [product] = await sql<{ id: string }[]>`select id from products where world_id = ${worldId} order by name limit 1`;
  if (!product) throw new Error("No product to stress-test.");

  const codes: string[] = [];
  for (const o of STRESS_ORDERS) {
    const [destination] = await sql<{ id: string }[]>`select id from locations where world_id = ${worldId} and name = ${o.destination}`;
    if (!destination) throw new Error(`Stress test destination "${o.destination}" is missing.`);
    const logged = await logOrder(sql, {
      worldId,
      companyId,
      productId: product.id,
      destinationId: destination.id,
      quantity: o.quantity,
      dueAt: new Date(now.getTime() + o.dueInHours * HOUR_MS),
      priority: o.priority,
      loggedBy: null,
      loggedAt: now,
    });
    codes.push(logged.orderCode);
  }

  const orders: StressResult["orders"] = [];
  for (const [i, code] of codes.entries()) {
    const plan = await planOrder(sql, worldId, code);
    const spec = STRESS_ORDERS[i];
    orders.push({
      name: spec?.name ?? code,
      quantity: plan.order.quantity,
      dueAt: plan.order.dueAt,
      arrivesAt: plan.target.arrivesAt,
      lateHours: plan.target.lateHours,
      onTime: plan.target.onTime,
    });
  }

  const resources = await getCapacity(sql, worldId);
  const running = resources.filter((r) => r.kind === "fill_line" && r.lineStatus === "running");
  const capacity = {
    fillLines: running.length,
    testSlots: resources.find((r) => r.kind === "sterility_test")?.capacity ?? 0,
    qaReviewsPerDay: resources.find((r) => r.kind === "qa_release")?.capacity ?? 0,
  };
  const singleSource = await sql<{ name: string }[]>`
    select m.name from materials m
    where m.world_id = ${worldId}
      and (select count(*) from material_suppliers ms where ms.world_id = m.world_id and ms.material_id = m.id and ms.approved) = 1
    order by m.name`;

  // Outage last, since it changes the world: halt the first running line and plan the surge again.
  const halted = running[0]?.lineName ?? null;
  const surgeCode = codes[STRESS_ORDERS.findIndex((o) => o.name === "Surge")];
  let surge: { arrivesAt: string | null; lateHours: number | null } = { arrivesAt: null, lateHours: null };
  if (halted && surgeCode) {
    await sql`update production_lines set status = 'halted' where world_id = ${worldId} and name = ${halted}`;
    const plan = await planOrder(sql, worldId, surgeCode);
    surge = { arrivesAt: plan.target.arrivesAt, lateHours: plan.target.lateHours };
  }

  return {
    orders,
    onTime: orders.filter((o) => o.onTime).length,
    lateHours: orders.reduce((n, o) => n + (o.lateHours ?? 0), 0),
    unmet: orders.filter((o) => o.arrivesAt === null).length,
    outage: { haltedLine: halted, linesLeft: Math.max(0, running.length - 1), surgeArrivesAt: surge.arrivesAt, surgeLateHours: surge.lateHours },
    singleSourceMaterials: singleSource.map((m) => m.name),
    capacity,
  };
}

/** A fresh what-if copy of a world at its current time. */
async function whatIf(sql: Sql, sourceWorldId: string): Promise<string> {
  const world = await createDrillWorld(sql, sourceWorldId, 1, { simClock: await worldNow(sql, sourceWorldId) });
  return world.id;
}

export interface Simulation {
  id: string;
  baseline: StressResult;
  withChange: StressResult;
}

/** Runs the stress tests with and without a proposal's change and records the comparison. */
export async function simulateProposal(sql: Sql, sourceWorldId: string, companyId: string, proposalId: string, change: Change): Promise<Simulation> {
  // Both runs use fresh copies, so the source world (live, or an eval's drill) is never changed.
  const baselineWorld = await whatIf(sql, sourceWorldId);
  const changedWorld = await whatIf(sql, sourceWorldId);
  try {
    await applyChange(sql, changedWorld, companyId, change);
    const baseline = await runStressTests(sql, baselineWorld, companyId);
    const withChange = await runStressTests(sql, changedWorld, companyId);
    const [row] = await sql<{ id: string }[]>`
      insert into expansion_simulations ${sql({
        worldId: sourceWorldId,
        companyId,
        proposalId,
        baseline: sql.json(baseline as unknown as Parameters<typeof sql.json>[0]),
        withChange: sql.json(withChange as unknown as Parameters<typeof sql.json>[0]),
      })}
      returning id`;
    if (!row) throw new Error("Failed to record the simulation");
    return { id: row.id, baseline, withChange };
  } finally {
    await sql`update worlds set status = 'archived' where id in ${sql([baselineWorld, changedWorld])}`;
  }
}
