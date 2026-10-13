import { z } from "zod";
import { getSql } from "@/db/client";
import type { AgentTool } from "./types";

const input = z.object({ limit: z.number().int().min(1).max(50).default(20) });

export const findOpenIncidents: AgentTool<typeof input> = {
  name: "find_open_incidents",
  description:
    "List incidents that are not closed, with the objects each was opened for, so a new problem can be linked to an existing incident instead of duplicated.",
  input,
  async run({ limit }, ctx) {
    const sql = getSql();
    const incidents = await sql`
      select i.id, i.code, i.title, i.incident_type, i.severity, i.status, i.opened_at,
        (select e.payload -> 'objects' from incident_events e
          where e.world_id = i.world_id and e.incident_id = i.id and e.event_type = 'opened'
          order by e.id limit 1) as objects
      from incidents i
      where i.world_id = ${ctx.worldId} and i.status <> 'closed'
      order by i.opened_at desc limit ${limit}`;
    // With nothing open, say so plainly: a citeAs hint over an empty list invites citing the table itself.
    if (incidents.length === 0) return { incidents: [], note: "No open incidents. Nothing here to cite." };
    return { citeAs: "incidents", incidents };
  },
};
