import { z } from "zod";
import { getSql } from "@/db/client";
import { getWorld } from "@/db/twin";
import { loadAllAgents } from "../configs";
import type { AgentTool } from "./types";

const input = z.object({});

export const listAgents: AgentTool<typeof input> = {
  name: "list_agents",
  description: "List the agents available in this world: id, name, department, job, and the events that wake them.",
  input,
  async run(_input, ctx) {
    const sql = getSql();
    const world = await getWorld(sql, ctx.worldId);
    const agents = await loadAllAgents(sql);
    return {
      note: "Agents are configuration, not database rows. Do not cite them as sources.",
      agents: agents
        .map((a) => a.config)
        .filter((a) => world.kind === "drill" || !a.drillOnly)
        .map((a) => ({ id: a.id, name: a.name, department: a.department, job: a.job, triggers: a.triggers })),
    };
  },
};
