import { z } from "zod";
import { getSql } from "@/db/client";
import type { AgentTool } from "./types";

const input = z.object({});

export const getIncident: AgentTool<typeof input> = {
  name: "get_incident",
  description:
    "Get the incident this run is about: code, title, type, severity, status, the objects it was opened for, and its most recent timeline events.",
  input,
  async run(_input, ctx) {
    if (!ctx.incidentId) throw new Error("This run is not attached to an incident.");
    const sql = getSql();
    const [incident] = await sql`
      select id, code, title, incident_type, severity, priority, status, opened_at
      from incidents where world_id = ${ctx.worldId} and id = ${ctx.incidentId}`;
    if (!incident) throw new Error("Incident not found in this world.");
    const events = await sql`
      select id, actor_type, actor_id, seat, event_type, payload, created_at
      from incident_events where world_id = ${ctx.worldId} and incident_id = ${ctx.incidentId}
      order by created_at desc, id desc limit 20`;
    return { citeAs: { incident: "incidents", recentEvents: "incident_events" }, incident, recentEvents: events };
  },
};
