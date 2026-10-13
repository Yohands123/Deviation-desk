/**
 * What an expansion proposal would change in the twin, how to apply it to a what-if copy, and what
 * it costs (from the company's investment price list). Costs are arithmetic, so code computes them.
 */
import { z } from "zod";
import type { Sql, TransactionSql } from "@/db/client";

type Db = Sql | TransactionSql;

export const Change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fill_line"), room: z.string().min(1), lineName: z.string().min(1), unitsPerHour: z.number().int().positive().max(20_000) }),
  z.object({ kind: z.literal("test_capacity"), addSlots: z.number().int().positive().max(48) }),
  z.object({ kind: z.literal("qa_capacity"), addPerDay: z.number().int().positive().max(10) }),
  z.object({ kind: z.literal("backup_supplier"), material: z.string().min(1), supplier: z.string().min(1), country: z.string().optional(), leadTimeDays: z.number().int().positive().max(365) }),
  z.object({
    kind: z.literal("distribution_center"),
    name: z.string().min(1),
    inboundTransitHours: z.number().positive().max(240),
    lanes: z.array(z.object({ to: z.string().min(1), transitHours: z.number().positive().max(240), costPerUnit: z.number().nonnegative().max(1000) })).min(1).max(10),
  }),
]);
export type Change = z.infer<typeof Change>;

/** How many units of the price-list item a change buys. */
export function units(change: Change): number {
  switch (change.kind) {
    case "test_capacity":
      return change.addSlots;
    case "qa_capacity":
      return change.addPerDay;
    default:
      return 1;
  }
}

export async function estimateCost(db: Db, worldId: string, change: Change): Promise<{ costUsd: number; leadTimeMonths: number; unit: string; unitCostUsd: number }> {
  const [option] = await db<{ unit: string; unitCostUsd: string; leadTimeMonths: number }[]>`
    select unit, unit_cost_usd, lead_time_months from investment_options where world_id = ${worldId} and kind = ${change.kind}`;
  if (!option) throw new Error(`No price for "${change.kind}" in the investment list.`);
  const unitCost = Number(option.unitCostUsd);
  return { costUsd: Math.round(unitCost * units(change) * 100) / 100, leadTimeMonths: option.leadTimeMonths, unit: option.unit, unitCostUsd: unitCost };
}

/** Problems that make a change impossible to apply in this world, in plain words. Empty when valid. */
export async function checkChange(db: Db, worldId: string, change: Change): Promise<string[]> {
  const problems: string[] = [];
  const has = async (table: "rooms" | "materials" | "locations" | "production_lines", name: string) =>
    (await db`select 1 from ${db(table)} where world_id = ${worldId} and name = ${name}`).length > 0;
  switch (change.kind) {
    case "fill_line":
      if (!(await has("rooms", change.room))) problems.push(`There is no room "${change.room}".`);
      if (await has("production_lines", change.lineName)) problems.push(`A line named "${change.lineName}" already exists.`);
      break;
    case "backup_supplier": {
      if (!(await has("materials", change.material))) problems.push(`There is no material "${change.material}".`);
      const [approved] = await db`
        select 1 from material_suppliers ms join materials m on m.world_id = ms.world_id and m.id = ms.material_id
        join suppliers s on s.world_id = ms.world_id and s.id = ms.supplier_id
        where ms.world_id = ${worldId} and m.name = ${change.material} and s.name = ${change.supplier} and ms.approved`;
      if (approved) problems.push(`${change.supplier} is already approved for ${change.material}.`);
      break;
    }
    case "distribution_center":
      if (await has("locations", change.name)) problems.push(`A location named "${change.name}" already exists.`);
      for (const lane of change.lanes) if (!(await has("locations", lane.to))) problems.push(`There is no destination "${lane.to}".`);
      break;
    default:
      break;
  }
  return problems;
}

/** Applies a change to a what-if world (never a live one; the caller checks). */
export async function applyChange(db: Db, worldId: string, companyId: string, change: Change): Promise<void> {
  const base = { worldId, companyId };
  switch (change.kind) {
    case "fill_line": {
      const [room] = await db<{ id: string }[]>`select id from rooms where world_id = ${worldId} and name = ${change.room}`;
      if (!room) throw new Error(`There is no room "${change.room}".`);
      const [line] = await db<{ id: string }[]>`
        insert into production_lines ${db({ ...base, roomId: room.id, name: change.lineName, unitsPerHour: change.unitsPerHour })} returning id`;
      await db`insert into capacity_resources ${db({
        ...base,
        name: `${change.lineName} aseptic fill`,
        kind: "fill_line",
        lineId: line?.id ?? null,
        capacity: 1,
        capacityBasis: "per_day",
        taskHours: 10,
        notes: "Proposed line (what-if).",
      })}`;
      return;
    }
    case "test_capacity":
      await db`update capacity_resources set capacity = capacity + ${change.addSlots} where world_id = ${worldId} and kind = 'sterility_test'`;
      return;
    case "qa_capacity":
      await db`update capacity_resources set capacity = capacity + ${change.addPerDay} where world_id = ${worldId} and kind = 'qa_release'`;
      return;
    case "backup_supplier": {
      const [material] = await db<{ id: string }[]>`select id from materials where world_id = ${worldId} and name = ${change.material}`;
      if (!material) throw new Error(`There is no material "${change.material}".`);
      let [supplier] = await db<{ id: string }[]>`select id from suppliers where world_id = ${worldId} and name = ${change.supplier}`;
      if (!supplier) [supplier] = await db<{ id: string }[]>`insert into suppliers ${db({ ...base, name: change.supplier, country: change.country ?? null })} returning id`;
      await db`
        insert into material_suppliers ${db({ ...base, materialId: material.id, supplierId: supplier?.id, approved: true, leadTimeDays: change.leadTimeDays })}
        on conflict (world_id, material_id, supplier_id) do update set approved = true, lead_time_days = excluded.lead_time_days`;
      return;
    }
    case "distribution_center": {
      const [dc] = await db<{ id: string }[]>`insert into locations ${db({ ...base, name: change.name, kind: "distribution_center" })} returning id`;
      const [dock] = await db<{ id: string }[]>`select id from locations where world_id = ${worldId} and kind = 'dock' order by name limit 1`;
      const lanes = [
        ...(dock ? [{ originId: dock.id, destinationId: dc?.id, transitHours: change.inboundTransitHours, costPerUnit: 0.4 }] : []),
        ...(await Promise.all(
          change.lanes.map(async (l) => {
            const [to] = await db<{ id: string }[]>`select id from locations where world_id = ${worldId} and name = ${l.to}`;
            return { originId: dc?.id, destinationId: to?.id, transitHours: l.transitHours, costPerUnit: l.costPerUnit };
          }),
        )),
      ];
      await db`insert into lanes ${db(lanes.map((l) => ({ ...base, ...l, storageCondition: "refrigerated" })))}`;
      return;
    }
  }
}
