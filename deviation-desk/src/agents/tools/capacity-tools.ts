import { z } from "zod";
import { batchExposure, getCapacity, orderValues } from "@/db/capacity";
import { getSql } from "@/db/client";
import type { AgentTool } from "./types";

const capacityInput = z.object({});

export const getCapacityTool: AgentTool<typeof capacityInput> = {
  name: "get_capacity",
  description:
    'Shared resources and their load: fill lines (one batch per day each, and whether running or halted), sterility test incubator slots (a test holds a slot for 14 days), QA batch record review, and dock dispatch. "free" is computed for you. Cite resources as table "capacity_resources".',
  input: capacityInput,
  async run(_input, ctx) {
    return { citeAs: "capacity_resources", resources: await getCapacity(getSql(), ctx.worldId) };
  },
};

const costsInput = z.object({
  batches: z.array(z.string()).max(20).optional().describe("Batch codes to price, e.g. the incident's batches and those that share its cause. Omit for batches with stock on hold."),
});

export const getCosts: AgentTool<typeof costsInput> = {
  name: "get_costs",
  description:
    'Money at stake, computed for you: for each batch, units and value in stock, on hold, staged in planned or held shipments, in transit and delivered (delivered units are what a recall would have to bring back); and upcoming orders with their value and whether clean supply covers them. Use these figures; never compute your own. Cite batches as "batches" and orders as "orders".',
  input: costsInput,
  async run({ batches }, ctx) {
    const sql = getSql();
    const codes =
      batches ??
      (
        await sql<{ batchCode: string }[]>`
          select distinct b.batch_code from batches b join inventory_lots i on i.world_id = b.world_id and i.batch_id = b.id
          where b.world_id = ${ctx.worldId} and i.on_hold order by 1`
      ).map((r) => r.batchCode);
    const [exposure, orders, ids] = await Promise.all([
      batchExposure(sql, ctx.worldId, codes),
      orderValues(sql, ctx.worldId),
      sql<{ code: string; id: string }[]>`
        select batch_code as code, id from batches where world_id = ${ctx.worldId} and batch_code in ${sql(codes.length > 0 ? codes : ["-"])}
        union all select order_code, id from orders where world_id = ${ctx.worldId}`,
    ]);
    const idOf = new Map(ids.map((r) => [r.code, r.id]));
    return {
      citeAs: { batches: "batches", orders: "orders" },
      batches: exposure.map((b) => ({ id: idOf.get(b.batchCode), ...b })),
      orders: orders.map((o) => ({ id: idOf.get(o.orderCode), ...o })),
    };
  },
};

const resourcesInput = z.object({});

/** The seats that lead each kind of incident (who has to make its calls). */
const LEAD_SEATS: Record<string, string[]> = {
  quality: ["qa_director", "plant_manager"],
  equipment: ["plant_manager"],
  supply: ["supply_chain_lead"],
  cold_chain: ["supply_chain_lead", "qa_director"],
  safety: ["plant_manager", "executive"],
  clinical: ["clinical_ops", "qa_director"],
};

export const getResources: AgentTool<typeof resourcesInput> = {
  name: "get_resources",
  description:
    'For every open incident: severity, priority, status, the seats it needs (seatsNeeded: who leads its type and who owns its decisions), people seated, decisions waiting, and agent work in the last 24 hours; plus shared capacity. Use it to judge which incident should get people and capacity first. Cite incidents as "incidents" and resources as "capacity_resources".',
  input: resourcesInput,
  async run(_input, ctx) {
    const sql = getSql();
    const incidents = await sql`
      select i.id, i.code, i.title, i.incident_type, i.severity, i.priority, i.status, i.opened_at,
        (select count(*) from seats s where s.world_id = i.world_id and s.incident_id = i.id and s.person_id is not null)::int as people_seated,
        (select count(*) from decision_records d where d.world_id = i.world_id and d.incident_id = i.id and d.requires_approval
          and not exists (select 1 from approvals a where a.world_id = d.world_id and a.decision_record_id = d.id and a.outcome <> 'more_evidence'))::int as decisions_waiting,
        (select count(*) from agent_runs r where r.world_id = i.world_id and r.incident_id = i.id and r.created_at > now() - interval '24 hours')::int as agent_runs_24h,
        coalesce((select array_agg(distinct d.record -> 'answer' ->> 'approvalSeat') from decision_records d
          where d.world_id = i.world_id and d.incident_id = i.id and d.requires_approval), '{}') as deciding_seats
      from incidents i
      where i.world_id = ${ctx.worldId} and i.status <> 'closed'
      order by i.opened_at`;
    // Seats each incident needs: who leads its type, plus whoever owns its decisions so far.
    const withSeats = incidents.map(({ decidingSeats, ...i }) => ({
      ...i,
      seatsNeeded: [...new Set([...(LEAD_SEATS[String(i.incidentType)] ?? []), ...(decidingSeats as string[])])],
    }));
    return { citeAs: { incidents: "incidents", resources: "capacity_resources" }, incidents: withSeats, resources: await getCapacity(sql, ctx.worldId) };
  },
};
