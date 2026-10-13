import { z } from "zod";
import { getCapacity } from "@/db/capacity";
import { getSql } from "@/db/client";
import { compareStress } from "@/expansion/compare";
import type { StressResult } from "@/expansion/simulate";
import { worldNow } from "@/regulatory/deadlines";
import type { AgentTool } from "./types";

const DAY_MS = 86_400_000;
const empty = z.object({});

export const getDemand: AgentTool<typeof empty> = {
  name: "get_demand",
  description:
    'Demand against capacity, computed for you: units ordered per week for the next 8 weeks, batches made in the last 60 days, and monthly capacity of each stage (fill lines, sterility test slots, QA review) in batches, with the bottleneck and its utilization. Cite capacity rows as "capacity_resources" and orders as "orders".',
  input: empty,
  async run(_input, ctx) {
    const sql = getSql();
    const now = await worldNow(sql, ctx.worldId);
    const orders = await sql<{ id: string; orderCode: string; quantity: number; dueAt: Date }[]>`
      select id, order_code, quantity, due_at from orders
      where world_id = ${ctx.worldId} and status not in ('delivered', 'cancelled') and due_at between ${now} and ${new Date(now.getTime() + 56 * DAY_MS)}
      order by due_at`;
    const weeks = Array.from({ length: 8 }, (_, i) => ({ week: i + 1, starts: new Date(now.getTime() + i * 7 * DAY_MS).toISOString().slice(0, 10), units: 0 }));
    for (const o of orders) {
      const w = weeks[Math.floor((o.dueAt.getTime() - now.getTime()) / (7 * DAY_MS))];
      if (w) w.units += o.quantity;
    }
    const [made] = await sql<{ batches: number; units: number; avgBatch: number }[]>`
      select count(*)::int as batches, coalesce(sum(quantity), 0)::int as units, coalesce(round(avg(quantity)), 0)::int as avg_batch
      from batches where world_id = ${ctx.worldId} and produced_at > ${new Date(now.getTime() - 60 * DAY_MS)}`;
    const resources = await getCapacity(sql, ctx.worldId);
    const perMonth = (kind: string) => {
      const rs = resources.filter((r) => r.kind === kind && (kind !== "fill_line" || r.lineStatus === "running"));
      if (rs.length === 0) return 0;
      return rs.reduce((n, r) => n + (r.capacityBasis === "per_day" ? r.capacity * 30 : Math.floor((r.capacity * 30 * 24) / r.taskHours)), 0);
    };
    const stages = [
      { stage: "fill", batchesPerMonth: perMonth("fill_line") },
      { stage: "sterility_test", batchesPerMonth: perMonth("sterility_test") },
      { stage: "qa_release", batchesPerMonth: perMonth("qa_release") },
    ];
    const bottleneck = stages.reduce((a, b) => (b.batchesPerMonth < a.batchesPerMonth ? b : a));
    const recentPerMonth = Math.round(((made?.batches ?? 0) / 60) * 30 * 10) / 10;
    return {
      citeAs: { capacity: "capacity_resources", orders: "orders" },
      asOf: now.toISOString(),
      orderedUnitsByWeek: weeks,
      orders: orders.map((o) => ({ id: o.id, orderCode: o.orderCode, quantity: o.quantity, dueAt: o.dueAt.toISOString() })),
      recent: { batchesLast60Days: made?.batches ?? 0, batchesPerMonth: recentPerMonth, averageBatchUnits: made?.avgBatch ?? 0 },
      monthlyCapacity: stages,
      bottleneck: { ...bottleneck, utilization: bottleneck.batchesPerMonth > 0 ? Math.round((recentPerMonth / bottleneck.batchesPerMonth) * 100) / 100 : null },
      resources: resources.map((r) => ({ id: r.id, name: r.name, kind: r.kind, capacity: r.capacity, basis: r.capacityBasis })),
    };
  },
};

export const getNetwork: AgentTool<typeof empty> = {
  name: "get_network",
  description:
    'The distribution network: locations, refrigerated lanes with transit hours and cost per unit, and open order units per destination. Cite locations as "locations".',
  input: empty,
  async run(_input, ctx) {
    const sql = getSql();
    const locations = await sql`
      select l.id, l.name, l.kind,
        coalesce((select sum(o.quantity) from orders o where o.world_id = l.world_id and o.destination_id = l.id and o.status not in ('delivered', 'cancelled')), 0)::int as open_order_units
      from locations l where l.world_id = ${ctx.worldId} order by l.kind, l.name`;
    const lanes = await sql`
      select o.name as origin, d.name as destination, l.storage_condition, l.transit_hours::float8 as transit_hours, l.cost_per_unit::float8 as cost_per_unit
      from lanes l join locations o on o.world_id = l.world_id and o.id = l.origin_id join locations d on d.world_id = l.world_id and d.id = l.destination_id
      where l.world_id = ${ctx.worldId} order by o.name, d.name`;
    return { citeAs: "locations", locations, lanes };
  },
};

export const getInvestmentOptions: AgentTool<typeof empty> = {
  name: "get_investment_options",
  description:
    'The company\'s investment price list: each kind of change (fill_line, test_capacity, qa_capacity, backup_supplier, distribution_center) with its unit cost and lead time. The system prices proposals from it. Cite as "investment_options".',
  input: empty,
  async run(_input, ctx) {
    const options = await getSql()`
      select id, kind, description, unit, unit_cost_usd::float8 as unit_cost_usd, lead_time_months from investment_options where world_id = ${ctx.worldId} order by kind`;
    return { citeAs: "investment_options", options };
  },
};

/** Proposals with their latest simulation, as plain comparison rows. */
async function loadProposals(worldId: string, code?: string) {
  const sql = getSql();
  const proposals = await sql<
    Array<{ id: string; code: string; kind: string; title: string; summary: string; change: unknown; estimatedCostUsd: string; leadTimeMonths: number; status: string; proposedBy: string; baseline: StressResult | null; withChange: StressResult | null }>
  >`
    select p.id, p.code, p.kind, p.title, p.summary, p.change, p.estimated_cost_usd, p.lead_time_months, p.status, p.proposed_by, s.baseline, s.with_change
    from expansion_proposals p
    left join lateral (select baseline, with_change from expansion_simulations s where s.world_id = p.world_id and s.proposal_id = p.id order by created_at desc limit 1) s on true
    where p.world_id = ${worldId} ${code ? sql`and p.code = ${code}` : sql``}
    order by p.created_at`;
  return proposals.map(({ baseline, withChange, estimatedCostUsd, ...p }) => ({
    ...p,
    estimatedCostUsd: Number(estimatedCostUsd),
    simulation: baseline && withChange ? compareStress(baseline, withChange) : null,
  }));
}

export const listProposals: AgentTool<typeof empty> = {
  name: "list_proposals",
  description:
    'Every expansion proposal: what it changes, its computed cost and lead time, status, and its what-if simulation (the same stress tests on the company as it is and with the change). Check it before proposing, so you never duplicate a proposal. Cite as "expansion_proposals".',
  input: empty,
  async run(_input, ctx) {
    return { citeAs: "expansion_proposals", proposals: await loadProposals(ctx.worldId) };
  },
};

const proposalInput = z.object({ code: z.string().describe('e.g. "EXP-001"') });

export const getProposal: AgentTool<typeof proposalInput> = {
  name: "get_proposal",
  description: 'One expansion proposal with its change, cost, lead time and simulation comparison. Cite as "expansion_proposals".',
  input: proposalInput,
  async run({ code }, ctx) {
    const [proposal] = await loadProposals(ctx.worldId, code);
    return proposal ? { citeAs: "expansion_proposals", proposal } : { error: `No proposal ${code}.` };
  },
};
