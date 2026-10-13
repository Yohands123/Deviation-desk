import { z } from "zod";
import { getSql } from "@/db/client";
import type { AgentTool } from "./types";

const input = z.object({
  supplier: z.string().optional().describe("A supplier name: returns every material it supplies, with all suppliers of each."),
  material: z.string().optional().describe("Or a material name."),
});

export const getApprovedSuppliers: AgentTool<typeof input> = {
  name: "get_approved_suppliers",
  description:
    'List materials with every supplier, whether each is approved, lead times, and whether the material is single-source (one approved supplier). Cite suppliers as table "suppliers" and materials as "materials".',
  input,
  async run({ supplier, material }, ctx) {
    const sql = getSql();
    const rows = await sql<
      Array<{ materialId: string; material: string; supplierId: string; supplier: string; country: string | null; approved: boolean; leadTimeDays: number | null }>
    >`
      select m.id as material_id, m.name as material, s.id as supplier_id, s.name as supplier, s.country, ms.approved, ms.lead_time_days
      from material_suppliers ms
      join materials m on m.world_id = ms.world_id and m.id = ms.material_id
      join suppliers s on s.world_id = ms.world_id and s.id = ms.supplier_id
      where ms.world_id = ${ctx.worldId}
        ${material ? sql`and m.name ilike ${`%${material}%`}` : sql``}
        ${supplier ? sql`and m.id in (select ms2.material_id from material_suppliers ms2 join suppliers s2 on s2.world_id = ms2.world_id and s2.id = ms2.supplier_id where ms2.world_id = ${ctx.worldId} and s2.name ilike ${`%${supplier}%`})` : sql``}
      order by m.name, s.name`;

    const byMaterial = new Map<string, { materialId: string; material: string; suppliers: unknown[]; approvedCount: number }>();
    for (const r of rows) {
      const entry = byMaterial.get(r.materialId) ?? { materialId: r.materialId, material: r.material, suppliers: [], approvedCount: 0 };
      entry.suppliers.push({ supplierId: r.supplierId, name: r.supplier, country: r.country, approved: r.approved, leadTimeDays: r.leadTimeDays });
      if (r.approved) entry.approvedCount++;
      byMaterial.set(r.materialId, entry);
    }
    return {
      citeAs: { materials: "materials", suppliers: "suppliers" },
      materials: [...byMaterial.values()].map(({ approvedCount, ...m }) => ({ ...m, singleSource: approvedCount === 1 })),
    };
  },
};
