import { z } from "zod";
import { getSql } from "@/db/client";
import { GraphTable } from "@/db/rows";
import { traceImpact as trace } from "@/db/trace-impact";
import { resolveSubject } from "./subject";
import type { AgentTool } from "./types";

const MAX_NODES = 150;

const input = z
  .object({
    startTable: GraphTable,
    startId: z.string().optional().describe("Row id of the starting object."),
    startCode: z.string().optional().describe('Or its code/name, e.g. "A-2231", "G-77", "Filler 3".'),
    maxDepth: z.number().int().min(1).max(6).default(3),
  })
  .refine((v) => v.startId || v.startCode, "Give startId or startCode.");

export const traceImpact: AgentTool<typeof input> = {
  name: "trace_impact",
  description:
    "Follow the impact graph from a starting object through shared equipment, shared material lots, inventory, shipments, orders and destinations. Returns each connected object once with its depth, status, the link that reached it, and the path.",
  input,
  async run({ startTable, startId, startCode, maxDepth }, ctx) {
    const sql = getSql();
    const id = await resolveSubject(sql, ctx.worldId, startTable, { id: startId, code: startCode });
    const nodes = await trace(sql, ctx.worldId, { table: startTable, id }, maxDepth);
    const labels = new Map(nodes.map((n) => [`${n.table}:${n.id}`, n.label]));
    return {
      truncated: nodes.length > MAX_NODES,
      nodes: nodes.slice(0, MAX_NODES).map((n) => ({
        table: n.table,
        id: n.id,
        label: n.label,
        status: n.status,
        depth: n.depth,
        via: n.via,
        path: n.path.map((p) => labels.get(`${p.table}:${p.id}`) ?? p.id).join(" → "),
      })),
    };
  },
};
