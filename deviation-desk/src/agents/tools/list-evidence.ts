import { z } from "zod";
import { getSql } from "@/db/client";
import type { AgentTool } from "./types";

const input = z.object({ limit: z.number().int().min(1).max(100).default(50) });

export const listEvidence: AgentTool<typeof input> = {
  name: "list_evidence",
  description:
    'List evidence collected for this incident. Each item points at a source row (sourceTable, sourceId); cite the source row itself, or the item as table "evidence".',
  input,
  async run({ limit }, ctx) {
    if (!ctx.incidentId) throw new Error("This run is not attached to an incident.");
    const sql = getSql();
    const evidence = await sql`
      select id, source_table, source_id, added_by_type, added_by, note, created_at
      from evidence where world_id = ${ctx.worldId} and incident_id = ${ctx.incidentId}
      order by created_at, id limit ${limit}`;
    return { citeAs: "evidence", evidence };
  },
};
